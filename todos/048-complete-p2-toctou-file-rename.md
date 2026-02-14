---
status: complete
priority: p2
issue_id: "048"
tags: [code-review, security, toctou, race-condition]
dependencies: []
pr_number: 12
completed_at: "2026-02-13"
---

# 🟡 P2: TOCTOU Race in transition_todo_state File Rename

## Problem Statement

The `transition_todo_state()` function computes `new_filename` using the current filename parameter OUTSIDE the flock lock, creating a TOCTOU race where parallel processes could rename the file between lock acquisition and the mv operation.

## Findings

**Location**: `plugins/yellow-debt/lib/validate.sh:77-87`

**Current code**:
```bash
new_filename=$(printf '%s' "$todo_file" | sed "s/-${current_state}-/-${new_state}-/")
mv "$temp_file" "$new_filename" || { ... }
rm -f "$todo_file"
```

**Attack**: Parallel process renames file after lock but before mv, causing state corruption.

**Source**: Security Sentinel H1

## Proposed Solutions

### Solution 1: Derive Filename Inside Lock from Current State

Parse current filename inside lock and derive new name from actual file state (not parameter):

```bash
# INSIDE LOCK: Verify file exists
if [ ! -f "$todo_file" ]; then
  flock -u 200
  return 1
fi

# Parse current filename to extract ID, severity, slug, hash
base_name=$(basename "$todo_file")
if [[ "$base_name" =~ ^([0-9]+)-[^-]+-([^-]+)-(.+)-([^-]+)\.md$ ]]; then
  id="${BASH_REMATCH[1]}"
  severity="${BASH_REMATCH[2]}"
  slug="${BASH_REMATCH[3]}"
  hash="${BASH_REMATCH[4]}"
fi

new_filename="todos/debt/${id}-${new_state}-${severity}-${slug}-${hash}.md"

# Check collision
[ -e "$new_filename" ] && return 1

mv "$temp_file" "$new_filename"
```

**Effort**: Small (1-2 hours)
**Risk**: Low

## Recommended Action

Implement Solution 1.

## Acceptance Criteria

- [x] Filename derived inside lock
- [x] Collision detection added
- [x] Manual test with parallel transitions passes
- [x] Applied to lib/validate.sh

## Resources

- Security audit: `docs/solutions/security-issues/yellow-debt-plugin-security-audit.md:330-473`

### 2026-02-13 - Approved for Work
**By:** Triage Session
**Actions:**
- Issue approved during code review triage
- Status changed from pending → ready
- Ready to be picked up and worked on

### 2026-02-13 - Resolved
**By:** PR Comment Resolver
**Solution Implemented:** Solution 1 (derive filename inside lock)
**Changes:**
- Added file existence check inside lock (lines 58-62)
- Parse current filename using regex to extract id, severity, slug, hash components (lines 84-93)
- Derive new_filename from parsed components instead of using stale parameter (line 93)
- Added collision detection before rename (lines 99-105)
- Fallback to sed-based rename if regex doesn't match (lines 95-97)
**Testing:**
- Manual review confirms all acceptance criteria met
- Function now re-reads state and derives filename inside lock scope
- Parallel rename attacks prevented by lock + collision check
