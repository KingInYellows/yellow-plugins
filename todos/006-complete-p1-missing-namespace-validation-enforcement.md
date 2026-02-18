---
status: complete
priority: p1
issue_id: '006'
tags: [code-review, security, validation]
dependencies: []
---

# Namespace Validation Documented But Not Enforced in Code

## Problem Statement

The `ruvector-conventions` skill documents that namespace names must match
`[a-z0-9-]` only, rejecting `..`, `/`, `~`. However, no shell function or agent
validation actually enforces this. Commands say "validate per conventions skill"
without implementation.

**Why it matters:** If namespace names are used in file paths or MCP tool calls,
path traversal via namespace like `../../etc` could escape the `.ruvector/`
directory.

## Findings

- **Security Sentinel (H1):** Commands reference validation but don't enforce it
- **Test Coverage Analyzer (#5):** Zero tests for namespace validation
- **Data Integrity Guardian (Namespace section):** Validation "only documented,
  not enforced in code"

## Proposed Solutions

### Option A: Add validate_namespace() to shared utility + enforce in all entry points (Recommended)

- Create shared validation function
- Enforce in learn.md, memory.md, memory-manager agent
- **Pros:** Single source of truth, all paths validated
- **Cons:** Need shared utility file
- **Effort:** Small (1 hour)
- **Risk:** Low

## Technical Details

- **Affected files:**
  - `plugins/yellow-ruvector/skills/ruvector-conventions/SKILL.md` (add
    function)
  - `plugins/yellow-ruvector/commands/ruvector/learn.md` (enforce)
  - `plugins/yellow-ruvector/commands/ruvector/memory.md` (enforce)
  - `plugins/yellow-ruvector/agents/ruvector/memory-manager.md` (enforce)

## Acceptance Criteria

- [ ] validate_namespace() function exists with `[a-z0-9-]` pattern
- [ ] Rejects `..`, `/`, `~`, uppercase, underscores, spaces
- [ ] Enforced in all commands and agents that accept namespace input
- [ ] Clear error message on invalid namespace

## Work Log

| Date       | Action                          | Learnings                                               |
| ---------- | ------------------------------- | ------------------------------------------------------- |
| 2026-02-12 | Created from PR #10 code review | Security H1, test-coverage #5, data-integrity namespace |

## Resources

- PR: #10
