---
'yellow-core': minor
---

feat: add `/worktree:restack` to restack a stack whose branches are checked out
in separate worktrees.

A provider has to check a branch out to rebase it, and git refuses while another
worktree holds that branch. `/worktree:restack` records each stack worktree's
branch, detaches it, runs one restack through the active stacked-PR provider
(routed by `stack-provider-router`), and restores every worktree. A conflict
pauses the run with the stack worktrees detached and locked; `--continue` and
`--abort` resume, and `--submit` submits through the provider afterwards.
GitHub needs gh-stack 0.2.0 or newer, which rebases across worktrees itself, so
nothing is detached there. The engine is
`skills/git-worktree/scripts/worktree-restack.sh` (per-run state under the git
common dir, re-validated on every read, restore never forces a checkout), covered
by `skills/git-worktree/tests/worktree-restack.bats`.
