---
name: gt-sync
description: "Sync repo with trunk, restack branches, and clean up merged PRs"
argument-hint: "[--no-delete | --force]"
allowed-tools:
  - Bash
---

# Graphite Sync

One-command repo sync: pull latest from trunk, restack your branches, and clean up merged PRs.

## Input

Optional arguments:
- `--no-delete` — Skip deleting merged branches by passing `--no-delete` through to `gt repo sync` so it does not prompt for deletions
- `--force` — Restack even if the stack appears clean (still stopping at conflicts for manual resolution) instead of skipping Phase 2 when there are no divergence markers

#$ARGUMENTS

## Phase 1: Pre-Sync State

### 1. Capture Current State

Record the starting point so we can report what changed:

```bash
echo "=== Current branch ==="
git branch --show-current

echo "=== Trunk branch ==="
gt trunk

gt log short

echo "=== Local branches ==="
git branch --list
```

## Phase 2: Sync

### 1. Sync with Trunk

Run Graphite repo sync to pull the latest trunk and identify merged branches:

```bash
gt repo sync
```

If `gt repo sync` fails (network error, authentication issue, etc.), report the error to the user and stop. Do not proceed to restacking with stale state.

This will:
- Fetch and fast-forward trunk
- Detect merged branches and prompt for deletion (unless `--no-delete`)

### 2. Check Post-Sync Stack State

```bash
gt log short
```

If the stack looks clean (no divergence markers) and `--force` was not passed, skip to Phase 3; otherwise, continue to the restacking step in Phase 2.

### 3. Restack if Needed

If branches need restacking (they've diverged from their parents after trunk moved):

```bash
gt stack restack
```

If the restack fails, check whether it's due to conflicts or another error:

**If conflicts:**
1. Report which branch has conflicts
2. Report which files are conflicted
3. Tell the user to resolve conflicts manually, then run:
   ```
   git add <resolved-files>
   gt continue
   ```
4. Or to abort the restack entirely:
   ```
   git rebase --abort
   ```
5. Stop execution — don't try to auto-resolve conflicts

**If non-conflict failure** (network, auth, corrupted state):
1. Report the error output from `gt stack restack`
2. Suggest running `git status` and `gt log short` to diagnose
3. Stop execution

## Phase 3: Report

### 1. Final State

```bash
echo "=== Final stack ==="
gt log short

echo "=== Branches ==="
git branch --list
```

### 2. Summary

Output a report:

```
Sync Complete
─────────────
Trunk:       <trunk branch> (updated to <short sha>)
Restacked:   <yes/no/not needed>
Conflicts:   <none / list of conflicted branches>
Cleaned up:  <list of deleted merged branches, or "none">
Current:     <current branch>

Stack:
<gt log short output>
```

## Success Criteria

- Trunk is up to date with remote
- Merged branches are cleaned up (unless `--no-delete`)
- Stack is restacked on latest trunk
- Any conflicts are clearly reported with resolution instructions
- User sees a clear before/after summary
