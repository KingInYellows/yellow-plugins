---
title: '`gt modify` without `-c` silently misses unstaged edits'
date: 2026-05-18
category: workflow
track: bug
problem: gt modify without -c amends prior commit and ignores unstaged file edits; output looks successful
tags: [graphite, gt-modify, unstaged, commit, silent-failure]
components: [workflow, graphite]
---

## Problem

Running `gt modify -m "fix: ..."` after applying a file edit (e.g., via the Edit
tool) produces output like:

```
1 file changed, 3 insertions(+), 2 deletions(-)
```

But the reported diff belongs to the **prior commit's total content**, not the
new edit. The unstaged file change was never included.

## Symptoms

- `git status` shows the edited file still dirty after `gt modify`
- `git show HEAD` does not contain the intended change
- The commit subject changed, but the file diff did not land
- No error or warning was printed by gt

## Root Cause

`gt modify` without `-c` **amends the previous commit**. Git's amend only
includes already-staged changes. If the edit was applied but not staged
(`git add`), gt silently amends the message (and any staged hunks) and ignores
the unstaged file.

The output "X files changed" refers to the amended commit's cumulative diff
relative to its parent — not to what was just added. This makes it look like
success when the edit was missed entirely.

## Solution

Two correct patterns:

**Option A — stage first, then amend:**
```bash
git add <file>
gt modify -m "fix: descriptive message"
```
Use when you want to fold the change into the previous commit.

**Option B — create a new commit:**
```bash
git add <file>
gt modify -c -m "fix: descriptive message"
```
The `-c` flag creates a new commit rather than amending. Preferred when the
prior commit is already meaningful on its own.

**Option C — use git commit directly:**
```bash
git add <file>
git commit -m "fix: descriptive message"
```
Valid fallback; Graphite tracks the commit either way.

## Why This Works

`git add` moves the file change from the working tree into the index. Only
indexed (staged) changes are included in an amend or new commit. The `-c` flag
is what distinguishes "new commit" from "amend" in gt modify.

## Prevention

Before any `gt modify` or `gt commit` call, verify staged state:

```bash
git status --short
```

If the file you edited appears as `M ` (unstaged) rather than `M ` (staged),
run `git add <file>` first.

In automated agent workflows: always `git add <specific-file>` immediately after
applying an edit, before the commit step. Never rely on gt to pick up unstaged
changes automatically.
