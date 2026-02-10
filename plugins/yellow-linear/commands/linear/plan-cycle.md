---
name: linear:plan-cycle
description: Plan sprint cycle by selecting backlog issues
argument-hint: "[cycle name]"
disable-model-invocation: true
allowed-tools:
  - AskUserQuestion
  - ToolSearch
  - mcp__plugin_linear_linear__list_cycles
  - mcp__plugin_linear_linear__list_issues
  - mcp__plugin_linear_linear__update_issue
  - mcp__plugin_linear_linear__list_teams
  - mcp__plugin_linear_linear__list_users
  - mcp__plugin_linear_linear__list_issue_statuses
---

# Plan Sprint Cycle

Select backlog issues and move them into the current or upcoming sprint cycle.

## Workflow

### Step 1: Resolve Team Context

Auto-detect team from git remote:

```bash
git remote get-url origin 2>/dev/null | sed 's|.*/||' | sed 's|\.git$||'
```

Match repo name against `list_teams`. If no match, ask user to select via AskUserQuestion.

### Step 2: Identify Active Cycle

Fetch cycles via `list_cycles` for the team.

- Identify the **current active cycle** (in progress, nearest end date)
- Display cycle info: name, start date, end date, completion stats
- If `$ARGUMENTS` provided, match by cycle name

If no active cycle exists:
- Report "No active cycle found for this team"
- Suggest creating one manually in Linear's UI (cycle creation is not available via MCP)
- Stop

### Step 3: Show Current Cycle Status

Display the active cycle's current state:
- Total issues in cycle
- Completed / In Progress / Not Started counts
- Team members with assigned issue counts

### Step 4: Fetch Backlog Issues

Query backlog issues via `list_issues`:
- Filter: status in Backlog or Triage states (resolve via `list_issue_statuses`)
- Sort by priority (highest first)
- Limit: top 30 results

If no backlog issues found, report "Backlog is empty" and stop.

### Step 5: Select Issues for Cycle

Present backlog issues as numbered list:
- Show: number, identifier, title, priority, assignee (if any)

Use AskUserQuestion for selection:
- Allow selecting multiple issues to add to the cycle

### Step 6: Confirm and Apply

Present summary of issues to be moved into the cycle:
- List each issue with its identifier and title
- Show total count

If more than 3 issues, require explicit confirmation via AskUserQuestion.

**TOCTOU mitigation:** Re-fetch each issue before updating to verify it hasn't been moved or deleted.

Apply via `update_issue` to set the cycle for each selected issue.

### Step 7: Summary

Display planning results:
- Number of issues added to cycle
- Updated cycle totals
- Suggest: "Run `/linear:status` to see project health after planning."

## Error Handling

- **No active cycle:** Guide user to create one in Linear UI
- **Empty backlog:** Report and stop gracefully
- **Authentication required:** Re-run to trigger OAuth re-authentication
- **Rate limited:** Wait 1 minute and retry
