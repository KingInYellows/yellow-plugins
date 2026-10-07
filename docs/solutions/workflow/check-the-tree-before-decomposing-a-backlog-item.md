---
title: 'Check the tree before decomposing a backlog item'
date: 2026-10-06
category: workflow
track: knowledge
problem:
  'A cycle plan copied from issue text will redo landed work or undo a later
  fix unless each task is re-read against the current tree before implementation'
tags:
  - flow-work
  - planning
  - graphite
  - yellow-review
  - yellow-core
---

# Check the tree before decomposing a backlog item

## Context

Cycle 1 (`plans/cycle-1-resolve-hardening-and-ci-split.md`) was decomposed
from Linear issues CLAUDE-44 through CLAUDE-75. Several issue texts described
the code as it was when the issue was filed. `main` had already moved.

## Guidance

Before writing or implementing a task, re-read the function the task names
and the tests that pin it. Treat the plan file as the source of truth when a
commit message and the checkboxes disagree. Mark a task `[-]` when the tree
already did the work or made the task inapplicable, and say so in the PR body.

Checks that changed this cycle's tasks:

- `goal-engine-compat` was already a required `ci-status` job. The CI split
  added only the yellow-review bats job.
- `yr_resolve_tool` already binds `git`, `gh`, and `jq`. The printed path
  stays the PATH hit so a git-ai wrapper keeps `argv[0]` equal to `git`.
- `harden_git_config` must not set `core.hooksPath`. Hooks stay in
  `disable_git_hooks` unless `YELLOW_REVIEW_COMMIT_HOOKS=1`.
- FIFO, socket, and device deletion stays `rm -f` of `TO_REMOVE` before the
  verifier. `run-verify-command.bats` is the spec.
- `--revert-dirty` still reverts every dirty path and takes no path list.
  The deny-list mode is a separate flag, `--revert-denied`.
- Sweep-all Step 6 was already removed. Do not put it back.
- CLAUDE-44, 45, 46, 48, and 49 already had ledger bats coverage and were
  already Done. Do not transition them again without a fresh confirmation.

## Pitfalls

- Implementing the original issue sentence after the code has moved regresses
  the later fix. The tests that encode today's behavior are the check.
- A commit message that says a task landed does not close the checkbox. The
  plan file does.
- An unreadable worktree counts as busy in `wt_busy`. A restack abort that
  scans every worktree will keep state for a rebase that is not this stack's.
