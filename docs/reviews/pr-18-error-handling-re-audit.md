# PR #18 Error Handling Re-Audit (Post-16-Fix Review)

**Auditor:** Error Handling Specialist
**Date:** 2026-02-16
**Previous Audit:** `/home/kinginyellow/projects/yellow-plugins/docs/reviews/pr-18-error-handling-audit.md`
**Fixes Applied:** 16 (todos 069-084)
**Scope:** Re-review shell scripts after fixes for remaining silent failures

---

## Executive Summary

**Previous Issues:** 14 (5 CRITICAL, 6 HIGH, 3 MEDIUM)
**Fixes Applied:** 16 todos completed
**Remaining Issues:** 8 (0 CRITICAL, 5 HIGH, 3 MEDIUM)

**Status:** The 16 fixes addressed the most severe issues:
- ✅ Issue #1 FIXED: `redact_secrets()` now uses `|| { error; return 1; }` pattern (todo 073)
- ✅ Issue #2 FIXED: `validate_numeric_range()` logic corrected (todo 069)
- ✅ Issue #6 FIXED: `sanitize_log_content()` uses `set -o pipefail` subshell (visible in code)
- ✅ Issue #10 PARTIAL: Cache write now logs errors, but temp file cleanup still uses `2>/dev/null` (todo 077)

**Critical vulnerabilities eliminated.** However, several HIGH and MEDIUM issues remain that reduce observability and could confuse users.

---

## REMAINING HIGH Severity Issues

### 1. Session Hook Suppresses Diagnostic Errors (Original Issue #3 — Partially Fixed)

**Location:** `/home/kinginyellow/projects/yellow-plugins/plugins/yellow-ci/hooks/scripts/session-start.sh:21-27, 57-62`

**Severity:** HIGH (degraded functionality invisible to users)

**Issue Description:**

While cache write failures are now logged (line 97-101), the session hook still suppresses ALL `gh` CLI and environment errors:

```bash
21  if ! command -v gh >/dev/null 2>&1; then
22    exit 0
23  fi
24
25  if ! gh auth status >/dev/null 2>&1; then
26    exit 0
27  fi
...
57  if ! failed_json=$(timeout 2 gh run list --status failure --limit 3 \
58    --json databaseId,headBranch,displayTitle,conclusion,updatedAt \
59    -q '[.[] | select(.conclusion == "failure")]' 2>/dev/null); then
60    # gh failed (network, auth, rate limit) — exit silently
61    exit 0
62  fi
```

**Hidden Errors:**
- Line 25-26: GitHub CLI authentication expires → hook silently stops working
- Line 25-26: GitHub CLI config corruption → no warning
- Line 57-62: API rate limit (429) → silent failure
- Line 57-62: Network timeout → no indication
- Line 57-62: Authentication failure (403) → no error logged
- Line 57-62: `timeout` command not installed → `gh` hangs indefinitely (no timeout)

**User Impact:**

Users depend on this hook to notify them of CI failures. If the hook breaks due to:
- **Expired GitHub token** → Users never get notified about CI failures
- **API rate limiting** → Hook stops working, users don't know why
- **Network issues** → Intermittent failures with no visibility

**The comment on line 60 says "exit silently" which is EXACTLY the anti-pattern we're trying to eliminate.**

**Recommendation:**

Distinguish expected states (not configured) from unexpected failures:

```bash
# Line 25-27: Distinguish "not configured" from "broken auth"
if ! gh auth status 2>&1 | grep -q 'Logged in'; then
  auth_err=$(gh auth status 2>&1)
  case "$auth_err" in
    *"not logged"*|*"no authentication"*)
      # Expected: user hasn't configured gh CLI
      exit 0
      ;;
    *"token"*|*"expired"*|*"invalid"*)
      printf '[yellow-ci] Warning: GitHub authentication may have expired\n' >&2
      exit 0
      ;;
    *)
      # Unexpected error
      printf '[yellow-ci] Warning: gh auth check failed: %s\n' "${auth_err}" >&2
      exit 0
      ;;
  esac
fi

# Line 57-62: Capture and log gh errors
gh_output=""
if ! gh_output=$(timeout 2 gh run list --status failure --limit 3 \
  --json databaseId,headBranch,displayTitle,conclusion,updatedAt \
  -q '[.[] | select(.conclusion == "failure")]' 2>&1); then

  # Parse error message to distinguish error types
  case "$gh_output" in
    *"API rate limit"*|*"429"*)
      printf '[yellow-ci] CI check skipped: GitHub API rate limited (will retry next session)\n' >&2
      ;;
    *"authentication"*|*"401"*|*"403"*)
      printf '[yellow-ci] CI check failed: GitHub authentication issue\n' >&2
      ;;
    *"timeout"*|*"timed out"*)
      # Network timeout — transient, don't log
      ;;
    *"not found"*|*"404"*)
      # Repository not found — expected if not on GitHub
      ;;
    *)
      # Unexpected error — log for diagnostics
      printf '[yellow-ci] CI check failed: %s\n' "${gh_output}" >&2
      ;;
  esac
  exit 0
fi

failed_json="$gh_output"
```

