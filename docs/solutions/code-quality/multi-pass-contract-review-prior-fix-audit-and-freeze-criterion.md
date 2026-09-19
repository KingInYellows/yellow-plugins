---
title:
  'By the Fourth Review Pass on One Contract, a Third of the Findings Were
  Produced by the Previous Passes — Audit the Prior Fix Set Before Looking for
  New Defects, and Freeze Only When That Bucket Is Empty'
date: '2026-09-11'
category: 'code-quality'
track: 'knowledge'
problem:
  'A docs-only contract set went through four multi-persona review passes; pass
  four returned 31 findings, of which roughly a third were traceable to pass one
  to three — one decision propagated to some sites and not others, three prior
  fixes applied at the cited line only, and two defects in the solution docs the
  previous pass had written — so a large share of each pass budget bought
  re-discovery rather than new coverage, and no criterion existed for when the
  document was done'
tags:
  - multi-pass-review
  - review-economics
  - fix-site-derivation
  - stopping-rule
  - contract-authoring
  - process
components:
  - docs/yellow-jules/contract-v1.md
  - plans/specs/yellow-jules-integration.md
  - plugins/yellow-review/commands/review/review-pr.md
---

# By the Fourth Pass, a Third of the Findings Came From the Earlier Passes

## Context

PR #793 was a docs-only contract set — a spec, an 800-line provider-CLI
contract, a capability matrix, a fixtures document, and four shell files — that
received four multi-persona `/review:pr` passes. Passes one through three each
ended with a fix commit. Pass four returned 31 findings (15 P1, 16 P2).

Classifying those findings by **origin** rather than by severity or persona
gives a sharper picture than the severity table:

| Origin                                            | Count | Example                                                                                                                                                                       |
| ------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One earlier decision, incompletely propagated     | 7     | The PR2 to PR3 move of the mutating subcommands, still encoded in a legend, a flag row, two requirements, a CI validator, a positionally-ordered test split, and a build list |
| A prior pass's fix applied at the cited line only | 3     | The identifier-allowlist row split from round 1; an MVP criterion corrected in the spec but not the contract; a fenced-set enumeration still missing one field                |
| Defects in the solution docs pass three wrote     | 2     | A dead commit citation; a remedy the named command cannot perform                                                                                                             |
| Genuinely new surface                             | ~19   | The silent-failure and adversarial clusters                                                                                                                                   |

Roughly a third of a pass's budget bought re-discovery. That ratio, not the
severity mix, is the signal worth acting on.

## The Three Ways a Fix Fails to Land

### 1. The fix is applied where the reviewer pointed

A reviewer cites one line because that is where they noticed the defect, not
because it is the defect's extent. Round one found that one allowlist table row
validated `pullRequest.url` and `SessionResource.url` under a single rule
appropriate to only the first, and the row was split. Round four found the split
half-done: the `pullRequest.url` row still named `SessionResource.url` in its
citation column, and the new display-only row's citation cell had been filled
with the bare word `runtime` — copied from the neighboring rows, where `runtime`
is correct because those identifiers are minted locally, and meaningless for a
vendor-supplied field that needs a type citation.

The same shape produced the MVP-criterion finding: the criterion was corrected
in the spec and left standing in the contract that restates it.

**Practice:** for every fix, write down its site set before editing — every
restatement, every table column, every sibling document — and treat the
reviewer's line number as one member of that set. This is the intra-file and
inter-file propagation problem of
[`doc-fix-mechanical-verification-gap.md`](./doc-fix-mechanical-verification-gap.md),
recurring at the scale of a whole contract.

### 2. The principle is written down and the enumeration stays by-example

The most instructive finding. A prior pass had already learned that untrusted
input channels must be enumerated by who can write them, not by listing the
cases someone remembered — a lesson recorded in this project's memory from PR
#712. The contract's own Rule 7 states it verbatim: _"The fenced set is defined
by write access, not by example."_

The list that follows that sentence was still an example list. It omitted
`GeneratedFile.path`, a vendor-controlled string the collect path renders and
persists into a manifest. The principle had been internalized as prose and never
executed as a procedure.

**Practice:** when a rule states a derivation ("defined by X, not by example"),
the review check is to _run the derivation_ — here, list every field of every
vendor response type and ask which are vendor-writable — and diff its output
against the enumeration in the document. A stated principle sitting above a
hand-written list is the strongest available signal that the list was never
derived.

### 3. The decision is propagated by name

Covered in detail in
[`phase-boundary-move-orphaned-triggers-and-derived-artifacts.md`](./phase-boundary-move-orphaned-triggers-and-derived-artifacts.md):
a decision to move capabilities between phases has sites that never mention the
moved capability, so a grep-driven propagation commit closes only a fraction of
them.

## Restructure the Pass, and Give It a Freeze Criterion

**Open each pass with a prior-fix audit, before the persona fan-out.** Take the
previous pass's fix commits and, for each fix, re-derive its site set and check
each site. This is cheap, it is mechanical, and it removes the findings that
would otherwise consume reviewer attention that could have gone to new surface.
It also catches the partial fixes that reviewers, reading a diff rather than
comparing against the previous round's findings, tend to miss entirely.

**Freeze on origin, not on severity.** The natural stopping rules — "no P1s
left," "only style findings remain" — say nothing about whether the document is
converging. A pass whose findings are all new surface is a pass that found the
document's real defects; a pass where a third of findings trace to earlier
passes is a pass telling you the fix process is leaking.

> Freeze the contract when a full pass returns **no finding whose origin is a
> previous pass's fix or decision**. Until then, the previous passes are still
> generating work, and another pass is warranted regardless of severity mix.

This complements rather than replaces the budget guidance in the
`pr664-resolve-loop-fix-begets-finding` auto-memory note: that note is about
fixes introducing _new_ defects on _new_ surface (a temp file without cleanup, a
validator with a loose fallback), and its advice is to audit what the fix added.
This one is about fixes not reaching the surface they were supposed to cover,
and its advice is to audit what the fix should have touched and did not. Both
apply; they catch different halves.

## When to Apply

- Any artifact heading into its third or later review pass, especially a
  multi-document contract or spec where one statement is restated in several
  places.
- Before declaring a spec, contract, or schema frozen — classify the last pass's
  findings by origin and check the prior-fix bucket is empty.
- When a review round produces a dedicated "propagate decision D" commit: that
  commit is the next round's first audit target, not a closed item.
