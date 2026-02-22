---
name: debt:sync
description: "Push accepted debt findings to Linear as issues. Use when you want to track technical debt in Linear."
argument-hint: '[--team <name>] [--project <name>]'
allowed-tools:
  - Bash
  - AskUserQuestion
  - ToolSearch
  - mcp__plugin_linear_linear__list_teams
  - mcp__plugin_linear_linear__list_projects
  - mcp__plugin_linear_linear__list_issues
  - mcp__plugin_linear_linear__list_issue_labels
  - mcp__plugin_linear_linear__create_issue
  - mcp__plugin_linear_linear__create_issue_label
---

# Technical Debt Linear Sync

Push accepted technical debt findings to Linear as issues with idempotent sync
and rollback support.

## Requirements

- **yellow-linear plugin** must be installed
- `yq` must be available (`command -v yq`)

## Arguments

- `--team <name>` — Override Linear team (case-insensitive name match)
- `--project <name>` — Override Linear project (name match within the team)

## Workflow

### Step 1: Graceful Degradation Check

Call `list_teams`. If the tool is unavailable (yellow-linear not installed), stop
immediately:

```
yellow-linear is not installed. Install it first:
  /plugin marketplace add KingInYellows/yellow-plugins yellow-linear
```

### Step 2: Parse Arguments

```bash
command -v yq >/dev/null 2>&1 || {
  printf 'ERROR: yq is required. Install: brew install yq / pip install yq\n' >&2
  exit 1
}

TEAM_OVERRIDE=""
PROJECT_OVERRIDE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --team)
      if [ -z "${2:-}" ] || printf '%s' "${2:-}" | grep -q '^--'; then
        printf 'ERROR: --team requires a value\n' >&2; exit 1
      fi
      TEAM_OVERRIDE="$2"; shift 2 ;;
    --project)
      if [ -z "${2:-}" ] || printf '%s' "${2:-}" | grep -q '^--'; then
        printf 'ERROR: --project requires a value\n' >&2; exit 1
      fi
      PROJECT_OVERRIDE="$2"; shift 2 ;;
    *) printf 'ERROR: Unknown argument "%s"\n' "$1" >&2; exit 1 ;;
  esac
done
```

Validate that overrides contain only alphanumeric, spaces, and hyphens (max 100
chars). Reject anything that doesn't match `^[a-zA-Z0-9 -]{1,100}$`. Also
reject values with leading or trailing spaces, or multiple consecutive spaces
(use `echo "$VALUE" | grep -qE '^ | $|  '` to detect).

### Step 3: Resolve Team

Use the `list_teams` response from Step 1.

- If `--team` was provided: match by case-sensitive exact match. If no match,
  show available team names via `AskUserQuestion` and let the user select one.
- If `--team` not provided: check `.debt/linear-config.json` for a stored
  `team_id` and `team_name`. If found and valid, use it. If not found, show teams
  via `AskUserQuestion`.

Extract and store `TEAM_ID` and `TEAM_NAME`.

### Step 4: Resolve Project

Call `list_projects` filtered by `TEAM_ID`.

- If `--project` was provided: match case-insensitively. If no match, show
  available project names via `AskUserQuestion`.
- If `--project` not provided: check config for `project_id`/`project_name`. If
  not found, show projects via `AskUserQuestion`. If no projects exist, proceed
  without a project (issue will be unassigned to a project).

Extract and store `PROJECT_ID` (may be empty).

### Step 5: Write / Update Config

```bash
CONFIG_FILE=".debt/linear-config.json"
mkdir -p .debt

jq -n \
  --arg team_id "$TEAM_ID" \
  --arg team_name "$TEAM_NAME" \
  --arg project_id "${PROJECT_ID:-}" \
  --arg project_name "${PROJECT_NAME:-}" \
  '{team_id: $team_id, team_name: $team_name, project_id: $project_id, project_name: $project_name}' \
  > "$CONFIG_FILE"
```

### Step 6: Resolve "technical-debt" Label

Call `list_issue_labels` for `TEAM_ID`. Search for a label named exactly
`technical-debt`.

- **If found**: store its `id` as `DEBT_LABEL_ID`.
- **If not found**: use `AskUserQuestion` — "No 'technical-debt' label found in
  Linear. [Create it / Choose existing / Skip labels]"
  - **Create it**: Call `create_issue_label` with `name: "technical-debt"`,
    `color: "#F59E0B"`, `teamId: TEAM_ID`. Store the new label `id`.
  - **Choose existing**: Show available labels via `AskUserQuestion`, store
    selected `id`.
  - **Skip labels**: Set `DEBT_LABEL_ID=""` and continue without labelling.

### Step 7: Find Unsynced Findings

```bash
# shellcheck disable=SC2154
# Source shared validation helpers
. "${CLAUDE_PLUGIN_ROOT}/lib/validate.sh"

if [ ! -d "todos/debt" ]; then
  printf '[sync] WARNING: todos/debt/ directory not found. Run /debt:audit first.\n' >&2
  exit 0
fi

TODOS_TO_SYNC=()
while IFS= read -r -d '' todo_file; do
  validate_file_path "$todo_file" || {
    printf '[sync] ERROR: Invalid path skipped: %s\n' "$todo_file" >&2
    continue
  }
  existing_id=$(extract_frontmatter "$todo_file" | yq -r '.linear_issue_id // ""')
  if [ -z "$existing_id" ]; then
    TODOS_TO_SYNC+=("$todo_file")
  fi
done < <(find todos/debt -name '*-ready-*.md' -print0)

if [ ${#TODOS_TO_SYNC[@]} -eq 0 ]; then
  printf 'No findings to sync (all ready findings already synced).\n'
  exit 0
fi

printf '[sync] Found %d finding(s) to sync\n' "${#TODOS_TO_SYNC[@]}"
```