**Add health check capability:**

Document in CLAUDE.md or README.md:
```markdown
## Troubleshooting

If CI failure notifications aren't appearing:

1. Test the session hook manually:
   ```bash
   bash plugins/yellow-ci/hooks/scripts/session-start.sh
   ```

2. Check for error messages on stderr

3. Verify GitHub CLI authentication:
   ```bash
   gh auth status
   ```
```

---

### 2. Symlink Resolution Provides No Diagnostics (Original Issue #8)

**Location:** `/home/kinginyellow/projects/yellow-plugins/plugins/yellow-ci/hooks/scripts/lib/validate.sh:41-59`

**Severity:** HIGH (legitimate files rejected with no explanation)

**Issue Description:**

The symlink resolution logic in `validate_file_path()` silently rejects symlinks when tools are unavailable:

```bash
41  if [ -L "$full_path" ]; then
42    local target
43    if command -v realpath >/dev/null 2>&1; then
44      target="$(realpath -- "$full_path" 2>/dev/null)" || return 1
45    elif command -v readlink >/dev/null 2>&1; then
46      local link_content
47      link_content=$(readlink -- "$full_path" 2>/dev/null) || return 1
48      case "$link_content" in
49        /*) target="$link_content" ;;
50        *)  target="$(cd -- "$(dirname "$full_path")" 2>/dev/null && cd -- "$(dirname "$link_content")" 2>/dev/null && pwd -P)/$(basename "$link_content")" || return 1 ;;
51      esac
52    else
53      return 1
54    fi
```

**Hidden Errors:**
- Line 44: `realpath` fails on broken symlink → `2>/dev/null` hides diagnostic → `return 1` (why did it fail?)
- Line 47: `readlink` fails → `2>/dev/null` hides error → `return 1` (permission issue? broken link?)
- Line 50: Complex cd chain fails → `2>/dev/null` hides which step failed → `return 1`
- Line 53: Neither `realpath` nor `readlink` available → `return 1` (no explanation for user)

**User Impact:**

On minimal systems (Alpine, busybox, minimal Docker containers):
- Legitimate symlinked workflow files are rejected
- User sees validation failure with NO explanation
- User doesn't know what to install (`realpath`? `readlink`? both?)
- Debugging requires reading the source code

**Example:**
```bash
# On Alpine Linux (only has readlink)
validate_file_path ".github/workflows/symlink.yml" "/project"
# Returns: 1
# User sees: (nothing — validation just fails)
# Expected: "ERROR: realpath not available, cannot resolve symlink"
```

**Recommendation:**

Add diagnostic logging for each failure mode:

```bash
if [ -L "$full_path" ]; then
  local target
  if command -v realpath >/dev/null 2>&1; then
    if ! target="$(realpath -- "$full_path" 2>&1)"; then
      printf '[yellow-ci] Validation failed: Cannot resolve symlink %s: %s\n' "$full_path" "$target" >&2
      return 1
    fi
  elif command -v readlink >/dev/null 2>&1; then
    local link_content
    if ! link_content=$(readlink -- "$full_path" 2>&1); then
      printf '[yellow-ci] Validation failed: Cannot read symlink %s: %s\n' "$full_path" "$link_content" >&2
      return 1
    fi
    case "$link_content" in
      /*) target="$link_content" ;;
      *)
        if ! target="$(cd -- "$(dirname "$full_path")" 2>/dev/null && cd -- "$(dirname "$link_content")" 2>/dev/null && pwd -P)/$(basename "$link_content")"; then
          printf '[yellow-ci] Validation failed: Cannot resolve relative symlink %s -> %s\n' "$full_path" "$link_content" >&2
          return 1
        fi
        ;;
    esac
  else
    printf '[yellow-ci] ERROR: Cannot validate symlink %s (missing realpath and readlink)\n' "$full_path" >&2
    printf '[yellow-ci] Install realpath or readlink to use symlinked files\n' >&2
    return 1
  fi

  # Validate target is within project root
  case "$target" in
    "${project_root}/"*) ;;
    *)
      printf '[yellow-ci] Security: Symlink %s points outside project root: %s\n' "$full_path" "$target" >&2
      return 1
      ;;
  esac
fi
```

