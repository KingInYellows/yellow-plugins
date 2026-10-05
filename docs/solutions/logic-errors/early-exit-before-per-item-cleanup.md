---
title: 'Early Exits Before Per-Item Cleanup, and Numbered Jump Targets, in Command Loops'
date: 2026-09-30
category: logic-errors
track: bug
problem: 'A stop-on-rate-limit rule jumped to the summary before the current PR''s self-verify, clean-tree check and row, and "go to Step 4" collided with per-PR list item 4'
tags:
  - command-authoring
  - loops
  - early-exit-ordering
  - per-item-cleanup
  - numbered-jump-targets
  - resolve-stack
  - sweep-all
  - yellow-review
---

## Problem

PR #955 taught `/review:resolve-stack` and `/review:sweep-all` to read the
`Resolve:` contract line (`ratelimited=<0|1>`), stop the walk on a rate limit,
and stop and revert (`run-verify-command --revert-dirty`) when a PR left the
tree dirty. `/review:pr` ran sixteen reviewers on it; six of them
independently found the same two defects in the command prose.

## Symptoms

- The `ratelimited=1` rule sat in per-PR item 2 and said "go to Step 4". The
  current PR then skipped its self-verify (item 3), its clean-tree check (3b)
  and its summary row (item 5).
- When the rate-limited PR was the last one in the stack, no PR was left to
  mark `not attempted`, "Needs manual attention" stayed empty, and the walk
  could exit 0 with blocking threads and edits left on disk.
- `sweep-all`'s rate-limit stop jumped past its own clean-tree check the same
  way.
- "go to Step 4" named the `### Step 4` summary heading, but the per-PR list
  also had an item 4 (Restack). A literal reading restacked on a dirty tree.
- `sweep-all`'s loop item 5 still said "do not abort the loop on per-PR
  failures", contradicting the two new stops.

## What Didn't Work

Putting the stop check where the signal first appears — right after the
`Resolve:` line is parsed. It reads naturally, but every step after it in
the loop body is bookkeeping the current item still owes.

## Solution

1. **Finish the current item, then stop.** A stop condition sets a flag. The
   current item still runs its verify, cleanup and summary row, and is listed
   under "Needs manual attention" with the stop reason. Only then are the
   remaining items marked `not attempted` and the loop ends.
2. **Name jump targets by heading**, for example
   `` go to `### Step 4: Final aggregate summary` ``, never by a bare number
   next to a numbered list.
3. **Make stops explicit exceptions** to any "never abort the loop" rule in
   the same list.
4. **Check the cleanup's own result.** `--revert-dirty` reports `treeClean`
   and an exit code; a failed revert is reported as `revert incomplete` and
   listed for manual attention rather than assumed.
5. **Pin the ordering** with grep assertions in `tests/skill-content.bats`.

## Why This Works

A loop body's later steps are not optional: they are how the current item's
state reaches the report and how the tree is restored for the next item. An
early exit placed above them silently drops both, and the failure is
invisible exactly when the item that triggered the stop is the last one.
Finishing the item first keeps the exit condition, the report and the exit
code consistent. Heading-named targets remove the ambiguity that a model
executor resolves literally.

## Prevention

- When adding a stop to a loop, list the steps below it in the loop body and
  decide for each whether the current item still needs it (usually yes).
- Never write "go to Step N" inside a numbered list whose items can also be
  N; quote the heading.
- Search the same list for "never abort" / "continue to the next" wording
  and scope it to iterations where no stop fired.
- Related: `iterate-until-clean-loop-stop-condition.md` (define stops on
  remaining state) and `stale-ok-status-not-corrected-on-abort.md` (status
  maps must be corrected on abort paths).
