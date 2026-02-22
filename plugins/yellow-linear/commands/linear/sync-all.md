---
name: linear:sync-all
description: "Audit open Linear issues and close ones with merged PRs. Use when you want to catch up on stale In Progress / In Review issues that were never transitioned to Done."
argument-hint: '[--team <name>]'
allowed-tools:
  - Bash
  - AskUserQuestion
  - ToolSearch
  - mcp__plugin_linear_linear__list_teams
  - mcp__plugin_linear_linear__list_issue_statuses
  - mcp__plugin_linear_linear__list_issues
  - mcp__plugin_linear_linear__get_issue
  - mcp__plugin_linear_linear__update_issue
---

# Linear Sync-All

Audit all open In Progress / In Review issues, check their associated PR status,
and propose bulk status transitions to keep Linear up to date.

## Workflow

### Step 1: Resolve Team

Parse `$ARGUMENTS` for `--team <name>`. If provided, call `list_teams` and match
by name (case-insensitive). If no match, show available teams via `AskUserQuestion`.

If `--team` not provided, auto-detect team from git remote:
```bash
git remote get-url origin 2>/dev/null | sed 's|.*/||' | sed 's|\.git$||'
```
Match the resulting repo name against team names from `list_teams`. If ambiguous,
prompt via `AskUserQuestion`.

### Step 1.5: Validate Prerequisites

```bash
gh auth status >/dev/null 2>&1 || {
  printf 'ERROR: gh CLI not authenticated. Run: gh auth login\n' >&2
  exit 1
}

REPO=$(git remote get-url origin 2>/dev/null | \
  sed 's|.*github\.com[:/]||' | sed 's|\.git$||')
if ! printf '%s' "$REPO" | grep -qE '^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$'; then
  printf '[sync-all] ERROR: Could not detect GitHub repo from git remote.\n' >&2
  printf '[sync-all] Use the --repo flag or run from a GitHub-remoted directory.\n' >&2
  exit 1
fi
```

### Step 2: Fetch Active Statuses Dynamically

Call `list_issue_statuses` for the resolved team. **Never hardcode status names.**
Filter to statuses whose `type` field is `started` or `inReview` (or equivalent
active-work types). Collect their `id` values for the issue query.

### Step 3: Fetch Open Issues in Active Statuses

Call `list_issues` with the resolved `teamId` and the active status IDs, limit 50.

If `pageInfo.hasNextPage` is true, warn: "More than 50 active issues found — only
the first 50 are shown. Run again after resolving these."

### Step 4: Check PR Status for Each Issue

For each issue, derive candidate branch names from `issue.identifier`:
- Lowercase the identifier (e.g., `ENG-123` → `eng-123`)
- Check for PRs with that identifier in the branch name, with error capture and
  200ms pacing between calls:

```bash
IDENTIFIER_LOWER=$(printf '%s' "$IDENTIFIER" | tr '[:upper:]' '[:lower:]')

# 200ms pacing between calls to avoid GitHub secondary rate limits
sleep 0.2

PR_JSON=$(gh pr list \
  --repo "$REPO" \
  --search "head:${IDENTIFIER_LOWER}" \
  --json number,state,mergedAt,title \
  --limit 5 2>&1) || {
  # Detect rate limit
  if printf '%s' "$PR_JSON" | grep -qi 'rate limit'; then
    printf '[sync-all] Rate limited — waiting 60s\n' >&2
    sleep 60
    PR_JSON=$(gh pr list --repo "$REPO" --search "head:${IDENTIFIER_LOWER}" \
      --json number,state,mergedAt,title --limit 5 2>&1) || {
      printf '[sync-all] ERROR: gh pr list failed for %s: %s\n' \
        "$IDENTIFIER" "$PR_JSON" >&2
      PR_JSON=""
    }
  else
    printf '[sync-all] ERROR: gh pr list failed for %s: %s\n' \
      "$IDENTIFIER" "$PR_JSON" >&2
    PR_JSON=""
  fi
}
```

If `PR_JSON` is empty after error handling, classify the issue as `gh-error`
and skip it from transition candidates (report in summary as "skipped — gh
error").

Classify each issue:
- **PR merged** (`state: MERGED` or `mergedAt` present) → propose transition to the
  status whose `type` is `completed` (Done equivalent)
- **PR closed without merge** (`state: CLOSED`, `mergedAt` null) → propose transition
  to `cancelled` or `backlog` type status; surface both options
- **PR open** (`state: OPEN`) → no change; note as "PR open, no action"
- **No PR found** → flag as "potentially stale — no associated PR"; surface to user
  but make no suggestion

### Step 5: Present Proposed Transitions

Display a table summarising findings:

```
Issue       Title                     Current Status   PR Status    Proposed
──────────  ────────────────────────  ───────────────  ───────────  ────────
ENG-123     Add auth flow             In Progress      Merged       → Done
ENG-124     Fix login bug             In Review        Open         (no change)
ENG-125     Refactor parser           In Progress      (none)       ⚠ Stale
```

If there are zero proposed transitions, report and exit.

Use `AskUserQuestion` — "Apply these N transition(s)? [Yes — apply all / Select
individually / Cancel]"

For batches > 5 issues with transitions: mandatory confirmation must show the
count and list before proceeding.

### Step 6: Apply Transitions (H1 TOCTOU + Rate Limiting)

For each issue to update:

1. **Re-fetch** via `get_issue` (H1: verify status still matches what was shown
   in Step 5 — another process may have updated it)
2. If current status no longer matches what was displayed: skip this issue, add
   to "conflict" list
3. **Apply** `update_issue` with the new `stateId`
4. Delay 200ms between writes; on 429 or transient 5xx error from the Linear
   API: exponential backoff 1s → 2s → 4s, max 3 retries

### Step 7: Report Results

Display final summary:

```
Sync complete
─────────────────────────────────────
Transitioned:  N issues
Conflicts:     N issues (state changed before update — skipped)
No PR found:   N issues (potentially stale — review manually)
PR open:       N issues (no action taken)
gh errors:     N issues (skipped — check gh auth or network)
```

For any conflicts, list the issue identifiers and their current status so the
user can handle them manually.

## Security Patterns

- **C1**: `get_issue` re-fetch before each `update_issue` (H1 TOCTOU)
- **M3**: Explicit `AskUserQuestion` confirmation before any writes
- No hardcoded status names — always fetch dynamically via `list_issue_statuses`

## Error Handling

| Error | Action |
|-------|--------|
| `gh` not authenticated | Exit at Step 1.5: "Run `gh auth login` first" |
| No GitHub remote found | Exit at Step 1.5 with message |
| Team not found | Show available teams, prompt to re-run |
| 429 rate limit or transient 5xx | Exponential backoff (1s, 2s, 4s), max 3 retries |
| Issue not found on re-fetch | Skip, add to conflict list |
| 0 active issues | Report "All issues up to date" and exit |
