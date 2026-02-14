---
status: complete
priority: p2
issue_id: "012"
tags: [code-review, error-handling, ux]
dependencies: []
---

# Install Script Provides Poor Error Diagnostics

## Problem Statement

install.sh suppresses npm errors with `2>/dev/null`, doesn't validate $HOME, and provides generic "npm install failed" messages. Node.js version parsing can fail with non-numeric output.

## Findings

- **Silent Failure Hunter (#16):** npm fallback doesn't check $HOME or .local writability
- **Silent Failure Hunter (#17):** Version parsing fails on unexpected node --version output
- **Silent Failure Hunter (#18):** npx ruvector --version failure gives generic error

## Proposed Solutions

### Option A: Capture and report actual errors (Recommended)
- Replace `2>/dev/null` with `2>&1` and include in error messages
- Validate $HOME before fallback install
- Validate node_major is numeric before comparison
- **Effort:** Small (1-2 hours)
- **Risk:** Low

## Acceptance Criteria

- [ ] npm errors visible in failure messages
- [ ] $HOME validated before ~/.local fallback
- [ ] Node version parsing handles non-numeric output gracefully
- [ ] npx --version failure includes actual error text

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-12 | Created from PR #10 code review | Silent-failure #16,#17,#18 |

## Resources

- PR: #10
