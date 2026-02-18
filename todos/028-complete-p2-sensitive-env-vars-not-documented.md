---
status: complete
priority: p2
issue_id: '028'
tags: [code-review, security, documentation]
dependencies: []
---

# sensitive env vars not documented

## Problem Statement

The test-conventions skill mentions using environment variables for test
credentials but doesn't specify naming convention or warn about exposure in
logs/reports. Without clear guidance, users may use inconsistent names or
accidentally expose credentials.

## Findings

- **File affected**: `skills/test-conventions/SKILL.md`
- **Current state**: Credential handling section exists but lacks specifics
- **Missing elements**:
  - No naming convention for credential env vars
  - No warning about log/report exposure
  - No guidance on masking credentials in output
- **Impact**: Inconsistent usage, potential credential leaks in CI logs or test
  reports

## Proposed Solutions

### Option A: Add naming convention and exposure warnings (Recommended)

Extend credential handling section with:

````markdown
### Environment Variables for Test Credentials

**Naming Convention:**

- Use `BROWSER_TEST_` prefix for all test credential variables
- Examples: `BROWSER_TEST_USERNAME`, `BROWSER_TEST_PASSWORD`,
  `BROWSER_TEST_API_KEY`
- Consistent naming makes it easier to exclude from logs/reports

**Security Warnings:**

- NEVER log credential values directly
- Test reports should mask credentials: `***` instead of actual value
- CI systems may expose env vars in logs - verify your CI config redacts secrets
- Use `.env` files for local testing, never commit them

**Credential Masking:** When logging authentication attempts:

```bash
printf '[test-runner] Logging in as user: %s\n' "$BROWSER_TEST_USERNAME" >&2
# DON'T: printf 'Password: %s\n' "$BROWSER_TEST_PASSWORD"
```
````

```

### Option B: Reference external credential management guide
Link to separate security documentation:
- Keep skill focused on testing conventions
- Reference comprehensive credential management guide
- Easier to maintain security guidance in one place

## Recommended Action
Implement Option A. Credential handling is critical enough to warrant inline documentation in the skill. Users need this guidance immediately when setting up tests, not after navigating to separate docs.

## Technical Details
- **Location to modify**: `skills/test-conventions/SKILL.md` (credential handling section)
- **Convention**: `BROWSER_TEST_*` prefix for all credential variables
- **Masking pattern**: Replace value with `***` in all output
- **CI considerations**: Add note about GitHub Actions secret redaction

## Acceptance Criteria
- [ ] Naming convention `BROWSER_TEST_*` documented in test-conventions skill
- [ ] Warning added about log/report exposure
- [ ] Credential masking guidance with code examples
- [ ] CI-specific guidance (GitHub Actions, etc.)
- [ ] Example showing correct vs incorrect logging practices
- [ ] Documentation reviewed for any existing credential exposure

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-13 | Created from PR #11 code review | Credential handling requires explicit naming conventions and exposure warnings to prevent accidental leaks |

## Resources
- PR: #11 (yellow-browser-test code review)
- Related: Security patterns from PR #9 (prompt injection, validation)
- Pattern: Defense-in-depth for credential protection
```
