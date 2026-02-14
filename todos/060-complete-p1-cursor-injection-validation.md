---
status: pending
priority: p1
issue_id: "060"
tags: [code-review, security, yellow-review]
dependencies: []
---

# Cursor Injection Validation in get-pr-comments

## Problem Statement

The `get-pr-comments` script uses cursor values from GitHub GraphQL responses directly in shell variables without validating their format. A malicious or malformed cursor could inject shell metacharacters.

## Findings

- **Source:** security-sentinel (M1), silent-failure-hunter (CRITICAL)
- **File:** `plugins/yellow-review/skills/pr-review-workflow/scripts/get-pr-comments`
- **Evidence:** `CURSOR` variable is set from `jq -r '.data...endCursor'` output and used in subsequent GraphQL query string construction without format validation
- **Risk:** Shell injection via crafted cursor values in GraphQL response

## Proposed Solutions

### Option A: Validate cursor format (Recommended)
- Add regex validation: cursor should match `^[a-zA-Z0-9+/=_-]+$` (base64-like)
- Reject and abort pagination if cursor contains unexpected characters
- **Effort:** Small (15 min)
- **Risk:** Low

### Option B: Use jq for query construction
- Build the entire GraphQL query JSON via `jq -n --arg` instead of string interpolation
- **Effort:** Medium (30 min)
- **Risk:** Low, but more invasive change

## Recommended Action

Option A — simple validation guard before use.

## Technical Details

- **Affected files:** `plugins/yellow-review/skills/pr-review-workflow/scripts/get-pr-comments`
- **Components:** Pagination loop (lines ~80-120)

## Acceptance Criteria

- [ ] Cursor values validated against safe character pattern before use in queries
- [ ] Invalid cursor causes clean error exit with descriptive message
- [ ] Existing pagination tests still pass

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-14 | Created from code review | Security + silent-failure agents both flagged |

## Resources

- PR stack: #13, #14, #15
- Memory: shell script security patterns
