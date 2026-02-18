---
status: complete
priority: p1
issue_id: '002'
tags: [code-review, data-integrity, concurrency]
dependencies: []
---

# Queue Rotation Race Condition Causes Data Loss

## Problem Statement

Queue rotation in `post-tool-use.sh` is NOT atomic. Between `mv` and `: >`
(truncate), a concurrent hook can append entries that are immediately lost. If
the process crashes between these operations, the queue file disappears
entirely.

**Why it matters:** Permanent data loss with no recovery path. Entries written
during the rotation window are silently dropped.

## Findings

- **Data Integrity Guardian (#1, CRITICAL):** Race window between `mv` and `: >`
  allows concurrent writes to be lost
- **Security Sentinel (H2):** Rotation also doesn't validate `.jsonl.1` already
  exists, doesn't check for symlinks
- **Silent Failure Hunter (#10):** `mv` failure with `|| true` means `: >` still
  executes, truncating the original queue
- **Performance Oracle (#4):** `wc -c` runs on every tool use even when file is
  small

## Proposed Solutions

### Option A: flock-protected rotation (Recommended)

- Wrap rotation in the same lock used by session-start flush
- Check `mv` success before truncating
- **Pros:** Atomic, prevents concurrent write loss
- **Cons:** Adds brief lock contention on PostToolUse hot path
- **Effort:** Small (1 hour)
- **Risk:** Low

### Option B: Rename-based atomic rotation

- Write new entries to a temp file, atomically rename
- **Pros:** No lock needed
- **Cons:** More complex, still has edge cases
- **Effort:** Medium (2-3 hours)
- **Risk:** Medium

## Technical Details

- **Affected file:** `plugins/yellow-ruvector/hooks/scripts/post-tool-use.sh`
  (lines 90-98)
- **Related file:** `plugins/yellow-ruvector/hooks/scripts/session-start.sh`
  (flush lock)

## Acceptance Criteria

- [ ] Queue rotation is atomic (no data loss window)
- [ ] `mv` failure does NOT trigger queue truncation
- [ ] Symlink queue files are rejected
- [ ] `wc -c` output is validated as numeric
- [ ] Concurrent PostToolUse during rotation doesn't lose entries

## Work Log

| Date       | Action                          | Learnings                                          |
| ---------- | ------------------------------- | -------------------------------------------------- |
| 2026-02-12 | Created from PR #10 code review | Data-integrity #1, security H2, silent-failure #10 |

## Resources

- PR: #10
