---
status: complete
priority: p2
issue_id: '079'
tags: [code-review, yellow-ci, error-handling]
dependencies: []
---

# Sanitize Log Pipeline Error Propagation

## Problem Statement

The `sanitize_log_content()` function pipes output through two filters
(`redact_secrets | escape_fence_markers`) without checking if either step
succeeded. If `redact_secrets` fails, empty or partial output passes through
silently, potentially exposing secrets or corrupting log data.

## Findings

**File:** `plugins/yellow-ci/hooks/scripts/lib/redact.sh`

**Lines 40-42:**

```bash
sanitize_log_content() {
    redact_secrets | escape_fence_markers
}
```

**Problem Analysis:**

1. **No Error Checking:**
   - If `redact_secrets` fails, pipeline continues
   - `escape_fence_markers` processes incomplete/empty input
   - Final output appears successful (exit code from last command)

2. **Potential Failure Modes:**
   - `redact_secrets` crashes or returns non-zero
   - Input contains patterns that break sed/awk
   - Resource exhaustion (memory, file descriptors)

3. **Security Risk:**
   - If `redact_secrets` fails, secrets might not be redacted
   - Partial redaction could expose sensitive data
   - Silent failure prevents detection

4. **Data Integrity:**
   - Incomplete output could corrupt log analysis
   - Missing content without indication of failure

## Proposed Solutions

**Option 1: Subshell with pipefail (Recommended)**

Enable `pipefail` to propagate errors from any stage:

```bash
sanitize_log_content() {
    (
        set -o pipefail
        redact_secrets | escape_fence_markers
    )
}
```

**Pros:**

- Minimal change to existing code
- Preserves pipeline efficiency
- Exit code reflects any stage failure

**Cons:**

- Doesn't indicate which stage failed

**Option 2: Explicit Intermediate Validation**

Capture intermediate result and check exit code:

```bash
sanitize_log_content() {
    local redacted
    redacted="$(redact_secrets)" || {
        printf '[yellow-ci] Error: Secret redaction failed\n' >&2
        return 1
    }

    printf '%s' "$redacted" | escape_fence_markers || {
        printf '[yellow-ci] Error: Fence marker escaping failed\n' >&2
        return 1
    }
}
```

**Pros:**

- Precise error reporting
- Can add recovery logic per stage
- Clear failure modes

**Cons:**

- More verbose
- Creates temporary variable
- Less efficient for large logs

## Technical Details

**File:** `plugins/yellow-ci/hooks/scripts/lib/redact.sh:40-42`

**Current Usage Locations:**

- `session-start.sh`: Sanitizes workflow run logs before display
- Any future code processing untrusted log content

**Testing:**

1. **Normal Operation:**

   ```bash
   echo "secret: sk_12345" | sanitize_log_content
   # Should redact and escape properly
   ```

2. **Redaction Failure:**

   ```bash
   # Mock redact_secrets to fail
   redact_secrets() { return 1; }
   echo "test" | sanitize_log_content
   # Should return non-zero and log error
   ```

3. **Escape Failure:**
   ```bash
   # Mock escape_fence_markers to fail
   escape_fence_markers() { return 1; }
   echo "test" | sanitize_log_content
   # Should return non-zero and log error
   ```

**Recommendation:** Use Option 1 (pipefail) for production code. It's simpler,
more efficient, and provides adequate safety. Option 2 can be used if detailed
error reporting is needed.

## Acceptance Criteria

- [ ] Pipeline errors propagate to caller
- [ ] Failed redaction prevents output from being used
- [ ] `set -o pipefail` enabled in sanitize_log_content
- [ ] Exit code reflects any pipeline stage failure
- [ ] Existing functionality preserved when pipeline succeeds
- [ ] Manual testing confirms error propagation
- [ ] No security regression (redaction failures detected)
