---
status: pending
priority: p3
issue_id: "065"
tags: [code-review, testing, yellow-review]
dependencies: []
---

# Improve Mock gh Error Messages

## Problem Statement

The mock `gh` script in tests falls through to a generic error for unmatched argument patterns. It should list available fixtures/patterns to aid debugging test failures.

## Findings

- **Source:** silent-failure-hunter (CRITICAL), code-simplicity-reviewer
- **File:** `plugins/yellow-review/tests/mocks/gh`

## Proposed Solutions

### Option A: Add fixture listing to error output
- In the default/fallback case, print available patterns and received args to stderr
- **Effort:** Small (5 min)
- **Risk:** Low

## Recommended Action

Option A.

## Technical Details

- **Affected files:** `plugins/yellow-review/tests/mocks/gh`

## Acceptance Criteria

- [ ] Unmatched args produce error listing available patterns
- [ ] All existing tests still pass

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-14 | Created from code review | |

## Resources

- PR stack: #13, #14, #15
