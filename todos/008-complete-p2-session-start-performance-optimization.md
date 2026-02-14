---
status: complete
priority: p2
issue_id: "008"
tags: [code-review, performance, optimization]
dependencies: []
---

# SessionStart Hook Performance: Unbounded Queue Processing + Blocking Search

## Problem Statement

SessionStart spawns up to 20 `npx ruvector insert` subprocesses (each 150-500ms) plus 2 `npx ruvector search` calls (200-800ms). At scale, this exceeds the 3s budget causing timeout kills or persistent user-facing latency.

**Why it matters:** Users experience 1.5-3s delay on every session start. Heavy users with large queues hit timeout repeatedly.

## Findings

- **Performance Oracle (#1):** 20 entries x ~500ms = 10s worst case, exceeds 3s timeout
- **Performance Oracle (#2):** Two sequential npx search calls add 200-800ms blocking latency
- **Performance Oracle (#6):** Date mode check runs on every elapsed_ms() call (3x overhead)

## Proposed Solutions

### Option A: Batch queue processing + cache learnings (Recommended)
- Batch all entries into single npx call (60x faster)
- Cache learning retrieval with DB-mtime invalidation
- Parallelize the two search calls
- **Pros:** 3000ms -> 200ms for flush, 800ms -> 0ms for cached learnings
- **Cons:** Requires ruvector CLI batch support or JSONL stdin mode
- **Effort:** Medium (4-6 hours)
- **Risk:** Low

### Option B: Move flush to background
- Spawn non-blocking background job for queue processing
- Return immediately with cached learnings
- **Pros:** O(1) SessionStart regardless of queue size
- **Cons:** Flush not guaranteed before first search
- **Effort:** Medium (3-4 hours)
- **Risk:** Medium

## Technical Details

- **Affected file:** `plugins/yellow-ruvector/hooks/scripts/session-start.sh`
- Issues: lines 51-79 (queue processing), 99-113 (learning retrieval), 24-36 (date precision)

## Acceptance Criteria

- [ ] SessionStart completes in <500ms for typical usage (0-20 queue entries)
- [ ] Learning retrieval uses cache when DB unchanged
- [ ] Date mode detection cached at startup (not per-call)

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-12 | Created from PR #10 code review | Performance-oracle #1,#2,#6 |

## Resources

- PR: #10
