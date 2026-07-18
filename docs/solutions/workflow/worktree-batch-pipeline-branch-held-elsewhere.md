---
title: 'Batch PR pipelines in a git worktree must expect "branch held elsewhere" as a routine skip'
date: 2026-07-18
category: workflow
track: knowledge
problem: >-
  /review:sweep-all running inside a worktree-confined session hit a PR whose
  head branch was already checked out in the main repo checkout; the session
  cannot check it out, and neither sweep-all's Error Handling section nor
  stack-traversal's per-PR checkout step names this specific, structural,
  non-error skip cause
tags:
  - git-worktree
  - batch-pipeline
  - review-sweep
  - orchestration
  - skip-handling
components:
  - yellow-review
  - workflow
---

# Batch PR pipelines in a git worktree must expect "branch held elsewhere" as a routine skip

## Context

A single git repository allows a given branch to be checked out in exactly
one place at a time — one of its worktrees, where the **main checkout counts
as a worktree too** (git internally treats it as worktree `0`). Attempting
`git checkout <branch>` (or Graphite's `gt checkout <branch>`) for a branch
that is currently the checked-out `HEAD` of *any other* worktree, including
the main checkout, fails immediately — this is not a transient error and not
something a retry fixes.

During a `/review:sweep-all` run inside a worktree-confined session (a
session whose working directory is a `git worktree add`-created path, not
the main checkout), one PR's head branch was already checked out in the main
repo checkout. The worktree session could not check it out. Sweep correctly
marked the PR `skipped` and continued the loop — this is exactly the
contract `sweep-all.md`'s "Per-PR sweep failure mid-loop" bullet already
promises ("marked skipped in the summary with a short reason. Loop
continues.") — but nothing in `sweep-all.md`'s Error Handling section or
`stack-traversal.md`'s per-PR checkout step names *this specific cause* as
an expected, structural outcome of running a batch pipeline from a worktree.
Read cold, a "skipped — checkout failed" line looks like an anomaly to
investigate rather than a routine consequence of the session's own
worktree-confined nature.

## Problem

Enumerating a user's open PRs (via `gh pr list`) says nothing about where
each PR's branch is currently checked out across the machine's worktrees.
A batch pipeline that walks the list and tries to check out each branch in
turn will hit this case whenever:

- The user (or another agent session) is actively working a branch in the
  main checkout while a worktree-confined batch sweep is also running.
- A previous session left a branch checked out in a stale worktree that
  was never cleaned up (`/worktree:cleanup` not run).
- Two worktree-confined sessions target overlapping PR sets concurrently.

None of these are errors in the pipeline's own logic — they are the git
worktree model working as designed. The pipeline's job is to recognize the
failure signature and skip-and-continue, not to retry or treat it as a
tooling bug.

## Solution

Treat "branch checked out in another worktree" as a **named** skip reason,
not a generic checkout failure:

1. When `git checkout <branch>` / `gt checkout <branch>` fails, check the
   error text for the git-native signal (`is already used by worktree at
   <path>` / `already checked out at`) before falling back to a generic
   "checkout failed" message.
2. Record the specific reason in the skip summary, e.g.
   `skipped — branch checked out in another worktree (<path>)`, so a human
   reading the sweep summary can distinguish "someone else is using this
   branch right now, try again later" from "gt is broken" or "branch was
   deleted."
3. Do not attempt to force-reclaim the branch (`git worktree remove --force`
   on someone else's worktree, or forcibly moving `HEAD`) — the other
   checkout may hold uncommitted work. Skip and move on; the user can
   resolve the contention manually.

## Prevention

- Batch PR pipelines (`/review:sweep-all`, `/review:resolve-stack`,
  `/review:all scope=all`) that may run inside a worktree-confined session
  should document "branch held by another worktree/checkout" as an expected,
  named skip reason in their Error Handling / per-PR-failure sections —
  alongside network, auth, and merge-conflict causes already covered.
- Enumerating PRs via `gh pr list` establishes *what exists*, not *what's
  available to check out right now* — a batch pipeline cannot know branch
  availability without attempting the checkout, so "skip and continue" must
  remain the default reaction rather than something the pipeline tries to
  predict or pre-validate.
- See `docs/solutions/integration-issues/ruvector-worktree-db-symlink.md`
  for a related but distinct worktree gotcha (gitignored per-worktree state
  resolving to the wrong path) — that doc and this one are both instances of
  "the worktree model has structural properties that a script written
  assuming a single checkout will not anticipate."
