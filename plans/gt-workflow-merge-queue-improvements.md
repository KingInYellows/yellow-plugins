# Feature: gt-workflow Merge Queue Improvements

## Problem Statement

The Graphite merge-queue research (`docs/research/graphite-merge-queue-stacked-prs-coding-agents.md`) surfaced two platform-level gaps in the existing `gt-workflow` plugin that affect every Graphite user — not just users of Graphite's optional merge queue:

1. **Silent incompatibility with GitHub native merge queue.** Graphite and GitHub's native merge queue are explicitly documented as incompatible (research §3). Running both causes Graphite to restart CI on all queued commits and may produce out-of-order merges. `gt-setup` does not detect or warn about this today.
2. **Silent data loss in `gt-cleanup` when a PR was closed without merging.** The cleanup command currently treats "all PRs closed or merged" as a single deletion candidate. A queue-ejected PR (or any PR closed without landing) is indistinguishable from a merged PR — the user can lose unique commits without realizing.

Both fixes are additive, low-risk, and unlock value for all Graphite users without coupling the base plugin to queue-state-aware logic (which lives in the future `gt-merge-queue` add-on per the brainstorm boundary decision).

## Current State

- **`gt-setup`** (`plugins/gt-workflow/commands/gt-setup.md`): Phase 1 runs a single Bash block emitting key-value diagnostics under section headers (`=== Prerequisites ===`, `=== Repository ===`, `=== Graphite Auth ===`, `=== Convention Files ===`). No GitHub branch-protection introspection.
- **`gt-cleanup`** (`plugins/gt-workflow/commands/gt-cleanup.md`): Phase 2.4 runs `gh pr list --repo "$REPO" --head "$BRANCH_NAME" --state all --json state --limit 100`. Classifies as "Closed PR" candidate when **all** PRs are `CLOSED` or `MERGED`. No distinction between merged and closed-without-merge.
- **Conventional-commit `!` regex**: Already correct in `plugins/gt-workflow/hooks/check-commit-message.sh:52` (pattern includes `!?:`). No change needed.

## Proposed Solution

Two additive edits, each contained to one command file.

### Change 1 — `gt-setup` native merge queue advisory

Add a new check after the existing Convention Files section in Phase 1's Bash block. Detect whether GitHub's repo-level merge queue is configured. Emit a soft advisory matching the existing `yq: NOT FOUND` severity. Fail-open on any error.

**Detection mechanism (open question 5 resolution):** GitHub's REST and GraphQL APIs do **not** expose "merge queue enabled at branch protection rule level" — confirmed via [GitHub community discussion #170601](https://github.com/orgs/community/discussions/170601). The only available signal is the **repo-level** `repository.mergeQueue` GraphQL field. If the repo has a merge queue configured (regardless of which branch protection rule references it), this object is non-null. We use that as the proxy: non-null `mergeQueue` → likely conflict with Graphite.

This is an imperfect signal — a stale/unused queue config could still register — but it matches the brainstorm's "soft advisory, fail-open" intent. The warning text explicitly tells the user to check + disable; we don't claim certainty.

### Change 2 — `gt-cleanup` closed-not-merged guard

Add `mergedAt` to the existing `gh pr list --json` call (so the call requests `state,mergedAt`). Tag any branch in the Closed PR category whose PR set includes any with `state == "CLOSED"` as `closed-not-merged`. `gh pr list --json` (GraphQL-backed) represents merged PRs with `state == "MERGED"` and closed-without-merging PRs with `state == "CLOSED"`, so the state enum alone is unambiguous — no `merged` boolean check is needed. The propagation-lag concern documented in `merge-queue-closed-pr-null-mergedat-detection.md` applies to per-PR REST calls (`gh api repos/.../pulls/{number}`) where `merged: bool` is exposed; `gh pr list --json` does not accept a `merged` field at all (valid fields include `state`, `mergedAt`, `mergedBy`, `mergeCommit`, `closed`, `closedAt`, but not a standalone `merged`). `mergedAt` is requested for display use (timestamp shown in per-branch detail), not for classification. Surface the result in two places:

