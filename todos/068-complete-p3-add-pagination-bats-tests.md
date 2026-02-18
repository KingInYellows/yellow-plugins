---
status: pending
priority: p3
issue_id: '068'
tags: [code-review, testing, yellow-review]
dependencies: ['060', '061']
---

# Add Multi-Page Pagination Bats Tests

## Problem Statement

Current bats tests for `get-pr-comments` don't cover multi-page pagination
scenarios or cursor edge cases (null cursor, invalid format). The mock `gh` only
handles single-page responses.

## Findings

- **Source:** performance-oracle, security-sentinel
- **File:** `plugins/yellow-review/tests/get-pr-comments.bats`,
  `plugins/yellow-review/tests/mocks/gh`

## Proposed Solutions

### Option A: Add pagination fixture + tests

- Create multi-page mock responses with `hasNextPage: true` and cursor values
- Add tests: successful multi-page, null cursor truncation, invalid cursor
  rejection
- **Effort:** Medium (30 min)
- **Risk:** Low

## Recommended Action

Option A — after P1 fixes (060, 061) are implemented.

## Technical Details

- **Affected files:** `plugins/yellow-review/tests/get-pr-comments.bats`,
  `plugins/yellow-review/tests/mocks/gh`,
  `plugins/yellow-review/tests/fixtures/`

## Acceptance Criteria

- [ ] Multi-page pagination test with 2+ pages
- [ ] Null cursor warning test
- [ ] Invalid cursor rejection test (after 060 is implemented)

## Work Log

| Date       | Action                   | Learnings                 |
| ---------- | ------------------------ | ------------------------- |
| 2026-02-14 | Created from code review | Depends on P1 fixes first |

## Resources

- PR stack: #13, #14, #15
