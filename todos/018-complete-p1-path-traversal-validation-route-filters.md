---
status: complete
priority: p1
issue_id: "018"
tags: [code-review, security, input-validation]
dependencies: []
---

# Path traversal validation for route filters

## Problem Statement

The browser-test commands use `$ARGUMENTS` as route filters but never validate for path traversal sequences (`../`, URL-encoded sequences). A malicious route filter could cause agent-browser to navigate outside the intended application scope.

## Findings

**Files:**
- `plugins/yellow-browser-test/commands/browser-test/test.md`
- `plugins/yellow-browser-test/commands/browser-test/explore.md`

**Issue:** The commands accept route filter arguments and pass them directly to agent-browser without validation:

```bash
# No validation before use
agent-browser test --route "$ARGUMENTS"
```

An attacker could provide inputs like:
- `../../../etc/passwd` (path traversal)
- `%2e%2e%2f` (URL-encoded traversal)
- `//..//admin` (obfuscated traversal)
- `http://malicious.com` (absolute URL)

This could cause the browser to:
- Navigate to unintended domains
- Access sensitive application routes
- Bypass intended testing scope

## Proposed Solutions

### Option A: Validation regex (Recommended)

Add validation step to reject unsafe patterns:

```bash
# Validate route filter
if ! echo "$ARGUMENTS" | grep -qE '^/[a-zA-Z0-9/_-]*$'; then
  printf 'Error: Invalid route filter. Only /path/to/route format allowed.\n' >&2
  exit 1
fi

# Reject path traversal sequences
if echo "$ARGUMENTS" | grep -qE '\.\.|\%|//'; then
  printf 'Error: Route filter contains invalid sequences.\n' >&2
  exit 1
fi
```

**Pros:**
- Simple, explicit validation
- Rejects all known traversal patterns
- Clear error messages

**Cons:**
- May be too restrictive for some valid routes
- Need to maintain regex pattern

### Option B: Prefix with baseURL

Prefix the baseURL before passing to agent-browser:

```bash
# Construct full URL within app
FULL_URL="${BASE_URL}${ARGUMENTS}"
agent-browser test --url "$FULL_URL"
```

**Pros:**
- Relative paths always resolve within app
- Works with agent-browser's URL resolution

**Cons:**
- Relies on agent-browser's path handling
- Doesn't prevent absolute URL injection

## Recommended Action

Implement **Option A** with the following steps:

1. Add validation function to both test.md and explore.md commands
2. Reject arguments containing `..`, `%`, `//`, and other dangerous sequences
3. Only allow patterns matching `^/[a-zA-Z0-9/_-]*$`
4. Document valid route filter formats in command descriptions
5. Add test cases with malicious inputs

## Technical Details

**Current code locations:**
- `plugins/yellow-browser-test/commands/browser-test/test.md` (lines ~25-30)
- `plugins/yellow-browser-test/commands/browser-test/explore.md` (similar pattern)

**Attack vectors:**
- `../` sequences (standard path traversal)
- URL encoding: `%2e%2e%2f`, `%2e%2e/`, `..%2f`
- Double encoding: `%252e%252e%252f`
- Unicode: `%c0%ae%c0%ae/`
- Mixed: `//..//`, `/.../`, `/..;/`

**Validation pattern precedent:**
From yellow-ruvector plugin: `^[a-z0-9][a-z0-9-]*$` for namespace validation

## Acceptance Criteria

- [ ] Route filter validation added to test.md command
- [ ] Route filter validation added to explore.md command
- [ ] Path traversal patterns rejected (`..`, `%`, `//`, etc.)
- [ ] Only safe patterns allowed: `^/[a-zA-Z0-9/_-]*$`
- [ ] Clear error messages for invalid filters
- [ ] Tested with malicious inputs (path traversal, encoding, etc.)
- [ ] Valid route filter format documented in command descriptions

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-13 | Created from PR #11 code review | Route filters are untrusted input and must be validated for path traversal before use |

## Resources

- PR: #11 (yellow-browser-test plugin code review)
- Files: `plugins/yellow-browser-test/commands/browser-test/test.md`, `explore.md`
- Precedent: `plugins/yellow-ruvector/hooks/scripts/lib/validate.sh` validation patterns
- Related: Path traversal OWASP guidelines
