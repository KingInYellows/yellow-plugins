---
title: 'Duplicate PR Link Comments in linear-pr-linker Agent'
category: logic-errors
tags:
  - linear-plugin
  - agent-tools
  - deduplication
  - allowed-tools
  - write-safety
module: plugins/yellow-linear
symptom:
  "linear-pr-linker agent creates duplicate 'PR linked: ...' comments on Linear
  issues when invoked multiple times on the same branch"
root_cause:
  "Agent's allowed-tools missing list_comments prevented deduplication check
  before creating new PR link comments; sync command also lacked explicit dedup
  instruction"
date: '2026-02-10'
---

# Duplicate PR Link Comments in linear-pr-linker Agent

## Problem

The `linear-pr-linker` agent created duplicate "PR linked: [Title](URL)"
comments on Linear issues every time it ran. Since this agent auto-triggers on
`gt submit`, "link to linear" requests, and similar events, repeated invocations
spammed the Linear issue comment thread with identical entries.

The `/linear:sync` command had the same risk — Step 4 added a PR link comment
without checking if one already existed.

## Root Cause

Two gaps combined:

1. **Missing read permission:** The `linear-pr-linker` agent's `allowed-tools`
   included `mcp__plugin_linear_linear__create_comment` but not
   `mcp__plugin_linear_linear__list_comments`. The agent literally could not
   check for existing comments before creating new ones.

2. **No dedup logic:** Neither the agent's Step 4 nor the `sync` command's Step
   4 instructed the LLM to check for existing PR link comments before adding a
   new one. The `sync` command did fetch comments in Step 3 for display, but
   Step 4 didn't reference them.

A related observation: the pr-linker writes the comment (Step 4) before asking
for status update confirmation (Step 5). This is an intentional M3 narrowing —
PR link comments are low-risk appends, while status changes are higher-risk
modifications requiring user consent.

## Solution

### 1. Add `list_comments` to pr-linker allowed-tools

```yaml
# plugins/yellow-linear/agents/workflow/linear-pr-linker.md
allowed-tools:
  - Bash
  - AskUserQuestion
  - ToolSearch
  - mcp__plugin_linear_linear__get_issue
  - mcp__plugin_linear_linear__update_issue
  - mcp__plugin_linear_linear__create_comment
  - mcp__plugin_linear_linear__list_comments # Added
  - mcp__plugin_linear_linear__list_issue_statuses
```

### 2. Add dedup check to pr-linker Step 4

```markdown
### Step 4: Link PR to Issue

First, fetch existing comments via `list_comments` and check if a PR link
comment already exists for this PR URL. If a matching comment is found, skip
adding a duplicate.

If no existing PR link comment, add one via `create_comment`:
```

### 3. Add dedup check to sync.md Step 4

```markdown
- **If PR exists:** Check the comments fetched in Step 3 for an existing PR link
  comment matching this PR URL. If already linked, skip. Otherwise, add via
  `mcp__plugin_linear_linear__create_comment`:
```

### 4. Document M3 narrowing

Added to pr-linker Guidelines:

```markdown
- **Never modify issue status without user confirmation** (security M3 —
  narrowed for this agent to status changes only; PR link comments are low-risk
  writes that proceed without confirmation)
```

## Prevention

### Read-Before-Write Rule

**If an agent calls `create_X`, it must also have `list_X` or `get_X` in
allowed-tools.**

This ensures agents can always check existing state before creating new
entities. Apply to every write tool:

| Write Tool                 | Required Read Tool                      |
| -------------------------- | --------------------------------------- |
| `create_comment`           | `list_comments`                         |
| `update_issue`             | `get_issue`                             |
| `create_issue`             | `list_issues` (for duplicate detection) |
| `create_initiative_update` | `list_initiative_updates`               |

### Write Safety Tiers

| Tier          | Confirmation     | Examples                                    |
| ------------- | ---------------- | ------------------------------------------- |
| **High-risk** | Always confirm   | Status changes, issue deletion, assignments |
| **Medium**    | Read-first dedup | Comments, labels, attachments               |
| **Low-risk**  | No confirmation  | Local git operations, file reads            |

Default to medium tier — agents must read state before writes unless explicitly
classified as low-risk.

### Pre-Submission Checklist Addition

- [ ] Every `create_*` tool in allowed-tools has a corresponding `list_*` or
      `get_*` tool
- [ ] Agent workflow includes explicit dedup check before write operations
- [ ] M3 write safety tier documented in agent Guidelines section

## Related Documentation

- [First review round (19 findings)](../security-issues/yellow-linear-plugin-multi-agent-code-review.md)
  — Established C1/H1/M3 security patterns
- [Second review round (21 threads)](../security-issues/yellow-linear-plugin-pr-review-fixes.md)
  — Schema compliance and tool naming fixes
- [Implementation plan](../../plans/2026-02-10-feat-yellow-linear-plugin-plan.md)
  — Original M3 write safety definition
- PR #6: feat: add yellow-linear plugin with 5 commands, 3 agents, and 1 skill
