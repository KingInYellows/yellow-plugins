# Yellow-CI Shell Script Fixes — Action Plan

**Date:** 2026-02-16
**Priority:** Critical fix required before merge
**Estimated time:** 15 minutes

## Critical Fix (Required)

### C1: Fix Numeric Comparison in validate_run_id()

**File:** `/home/kinginyellow/projects/yellow-plugins/plugins/yellow-ci/hooks/scripts/lib/validate.sh`
**Line:** 140

**Current code:**
```bash
if [ ${#id} -eq 16 ] && [ "$id" \> "9007199254740991" ]; then
  return 1
fi
```

**Fixed code:**
```bash
if [ ${#id} -eq 16 ] && (( id > 9007199254740991 )); then
  return 1
fi
```

**Rationale:**
- The `\>` operator performs lexicographic comparison, not numeric
- For 16-digit numbers, this causes incorrect validation
- Example: `"8000000000000000" \> "9007199254740991"` returns false (wrong)
- Arithmetic expansion `(( ))` provides correct numeric comparison

**Test to add:**
```bash
# File: tests/validate.bats
# Add after line 99 (current max value test)

@test "run_id: reject exceeds max safe integer by 1" {
  run validate_run_id "9007199254740992"
  [ "$status" -eq 1 ]
}

@test "run_id: reject large 16-digit exceeds max" {
  run validate_run_id "9999999999999999"
  [ "$status" -eq 1 ]
}
```

## High Priority (Recommended)

### H1: Add set -euo pipefail to Library Scripts

**Files:**
- `/home/kinginyellow/projects/yellow-plugins/plugins/yellow-ci/hooks/scripts/lib/validate.sh`
- `/home/kinginyellow/projects/yellow-plugins/plugins/yellow-ci/hooks/scripts/lib/redact.sh`

**Change:**
```bash
#!/bin/bash
set -euo pipefail  # ADD THIS LINE
# shellcheck disable=SC2154
# validate.sh — Shared validation functions for yellow-ci hooks and commands
```

**Rationale:**
- Ensures errors in sourced functions propagate correctly
- Catches unset variable usage early
- Aligns with session-start.sh which already uses strict mode
- All validation functions use explicit returns, so safe to add

### H2: Add ShellCheck Source Directive

**File:** `/home/kinginyellow/projects/yellow-plugins/plugins/yellow-ci/hooks/scripts/session-start.sh`
**Line:** 10-11

**Current:**
```bash
SCRIPT_DIR="$(cd -- "$(dirname "$0")" 2>/dev/null && pwd -P)"

# shellcheck source=lib/validate.sh
. "${SCRIPT_DIR}/lib/validate.sh"
```

**Fixed:**
```bash
SCRIPT_DIR="$(cd -- "$(dirname "$0")" 2>/dev/null && pwd -P)"

# shellcheck source=hooks/scripts/lib/validate.sh
. "${SCRIPT_DIR}/lib/validate.sh"
```

**Rationale:**
- Eliminates SC1091 info warning
- Allows ShellCheck to cross-check sourced functions

## Optional Improvements

### L1: Extract Timeout Constants

**File:** `/home/kinginyellow/projects/yellow-plugins/plugins/yellow-ci/hooks/scripts/session-start.sh`
**Lines:** Top of file (after set flags)

**Add:**
```bash
set -euo pipefail

# Configuration
readonly GH_API_TIMEOUT=2       # seconds (line 57)
readonly CACHE_TTL_SECONDS=60   # seconds (line 46)

SCRIPT_DIR="$(cd -- "$(dirname "$0")" 2>/dev/null && pwd -P)"
```

**Update usage:**
```bash
# Line 46
if [ "$cache_age" -lt "$CACHE_TTL_SECONDS" ]; then

# Line 57
if ! failed_json=$(timeout "$GH_API_TIMEOUT" gh run list ...); then
```

### L2: Standardize Error Messages

**Pattern to adopt:**
```bash
printf '[yellow-ci] ERROR: %s\n' "message" >&2
printf '[yellow-ci] WARN: %s\n' "message" >&2
printf '[yellow-ci] INFO: %s\n' "message" >&2
```

**Files to update:**
- session-start.sh lines 71, 97, 101
- redact.sh lines 31, 53

## Verification Steps

After making changes:

```bash
# 1. Run ShellCheck
cd plugins/yellow-ci
shellcheck hooks/scripts/lib/validate.sh hooks/scripts/lib/redact.sh hooks/scripts/session-start.sh

# Expected: 0 errors, 0 warnings

# 2. Run test suite
bats tests/*.bats

# Expected: 125 tests passing (82 + 24 + 17 + 2 new tests)

# 3. Validate plugin
cd ../..
pnpm validate:plugins

# Expected: ✓ yellow-ci plugin valid
```

## Git Workflow

```bash
# Create fix branch
gt branch create fix/yellow-ci-shell-numeric-comparison

# Make changes (C1 + H1 + H2)
# Edit files listed above

# Commit
gt modify -c "fix(yellow-ci): correct numeric comparison in validate_run_id

- Replace string comparison operator with arithmetic expansion
- Add set -euo pipefail to library scripts for error propagation
- Add ShellCheck source directive to eliminate SC1091 warning
- Add test cases for JS safe integer boundary validation

Fixes critical bug where run IDs > 9007199254740991 could pass
validation when they should fail due to JavaScript safe integer limit.

Resolves: Shell Security Review C1, H1, H2"

# Run validation
shellcheck hooks/scripts/lib/validate.sh hooks/scripts/lib/redact.sh hooks/scripts/session-start.sh
bats tests/*.bats

# Submit PR
gt submit --no-interactive
```

## Estimated Impact

**Before:**
- 1 critical bug (numeric comparison)
- 1 info warning (SC1091)
- Library scripts lack strict mode

**After:**
- 0 errors
- 0 warnings
- Full ShellCheck compliance
- Enhanced error propagation
- 2 additional boundary tests

**Breaking changes:** None
**Backwards compatibility:** 100%
**Test pass rate:** 125/125 (100%)
