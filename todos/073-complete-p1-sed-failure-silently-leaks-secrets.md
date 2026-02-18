---
status: complete
priority: p1
issue_id: '073'
tags: [code-review, yellow-ci, security]
dependencies: []
---

# Fix Secret Leakage on sed Failure in redact.sh

## Problem Statement

The `redact_secrets()` function in
`plugins/yellow-ci/hooks/scripts/lib/redact.sh` is implemented as a single sed
pipeline with no error checking. If sed fails for any reason (invalid locale,
binary data, out of memory, corrupted input), the function either:

1. Returns the raw unredacted input (worst case)
2. Returns empty output (silent failure)
3. Returns partial output with some secrets unredacted

Additionally, `sanitize_log_content()` uses a pipe without `set -o pipefail`,
meaning sed failures propagate through the pipeline silently. This is a critical
security vulnerability because failure modes can leak secrets.

## Findings

**Location:** `plugins/yellow-ci/hooks/scripts/lib/redact.sh:13-28`

**Current Code:**

```bash
redact_secrets() {
    local content="$1"

    printf '%s' "$content" | sed \
        -e 's/\bAKIA[A-Z0-9]\{16\}\b/[REDACTED:aws-key]/g' \
        -e 's/\b[A-Za-z0-9/+=]\{40\}\b/[REDACTED:aws-secret]/g' \
        # ... more patterns ...
}

sanitize_log_content() {
    local content="$1"

    redact_secrets "$content"
}
```

**Failure Scenarios:**

1. **Invalid Locale:**
   - sed fails with `LC_CTYPE` errors on certain byte sequences
   - Returns partial output or nothing

2. **Binary Data:**
   - sed may fail on null bytes or binary content in logs
   - Error: "sed: couldn't write N items to stdout: Broken pipe"

3. **Out of Memory:**
   - Very large log inputs (multi-MB) can exhaust sed buffers
   - sed exits with code 1, no output

4. **Regex Engine Errors:**
   - Malformed UTF-8 can cause regex matching errors
   - sed may skip patterns or fail entirely

5. **Signal Interruption:**
   - SIGPIPE if downstream consumer closes (unlikely but possible)

**Impact:**

- If sed fails and returns raw input, secrets leak
- If sed fails silently (no output), CI job fails but reason is unclear
- No error handling means no fallback to safe redaction

**Related Issue:**

- `sanitize_log_content()` lacks `set -o pipefail`
- Pipe failures don't propagate: `redact_secrets "$content" | other_command`
  would hide sed errors

## Proposed Solutions

### Option 1: Capture Exit Code + Fallback to Full Redaction (Recommended)

**Replace `redact_secrets()` with:**

```bash
redact_secrets() {
    local content="$1"
    local redacted

    # Attempt redaction, capture both output and exit code
    redacted=$(printf '%s' "$content" | sed \
        -e 's/\bAKIA[A-Z0-9]\{16\}\b/[REDACTED:aws-key]/g' \
        -e 's/\b[A-Za-z0-9/+=]\{40\}\b/[REDACTED:aws-secret]/g' \
        -e 's/\b[A-Za-z0-9/+=]\{32,\}\b/[REDACTED:api-key]/g' \
        -e 's/ghp_[A-Za-z0-9]\{36\}/[REDACTED:github-token]/g' \
        -e 's/gho_[A-Za-z0-9]\{36\}/[REDACTED:github-oauth]/g' \
        -e 's/ghs_[A-Za-z0-9]\{36\}/[REDACTED:github-secret]/g' \
        -e 's/\bey[A-Za-z0-9_-]\{10,\}\.[A-Za-z0-9_-]\{10,\}\.[A-Za-z0-9_-]\{10,\}/[REDACTED:jwt]/g' \
        2>&1) || {
        # If sed fails, redact everything rather than risk leaking secrets
        printf '[REDACTED: sanitization failed - output suppressed for security]\n' >&2
        return 1
    }

    printf '%s' "$redacted"
}
```

**Update `sanitize_log_content()`:**

```bash
sanitize_log_content() {
    local content="$1"

    # Enable pipefail in subshell to catch redaction failures
    (
        set -o pipefail
        redact_secrets "$content"
    ) || {
        printf '[ERROR: Log sanitization failed]\n' >&2
        return 1
    }
}
```

