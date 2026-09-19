---
title:
  'A Capacity Bound or Staleness Guard Needs a Dependent Inventory and an Escape
  Hatch — Documenting Only Its First-Order Effect Hides the Safety One'
date: '2026-09-11'
category: 'logic-errors'
track: 'knowledge'
problem:
  'A 1000-entry dedup ring was documented as "counts may inflate" when its cap
  is reached, but a second feature had later been keyed on the same ring —
  suppressing re-action by an autonomous supervise loop — so eviction silently
  re-enables repeated acts on already-handled activities; in the same contract a
  stale-lock guard had no staleness criterion and blocked the only recovery path
  for the crash that created it, a watermark had no monotonic or non-future
  clamp, and three distinct stop causes shared one recovery instruction'
tags:
  - bounded-buffer
  - eviction
  - shared-state
  - degradation-flag
  - stale-lock
  - watermark
  - recovery-path
components:
  - docs/yellow-jules/contract-v1.md
---

# A Capacity Bound or Staleness Guard Needs a Dependent Inventory and an Escape Hatch

## Context

Four findings in one review pass of an 800-line provider-CLI contract shared a
mechanism: a bound or guard was specified with the effect its author had in
mind, and the other things that depend on it were never enumerated.

## Finding 1: The Ring's Second Consumer Is a Safety Behavior

The contract keeps a dedup ring of every activity id seen inside a 5-minute
overlap window, capped at 1000 entries. When the cap is reached the walk reports
`dedupWindowExceeded: true`, and the contract documents the consequence as
_"counts may inflate."_

Two sentences later, the same section states what ring membership actually does:
it _"suppresses re-counting toward `new` **and re-acting under `supervise`**."_
`supervise` is the autonomous pass that may send replies, approve plans, and
collect artifacts under a standing grant. So eviction does not merely inflate a
number — it silently restores the conditions under which an already-handled
activity is acted on a second time, in the one mode where no human is in the
loop.

The ring was introduced for counting. The suppression was keyed onto it later.
Nothing re-derived the cap's consequences when the second consumer arrived, and
the flag's documented meaning still describes only the first.

**Fix shape:** either state in the contract that `dedupWindowExceeded` disables
the `supervise` act step for that pass — making the degradation fail toward
doing nothing rather than toward doing it twice — or key the idempotence
decision on something durable (a stored high-water `(createTime, activityId)`
pair) rather than on a bounded in-memory set. Bounded structures are acceptable
for approximations; they are not acceptable as the sole gate on a side effect.

## Finding 2: A Guard That Blocks the Recovery Path for Its Own Cause

`JULES_STALE_LOCK` is raised when "a lock from a crashed process exists," with
the remedy _"remove by hand after inspection."_ Two things are missing. There is
no criterion for what makes a lock stale — no PID-liveness check, no mtime age —
so the code cannot distinguish a crashed holder from a live one, and the error
name asserts a conclusion the implementation has no way to reach. And the
condition blocks every subsequent command, including the reconcile that exists
to repair the state a crash left behind.

A guard whose trigger is "a previous run died" must define liveness explicitly
(holder PID not running **and** lock mtime older than the longest legitimate
operation) and must leave at least one command reachable to clean up. Otherwise
the failure mode it detects is also the failure mode it makes unrecoverable, and
the documented remedy is a human with a filesystem.

## Finding 3: A Watermark With No Clamp

The read watermark advances "to the newest activity seen" after a complete walk.
Nothing requires the new value to be greater than the stored one, and nothing
bounds it against the local clock. A vendor timestamp that is wrong, skewed, or
adversarially far in the future permanently silences the walk: every subsequent
`createTime > watermark` filter excludes everything real. Advance rule should be
`max(stored, newest seen)`, clamped to local now plus an allowed skew.

## Finding 4: Three Causes, One Recovery Instruction

A re-fetch that ends before the newest page fails closed with one error code and
one recovery string, "retry with a larger deadline." Three different causes
reach it: the time budget expired, a page request failed, and an activity could
not be mapped. Only the first is fixed by a larger deadline; the second needs a
retry, and the third will reproduce identically forever. When one recovery
string covers causes with different remedies, two of the three users who read it
are sent to do something that cannot work — and the operator learns to ignore
the field. Carry the cause as an envelope field and branch the recovery on it.

## The Shared Check

For every bounded or guarded structure in a design, answer four questions in the
document itself:

1. **Who reads it?** List every consumer of the structure, not the one it was
   built for. If any consumer gates a side effect, the bound's exceeded-state
   must be specified from that consumer's point of view first.
2. **Which way does exceeding it fail?** Toward doing less or toward doing more?
   A capacity flag that degrades toward repeating an action is a safety defect
   wearing a metrics label.
3. **Is there an escape hatch?** A guard that fires on a crash must leave the
   repair path reachable and define its own staleness criterion, rather than
   naming one it does not test.
4. **Do distinct causes stay distinct?** Progress tests, stop reasons, and
   recovery instructions collapse easily into one branch; each cause with a
   different remedy needs its own.

Related:
[`unhandled-outcome-defaults-to-success-bucket.md`](../code-quality/unhandled-outcome-defaults-to-success-bucket.md)
(a new outcome with no consumer slot lands in success),
[`iterate-until-clean-loop-stop-condition.md`](./iterate-until-clean-loop-stop-condition.md)
(a walk that restarts with no progress test never terminates), and
[`reactive-trigger-threshold-blind-spot.md`](./reactive-trigger-threshold-blind-spot.md)
(a threshold whose sub-threshold state has no handler).

## When to Apply

- Adding a second consumer to an existing cache, ring, set, or index — re-read
  the structure's documented degradation behavior and rewrite it from the new
  consumer's perspective before shipping.
- Specifying any lock, lease, or crash guard: define liveness, define staleness,
  and name the command that still works while the guard is held.
- Reviewing any error table whose `recovery` column repeats the same string on
  rows with different causes.
