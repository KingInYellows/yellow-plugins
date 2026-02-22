---
name: ci:report-linear
description: "Diagnose a CI failure and create a Linear bug issue. Use when CI has failed and you want to track the fix in Linear. Requires yellow-linear to be installed."
argument-hint: '[run-id] [--repo owner/name]'
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
  - Task
  - ToolSearch
  - mcp__plugin_linear_linear__list_teams
  - mcp__plugin_linear_linear__list_issues
  - mcp__plugin_linear_linear__list_issue_labels
  - mcp__plugin_linear_linear__create_issue
  - mcp__plugin_linear_linear__create_issue_label
---

# CI Report to Linear

Diagnose a CI failure and file it as a Linear bug issue with full context.

## Requirements

- **yellow-linear plugin** must be installed
- `gh` CLI authenticated (`gh auth status`)

## Arguments

- `[run-id]` — GitHub Actions run ID (optional; defaults to latest failed run)
- `[--repo owner/name]` — Target repo (optional; defaults to current git remote)

## Workflow

### Step 1: Graceful Degradation Check

Call `list_teams`. If the tool is unavailable (yellow-linear not installed), stop:

```
yellow-linear is not installed. Install it first:
  /plugin marketplace add KingInYellows/yellow-plugins yellow-linear
```

### Step 2: Validate Prerequisites

```bash
gh auth status >/dev/null 2>&1 || {
  printf 'ERROR: gh CLI not authenticated. Run: gh auth login\n' >&2
  exit 1
}
```

### Step 3: Resolve Repo and Run ID

Parse `$ARGUMENTS`:
- If `--repo owner/name` is present: validate format `^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$`,
  use it. Otherwise auto-detect from git remote:
  ```bash
  REPO=$(git remote get-url origin 2>/dev/null | \
    sed 's|.*github\.com[:/]||' | sed 's|\.git$||')
  if ! printf '%s' "$REPO" | grep -qE '^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$'; then
    printf 'ERROR: Could not detect GitHub repo from git remote.\n' >&2
    printf 'Use: /ci:report-linear --repo owner/name\n' >&2
    exit 1
  fi
  ```
- If a run ID is present in `$ARGUMENTS` (matches `^[1-9][0-9]{0,19}$`): use it.
  Otherwise, fetch the latest failed run:
  ```bash
  gh run list --repo "$REPO" --status failure --limit 1 --json databaseId \
    --jq '.[0].databaseId // empty'
  ```
  If no failed run found: "No recent failed runs found. Run with an explicit
  run ID." and exit.

### Step 4: Resolve Team

Use the `list_teams` response from Step 1. Auto-detect from git remote repo name
(case-sensitive exact match against team names). If no match, prompt via
`AskUserQuestion`.

### Step 5: Diagnose via failure-analyst Agent

Delegate to the `failure-analyst` agent via Task:

```
Task subagent_type: "failure-analyst"
Pass: run ID, repo, branch (from git branch --show-current)
Receive: structured failure report including:
  - F-code (F01–F12)
  - Root cause summary
  - Failed workflow name
  - Failed step name
  - Truncated error output (max 500 chars)
  - Suggested fix
```

Wait for the agent to complete and collect its report. Apply fallback defaults
for any missing fields:
```bash
WORKFLOW_NAME="${WORKFLOW_NAME:-unknown-workflow}"
STEP_NAME="${STEP_NAME:-unknown-step}"
F_CODE="${F_CODE:-F00}"
ROOT_CAUSE="${ROOT_CAUSE:-CI failure — investigation needed}"
ERROR_OUTPUT="${ERROR_OUTPUT:-No error output captured}"
```

If all key fields are empty (total agent failure):
```bash
if [ "$WORKFLOW_NAME" = "unknown-workflow" ] && [ "$F_CODE" = "F00" ] && \
   [ "$ROOT_CAUSE" = "CI failure — investigation needed" ]; then
  printf 'ERROR: failure-analyst returned empty report. CI diagnosis failed.\n' >&2
  printf 'Try: /ci:diagnose %s to manually investigate.\n' "$RUN_ID" >&2
  exit 1
fi
```

### Step 6: Resolve "ci-failure" Label

Call `list_issue_labels` for the team. Search for a label named `ci-failure`.

- **If found**: store its `id` as `CI_LABEL_ID`.
- **If not found**: use `AskUserQuestion` — "No 'ci-failure' label in Linear.
  [Create it / Skip label]"
  - **Create it**: Call `create_issue_label` with `name: "ci-failure"`,
    `color: "#EF4444"`, `teamId: TEAM_ID`. Store the returned `id`.
  - **Skip label**: Set `CI_LABEL_ID=""`.

### Step 7: Check for Existing Issue (Dedup)

Now that the workflow name is known from Step 5 and `CI_LABEL_ID` is resolved,
call `list_issues` for the resolved team. Filter by open status and
`labelIds: [CI_LABEL_ID]` (if set). Search for any issue whose title contains
`WORKFLOW_NAME`.

If a duplicate is found: display the existing issue identifier and URL, then stop:

```
An open ci-failure issue already exists for this workflow:
  ENG-456: fix(ci): deploy-prod failing — Exit code 1
  https://linear.app/team/issue/ENG-456

To file a new issue anyway, re-run with the run ID explicitly.
```

### Step 8: Propose Issue to User (M3)

Build and display the proposed Linear issue:

```
Title: fix(ci): <workflow name> failing — <F-code root cause>

Description:
## CI Failure Report

**Run:** <run URL>
**Workflow:** <name>
**Branch:** <branch>
**Failed step:** <step name>
**Pattern:** <F-code>

### Root Cause
<failure-analyst summary (max 500 chars)>

### Error Output
<truncated error output (max 1000 chars)>

### Suggested Fix
<failure-analyst recommendation>
```

Use `AskUserQuestion` — "Create this Linear issue? [Yes / Edit title / Cancel]"

- **Edit title**: Prompt for a new title, then confirm and proceed.
- **Cancel**: Exit without creating.

### Step 9: Create Issue

Call `create_issue` with:
- `title`: proposed or edited title
- `description`: full markdown body from Step 8
- `teamId`: `TEAM_ID`
- `labelIds`: `[CI_LABEL_ID]` (omit if empty)
- `priority`: 2 (High — CI failures are high priority by default)

### Step 10: Report

Display result:

```
✓ Linear issue created: ENG-789 — fix(ci): deploy-prod failing — Exit code 1
  https://linear.app/team/issue/ENG-789

To delegate implementation to Devin, run:
  /linear:delegate ENG-789
```

## Error Handling

| Error | Action |
|-------|--------|
| yellow-linear not installed | Exit at Step 1 with install instructions |
| `gh` not authenticated | Exit with `gh auth login` instruction |
| No failed run found | Exit with message, suggest explicit run ID |
| failure-analyst returns no F-code | Use generic title "CI failure — investigation needed" |
| 429 rate limit on `create_issue` | Exponential backoff 1s → 2s → 4s, max 3 retries |
