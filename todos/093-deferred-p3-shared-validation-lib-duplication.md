---
status: pending
priority: p3
issue_id: '093'
tags: [code-review, quality, duplication]
dependencies: []
---

# 🔵 P3: Shared Validation Lib Duplication

## Problem Statement

Both yellow-ruvector and yellow-debt maintain separate `lib/validate.sh` files
with overlapping implementations of path validation, canonicalization, and
symlink checks. This creates maintenance burden and risks divergence.

## Findings

**Overlapping Functions**:

- `validate_file_path()`: Path traversal rejection, canonicalization, symlink
  checks
- Both implement similar security patterns from project memory
- Located at:
  - `plugins/yellow-ruvector/hooks/scripts/lib/validate.sh`
  - `plugins/yellow-debt/lib/validate.sh`

**Common Patterns**:

- Reject `..`, `/`, `~` in names
- Canonicalize paths with `readlink -f`
- Skip symlinks: `[ -f "$f" ] && [ ! -L "$f" ]`
- Input validation before path construction

## Proposed Solutions

### Solution 1: Extract to Shared Repo-Level Library (Recommended)

Create `scripts/lib/validate-common.sh` at repository root with common
validation functions:

```bash
# scripts/lib/validate-common.sh

validate_file_path() {
    # Common implementation
}

validate_namespace() {
    # Common implementation
}

canonicalize_project_dir() {
    # Common implementation
}
```

Update both plugins to source the shared library:

```bash
# shellcheck source=../../../../scripts/lib/validate-common.sh
. "$(dirname "$0")/../../../../scripts/lib/validate-common.sh"
```

Keep plugin-specific validation in plugin-local lib files.

### Solution 2: Create Shared Plugin

Move to a new `yellow-shell-utils` plugin that both plugins depend on. More
overhead, less justified for pure library code.

### Solution 3: Accept Duplication

Keep separate implementations if plugins should remain independent. Divergence
risk remains.

## Recommended Action

Apply Solution 1: extract common validation functions to
`scripts/lib/validate-common.sh`.

This reduces duplication while keeping plugins independently installable (shared
lib is in repo, not a plugin dependency).

## Acceptance Criteria

- [ ] Common validation functions extracted to `scripts/lib/validate-common.sh`
- [ ] Both yellow-ruvector and yellow-debt source shared library
- [ ] Plugin-specific functions remain in plugin-local lib files
- [ ] All tests pass (yellow-ruvector has 42 Bats tests)
- [ ] No functional changes to validation behavior

## Work Log

**2026-02-15**: Finding identified during comprehensive plugin marketplace
review.

## Resources

- Plugin marketplace review session
- Files:
  - `plugins/yellow-ruvector/hooks/scripts/lib/validate.sh`
  - `plugins/yellow-debt/lib/validate.sh`
- Project memory: Shared validation lib pattern
