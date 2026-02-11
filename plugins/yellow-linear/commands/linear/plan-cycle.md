---
name: linear:plan-cycle
description: >
  Plan sprint cycle by selecting backlog issues. Use when user says "plan the sprint",
  "fill the cycle", "what should we work on next", or "sprint planning".
argument-hint: "[cycle name]"
allowed-tools:
  - Bash
  - AskUserQuestion
  - ToolSearch
  - mcp__plugin_linear_linear__list_cycles
  - mcp__plugin_linear_linear__list_issues
  - mcp__plugin_linear_linear__get_issue
  - mcp__plugin_linear_linear__update_issue
  - mcp__plugin_linear_linear__list_teams
  - mcp__plugin_linear_linear__list_users
  - mcp__plugin_linear_linear__list_issue_statuses
---

# Plan Sprint Cycle

Select backlog issues and move them into the current or upcoming sprint cycle.

## Workflow

### Step 1: Resolve Team Context

Auto-detect team from git remote repo name. Match against `list_teams` (see "Team Context" in `linear-workflows` skill). If no match or multiple matches, prompt via AskUserQuestion.

### Step 2: Identify Active Cycle

Fetch cycles via `list_cycles` for the team.

- Identify the **current active cycle** (in progress, nearest end date)
- Display cycle info: name, start date, end date, completion stats
- If `$ARGUMENTS` provided, validate: alphanumeric, spaces, and hyphens only, max 100 characters. Match by cycle name.

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

**Validate and apply (C1 + H1):** Before each `update_issue` call:

1. **Validate ownership (C1):** Call `get_issue` to verify the issue exists and belongs to the user's workspace. If not found or access denied, skip and warn.
2. **Detect concurrent changes (H1):** Compare re-fetched state (status, cycle assignment) against what user saw in Step 4. If the issue has been moved to a cycle or deleted, present the conflict and let the user choose to skip or override.
3. **Apply:** Call `update_issue` to set the cycle only for validated issues.
4. **Rate limit:** Add a brief delay between writes for batches >5 issues.

### Step 7: Summary

Display planning results:
- Number of issues added to cycle
- Updated cycle totals
- Suggest: "Run `/linear:status` to see project health after planning."

## Error Handling

- **No active cycle:** Guide user to create one in Linear UI
- **Empty backlog:** Report and stop gracefully

See `linear-workflows` skill for common error handling patterns (authentication, rate limiting, bulk operation failures).
