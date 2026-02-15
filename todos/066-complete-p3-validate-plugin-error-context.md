---
status: pending
priority: p3
issue_id: "066"
tags: [code-review, silent-failure, scripts]
dependencies: []
---

# Add Error Context to validate-plugin.js

## Problem Statement

`validate-plugin.js` catches filesystem errors (reading plugin.json) but doesn't distinguish EACCES from ENOENT in error messages. The `--plugin` flag path is also not validated for path traversal.

## Findings

- **Source:** silent-failure-hunter (HIGH), security-sentinel (L2)
- **File:** `scripts/validate-plugin.js`

## Proposed Solutions

### Option A: Add error code to messages + path prefix check
- Include `err.code` in error messages
- Validate `--plugin` path starts with `plugins/` or is a relative path within repo
- **Effort:** Small (10 min)
- **Risk:** Low

## Recommended Action

Option A.

## Technical Details

- **Affected files:** `scripts/validate-plugin.js`

## Acceptance Criteria

- [ ] Error messages include filesystem error codes (ENOENT, EACCES)
- [ ] --plugin flag path validated for traversal

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-14 | Created from code review | |

## Resources

- PR stack: #13, #14, #15
