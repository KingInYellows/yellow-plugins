---
name: ci:report-linear
description: "Diagnose a CI failure and create a Linear bug issue. Use when CI has failed and you want to track the fix in Linear. Requires yellow-linear to be installed."
argument-hint: '[run-id] [--repo owner/name]'
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
  - Task
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
  git remote get-url origin 2>/dev/null | sed 's|.*github\.com[:/]||' | sed 's|\.git$||'
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
(match case-insensitively against team names). If ambiguous or no match, prompt
via `AskUserQuestion`.

### Step 5: Check for Existing Issue (Dedup)

Call `list_issues` for the resolved team. Filter by open status. Search for any
issue whose title contains the workflow name (extracted in Step 6 after diagnosis
— re-apply this step after Step 6 if the workflow name is not known yet).

If a duplicate is found: display the existing issue identifier and URL, then stop:

```
An open ci-failure issue already exists for this workflow:
  ENG-456: fix(ci): deploy-prod failing — Exit code 1
  https://linear.app/team/issue/ENG-456

To file a new issue anyway, re-run with the run ID explicitly.
```

### Step 6: Diagnose via failure-analyst Agent

Delegate to the `failure-analyst` agent via Task:

```
Task subagent_type: "compound-engineering" (use failure-analyst)
Pass: run ID, repo, branch (from git branch --show-current)
Receive: structured failure report including:
  - F-code (F01–F12)
  - Root cause summary
  - Failed workflow name
  - Failed step name
  - Truncated error output (max 500 chars)
  - Suggested fix
```

Wait for the agent to complete and collect its report.

After receiving the failure report, apply the dedup check from Step 5 using the
now-known workflow name if it was not available earlier.

### Step 7: Resolve "ci-failure" Label

Call `list_issue_labels` for the team. Search for a label named `ci-failure`.

- **If found**: store its `id` as `CI_LABEL_ID`.
- **If not found**: use `AskUserQuestion` — "No 'ci-failure' label in Linear.
  [Create it / Skip label]"
  - **Create it**: Call `create_issue_label` with `name: "ci-failure"`,
    `color: "#EF4444"`, `teamId: TEAM_ID`. Store the returned `id`.
  - **Skip label**: Set `CI_LABEL_ID=""`.

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
