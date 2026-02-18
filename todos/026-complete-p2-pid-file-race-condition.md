---
status: complete
priority: p2
issue_id: '026'
tags: [code-review, reliability, race-condition]
dependencies: []
---

# PID file race condition

## Problem Statement

The browser-test command uses
`kill "$(cat .claude/browser-test-server.pid)" 2>/dev/null || true` to stop the
dev server. This has two issues: (1) reading PID and killing is not atomic -
process could exit and PID be reused by unrelated process, and (2) `|| true`
silently swallows all errors including real failures.

## Findings

- **File affected**: `commands/browser-test/test.md`
- **Current behavior**: PID read from file and killed without verification
- **Race condition**: Window between reading PID and killing allows PID reuse
- **Silent failures**: `|| true` suppresses error reporting
- **Impact**: Could kill wrong process in rare cases; no visibility into
  failures

## Proposed Solutions

### Option A: Verify PID belongs to expected process before killing (Recommended)

Add process verification step:

```bash
if [ -f .claude/browser-test-server.pid ]; then
    PID=$(cat .claude/browser-test-server.pid)
    # Verify it's actually the dev server
    if [ -e "/proc/$PID/cmdline" ] && grep -q "npm run dev\|next dev\|vite" "/proc/$PID/cmdline"; then
        kill "$PID" || printf '[browser-test] Failed to kill dev server (PID %s)\n' "$PID" >&2
    fi
    rm -f .claude/browser-test-server.pid
fi
```

Safer and follows project error logging conventions.

### Option B: Use process group instead of individual PID

Kill entire process group:

```bash
if [ -f .claude/browser-test-server.pid ]; then
    PGID=$(ps -o pgid= -p "$(cat .claude/browser-test-server.pid)" | tr -d ' ')
    kill -TERM -"$PGID" 2>/dev/null || true
fi
```

Handles child processes but harder to verify and still has verification gap.

## Recommended Action

Implement Option A. It provides better safety through verification and better
observability through error logging. The `/proc/$PID/cmdline` check ensures we
only kill processes that match expected dev server patterns.

## Technical Details

- **Location to modify**: `commands/browser-test/test.md` (cleanup section)
- **Process verification**: Use `/proc/$PID/cmdline` (Linux) or
  `ps -p $PID -o command=` (portable)
- **Dev server patterns**: `npm run dev`, `next dev`, `vite`,
  `webpack-dev-server`
- **Error logging**: Use `[browser-test]` component prefix per conventions
- **Cleanup**: Always remove PID file even if kill fails

## Acceptance Criteria

- [ ] PID verification added before kill command
- [ ] Verification checks `/proc/$PID/cmdline` matches dev server pattern
- [ ] Error logging added with component prefix (no `|| true`)
- [ ] PID file removed in all code paths
- [ ] Portable alternative provided for non-Linux systems
- [ ] Manual test: create fake PID file with unrelated process, verify no kill
- [ ] Manual test: verify error logged if kill fails

## Work Log

| Date       | Action                          | Learnings                                                                                        |
| ---------- | ------------------------------- | ------------------------------------------------------------------------------------------------ |
| 2026-02-13 | Created from PR #11 code review | PID-based process control requires verification to avoid race conditions and wrong-process kills |

## Resources

- PR: #11 (yellow-browser-test code review)
- Related: Issue #023 (dev server crash detection) - both use PID file
- Related: PR #10 error logging patterns
- Pattern: Always verify PID ownership before signaling
