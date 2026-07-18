---
title: 'A "No Further Writes" Invariant Scoped to One Write Mechanism Misses a Second One to the Same Resource'
date: 2026-07-18
category: logic-errors
track: bug
problem: 'seed-solutions.md declares "no further MCP writes after reembed" but its own remaining Bash steps trigger a PostToolUse hook that shells to the same CLI, writing to the same store'
tags:
  [
    invariant-scope,
    hook-side-effects,
    write-path-enumeration,
    ruvector,
    guard-clause,
  ]
components:
  [
    plugins/yellow-ruvector/commands/ruvector/seed-solutions.md,
    plugins/yellow-ruvector/hooks/scripts/post-tool-use.sh,
  ]
---

## Problem

**General pattern first:** an invariant phrased as "no further writes to
resource R" is only as complete as the set of write *mechanisms* its
author had in mind when writing it. If R can be written through more than
one mechanism — a direct API call, and separately, a passive/background
process that happens to touch the same resource — an invariant scoped to
only one of them reads as a complete safety guarantee while leaving the
other wide open. This is easy to miss precisely because the second
mechanism is usually not the one anyone is thinking about when the
invariant gets written; it is infrastructure (a hook, a sidecar, a
scheduled job) rather than the feature code the author is actively
reasoning about.

**Concrete instance:** `seed-solutions.md` Step 6 states: "After the
reembed, the no-MCP-writes rule applies for the REST of the session
... defer ANY further store writes — including unrelated `hooks_remember`
calls later in the session — to a fresh session." The invariant is
correctly scoped against one write mechanism: MCP tool calls
(`hooks_remember` et al.) going through this session's MCP server, which
may hold a stale pre-reembed in-memory snapshot that would clobber the
just-reembedded store on its next save.

It does not account for a second mechanism to the same store:
`plugins/yellow-ruvector/hooks/scripts/post-tool-use.sh` fires
unconditionally on every `Bash` tool call (when `.ruvector/` exists and
the `ruvector` binary is on `PATH`) and runs
`ruvector hooks post-command --success -- "$command_text"` (or `--error`
on a nonzero exit) — itself a write to `.ruvector/intelligence.json`
through a completely separate code path than the MCP server. And
`seed-solutions.md`'s own remaining steps are Bash calls: Step 6's
`npx ... ruvector@0.2.34 hooks reembed` invocation, and Step 8's
`grep -o 'ERROR-FIX:' ... | wc -l` durability re-check both run as `Bash`
tool calls, both of which the PostToolUse hook will fire on. The
invariant's own text ("the REST of the session") is violated by the very
steps that state it, before the session even reaches its own Step 8.

## What's confirmed vs. what isn't

**Confirmed by reading source** (no live execution needed): the hook
script unconditionally shells to `ruvector hooks post-command` on every
successful or failed Bash call once `.ruvector/` exists — this is a
second, distinct write path to the same store file that the Step 6
invariant's "no-MCP-writes" framing does not mention.

**NOT confirmed:** whether this specific write path (a fresh `ruvector`
CLI process per hook invocation, not a long-lived MCP server holding a
stale in-memory snapshot) actually damages or resets the reembed's
provenance stamp. The store clobber risk documented elsewhere in the same
command (Step 2's "last writer wins, wholesale" model, and the stale
pre-reembed MCP snapshot Step 6 already guards against) is a *different*
mechanism — a long-running process's in-memory state going stale — and a
fresh-per-call CLI process re-reading current on-disk state before
writing is not automatically subject to the same failure mode. Resolving
this requires a live repro against a disposable `.ruvector` store (never
against a shared/symlinked project store — see "Why no repro is included
here" below), followed by either a code fix or an invariant-scope
correction to Step 6's wording in `seed-solutions.md`. That work is not
done in this doc; it is a generalizable-pattern write-up only.

### Why no repro is included here

This project's own `.ruvector/intelligence.json` is symlink-shared across
git worktrees (`CLAUDE.md` "Storage" note) and multiple `.corrupt-*`
snapshot files already sit next to it, evidence that the *already
documented* stale-snapshot clobber mechanism has previously damaged this
exact shared store. Deliberately triggering more Bash-tool-call traffic
against it to test a second, unconfirmed write path is not a safe or
proportionate way to validate a documentation-compounding finding — do
that testing (if pursued) against a disposable store in an isolated
directory, not the live shared one.

## Prevention / generalization

- When authoring or reviewing a "no further writes" / write-freeze
  invariant, enumerate every mechanism that can write to the resource,
  not just the one the surrounding code path uses directly. In a plugin
  with hooks, that means checking `PreToolUse`/`PostToolUse`/etc. scripts
  for anything that shells out to the same backing store or API — a grep
  across the plugin's `hooks/` directory for the resource's CLI/API name
  is a cheap check before declaring an invariant complete.
  is a cheap check before declaring an invariant complete.
- A command's own remaining steps are part of "the rest of the session"
  an invariant claims to cover. If Step N declares a write-freeze and
  Steps N+1..M are still Bash/Edit/Write calls, check whether those tool
  types are exactly the ones a PostToolUse-style hook instruments — if
  so, the invariant is scoped incorrectly by construction, independent of
  whether the resulting write is provably harmful.
- Treat "confirmed by reading source" and "confirmed by live repro" as
  distinct claims in a write-up. Documenting the scope gap does not
  require also proving damage; conflating the two either overclaims (if
  damage isn't actually confirmed) or delays documenting a real gap until
  someone has time to run a repro.

## Related

- `docs/solutions/logic-errors/reactive-trigger-threshold-blind-spot.md`
  — a sibling blind-spot pattern in the same command file: a trigger
  scoped to one condition (a specific error) misses a second path into
  the same underlying state. This doc is the same shape one level up:
  an invariant scoped to one write *mechanism* misses a second mechanism
  reaching the same resource.
- `docs/solutions/logic-errors/append-only-dedup-blocks-correction-propagation.md`
  — another gap in this command's store-write model, at the dedup layer
  rather than the invariant-scope layer.
- `plugins/yellow-ruvector/commands/ruvector/seed-solutions.md` Step 6 —
  the invariant this doc generalizes from; its wording still needs either
  a live-repro-backed code fix or an explicit scope correction, tracked
  as a follow-up, not resolved here.
