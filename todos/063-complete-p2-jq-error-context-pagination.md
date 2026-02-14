---
status: pending
priority: p2
issue_id: "063"
tags: [code-review, silent-failure, yellow-review]
dependencies: []
---

# Missing jq Error Context in Pagination

## Problem Statement

The `get-pr-comments` pagination loop pipes GraphQL responses through jq but doesn't capture stderr. If jq fails to parse a response (malformed JSON, unexpected schema), the error is silently lost.

## Findings

- **Source:** silent-failure-hunter (CRITICAL)
- **File:** `plugins/yellow-review/skills/pr-review-workflow/scripts/get-pr-comments`
- **Evidence:** `jq` stderr not captured; parse failures produce empty output with no diagnostic

## Proposed Solutions

### Option A: Capture jq stderr (Recommended)
- Redirect jq stderr to a variable, log on failure with `[get-pr-comments] Error:` prefix
- Check jq exit code explicitly
- **Effort:** Small (10 min)
- **Risk:** Low

## Recommended Action

Option A.

## Technical Details

- **Affected files:** `plugins/yellow-review/skills/pr-review-workflow/scripts/get-pr-comments`

## Acceptance Criteria

- [ ] jq parse errors logged to stderr with component prefix
- [ ] Non-zero jq exit code causes clean error exit
- [ ] Existing tests pass

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-14 | Created from code review | Silent failure hunter flagged |

## Resources

- PR stack: #13, #14, #15
