---
status: complete
priority: p2
issue_id: "011"
tags: [code-review, concurrency, reliability]
dependencies: []
---

# Stale flock Detection and Flush-Needed Flag

## Problem Statement

When flock fails (stale lock from crashed session, filesystem doesn't support flock), the flush is silently skipped forever. No mechanism detects stale locks or ensures eventual flush.

## Findings

- **Silent Failure Hunter (#3):** flock failure causes silent skip, no stale lock detection
- **Data Integrity Guardian (#4):** Non-blocking flock silently drops flushes; starvation scenario
- **Data Integrity Guardian (#5):** Rotated file cleanup can race with active reads

## Proposed Solutions

### Option A: Stale lock detection + flush-needed flag (Recommended)
- Check lock file age; remove if >1 hour
- Create `flush-needed` flag file when flush skipped
- Prioritize flushing on next SessionStart if flag exists
- **Effort:** Small (1-2 hours)
- **Risk:** Low

## Acceptance Criteria

- [ ] Stale locks (>1 hour) detected and removed
- [ ] Skipped flushes create a retry flag
- [ ] Next SessionStart prioritizes flush when flag exists

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-12 | Created from PR #10 code review | Silent-failure #3, data-integrity #4,#5 |

## Resources

- PR: #10
