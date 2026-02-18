---
status: complete
priority: p2
issue_id: '029'
tags: [code-review, reliability, data-loss]
dependencies: []
---

# incremental test result saves missing

## Problem Statement

The test-runner agent writes results only at the end of the test run. If the
agent crashes mid-run, all results are lost. For long test runs, this means
significant work can be lost without any artifacts to show what was tested.

## Findings

- **File affected**: `agents/testing/test-runner.md`
- **Current behavior**: Results accumulated in memory and written once at
  completion
- **Failure mode**: Agent crash → all results lost, no indication of progress
- **Impact**: Work loss on long test runs, difficult to debug intermittent
  failures

## Proposed Solutions

### Option A: Write results after each route tested (Recommended)

Append results incrementally to file:

````markdown
After completing each route test:

1. Append result to `.claude/browser-test-results.jsonl` (JSONL format)
2. Each line is a complete test result JSON object
3. On completion, consolidate JSONL into final summary JSON
4. If crash occurs, partial results still available in JSONL file

Format:

```jsonl
{"route":"/","status":"PASSED","timestamp":"2026-02-13T10:00:00Z","assertions":5}
{"route":"/about","status":"FAILED","timestamp":"2026-02-13T10:00:15Z","error":"404 Not Found"}
```
````

```

### Option B: Use append-mode to results file
Simpler approach:
- Open results file in append mode from start
- Write each test result immediately
- Less structured but prevents data loss

## Recommended Action
Implement Option A. JSONL format provides both incremental saving and structured data. Final step consolidates into human-readable summary. This follows similar patterns from yellow-ruvector's queue system.

## Technical Details
- **Location to modify**: `agents/testing/test-runner.md` (result recording section)
- **File format**: JSONL (`.jsonl`) for incremental writes, JSON for final summary
- **Append pattern**: `printf '%s\n' "$JSON" >> .claude/browser-test-results.jsonl`
- **Recovery**: On restart, check for existing JSONL and offer to resume or restart
- **Final consolidation**: Convert JSONL to summary JSON with counts and grouped failures

## Acceptance Criteria
- [ ] Test results written incrementally after each route tested
- [ ] JSONL format used for intermediate results
- [ ] Final consolidation step creates summary JSON report
- [ ] Recovery guidance for resuming after crash
- [ ] Documentation explains incremental save pattern
- [ ] Manual test: kill test-runner mid-run, verify partial results exist
- [ ] Manual test: verify JSONL consolidation produces correct summary

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-13 | Created from PR #11 code review | Incremental result saving prevents data loss in long-running test suites |

## Resources
- PR: #11 (yellow-browser-test code review)
- Related: yellow-ruvector JSONL queue pattern (similar incremental append pattern)
- Pattern: Append-mode for crash-resistant data collection
```
