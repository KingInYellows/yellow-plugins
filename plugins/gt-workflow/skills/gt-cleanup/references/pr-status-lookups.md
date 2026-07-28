# gt-cleanup — PR Status Lookups (Phase 2 #4)

Moved verbatim from SKILL.md Phase 2 #4. Read when performing PR status
lookups during the branch scan.

For branches that have an upstream **and** whose track status does NOT contain
`[gone]` (so: not orphaned and not already routed to the merged-branch hint),
check PR status to determine:
- Whether the branch belongs in the **Closed PR** category
- Whether the branch should be excluded from the **Stale** category (has open PR)

`[gone]`-tracked branches are skipped here on purpose — they were already
classified in Section 3 Step 2 and belong to the `gt-sync` skill, so any
`closed_not_merged` tagging on them would be display-dead and only burn API
quota.

If there are more than 20 branches to check, show a progress indicator:

```bash
echo "Checking PR status for branch $i of $total..."
```

Capture the repo identifier once before the loop to avoid redundant API calls:

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)
if [ -z "$REPO" ]; then
  echo "ERROR: Could not determine GitHub repository. Ensure this directory is connected to a GitHub remote and 'gh' is authenticated."
  exit 1
fi
```

For each branch, run `gh pr list` and parse with jq. `gh pr list --json`
exposes the GraphQL `state` enum directly (`OPEN | CLOSED | MERGED`) — a
merged PR has `state == "MERGED"`, **not** `CLOSED`. So `state == "CLOSED"`
is by itself unambiguous evidence of "closed without landing"; no separate
`merged` boolean check is needed. (The propagation-lag concern documented in
`docs/solutions/integration-issues/merge-queue-closed-pr-null-mergedat-detection.md`
applies to `gh api repos/{owner}/{repo}/pulls/{number}` per-PR REST calls,
where `merged: bool` is exposed; `gh pr list --json` does not accept a
`merged` field — only `state`, `mergedAt`, `mergedBy`, `mergeCommit`,
`closed`, `closedAt`, etc. — so the GraphQL `state` enum is the correct
authority here.)

`mergedAt` is also requested for display use (e.g., "merged at <timestamp>"
in per-branch detail), but is not used for classification.

Use this concrete jq pipeline so the runtime does not have to infer the
parse:

```bash
PR_JSON=$(gh pr list --repo "$REPO" \
  --head "$BRANCH_NAME" --state all --json state,mergedAt --limit 100)

PR_COUNT=$(printf '%s' "$PR_JSON" | jq 'length')
HAS_OPEN=$(printf '%s' "$PR_JSON" | jq 'any(.[]; .state == "OPEN")')
ALL_TERMINAL=$(printf '%s' "$PR_JSON" \
  | jq 'length > 0 and all(.[]; .state == "CLOSED" or .state == "MERGED")')
CLOSED_NOT_MERGED=$(printf '%s' "$PR_JSON" \
  | jq 'all(.[]; .state != "MERGED") and any(.[]; .state == "CLOSED")')
```

**Do NOT suppress stderr.** Add a `sleep 0.2` between lookups to avoid
triggering GitHub secondary rate limits. If `gh pr list` fails:
- If the error contains "rate limit" or HTTP 403: pause 60 seconds, then
  retry once. After 3 consecutive rate-limit errors, skip remaining PR lookups.
- For other errors (network, auth): report to the user.
- In all failure cases, mark PR-dependent classifications as incomplete and
  continue with categories that don't require PR data (orphaned, diverged,
  behind, ahead).

Then classify:

- `HAS_OPEN == true`: branch has an active PR — exclude from **Closed PR**
  and **Stale** categories.
- `ALL_TERMINAL == true`: branch is a **Closed PR** candidate. If
  `CLOSED_NOT_MERGED == true` (no PR on the branch reached `state ==
  "MERGED"`, and at least one has `state == "CLOSED"` — meaning closed
  without landing, which could be queue-ejected, abandoned, or cancelled),
  additionally tag the branch as `closed_not_merged=true` for use in
  Phase 4. A branch with a mix of a `MERGED` PR and a `CLOSED` PR (e.g. one
  landed, an earlier attempt was abandoned) is excluded from this tag since
  the branch's work did land.
- `PR_COUNT == 0`: not a closed-PR candidate (may still be stale).
