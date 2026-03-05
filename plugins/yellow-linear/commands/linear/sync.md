---
name: linear:sync
description: "Sync current branch with its Linear issue — load context, link PR, update status. Use when user says \"sync with linear\", \"link my branch\", or \"update issue status\"."
argument-hint: '[issue-id]'
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
  - ToolSearch
  - Skill
  - mcp__plugin_yellow-linear_linear__get_issue
  - mcp__plugin_yellow-linear_linear__update_issue
  - mcp__plugin_yellow-linear_linear__list_issue_statuses
  - mcp__plugin_yellow-linear_linear__create_comment
  - mcp__plugin_yellow-linear_linear__list_comments
---

# Sync Branch with Linear Issue

Load issue context, link PRs, and update status for the current branch's Linear
issue.

## Workflow

### Step 1: Resolve Issue ID

Determine the issue ID to sync:

1. **If `$ARGUMENTS` provided:** Extract the issue ID by matching
   `[A-Z]{2,5}-[0-9]{1,6}` within `$ARGUMENTS` (first match). Also check if
   `$ARGUMENTS` contains `--after-submit` and note the flag for Step 5. If no
   issue ID can be extracted, report format error and stop.
2. **Otherwise:** Extract from current branch name:
   ```bash
   git branch --show-current
   ```
   Match pattern `[A-Z]{2,5}-[0-9]{1,6}` (case-sensitive) anywhere in the branch
   name. Use first match.

If no issue ID found, ask user via AskUserQuestion.

### Step 2: Validate Issue Exists

**Security requirement (C1):** Before any operations, call
`mcp__plugin_yellow-linear_linear__get_issue` with the extracted ID to verify:

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

Fetch recent comments (up to 5) via `mcp__plugin_yellow-linear_linear__list_comments`
and display them for context.

### Step 4: Check for PR

Check if a pull request exists for the current branch:

```bash
gh pr view --json url,title,state 2>/dev/null
```

Note: This works for Graphite-created PRs since they are GitHub PRs underneath.

- **If PR exists:** Check the comments fetched in Step 3 for an existing PR link
  comment matching this PR URL. If already linked, skip. Otherwise, add via
  `mcp__plugin_yellow-linear_linear__create_comment`:
  ```
  PR linked: [PR Title](PR URL) — State: open/merged
  ```
- **If no PR:** Note that no PR exists yet. Suggest creating one with
  `gt submit`.

### Step 5: Update Issue Status

Query valid workflow statuses via
`mcp__plugin_yellow-linear_linear__list_issue_statuses` for the issue's team.

Determine the appropriate status transition:

- If PR exists and is **open** → suggest "In Review" status
- If PR exists and is **merged** → suggest "Done" status
- If no PR and status is early (Backlog/Triage) → suggest "In Progress" status

**Two-tier safety model** (see `linear-workflows` SKILL.md):

- **Tier 1 transitions** (`→ In Progress`, `→ In Review`, `In Review → In
  Progress`): If `--after-submit` flag is set (from Step 1) AND a PR exists for
  the current branch (verified in Step 4), auto-apply the transition and report:
  "Updated <ISSUE-ID> to <status>." No confirmation needed. If `--after-submit`
  is set but no PR exists, fall back to `AskUserQuestion` (treat as manual
  invocation). If invoked manually (no `--after-submit`), present the suggestion
  via `AskUserQuestion` as before for consistency with user expectations.
- **Tier 2 transitions** (`→ Done`, `→ Cancelled`, `→ Backlog`): Always present
  via `AskUserQuestion` and require explicit confirmation, regardless of
  invocation context.

If the issue is already in the suggested target status (e.g., already "In
Review" when suggesting "In Review"), skip the transition silently.

Apply via `update_issue` only after the appropriate tier check passes.

**Note:** When invoked programmatically from `/workflows:work` after PR
submission (via Skill tool), the caller passes `--after-submit` to enable Tier 1
auto-apply. This preserves existing manual behavior while enabling automation.

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
