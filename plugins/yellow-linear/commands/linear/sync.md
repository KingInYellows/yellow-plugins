---
name: linear:sync
description: >
  Sync current branch with its Linear issue — load context, link PR, update
  status. Use when user says "sync with linear", "link my branch", or "update
  issue status".
argument-hint: '[issue-id]'
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
  - ToolSearch
  - mcp__plugin_linear_linear__get_issue
  - mcp__plugin_linear_linear__update_issue
  - mcp__plugin_linear_linear__list_issue_statuses
  - mcp__plugin_linear_linear__create_comment
  - mcp__plugin_linear_linear__list_comments
---

# Sync Branch with Linear Issue

Load issue context, link PRs, and update status for the current branch's Linear
issue.

## Workflow

### Step 1: Resolve Issue ID

Determine the issue ID to sync:

1. **If `$ARGUMENTS` provided:** Validate format matches `[A-Z]{2,5}-[0-9]{1,6}`
   exactly. If invalid, report format error and stop.
2. **Otherwise:** Extract from current branch name:
   ```bash
   git branch --show-current
   ```
   Match pattern `[A-Z]{2,5}-[0-9]{1,6}` (case-sensitive) anywhere in the branch
   name. Use first match.

If no issue ID found, ask user via AskUserQuestion.

### Step 2: Validate Issue Exists

**Security requirement (C1):** Before any operations, call
`mcp__plugin_linear_linear__get_issue` with the extracted ID to verify:

- The issue exists
- It belongs to the user's workspace

If validation fails, report the error and stop. Do NOT proceed with writes
against an unverified issue ID.

### Step 3: Display Issue Summary

Present the issue context:

- **Identifier** (e.g., ENG-123)
- **Title**
- **Status** (current workflow state)
- **Priority**
- **Assignee**
- **Description** (full text for coding reference)

Fetch recent comments (up to 5) via `mcp__plugin_linear_linear__list_comments`
and display them for context.

### Step 4: Check for PR

Check if a pull request exists for the current branch:

```bash
gh pr view --json url,title,state 2>/dev/null
```

Note: This works for Graphite-created PRs since they are GitHub PRs underneath.

- **If PR exists:** Check the comments fetched in Step 3 for an existing PR link
  comment matching this PR URL. If already linked, skip. Otherwise, add via
  `mcp__plugin_linear_linear__create_comment`:
  ```
  PR linked: [PR Title](PR URL) — State: open/merged
  ```
- **If no PR:** Note that no PR exists yet. Suggest creating one with
  `gt submit`.

### Step 5: Update Issue Status

Query valid workflow statuses via
`mcp__plugin_linear_linear__list_issue_statuses` for the issue's team.

Determine the appropriate status transition:

- If PR exists and is **open** → suggest "In Review" status
- If PR exists and is **merged** → suggest "Done" status
- If no PR and status is early (Backlog/Triage) → suggest "In Progress" status

Present the suggestion via AskUserQuestion and let user confirm or choose a
different status. Apply via `update_issue` only after confirmation.

### Step 6: Summary

Display sync summary:

- Issue ID + title
- Status change (if any)
- PR link added (if any)
- Recent comments loaded for context

## Error Handling

- **No branch detected:** Must be in a git repository on a named branch

See `linear-workflows` skill for common error handling patterns (authentication,
rate limiting, issue resolution).
