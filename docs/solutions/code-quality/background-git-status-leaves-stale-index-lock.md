---
title: 'A background `git status` killed by a timeout leaves a stale index.lock'
date: 2026-10-14
category: code-quality
track: bug
problem: >-
  Commits in this repo's worktrees intermittently failed on a 0-byte
  .git/index.lock with no git process alive. The source was the yellow
  statusline, which ran a plain `git status --porcelain` under a 2-second
  subprocess timeout on every refresh.
tags:
  - git
  - index-lock
  - statusline
  - no-optional-locks
  - background-process
---

# A background `git status` killed by a timeout leaves a stale index.lock

## Problem

`git commit`, `gt modify` and `gt submit` failed with
`Unable to create '.../index.lock': File exists`. Each time the lock was
0 bytes and minutes old, and no git process held it. Removing it fixed the next
command, but the lock came back later, usually after a busy stretch of tests,
restacks or checkouts.

## Cause

When file mtimes have changed since the index was written, a plain
`git status` refreshes the index's stat data and writes it back. Git does that
write under `index.lock`. It is an _optional_ lock: status works without it,
but takes it when it can.

The statusline that `/statusline:setup` installs (from
`plugins/yellow-core/references/statusline-setup/statusline-template.py`) ran
`git status --porcelain` through Python's `subprocess` with `timeout=2`. On a
timeout, `subprocess` sends SIGKILL. A git killed between creating the lock and
renaming it into place cannot clean up, so the empty lock stays. Under load a
status can exceed 2 seconds, and the statusline refreshes many times a minute,
so the window is hit occasionally.

## How it was found

- `inotifywait`, `fatrace`, `bpftrace` and auditd were not available (WSL2), so
  a Python poller watched `<gitdir>/index.lock` every 10 ms.
- Scanning `/proc/*/fd` for the lock's holder was too slow: even a control
  `git status` finished before the scan found it.
- What worked: listing `/proc` every 3 ms, recording each new `git` process
  whose cwd was the worktree, with its parent chain. The lock appeared in the
  same instant as the statusline's `git status`. herdr took no lock, and the
  `git-ai` daemon's calls were read-only (`ls-tree`, `cat-file`, `rev-parse`).
- Proof in a throwaway clone: after `touch`ing tracked files, plain
  `git status` changed `.git/index`'s mtime and
  `git --no-optional-locks status` did not.

## Fix

Run background or periodic status readers with `--no-optional-locks` (or set
`GIT_OPTIONAL_LOCKS=0`). Git documents the flag for exactly this case. The
statusline template does this from version 1.0.1, and
`plugins/yellow-core/lib/plugin-identity.sh` already did.
`plugins/yellow-core/tests/statusline-template.bats` pins it with a stub `git`
that records its argv, and with a real-git check that a stale index is left
unrewritten.

The same template keyed its git cache by a single file, so concurrent sessions
showed each other's branch. It now keys the cache by a hash of the working
directory.

## Prevention

- Any git call that runs on a timer, a hook or a status refresh, and can be
  killed by a timeout, uses `--no-optional-locks`.
- A cache for per-repository data is keyed by the repository or working
  directory, never shared across sessions.
- Recovery when a lock is already stale:
  `docs/solutions/workflow/gt-sync-exit-128-stale-index-lock.md`. Confirm no
  git process is running, then remove only the 0-byte lock. An installed
  statusline older than 1.0.1 keeps causing it until `/statusline:setup` is
  re-run.
