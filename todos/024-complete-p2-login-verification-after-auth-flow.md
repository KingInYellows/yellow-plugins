---
status: complete
priority: p2
issue_id: '024'
tags: [code-review, reliability, testing]
dependencies: []
---

# login verification after auth flow

## Problem Statement

The test-runner agent performs login to the application but has no verification
step to confirm login succeeded before proceeding with tests. If login fails
silently, all subsequent tests would fail with confusing errors instead of clear
"authentication failed" message.

## Findings

- **File affected**: `agents/testing/test-runner.md`
- **Current behavior**: Login flow executed but success not verified
- **Failure mode**: Failed login → cascade of test failures with misleading
  errors
- **Impact**: Poor debugging experience, false negatives in test results

## Proposed Solutions

### Option A: Add explicit "verify login succeeded" step after auth (Recommended)

Check for authentication artifacts after login:

- Look for session cookies/tokens after login attempt
- Navigate to authenticated-only page and verify no redirect to login
- Check for authenticated user indicator in DOM
- Provides positive confirmation that authentication worked

### Option B: Check for auth cookies/tokens only

Simpler approach:

- After login, check browser storage for auth token/session cookie
- Assumes application uses cookies or localStorage for auth
- Faster but requires knowledge of auth implementation

## Recommended Action

Implement hybrid approach combining both options:

```markdown
After performing login flow:

1. Check browser storage for authentication artifacts:
   - Run `agent-browser execute "document.cookie"` and look for session cookie
   - Or check localStorage for auth token if app uses token-based auth
2. Navigate to a protected route that requires authentication
3. Verify no redirect back to login page
4. If any check fails: abort with "Authentication failed" error
5. Log authentication success before proceeding to tests
```

This provides defense in depth - both artifact checking and behavioral
verification.

## Technical Details

- **Location to modify**: `agents/testing/test-runner.md` (after login section)
- **Auth patterns to support**: Cookie-based, token-based, both
- **Protected route**: Use first route from test suite or dedicated auth-check
  endpoint
- **Error handling**: Should abort all testing, not attempt to run tests
  unauthenticated

## Acceptance Criteria

- [ ] Auth verification step added after login in test-runner
- [ ] Verification checks for session cookies/tokens
- [ ] Verification navigates to protected route and checks for no redirect
- [ ] Clear error message if authentication verification fails
- [ ] Manual test: provide wrong credentials, verify fast failure with correct
      error

## Work Log

| Date       | Action                          | Learnings                                                                            |
| ---------- | ------------------------------- | ------------------------------------------------------------------------------------ |
| 2026-02-13 | Created from PR #11 code review | Verification steps after critical operations prevent cascade failures in test suites |

## Resources

- PR: #11 (yellow-browser-test code review)
- Related: Test-conventions skill (credential handling)
- Pattern: Verify-then-proceed for critical workflow steps
