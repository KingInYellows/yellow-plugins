---
title: 'Devin review-prs Command: Shell and API Composition Bugs'
category: logic-errors
track: bug
problem: 'Devin review-prs Command: Shell and API Composition Bugs'
tags:
  - sed-regex
  - curl-fallback
  - jq-functions
  - cli-flag-verification
  - input-validation
  - shell-scripting
  - devin-integration
severity: high
module: plugins/yellow-devin
date: 2026-03-10
status: resolved
---

# Devin review-prs Command: Shell and API Composition Bugs

## Problem

The `devin:review-prs` command -- a composition command that discovers Devin
sessions, finds their PRs, tracks them in Graphite, and delegates review to
yellow-review -- had six bugs caught during multi-agent review. Two were P1
(silent data corruption), four were P2 (incorrect behavior under specific
conditions).

These bugs represent recurring patterns in shell-heavy command authoring that
apply broadly across yellow-plugins.

## Root Cause Analysis

### P1-1: Broken sed POSIX Character Class

**File:** `plugins/yellow-devin/commands/devin/review-prs.md` (line 84)

**Bug:** Used `[:digit:]` instead of `[[:digit:]]` (or `[0-9]`) in a sed regex
for stripping port numbers from HTTPS remote URLs.

```bash
# BROKEN: [:digit:] inside a character class is just the literal characters
sed -E -e 's#^[a-z+]+://([^@]+@)?[^/:]+(:[[:digit:]]+)?/##'
#                                        ^^^^^^^^^^^
# Without double brackets, [:digit:] is interpreted as the character set
# containing ':', 'd', 'i', 'g', 't' -- NOT the POSIX digit class
```

**Impact:** URLs like `https://github.com:443/owner/repo` would produce
`443/owner/repo` instead of `owner/repo`, causing silent session matching
failure against the Devin API.

**Fix:** Changed to `[0-9]` for maximum portability across sed implementations:

```bash
sed -E -e 's#^[a-z+]+://([^@]+@)?[^/:]+(:[0-9]+)?/##'
```

**Rule:** POSIX character classes (`[:digit:]`, `[:alpha:]`, etc.) require
double brackets when used inside a character class: `[[:digit:]]`. Prefer
`[0-9]`, `[a-zA-Z]` for portability.

### P1-2: Enterprise Fallback Missing Variable Reassignment

**File:** `plugins/yellow-devin/commands/devin/review-prs.md` (lines 362-372)

**Bug:** When the org-scoped Devin API endpoint returns 403 and the enterprise
fallback fires a second curl call, the response variables (`curl_exit`,
`http_status`, `body`) were not reassigned after the second curl.

```bash
# BROKEN: variables still hold org-scoped 403 response
if [ "$curl_exit" -eq 0 ] && [ "$http_status" = "403" ]; then
  response=$(curl -s ... "${ENTERPRISE_URL}/sessions/${SESSION_ID}/messages" ...)
  # Missing: curl_exit=$?
  # Missing: http_status=${response##*$'\n'}
  # Missing: body=${response%$'\n'*}
fi
# Post-send error handling evaluates STALE org-scoped 403, not enterprise result
```

**Impact:** Post-send error handling would evaluate the stale org-scoped 403
response, not the enterprise endpoint's actual response -- silently dropping
message delivery failures. If the enterprise endpoint returned a 500, the
command would report success (because `http_status` still held "403" from the
first call and the fallback block already handled that).

**Fix:** Added the canonical three-line reassignment after the enterprise curl:

```bash
if [ "$curl_exit" -eq 0 ] && [ "$http_status" = "403" ]; then
  response=$(curl -s ... "${ENTERPRISE_URL}/sessions/${SESSION_ID}/messages" ...)
  curl_exit=$?
  http_status=${response##*$'\n'}
  body=${response%$'\n'*}
fi
```