**Pros:**

- Safe failure mode: if redaction fails, output is completely suppressed
- Explicit error logging to stderr
- No secrets leak on failure
- Maintains defense-in-depth principle

**Cons:**

- On failure, loses all log content (but this is safer than leaking secrets)
- Slightly more complex than current implementation

### Option 2: Try-Catch with LC_ALL=C Fallback

**Retry with safe locale on failure:**

```bash
redact_secrets() {
    local content="$1"
    local redacted

    # First attempt with user locale
    redacted=$(printf '%s' "$content" | sed -e '...' 2>&1) && {
        printf '%s' "$redacted"
        return 0
    }

    # Fallback: retry with C locale (handles binary data better)
    redacted=$(LC_ALL=C printf '%s' "$content" | sed -e '...' 2>&1) && {
        printf '%s' "$redacted"
        return 0
    }

    # Both failed: redact everything
    printf '[REDACTED: sanitization failed]\n' >&2
    return 1
}
```

**Pros:**

- More resilient: tries to salvage logs with locale fallback
- Better user experience (more logs retained)

**Cons:**

- More complex
- Still might fail on binary data or OOM

### Option 3: Add Input Validation Before Redaction

**Pre-flight checks:**

```bash
redact_secrets() {
    local content="$1"

    # Validate input is not too large (prevent OOM)
    if [ "${#content}" -gt 1048576 ]; then  # 1MB limit
        printf '[REDACTED: log output exceeds size limit]\n' >&2
        return 1
    fi

    # Validate input is text (no null bytes)
    if printf '%s' "$content" | grep -q $'\0'; then
        printf '[REDACTED: binary data in log output]\n' >&2
        return 1
    fi

    # Proceed with redaction (still needs error handling)
    printf '%s' "$content" | sed -e '...' || {
        printf '[REDACTED: sanitization failed]\n' >&2
        return 1
    }
}
```

**Pros:**

- Prevents common failure scenarios proactively
- Clear error messages for different failure modes

**Cons:**

- More overhead (grep for null bytes on every log)
- Might reject legitimate logs

## Technical Details

**File:** `plugins/yellow-ci/hooks/scripts/lib/redact.sh` **Functions:**
`redact_secrets()`, `sanitize_log_content()` **Lines:** 13-28

**sed Exit Codes:**

- 0: Success
- 1: Generic error (regex error, I/O error)
- 2: Usage error (invalid command syntax)

**Bash Pipe Failure Handling:**

```bash
# Without pipefail (current behavior):
false | true  # Exit code: 0 (only last command matters)

# With pipefail:
set -o pipefail
false | true  # Exit code: 1 (first failure propagates)
```

**Security Principle:**

- **Fail-closed:** On error, suppress output entirely rather than risk leaking
  secrets
- **Explicit errors:** Log failures to stderr so they're visible in CI system
  logs
- **Defense in depth:** Assume sed can fail; design for graceful degradation

**Testing Failure Modes:**

```bash
# Test 1: Binary data (null byte)
printf 'secret\x00data' | sed -e 's/secret/[REDACTED]/g'
# May fail or produce unexpected output

# Test 2: Invalid UTF-8
printf '\xff\xfe invalid utf8' | sed -e 's/invalid/[REDACTED]/g'
# May fail with locale errors

# Test 3: Very large input
dd if=/dev/zero bs=1M count=10 | sed -e 's/./X/g'
# May fail with OOM

# Test 4: Interrupted pipe
printf 'data' | sed -e 's/./X/g' | head -c 0
# May generate SIGPIPE
```

## Acceptance Criteria

- [ ] `redact_secrets()` captures sed exit code and handles failures
- [ ] On sed failure, function returns `[REDACTED: sanitization failed]` to
      stderr
- [ ] On sed failure, function returns exit code 1 (not 0)
- [ ] No raw unredacted content is returned on failure
- [ ] `sanitize_log_content()` uses `set -o pipefail` in subshell
- [ ] Test with binary input (null bytes) confirms safe failure mode
- [ ] Test with invalid UTF-8 confirms safe failure mode
- [ ] Test with normal log content confirms redaction still works
- [ ] All existing Bats tests pass
- [ ] Security review confirms no secret leakage on failure paths
