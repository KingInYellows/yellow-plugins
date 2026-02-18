---
status: complete
priority: p1
issue_id: '004'
tags: [code-review, error-handling, shell-scripting]
dependencies: []
---

# Critical Operations Silently Swallowed with || true and 2>/dev/null

## Problem Statement

All three hook scripts systematically swallow errors using `|| true` and
`2>/dev/null` on critical operations: queue appends, npx insert calls, npx
search calls, queue rotation, and JSON construction. This hides disk-full
errors, MCP crashes, permission failures, and corrupt queue entries from users
and developers.

**Why it matters:** Users believe code is being indexed and learnings are being
loaded, but failures are completely invisible. Silent failures accumulate,
eventually causing "search doesn't work" or "learnings not applied" with zero
diagnostic information.

## Findings

- **Silent Failure Hunter:** 4 CRITICAL + 5 HIGH issues — all stem from
  `|| true` / `2>/dev/null` pattern
  - #1: npx ruvector insert failures (session-start.sh:67)
  - #2: JSON validation skips without count (session-start.sh:59-62)
  - #5: npx ruvector search failures (session-start.sh:101-102)
  - #9: Queue append failures (post-tool-use.sh:66,86)
  - #10: Queue rotation mv failure (post-tool-use.sh:94)
- **Architecture Strategist:** Identified PostToolUse error logging as the main
  weakness (Grade B+)

## Proposed Solutions

### Option A: Log errors to stderr + optional error log file (Recommended)

- Replace `2>/dev/null || true` with `2>&1 || { log_error; true; }`
- Critical operations log to `.ruvector/hook-errors.log`
- Count failures and report summary in systemMessage
- **Pros:** Diagnostics available via `claude --debug` and error log
- **Cons:** Slightly more disk I/O
- **Effort:** Medium (2-3 hours across 3 hook files)
- **Risk:** Low

### Option B: Structured error reporting via systemMessage

- Track error counts during hook execution
- Return errors in JSON output for Claude to surface
- **Pros:** Errors visible to user without debug mode
- **Cons:** More complex JSON construction
- **Effort:** Medium (3-4 hours)
- **Risk:** Low

## Technical Details

- **Affected files:**
  - `plugins/yellow-ruvector/hooks/scripts/session-start.sh` (lines 67, 59-62,
    101-102)
  - `plugins/yellow-ruvector/hooks/scripts/post-tool-use.sh` (lines 66, 86, 94)
  - `plugins/yellow-ruvector/hooks/scripts/stop.sh` (line 37)

## Acceptance Criteria

- [ ] No `2>/dev/null || true` on critical operations (insert, search, append,
      rotation)
- [ ] All failures logged to stderr with actionable context
- [ ] Failed operation count tracked and reported
- [ ] Malformed queue entry count logged (not just "skipping")
- [ ] jq construction failures have fallback JSON output

## Work Log

| Date       | Action                          | Learnings                                              |
| ---------- | ------------------------------- | ------------------------------------------------------ |
| 2026-02-12 | Created from PR #10 code review | Silent-failure-hunter #1,#2,#5,#9,#10; architecture B+ |

## Resources

- PR: #10
- Shell documentation patterns: project memory (PR #7 guidelines)
