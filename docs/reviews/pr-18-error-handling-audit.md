# PR #18 Error Handling Audit — yellow-ci Plugin

**Auditor:** Error Handling Specialist
**Date:** 2026-02-16
**Scope:** Shell scripts in `plugins/yellow-ci/hooks/scripts/`
**Focus Areas:**
1. Silent failure detection
2. Redaction pipeline robustness
3. Session hook degradation behavior
4. Validation function edge cases

---

## Executive Summary

**Total Issues Found:** 14 (5 CRITICAL, 6 HIGH, 3 MEDIUM)

**Critical Failures:**
- Silent sed failures in redaction pipeline could leak secrets
- Validation functions fail silently on arithmetic edge cases
- Session hook suppresses critical diagnostic errors
- Missing error logging in canonicalization fallbacks
- TOCTOU vulnerability with inadequate logging

**Overall Assessment:** The code demonstrates good awareness of security patterns (path traversal, injection prevention, TOCTOU), but **error handling is dangerously inadequate**. Multiple silent failure modes could result in:
1. **Secret leakage** (redaction failures)
2. **Security bypasses** (validation false positives)
3. **Invisible hook failures** (users unaware of broken functionality)

---

## CRITICAL Issues

### 1. Silent sed Failures in Redaction Pipeline

**Location:** `/home/kinginyellow/projects/yellow-plugins/plugins/yellow-ci/hooks/scripts/lib/redact.sh:14-28`

**Severity:** CRITICAL (silent failure, secret leakage risk)

**Issue Description:**
The `redact_secrets()` function consists of a single `sed` command with 13 `-e` expressions. If **any single sed expression has invalid syntax or fails**, sed will exit with non-zero status, but because there is no error checking, the function will return 0 and **the ENTIRE pipeline will fail silently**.

**Hidden Errors:**
- Invalid regex syntax in any of the 13 patterns (e.g., unescaped metacharacters)
- Sed implementation differences (GNU vs BSD) causing incompatible pattern syntax
- Memory exhaustion on very large log files (sed buffer overflow)
- Locale-dependent character class failures (`[[:space:]]` in non-UTF8 locales)
- Pipe failure if downstream consumer (e.g., `escape_fence_markers`) fails

**User Impact:**
**If redaction fails, raw unredacted secrets will be displayed to users and potentially logged to disk.** Users will have no warning that redaction failed. This is a **severe security vulnerability**.

**Example Scenario:**
```bash
# If one sed pattern is malformed (e.g., missing closing bracket):
echo "Bearer ghp_secrettoken123456789012345678901234" | redact_secrets
# Output: Bearer ghp_secrettoken123456789012345678901234
# Exit code: 0 (success!)
# No error message, secret leaked
```

**Recommendation:**

Add explicit error checking and fallback behavior:

```bash
redact_secrets() {
  local exit_code=0
  sed \
    -e 's/ghp_[A-Za-z0-9_]\{36,255\}/[REDACTED:github-token]/g' \
    -e 's/ghs_[A-Za-z0-9_]\{36,255\}/[REDACTED:github-token]/g' \
    # ... rest of patterns
  exit_code=$?

  if [ $exit_code -ne 0 ]; then
    printf '[yellow-ci] CRITICAL: Secret redaction failed (sed exit %d). Raw output suppressed.\n' "$exit_code" >&2
    printf '[REDACTED:pipeline-failure]\n'
    return 1
  fi
  return 0
}
```

**Alternative (safer):** Validate each pattern at function load time:

```bash
# Test all sed patterns on load
if ! printf 'test' | sed -e 's/ghp_[A-Za-z0-9_]\{36,255\}/X/g' >/dev/null 2>&1; then
  printf '[yellow-ci] FATAL: Invalid sed pattern in redact_secrets\n' >&2
  exit 1
fi
```

---

### 2. Arithmetic Comparison Silently Fails on Invalid Input

**Location:** `/home/kinginyellow/projects/yellow-plugins/plugins/yellow-ci/hooks/scripts/lib/validate.sh:367-369`

**Severity:** CRITICAL (validation bypass, logic error)

**Issue Description:**
The `validate_numeric_range()` function has a **logic error** that allows invalid inputs to pass validation:

```bash
367  if [ "$value" -lt "$min" ] 2>/dev/null && [ "$value" -gt "$max" ] 2>/dev/null; then
368    return 1
369  fi
```

**The condition uses `&&` (AND), which means it only rejects values that are BOTH less than min AND greater than max — a mathematically impossible condition.** This line can never trigger, and errors are suppressed with `2>/dev/null`.

**Hidden Errors:**
- Non-numeric input like `"abc"` will fail the `-lt` comparison, but the `2>/dev/null` hides the error
- The function will fall through to lines 370-375, where it **might** catch the error (if those comparisons work)
- But if min/max are also invalid, all comparisons fail silently and the function **returns 0 (success)** on line 377

