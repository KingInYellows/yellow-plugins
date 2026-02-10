---
name: linear:triage
description: Review and assign incoming Linear issues
argument-hint: "[filter query]"
disable-model-invocation: true
allowed-tools:
  - AskUserQuestion
  - ToolSearch
  - mcp__plugin_linear_linear__list_issues
  - mcp__plugin_linear_linear__update_issue
  - mcp__plugin_linear_linear__list_teams
  - mcp__plugin_linear_linear__get_team
  - mcp__plugin_linear_linear__list_users
  - mcp__plugin_linear_linear__list_issue_statuses
  - mcp__plugin_linear_linear__list_issue_labels
---

# Triage Incoming Issues

Review unassigned and untriaged Linear issues, then assign, prioritize, and categorize them.

## Workflow

### Step 1: Resolve Team Context

Auto-detect team from git remote:

```bash
git remote get-url origin 2>/dev/null | sed 's|.*/||' | sed 's|\.git$||'
```

Match repo name against `list_teams`. If no match, ask user to select via AskUserQuestion.

### Step 2: Fetch Untriaged Issues

Query issues needing triage using `list_issues` for the team:
- Filter: unassigned OR in early workflow states (Triage, Backlog)
- Fetch statuses via `list_issue_statuses` to identify early-state IDs
- Limit: top 30 results
- If `$ARGUMENTS` provided, use as additional filter (search within titles/descriptions)

### Step 3: Present Issues

Display issues as a numbered list grouped by priority:
- Show: number, identifier, title, current status, creation date
- Group: Urgent → High → Medium → Low → No priority
- If no issues found, report "No issues need triage" and stop

### Step 4: Select Issues

Use AskUserQuestion to let user select issues to triage:
- Present numbered options for selection
- Allow selecting multiple issues

### Step 5: Triage Selected Issues

For each selected issue, use AskUserQuestion to choose actions:
- **Assign to:** Fetch team members via `list_users`, present options
- **Set priority:** Urgent / High / Medium / Low
- **Set status:** Present valid statuses from `list_issue_statuses`
- **Add labels:** Present available labels from `list_issue_labels`
- **Skip:** Leave unchanged

### Step 6: Confirm and Apply

If more than 3 issues selected for changes:
- Present summary of all planned changes
- Require explicit confirmation via AskUserQuestion before applying

**TOCTOU mitigation (H1):** Before applying bulk changes, re-fetch each issue's current state and compare. If an issue has changed since review (different assignee, status, or deleted), warn the user and skip that issue.

Apply changes via `update_issue` for each confirmed issue.

### Step 7: Summary

Display triage results:
- Number of issues triaged
- Changes applied per issue (assigned to, priority set, status changed, labels added)

## Error Handling

- **No untriaged issues:** Report and stop gracefully
- **Authentication required:** Re-run to trigger OAuth re-authentication
- **Rate limited:** Wait 1 minute and retry, or reduce batch size
