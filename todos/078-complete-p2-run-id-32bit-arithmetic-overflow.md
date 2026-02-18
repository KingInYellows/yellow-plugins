---
status: complete
priority: p2
issue_id: "078"
tags: [code-review, yellow-ci, portability]
dependencies: []
---

# Run ID 32-bit Arithmetic Overflow

## Problem Statement

The `validate_run_id()` function uses arithmetic comparison to validate that run IDs don't exceed JavaScript's MAX_SAFE_INTEGER (9007199254740991). On 32-bit shells, this comparison overflows (max 2^31-1 = 2147483647), and the `2>/dev/null` suppresses the error, causing the validation to be silently skipped.

## Findings

**File:** `plugins/yellow-ci/hooks/scripts/lib/validate.sh`

**Lines 160-161:**
```bash
# Prevent values exceeding JavaScript MAX_SAFE_INTEGER
if [ "$id" -gt 9007199254740991 ] 2>/dev/null; then
    return 1
fi
```

**Problem Analysis:**

1. **32-bit Shell Overflow:**
   - Maximum signed 32-bit integer: 2,147,483,647
   - MAX_SAFE_INTEGER: 9,007,199,254,740,991
   - Comparison overflows on 32-bit systems

2. **Silent Failure:**
   - `2>/dev/null` suppresses the overflow error
   - Check is skipped entirely on overflow
   - Invalid run IDs pass through undetected

3. **Existing Redundancy:**
   - Line 163 already checks: `if [ ${#id} -gt 16 ]; then return 1; fi`
   - MAX_SAFE_INTEGER has exactly 16 digits
   - Length check alone is sufficient to reject values > MAX_SAFE_INTEGER

**Impact:**
- Portability issue on 32-bit systems
- Validation check ineffective but redundant
- Could allow IDs with 16 digits > MAX_SAFE_INTEGER (e.g., 9999999999999999)

## Proposed Solutions

**Option 1: String Comparison (Recommended)**

Use lexicographic comparison for equal-length digit strings. For 16-digit numbers, string comparison is equivalent to numeric comparison.

```bash
# Prevent values exceeding JavaScript MAX_SAFE_INTEGER (2^53 - 1)
if [ "${#id}" -eq 16 ] && [ "$id" \> "9007199254740991" ]; then
    return 1
fi
# Reject any ID longer than 16 digits
if [ "${#id}" -gt 16 ]; then
    return 1
fi
```

**Option 2: Length-Only Check (Simplest)**

Remove the MAX_SAFE_INTEGER check entirely and rely on length validation:

```bash
# GitHub run IDs are positive integers up to 16 digits (MAX_SAFE_INTEGER)
if [ "${#id}" -gt 16 ]; then
    return 1
fi
```

**Rationale:** Any 17+ digit positive integer exceeds MAX_SAFE_INTEGER. For 16-digit numbers, only values > 9007199254740991 exceed it, but these are extremely rare in practice.

## Technical Details

**File:** `plugins/yellow-ci/hooks/scripts/lib/validate.sh:160-163`

**String Comparison Details:**
- Bash `\>` operator performs lexicographic comparison
- For equal-length digit strings, lexicographic == numeric order
- `"9999999999999999" \> "9007199254740991"` correctly returns true
- `"1234567890123456" \> "9007199254740991"` correctly returns false

**Test Cases:**
```bash
# Valid: exactly MAX_SAFE_INTEGER
validate_run_id "9007199254740991"  # should pass

# Invalid: exceeds MAX_SAFE_INTEGER
validate_run_id "9007199254740992"  # should fail
validate_run_id "9999999999999999"  # should fail

# Invalid: too many digits
validate_run_id "12345678901234567"  # should fail
```

## Acceptance Criteria

- [ ] Arithmetic comparison removed from validate_run_id()
- [ ] String comparison implemented for 16-digit MAX_SAFE_INTEGER check
- [ ] Length check retained for 17+ digit rejection
- [ ] Works correctly on both 32-bit and 64-bit shells
- [ ] No error suppression with `2>/dev/null`
- [ ] Tests added to validate.bats for boundary cases
- [ ] All existing tests pass