<!-- deepen-plan: codebase -->
> **Codebase:** The `--json state,mergedAt` pattern is already established in `plugins/yellow-core/commands/worktree/cleanup.md` and `plugins/yellow-linear/commands/linear/sync-all.md`. Change 2 follows existing conventions exactly — no new pattern is being introduced here.
<!-- /deepen-plan -->

- **"Delete all" mode:** prepend the existing data-loss warning with a count line: "N of these branches had PRs closed without merging (may be queue-ejected, abandoned, or cancelled)."
- **"Review individually" mode:** add `PR status: closed (no merge — verify before deleting)` to the per-branch detail block. The existing AskUserQuestion serves as the confirmation step.

No `queue-ejected` label reading. No new API calls. One extra JSON field in an existing call.

## Implementation Plan

### Phase 1: gt-setup native queue advisory

- [ ] **1.1** Append a new `=== Merge Queue Compatibility ===` section to the Phase 1 Bash block in `plugins/gt-workflow/commands/gt-setup.md` (between current "Convention Files" and the Step 2 interpretation).
- [ ] **1.2** Implement the GraphQL detection. Use `gh api graphql` with a query for `repository(owner, name) { mergeQueue { url } }`. Repo identifier comes from `gh repo view --json nameWithOwner -q .nameWithOwner` (same idiom already used in `gt-cleanup` line 170). Fail-open on any non-zero exit, missing auth, or parse error.
- [ ] **1.3** Emit one of three lines based on result. Use **one space** after the colon to match the surrounding 16-char alignment zone (`=== Repository ===` and `=== Convention Files ===` sections):
  - Queue detected: `gh_native_queue: WARNING — GitHub native merge queue is configured for this repo. Graphite and GitHub native queue are incompatible; running both causes CI restarts and may produce out-of-order merges. Disable at: https://github.com/<repo>/settings/branches`
  - Queue not detected: `gh_native_queue: ok (not configured)`
  - Could not check: `gh_native_queue: COULD NOT CHECK (gh auth or API unavailable)`

<!-- deepen-plan: codebase -->
> **Codebase:** Two distinct column-alignment zones exist in `gt-setup.md` Phase 1 — Prerequisites/Auth use 15-char keys (`gt:`, `mcp_server:`, `jq:`, `yq:`), Repository/Convention use 16-char keys (`git_repo:`, `repo_config:`, `gt_trunk:`, `auth_config:`, `graphite_yml:`, `pr_template:`). The new `=== Merge Queue Compatibility ===` section sits between Convention Files and Step 2, so it should match the 16-char zone. Key `gh_native_queue` (15 chars) + `:` + one space = 17, slightly long but visually consistent. Original draft had two spaces (total 18) — corrected here. Precedent: `yellow-review/commands/review/setup.md:28` uses `gh_auth: ok` for similar GitHub-related diagnostics.
<!-- /deepen-plan -->
- [ ] **1.4** Update Step 2 interpretation: add `gh_native_queue` WARNING to the Warnings list, with the consequence statement and disable link. Soft advisory only — never blocks.

### Phase 2: gt-cleanup closed-not-merged guard

- [ ] **2.1** Update the `gh pr list` invocation in Phase 2.4 of `plugins/gt-workflow/commands/gt-cleanup.md` (line 180-182): change `--json state` to `--json state,mergedAt`. `mergedAt` is for display only (timestamp shown in per-branch detail). `gh pr list --json` does not accept a `merged` field, so classification relies on the `state` enum directly.
- [ ] **2.2** Update the parse-and-classify logic in Phase 2.4 with a concrete jq pipeline (so the LLM-as-runtime does not infer the parse): when classifying as "Closed PR" candidate (all PRs `CLOSED` or `MERGED`), additionally check whether any PR has `state == "CLOSED"` (since `gh pr list` represents merged PRs as `state == "MERGED"`, `CLOSED` alone is the closed-without-merging signal). If so, set a `closed_not_merged=true` flag on the branch. Also explicitly exclude `[gone]`-tracked branches from the PR Status Lookups gate so the tag does not fire on branches already routed to `/gt-sync`.
- [ ] **2.3** Update Phase 4 "Delete all" path for the Closed PR category: if any branches have `closed_not_merged=true`, prepend the existing data-loss warning block with: `N of these branches had PRs closed without merging (may be queue-ejected, abandoned, or cancelled). Verify before proceeding.`
- [ ] **2.4** Update Phase 4 "Review individually" path: for each `closed_not_merged=true` branch, add a `PR status: closed (no merge — verify before deleting)` line to the per-branch detail block (between the existing "Unique commits" and "Age" lines).

