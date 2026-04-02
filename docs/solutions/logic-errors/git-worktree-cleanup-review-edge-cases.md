---
title: Git Worktree Cleanup Command — Review Edge Cases
date: 2026-03-20
category: logic-errors
tags: [git-worktree, porcelain-parsing, detached-HEAD, grep-matching, classification-priority]
components: [yellow-core/commands/worktree/cleanup.md, gt-workflow/commands/gt-cleanup.md]
---

# Git Worktree Cleanup Command — Review Edge Cases

## Problem

The `/worktree:cleanup` command went through 6 rounds of review fixes (PR #227)
after initial implementation. Each round uncovered edge cases in git worktree
management that are easy to miss when writing worktree lifecycle commands:
porcelain parsing, detached HEAD handling, classification ordering, grep
matching for branch names with slashes, and conditional behavior when GitHub CLI
is unavailable.

## Root Cause

Git worktree management combines multiple subsystems (porcelain output parsing,
branch state queries, filesystem checks, GitHub API enrichment) where each has
its own edge cases. The interaction between these subsystems creates compound
failure modes that are not obvious from unit-level reasoning.

## Findings (by review round)

### 1. grep -qw fails on branch names with slashes (P1)

**Bug**: `grep -qw "$BRANCH_NAME"` treats `/` as a word boundary, so
`feat/foo` matches `feat/foobar`. Branch names routinely contain slashes.

**Fix**: Use `grep -qxF "$BRANCH_NAME"` for exact fixed-string line matching.
`-x` anchors to the full line, `-F` disables regex interpretation.

```bash
# WRONG: word-boundary matching breaks on slashes
git branch --merged "$TRUNK" | grep -qw "$BRANCH_NAME"

# RIGHT: exact line match, literal string
git branch --merged "$TRUNK" | sed 's/^[ *]*//' | grep -qxF "$BRANCH_NAME"
```

### 2. Classification priority order matters

**Bug**: Original order had "dirty" checked before "detached HEAD". Detached
HEAD worktrees have no branch name, so branch-based checks (merged, stale)
produce nonsensical results if they run first. Also, dirty detached HEAD
worktrees would be classified as "dirty" and lose the detached HEAD context.

**Fix**: Priority must be: locked > missing > detached HEAD > merged > stale >
dirty > clean. Each level's detection assumptions depend on prior levels being
excluded.

### 3. git log needs -C for worktree-specific queries

**Bug**: `git log -1 --format='%ci' "$BRANCH_NAME"` without `-C "$WT_PATH"`
reads from the main worktree's HEAD, not the worktree being inspected. For
detached HEAD worktrees, `$BRANCH_NAME` is empty, causing `git log -1` to
default to `HEAD` of the calling worktree.

**Fix**: Always use `git -C "$WT_PATH"` for per-worktree queries. When branch
name is empty (detached HEAD), explicitly pass `HEAD`:

```bash
if [ -n "$BRANCH_NAME" ]; then
  git -C "$WT_PATH" log -1 --format='%ci' "$BRANCH_NAME" 2>/dev/null
else
  git -C "$WT_PATH" log -1 --format='%ci' HEAD 2>/dev/null
fi
```

### 4. Merged-but-dirty worktrees need fallthrough

**Bug**: Category 4 (merged) auto-removes without prompting. If a merged
branch has uncommitted changes, auto-removal would cause data loss.

**Fix**: Add "clean working tree AND no unpushed commits" to Category 4
detection criteria. Merged-but-dirty worktrees fall through to Category 6
(dirty) for explicit user confirmation with `--force`.

### 5. Missing upstream breaks unpushed commit check

**Bug**: `git log @{u}..HEAD` fails with exit code 128 when the branch has no
upstream configured. The error was swallowed, but exit code was not handled,
leading to "no unpushed commits" (false negative — unsafe for auto-removal).

**Fix**: Guard with `rev-parse --verify @{u}` first. Treat "no upstream" as
"has unpushed commits" for safety (conservative classification):

```bash
git -C "$WT_PATH" rev-parse --verify @{u} >/dev/null 2>&1 && \
  git -C "$WT_PATH" log @{u}..HEAD --oneline 2>/dev/null
```

### 6. Category 5 (stale) requires GH_AVAILABLE gate

**Bug**: Stale detection includes "confirmed no open PR via GitHub API". When
`gh` is unavailable, this check is skipped, but worktrees were still
classified as "stale" and auto-removed — potentially removing worktrees with
open PRs.

**Fix**: When `GH_AVAILABLE=false`, reclassify would-be Category 5 worktrees
as Category 7 (clean, active) so the user is prompted instead of auto-removed.

### 7. Current worktree matching must handle subdirectories

**Bug**: `[ "$CURRENT_DIR" = "$WT_PATH" ]` misses the case where the user's
cwd is a subdirectory of a worktree (e.g., `$WT_PATH/src/`).

**Fix**: Use case pattern matching for path prefix:

```bash
case "$CURRENT_DIR" in "$WT_PATH"|"$WT_PATH"/*) skip ;; esac
```

### 8. Orphaned branch detection must skip empty branch names

**Bug**: When iterating `$REMOVED_BRANCHES` after Phase 4, detached HEAD
removals contribute an empty string. `grep -qxF ""` matches every line,
causing the porcelain check to always succeed, masking real orphaned branches.

**Fix**: Guard the loop body:

```bash
for REMOVED_BRANCH in $REMOVED_BRANCHES; do
  [ -z "$REMOVED_BRANCH" ] && continue
  [ "$REMOVED_BRANCH" = "$TRUNK" ] && continue
  # ...
done
```

### 9. Porcelain output must be captured into a variable

**Bug**: Calling `git worktree list --porcelain` repeatedly (once per
worktree for checks) is wasteful and creates a TOCTOU race if worktrees
change between calls.

**Fix**: Capture once into `$WT_PORCELAIN` and parse the variable throughout.

### 10. `git worktree prune` needs --expire now

**Bug**: Default `git worktree prune` respects `gc.worktreePruneExpire`
(default 3 months), so recently-missing worktrees might not be pruned.

**Fix**: Pass `--expire now` to override the expiry threshold:

```bash
git worktree prune --verbose --expire now
```

## Prevention

- [ ] When writing git worktree commands, enumerate the porcelain fields
      (`worktree`, `HEAD`, `branch`, `detached`, `locked`, `prunable`, `bare`)
      and handle each explicitly
- [ ] Always use `grep -qxF` (not `-qw`) when matching branch names — slashes
      in branch names break word-boundary matching
- [ ] Always use `git -C "$WT_PATH"` when querying per-worktree state — bare
      `git log` reads from the cwd worktree
- [ ] For auto-removal categories, require all safety conditions in the
      detection criteria (clean tree + no unpushed + upstream exists)
- [ ] When a feature degrades without an external tool (`gh`), reclassify
      affected items to a prompted category — never silently auto-act on
      incomplete data
- [ ] Test current-directory matching with subdirectory paths, not just exact
      matches
- [ ] Guard iteration over collected data against empty/null entries from
      special cases (detached HEAD has no branch name)

## Related Documentation

- `/worktree:cleanup` command: `plugins/yellow-core/commands/worktree/cleanup.md`
- `/gt-cleanup` branch command: `plugins/gt-workflow/commands/gt-cleanup.md`
- `git worktree list --porcelain` format: `man git-worktree` (PORCELAIN FORMAT section)
- PR #227 review thread (6 rounds of fixes)
