---
title: 'Rename a special file aside before diffing its tracked deletion'
date: 2026-10-09
category: logic-errors
track: bug
problem: >-
  git diff opens a FIFO, socket, or device that replaced a tracked file, so a
  revert that unlinks the entry before the recovery patch is written loses the
  deletion record and can hang. A failed rename back or a later rm must not
  claim the tree was left untouched or skip restoring a sibling already removed.
tags:
  - yellow-review
  - run-verify-command
  - fifo
  - revert
  - snapshot-ordering
---

## Problem

`--revert-only` and `--revert-dirty` have to record that a tracked file was
replaced, then restore the blob from HEAD. The replacement can be a FIFO,
socket, or device. `git diff` opens that path. Opening a FIFO with no writer
blocks the revert before any watchdog starts, and unlinking the entry before
the patch is written means a snapshot failure has already destroyed the only
copy of the deletion.

## What Didn't Work

Deleting every non-regular path in the listing pass, then running `save_patch`.
The patch is the record of the tracked deletion, so the unlink has to wait
until both snapshots exist. `die` on a later unlink is the same shape of bug:
an earlier special file is already gone, and checkout never restores it.

## Solution

1. Stat the path. Never open it. A FIFO, socket, or device is not a regular
   file, symlink, or directory.
2. Rename it aside in its own directory (`mv` to
   `.yellow-review-hold-*/node`). A cross-device move would copy it and open
   it. `git diff HEAD -- path` then sees a deletion and does not open the
   node.
3. Rename it back before `save_patch` returns. Unlink it only after both the
   binary patch and the text screen snapshot have been written. If either
   snapshot fails and the entry is back at its path, revert nothing.
4. `save_patch` runs in a subshell, so a rename back that fails cannot fix
   the parent's tree. Append `node<US>original` to a temp file and retry the
   rename in the parent. If the retry fails, the reason names the hold path
   and does not say the tree was untouched.
5. If `rm` cannot unlink one special file, record `rm <path>` and continue.
   Checkout restores siblings already removed. Do not check out a path that
   is still a FIFO, socket, or device; checkout would open it.

## Why This Works

The deletion diff needs the path to be absent, and the worktree needs the
special file back if that diff cannot be kept. Same-directory rename is the
only way to make the path absent without reading the inode. The subshell
boundary is why the retry has to be a file, not a shell variable. Continuing
after a failed unlink is what puts an already-removed sibling back; skipping
checkout of the path that is still special is what keeps that retry from
blocking on a read.

## Prevention

- Do not unlink a special file, or `die`, above the checkout that restores
  tracked paths.
- Any new failure return in `save_patch` after the rename aside must rename
  the node back or record it in `HOLD_LEFTOVER`.
- Tests that replace a tracked file with a FIFO must use `timeout` and
  `[ -p ]`, never `cat`, on the path that should still be a FIFO.
