---
status: complete
priority: p2
issue_id: "077"
tags: [code-review, yellow-ci, observability]
dependencies: []
---

# Silent Cache Write Failures

## Problem Statement

The session-start.sh script uses `|| true` to suppress cache write failures, which silently drops errors. If the cache consistently fails to write (due to permissions, disk full, etc.), the hook will re-fetch from GitHub API every session, potentially exhausting rate limits. Additionally, leftover `.tmp` files accumulate on disk.

## Findings

**File:** `plugins/yellow-ci/hooks/scripts/session-start.sh`

**Lines 89-92:**
```bash
printf '%s\n' "$workflow_runs_json" > "${cache_file}.tmp" || true
printf '%s\n' "$failures_summary" >> "${cache_file}.tmp" || true
chmod 644 "${cache_file}.tmp" 2>/dev/null || true
mv "${cache_file}.tmp" "$cache_file" 2>/dev/null || true
```

**Issues:**

1. **Silent Failures:** All operations use `|| true`, masking:
   - Write failures (disk full, quota exceeded)
   - Permission errors
   - Filesystem errors

2. **Cascading Problems:**
   - If cache write always fails, script re-fetches from GitHub API every session
   - Rate limit (60 req/hr unauthenticated) quickly exhausted
   - Users see no indication of the underlying problem

3. **Cleanup Gap:**
   - If `mv` fails, `.tmp` file remains
   - Repeated failures accumulate orphaned temp files
   - Disk space gradually consumed

4. **Project Memory Violation:**
   - Violates rule: "Replace `|| true` / `2>/dev/null` with error logging"
   - Should "always log with component prefix"

## Proposed Solutions

Replace `|| true` with proper error handling that logs failures and cleans up temporary files.

**Implementation:**

```bash
# Write cache with error handling
if ! printf '%s\n' "$workflow_runs_json" > "${cache_file}.tmp" 2>/dev/null; then
    printf '[yellow-ci] Warning: Cache write failed (workflow runs data)\n' >&2
    rm -f "${cache_file}.tmp" 2>/dev/null
elif ! printf '%s\n' "$failures_summary" >> "${cache_file}.tmp" 2>/dev/null; then
    printf '[yellow-ci] Warning: Cache write failed (summary data)\n' >&2
    rm -f "${cache_file}.tmp" 2>/dev/null
elif ! chmod 644 "${cache_file}.tmp" 2>/dev/null; then
    printf '[yellow-ci] Warning: Cache permission update failed\n' >&2
    rm -f "${cache_file}.tmp" 2>/dev/null
elif ! mv "${cache_file}.tmp" "$cache_file" 2>/dev/null; then
    printf '[yellow-ci] Warning: Cache activation failed\n' >&2
    rm -f "${cache_file}.tmp" 2>/dev/null
fi
```

**Alternative (More Concise):**

```bash
{
    printf '%s\n' "$workflow_runs_json" > "${cache_file}.tmp" &&
    printf '%s\n' "$failures_summary" >> "${cache_file}.tmp" &&
    chmod 644 "${cache_file}.tmp" &&
    mv "${cache_file}.tmp" "$cache_file"
} 2>/dev/null || {
    printf '[yellow-ci] Warning: Cache write failed\n' >&2
    rm -f "${cache_file}.tmp" 2>/dev/null
}
```

## Technical Details

**Location:** `plugins/yellow-ci/hooks/scripts/session-start.sh:89-92`

**Benefits:**
- Users see cache failures in stderr output
- Temp files cleaned up on failure
- Helps diagnose rate limit issues
- Aligns with project memory error handling patterns

**Considerations:**
- Warning goes to stderr (visible but non-fatal)
- Hook continues execution (degraded mode)
- Next successful cache write will recover state

**Testing:**
- Simulate disk full: `dd if=/dev/zero of=/tmp/fill bs=1M count=100`
- Verify warning appears in hook output
- Verify temp file is cleaned up
- Verify hook completes successfully (uses API fallback)

## Acceptance Criteria

- [ ] All `|| true` instances replaced with error logging
- [ ] Component prefix `[yellow-ci]` used in all warnings
- [ ] Temporary file cleanup added to error path
- [ ] Manual testing confirms warnings appear on cache failure
- [ ] Manual testing confirms temp files are cleaned up
- [ ] Hook continues to function (degraded mode) on cache failure
- [ ] No behavioral change when cache write succeeds