### Phase 3: Quality

- [ ] **3.1** Manual smoke test on a real repo:
  - Run `/gt-setup` on a repo with no native queue → confirm `gh_native_queue: ok (not configured)`.
  - Run `/gt-setup` on a repo with native queue enabled → confirm the WARNING line appears with the disable link.
  - Run `/gt-setup` with `gh` unauthenticated → confirm `COULD NOT CHECK` line, setup continues without blocking.
  - Run `/gt-cleanup` with a closed-not-merged PR present → confirm the warning appears in both Delete-all and Review-individually paths.
- [ ] **3.2** Run `pnpm validate:schemas` to confirm both edited command files still validate.
- [ ] **3.3** Run `pnpm changeset` and select `patch` for `gt-workflow` (additive, non-breaking).
- [ ] **3.4** Update `plugins/gt-workflow/CLAUDE.md` only if the changes affect the documented command behavior contract (likely just `gt-cleanup`'s "Closed PR" classification description). Skip if no contract change.

## Technical Details

### Files to Modify

- `plugins/gt-workflow/commands/gt-setup.md` — append new section to Phase 1 Bash block + new entry in Step 2 Warnings list
- `plugins/gt-workflow/commands/gt-cleanup.md` — `--json` field addition, classification flag, two display additions

### Files to Create

- `.changeset/<auto-named>.md` — `gt-workflow: patch` describing both changes

### Detection Snippet (Phase 1.2)

```bash
printf '\n=== Merge Queue Compatibility ===\n'
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  repo_nwo=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)
  if [ -n "$repo_nwo" ]; then
    repo_owner="${repo_nwo%/*}"
    repo_name="${repo_nwo#*/}"
    # shellcheck disable=SC2016
    mq_check=$(gh api graphql -f query='
      query($owner:String!,$name:String!){
        repository(owner:$owner,name:$name){ mergeQueue { url } }
      }' -f owner="$repo_owner" -f name="$repo_name" --jq '.data.repository.mergeQueue.url // empty' 2>/dev/null) \
      || printf '[gt-workflow] Warning: merge queue check failed (gh api graphql)\n' >&2
    if [ -n "$mq_check" ]; then
      printf 'gh_native_queue: WARNING — GitHub native merge queue is configured for this repo. Graphite and GitHub native queue are incompatible; running both causes CI restarts and may produce out-of-order merges. Disable at: https://github.com/%s/settings/branches\n' "$repo_nwo"
    elif [ -z "$mq_check" ] && [ "$?" -eq 0 ]; then
      printf 'gh_native_queue: ok (not configured)\n'
    else
      printf 'gh_native_queue: COULD NOT CHECK (gh api graphql failed)\n'
    fi
  else
    printf 'gh_native_queue: COULD NOT CHECK (gh repo view returned no name)\n'
  fi
else
  printf 'gh_native_queue: COULD NOT CHECK (gh not authenticated or not installed)\n'
fi
```

Note the `--jq '.data.repository.mergeQueue.url // empty'` filter: returns the URL string when the merge queue object exists, or empty string when null. Tested via `[ -n "$mq_check" ]`.

<!-- deepen-plan: codebase -->
> **Codebase:** This is the **first** `gh api graphql` invocation in the plugins tree. No existing template — this snippet establishes the convention. Two patterns adopted from MEMORY.md "GitHub GraphQL Shell Patterns" (PR #9): (1) `# shellcheck disable=SC2016` on a separate line above the query string for the GraphQL `$owner`/`$name` variables, (2) `|| printf '[gt-workflow] Warning: ...' >&2` for visibility per the error-logging rule rather than silently suppressing via `2>/dev/null` alone. The `gh auth status` soft-skip pattern matches `plugins/yellow-core/commands/worktree/cleanup.md:74` and `plugins/yellow-browser-test/agents/testing/test-reporter.md:59`.
<!-- /deepen-plan -->

### Dependencies

- `gh` CLI — already a hard dependency in `gt-cleanup` and a soft dependency in `gt-setup` (auth check). No new dependency added.

## Acceptance Criteria

1. `/gt-setup` on a repo without a native merge queue prints `gh_native_queue: ok (not configured)` and proceeds normally.
2. `/gt-setup` on a repo with a native merge queue configured prints the `WARNING` line including the GitHub branch settings URL, and continues to Phase 2 without blocking.
3. `/gt-setup` with `gh` unauthenticated or absent prints `COULD NOT CHECK` and continues without blocking.
4. `/gt-cleanup` with one or more closed-not-merged branches in the Closed PR category shows the count warning before the data-loss block in "Delete all" mode.
5. `/gt-cleanup` with closed-not-merged branches in Review individually mode shows `PR status: closed (no merge — verify before deleting)` for those specific branches only.
6. `/gt-cleanup` with only merged branches in the Closed PR category behaves identically to today (no new warning text).
7. Existing `pnpm validate:schemas` passes against the modified command files.
8. A `gt-workflow: patch` changeset is created describing both additions.

## Edge Cases & Error Handling

- **`gh api graphql` returns malformed JSON or partial data:** the `--jq` filter falls through to empty string, treated as "not configured." Acceptable — fail-open is the documented stance.
- **Repo has merge queue configured but it's stale/unused:** WARNING fires anyway. The text says "may produce" not "will produce" — acceptable false-positive given the disable link is one click.
- **Branch has a PR with `state == "CLOSED"` but the user genuinely wants to delete (e.g., they ran an experiment):** the warning is informational. Existing AskUserQuestion gives them the choice. No new blocking step.
- **Multiple PRs per branch (rare but possible):** the classification rule is "any PR with `state == "CLOSED"`" — a single non-merged close is enough to flag. Conservative.
- **CRLF on WSL2:** these are command `.md` edits, not new shell scripts. No CRLF stripping needed beyond normal commit hygiene.
- **`gt-cleanup` rate-limit branch:** if the existing rate-limit fallback has already marked PR-data as incomplete, the `closed_not_merged` flag is also incomplete. Document that the warning depends on PR data being fetched successfully.

## References

- `docs/brainstorms/2026-04-30-gt-workflow-merge-queue-improvements-brainstorm.md` — full Q&A and rejected alternatives
- `docs/research/graphite-merge-queue-stacked-prs-coding-agents.md` — sections §3 (Graphite/GitHub queue incompatibility), §7 (plugin design recommendations)
- `docs/solutions/integration-issues/graphite-github-native-queue-incompatibility.md` — institutional knowledge on the incompatibility
- `docs/solutions/integration-issues/merge-queue-closed-pr-null-mergedat-detection.md` — the 3-path `mergedAt: null` semantics underlying Change 2
- `plugins/gt-workflow/commands/gt-setup.md` — current Phase 1 structure
- `plugins/gt-workflow/commands/gt-cleanup.md` — current Phase 2/4 structure
- [GitHub community #170601](https://github.com/orgs/community/discussions/170601) — confirms the API gap that motivates the GraphQL `mergeQueue` proxy detection

<!-- deepen-plan: external -->
> **Research:** GitHub's REST and GraphQL APIs do not expose a per-branch-protection-rule "merge queue enabled" field, per [community discussion #170601](https://github.com/orgs/community/discussions/170601) (Nov 2025). The only available signal is the repository-level `repository.mergeQueue` GraphQL object — non-null when a queue is configured for any branch in the repo. Schema: `mergeQueue { url, entries, ... }`. The plan's `mergeQueue { url }` query returns the URL when configured, null otherwise. The detection is a coarse proxy at the repo level, not the trunk-branch level — acceptable because the warning text says "may produce" not "will produce" and the disable link is a one-click fix.
<!-- /deepen-plan -->
