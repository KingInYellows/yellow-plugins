---
status: complete
priority: p2
issue_id: "010"
tags: [code-review, security, path-traversal]
dependencies: []
---

# Canonicalize PROJECT_DIR and MCP Storage Path

## Problem Statement

Hook scripts use `PROJECT_DIR="${CLAUDE_PROJECT_DIR:-${PWD}}"` without canonicalizing. If PROJECT_DIR is a symlink or relative path, the prefix check in validate_file_path() can be bypassed. Similarly, MCP config uses `${PWD}` which could be polluted.

## Findings

- **Security Sentinel (C2):** PROJECT_DIR not canonicalized at script start
- **Security Sentinel (M4):** MCP env uses ${PWD} instead of ${CLAUDE_PROJECT_DIR}

## Proposed Solutions

### Option A: Canonicalize at script start (Recommended)
- `PROJECT_DIR="$(realpath -- "${CLAUDE_PROJECT_DIR:-${PWD}}")"` at top of each hook
- Use `${CLAUDE_PROJECT_DIR}` in MCP config if available
- **Effort:** Small (30 min)
- **Risk:** Low

## Acceptance Criteria

- [ ] PROJECT_DIR canonicalized via realpath at start of all hooks
- [ ] MCP config uses most reliable path source

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-12 | Created from PR #10 code review | Security C2, M4 |

## Resources

- PR: #10
