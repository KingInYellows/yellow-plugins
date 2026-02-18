---
status: complete
priority: p2
issue_id: '025'
tags: [code-review, reliability, error-handling]
dependencies: []
---

# exit code not checked for agent-browser commands

## Problem Statement

The test-runner agent invokes agent-browser CLI commands but has no explicit
guidance to check exit codes or handle failures. Commands may fail silently,
causing subsequent steps to operate on stale/incorrect state.

## Findings

- **File affected**: `agents/testing/test-runner.md`
- **Current behavior**: agent-browser commands invoked without error checking
  guidance
- **Failure mode**: Failed command → agent continues with stale state →
  confusing errors
- **Impact**: Silent failures make debugging difficult, reduces reliability

## Proposed Solutions

### Option A: Add "check exit code after each agent-browser command" instruction (Recommended)

Add explicit error checking to agent instructions:

- After each agent-browser command, verify exit code is 0
- If non-zero: check stderr for error message
- Log error with `[test-runner]` prefix per project conventions
- Abort test execution on command failure
- Simple to implement, works with existing Bash tool

### Option B: Wrap agent-browser calls in error-checking helper

Create shell helper function:

- Add to command scripts that invoke test-runner
- Wrapper checks exit code and logs failures automatically
- More robust but requires script modifications

## Recommended Action

Implement Option A in test-runner agent instructions. Add explicit error
checking guidance:

````markdown
Error Handling Pattern: After each agent-browser command:

1. Check exit code: `$?` should be 0
2. If non-zero: read stderr for error details
3. Log failure: `printf '[test-runner] agent-browser failed: %s\n' "$ERROR" >&2`
4. Abort current test and mark as FAILED
5. Continue with next test (don't abort entire run)

Example:

```bash
agent-browser navigate "$URL" || {
    printf '[test-runner] Navigation failed: %s\n' "$(cat stderr)" >&2
    echo "FAILED" > current-test-status
    continue
}
```
````

```

This follows project conventions for error logging with component prefixes.

## Technical Details
- **Location to modify**: `agents/testing/test-runner.md` (error handling section)
- **Exit codes**: 0 = success, non-zero = failure
- **Error context**: Capture stderr or last output line for diagnostics
- **Recovery strategy**: Fail current test but continue test suite

## Acceptance Criteria
- [ ] Error checking guidance added to test-runner agent
- [ ] Pattern shows exit code check after agent-browser commands
- [ ] Error logging includes component prefix `[test-runner]`
- [ ] Guidance specifies failure handling: abort test, continue suite
- [ ] Example code demonstrates error checking pattern
- [ ] Manual test: force agent-browser failure, verify proper error handling

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-13 | Created from PR #11 code review | Explicit error checking prevents silent failures and improves debuggability |

## Resources
- PR: #11 (yellow-browser-test code review)
- Related: PR #10 error logging patterns (component prefix convention)
- Pattern: Always check exit codes for external commands
```
