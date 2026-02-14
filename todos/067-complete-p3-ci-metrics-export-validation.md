---
status: pending
priority: p3
issue_id: "067"
tags: [code-review, silent-failure, ci]
dependencies: []
---

# CI Metrics Export Validation

## Problem Statement

The CI `export-ci-metrics.sh` script's failure is not validated — if metric export fails, the pipeline continues silently without diagnostics.

## Findings

- **Source:** silent-failure-hunter (HIGH)
- **File:** CI scripts (export-ci-metrics.sh)

## Proposed Solutions

### Option A: Add exit code checks + stderr logging
- Check exit codes of metric export commands
- Log failures with `[ci-metrics] Error:` prefix
- Don't fail the pipeline, but make failures visible
- **Effort:** Small (10 min)
- **Risk:** Low

## Recommended Action

Option A.

## Technical Details

- **Affected files:** CI metric export scripts

## Acceptance Criteria

- [ ] Metric export failures logged to stderr
- [ ] Pipeline continues on metric failure (non-blocking)

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-14 | Created from code review | |

## Resources

- PR stack: #13, #14, #15
