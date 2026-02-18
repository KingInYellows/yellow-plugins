---
name: linear-workflows
description: >
  Linear workflow patterns and conventions reference. Use when commands or agents
  need Linear workflow context, issue writing guidance, or branch naming conventions.
user-invocable: false
---

# Linear Workflow Patterns

## What It Does

Reference patterns and conventions for Linear PM workflows. Loaded by commands and agents for consistent behavior.

## When to Use

Use when yellow-linear plugin commands or agents need shared Linear workflow context, including issue-writing guidance, branch naming conventions, or workflow state definitions.

## Usage

This skill is not user-invocable. It provides shared context for the yellow-linear plugin's commands and agents.

## Team Context

Linear team names match GitHub repository names exactly. Auto-detected from git remote:

```bash
git remote get-url origin 2>/dev/null | sed 's|.*/||' | sed 's|\.git$||'
```

The extracted repo name is matched against `list_teams` results (case-sensitive exact match). This means:
- No manual team selection needed in most cases
- Works across multiple repos/teams automatically
- If multiple teams match the same name, prompt user to disambiguate via AskUserQuestion
- Falls back to AskUserQuestion if no match found

## Branch Naming Convention

Format: `<type>/<TEAM-ID>-<description>`

Examples:
- `feat/ENG-123-auth-flow`
- `fix/ENG-456-login-redirect`
- `refactor/ENG-789-api-cleanup`

Issue ID extraction pattern: `[A-Z]{2,5}-[0-9]{1,6}` (case-sensitive, first match wins). Always validate the extracted ID via `get_issue` before use.

## Issue Writing Tips

### Good Titles
- Start with what's affected: "Auth token refresh fails on slow connections"
- Be specific: "Login page returns 500 on empty email" not "Login broken"
- Include scope: "API v2: Add rate limiting to /users endpoint"

### Acceptance Criteria Format
```markdown
## Acceptance Criteria
- [ ] User can reset password via email link
- [ ] Reset link expires after 24 hours
- [ ] Error message shown for expired links
- [ ] Rate limit: max 3 reset requests per hour
```

### Priority Definitions
| Priority | When to Use |
|----------|-------------|
| Urgent   | Production is down, data loss, security breach |
| High     | Major feature blocked, significant user impact |
| Medium   | Normal feature work, non-critical bugs |
| Low      | Nice-to-have, cosmetic issues, tech debt |

## Triage Flow

1. Review unassigned issues (sorted by creation date)
2. For each issue:
   - Set priority based on definitions above
   - Assign to team member based on domain expertise
   - Move from Triage → Backlog (or Todo if urgent)
   - Add relevant labels
3. Confirm bulk changes before applying (>3 issues)

## Cycle Planning Checklist

1. Review current cycle completion stats
2. Carry over incomplete high-priority items
3. Pull from backlog by priority (Urgent → High → Medium)
4. Balance workload across team members
5. Ensure no single person has >5 active issues
6. Leave 20% capacity buffer for unplanned work

## Status Update Template

```markdown
## Weekly Status: [Project Name]

### Progress
- Completed: X issues (list highlights)
- In Progress: Y issues
- Blocked: Z issues (list with reasons)

### Highlights
- [Key achievement or milestone]

### Risks
- [Blocker or risk with mitigation plan]

### Next Week
- [Planned focus areas]
```

## Workflow States

Do NOT hardcode status names. Always fetch valid statuses from `list_issue_statuses` for the target team. Common patterns:

| Typical State | Meaning |
|---------------|---------|
| Triage        | New, needs review |
| Backlog       | Accepted, not started |
| Todo          | Planned for current cycle |
| In Progress   | Actively being worked on |
| In Review     | PR submitted, awaiting review |
| Done          | Completed and verified |
| Canceled      | Won't do |

## Input Validation

All `$ARGUMENTS` values are user input and must be validated before use:

- **Issue IDs:** Must match `^[A-Z]{2,5}-[0-9]{1,6}$` exactly. Reject anything else.
- **Titles/descriptions:** Max 500 characters. Strip HTML tags before passing to API.
- **Cycle/filter names:** Alphanumeric, spaces, and hyphens only. Max 100 characters.
- **General rule:** Never interpolate `$ARGUMENTS` into shell commands. Pass to MCP tools as API parameters only.

If validation fails, report the format error and prompt the user to correct it.

## Security Patterns

### C1: Issue ID Validation
Before any write operation using a branch-extracted issue ID, call `get_issue` to verify:
- The issue exists
- It belongs to the user's workspace

This prevents cross-workspace data corruption from ID collisions.

### H1: Bulk Operation TOCTOU
Between user review and confirmation, issues may change. Re-fetch state before applying bulk changes.

### M3: Agent Write Safety
Agents that modify Linear state (e.g., `linear-pr-linker`) must request explicit user confirmation before writes. Read-only agents never modify state.

## PR Convention

- Create PRs via Graphite: `gt submit`
- Read PR state via GitHub: `gh pr view`, `gh api`
- Never use `gh pr create` for PR creation
- Link issues to PRs by adding a comment with the PR URL

## Shell Patterns

Always quote variables when handling Linear-derived data:

```bash
# Extract issue ID from branch name
branch_name="$(git branch --show-current)"
issue_id="$(printf '%s' "$branch_name" | grep -oE '[A-Z]{2,5}-[0-9]{1,6}' | head -n1)"

# Validate before use
if [ -z "$issue_id" ]; then
  printf '[linear] No issue ID found in branch name "%s"\n' "$branch_name" >&2
  exit 1
fi

# Call MCP tool (never interpolate $ARGUMENTS into shell commands)
# Pass as API parameters only
```

## Error Handling Guidance

| Error | Action |
|-------|--------|
| Authentication required | Re-run command to trigger OAuth re-authentication |
| Rate limited (429) | Exponential backoff: wait 1s, 2s, 4s. Max 3 retries. |
| Issue not found | Verify issue ID exists in your Linear workspace |
| Team not found | Check git remote matches a Linear team name |
| Partial batch failure | Report which items succeeded/failed. Offer to retry failed items. |

### Bulk Operation Rate Limiting

For commands that issue multiple writes (triage, plan-cycle):
- Add a brief delay between each `update_issue` call for batches >5 items
- If a 429 rate limit response occurs, pause and retry with exponential backoff
- On partial failure, report results so far and offer to retry remaining items
- Never leave the user guessing about state after a partial failure
