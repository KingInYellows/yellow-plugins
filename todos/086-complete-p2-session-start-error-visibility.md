---
status: complete
priority: p2
issue_id: '086'
tags: [code-review, yellow-ci, observability]
dependencies: []
---

# Session Start Error Visibility

## Problem Statement

`session-start.sh` uses `2>/dev/null` in 8 locations, hiding errors from GitHub
API failures, jq parsing issues, and cache operations. When the hook silently
fails, users get no CI failure notifications without any indication that the
hook is broken.

## Findings

- **File**: `plugins/yellow-ci/hooks/scripts/session-start.sh`
- **Lines with suppression**: 32, 41, 59, 69, 80, 84, 95-98
- **Key concern**: API rate limits (HTTP 429), auth expiration, and malformed
  JSON responses are all invisible

**Most impactful locations:**

1. Line 32: `mkdir -p "$cache_dir" 2>/dev/null || exit 0` — cache dir creation
   fails silently
2. Line 59: jq filter on API response — malformed JSON becomes empty result
3. Line 69: `jq -r 'length' 2>/dev/null` — parse failure becomes
   `failure_count=0`

## Proposed Solutions

**Option 1 (Recommended): Selective logging for actionable errors**

- Keep `2>/dev/null` for expected benign failures (stat, rm)
- Add `[yellow-ci]` prefixed warnings for actionable failures (mkdir, jq, API)
- Log to stderr so hook output stays clean
- **Effort**: Small
- **Risk**: Low

**Key principle**: Log errors users can act on (auth expired, API down),
suppress errors that are expected (cache miss, no stat).

## Acceptance Criteria

- [ ] mkdir failure logs warning (line 32)
- [ ] jq parse failures log warnings (lines 59, 69, 84)
- [ ] Keep 2>/dev/null for expected benign cases (stat, rm)
- [ ] All messages use [yellow-ci] component prefix
- [ ] Hook still completes within 3s budget
- [ ] Hook still degrades gracefully (no crashes)
