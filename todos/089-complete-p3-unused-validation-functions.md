---
status: complete
priority: p3
issue_id: '089'
tags: [code-review, yellow-ci, simplicity]
dependencies: []
---

# Unused Validation Functions (~150 LOC)

## Problem Statement

4 validation functions in `validate.sh` are defined but never called by any
yellow-ci component, adding ~150 lines of maintenance burden.

## Findings

- **File**: `plugins/yellow-ci/hooks/scripts/lib/validate.sh`
- **Unused functions**:
  - `validate_file_path()` (~60 lines) — 0 callers, has 10 bats tests
  - `validate_cache_dir()` (~30 lines) — 0 callers
  - `validate_numeric_range()` (~26 lines) — 0 callers, has tests
  - `validate_ssh_command()` (~21 lines) — 0 callers
- **Total**: ~137 lines (37% of validate.sh)

These were copied from yellow-ruvector template but are not needed for
yellow-ci's current functionality.

## Proposed Solutions

**Option 1: Keep as shared library (Recommended)**

- These functions provide a safety net for future commands/hooks
- validate_file_path has 10 dedicated tests (added in previous review round)
- Removing and re-adding later is more churn than keeping
- Add comment block marking them as "shared library — not all functions used by
  every plugin"
- **Effort**: Small
- **Risk**: None

**Option 2: Remove unused functions**

- Delete 4 functions and their tests
- -137 LOC in validate.sh, -40 LOC in validate.bats
- **Effort**: Small
- **Risk**: Low, but would need re-adding if future hooks need them

## Acceptance Criteria

- [ ] Either add "shared library" comment (Option 1) or remove functions
      (Option 2)
- [ ] If removing, update validate.bats to remove corresponding tests
- [ ] All remaining tests pass