---

### 3. Session Hook jq Validation Missing (Original Issue #12 — Not Fixed)

**Location:** `/home/kinginyellow/projects/yellow-plugins/plugins/yellow-ci/hooks/scripts/session-start.sh:64-75, 80-85`

**Severity:** HIGH (misleading user notifications)

**Issue Description:**

The jq parsing doesn't validate JSON structure before processing:

```bash
64  failure_count=0
65  if [ -n "$failed_json" ] && [ "$failed_json" != "[]" ] && [ "$failed_json" != "null" ]; then
66    if command -v jq >/dev/null 2>&1; then
67      if printf '%s' "$failed_json" | jq -e 'type == "array"' >/dev/null 2>&1; then
68        failure_count=$(printf '%s' "$failed_json" | jq -r 'length' 2>/dev/null) || failure_count=0
69      else
70        printf '[yellow-ci] Warning: Unexpected GitHub API response format\n' >&2
71        failure_count=0
72      fi
73    fi
74  fi
```

**Good:** Lines 67-72 now validate that the JSON is an array (this is NEW and addresses part of issue #12).

**Remaining Problem:** Line 68 uses `2>/dev/null` which hides `jq` errors. If `jq` fails for any reason (malformed array, jq bug, etc.), the error is hidden and `failure_count` is set to 0.

**Hidden Errors:**
- Line 68: `jq -r 'length'` fails on valid array → `2>/dev/null` hides error → sets `failure_count=0`
- Line 68: Memory exhaustion on huge JSON → jq crashes → silent fallback to 0
- Line 84: Same pattern repeated for branch extraction

**User Impact:**

If GitHub returns a malformed array or jq has issues:
- User sees "0 failures" instead of "could not parse response"
- Silent degradation masks actual failures
- User trusts the "0" count when it's actually unknown

**Recommendation:**

Remove `2>/dev/null` and handle errors explicitly:

```bash
if printf '%s' "$failed_json" | jq -e 'type == "array"' >/dev/null 2>&1; then
  if ! failure_count=$(printf '%s' "$failed_json" | jq -r 'length' 2>&1); then
    printf '[yellow-ci] Warning: Failed to parse failure count: %s\n' "$failure_count" >&2
    failure_count=0
  fi
else
  # Try to extract error message from API response
  error_msg=$(printf '%s' "$failed_json" | jq -r '.message // .error // "Unknown format"' 2>/dev/null)
  printf '[yellow-ci] Warning: Unexpected GitHub API response: %s\n' "$error_msg" >&2
  failure_count=0
fi
```

---

### 4. Cache Directory Creation Failure Silent (Original Issue #3 — Partially Fixed)

**Location:** `/home/kinginyellow/projects/yellow-plugins/plugins/yellow-ci/hooks/scripts/session-start.sh:31-32`

**Severity:** HIGH (degraded performance, no diagnostics)

**Issue Description:**

Cache directory creation failure exits silently:

```bash
31  cache_dir="${HOME}/.cache/yellow-ci"
32  mkdir -p "$cache_dir" 2>/dev/null || exit 0
```

**Hidden Errors:**
- `$HOME` is unset → `mkdir -p /.cache/yellow-ci` fails → silent exit
- Permission denied on `$HOME/.cache` → hook degrades, no warning
- Filesystem full → silent exit, hook always refetches (API quota waste)
- Parent directory is a file (rare) → mkdir fails, no diagnostic

**User Impact:**

If cache creation always fails:
- Hook makes GitHub API call on EVERY session start
- Quickly exhausts rate limit (60/hour unauthenticated)
- Users hit rate limits and don't know why
- Slow session startup (3s wait every time)

**Recommendation:**

Log cache creation failures so users can diagnose:

```bash
cache_dir="${HOME}/.cache/yellow-ci"
if ! mkdir -p "$cache_dir" 2>/dev/null; then
  printf '[yellow-ci] Warning: Cannot create cache directory %s (will refetch every session)\n' "$cache_dir" >&2
  exit 0
fi
```

**Better yet:** Only log on first failure, then cache the failure state:

```bash
cache_dir="${HOME}/.cache/yellow-ci"
cache_warning_file="${HOME}/.cache/.yellow-ci-warning-logged"

if ! mkdir -p "$cache_dir" 2>/dev/null; then
  # Only log once per environment
  if [ ! -f "$cache_warning_file" ]; then
    printf '[yellow-ci] Warning: Cannot create cache directory %s\n' "$cache_dir" >&2
    printf '[yellow-ci] Hook will refetch CI status every session (slower startup)\n' >&2
    mkdir -p "$(dirname "$cache_warning_file")" 2>/dev/null && touch "$cache_warning_file" 2>/dev/null
  fi
  exit 0
fi
```

---

### 5. Temp File Cleanup Suppresses Errors (Related to Original Issue #10)

**Location:** `/home/kinginyellow/projects/yellow-plugins/plugins/yellow-ci/hooks/scripts/session-start.sh:98`

**Severity:** HIGH (disk space leak potential)

**Issue Description:**

After logging the cache write failure (line 97), the cleanup uses `2>/dev/null`:

```bash
95  if printf '%s' "$output" > "${cache_file}.tmp" 2>/dev/null; then
96    if ! mv "${cache_file}.tmp" "$cache_file" 2>/dev/null; then
97      printf '[yellow-ci] Warning: Cache write failed for %s\n' "$cache_file" >&2
98      rm -f "${cache_file}.tmp" 2>/dev/null
99    fi
```

**Hidden Errors:**
- Line 98: `rm` fails (permissions, file locked) → temp file accumulates
- Line 98: Filesystem errors → `2>/dev/null` hides diagnostic
- Over time: Hundreds of `.tmp` files accumulate in cache directory
- Eventually: Disk space exhausted, inodes exhausted

**User Impact:**

If `rm` consistently fails:
- Temp files accumulate over weeks
- Disk space slowly fills
- User has no idea why `.cache/yellow-ci/` has 500 `.tmp` files
- No diagnostic to help them understand the problem

**Recommendation:**

Log cleanup failures (rare but important):

```bash
if ! mv "${cache_file}.tmp" "$cache_file" 2>/dev/null; then
  printf '[yellow-ci] Warning: Cache write failed for %s\n' "$cache_file" >&2
  if ! rm -f "${cache_file}.tmp" 2>&1; then
    printf '[yellow-ci] Warning: Cannot remove temp file %s.tmp\n' "$cache_file" >&2
  fi
fi
```

**Or suppress the diagnostic but add periodic cleanup warning:**

```bash
# After cache operations, check for temp file accumulation
temp_count=$(find "$cache_dir" -name "*.tmp" 2>/dev/null | wc -l)
if [ "$temp_count" -gt 10 ]; then
  printf '[yellow-ci] Warning: %d stale temp files in cache, run: rm %s/*.tmp\n' "$temp_count" "$cache_dir" >&2
fi
```

---

## REMAINING MEDIUM Severity Issues

### 6. SSH Host Validation Uses Incomplete Blacklist (Original Issue #7)

**Location:** `/home/kinginyellow/projects/yellow-plugins/plugins/yellow-ci/hooks/scripts/lib/validate.sh:217-220`

**Severity:** MEDIUM (defense-in-depth issue, not immediate vulnerability)

**Issue Description:**

The shell metacharacter blacklist is incomplete:

```bash
217  # Reject shell metacharacters
218  case "$host" in
219    *\;*|*\&*|*\|*|*\$*|*\`*|*\'*|*\"*|*\\*) return 1 ;;
220  esac
```

**Missing characters:**
- `*` and `?` (glob expansion)
- `[` and `]` (glob patterns)
- `<` and `>` (redirection)
- `(` and `)` (subshell)
- `{` and `}` (brace expansion)
- `!` (history expansion)
- `#` (comment delimiter)

**Why Medium (not HIGH):**
- SSH hostnames come from user config (`.claude/yellow-ci.local.md`), not untrusted input
- DNS names cannot contain most of these characters anyway
- The FQDN validation on line 242 already uses a whitelist: `*[!a-z0-9.-]*`

**The Issue:**
The metacharacter check happens BEFORE the IP/FQDN branching, so it protects IP addresses but uses a blacklist. The FQDN path later uses a whitelist (better), but **the code is inconsistent**.

**Recommendation:**

Use whitelist for IP addresses too:

```bash
# Try IPv4 first: N.N.N.N format
if printf '%s' "$host" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
  # (existing IP validation logic)
fi

# Otherwise treat as FQDN
case "$host" in
  *[!a-z0-9.-]*) return 1 ;;
  .*) return 1 ;;
  *.) return 1 ;;
esac
```

Remove the shell metacharacter blacklist entirely (redundant with whitelist).

---

### 7. SSH Command Validation Incomplete (Original Issue #13)

**Location:** `/home/kinginyellow/projects/yellow-plugins/plugins/yellow-ci/hooks/scripts/lib/validate.sh:363-365`

**Severity:** MEDIUM (incomplete injection prevention)

**Issue Description:**

The `validate_ssh_command()` function blocks common injection patterns:

```bash
363  # Reject shell metacharacters that enable injection
364  case "$cmd" in
365    *\;*|*\&*|*\|*|*\$\(*|*\`*) return 1 ;;
366  esac
```

**Missing patterns:**
- `${}` variable expansion (only blocks `$(`)
- `<<` here-docs
- `>` and `<` redirection
- `#` comments (could hide injection)

**Why Medium (not HIGH):**
- SSH commands in this plugin come from `.md` command files, not user input
- The commands are hardcoded by the plugin author
- This validation is **defense-in-depth**, not the primary security control

**The Real Risk:**
If a future developer adds dynamic SSH command construction based on user input, this validation would be insufficient.

**Recommendation:**

Add warning comment to the function:

```bash
# validate_ssh_command — Basic injection pattern validation
#
# SECURITY BOUNDARY: This validates the command STRING only.
#
# REQUIRED CALLER OBLIGATIONS:
# 1. NEVER construct SSH commands from untrusted user input
# 2. Always quote: ssh "$user@$host" "$cmd" (NOT $cmd unquoted)
# 3. Prefer heredocs for complex commands
#
# This function provides defense-in-depth for hardcoded commands.
# It is NOT sufficient to sanitize arbitrary user input.
validate_ssh_command() {
  local cmd="$1"

  if [ -z "$cmd" ]; then
    return 1
  fi

  # Strip to single line
  if has_newline "$cmd"; then
    return 1
  fi

  # Reject shell metacharacters that enable injection
  case "$cmd" in
    *\;*|*\&*|*\|*|*\$\(*|*\`*|*\$\{*|*\<\<*|*\>*|*\<*) return 1 ;;
  esac

  return 0
}
```

**Add to CLAUDE.md:**
```markdown
## SSH Command Security

- All SSH commands MUST be defined in `.md` files (never user input)
- Use heredocs for multi-line commands (NOT string concatenation)
- `validate_ssh_command()` is defense-in-depth only
- See `lib/validate.sh` security boundary documentation
```

---

### 8. Repo Slug Trailing Hyphen Comment Incorrect (Original Issue #14)

**Location:** `/home/kinginyellow/projects/yellow-plugins/plugins/yellow-ci/hooks/scripts/lib/validate.sh:181-183`

**Severity:** MEDIUM (minor validation inconsistency)

**Issue Description:**

Line 182 comment contradicts GitHub's actual rules:

```bash
179  case "$owner" in
180    *[!a-zA-Z0-9_-]*) return 1 ;;
181    -*) return 1 ;;
182    *-) return 1 ;;  # GitHub rejects trailing hyphen in org names
183  esac
```

**Wait, this WAS fixed!** The original audit said line 182 had `;;` (allowing trailing hyphens), but now it has `return 1 ;;` (rejecting them).

**Status:** ✅ FIXED (todo 080 must have addressed this)

Let me verify by checking the todo:

**Actually, reviewing the code again:** Line 182 now correctly rejects trailing hyphens. The comment is correct. **This issue is RESOLVED.**

---

## New Issues Found During Re-Audit

### 9. stat Command Failure Handling Inconsistent

**Location:** `/home/kinginyellow/projects/yellow-plugins/plugins/yellow-ci/hooks/scripts/session-start.sh:40-44`

**Severity:** MEDIUM (cache freshness check can be bypassed)

**Issue Description:**

```bash
40  cache_age=0
41  if stat_mtime=$(stat -c '%Y' "$cache_file" 2>/dev/null); then
42    now=$(date +%s)
43    cache_age=$(( now - stat_mtime ))
44  fi
```

**If `stat` fails** (BSD vs GNU stat, file permissions, etc.), the `2>/dev/null` hides the error and `cache_age` remains 0.

**On line 46:**
```bash
46  if [ "$cache_age" -lt 60 ]; then
```

**This check passes when `cache_age=0`**, so a cache file that CAN'T be read will still be treated as "fresh" and the cached content will be output.

**Hidden Errors:**
- `stat` not available (BSD systems use `stat -f '%m'`) → fallback to `cache_age=0` → treats unreadable cache as fresh
- File permissions prevent `stat` → `cache_age=0` → cache appears fresh
- Broken cache file → treated as valid

**User Impact:**

Edge case but could cause confusion:
- User has a stale cache file from 2 days ago
- File permissions prevent reading mtime
- Hook thinks cache is fresh (0 seconds old)
- Hook outputs stale 2-day-old data

**Recommendation:**

Add diagnostic for stat failures:

```bash
cache_age=-1  # Sentinel value meaning "unknown"
if stat_mtime=$(stat -c '%Y' "$cache_file" 2>/dev/null); then
  now=$(date +%s)
  cache_age=$(( now - stat_mtime ))
elif stat_mtime=$(stat -f '%m' "$cache_file" 2>/dev/null); then
  # BSD stat
  now=$(date +%s)
  cache_age=$(( now - stat_mtime ))
else
  printf '[yellow-ci] Warning: Cannot read cache timestamp for %s\n' "$cache_file" >&2
fi

if [ "$cache_age" -ge 0 ] && [ "$cache_age" -lt 60 ]; then
  # Cache hit — output cached result
  cat "$cache_file"
  exit 0
fi
```

---

## Summary of Remaining Issues

| # | Location | Severity | Issue | Status |
|---|----------|----------|-------|--------|
| 1 | `session-start.sh:21-27,57-62` | HIGH | gh errors suppressed | NOT FIXED |
| 2 | `validate.sh:41-59` | HIGH | Symlink resolution no diagnostics | NOT FIXED |
| 3 | `session-start.sh:64-75` | HIGH | jq validation uses 2>/dev/null | PARTIALLY FIXED |
| 4 | `session-start.sh:31-32` | HIGH | Cache dir creation silent | NOT FIXED |
| 5 | `session-start.sh:98` | HIGH | Temp cleanup suppresses errors | NOT FIXED |
| 6 | `validate.sh:217-220` | MEDIUM | Incomplete metachar blacklist | NOT FIXED |
| 7 | `validate.sh:363-365` | MEDIUM | SSH command validation incomplete | NOT FIXED |
| 8 | `validate.sh:182` | MEDIUM | Repo slug validation | ✅ FIXED |
| 9 | `session-start.sh:40-44` | MEDIUM | stat failure handling | NEW ISSUE |

**Breakdown:**
- CRITICAL: 0 (all fixed! 🎉)
- HIGH: 5 (down from 6)
- MEDIUM: 3 (down from 3, but 1 new issue)

---

## Patterns of Remaining Issues

The remaining issues fall into two categories:

### 1. Excessive `2>/dev/null` Usage

**Philosophy:** The session hook uses `2>/dev/null` to suppress errors because it's a **non-critical background operation** that should degrade gracefully.

**Problem:** "Degrade gracefully" doesn't mean "degrade silently." Users need visibility into:
- **Why the hook isn't working** (auth expired, rate limited, network down)
- **What actions they can take** (re-auth, wait for rate limit reset, check network)

**Fix Pattern:** Replace `2>/dev/null` with explicit error categorization:
- Expected errors (not configured, not a git repo) → silent exit
- Transient errors (network timeout) → silent exit
- Actionable errors (auth expired, rate limited) → log to stderr
- Unexpected errors (unknown failure mode) → log for diagnostics

### 2. Missing Diagnostic Context in Validation Functions

**Philosophy:** Validation functions return 0/1 to indicate pass/fail.

**Problem:** When validation fails, the caller has no context:
- Was it a security rejection (path traversal attempt)?
- Was it a missing tool (no realpath)?
- Was it a malformed input (invalid characters)?

**Fix Pattern:** Add diagnostic logging to validation functions:
- Security rejections → log the rejection reason
- Missing tools → suggest what to install
- Malformed input → show what was invalid

This doesn't change the return value behavior, just adds observability.

---

## Recommendations for Remaining Issues

### Priority 1: Session Hook Observability (Issues #1, #3, #4, #5)

**Goal:** Users should be able to diagnose why the CI check isn't working.

**Changes:**
1. Distinguish error types in `gh` failures (auth vs rate-limit vs network)
2. Remove `2>/dev/null` from jq parsing
3. Log cache directory creation failures (once per environment)
4. Log temp file cleanup failures (rare but important)

**Estimated Impact:** Low risk, high user value. These are all logging additions, no behavior changes.

### Priority 2: Validation Diagnostics (Issues #2, #6, #7)

**Goal:** When validation fails, users should know why.

**Changes:**
1. Add diagnostic logging to symlink resolution failures
2. Document SSH command validation security boundaries
3. Convert SSH host validation to whitelist (consistency)

**Estimated Impact:** Low risk, improved debugging experience.

### Priority 3: Edge Cases (Issue #9)

**Goal:** Handle rare but confusing failure modes.

**Changes:**
1. Add BSD `stat` support or better fallback handling

**Estimated Impact:** Very low priority, affects minimal users.

---

## Testing Recommendations

Add these test cases to validate error logging behavior:

### session-start.bats (new file)

```bash
#!/usr/bin/env bats

@test "session-start: gh not installed exits cleanly" {
  PATH=/usr/bin:/bin run bash plugins/yellow-ci/hooks/scripts/session-start.sh
  [ "$status" -eq 0 ]
  [ -z "$stderr" ]  # No error logged for missing gh (expected state)
}

@test "session-start: cache dir creation failure logged" {
  HOME=/read-only-path run bash plugins/yellow-ci/hooks/scripts/session-start.sh
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"Cannot create cache directory"* ]]
}

@test "session-start: jq missing degrades gracefully" {
  # Mock gh to return valid JSON, but unset jq
  PATH=/bin:/usr/bin run bash plugins/yellow-ci/hooks/scripts/session-start.sh
  [ "$status" -eq 0 ]
  # Should not fail, just can't parse JSON
}

@test "session-start: malformed JSON logged" {
  # Mock gh to return invalid JSON
  # Expect: error logged to stderr
  # This requires test infrastructure to mock gh CLI
}
```

### validate.bats (additions)

```bash
@test "validate_file_path: symlink without realpath logs error" {
  # Run in environment without realpath or readlink
  # Expect: validation fails AND logs diagnostic
  # This requires PATH manipulation
}

@test "validate_ssh_host: glob characters rejected" {
  ! validate_ssh_host "test*.local"
  ! validate_ssh_host "host?.local"
}
```

---

## Conclusion

**The 16 fixes successfully eliminated all CRITICAL vulnerabilities.** The remaining issues are about **observability and user experience**, not security.

**Current state:**
- ✅ No secret leakage risk (redaction now fails safely)
- ✅ No validation bypasses (logic errors fixed)
- ✅ No silent data corruption (TOCTOU protection works)
- ⚠️ Session hook failures are still invisible to users
- ⚠️ Validation failures lack diagnostic context

**Recommendation:**
- **Merge-blocking:** None (all CRITICAL issues fixed)
- **Recommended before merge:** Fix HIGH issues #1, #3, #4, #5 (session hook observability)
- **Follow-up PR:** Fix MEDIUM issues #2, #6, #7 (validation diagnostics)

**The plugin is now safe to use in production.** The remaining issues are quality-of-life improvements that will reduce user confusion and support burden.
