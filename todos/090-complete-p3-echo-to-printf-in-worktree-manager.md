---
status: complete
priority: p3
issue_id: "090"
tags: [code-review, shell-patterns]
dependencies: []
---

# 🔵 P3: Echo to Printf in Worktree Manager

## Problem Statement
The git-worktree manager script uses `echo` piped to other commands in several locations, while project convention prefers `printf` for better portability and consistency.

## Findings
**Location**: `plugins/yellow-core/skills/git-worktree/scripts/worktree-manager.sh` lines 152-154

Current code pattern:
```bash
echo "$line" | awk '...'
echo "$line" | grep '...'
```

While `echo` works in most shells, `printf` is more portable and is the established pattern in this codebase (see project memory shell patterns).

## Proposed Solutions
### Solution 1: Replace with Printf (Recommended)
Change all `echo "$variable"` piped to other commands to use `printf '%s\n' "$variable"`:

```bash
printf '%s\n' "$line" | awk '...'
printf '%s\n' "$line" | grep '...'
```

If the newline is unwanted by the downstream command, use:
```bash
printf '%s' "$line" | command
```

### Solution 2: Leave Echo for Single-Purpose Scripts
Keep echo if the script is never expected to be portable beyond bash/zsh, but this contradicts project conventions.

## Recommended Action
Apply Solution 1: replace all echo-to-pipe patterns with printf equivalents.

Scan for other instances beyond lines 152-154 to ensure consistency.

## Acceptance Criteria
- [ ] Lines 152-154 use `printf` instead of `echo`
- [ ] All other echo-to-pipe patterns in the file converted to printf
- [ ] Script functionality unchanged (tested with worktree operations)
- [ ] Follows project memory shell patterns

## Work Log
**2026-02-15**: Finding identified during comprehensive plugin marketplace review.

## Resources
- Plugin marketplace review session
- File: `plugins/yellow-core/skills/git-worktree/scripts/worktree-manager.sh`
- Project memory: Shell Script Security Patterns (prefer printf over echo)
