---
title:
  'Absence From a Vendor List Is Not Proof of Non-Existence, and a
  Document-Level Provenance Caveat Discharges No Individual Claim'
date: '2026-09-11'
category: 'integration-issues'
track: 'knowledge'
problem:
  'A contract derived entirely from source inspection of a vendor SDK — zero
  live calls — released a duplicate-launch safety guard on the strength of a
  complete list walk finding no matching session, even though whether the vendor
  omits archived sessions from an unfiltered list was itself recorded as an open
  unknown three lines later; a blanket provenance caveat added in an earlier
  review pass had not stopped four more rules from resting on unverified vendor
  behavior'
tags:
  - vendor-api
  - evidence-provenance
  - absence-of-evidence
  - list-pagination
  - fail-safe-default
  - smoke-test-design
  - remote-agent-provider
components:
  - docs/yellow-jules/contract-v1.md
  - docs/yellow-jules/capability-matrix.md
  - docs/yellow-jules/sdk-investigation.md
  - plans/specs/yellow-jules-integration.md
---

# Absence From a Vendor List Is Not Proof of Non-Existence

## Context

PR #793 specified a provider CLI against a vendor SDK that was never called: the
investigation was deliberately zero-spend, so every claim came from the packed
`dist/types.d.ts` and `dist/index.mjs`, or from the package readme. The
capability matrix made this explicit with per-row evidence labels (`documented`,
`source-inspected`, `packed-artifact-tested`, `live-observed`), and noted that
**no row carries `live-observed`**. An earlier review pass had also added a
document-level provenance caveat to the contract.

A later pass still found four normative rules resting on vendor behavior no
evidence establishes, and one of them was load-bearing for safety.

## The Load-Bearing One: `released` Frees a Guard on Absence of Evidence

The contract refuses a duplicate launch when a reservation for the same
repository and branch is outstanding. The only recovery is a reconcile walk:
page through the vendor's session list, match each page against the
reservation's embedded tag, and if a **complete** walk (every page read inside
the page cap and the deadline) finds no tagged candidate and no untagged
same-source, same-branch session in the time window, declare the reservation
`released` — mark it terminally failed and free the repository and branch.

Three lines below that rule, the same section says: _the walk applies no
archive-state filter; whether the vendor omits archived sessions from an
unfiltered list is a remaining unknown._

Those two statements cannot both stand. If the vendor's unfiltered list omits
archived sessions — the ordinary behavior of most list APIs, and the reason
`includeArchived`/`show_deleted`/`state=all` flags exist — then a session that
was archived between creation and reconcile is invisible to a "complete" walk,
and the reconcile frees a guard protecting a session that is still live. The
inference "not in the list, therefore it never existed" is only sound when the
list's filter semantics are known and total.

Fix shape: gate the outcome that _relinquishes_ safety on evidence, not on the
absence of a counter-example. Until the live smoke establishes archive
visibility, a complete-walk-no-candidate must resolve to `ambiguous-reconcile` /
`not-reached`, which leave the reservation in place and route to the
human-confirmed abandon path. Releasing later, once evidence exists, costs one
line; a wrongly-released guard costs a duplicate remote agent on the same
branch.

## The General Rule: List Absence Has Three Explanations, Not One

Any "I walked the list and it was not there" inference must distinguish:

1. **It does not exist.** The conclusion the code wants.
2. **It exists but the list filters it out.** Archived, soft-deleted,
   permission-scoped, tenant-scoped, region-scoped, or excluded by a default the
   API documents nowhere.
3. **It exists but the walk did not reach it.** Page cap, deadline, cursor
   rejected mid-walk, eventual-consistency lag between write and list
   visibility.

This contract had a clean answer for (3) — the `not-reached` outcome — and had
never separated (2) from (1). A walk is only "complete" with respect to the
filter it ran under, and the filter's semantics are a vendor fact that source
inspection of a client SDK cannot supply: the client sends a query string; what
the server excludes by default is invisible in the client's types.

## A Blanket Caveat Is Not a Per-Claim Citation

The earlier pass's document-level provenance caveat was honest and useless. It
told a reader that the document as a whole was unverified; it did not tell an
implementer which of 800 lines they may not rely on, and it did not stop four
new rules from being written as if the behavior were settled:

- the archive-visibility assumption above;
- a `nextPageToken` on the session cursor that the reconcile walk and
  `list --page-token` both depend on, present in no evidence record;
- a clause promising the adapter carries the raw REST state string, when the
  SDK's own mapper collapses unknown states to `unspecified` before the adapter
  ever sees the response;
- an environment-variable ordering stated as "before `connect()`" when the SDK
  module builds a default client at evaluation time, making the real constraint
  "before the dynamic `import()`."

Each is a rule a reader would implement from, and each would have failed at
runtime rather than at review. Per-claim discipline: a normative rule derived
from an un-exercised surface carries either a pointer to the evidence line that
establishes it (`T<line>` / `M<line>` in this project's scheme) or an explicit
unknown marker naming the instrument that will settle it. "The document is
unverified" is a property of the document; "this rule is unverified" is the
property an implementer needs.

## The Instrument That Settles the Unknowns Needs More Than Pass/Fail

The spec's single live smoke was recorded as `pass | fail` while several of its
success criteria depend on the very vendor unknowns the smoke exists to settle,
and one criterion ("interactive confirmation on every write") is not exercisable
at all by a run performed under a pre-written grant. A two-valued record forces
an unexercised criterion into one of the two buckets, and the default is pass.

A verification instrument that exists to resolve unknowns needs:

- a **per-criterion** table, not one verdict for the run;
- a third outcome — **not exercisable** — for criteria the run's own
  configuration cannot reach;
- an explicit list of which contract rules each criterion is discharging, so a
  `pass` visibly converts specific `remaining unknown` markers and nothing else.

See
[`unhandled-outcome-defaults-to-success-bucket.md`](../code-quality/unhandled-outcome-defaults-to-success-bucket.md)
for the same shape at the code and spec-checklist level, and
[`golden-fixture-parity-vs-contract-correctness.md`](../code-quality/golden-fixture-parity-vs-contract-correctness.md)
for verifying against an assumed rather than confirmed primary source.

## When to Apply

- Writing a contract against an API you have not called: mark each rule with its
  evidence, and audit specifically for inferences of the form "not present in
  the response, therefore absent from the system."
- Any reconcile, garbage-collect, orphan-sweep, or duplicate-detection path
  built on a list endpoint: identify the endpoint's default filters before the
  walk's negative result is allowed to change state, and make the
  safety-relaxing branch the one that requires positive evidence.
- Designing the first live run of an integration: enumerate per criterion what
  the run can and cannot exercise, before the run, and keep a not-exercisable
  outcome available in the record.
