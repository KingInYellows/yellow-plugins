---
status: complete
priority: p2
issue_id: "027"
tags: [code-review, error-handling, observability]
dependencies: []
---

# curl stderr suppressed

## Problem Statement
The dev server readiness check in browser-test command likely uses curl but suppresses stderr, making network errors invisible. Per project conventions from PR #10, errors should be logged with component prefix rather than silently suppressed with `2>/dev/null`.

## Findings
- **File affected**: `commands/browser-test/test.md` (readiness polling)
- **Current behavior**: Stderr likely suppressed during polling loop
- **Impact**: Network errors (DNS failures, connection refused, timeouts) are invisible
- **Violation**: Project convention requires error logging with component prefix

## Proposed Solutions

### Option A: Log curl failures with `[browser-test]` prefix (Recommended)
Replace stderr suppression with error capture and logging:
```bash
ERROR=$(curl -s -f "http://localhost:$PORT" 2>&1 >/dev/null)
if [ $? -ne 0 ]; then
    printf '[browser-test] Waiting for dev server (attempt %d/%d): %s\n' "$ATTEMPT" "$MAX_ATTEMPTS" "$ERROR" >&2
    sleep 1
    continue
fi
```
Follows project conventions and aids debugging.

### Option B: Capture and display last curl error on polling timeout
Only log errors if all retries exhausted:
```bash
# In polling loop
LAST_ERROR=$(curl -s -f "http://localhost:$PORT" 2>&1 >/dev/null)

# After loop timeout
if [ "$READY" = "false" ]; then
    printf '[browser-test] Dev server failed to start after %d seconds. Last error: %s\n' "$TIMEOUT" "$LAST_ERROR" >&2
    exit 1
fi
```
Less verbose but still provides diagnostic info.

## Recommended Action
Implement Option A for better observability during polling. Users can see progress and diagnose issues earlier. On timeout, provide summary with final error state.

Combined approach:
```bash
ATTEMPT=0
MAX_ATTEMPTS=30
while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    ERROR=$(curl -s -f "http://localhost:$PORT" 2>&1 >/dev/null)
    if [ $? -eq 0 ]; then
        printf '[browser-test] Dev server ready\n' >&2
        break
    fi
    ATTEMPT=$((ATTEMPT + 1))
    printf '[browser-test] Waiting for dev server (%d/%d)...\n' "$ATTEMPT" "$MAX_ATTEMPTS" >&2
    sleep 1
done

if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
    printf '[browser-test] Dev server failed to start after %d seconds. Last error: %s\n' "$MAX_ATTEMPTS" "$ERROR" >&2
    exit 1
fi
```

## Technical Details
- **Location to modify**: `commands/browser-test/test.md` (readiness polling section)
- **Component prefix**: `[browser-test]` per project conventions
- **Error capture**: Use `2>&1 >/dev/null` to capture only stderr
- **curl flags**: `-s` (silent), `-f` (fail on HTTP errors)

## Acceptance Criteria
- [ ] Stderr suppression (`2>/dev/null`) removed from readiness check
- [ ] Error messages logged with `[browser-test]` component prefix
- [ ] Progress messages show attempt count
- [ ] Timeout error includes last curl error message
- [ ] Manual test: start with port blocked, verify errors visible
- [ ] Manual test: start with DNS failure, verify error logged

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-13 | Created from PR #11 code review | Project conventions require component-prefixed error logging instead of stderr suppression |

## Resources
- PR: #11 (yellow-browser-test code review)
- Related: PR #10 error logging patterns (`|| true` → component prefix)
- Convention: Always log errors with component prefix for debuggability
