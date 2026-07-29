---
title: 'Knowledge-compounder M3 gate stalls in non-interactive pipelines — use the documented gate-free path, not a spawn-prompt override'
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

# Knowledge-compounder M3 gate stalls in non-interactive pipelines — use the documented gate-free path, not a spawn-prompt override

## Context

The `knowledge-compounder` agent mandates an `AskUserQuestion` confirmation
(the "M3 gate") before any `docs/solutions/`/MEMORY.md write
(`plugins/yellow-core/agents/workflow/knowledge-compounder.md`, "M3
Confirmation"). When `AskUserQuestion` isn't answerable in a given session,
the compounder's observed recovery is to post the M3 preview as plain text
and wait for the next message.

That recovery covers the compounder's own behavior once it's already
stalled. It does not cover the orchestrator's side: across a
`/review:sweep-all` batch spanning three PRs (#670–#672, 2026-07-29),
per-PR compounder invocations halted at M3 and had to be resumed via
`SendMessage` with an explicit "Write" verdict — a wasted round trip per
invocation. Some later invocations in the same batch avoided the halt by
stating non-interactive mode directly in the spawn prompt, which led the
compounder to improvise best-judgment routing instead of stopping to ask.

## The trap: the spawn-prompt declaration is not a documented interface

It is tempting to record "declare non-interactive mode in the spawn
prompt" as the fix. It is not one:

- `knowledge-compounder.md` has **no** non-interactive mode. Its M3
  section says "Use AskUserQuestion before any writes", unconditionally;
  a spawn prompt claiming non-interactivity is honored only if the agent
  improvises, and a spec-faithful compounder would stall anyway.
- This repo's standing rules explicitly classify ad-hoc overrides that
  instruct a child to shortcut its own gates as gate-skipping "through a
  different channel" (root `CLAUDE.md`, Skill and Workflow Execution
  Rules). The documented gate-free carve-outs do not include spawn-prompt
  overrides of the compounder's M3 gate.

## Guidance

For pipelines with no human available to answer an `AskUserQuestion`
(batch sweeps, background drains, scripted multi-PR runs), pick one of
the two paths that are actually documented:

1. **Route unattended compounding through the compound-staging drain** —
   the sanctioned gate-free path. Stage candidate learnings to the
   compound-staging ledger and let the drain pipeline
   (`staging-scorer` → `staging-reviewer` → `staging-promoter`) score,
   dedup, and promote them; `staging-promoter` is frontmatter-enforced to
   never ask for confirmation. This is the carve-out the repo already
   recognizes as legitimate non-interactive compounding.
2. **Keep the orchestrator in the loop** — spawn the compounder normally,
   expect the M3 preview to arrive as plain text, and answer it with
   `SendMessage({to: <compounder-name>, ...})` carrying an explicit
   "Write [route]" verdict. The round trip is the cost of the gate; budget
   for one per invocation rather than treating the stall as a failure.

If direct, gate-free compounder spawning is genuinely needed, the fix is
to add a documented non-interactive interface (with equivalent
safeguards) to `knowledge-compounder.md` itself first — until that
exists, do not rely on spawn-prompt declarations being honored.

## Why This Matters

Without planning for the gate, the compounder's default is to post the M3
preview and stop — burning a full spawn/idle cycle before the
orchestrator notices nothing was written and has to re-engage with an
explicit verdict. At sweep-all scale (multiple PRs, each with its own
per-PR compounder invocation), that round trip multiplies per invocation —
the same class of avoidable orchestration overhead as the
addressable-teammate delivery gap in
[mailbox-teammate-explicit-sendmessage.md](../code-quality/mailbox-teammate-explicit-sendmessage.md),
but a different failure class: that doc is about a missing *delivery*
instruction after work is done, this one is about not planning for a
mandatory *gate* in the child's interface. The wrong lesson (prompt the
gate away) trades the overhead for an undocumented bypass of a safety
gate; the right lesson is to pick the documented path that matches the
pipeline's interactivity.

## When to Apply

- Any spawn of `knowledge-compounder` (directly or via
  `/workflows:compound`) from a pipeline where no user is available to
  answer an `AskUserQuestion` mid-run — batch sweeps, background drains,
  scripted CI-triggered compounding.
- Does not apply to interactive sessions where a user is actively driving
  the conversation and can answer the M3 gate normally.

## Examples

- **Round-trip cost:** in the sweep-all batch (#670–#672), per-PR
  compounder invocations that went through the interactive gate required
  a follow-up `SendMessage` with an explicit "Write [route]" verdict
  before Phase 2 writes ran. Invocations that declared non-interactive
  mode in the spawn prompt proceeded straight to writes — demonstrating
  the overhead is real, but via an undocumented override this doc exists
  to warn against, not to recommend.
