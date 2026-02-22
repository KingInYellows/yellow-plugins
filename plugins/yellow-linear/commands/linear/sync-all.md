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
- Check for PRs with that identifier in the branch name:

```bash
IDENTIFIER_LOWER=$(echo "$IDENTIFIER" | tr '[:upper:]' '[:lower:]')
gh pr list \
  --search "head:${IDENTIFIER_LOWER}" \
  --json number,state,mergedAt,title \
  --limit 5 2>/dev/null
```

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
4. Delay 200ms between writes; on 429 response: exponential backoff 1s → 2s → 4s,
   max 3 retries

### Step 7: Report Results

Display final summary:

```
Sync complete
─────────────────────────────────────
Transitioned:  N issues
Conflicts:     N issues (state changed before update — skipped)
No PR found:   N issues (potentially stale — review manually)
PR open:       N issues (no action taken)
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
| `gh` not authenticated | Exit: "Run `gh auth login` first" |
| Team not found | Show available teams, prompt to re-run |
| 429 rate limit | Exponential backoff (1s, 2s, 4s), max 3 retries |
| Issue not found on re-fetch | Skip, add to conflict list |
| 0 active issues | Report "All issues up to date" and exit |
