---
name: linear:status
description: >
  Generate project and initiative health report. Use when user asks "project status",
  "how are we tracking", "what's blocked", or "sprint health".
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
  - mcp__plugin_linear_linear__list_teams
---

# Project & Initiative Status Report

Generate a health report across projects and initiatives.

## Workflow

### Step 1: Fetch Project Health

Query active projects via `list_projects` (limit: 50).

Show the first 5 projects immediately. For each project:
- Fetch project details via `get_project` and issues via `list_issues` filtered by project — fetch these in parallel where possible.
- Calculate: total issues, completed, in-progress, blocked count
- Determine completion percentage

If more than 5 projects, ask via AskUserQuestion: "Showing top 5 projects. Load all N projects?"

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
Blocked:
  - ENG-123: Auth token refresh fails (blocked 3 days)

Stale (no activity >7 days):
  - ENG-456: Update API docs (last touched 12 days ago)
```

### Step 4: Generate Report

Compile all sections into a structured markdown report:
- Project health table
- Initiative status
- Blockers and risks
- Date generated

### Step 5: Offer Initiative Update

Use AskUserQuestion to ask:
- "Would you like to post this report as an initiative update to Linear?"

If yes:
- Select which initiative to update via AskUserQuestion
- **Validate access (C1):** Call `get_initiative` with the selected initiative ID to verify it exists and belongs to the user's workspace. If validation fails, report the error and stop.
- Post via `create_initiative_update` with the report content

## Error Handling

- **No projects/initiatives found:** Report empty state and stop

See `linear-workflows` skill for common error handling patterns (authentication, rate limiting).
