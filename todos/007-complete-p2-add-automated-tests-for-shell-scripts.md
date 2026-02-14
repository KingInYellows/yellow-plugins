---
status: complete
priority: p2
issue_id: "007"
tags: [code-review, testing, shell-scripting]
dependencies: []
---

# Zero Automated Tests for 387 Lines of Critical Bash Code

## Problem Statement

PR #10 introduces 4 shell scripts (387 LOC) with zero automated tests. All validation is manual. Critical paths like path traversal validation, queue rotation, flock concurrency, and hook timeout compliance are untested.

**Why it matters:** Shell scripts handle security (path validation), data integrity (queue operations), and performance (budget enforcement). Without tests, regressions and edge cases will go undetected.

## Findings

- **Test Coverage Analyzer:** 2,757 lines with ZERO automated tests. Identified 10 critical test gaps.
- **All review agents:** Multiple agents recommended specific test cases for their findings.

## Proposed Solutions

### Option A: Add bats test suite for critical paths (Recommended)
- Install bats-core as dev dependency
- Create unit tests for validate_file_path(), validate_namespace(), elapsed_ms()
- Create integration tests for queue rotation, flock concurrency, hook isolation
- **Pros:** Catches regressions, validates security patterns
- **Cons:** Adds test infrastructure to repo
- **Effort:** Large (6-8 hours)
- **Risk:** Low

### Option B: Add tests in follow-up PR
- Merge current PR, add tests separately
- **Pros:** Unblocks merge
- **Cons:** Risk window without tests
- **Effort:** Large (6-8 hours, deferred)
- **Risk:** Medium (regressions possible before tests added)

## Acceptance Criteria

- [ ] bats-core installed and configured
- [ ] Path traversal validation tests (../etc/passwd, ~/file, symlinks, empty, absolute)
- [ ] Queue rotation boundary test (10MB trigger)
- [ ] flock concurrency test (two simultaneous flushes)
- [ ] Hook timeout compliance test (<3s session-start, <1s post-tool-use)
- [ ] Hook isolation test (all hooks exit cleanly without .ruvector/)
- [ ] CI runs shell tests

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-12 | Created from PR #10 code review | Test-coverage-analyzer comprehensive report |

## Resources

- PR: #10
