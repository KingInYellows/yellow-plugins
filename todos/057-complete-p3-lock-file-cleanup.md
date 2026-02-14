---
status: complete
priority: p3
issue_id: "057"
tags: [code-review, resource-cleanup, quality]
dependencies: []
pr_number: 12
---

# 🔵 P3: Missing Lock File Cleanup in State Transitions

## Problem Statement

The `transition_todo_state()` function creates lock files (`${todo_file}.lock`) but never explicitly deletes them, causing lock file accumulation.

## Findings

**Location**: `plugins/yellow-debt/lib/validate.sh:54-88`

**Impact**: Disk space waste, potential lock collision

**Source**: Security Sentinel M3, Architecture Strategist R2

## Proposed Solutions

### Solution 1: Add Cleanup Trap

```bash
trap 'rm -f "$lock_file" "$temp_file"; flock -u 200 2>/dev/null || true' RETURN EXIT INT TERM
```

**Effort**: Quick (15 min)

## Recommended Action

Add trap for cleanup.

## Acceptance Criteria

- [x] Trap added to transition_todo_state
- [x] Lock files cleaned up on success and failure
- [x] Manual test shows no .lock accumulation

## Resources

- Security audit: M3
- Architecture review: R2

### 2026-02-13 - Approved for Work
**By:** Triage Session
**Actions:**
- Issue approved during code review triage
- Status changed from pending → ready
- Ready to be picked up and worked on

### 2026-02-13 - Completed
**By:** PR Comment Resolver Agent
**Changes Made:**
- Added cleanup trap at line 55 of plugins/yellow-debt/lib/validate.sh
- Trap handles both lock file and temp file removal on all exit paths (RETURN, EXIT, INT, TERM)
- Removed 15 manual cleanup calls (flock -u, rm -f) since trap handles them automatically
- Simplified error handling paths while maintaining same cleanup guarantees

**Implementation Details:**
- Added `local lock_file="${todo_file}.lock"` variable for clarity
- Trap command: `trap 'rm -f "$lock_file" "$temp_file"; flock -u 200 2>/dev/null || true' RETURN EXIT INT TERM`
- All error paths now simply return 1, trap ensures cleanup occurs
- Success path at end also cleaned up by trap after return 0