**User Impact:**
Invalid numeric inputs could pass validation and be used in paths, SSH commands, or API calls, leading to:
- Command injection if validation is bypassed
- Incorrect cache TTL values (line 46 in session-start.sh uses numeric validation)
- Wrong run ID values accepted

**Proof of Failure:**
```bash
validate_numeric_range "abc" 0 100  # Returns 0 (success!) on some shells
validate_numeric_range "" 0 100     # Returns 1, but for wrong reason (line 356, not logic)
```

**Recommendation:**

Fix the logic and add explicit error logging:

```bash
validate_numeric_range() {
  local value="$1"
  local min="$2"
  local max="$3"

  if [ -z "$value" ]; then
    return 1
  fi

  # Must be digits only (with optional leading minus for negative)
  case "$value" in
    *[!0-9-]*) return 1 ;;
    -*[!0-9]*) return 1 ;;
  esac

  # Numeric comparison with explicit error checking
  if ! [ "$value" -ge "$min" ] 2>/dev/null; then
    printf '[yellow-ci] validate_numeric_range: %s < %s\n' "$value" "$min" >&2
    return 1
  fi
  if ! [ "$value" -le "$max" ] 2>/dev/null; then
    printf '[yellow-ci] validate_numeric_range: %s > %s\n' "$value" "$max" >&2
    return 1
  fi

  return 0
}
```

**Remove the impossible condition** on lines 367-369 entirely.

---

### 3. Session Hook Suppresses All Errors

**Location:** `/home/kinginyellow/projects/yellow-plugins/plugins/yellow-ci/hooks/scripts/session-start.sh:16-27, 32, 56-61`

**Severity:** CRITICAL (silent failure, broken functionality invisible to users)

**Issue Description:**
The session hook has multiple `exit 0` early returns and error suppression that make it **impossible to detect when the hook is broken**:

- Line 16: Missing `.github/workflows` → exit 0 (fine)
- Line 22: `gh` CLI not installed → exit 0 (fine)
- Line 26: `gh auth status` fails → exit 0 (**PROBLEM: could be expired token, corrupted config**)
- Line 32: Cache directory creation fails → exit 0 (**PROBLEM: could be permissions issue**)
- Line 57-61: `gh run list` fails → exit 0 (**PROBLEM: could be network, API, auth, quota**)

**Hidden Errors:**
- GitHub CLI authentication expires → hook silently stops working, users never know
- Network connectivity issues → hook fails, no indication
- API rate limiting → hook fails, no warning
- Filesystem permissions prevent cache creation → hook degrades, no error
- `timeout` command not available → `gh` hangs indefinitely
- `jq` not installed → `failure_count` stays 0 even with failures

**User Impact:**
**Users rely on this hook to notify them of CI failures**. If the hook silently stops working (auth expires, network flakes, rate limit hit), **users will miss critical CI failure notifications** and won't realize the hook is broken until they manually check.

**This fallback masks the real problem** — users think the hook is working, but it's not.

**Recommendation:**

Add diagnostic logging for unexpected failures (not user configuration issues):

```bash
# Line 26: Distinguish "not configured" from "broken"
if ! gh auth status >/dev/null 2>&1; then
  if gh auth status 2>&1 | grep -q 'not logged'; then
    exit 0  # Not configured, expected
  else
    printf '[yellow-ci] Warning: gh auth check failed (not auth-related)\n' >&2
    exit 0
  fi
fi

# Line 32: Log cache creation failures
mkdir -p "$cache_dir" 2>/dev/null || {
  printf '[yellow-ci] Warning: Cannot create cache dir %s\n' "$cache_dir" >&2
  exit 0
}

# Line 57-61: Distinguish error types
if ! failed_json=$(timeout 2 gh run list --status failure --limit 3 \
  --json databaseId,headBranch,displayTitle,conclusion,updatedAt \
  -q '[.[] | select(.conclusion == "failure")]' 2>&1); then

  case "$failed_json" in
    *"API rate limit"*|*"429"*)
      printf '[yellow-ci] CI check skipped: GitHub API rate limited\n' >&2
      ;;
    *"authentication"*|*"401"*|*"403"*)
      printf '[yellow-ci] CI check skipped: GitHub authentication issue\n' >&2
      ;;
    *"network"*|*"timeout"*)
      # Transient, don't log
      ;;
    *)
      printf '[yellow-ci] CI check failed: %s\n' "${failed_json}" >&2
      ;;
  esac
  exit 0
fi
```

**Add a health check command** so users can verify the hook is working:

```bash
# In commands/ci/status.md or diagnose.md:
# Test if session hook is functional:
bash plugins/yellow-ci/hooks/scripts/session-start.sh
```

---

### 4. Canonicalization Fallback Hides Path Traversal

