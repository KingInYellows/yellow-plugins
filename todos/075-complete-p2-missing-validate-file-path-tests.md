---
status: complete
priority: p2
issue_id: '075'
tags: [code-review, yellow-ci, testing]
dependencies: []
---

# Missing validate_file_path Tests

## Problem Statement

The `validate_file_path()` function has zero test coverage in validate.bats.
It's the most complex validation function in the library (handling symlink
resolution, path traversal, newline rejection) and needs comprehensive test
coverage.

## Findings

**File:** `plugins/yellow-ci/tests/validate.bats`

**Current State:**

- validate.bats contains tests for validate_runner_name, validate_run_id,
  validate_repo_slug, validate_ssh_host, validate_ssh_user, validate_ssh_command
- validate_file_path() has NO tests
- The function is complex, handling:
  - Path traversal prevention (..)
  - Absolute path rejection
  - Newline injection prevention
  - Symlink resolution
  - Project root boundary enforcement

**Risk:** Without tests, changes to validate_file_path() could introduce
security vulnerabilities or break existing behavior without detection.

## Proposed Solutions

Add comprehensive test coverage for validate_file_path() covering all validation
branches and edge cases.

**Test Categories:**

1. **Valid Paths:**
   - Basic relative path within project
   - Nested path within project
   - Path with spaces
   - Path with special characters (hyphens, underscores)

2. **Path Traversal:**
   - `../` at start
   - `../` in middle
   - Multiple `../../` sequences
   - Hidden traversal: `foo/../bar`

3. **Absolute Paths:**
   - `/absolute/path`
   - Path starting with `/`

4. **Invalid Input:**
   - Empty path
   - Whitespace-only path
   - Newline injection
   - Carriage return injection

5. **Symlinks:**
   - Symlink pointing to file inside project root
   - Symlink pointing to file outside project root
   - Dangling symlink

## Technical Details

**File:** `plugins/yellow-ci/tests/validate.bats`

**Implementation Approach:**

```bash
@test "validate_file_path accepts valid relative path" {
    run validate_file_path "plugins/yellow-ci/plugin.json"
    [ "$status" -eq 0 ]
}

@test "validate_file_path rejects path traversal with .." {
    run validate_file_path "../outside.txt"
    [ "$status" -eq 1 ]
}

@test "validate_file_path rejects absolute path" {
    run validate_file_path "/etc/passwd"
    [ "$status" -eq 1 ]
}

@test "validate_file_path rejects newline injection" {
    run validate_file_path "$(printf 'file\ninjection.txt')"
    [ "$status" -eq 1 ]
}

@test "validate_file_path accepts symlink within project" {
    # Setup: create symlink in test fixture
    local target="$BATS_TEST_TMPDIR/target.txt"
    local link="$BATS_TEST_TMPDIR/link.txt"
    echo "content" > "$target"
    ln -s "$target" "$link"

    run validate_file_path "$link"
    [ "$status" -eq 0 ]
}

@test "validate_file_path rejects symlink outside project" {
    # Setup: create symlink pointing outside project root
    local link="$BATS_TEST_TMPDIR/link.txt"
    ln -s "/etc/passwd" "$link"

    run validate_file_path "$link"
    [ "$status" -eq 1 ]
}
```

**Estimated Tests:** 10-15 tests covering all branches

## Acceptance Criteria

- [ ] At least 10 tests for validate_file_path() added to validate.bats
- [ ] All validation branches covered (path traversal, absolute path, newline,
      symlink)
- [ ] Edge cases tested (empty path, whitespace, special characters)
- [ ] Symlink tests verify both inside and outside project root scenarios
- [ ] All tests pass: `bats plugins/yellow-ci/tests/validate.bats`
- [ ] Test coverage matches the complexity of the function
