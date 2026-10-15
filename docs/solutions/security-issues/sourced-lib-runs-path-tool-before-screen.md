---
title: 'A Sourced Helper Can Run a PATH Command Before the PATH Screen'
date: 2026-10-14
category: security-issues
track: bug
problem: lib/resolve-paths.sh called dirname at source time, so a resolver-planted dirname on the caller's PATH ran before yr_adopt_path screened PATH
tags: [yellow-review, path-screen, trust-boundary, bootstrap, dirname, sourced-library, review-resolve]
components: [yellow-review]
---

## Problem

`commit-resolve-fixes` and `run-verify-command` run after `pr-comment-resolver`
agents have written the worktree. A resolver can plant an executable in any
worktree directory that sits on the caller's `PATH` (an ignored
`node_modules/.bin`, a relative `PATH` entry). `yr_adopt_path` exists to drop
those directories before anything runs by bare name.

Both scripts already found their own directory with `case "$0"` parameter
expansion for this reason. But they `source lib/resolve-paths.sh` before
calling `yr_adopt_path`, and the library located `sibling-plugin.sh` with
`$(dirname -- "${BASH_SOURCE[0]}")`. That `dirname` was a `PATH` lookup on the
unscreened `PATH`, so a planted `dirname` ran with the scripts' authority
before any check. Fixed in PR #1191.

## Why it recurred

The invariant "nothing resolved through `PATH` runs before the screen" was
enforced in the two entry scripts and stated in `plugins/yellow-review/CLAUDE.md`,
but a sourced library runs its top-level code in the caller's pre-screen
phase too. Reviewing the entry scripts alone does not show it: the external
call sat at source time in another file.

## Solution

- Find the library's directory with shell built-ins only:

  ```bash
  case "${BASH_SOURCE[0]}" in
      */*) _rp_dir=${BASH_SOURCE[0]%/*}; [ -n "$_rp_dir" ] || _rp_dir=/ ;;
      *) _rp_dir=. ;;
  esac
  . "$_rp_dir/sibling-plugin.sh"
  unset _rp_dir
  ```

- Add a bats regression that puts a logging `dirname` shim on `PATH` (as an
  absolute and as a relative entry) and asserts it never runs, in each entry
  point and mode (`commit-resolve-fixes` normal and `--check-ranges`,
  `run-verify-command`). Fixture shims must not call `dirname` themselves
  (`${0%/*}` instead), or the assertion reads their own call as a failure.

## Prevention

- Treat every file sourced before the `PATH` screen as part of the screen's
  bootstrap. Its top-level code may use only shell built-ins and helpers bound
  by absolute path from fixed system directories (`yr_helper`).
- Common offenders at source time: `$(dirname ...)`, `$(basename ...)`,
  `$(realpath ...)`, `$(readlink ...)`, `mktemp`, `date`, `uname`.
  `$(cd -- "$dir" && pwd -P)` is safe: `cd` and `pwd` are built-ins.
- When a script adds a library to its pre-screen `source` list, grep that
  library's top level for `$(` and backticks before merging, and extend the
  planted-shim bats test to cover the new entry point.
