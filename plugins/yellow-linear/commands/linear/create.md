---
name: linear:create
description: "Create a Linear issue from current context. Use when user describes a bug, requests a feature, says \"file an issue\", \"track this\", or \"create ticket for X\"."
argument-hint: '[title]'
allowed-tools:
  - Read
  - Bash
  - Grep
  - AskUserQuestion
  - ToolSearch
  - mcp__plugin_yellow-linear_linear__create_issue
  - mcp__plugin_yellow-linear_linear__list_teams
  - mcp__plugin_yellow-linear_linear__get_team
  - mcp__plugin_yellow-linear_linear__list_issue_labels
  - mcp__plugin_yellow-linear_linear__list_issue_statuses
  - mcp__plugin_yellow-linear_linear__list_projects
---

# Create Linear Issue

Create a Linear issue from current context, optionally with a quick title via
arguments.

## Workflow

### Step 1: Resolve Team Context

Auto-detect team from git remote repo name. Match against `list_teams` (see
"Team Context" in `linear-workflows` skill). If no match or multiple matches,
prompt via AskUserQuestion.

### Step 2: Parse and Validate Input

Check `$ARGUMENTS` for a quick title:

- **If provided:** Validate: max 500 characters, strip any HTML tags. Use as
  issue title, skip to Step 3.
- **If empty:** Launch interactive flow — ask via AskUserQuestion:
  - Issue title (required)
  - Brief description (optional, 1-2 sentences)

### Step 3: Enrich from Context

Gather additional context automatically:

- Read current branch name: `git branch --show-current`
- If on a feature branch, offer to reference it in the issue description
- Check for uncommitted changes that might relate to the issue:
  `git diff --stat`

### Step 4: Set Issue Properties

Use AskUserQuestion to let user choose:

- **Priority:** Urgent / High / Medium / Low / No priority
- **Labels:** Fetch available labels via `list_issue_labels` for the team,
  present top options
- **Project:** Fetch active projects via `list_projects`, let user optionally
  assign

If user wants to skip properties, create with defaults (no priority, no labels,
no project).

### Step 5: Create Issue

Call `create_issue` with:

- `title` — from Step 2
- `description` — from Step 2 + context from Step 3
- `teamId` — from Step 1
- `priority` — from Step 4 (if set)
- `labelIds` — from Step 4 (if set)
- `projectId` — from Step 4 (if set)

### Step 6: Report

Display the created issue:

- Issue identifier (e.g., ENG-456)
- Title
- URL (if available from response)
- Suggest: "Run `/linear:sync` to keep this issue linked to your branch."

## Error Handling

See `linear-workflows` skill for common error handling patterns (authentication,
rate limiting, team resolution).
