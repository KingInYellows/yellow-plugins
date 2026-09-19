---
title:
  'A Contract Built Through Layered Review-Fix Passes Needs a Terminal-State
  Walk and an Identifier/Redaction Cross-Check Before Freezing'
date: '2026-09-10'
category: 'code-quality'
track: 'knowledge'
problem:
  'Three independent findings in the same 700-line provider-CLI contract, each
  written correctly in isolation across separate review-fix passes, silently
  contradicted each other once combined: a reconcile state machine had no
  outcome for a zero-candidate walk (permanent resource lockout), a redaction
  rule pattern-matched and blanked the very token field a return contract
  required, and a URL-validation table row made every successful delegate call
  report itself as a policy deviation'
tags:
  - spec-review
  - contract-authoring
  - state-machine-completeness
  - redaction
  - cross-cutting-rule-collision
  - multi-pass-review
  - remote-agent-provider
components:
  - docs/yellow-jules/contract-v1.md
---

# A Contract Built Through Layered Review-Fix Passes Needs a Terminal-State Walk and an Identifier/Redaction Cross-Check Before Freezing

## Context

PR #793 (`docs(yellow-jules): PR1 provider-CLI contract set`, a docs-only
provider-CLI contract for a new remote-agent plugin) had already been through
two prior review-fix passes (the commits titled
`docs(yellow-jules): apply first review pass to the PR1 contract set` and
`… apply second review pass …`; hashes are not cited because a restack rewrote
them once already) before a third 13-persona `/review:pr` pass surfaced three P1
findings that were each locally correct — a rule added in one section, read on
its own, was well-specified — but broke when read against a rule added in a
different section, at a different time:

1. **Reconcile has no zero-candidate outcome** (`contract-v1.md`, reconcile
   outcomes as reviewed in PR #793 round 1; a `released` outcome was added
   there). R36's duplicate-launch refusal and the R31 grant counters both assume
   a reservation eventually resolves via reconciliation. The reconcile walk
   itself, as specified, has outcomes for "found a match" and "found multiple
   ambiguous matches" but none for "walked everything, found nothing" — a create
   call whose POST never landed (network failure after send) has no path back to
   a released state. Every subsystem that reads "reconciliation will resolve
   this" was individually correct when written; none of them noticed the walk
   they depend on has a hole.
2. **Redaction blanks the field the contract requires** (`contract-v1.md`,
   confirmation token as reviewed in PR #793 round 1; dissolved there by the
   Open Question 6 decision). A generic secret-shaped-string redaction layer
   (`PREFIXED_SECRET_RE`, matching `tok-`-style prefixes) was specified as a
   blanket rule over all rendered output. Elsewhere, a confirmation-token
   mechanism was specified to _return_ a token to the caller as part of a
   normal, successful response. Neither spec location cross-referenced the
   other's assumed token format — the redaction rule was written to catch leaked
   secrets in vendor text, the token mechanism was written to solve a
   confirmation-replay problem, and nothing forced a check of whether the second
   one's output shape would collide with the first one's pattern.
3. **A URL-validation row makes success look like a violation**
   (`contract-v1.md`, identifier allowlist as reviewed in PR #793 round 1; the
   row was split there). One allowlist table validated `pullRequest.url` as a
   GitHub PR link (correct — that value should always be a PR link) by reusing
   the _same table row_ for `SessionResource.url`, a vendor-controlled session
   URL with no such guarantee. Every successful delegate call populates
   `SessionResource.url` with a value the same validator now rejects, so the
   "policy-deviation" branch — meant for a genuine anomaly — fires on the common
   case instead.

## Guidance

A rule that is correct where it is written is not the same claim as a rule that
is correct everywhere it applies. Two checks catch this class of gap that
neither "is this requirement locally complete" nor "is this requirement
internally consistent" review naturally performs:

1. **Walk every failure/exception branch of a state machine or resource
   lifecycle to an explicit terminal state**, not just the happy path and the
   branches someone already thought to name. For any "X eventually gets resolved
   by process Y" claim elsewhere in the document, verify process Y actually has
   an outcome for every input it can receive, including "found nothing" and
   "found more than expected." A resource with no path to a terminal state is a
   resource that leaks forever, and the leak is invisible until the zero/many
   case actually happens.
2. **Cross-check every identifier, token, or URL shape a contract introduces
   against every orthogonal pattern-matching rule already in the same document**
   — redaction rules, allowlist/validator tables, secret-shape scanners. These
   rules are usually written once, generically, early, and then trusted; a new
   field introduced later in the same document is not automatically checked
   against them just because both live in the same file. When a table row
   validates two different fields under one shared rule (as the URL row above
   did), ask explicitly whether both fields actually share the same guarantee,
   or whether the row is a convenient generalization that happens to be wrong
   for one of its two uses.

A layered-review process (fix pass 1, fix pass 2, then a fresh reviewer pass) is
what surfaces this class of gap, precisely because each pass tends to fix what
the previous pass flagged in isolation, without re-deriving whether the fix
collides with something specified elsewhere. Treat a "the spec passed a
completeness/consistency pass" state as insufficient on its own for a contract
with more than one cross-cutting rule (redaction, an allowlist, a state machine)
— run the two checks above explicitly, the same way
`pre-implementation-spec-review-authority-gaps.md` runs its four authority
questions explicitly rather than trusting that completeness review will surface
them.

## Why This Matters

Each of the three findings would look, in isolation, like a normal one-line spec
omission. What makes them a distinct class is that the _component that broke_
was specified correctly and the _component that collided with it_ was also
specified correctly — the defect exists only in the interaction, which means no
amount of re-reading either rule alone finds it. A reconcile walk that never
resolves silently exhausts a grant budget over time; a redaction rule that
blanks a required return value looks, to an implementer, like the contract
itself is broken or self-contradictory (which it is) rather than like a bug they
introduced; and a validator that misfires on the common case trains operators to
ignore the very policy-deviation signal it exists to raise.

## When to Apply

- Freezing or reviewing a contract/spec that has already been through more than
  one fix pass, especially one with a resource lifecycle (grants, reservations,
  leases) and at least one cross-cutting pattern-matching rule (redaction, an
  identifier allowlist, a secret scanner).
- Adding a new field, token, or URL shape late in a large document — explicitly
  re-check it against every generic rule already specified earlier, rather than
  assuming the earlier rule's author already accounted for a field that did not
  exist yet.
- See also
  [`pre-implementation-spec-review-authority-gaps.md`](../security-issues/pre-implementation-spec-review-authority-gaps.md)
  for the companion checklist on authority/trust-boundary gaps in the same class
  of document, and
  [`unhandled-outcome-defaults-to-success-bucket.md`](unhandled-outcome-defaults-to-success-bucket.md)
  for the code-level version of "a closed enumeration is missing a member."