**Location:** `/home/kinginyellow/projects/yellow-plugins/plugins/yellow-ci/hooks/scripts/lib/validate.sh:11-23`

**Severity:** CRITICAL (security bypass via path confusion)

**Issue Description:**
The `canonicalize_project_dir()` function has three fallback paths:
1. Try `cd+pwd` (lines 11-14)
2. Try `realpath` (lines 15-19)
3. Fall back to raw path (lines 21-23)

**All three fallbacks print warnings to stderr but still return the potentially unsafe path.** The function **never fails** — it always returns *some* path, even if canonicalization completely failed.

**Hidden Errors:**
- Symlink outside project root → `cd+pwd` fails → falls back to `realpath` → falls back to **raw symlink path**
- This raw path is then used by `validate_file_path()`, which DOES try to resolve symlinks (lines 54-73), but if `realpath` and `readlink` both fail (line 67), **it returns 1 (failure), blocking legitimate access**
- However, if the directory check on line 10 passes but cd fails (e.g., NFS mount stale), the raw path is returned **without validation**

**User Impact:**
In edge cases (NFS mounts, permission changes mid-validation, race conditions), the fallback to raw path could allow:
- Path traversal via symlinks outside project root
- Use of relative paths in security-sensitive contexts
- Inconsistent behavior between systems with/without `realpath`

**Proof of Issue:**
```bash
# Create malicious symlink
ln -s /etc/passwd /tmp/fake-project
canonicalize_project_dir "/tmp/fake-project"
# Output: /tmp/fake-project (raw path, not resolved!)
# Warning printed, but path still returned and used
```

**Recommendation:**

**Fail explicitly when canonicalization fails in security contexts:**

```bash
canonicalize_project_dir() {
  local raw_dir="$1"
  local require_canon="${2:-false}"  # New parameter

  if [ -d "$raw_dir" ]; then
    if result=$(cd -- "$raw_dir" 2>/dev/null && pwd -P); then
      printf '%s' "$result"
      return 0
    fi
  fi

  if command -v realpath >/dev/null 2>&1; then
    if result=$(realpath -- "$raw_dir" 2>/dev/null); then
      printf '%s' "$result"
      return 0
    fi
  fi

  # Fallback behavior depends on context
  if [ "$require_canon" = "true" ]; then
    printf '[yellow-ci] CRITICAL: Cannot canonicalize %s\n' "$raw_dir" >&2
    return 1  # FAIL in security contexts
  else
    printf '[yellow-ci] Warning: Using raw path %s\n' "$raw_dir" >&2
    printf '%s' "$raw_dir"
    return 0
  fi
}
```

Usage in security-sensitive validate_file_path:
```bash
local project_root
project_root=$(canonicalize_project_dir "$2" true) || return 1
```

---

### 5. TOCTOU Re-Check Fails Silently

**Location:** `/home/kinginyellow/projects/yellow-plugins/plugins/yellow-ci/commands/ci/runner-cleanup.md:110-115`

**Severity:** CRITICAL (security control bypass, data corruption risk)

**Issue Description:**
The TOCTOU protection in `runner-cleanup.md` re-checks for active jobs inside the SSH session (line 112-115):

```bash
if pgrep -f "Runner.Worker" >/dev/null 2>&1; then
  echo "ERROR: Job started during confirmation period"
  exit 1
fi
```

**However:**
1. The error message goes to stdout (via `echo`), not stderr
2. The cleanup script continues in the SAME heredoc — if the `exit 1` fails to terminate the SSH session (e.g., SSH multiplexing, shell configuration), **the cleanup commands will still execute**
3. The calling command has no way to detect this failure because the check happens inside an SSH heredoc
4. No logging occurs before the exit

**Hidden Errors:**
- `pgrep` not installed on runner → check always passes (false negative)
- `pgrep` fails due to permissions → `2>&1` hides error, check passes
- SSH connection multiplexing causes `exit 1` to not terminate session
- Job starts immediately after `pgrep` check (nanosecond race window)

**User Impact:**
**If TOCTOU check fails to abort, destructive cleanup will run while a job is executing, potentially corrupting:**
- Docker containers in use
- Log files being written
- Temp files being actively used

**This fallback masks the real problem** — the user confirmed cleanup, it appears to abort, but actually runs anyway.

**Recommendation:**

Add explicit error detection and logging BEFORE executing any destructive operations:

