---
status: complete
priority: p2
issue_id: '074'
tags: [code-review, yellow-ci, quality, performance]
dependencies: []
---

# Extract Shared Newline Check Helper

## Problem Statement

The newline rejection pattern (tr -d '\n\r' + length comparison) is duplicated 7
times across multiple validation functions in the validate.sh library. Each
instance creates a subprocess, leading to code duplication and unnecessary
performance overhead.

## Findings

**File:** `plugins/yellow-ci/hooks/scripts/lib/validate.sh`

**Affected Functions:**

- validate_file_path
- validate_runner_name
- validate_run_id
- validate_repo_slug
- validate_ssh_host
- validate_ssh_user
- validate_ssh_command

**Current Pattern (repeated 7 times):**

```bash
stripped="$(printf '%s' "$value" | tr -d '\n\r')"
if [ ${#stripped} -ne ${#value} ]; then
    return 1
fi
```

**Impact:**

- Code duplication across 7 functions
- Each call creates a subprocess for tr command
- Maintenance burden: changes require updating 7 locations

## Proposed Solutions

Extract a `has_newline()` helper function at the top of the file, after the
initial setup but before the first validation function.

**Implementation:**

```bash
# Check if string contains newline or carriage return
# Returns 0 if newline found, 1 if clean
has_newline() {
    local value="$1"
    local stripped
    stripped="$(printf '%s' "$value" | tr -d '\n\r')"
    [ ${#stripped} -ne ${#value} ]
}
```

**Usage in validation functions:**

```bash
if has_newline "$file_path"; then
    return 1
fi
```

## Technical Details

**Location:** Top of `plugins/yellow-ci/hooks/scripts/lib/validate.sh`, after
initial comments and before first validation function

**Functions to Update:**

1. validate_file_path (line ~45)
2. validate_runner_name (line ~115)
3. validate_run_id (line ~155)
4. validate_repo_slug (line ~195)
5. validate_ssh_host (line ~235)
6. validate_ssh_user (line ~275)
7. validate_ssh_command (line ~315)

**Benefits:**

- Single implementation to maintain
- Subprocess creation still occurs but logic is centralized
- Easier to optimize in future (e.g., bash parameter expansion if pattern
  allows)
- Consistent behavior across all validators

## Acceptance Criteria

- [ ] `has_newline()` helper function added at top of validate.sh
- [ ] All 7 validation functions updated to use helper
- [ ] No change in validation behavior (all tests pass)
- [ ] Bats test suite passes: `bats plugins/yellow-ci/tests/validate.bats`
- [ ] No duplicate newline check logic remains