**Rule:** Every curl call in a fallback chain must reassign all three response
variables (`curl_exit`, `http_status`, `body`). The pattern is:
`response=$(curl ...); curl_exit=$?; http_status=${response##*$'\n'}; body=${response%$'\n'*}`.
Reference implementation: `plugins/yellow-devin/commands/devin/message.md:94-107`.

### P2-1: jq test() vs contains() for URL Substring Matching

**File:** `plugins/yellow-devin/commands/devin/review-prs.md` (line 130)

**Bug:** Used `jq test($repo)` to match repo name in PR URLs, but `test()`
interprets its argument as a regex. Repo names containing `.`, `+`, `(`, `)`,
or other regex metacharacters would either match incorrectly or cause jq regex
compilation errors.

```bash
# BROKEN: test() treats $repo as regex -- "my.repo" matches "myXrepo"
select(.pull_requests | any(.pr_url | test($repo)))

# FIXED: contains() does literal substring matching
select(.pull_requests | any(.pr_url | contains($repo)))
```

**Impact:** Silent false negatives ("No Devin sessions found") when repo names
contain regex metacharacters. False positives when `.` in repo names matches
any character.

**Rule:** Use `jq contains()` for literal substring matching. Reserve `test()`
for intentional regex matching only, and when using it, escape user-provided
strings or use `@text` format strings.

### P2-2: Non-existent Graphite CLI Flag

**Bug:** Referenced `gt restack --abort` which does not exist in the Graphite CLI.

**Fix:** Changed to `git rebase --abort` (the underlying git operation that
Graphite's restack wraps).

**Rule:** Before referencing any CLI flag in command authoring, verify it exists
with `<tool> --help` or documentation. This is a known pattern -- review bots
also suggest non-existent flags (see `docs/solutions/code-quality/automated-bot-review-false-positives.md`).

### P2-3: Missing --repo Flag on gh Commands

**Bug:** Lightweight review fallback used `gh pr checks`, `gh pr view --comments`,
and `gh pr diff --stat` without `--repo "$REPO"` flag.

**Impact:** When the current working directory's git remote does not match the
PR's repository (e.g., running from a fork), these commands would either fail
or query the wrong repository.

**Fix:** Added `--repo "$REPO"` to all three gh commands.

**Rule:** When a command operates on PRs discovered via API (not from the local
git context), always pass `--repo` explicitly to `gh` subcommands.

### P2-4: Missing Session ID Input Validation

**Bug:** `--session SESSION_ID` argument was used directly in API URL without
validation, allowing injection of path traversal or malformed session IDs.

**Fix:** Added `validate_session_id` check per the `devin-workflows` skill
pattern (`^[a-zA-Z0-9_-]{8,64}$`).

**Rule:** All user-supplied identifiers used in URL construction must be
validated against a strict allowlist regex before interpolation.

## Prevention

- [ ] When writing curl fallback chains, grep for the pattern
  `curl_exit=\$\?` after every `curl` call -- count must equal curl call count
- [ ] When using sed with character classes, search for `[:` without a
  preceding `[` -- this catches the single-bracket POSIX class mistake
- [ ] When using `jq test()`, verify the argument is intentionally a regex;
  default to `contains()` for literal matching
- [ ] Before referencing CLI flags, verify with `--help`; cross-reference
  MEMORY.md for known non-existent flags
- [ ] When using `gh` commands on PRs discovered via API, always include
  `--repo` flag

## Related Documentation

- `plugins/yellow-devin/commands/devin/message.md` -- canonical curl + fallback
  pattern (reference implementation for P1-2)
- `docs/solutions/code-quality/automated-bot-review-false-positives.md` --
  non-existent CLI flag pattern (related to P2-2)
- `docs/solutions/security-issues/yellow-devin-plugin-security-audit.md` --
  session ID validation requirements (related to P2-4)
- `docs/solutions/code-quality/yellow-ci-shell-security-patterns.md` --
  multi-layer input validation patterns