```bash
ssh "$user@$host" << 'CLEANUP'
set -euo pipefail

# TOCTOU: Re-check for active jobs INSIDE session
if ! command -v pgrep >/dev/null 2>&1; then
  printf '[yellow-ci] ERROR: pgrep not available on runner, cannot verify job status\n' >&2
  exit 1
fi

if pgrep -f "Runner.Worker" >/dev/null 2>&1; then
  printf '[yellow-ci] ERROR: Job started during confirmation (TOCTOU protection)\n' >&2
  exit 1
fi

# Add a second check with different method for defense-in-depth
if systemctl is-active actions.runner.* >/dev/null 2>&1; then
  printf '[yellow-ci] ERROR: Runner service active (TOCTOU protection)\n' >&2
  exit 1
fi

# Log cleanup start with PID for audit trail
printf '[yellow-ci] Cleanup started at %s (SSH PID %s)\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$$" >&2

# Execute cleanup in order: containers → images → volumes (most destructive last)
# ... rest of cleanup
CLEANUP

# Check SSH exit code
if [ $? -ne 0 ]; then
  printf '[yellow-ci] ERROR: Cleanup aborted (see SSH output above)\n' >&2
  exit 1
fi
```

---

## HIGH Severity Issues

### 6. Redact Secrets Pipeline Doesn't Validate Input

**Location:** `/home/kinginyellow/projects/yellow-plugins/plugins/yellow-ci/hooks/scripts/lib/redact.sh:40-42`

**Severity:** HIGH (potential for unredacted output, incomplete error handling)

**Issue Description:**
The `sanitize_log_content()` function pipes `redact_secrets | escape_fence_markers` without checking if either step succeeded:

```bash
sanitize_log_content() {
  redact_secrets | escape_fence_markers
}
```

**If `redact_secrets` fails**, the pipe will propagate **empty output** to `escape_fence_markers`, which will succeed (doing nothing), and the function returns 0.

**If `escape_fence_markers` fails**, the redacted content is lost and nothing is output, but the function still returns 0.

**Hidden Errors:**
- Broken pipe if downstream consumer closes early
- Memory exhaustion in sed processing large inputs
- Locale-specific sed failures
- Binary data in input causing sed to fail

**User Impact:**
**Silent data loss** — users expect sanitized output, get nothing, no error message. Or worse: **partially redacted output** if the pipeline fails midway through a large log file.

**Recommendation:**

Use explicit error propagation:

```bash
sanitize_log_content() {
  local redacted
  local sanitized

  redacted=$(redact_secrets) || {
    printf '[yellow-ci] ERROR: Secret redaction failed\n' >&2
    return 1
  }

  sanitized=$(printf '%s' "$redacted" | escape_fence_markers) || {
    printf '[yellow-ci] ERROR: Fence escaping failed\n' >&2
    return 1
  }

  printf '%s' "$sanitized"
  return 0
}
```

Or use `set -o pipefail` if running in a subshell:

```bash
sanitize_log_content() {
  (
    set -o pipefail
    redact_secrets | escape_fence_markers
  ) || {
    printf '[yellow-ci] ERROR: Log sanitization pipeline failed\n' >&2
    return 1
  }
}
```

---

### 7. SSH Validation Allows Shell Metacharacters in Edge Cases

**Location:** `/home/kinginyellow/projects/yellow-plugins/plugins/yellow-ci/hooks/scripts/lib/validate.sh:243-246`

**Severity:** HIGH (command injection risk in SSH contexts)

**Issue Description:**
The `validate_ssh_host()` function rejects shell metacharacters:

```bash
243  # Reject shell metacharacters
244  case "$host" in
245    *\;*|*\&*|*\|*|*\$*|*\`*|*\'*|*\"*|*\\*) return 1 ;;
246  esac
```

**However, this list is incomplete.** It misses:
- `*` (glob expansion)
- `?` (glob expansion)
- `[` and `]` (glob patterns)
- `<` and `>` (redirection)
- `(` and `)` (subshell)
- `{` and `}` (brace expansion)
- `!` (history expansion in interactive shells)
- `\n` (already checked on lines 235-241, but worth noting)

**Hidden Errors:**
If a hostname contains `test*.local` or `host?.local`, the validation passes, but when used in an unquoted SSH command, **glob expansion occurs**.

**User Impact:**
While less severe than semicolon injection, **glob characters could cause unexpected behavior**:
```bash
host="runner*.local"  # Passes validation
ssh "$user@$host" "uptime"  # Expands to all files matching runner*.local
```

**In practice, DNS names cannot contain most of these characters**, so this is a **defense-in-depth issue**, not an immediate vulnerability. But:

**Recommendation:**

Use a whitelist approach instead of blacklist:

```bash
# After newline check, validate character set
case "$host" in
  *[!a-z0-9.-]*) return 1 ;;
esac
```

This is **already done for FQDN validation** on line 269, but the shell metacharacter check happens BEFORE the IP address branch, so it protects IPs but uses a blacklist. Move to whitelist for both paths.

---

### 8. Validate File Path Symlink Resolution Can Fail Silently

**Location:** `/home/kinginyellow/projects/yellow-plugins/plugins/yellow-ci/hooks/scripts/lib/validate.sh:54-73`

