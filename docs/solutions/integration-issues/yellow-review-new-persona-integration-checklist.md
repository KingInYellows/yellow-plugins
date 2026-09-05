---
title: 'Opt-in review personas need an identity row, not just a trigger row'
category: integration-issues
tags: [reviewer-registration, dispatch-table, opt-in-config, agent-skill-drift, schema-duplication, byte-identity-test]
module: yellow-review
date: 2026-09-05
severity: P1
problem_type: silent-failure
solution_type: pattern
---

## Problem

A review persona (or any pluggable component selected by config rather than
by always-on/conditional trigger logic) gets fully written — agent body,
portable skill, tests, fixtures — but is deliberately left out of both
dispatch tables so that it only activates via an opt-in config knob (e.g.
`reviewer_set.include`). This is a reasonable design goal. The failure mode
is that "opt-in" gets conflated with "no registration needed at all": the
persona ends up with no `subagent_type`/category row anywhere the
orchestrator actually reads, so the opt-in path can never resolve it. Five
independent reviewers caught this on the same PR — it is not a subtle
one-off, it is what happens whenever a new selection mechanism is bolted
onto an existing always-on/conditional dispatch table without adding a third
kind of row for it.

A second, independent problem showed up on the same PR: the persona's
output contract (schema, defaults, caps) was written twice — once in the
Claude-only agent body, once in the portable skill — with no test asserting
the two stay identical. Seven reviewers separately flagged the specific
symptom (an "eight-finding cap" instructing overflow into a `summary` field
the JSON schema has no slot for), but the root cause is the duplication
itself, not that particular field.

## Why this happens

Dispatch tables in this codebase are keyed by *how* a persona gets selected
(always-on list, conditional-trigger list). Neither key represents
*identity* — the stable `(subagent_type, category)` pair the orchestrator
needs regardless of selection path. When someone adds a third selection
path (explicit opt-in via config), it's natural to assume the two existing
tables are "selection mechanism," not "the only place identity is recorded,"
and skip adding a row because the persona isn't always-on or
conditionally-triggered. But if identity was only ever recorded inside those
two tables, opt-in has nothing to resolve against — and nothing fails loudly,
because the include-list mention doesn't validate that the value maps to
anything.

For split contracts (agent + portable skill, or any two files that must
agree on a schema), the failure mode is symmetric: whoever writes the second
copy is trusting careful transcription, and nothing re-checks it after the
fact. A one-time correct copy still drifts on the next edit to either file.

## Fix / Pattern

1. **Separate identity from selection.** Maintain one place (a single
   registry, or an explicit third table) that maps persona name →
   `subagent_type` + `category`, independent of whether it's selected via
   always-on, conditional-trigger, or explicit opt-in list. Every dispatch
   path — including opt-in — resolves through that identity mapping, never
   by assuming the persona will also appear in one of the trigger tables.
2. **Test the opt-in path can resolve, not just that it's "listed."** An
   integration test that only asserts the persona's name appears in an
   include-list (and separately bans hardcoding its `subagent_type` as a
   literal, to force a real mapping) is exactly the shape needed to catch
   this — write that test *before* the identity mapping exists, so it fails
   for the right reason first.
3. **Never duplicate an output schema across two files by hand.** If a
   Claude-only agent and a portable skill must expose the same JSON
   contract, generate one from the other, or add a test that diffs the two
   schema blocks byte-for-byte (or field-for-field) and fails on drift.
   Absent that, treat any prose claim like "the skill only adds
   PR-specific fields" as unverified until the test exists.
4. **When a cap/limit interacts with a fixed-shape output contract** (e.g.
   "report only the first N findings"), name the actual field the overflow
   goes into, or explicitly say it's dropped. "Summarize the rest" is not
   an instruction a fixed JSON schema can execute — grep the schema for a
   free-text slot before writing that instruction.

## Also recurring: pipeline-integration points beyond registration

A prior new-persona PR (#766, before this doc existed on disk — see Note
below) independently surfaced the same underlying category of bug through
different symptoms: a new persona is correct in isolation but the
*surrounding pipeline* has assumptions the new persona breaks. Concretely:
default severity-demotion rules colliding with a persona-specific override,
`reviewer_set`/`focus_areas` ordering assumptions that a new inclusion
mechanism violates, legacy (pre-opt-in) dispatch mode gaps, manifest
generation dropping an invariant the new persona depends on, and
relative-path handling that breaks when the persona is invoked from a
different working directory. None of these are about the persona's own
correctness — they are about whether the orchestrator's *other* logic (severity
policy, manifest generation, path resolution) was written assuming the
persona set is closed, and silently mishandles a newly opened one.

Generalized: when adding a new pluggable unit to an existing pipeline, audit
every place the pipeline treats "the set of personas/units" as fixed or
enumerable — severity/precedence rules, manifest/config generation,
path-relative assumptions, and any ordering logic — not just the dispatch
table. A new unit that is itself correct can still break these because they
were never designed to be extended.

## Prevention checklist for new opt-in personas / split contracts

- [ ] Grep every dispatch/selection table AND every place `subagent_type`
      or `category` is read at runtime; confirm the new persona resolves
      through all of them, not just the one you edited.
- [ ] If the persona is opt-in-only, write the integration test that
      exercises the opt-in path end-to-end (not just presence in a list)
      before wiring the identity mapping, so you know the test can fail.
- [ ] If the persona ships both a Claude-only agent and a portable skill
      (or any two files expressing the same schema), add or extend a
      sync/byte-identity test in the same PR — do not defer it.
- [ ] Search any cap/limit prose for a target field name; if the schema has
      no such field, either add one or change the instruction to state
      what's dropped.
- [ ] Audit severity/precedence rules, manifest/config generation, and any
      path-relative logic for a hidden "closed set of personas" assumption
      before assuming the new persona is fully wired.

## Note on this doc's own provenance

MEMORY.md's Session Notes carried an index line pointing at this exact path
after PR #766's review, but the file itself was never actually written to
disk — a hand-off gap of the same shape documented in
[[upstream-concept-fork-snapshot-protocol]] (a compounding step reported as
done without the write being verified). This doc was created fresh during
PR #768's compounding pass and folds in the #766 findings from the stale
index-line description so the two don't diverge again.

## References

- PR #768 (`feat(yellow-review): add opt-in thermonuclear-reviewer persona
  and portable skill`) — 5 reviewers independently found the missing
  identity mapping (open as plan task 1.4.1b); 7 reviewers independently
  found the schema-less "summary" cap instruction; agent/skill schema
  duplication had no sync test.
- [[frontmatter-sweep-and-canonical-skill-drift]] — related pattern: sweeps
  and canonical copies silently diverge without an explicit roster or
  verbatim-copy discipline.
