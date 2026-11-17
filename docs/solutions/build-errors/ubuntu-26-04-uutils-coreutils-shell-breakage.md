---
title: 'Ubuntu 26.04 uutils coreutils break timeouts, byte caps and mkdir locks'
category: build-errors
track: bug
problem: 'Shell suites that pass on ubuntu-24.04 fail on ubuntu-26.04 runners, whose default coreutils are uutils.'
date: 2026-11-17
tags:
  - ubuntu-26.04
  - uutils
  - coreutils
  - bats
  - github-actions
  - locking
problem_type: ci-configuration
components: [yellow-core, yellow-ruvector]
---

# Ubuntu 26.04 uutils coreutils break timeouts, byte caps and mkdir locks

## Problem

`ubuntu-latest` began handing out `ubuntu-26.04` images. Ubuntu 26.04 ships
uutils coreutils (Rust) as `/usr/bin/<tool>`; the GNU tools remain as
`/usr/bin/gnu<tool>`. Three behaviours differ, and each broke a suite
(CLAUDE-346):

1. **`timeout` signals only its direct child.** A child the command leaves
   behind keeps the `$(...)` pipe open, so the caller waits for the child,
   not the timeout. `/setup:all`'s `_rv_probe` stalled about 60 s.
2. **`tail -c N` reading a pipe can return more than N bytes** (105846 for
   N=98304, intermittently). `_stop-capture-subshell.sh`'s transcript cap
   overflowed.
3. **`mkdir` is not exclusive under a race.** Two or more racing callers can
   all be told they created the directory (128 to 195 of 300 three-way races
   on a real runner). Every `mkdir`-as-lock admits two holders.

## Fix

1. Send the timed command's output to a temp file, never the caller's pipe,
   then `cat` it.
2. Take byte suffixes with a bytewise substring,
   `$(LC_ALL=C; printf '%s' "${VAR: -N}")`, or read the file directly
   (`tail -c +K "$file"`), not `printf | tail -c`.
3. Hold a lock by `mkdir "$d" && (set -C; : > "$d/.owner")`. The noclobber
   create is the shell's own `O_EXCL` open, so exactly one caller wins
   whatever `mkdir` reports. Unlock removes `.owner` before `rmdir`.
   yellow-ruvector's `coedit_mkdir_excl` does this; the other mkdir locks are
   tracked in CLAUDE-348.

## Diagnosing

Run the suite on `runs-on: ubuntu-26.04` directly. To A/B a failure, put
GNU first on PATH: symlink each `/usr/bin/gnu<tool>` to `<dir>/<tool>` and
prepend `<dir>`.
