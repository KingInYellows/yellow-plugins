---
name: linear:status
description: Generate project and initiative health report
disable-model-invocation: true
allowed-tools:
  - AskUserQuestion
  - ToolSearch
  - mcp__plugin_linear_linear__list_projects
  - mcp__plugin_linear_linear__get_project
  - mcp__plugin_linear_linear__list_issues
  - mcp__plugin_linear_linear__list_initiatives
  - mcp__plugin_linear_linear__get_initiative
  - mcp__plugin_linear_linear__list_initiative_updates
  - mcp__plugin_linear_linear__create_initiative_update
  - mcp__plugin_linear_linear__list_milestones
---

# Project & Initiative Status Report

Generate a health report across projects, initiatives, and milestones.

## Workflow

### Step 1: Fetch Project Health

Query active projects via `list_projects`.

For each project (up to 10):
- Fetch project details via `get_project`
- Query issues via `list_issues` filtered by project
- Calculate: total issues, completed, in-progress, blocked count
- Determine completion percentage

Present as a table:
```
| Project        | Progress | Done | In Progress | Blocked |
|----------------|----------|------|-------------|---------|
| Auth Overhaul  | 65%      | 13   | 5           | 2       |
| API v2         | 30%      | 6    | 8           | 0       |
```

### Step 2: Fetch Initiative Health

Query active initiatives via `list_initiatives`.

For each initiative:
- Fetch details via `get_initiative`
- Fetch recent updates via `list_initiative_updates`
- Show: name, status, last update date, health indicator

### Step 3: Surface Blockers and Risks

Identify issues that need attention:
- Issues with "Blocked" status
- Issues with no updates in >7 days (stale)
- High-priority issues not yet started

Present as an attention list:
```
⚠ Blocked:
  - ENG-123: Auth token refresh fails (blocked 3 days)

⚠ Stale (no activity >7 days):
  - ENG-456: Update API docs (last touched 12 days ago)
```

### Step 4: Milestone Progress

Fetch milestones via `list_milestones` (if any exist):
- Show: name, target date, completion percentage
- Flag milestones at risk (>50% time elapsed, <50% complete)

### Step 5: Generate Report

Compile all sections into a structured markdown report:
- Project health table
- Initiative status
- Blockers and risks
- Milestone progress
- Date generated

### Step 6: Offer Initiative Update

Use AskUserQuestion to ask:
- "Would you like to post this report as an initiative update to Linear?"

If yes:
- Select which initiative to update via AskUserQuestion
- Post via `create_initiative_update` with the report content

## Error Handling

- **No projects/initiatives found:** Report empty state and stop
- **Authentication required:** Re-run to trigger OAuth re-authentication
- **Rate limited:** Wait 1 minute and retry, or reduce batch size
