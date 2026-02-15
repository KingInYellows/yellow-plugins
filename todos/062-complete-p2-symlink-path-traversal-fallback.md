---
status: pending
priority: p2
issue_id: "062"
tags: [code-review, security, yellow-ruvector]
dependencies: []
---

# Symlink Path Traversal in validate.sh Fallback

## Problem Statement

When `realpath` is unavailable, `canonicalize_project_dir()` falls back to `cd + pwd -P` which resolves the path correctly, but the preceding validation could be bypassed via symlinks that point outside the expected directory tree.

## Findings

- **Source:** security-sentinel (M2), silent-failure-hunter (CRITICAL)
- **File:** `plugins/yellow-ruvector/hooks/scripts/lib/validate.sh`
- **Evidence:** Fallback path resolution doesn't re-validate the resolved path is within expected boundaries after symlink resolution

## Proposed Solutions

### Option A: Post-resolution path check (Recommended)
- After `cd + pwd -P` resolution, verify the resolved path starts with expected prefix
- **Effort:** Small (20 min)
- **Risk:** Low

### Option B: Reject symlinks entirely in fallback
- If `realpath` is unavailable, check `[ -L "$path" ]` and reject symlinks
- **Effort:** Small (10 min)
- **Risk:** Medium — may be overly restrictive in some environments

## Recommended Action

Option A — validate resolved path stays within bounds.

## Technical Details

- **Affected files:** `plugins/yellow-ruvector/hooks/scripts/lib/validate.sh`
- **Components:** `canonicalize_project_dir()` fallback branch

## Acceptance Criteria

- [ ] Resolved path validated against expected prefix after fallback resolution
- [ ] Symlink traversal outside project root causes clean error
- [ ] Existing bats tests pass

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-14 | Created from code review | Security + silent-failure overlap |

## Resources

- PR stack: #13, #14, #15
- Memory: shell script security patterns
