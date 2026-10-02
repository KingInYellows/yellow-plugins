---
title: 'resolve-stack state goes stale after a fix commit: unpublished upstack and frozen changed ranges'
date: 2026-10-01
category: logic-errors
track: bug
problem: after the first PR gets a fix commit, the restacked upstack is unpublished so Step 2c rejects later PRs, and the re-pass reuses pre-push ranges
tags: [resolve-stack, restack, stale-state, pr-changed-ranges, review-resolve, stacked-prs, yellow-review]
components: [yellow-review]
---

## Problem

`/review:resolve-stack` walks a stack of PRs and runs the resolver
(`/review:resolve`) on each. When the first PR receives a fix commit, the PRs
above it are restacked locally, but the restacked branches were not published.
`/review:resolve`'s "Verify HEAD matches the PR head" step (Step 2c in the
resolve-stack PRs), which validates each PR against its remote head, then
rejected every PR above the first. A related defect: the re-pass reused
PR-changed ranges computed before the round-1 push. PR #954 review
(adversarial, with architecture) found both.

Point-in-time: the commands and scripts named here (`/review:resolve`'s head
check, `pr-changed-ranges`) belong to the unmerged resolve stack (PRs #950 to
#955) and are not on `main`. As of that stack, the `/review:resolve` re-pass
re-runs `pr-changed-ranges` after a push, but `/review:resolve-stack` restacks
upstack without a publish step, so Solution step 1 is a recommendation, not
shipped behaviour. Name the shipping PR here once it lands.

## Symptoms

- After PR 1 gets a fix commit, every later PR in the stack is rejected at
  Step 2c even though nothing is wrong with them.
- In the re-pass, threads anchored on lines added by the round-1 fix are
  classed `oos` (out of scope), because those lines are missing from the old
  ranges.

## What Didn't Work

- Walking to the next PR immediately after a successful push to the current
  one. The local branches had moved; the remote heads had not.
- Computing `pr-changed-ranges` once at the start of the run and reusing it
  across rounds.

## Solution

1. Publish the restacked upstack before walking to the next PR, using the
   enabled stacked-PR provider's own submit command, never raw `git push`.
2. Re-run `pr-changed-ranges` at the start of the re-pass, so ranges reflect
   the pushed state.
3. Treat any per-PR check that compares local against remote as invalid until
   the publish step has completed.

## Why This Works

Step 2c compares against the remote head. Publishing the restacked branches
makes remote and local agree before the check runs. Recomputing ranges ties the
scope decision to the code the threads now point at instead of the code from
before the fix.

## Prevention

- Any loop that mutates state (commit, push, restack) must refresh every
  derived value (heads, ranges, thread anchors) before the next iteration.
- When a command acts on one PR in a stack, assume every upstack PR changed.
  Add a test with a two-PR stack where PR 1 gets a fix commit and PR 2 must
  still pass Step 2c.
- Test the re-pass with a thread anchored on a line the round-1 fix added.
- Name derived-state inputs explicitly in the command so a reader can see what
  is recomputed per round.

See also `docs/solutions/logic-errors/iterate-until-clean-loop-stop-condition.md`
for the stop-condition rules of bounded review-fix loops.
