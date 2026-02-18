---
status: complete
priority: p3
issue_id: '083'
tags: [code-review, yellow-ci, performance]
dependencies: []
---

# Failure Analyst Log Size Limit

## Problem Statement

Log fetching in `failure-analyst.md` uses `head -n 500` to limit line count but
lacks byte-level protection. Extremely long lines (such as base64-encoded
artifacts in CI logs) could consume excessive memory.

## Findings

- **File**: `plugins/yellow-ci/agents/ci/failure-analyst.md`
- **Lines**: 53-56
- **Current limit**: 500 lines (no byte limit)
- **Risk**: 500 lines × 1MB/line = up to 500MB memory consumption

Example scenario:

```bash
gh run view "$RUN_ID" --log-failed 2>/dev/null | head -n 500
```

If a single line contains a large base64 blob or binary artifact dump, the
500-line limit won't protect against memory exhaustion.

## Proposed Solutions

Add byte-level limit after line limit:

```bash
gh run view "$RUN_ID" --log-failed 2>/dev/null | head -n 500 | head -c 5242880
```

- `head -c 5242880` = 5MB cap (5 × 1024 × 1024 bytes)
- Applied after line limit for defense in depth
- Prevents pathological cases while allowing normal logs through

## Technical Details

The 5MB limit is reasonable because:

- Typical CI failure logs are <100KB
- 5MB allows for verbose output while preventing abuse
- LLM context windows handle 5MB of text comfortably
- Preserves first 500 lines AND caps total size

## Acceptance Criteria

- [ ] Add `head -c 5242880` after `head -n 500` in log fetch commands
- [ ] Document the 5MB limit in agent file or ci-conventions
- [ ] Verify change doesn't break log analysis for typical failures
- [ ] Consider adding truncation warning if byte limit is hit