### Step 7.5: Pre-flight Confirmation (M3)

Before syncing, show the user what will be created:

Use `AskUserQuestion` — "Ready to create N Linear issue(s) in TEAM_NAME:
  [list of titles, max 5 shown, then '... and N more']

[Proceed / Cancel]"

If Cancel: exit without creating any issues.

### Step 8: Sync Each Finding

For each file in `TODOS_TO_SYNC`:

**8a. Extract frontmatter fields (single yq call):**
```bash
FRONTMATTER=$(extract_frontmatter "$todo_file") || {
  printf '[sync] ERROR: Failed to read frontmatter from %s\n' "$todo_file" >&2
  ERROR_COUNT=$((ERROR_COUNT + 1))
  continue
}
# shellcheck disable=SC2154
eval "$(printf '%s' "$FRONTMATTER" | yq -r '@sh "
  TODO_ID=\(.id // \"\")
  TITLE=\(.title // \"Untitled\")
  CATEGORY=\(.category // \"\")
  SEVERITY=\(.severity // \"\")
  DESCRIPTION=\(.description // \"\")
"')" || {
  printf '[sync] ERROR: yq parse failed for %s\n' "$todo_file" >&2
  ERROR_COUNT=$((ERROR_COUNT + 1))
  continue
}
```

**8b. Dedup check — call `list_issues`** filtered by `DEBT_LABEL_ID` (if set) and
`teamId: TEAM_ID`, limit 50. Scan results for an issue whose `title` exactly
matches `TITLE`. If found:
- Store its `id` as `ISSUE_ID`
- Validate `ISSUE_ID` is non-empty before write-back
- Write it back via `update_frontmatter "$todo_file" '.linear_issue_id' "$ISSUE_ID"`
- Log as "already exists — linked"
- Continue to next finding (skip creation)

Warn if `list_issues` returns exactly 50 results (pagination limit may hide
existing issues):
```bash
if [ "$ISSUE_COUNT" -ge 50 ]; then
  printf '[sync] WARNING: Dedup search hit 50-issue limit — duplicates may exist\n' >&2
fi
```

**8c. Map severity to priority integer:**
```bash
case "$SEVERITY" in
  critical) PRIORITY=1 ;;
  high)     PRIORITY=2 ;;
  medium)   PRIORITY=3 ;;
  low)      PRIORITY=4 ;;
  *)        PRIORITY=0 ;; # No priority
esac
```

**8d. Create issue** — Call `create_issue` with:
- `title`: `TITLE`
- `description`: Full markdown description built from `DESCRIPTION` + category +
  severity context
- `teamId`: `TEAM_ID`
- `projectId`: `PROJECT_ID` (omit if empty)
- `labelIds`: `[DEBT_LABEL_ID]` (omit if empty)
- `priority`: `PRIORITY`

On failure: retry up to 3 times with exponential backoff (1s, 2s, 4s). On 429
or HTTP 5xx: treat as transient and use backoff. After 3 failures, record as
error and continue to next finding (do not exit).

**8e. Write back to frontmatter:**

Extract `id` from the `create_issue` response, then validate before writing:
```bash
ISSUE_ID=$(printf '%s' "$CREATE_RESPONSE" | jq -r '.id // empty')
if [ -z "$ISSUE_ID" ]; then
  printf '[sync] ERROR: create_issue returned no ID for: %s\n' "$TITLE" >&2
  ERROR_COUNT=$((ERROR_COUNT + 1))
  continue
fi
update_frontmatter "$todo_file" '.linear_issue_id' "$ISSUE_ID"
```

Record in `CREATED_ISSUES` array for rollback support.

Log: `[sync] Created Linear issue TEAM-123: TITLE`

### Step 9: Rollback on Partial Failure

If `ERROR_COUNT > 0` and `CREATED_ISSUES` is non-empty, use `AskUserQuestion`:

"Sync completed with errors. Created N issue(s) successfully, failed M finding(s).

Note: Linear MCP does not support issue deletion. Created issues cannot be
automatically rolled back — they must be deleted manually in the Linear UI.

[View created issues / Show failed findings / Done]"

- **View created issues**: List each created issue title and its Linear URL
  (derived from `identifier`: `https://linear.app/team/issue/IDENTIFIER`)
- **Show failed findings**: List file paths of findings that failed to sync

### Step 10: Final Summary

```
═══════════════════════════════════════
Linear Debt Sync Complete
═══════════════════════════════════════
Synced (new):       N findings
Already linked:     N findings
Failed:             N findings
───────────────────────────────────────
Team:     TEAM_NAME
Project:  PROJECT_NAME (or "none")
Label:    technical-debt (or "none")
═══════════════════════════════════════
```

## Idempotency

Re-running sync is safe:
1. Findings with `linear_issue_id` in frontmatter are skipped
2. Findings without `linear_issue_id` are dedup-checked by title via `list_issues`
3. If a match is found, the existing issue is linked — no duplicate created

## Error Handling

| Error | Action |
|-------|--------|
| yellow-linear not installed | Exit at Step 1 with install instructions |
| `yq` not available | Exit: "Install yq: `brew install yq` or `pip install yq`" |
| Team not found | Show available teams via `AskUserQuestion` |
| 429 rate limit or HTTP 5xx | Exponential backoff 1s → 2s → 4s, retry max 3 times |
| Issue creation failure | Record error, continue; offer rollback summary at end |
| Frontmatter update failure | Log warning, issue exists in Linear but todo is not linked |
