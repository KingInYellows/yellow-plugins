---
title:
  'Unblocking stuck PRs: CRLF git conflicts, mergeStateStatus, and multi-round
  conflict resolution'
category: workflow
date: 2026-02-17
tags:
  - git
  - crlf
  - wsl2
  - merge-conflicts
  - github-pr
  - graphite
  - worktree
problem_type: workflow
components:
  - git worktrees
  - github PR merge state machine
  - WSL2 line endings
severity:
  critical: 2
  important: 3
  nice_to_have: 1
  total: 6
---

# Unblocking stuck PRs: CRLF git conflicts, mergeStateStatus, and multi-round conflict resolution

## Problem Symptoms

Multiple PRs fail to merge with various blocking states:

- `mergeStateStatus: DIRTY` — merge conflicts preventing merge
- `mergeStateStatus: UNSTABLE` — CI checks failing
- `git merge` / `git rebase` fails with
  `error: Your local changes to the following files would be overwritten` even
  though `git status` shows a clean working tree
- `git rebase` fails with `error: cannot rebase: You have unstaged changes`
- 80+ files appear as modified (`_M` in `git status`) after a stash/checkout
  despite no intentional changes

## Root Causes

### 1. WSL2 CRLF files blocking git operations

When files are **committed with CRLF** line endings in a branch (typically
because the Write tool on WSL2 creates CRLF files), but `.gitattributes`
specifies `eol=lf`, git enters a confused state:

- `git status` reports the working tree as clean (compares working tree to
  index, both CRLF)
- `git merge origin/main` reports "Your local changes to the following files
  would be overwritten" (because git tries to normalize before merging and sees
  a difference between the CRLF-stored blob and the expected LF-normalized
  version)
- `git stash` may appear to save the changes but the working tree still shows
  unstaged changes afterward

This is a **stat cache invalidation + text normalization** mismatch: the index
cached stat entries don't reflect that git wants LF but has CRLF.

### 2. DIRTY mergeStateStatus from actual conflicts

When multiple PRs target the same files and merge to main in sequence, a branch
that was previously conflict-free can become `DIRTY` after each new merge. This
requires multiple rounds of conflict resolution.

### 3. Stash list shared across worktrees

Git's stash list is global — stashes from one worktree are visible and can be
accidentally dropped from another worktree. Stash `stash@{0}` in one worktree
context is the same stash as in another.

## GitHub PR mergeStateStatus Reference

| Status     | Meaning                              | Can merge via API?                |
| ---------- | ------------------------------------ | --------------------------------- |
| `CLEAN`    | Ready to merge                       | Yes                               |
| `UNSTABLE` | CI failing, but not a required check | Yes (if branch protection allows) |
| `BLOCKED`  | Required status check failing        | No                                |
| `DIRTY`    | Merge conflicts exist                | No                                |
| `DRAFT`    | PR is draft                          | No (mark ready first)             |
| `UNKNOWN`  | State being recalculated             | Try and see                       |
| `BEHIND`   | Branch is behind base branch         | May need rebase/update            |

**Key insight**: `UNSTABLE` means CI failed but the checks are not required by
branch protection rules. If `branch protection = {}` (empty), all `UNSTABLE` PRs
are mergeable.

Check branch protection:

```bash
gh api repos/OWNER/REPO/branches/main/protection 2>&1
# {} means no required checks
```

Check PR merge state:

```bash
gh pr view NUMBER --json mergeStateStatus,mergeable
```

## Working Solutions

### Fix WSL2 CRLF blocking merge/rebase

When `git merge` or `git rebase` fails with "unstaged changes" but `git status`
is clean:

```bash
# Step 1: Identify affected files
git status --short  # Look for _M (unstaged modifications)

# Step 2: Convert CRLF to LF in working tree
git status --short | awk '{print $2}' | xargs -I{} sed -i 's/\r$//' {}

# Step 3: Stage the normalization
git add -u

# Step 4: Commit as a separate normalization commit
git commit -m "chore: normalize CRLF to LF line endings per .gitattributes"

# Step 5: Now merge/rebase can proceed
git merge origin/main
```

If there are still many CRLF files after targeting them individually, use
`git add --renormalize .` to normalize ALL tracked files and stage them.

