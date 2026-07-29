---
title: 'Knowledge-compounder M3 gate halts non-interactively — declare non-interactive mode in the spawn prompt'
date: 2026-07-29
category: workflow
track: knowledge
problem: 'knowledge-compounder halts at its M3 AskUserQuestion gate when spawned from a non-interactive sweep-all/resolve pipeline'
tags:
  - knowledge-compounder
  - non-interactive
  - m3-gate
  - orchestration
  - sweep-all
components:
  - workflow
  - orchestration
related:
  - docs/solutions/code-quality/mailbox-teammate-explicit-sendmessage.md
---

# Knowledge-compounder M3 gate halts non-interactively — declare non-interactive mode in the spawn prompt

## Context

The `knowledge-compounder` skill mandates an `AskUserQuestion` confirmation
(the "M3 gate") before any `docs/solutions/`/MEMORY.md write. When
`AskUserQuestion` isn't in the compounder's actual tool grant for a given
session, it falls back to posting the M3 preview as plain text and waiting
for the next message — this recovery path is already recorded as agent
memory (`feedback_askuserquestion_unavailable.md` in this repo's
gitignored `.claude/agent-memory/yellow-core-workflow-knowledge-compounder/`).

That memory covers the compounder's own recovery once it's already
stalled. It does not cover the orchestrator's side: across a `/review:sweep-all`
batch spanning three PRs (#670–#672, 2026-07-29), the first per-PR
compounder invocations halted at M3 and had to be resumed via
`SendMessage` with an explicit "Write" verdict — a wasted round trip. Later
invocations in the same batch avoided the halt entirely by stating
non-interactive mode directly in the spawn prompt, letting the compounder
apply best-judgment routing on the first pass instead of stopping to ask.

## Guidance

When spawning `knowledge-compounder` from a pipeline that has no human in
the loop to answer an `AskUserQuestion` (a batch sweep, a background drain,
a scripted multi-PR run), say so explicitly in the spawn prompt:

```text
You are running non-interactively: if you would normally gate on
AskUserQuestion/text confirmation, apply best-judgment routing directly
and report what you did.
```

This is not "skip the gate" — it's telling the compounder up front which
of its two documented M3 paths applies, so it never attempts the
interactive one and stalls waiting for a reply that isn't coming.

## Why This Matters

Without this line, the compounder's default assumption is that a reply is
possible, so it posts the M3 preview and stops — burning a full spawn/idle
cycle before the orchestrator notices nothing was written and has to
re-engage with an explicit verdict. At sweep-all scale (multiple PRs, each
with its own per-PR compounder invocation), that round trip multiplies
per invocation, the same class of avoidable orchestration overhead as the
addressable-teammate delivery gap in
[mailbox-teammate-explicit-sendmessage.md](../code-quality/mailbox-teammate-explicit-sendmessage.md)
— but a different failure class: that doc is about a missing *delivery*
instruction after work is done, this is about a missing *mode* declaration
that prevents the compounder from ever reaching its interactive gate in
the first place.

## When to Apply

- Any spawn of `knowledge-compounder` (directly or via `/workflows:compound`)
  from a pipeline where no user is available to answer an `AskUserQuestion`
  mid-run — batch sweeps, background drains, scripted CI-triggered
  compounding.
- Does not apply to interactive sessions where a user is actively driving
  the conversation and can answer the M3 gate normally — declaring
  non-interactive mode there would incorrectly suppress a gate the user
  could otherwise use to adjust routing.

## Examples

- **Round-trip cost avoided:** in the same sweep-all batch (#670–#672),
  earlier per-PR compounder invocations stalled at M3 and required a
  follow-up `SendMessage({to: <compounder-name>, ...})` with an explicit
  "Write [route]" verdict before Phase 2 writes ran. Later invocations,
  including this batch-level pass, declared non-interactive mode in the
  spawn prompt and proceeded straight to Phase 2 without a stall. (Which
  specific per-PR invocation landed on which side of that split was not
  independently re-verified while writing this doc — the transferable
  mechanism is what's load-bearing, not the per-PR attribution.)