**Severity:** HIGH (validation bypass via symlink confusion)

**Issue Description:**
The symlink resolution logic (lines 54-73) tries `realpath`, then falls back to manual `readlink` + `cd`, then on line 67:

```bash
67    else
68      return 1
69    fi
```

**This rejects the path if both realpath and readlink fail.** However, this happens in a **nested if-block**, and the function continues to the final validation on lines 76-88.

**The problem:** If symlink resolution fails, the function returns 1 on line 68, **but the caller doesn't know WHY** — was it:
- A malicious symlink outside project root (security rejection, expected)
- Or missing `realpath` and `readlink` tools (environment issue, unexpected)

**Hidden Errors:**
- Both `realpath` and `readlink` missing from environment → legitimate symlinks rejected
- Symlink points to non-existent target → resolution fails with no diagnostic
- Broken symlink in path → rejection with no explanation
- Race condition: symlink target changes between check and resolution

**User Impact:**
**Legitimate workflow files could be rejected** on minimal systems (Alpine Linux containers, busybox) that lack both `realpath` and `readlink`. User sees validation failure with no explanation of what to install.

**Recommendation:**

Add diagnostic logging for environment issues:

```bash
# Line 54-73 replacement:
if [ -L "$full_path" ]; then
  local target
  if command -v realpath >/dev/null 2>&1; then
    target="$(realpath -- "$full_path" 2>/dev/null)" || {
      printf '[yellow-ci] Warning: realpath failed for symlink %s\n' "$full_path" >&2
      return 1
    }
  elif command -v readlink >/dev/null 2>&1; then
    # ... existing readlink logic
  else
    printf '[yellow-ci] ERROR: Cannot resolve symlink %s (no realpath or readlink available)\n' "$full_path" >&2
    return 1
  fi

  case "$target" in
    "${project_root}/"*) ;;
    *)
      printf '[yellow-ci] Validation rejected: symlink %s points outside project (%s)\n' "$full_path" "$target" >&2
      return 1
      ;;
  esac
fi
```

---

### 9. Run ID Validation Arithmetic Can Overflow

**Location:** `/home/kinginyellow/projects/yellow-plugins/plugins/yellow-ci/hooks/scripts/lib/validate.sh:160-161`

**Severity:** HIGH (validation bypass on 32-bit systems)

**Issue Description:**
Line 160 attempts to validate against JavaScript's `MAX_SAFE_INTEGER`:

```bash
160  if [ ${#id} -eq 16 ] && [ "$id" -gt 9007199254740991 ] 2>/dev/null; then
161    return 1
162  fi
```

**This fails on 32-bit systems or shells with 32-bit arithmetic** because:
- Bash arithmetic is limited by `long` type (32-bit or 64-bit depending on platform)
- On 32-bit systems, max value is 2147483647 (2^31 - 1)
- The comparison `9007199254740991` will **overflow** and produce garbage results
- The `2>/dev/null` suppresses the error

**Hidden Errors:**
- 32-bit shell arithmetic overflow → comparison fails → `2>/dev/null` hides error → function returns 0 (success)
- Invalid run IDs larger than 2^53 could be accepted
- Shell-specific arithmetic behavior differences (dash, ash, zsh)

**User Impact:**
On 32-bit systems or minimal shells, **validation incorrectly accepts invalid run IDs**, leading to:
- API failures when GitHub rejects the ID
- Incorrect run ID caching
- Confusing error messages from `gh` CLI

**Recommendation:**

Use string comparison for large numbers:

```bash
# JavaScript max safe integer: 9007199254740991 (16 digits)
validate_run_id() {
  local id="$1"

  if [ -z "$id" ]; then
    return 1
  fi

  # Reject newlines
  local id_len=${#id}
  local oneline
  oneline=$(printf '%s' "$id" | tr -d '\n\r')
  if [ ${#oneline} -ne "$id_len" ]; then
    return 1
  fi

  # Must be digits only, 1-20 chars
  case "$id" in
    *[!0-9]*) return 1 ;;
  esac

  if [ ${#id} -gt 20 ] || [ ${#id} -lt 1 ]; then
    return 1
  fi

  # No leading zeros
  case "$id" in
    0*) return 1 ;;
  esac

  # String comparison for large numbers (portable)
  # 9007199254740991 = 16 digits
  if [ ${#id} -gt 16 ]; then
    return 1  # Definitely too large
  elif [ ${#id} -eq 16 ]; then
    # Lexicographic comparison works for equal-length digit strings
    if [ "$id" \> "9007199254740991" ]; then
      return 1
    fi
  fi

  return 0
}
```

---

### 10. Session Hook Cache Write Failure is Silent

**Location:** `/home/kinginyellow/projects/yellow-plugins/plugins/yellow-ci/hooks/scripts/session-start.sh:89-92`

**Severity:** HIGH (degraded performance, invisible failure)