**Alternative for fresh checkout**: `git stash drop` all pending stashes first,
then retry — stash interference can also cause this symptom.

### Resolve multi-round merge conflicts

When a PR has conflicts that evolve as other PRs merge to main:

```bash
# Round 1: Check what conflicts exist
git merge origin/main 2>&1

# Resolve conflicts (see below for file-specific decisions)
git checkout HEAD -- file1.md file2.json  # keep our version
git checkout origin/main -- file3.sh      # take their version
# or manually edit conflict markers

# Stage resolved files
git add <resolved files>
git commit --no-edit  # creates merge commit

# Push
git push origin branch-name

# Wait a few seconds for GitHub to recalculate mergeability
sleep 5
gh pr view NUMBER --json mergeStateStatus

# If new PRs merged in the meantime, repeat:
git fetch origin main
git merge origin/main 2>&1
# ... resolve again
```

**Multi-round example** from this session:

1. PR #17 was `DIRTY` vs main at `e23f4e5` → resolved `docs/plugin-template.md`,
   `examples/plugin-minimal.example.json`
2. PRs #18 and #19 merged → PR #17 became `DIRTY` again vs new main
3. Second resolution: `.github/workflows/validate-schemas.yml` (ajv version),
   `plugins/gt-workflow/.claude-plugin/plugin.json` (merge structured author +
   hooks), `smart-submit.md`, `scripts/export-ci-metrics.sh`

### Merge conflicts in the same file modified by two PRs

When both branches modified the same file (e.g., `validate-schemas.yml`),
identify which version is "better":

- **Pinned version** (`ajv-formats@3.0.1`) is better than unpinned
  (`ajv-formats`) → use HEAD
- **Both add the same logical feature** → use HEAD, verify no content is lost
- **One adds extra lines** → manually merge (keep both additions)

```bash
# Check HEAD version
git show HEAD:path/to/file | grep pattern

# Check origin/main version
git show origin/main:path/to/file | grep pattern

# If HEAD is better, use HEAD
git checkout HEAD -- path/to/file

# If origin/main is better, use their version
git checkout origin/main -- path/to/file

# If need manual merge, look at the conflict markers:
grep -n "^<<<<<<\|^=======\|^>>>>>>>" file
```

### Merge draft PRs

Draft PRs cannot be merged via API even if MERGEABLE:

```bash
# Mark ready first
gh pr ready NUMBER

# Then merge
gh pr merge NUMBER --squash
```

### Merge UNSTABLE PRs (pre-existing CI failures)

When CI failures are pre-existing/unrelated to the PR content, merge directly:

```bash
gh pr merge NUMBER --squash
# GitHub API will succeed for UNSTABLE when no required checks exist
```

## Prevention

### Prevent CRLF files from being committed

Ensure `.gitattributes` is set up AND that files are normalized before commit:

```gitattributes
* text=auto eol=lf
*.md text eol=lf
*.json text eol=lf
*.sh text eol=lf
```

After writing files with the Write tool on WSL2, normalize before staging:

```bash
sed -i 's/\r$//' path/to/file.sh
git add path/to/file.sh
```

Or use `git add --renormalize <file>` which normalizes per gitattributes before
staging.

### Merge PRs in the right order to minimize conflicts

When multiple PRs modify the same files, merge the smallest/most targeted PR
first:

1. Merge targeted fixes (small PRs touching few files)
2. Merge feature additions (medium PRs)
3. Merge comprehensive refactors (large PRs touching many files) last

This reduces the number of conflict resolution rounds needed.

### Don't use `git checkout branch -- .` to inspect files

This copies ALL files from the other branch into the current working tree and
stages them. Instead:

```bash
# ✅ Safe: inspect a single file from another branch
git show other-branch:path/to/file.ext

# ✅ Safe: inspect full tree in isolated environment
git worktree add /tmp/inspect-branch other-branch

# ❌ Dangerous: copies entire branch into current working tree
git checkout other-branch -- .
```

## Related

- See `docs/solutions/build-errors/ajv-cli-v8-strict-mode-unknown-format.md` —
  CI fix for related PRs
- See `MEMORY.md` → "CRLF on WSL2" pattern
- PR #17 (yellow-plugins): Multi-round conflict resolution example
