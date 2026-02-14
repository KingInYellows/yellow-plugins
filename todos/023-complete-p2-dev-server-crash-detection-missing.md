---
status: complete
priority: p2
issue_id: "023"
tags: [code-review, reliability, error-handling]
dependencies: []
---

# dev server crash detection missing

## Problem Statement
After the browser-test command starts the dev server, if it crashes during test execution, there's no detection mechanism. Tests would fail with confusing connection errors instead of clear "server crashed" messages, making debugging difficult.

## Findings
- **File affected**: `commands/browser-test/test.md`
- **Current behavior**: Dev server started but not monitored during test execution
- **Failure mode**: Server crash → all subsequent tests fail with connection errors
- **Impact**: Poor debugging experience, wastes time investigating wrong issues

## Proposed Solutions

### Option A: Add periodic PID check during test execution (Recommended)
Check server process health at regular intervals:
- Store server PID in `.claude/browser-test-server.pid`
- Before each test batch, verify PID still exists and belongs to expected process
- Check `/proc/$PID/cmdline` matches expected server command
- If server dead: fail fast with clear "dev server crashed" message

### Option B: Check server health URL before each test batch
Poll health endpoint instead of PID:
- Assume dev server has health check endpoint (e.g., `/_health`)
- Curl health endpoint before running tests
- Simpler but assumes health endpoint exists

## Recommended Action
Implement Option A. PID-based checking is more reliable and doesn't require assumptions about server capabilities. Add health check logic to test-runner agent:

```markdown
Before running each test batch:
1. Read PID from `.claude/browser-test-server.pid`
2. Check if process exists: `kill -0 $PID`
3. Verify process is dev server: `cat /proc/$PID/cmdline | grep -q <server-command>`
4. If dead: abort with "Dev server crashed during testing" error
```

## Technical Details
- **Location to modify**: `agents/testing/test-runner.md` (test execution loop)
- **PID file location**: `.claude/browser-test-server.pid` (existing)
- **Check frequency**: Before each route tested (or batch of routes)
- **Error handling**: Should terminate all tests immediately, preserve partial results

## Acceptance Criteria
- [ ] PID validation check added to test-runner agent
- [ ] Check runs before each test or test batch
- [ ] Verification includes process existence and cmdline matching
- [ ] Clear error message when server crash detected
- [ ] Manual test: kill dev server mid-test, verify fast failure with correct error

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-13 | Created from PR #11 code review | Long-running process monitoring improves debugging experience for test failures |

## Resources
- PR: #11 (yellow-browser-test code review)
- Related: Issue #026 (PID file race condition) - coordinate fixes
- Pattern: Process health checking in automated workflows
