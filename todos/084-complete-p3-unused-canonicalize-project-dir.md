---
status: complete
priority: p3
issue_id: "084"
tags: [code-review, yellow-ci, simplicity]
dependencies: []
---

# Unused canonicalize_project_dir Function

## Problem Statement

The `canonicalize_project_dir()` function in `plugins/yellow-ci/hooks/scripts/lib/validate.sh` is defined but never called by any yellow-ci component. This violates YAGNI (You Aren't Gonna Need It) principles.

## Findings

- **File**: `plugins/yellow-ci/hooks/scripts/lib/validate.sh`
- **Lines**: 8-24
- **Function**: `canonicalize_project_dir()`
- **Usage**: No callers in yellow-ci plugin

The function was likely included from the yellow-ruvector template (which does use it) but isn't needed for yellow-ci's simpler validation needs.

## Proposed Solutions

**Option 1 (Preferred - YAGNI):**
Remove the unused function entirely:
- Reduces code surface area
- Eliminates maintenance burden
- Follows "delete unused code" principle

**Option 2 (Alternative):**
Add a comment marking it as shared library function:
```bash
# canonicalize_project_dir() - Shared library function
# Not currently used by yellow-ci, but available for future hooks
canonicalize_project_dir() {
  ...
}
```

Prefer Option 1 unless there's a near-term plan to use this function.

## Technical Details

The function provides:
- PWD-based canonicalization
- Git root detection
- Fallback path handling

Yellow-ci currently has no code paths that need this level of path normalization. All current hooks operate on fixed relative paths from the plugin root.

## Acceptance Criteria

- [ ] Remove `canonicalize_project_dir()` from `lib/validate.sh` (Option 1), OR
- [ ] Add comment documenting it as unused shared library function (Option 2)
- [ ] Verify no yellow-ci component calls this function
- [ ] Update any documentation that references this function
- [ ] Confirm validation tests still pass after removal
