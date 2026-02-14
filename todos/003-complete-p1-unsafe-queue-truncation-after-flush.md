---
status: complete
priority: p1
issue_id: "003"
tags: [code-review, data-integrity, concurrency]
dependencies: []
---

# Unsafe Queue Truncation After Flush Loses Concurrent Writes

## Problem Statement

In `session-start.sh`, after processing 20 queue entries, the script truncates the queue. Between `tail` creating the temp file and `mv` replacing the queue, `post-tool-use.sh` can append new entries to the original queue file. The `mv` then overwrites those new entries.

**Why it matters:** ~10% chance per flush of losing entries when >20 entries exist. Common in active development sessions.

## Findings

- **Data Integrity Guardian (#3, CRITICAL):** Race between tail/mv and concurrent PostToolUse appends
- **Security Sentinel (H5):** TOCTOU race — queue_lines counted outside lock, processed inside
- **Silent Failure Hunter (#4):** tail failure leaves partial .tmp file, no cleanup or logging

## Proposed Solutions

### Option A: Move truncation inside flock block (Recommended)
- Ensure the `mv` operation happens while holding the exclusive lock
- PostToolUse appends use the same lock for coordination
- **Pros:** Eliminates race completely
- **Cons:** PostToolUse appends briefly blocked during flush
- **Effort:** Small (1 hour)
- **Risk:** Low

### Option B: Copy-on-write pattern
- Copy queue to temp, process temp, diff and remove processed entries
- **Pros:** No lock contention on writes
- **Cons:** Complex, higher I/O
- **Effort:** Medium (3 hours)
- **Risk:** Medium

## Technical Details

- **Affected file:** `plugins/yellow-ruvector/hooks/scripts/session-start.sh` (lines 71-76)
- **Related file:** `plugins/yellow-ruvector/hooks/scripts/post-tool-use.sh` (append operations)

## Acceptance Criteria

- [ ] Queue truncation and append operations are mutually exclusive
- [ ] No entries lost during flush when concurrent writes occur
- [ ] tail failure is detected and logged (no silent .tmp files left)
- [ ] queue_lines is re-counted inside the lock

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-12 | Created from PR #10 code review | Data-integrity #3, security H5, silent-failure #4 |

## Resources

- PR: #10
