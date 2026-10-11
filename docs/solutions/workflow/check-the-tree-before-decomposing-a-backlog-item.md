---
title: 'Check the tree before decomposing a backlog item'
date: 2026-10-06
category: workflow
track: knowledge
problem:
  'A cycle plan copied from issue text will redo landed work or undo a later fix
  unless each task is re-read against the current tree before implementation'
tags:
  - flow-work
  - planning
  - graphite
  - yellow-review
  - yellow-core
components: [yellow-review, yellow-core]
---

# Check the tree before decomposing a backlog item

## Context

Cycle 1 (`plans/cycle-1-resolve-hardening-and-ci-split.md`) was decomposed from
Linear issues CLAUDE-44 through CLAUDE-75, several of which described code that
`main` had already changed.

## Guidance

Before writing or implementing a task, re-read the function the task names and
the tests that pin it. Treat the plan file as the source of truth when a commit
message and the checkboxes disagree: a commit message that says a task landed
does not close the checkbox. Mark a task `[x]` when the tree already did the
work, so progress totals count it. Reserve `[-]` for a task the tree made
inapplicable, and say which case applies in the PR body.

Checks that changed cycle 1's tasks. This is a plan-time snapshot as of
2026-10-06, not a statement about today's tree; re-check each against the code
before relying on it:

- `goal-engine-compat` was already a required `ci-status` job. The CI split
  added only the yellow-review bats job.
- `yr_resolve_tool` already binds `git`, `gh`, and `jq`. The printed path stays
  the PATH hit so a git-ai wrapper keeps `argv[0]` equal to `git`.
- `harden_git_config` must not set `core.hooksPath`. Hooks stay in
  `disable_git_hooks` unless `YELLOW_REVIEW_COMMIT_HOOKS=1`.
- `run-verify-command` handles a FIFO, socket, or device path differently per
  mode. Run mode refuses it (exit 2). `--revert-only` and `--revert-dirty` hold
  it aside until `save_patch` records the deletion, then remove it without
  opening it and restore the file. `--revert-denied` leaves it in place and
  reports `deniedClean: false`. `run-verify-command.bats` is the spec.
- `--revert-dirty` still reverts every dirty path and takes no path list. The
  deny-list mode is a separate flag, `--revert-denied`.
- Sweep-all Step 6 was already removed. Do not put it back.
- CLAUDE-44, 45, 46, 48, and 49 already had ledger bats coverage and were
  already Done. Do not transition them again without a fresh confirmation.

## Pitfalls

- Implementing the original issue sentence after the code has moved regresses
  the later fix. The tests that encode today's behavior are the check.
