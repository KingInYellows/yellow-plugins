---
status: complete
priority: p2
issue_id: '030'
tags: [code-review, performance]
dependencies: []
---

# polling busy-wait

## Problem Statement

The dev server readiness polling in browser-test command likely uses a tight
loop without sleep between attempts. This wastes CPU cycles while waiting for
the server to start, especially problematic in CI environments or on shared
systems.

## Findings

- **File affected**: `commands/browser-test/test.md`
- **Current behavior**: Polling loop likely has no delay between attempts
- **Impact**: Unnecessary CPU usage during startup wait period
- **Typical wait time**: 5-30 seconds depending on application size
- **Wasted resources**: Can spin-loop hundreds of times per second

## Proposed Solutions

### Option A: Add explicit `sleep 1` between poll attempts (Recommended)

Simple and effective:

```bash
ATTEMPT=0
MAX_ATTEMPTS=30
while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    if curl -s -f "http://localhost:$PORT" >/dev/null 2>&1; then
        break
    fi
    ATTEMPT=$((ATTEMPT + 1))
    sleep 1  # Wait 1 second between attempts
done
```

Standard pattern, easy to understand, sufficient for most cases.

### Option B: Use exponential backoff

More sophisticated approach:

```bash
DELAY=0.1
MAX_DELAY=5
while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    if curl -s -f "http://localhost:$PORT" >/dev/null 2>&1; then
        break
    fi
    sleep "$DELAY"
    DELAY=$(awk "BEGIN {print ($DELAY * 1.5 > $MAX_DELAY) ? $MAX_DELAY : $DELAY * 1.5}")
    ATTEMPT=$((ATTEMPT + 1))
done
```

Faster initial response for quick servers, caps at reasonable max delay.

## Recommended Action

Implement Option A. One-second delay is simple, predictable, and sufficient. Dev
servers typically take several seconds to start, so 1-second polling interval is
appropriate. Exponential backoff adds complexity without significant benefit for
this use case.

## Technical Details

- **Location to modify**: `commands/browser-test/test.md` (readiness polling
  loop)
- **Delay value**: 1 second (reasonable for dev server startup)
- **Max attempts**: 30 (30 seconds total timeout)
- **Sleep command**: Use `sleep 1` (standard across all Unix systems)

## Acceptance Criteria

- [ ] `sleep 1` added to polling loop between attempts
- [ ] Polling loop maintains 30-second total timeout
- [ ] Documentation mentions 1-second poll interval
- [ ] Manual test: monitor CPU during server startup, verify low usage
- [ ] Manual test: verify server detected within 1 second of becoming ready

## Work Log

| Date       | Action                          | Learnings                                                                 |
| ---------- | ------------------------------- | ------------------------------------------------------------------------- |
| 2026-02-13 | Created from PR #11 code review | Polling loops should always include delays to avoid wasting CPU resources |

## Resources

- PR: #11 (yellow-browser-test code review)
- Related: Issue #027 (curl stderr suppression) - same polling loop
- Pattern: Always sleep in polling loops, 1 second is reasonable default
