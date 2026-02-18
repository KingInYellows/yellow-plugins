---
status: complete
priority: p1
issue_id: '061'
tags: [code-review, performance, yellow-review]
dependencies: []
---

# O(n²) JSON Accumulation in Pagination

## Problem Statement

The `get-pr-comments` pagination loop accumulates results using
`jq -s '.[0] + .[1]'` on each iteration, causing O(n²) performance as each merge
re-parses all previously accumulated JSON.

## Findings

- **Source:** performance-oracle (highest impact finding)
- **File:**
  `plugins/yellow-review/skills/pr-review-workflow/scripts/get-pr-comments`
- **Evidence:** Each page merge re-serializes all previous pages. For PRs with
  10+ pages of review threads, this causes noticeable slowdown.

## Proposed Solutions

### Option A: Bash array accumulation (Recommended)

- Store each page's JSON in a bash array element
- Single `jq -s 'add'` merge at the end of pagination
- O(n) total parsing instead of O(n²)
- **Effort:** Small (10 min)
- **Risk:** Low

### Option B: Temp file concatenation

- Write each page to a temp file, merge all at end
- **Effort:** Small (10 min)
- **Risk:** Low, but adds temp file cleanup concern

## Recommended Action

Option A — cleaner, no temp files needed.

## Technical Details

- **Affected files:**
  `plugins/yellow-review/skills/pr-review-workflow/scripts/get-pr-comments`
- **Components:** Pagination accumulation loop

## Acceptance Criteria

- [ ] JSON pages accumulated in array, merged once at end
- [ ] Output identical to current implementation
- [ ] All existing bats tests pass

## Work Log

| Date       | Action                   | Learnings                                |
| ---------- | ------------------------ | ---------------------------------------- |
| 2026-02-14 | Created from code review | Performance oracle provided concrete fix |

## Resources

- PR stack: #13, #14, #15
