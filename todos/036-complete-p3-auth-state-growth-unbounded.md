---
status: complete
priority: p3
issue_id: '036'
tags: [code-review, maintenance, security]
dependencies: []
---

# Auth State Growth Unbounded

## Problem Statement

Config stores auth state (cookies, tokens) that may grow unbounded. No
expiration or rotation documented. Over time, auth state could accumulate
stale/expired credentials, consuming config file space and potentially creating
security issues.

## Findings

- File: skills/test-conventions/SKILL.md (config schema)
- `authState` field stores cookies, localStorage, sessionStorage
- No TTL or expiration mechanism documented
- No guidance on when to refresh or rotate auth state
- Stale auth tokens could fail tests without clear error messages
- Multiple test runs could append duplicate auth entries

## Proposed Solutions

### Option A: Add TTL to Auth State Entries (Recommended)

- Add `authStateExpiry` timestamp field to config schema
- Document that auth state expires after N days (e.g., 30 days)
- Commands check expiry and re-prompt for auth if expired
- Auto-cleanup of expired auth state on command run

### Option B: Document Manual Cleanup Process

- Add troubleshooting section to test-conventions skill
- Document how to manually clear auth state
- Recommend re-running setup periodically
- Simpler but requires user awareness

## Recommended Action

Implement Option A with 30-day TTL. Add `authStateExpiry` to config schema.
Commands check expiry before test run and re-prompt if expired. Document auth
refresh process in test-conventions skill.

## Technical Details

```yaml
# Updated config schema
authState:
  cookies: [...]
  localStorage: { ... }
  sessionStorage: { ... }
  expiresAt: '2026-03-15T00:00:00Z' # Added field
```

```bash
# Pseudo-code for expiry check in commands
auth_expiry=$(yq '.authState.expiresAt' "$config_file")
if [[ $(date +%s) -gt $(date -d "$auth_expiry" +%s) ]]; then
  echo "Auth state expired, re-run setup"
  exit 1
fi
```

## Acceptance Criteria

- [ ] Add `authStateExpiry` field to config schema in test-conventions/SKILL.md
- [ ] Setup command sets expiry to 30 days from setup date
- [ ] Test/explore commands check expiry before spawning agents
- [ ] Clear error message when auth state is expired
- [ ] Document auth refresh process in troubleshooting section

## Work Log

| Date       | Action                          | Learnings                                                   |
| ---------- | ------------------------------- | ----------------------------------------------------------- |
| 2026-02-13 | Created from PR #11 code review | P3 maintenance/security finding - prevents auth state bloat |

## Resources

- PR: #11 (yellow-browser-test plugin code review)
- Related files: skills/test-conventions/SKILL.md,
  commands/browser-test/setup.md