**Issue Description:**
The cache write logic (lines 89-92) uses `|| true` to suppress errors:

```bash
89  # Write to cache (atomic via tmp + mv)
90  if printf '%s' "$output" > "${cache_file}.tmp" 2>/dev/null; then
91    mv "${cache_file}.tmp" "$cache_file" 2>/dev/null || true
92  fi
```

**If the `mv` fails** (line 91), the temp file is left behind, and the **`|| true` ensures the script continues** with exit code 0. No error is logged.

**Hidden Errors:**
- Filesystem full → `mv` fails → temp file accumulates → disk fills up over time
- Permission denied → cache never updates → hook re-fetches on every session (wasting API quota)
- Race condition: another process overwrites cache → `mv` fails → silent loss of data
- NFS mount stale → `mv` hangs or fails → `2>/dev/null` hides diagnostic

**User Impact:**
**Performance degradation** — if cache writes always fail, the hook makes a GitHub API call on EVERY session start, quickly exhausting the API rate limit (60/hour unauthenticated, 5000/hour authenticated).

**Users will never know** the cache is broken until they hit rate limits and get confused why CI checks are slow.

**Recommendation:**

Log cache failures (but don't fail the hook):

```bash
# Write to cache (atomic via tmp + mv)
if printf '%s' "$output" > "${cache_file}.tmp" 2>/dev/null; then
  if ! mv "${cache_file}.tmp" "$cache_file" 2>/dev/null; then
    printf '[yellow-ci] Warning: Cache write failed for %s\n' "$cache_key" >&2
    rm -f "${cache_file}.tmp" 2>/dev/null
  fi
else
  printf '[yellow-ci] Warning: Cannot write cache to %s\n' "${cache_file}.tmp" >&2
fi
```

**Add cache health monitoring:**
```bash
# Detect accumulating temp files
temp_count=$(find "$cache_dir" -name "*.tmp" 2>/dev/null | wc -l)
if [ "$temp_count" -gt 5 ]; then
  printf '[yellow-ci] Warning: %d stale temp files in cache, cleanup needed\n' "$temp_count" >&2
fi
```

---

### 11. Fence Marker Escaping Has No Input Validation

**Location:** `/home/kinginyellow/projects/yellow-plugins/plugins/yellow-ci/hooks/scripts/lib/redact.sh:32-36`

**Severity:** HIGH (prompt injection bypass potential)

**Issue Description:**
The `escape_fence_markers()` function assumes input is valid UTF-8 text:

```bash
32  escape_fence_markers() {
33    sed \
34      -e 's/--- begin/[ESCAPED] begin/g' \
35      -e 's/--- end/[ESCAPED] end/g'
36  }
```

**If input contains:**
- Binary data (null bytes)
- Invalid UTF-8 sequences
- Extremely long lines (> sed buffer size)
- Special sed metacharacters in unexpected positions

**Then sed may:**
- Fail with error (suppressed if piped)
- Produce garbled output
- Hang on pathological input

**Hidden Errors:**
- Binary log output from CI (e.g., compiler crash dumps) → sed fails
- Multi-GB log files → sed memory exhaustion
- Null bytes in log → sed silently truncates

**User Impact:**
**Prompt injection fencing fails**, allowing malicious CI logs to break out of the `--- begin/end ---` delimiters and inject arbitrary instructions to the LLM.

**Recommendation:**

Add input sanitization and size limits:

```bash
escape_fence_markers() {
  # Limit input size to 1MB (CI logs should be analyzed in chunks anyway)
  head -c 1048576 | \
  # Remove null bytes and other binary content
  tr -d '\000-\010\013\014\016-\037' | \
  # Escape fence markers
  sed \
    -e 's/--- begin/[ESCAPED] begin/g' \
    -e 's/--- end/[ESCAPED] end/g' || {
    printf '[yellow-ci] ERROR: Fence marker escaping failed\n' >&2
    return 1
  }
}
```

---

## MEDIUM Severity Issues

### 12. Session Hook Doesn't Validate jq Output

**Location:** `/home/kinginyellow/projects/yellow-plugins/plugins/yellow-ci/hooks/scripts/session-start.sh:65-70, 77-80`

**Severity:** MEDIUM (incorrect failure count, misleading notifications)

**Issue Description:**
The jq parsing (lines 67-69 and 78-80) doesn't validate the JSON structure before processing:

```bash
67  if command -v jq >/dev/null 2>&1; then
68    failure_count=$(printf '%s' "$failed_json" | jq -r 'length' 2>/dev/null) || failure_count=0
69  fi
```

**If GitHub API returns:**
- Malformed JSON → jq fails → `|| failure_count=0` masks the error
- Valid JSON but wrong structure (e.g., error object instead of array) → `jq -r 'length'` returns `null` or fails → failure_count=0
- Empty string `""` → jq fails → failure_count=0

**Hidden Errors:**
- API error responses (rate limit, auth failure) are valid JSON but not the expected schema
- Transient parsing errors are hidden
- User sees "0 failures" when actually there was an API error

**User Impact:**
**Misleading notifications** — if the GitHub API returns an error (e.g., `{"message": "API rate limit exceeded"}`), the hook will:
1. Parse it as valid JSON
2. Check if it's not `"[]"` or `"null"` (line 66) → passes (it's an object!)
3. Try `jq -r 'length'` → fails (objects don't have length) → sets failure_count=0
4. Report "0 failures" instead of "API error, can't check"

**Recommendation:**

Validate JSON schema before parsing:

```bash
# Validate JSON structure
if [ -n "$failed_json" ] && [ "$failed_json" != "[]" ] && [ "$failed_json" != "null" ]; then
  if command -v jq >/dev/null 2>&1; then
    # Check if it's an array (expected) or error object
    if printf '%s' "$failed_json" | jq -e 'type == "array"' >/dev/null 2>&1; then
      failure_count=$(printf '%s' "$failed_json" | jq -r 'length' 2>/dev/null) || failure_count=0
    else
      # Got valid JSON but wrong type — likely an API error
      error_msg=$(printf '%s' "$failed_json" | jq -r '.message // "Unknown error"' 2>/dev/null)
      printf '[yellow-ci] GitHub API error: %s\n' "$error_msg" >&2
      failure_count=0
    fi
  fi
fi
```

---

### 13. SSH Command Validation Misses Command Injection Vectors

**Location:** `/home/kinginyellow/projects/yellow-plugins/plugins/yellow-ci/hooks/scripts/lib/validate.sh:382-403`

**Severity:** MEDIUM (incomplete injection prevention)

**Issue Description:**
The `validate_ssh_command()` function blocks common injection patterns:

```bash
398  # Reject shell metacharacters that enable injection
399  case "$cmd" in
400    *\;*|*\&*|*\|*|*\$\(*|*\`*) return 1 ;;
401  esac
```

**However, this is incomplete.** It misses:
- `${}` variable expansion (only blocks `$(`)
- `<<` here-docs (could inject multi-line commands)
- `>` and `<` redirection
- Newlines (already blocked on lines 389-395, good)
- `#` comments (could hide injection)

**Additionally:** The function validates the command string but **doesn't validate HOW it's used**. If the caller does:

```bash
ssh user@host "$validated_cmd"  # SAFE (quoted)
ssh user@host $validated_cmd    # UNSAFE (word splitting)
```

**Then the validation is bypassed by improper quoting in the caller.**

**Hidden Errors:**
- Command contains `${PATH}` → validation passes → expansion happens on remote host (info leak)
- Command contains `test #injection` → validation passes → `#injection` is a comment, ignored

**User Impact:**
**Partial injection protection** — sophisticated attackers could bypass the blacklist. However, in this plugin's context, **SSH commands come from the command files (runner-health.md, runner-cleanup.md), not user input**, so the risk is lower.

**Recommendation:**

Document the security boundary clearly:

```bash
# validate_ssh_command — Validates command for basic injection patterns
#
# IMPORTANT: This validates the command STRING only. Callers MUST:
# 1. Quote when passing to SSH: ssh "$user@$host" "$cmd" (NOT $cmd)
# 2. Use heredocs for complex commands instead of dynamic strings
# 3. Never concatenate user input into SSH commands
#
# This function is NOT sufficient to sanitize untrusted user input.
```

Add to CLAUDE.md:
```markdown
## SSH Command Security

- All SSH commands must be defined in `.md` command files (not user input)
- Use heredocs for multi-line commands (NOT string concatenation)
- validate_ssh_command() is defense-in-depth, not primary control
```

---

### 14. Repo Slug Validation Allows Trailing Hyphen in Org Name

**Location:** `/home/kinginyellow/projects/yellow-plugins/plugins/yellow-ci/hooks/scripts/lib/validate.sh:202-206`

**Severity:** MEDIUM (minor validation inconsistency)

**Issue Description:**
Line 205 has a comment that contradicts GitHub's actual rules:

```bash
202  case "$owner" in
203    *[!a-zA-Z0-9_-]*) return 1 ;;
204    -*) return 1 ;;
205    *-) ;;  # GitHub allows trailing hyphen in org names
206  esac
```

**GitHub does NOT allow trailing hyphens in org names** (only in repo names). The comment is incorrect, and the validation should reject `-` at the end.

**However:** This is a **permissive validation** (allows more than GitHub does), not restrictive, so it won't break legitimate use. But it **could allow invalid org names to pass validation and cause API errors later**.

**User Impact:**
If user provides `--repo myorg-/repo`, validation passes, but GitHub API will reject it with 404. Confusing error message.

**Recommendation:**

Fix the validation to match GitHub's actual rules:

```bash
# Owner: 1-39 chars, alphanumeric + hyphens + underscores, no leading/trailing hyphen
if [ -z "$owner" ] || [ ${#owner} -gt 39 ]; then
  return 1
fi
case "$owner" in
  *[!a-zA-Z0-9_-]*) return 1 ;;
  -*) return 1 ;;
  *-) return 1 ;;  # GitHub does NOT allow trailing hyphen in org names
esac
```

---

## Summary Table

| # | Location | Severity | Issue | Impact |
|---|----------|----------|-------|--------|
| 1 | `redact.sh:14-28` | CRITICAL | Silent sed failures leak secrets | Unredacted tokens displayed |
| 2 | `validate.sh:367-369` | CRITICAL | Arithmetic logic error | Validation bypass |
| 3 | `session-start.sh:16-27,32,56-61` | CRITICAL | All errors suppressed | Broken hook invisible |
| 4 | `validate.sh:11-23` | CRITICAL | Canonicalization fallback unsafe | Path traversal risk |
| 5 | `runner-cleanup.md:110-115` | CRITICAL | TOCTOU check can fail silently | Data corruption during cleanup |
| 6 | `redact.sh:40-42` | HIGH | Pipeline error propagation missing | Partial redaction or data loss |
| 7 | `validate.sh:243-246` | HIGH | Incomplete metacharacter blacklist | Glob expansion in SSH hosts |
| 8 | `validate.sh:54-73` | HIGH | Symlink resolution no diagnostics | Legitimate files rejected |
| 9 | `validate.sh:160-161` | HIGH | 32-bit arithmetic overflow | Invalid run IDs accepted |
| 10 | `session-start.sh:89-92` | HIGH | Cache write failure silent | API quota exhaustion |
| 11 | `redact.sh:32-36` | HIGH | No binary data handling | Prompt injection fence bypass |
| 12 | `session-start.sh:65-70,77-80` | MEDIUM | jq output not validated | Misleading failure counts |
| 13 | `validate.sh:398-401` | MEDIUM | Incomplete injection patterns | Partial SSH command protection |
| 14 | `validate.sh:205` | MEDIUM | Incorrect GitHub org validation | Invalid slugs accepted |

---

## Testing Recommendations

Add these test cases to `/home/kinginyellow/projects/yellow-plugins/plugins/yellow-ci/tests/`:

### redaction.bats
```bash
@test "redact: sed failure is detected" {
  # Inject invalid sed pattern (requires modifying source)
  # Or test with sed unavailable
  ! (unset PATH; redact_secrets < /dev/null)
}

@test "redact: binary data handling" {
  result=$(printf '\x00\x01\x02' | redact_secrets)
  [ $? -ne 0 ]  # Should fail or handle gracefully
}

@test "redact: huge input handling" {
  yes "Bearer token123" | head -n 100000 | redact_secrets | head -n 1
  # Should not hang or crash
}
```

### validate.bats
```bash
@test "numeric_range: invalid input rejected" {
  ! validate_numeric_range "abc" 0 100
}

@test "numeric_range: empty max rejected" {
  ! validate_numeric_range "50" 0 ""
}

@test "run_id: oversized number rejected on 32-bit" {
  ! validate_run_id "9999999999999999"  # 16 nines
}

@test "ssh_host: glob characters rejected" {
  ! validate_ssh_host "test*.local"
  ! validate_ssh_host "host?.local"
}

@test "repo_slug: trailing hyphen in org rejected" {
  ! validate_repo_slug "myorg-/repo"
}
```

### session-start.bats
```bash
@test "session-start: cache write failure logged" {
  cache_dir="/read-only-path"
  run bash plugins/yellow-ci/hooks/scripts/session-start.sh
  [[ "$stderr" == *"Warning: Cache write failed"* ]]
}

@test "session-start: jq missing degrades gracefully" {
  (unset jq; run bash plugins/yellow-ci/hooks/scripts/session-start.sh)
  [ "$status" -eq 0 ]
  [[ "$stderr" != *"ERROR"* ]]
}
```

---

## Conclusion

This PR demonstrates **excellent security awareness** (path traversal prevention, TOCTOU protection, secret redaction, prompt injection fencing), but **error handling is critically inadequate**.

**Immediate action required:**
1. Fix CRITICAL issues 1-5 before merge
2. Add error logging to all validation functions
3. Add pipeline error propagation to redaction functions
4. Add health check command for session hook
5. Add test coverage for error paths (not just happy paths)

**Without these fixes, users will experience:**
- Secret leakage (issue #1)
- Security bypasses (issues #2, #4, #7)
- Invisible failures (issues #3, #10)
- Data corruption (issue #5)

**This code prioritizes security controls but neglects observability.** Security controls that fail silently are no better than no controls at all.
