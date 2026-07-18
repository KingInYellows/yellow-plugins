---
title: 'Addressable mailbox-teammate agents need an explicit "send your result" instruction — synchronous Task subagents already auto-return'
date: 2026-07-18
category: code-quality
track: knowledge
problem: >-
  In a large fan-out review session, 20 SendMessage-addressable teammate
  agents finished their work and went idle without ever delivering their
  final output to the orchestrator; every result required an explicit
  "send your findings" SendMessage nudge, some needing two
tags:
  - multi-agent-orchestration
  - sendmessage
  - teammate-model
  - task-tool
  - agent-authoring
components:
  - workflow
  - orchestration
---

# Addressable mailbox-teammate agents need an explicit "send your result" instruction

## Two different subagent delivery models in the same harness

This harness supports two distinct ways of running a subagent, and they have
**opposite default result-delivery behavior**:

1. **Synchronous `Task`-tool subagents** (spawned and awaited within the
   same turn). Their final text is captured as the tool's return value and
   is automatically visible to the calling agent — no explicit instruction
   is needed for the result to reach the caller. The harness prompt's
   "the result returned by the agent is not visible to the user... you
   should send a text message back to the user" describes the *caller's*
   job of relaying that already-delivered result onward, not the
   subagent's job of delivering it in the first place. (Delivery
   semantics here describe behavior observed in this repo's sessions as
   of 2026-07 — there is no versioned harness contract or regression
   test pinning them; re-verify empirically if the harness changes.)
2. **Addressable "mailbox" teammate agents** — spawned as long-lived named
   peers (reachable afterward via `SendMessage({to: name, ...})`), the model
   used for large parallel fan-outs like a 20-persona review sweep. A
   teammate finishing its assigned work and simply stopping does **not**
   deliver anything to the orchestrator. In every observed instance
   (this repo, 2026-07: a 20-reviewer fan-out plus multiple resolver and
   compounder waves), nothing auto-routed a teammate's final turn text
   to whoever spawned it — the teammate's output only reached the
   orchestrator when the teammate explicitly called `SendMessage` to
   hand it over. Same caveat as above: session-observed behavior, not a
   versioned guarantee.

## Problem

In a session that fanned out 20 review-persona teammates in parallel, every
single one finished its analysis, produced findings internally, and then
went idle — without a single one proactively sending its results back. The
orchestrator had to explicitly message each teammate ("send your findings")
to get the output; some teammates needed a second nudge before they
complied. At 20 teammates, this turned a "spawn and collect" pattern into a
"spawn, wait, individually prompt each one" pattern, multiplying the
orchestration overhead by roughly 2x.

The root cause: teammate agents, by default, treat completing their
assigned analysis as the deliverable — the same way a standalone
interactive session would just print its findings and consider the turn
done. There is no default behavior that equates "I'm finished" with
"I have told my orchestrator I'm finished," because the teammate has no way
to know delivery isn't automatic unless told.

## Solution

When an orchestrating prompt spawns addressable teammate-style agents (via
the `Agent` tool with a `name:`, intending to reach them later via
`SendMessage`) for parallel work, the prompt must end with an **explicit**
instruction to deliver the result, not just an instruction to produce it:

```text
When your review is complete, send your findings to <orchestrator-name>
via SendMessage — do not just finish your turn. Your findings are not
visible to anyone until you send them.
```

Without this line, "produce findings" and "deliver findings" are two
separate steps that the teammate has no signal to connect.

## Prevention

- Any orchestration prompt that spawns **addressable/mailbox teammates**
  (not synchronous `Task` subagents) must end with an explicit
  "SendMessage your result to `<name>`" instruction. Treat this as a
  required closing line of the prompt template, the same way a command's
  push-confirmation gate is a required closing step — not an assumption
  that "finishing the task" implies "the orchestrator now has the output."
- Do **not** generalize this into adding redundant SendMessage boilerplate
  to **synchronous `Task`-tool** subagent prompts — those already
  auto-return their final text to the caller as the tool result. Adding
  "send your result via SendMessage" to a Task subagent's prompt is either
  a no-op (if it has no addressable name/mailbox) or actively confusing
  (implying a delivery step the harness already performs). The fix is
  specific to the addressable-teammate model, not a blanket rule for every
  subagent invocation.
- At orchestration scale (10+ parallel teammates), budget for at least one
  nudge round after the expected completion time as a matter of course,
  rather than treating "no SendMessage yet" as itself a failure signal —
  but prefer fixing the spawn prompt over relying on the nudge round, since
  the nudge round is strictly the more expensive path.
