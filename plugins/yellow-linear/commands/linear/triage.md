---
name: linear:triage
description: >
  Review and assign incoming Linear issues. Use when user says "triage issues",
  "assign incoming tickets", "what needs triage", or "review new issues".
argument-hint: '[filter query]'
allowed-tools:
  - Bash
  - AskUserQuestion
  - ToolSearch
  - mcp__plugin_linear_linear__list_issues
  - mcp__plugin_linear_linear__get_issue
  - mcp__plugin_linear_linear__update_issue
  - mcp__plugin_linear_linear__list_teams
  - mcp__plugin_linear_linear__get_team
  - mcp__plugin_linear_linear__list_users
  - mcp__plugin_linear_linear__list_issue_statuses
  - mcp__plugin_linear_linear__list_issue_labels
---

# Triage Incoming Issues

Review unassigned and untriaged Linear issues, then assign, prioritize, and
categorize them.

## Workflow

### Step 1: Resolve Team Context

Auto-detect team from git remote repo name. Match against `list_teams` (see
"Team Context" in `linear-workflows` skill). If no match or multiple matches,
prompt via AskUserQuestion.

### Step 2: Fetch Untriaged Issues

Query issues needing triage using `list_issues` for the team:

- Filter: unassigned OR in early workflow states (Triage, Backlog)
- Fetch statuses via `list_issue_statuses` to identify early-state IDs
- Limit: top 30 results
- If `$ARGUMENTS` provided, validate: max 200 characters, strip HTML tags. Use
  as additional filter (search within titles/descriptions).

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

**Validate and apply (C1 + H1):** Before each `update_issue` call:

1. **Validate ownership (C1):** Call `get_issue` to verify the issue exists and
   belongs to the user's workspace. If not found or access denied, skip and
   warn.
2. **Detect concurrent changes (H1):** Compare the re-fetched state (assignee,
   status, priority, labels) against what the user saw in Step 3. If any field
   being modified has changed since review, present the conflict:
   ```
   Issue ENG-123 changed since review:
   - Assignee was unassigned, now @alice
   Your change: Assign to @bob
   [Skip] [Override] [Cancel All]
   ```
3. **Apply:** Call `update_issue` only for validated, non-conflicting issues.
4. **Rate limit:** Add a brief delay between writes for batches >5 issues.

### Step 7: Summary

Display triage results:

- Number of issues triaged
- Changes applied per issue (assigned to, priority set, status changed, labels
  added)

## Error Handling

- **No untriaged issues:** Report and stop gracefully

See `linear-workflows` skill for common error handling patterns (authentication,
rate limiting, bulk operation failures).
