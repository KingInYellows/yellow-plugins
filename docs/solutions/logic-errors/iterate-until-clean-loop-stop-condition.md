---
title: 'Iterate-Until-Clean Loop Stop Condition: "No Remaining" Not "No New"'
date: 2026-06-29
category: logic-errors
track: bug
problem: 'A bounded review-fix loop that stops on "no NEW findings this iteration" silently exits with a known unfixed P1 from a prior iteration still present'
tags:
  - agent-authoring
  - loops
  - stop-condition
  - review-loop
  - polish-loop
  - command-authoring
  - yellow-core
---

# Iterate-Until-Clean Loop Stop Condition: "No Remaining" Not "No New"

## Problem

A bounded review→fix loop with the stop condition "this iteration surfaces no
**new** P1/P2 findings" silently exits while a known P1 from a prior iteration
is still unfixed. The previous P1 was already on the list — it was not "new" in
the current iteration — so the stop condition is satisfied without the issue
being resolved. The iteration cap and its AskUserQuestion escalation gate are
never reached.

Found while authoring the bounded polish loop in
`plugins/yellow-core/commands/workflows/work.md` Phase 3, whose first draft
read "Stop iterating as soon as an iteration produces no file changes (stable)
or surfaces no new P1/P2 findings."

## Symptoms

- A polish/fix loop exits "successfully" while a known finding remains.
- The fix for a prior-iteration P1 was attempted but only partially applied,
  and the loop never circles back.
- The iteration cap was never reached despite an unfixed issue.
- A later reviewer flags the same P1 that was found two iterations earlier.

## What Didn't Work

Tracking "no new findings per iteration" as the convergence signal. It
conflates "we have seen this finding before" with "this finding is fixed" —
two very different states. A finding that persists unchanged is the *worst*
case (the fix isn't landing), yet the "no new" condition reads it as success.

## Solution

Stop only when one of these holds:

1. **Clean pass** — zero P1/P2 findings *remain* (not merely zero *new* ones).
   A finding that persists unchanged across iterations is still outstanding and
   must keep the loop going.
2. **No file change** — the apply step changed nothing, so re-running review
   would be identical (genuine fixpoint).
3. **Iteration cap reached** — then do NOT exit silently; gate via
   AskUserQuestion (continue / stop-and-ship / escalate) so the human decides
   what to do with the still-outstanding findings.

The load-bearing word is **remain**: convergence is "the review pass comes back
clean," never "nothing new appeared this round."

## Rule

For any agent-driven iterate-until-clean loop (review→fix, lint→fix,
test→repair), define the stop condition on the *remaining* finding set, not the
*delta* between iterations. Pair it with a hard iteration cap and an explicit
escalation gate so a non-converging loop surfaces to a human instead of exiting
quietly.

## Related

- `docs/solutions/code-quality/claude-code-command-authoring-anti-patterns.md`
  — other optional-step / loop-control authoring pitfalls in command `.md` files.
