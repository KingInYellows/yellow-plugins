---
title: 'A New Outcome Added to One Producer Must Get a Slot in Every Closed-Enumeration Consumer, or It Silently Lands in "Success"'
date: 2026-07-30
category: code-quality
track: knowledge
problem: 'A new three-state verified/unverified/cannot-verify outcome was added to one producer surface while three downstream closed-enumeration consumers (a verdict/confidence contract, a PASS/FAIL/WARNING template, a Fixed/Skipped/Failed/Aborted bucket count) kept their old two-or-four-way switch, so the new outcome falls through to whichever branch is the default — which was "success"'
tags:
  [
    closed-enumeration,
    producer-consumer-contract,
    silent-misclassification,
    structured-output-contract,
    default-branch,
    yellow-semgrep,
    yellow-council,
  ]
components:
  [
    plugins/yellow-semgrep/agents/semgrep/scan-verifier.md,
    plugins/yellow-semgrep/commands/semgrep/fix-batch.md,
    plugins/yellow-council/agents/review/opencode-reviewer.md,
  ]
---

## Context

A 19-reviewer `/review:pr` pass on PR #676 (yellow-plugins) surfaced three
findings that look unrelated on the file list but share one mechanism:

1. **yellow-semgrep**: `fix.md`'s Step 12 report template and
   `semgrep-conventions/SKILL.md`'s trailer doc were extended from a
   two-state (verified/unverified) to a three-state
   (verified/unverified/**cannot-verify**) outcome and fixed in this PR.
   `scan-verifier.md`'s own PASS/FAIL/WARNING verification template — the
   producer whose output the trailer is supposed to describe — has no slot
   for "cannot verify" at all. `fix-batch.md`'s summary counts commits into
   four buckets (Fixed/Skipped/Failed/Aborted); an unverified commit has no
   bucket of its own, so it silently increments **Fixed**.
2. **yellow-council**: `opencode-reviewer.md`'s file-level contract is a
   `verdict=`/`confidence=`/`summary=` triplet that every exit path is
   supposed to emit (`TIMEOUT`, `UNAVAILABLE`, `ERROR`, plus the real
   verdict). A new `PACK_BYTES` size guard was added ahead of the CLI
   invocation and, before this PR's fix, exited `1` with a stderr-only
   message — no triplet at all, breaking the contract for every consumer
   that reads this file's stdout expecting one of the known lines.

The semgrep and council cases are different bugs by symptom (a missing
enum member vs. a bypassed contract entirely) but the same failure by
mechanism: **a closed enumeration gained a member on the producer side, and
at least one consumer's switch/case still only recognizes the old member
set — so the new member either falls through a `default:`/`else` branch or
never reaches the consumer's vocabulary in the first place.**

## Guidance

When you add a new outcome value to a producer (a new report-template
column, a new verdict trailer, a new size-guard exit path), the fix is not
complete at the producer. Enumerate every consumer that has a closed
switch/case, bucket count, or fixed-cardinality template over that
producer's outcome space, and confirm each one has an explicit slot for
the new member — not a `default:`/`else` that happens to route it
somewhere plausible-looking.

**The check that catches this:** grep the producer's outcome vocabulary
(e.g. `verified|unverified|cannot-verify`, or `verdict=(TIMEOUT|UNAVAILABLE|ERROR|...)`)
across every file that reads or renders it. If a consumer's case list is
shorter than the producer's outcome list, that gap is a defect, not a
simplification — regardless of whether the missing case has ever fired in
practice yet.

**Why "falls through to a plausible default" is worse than "crashes":** a
crash or a validation error is visible immediately. A missing enum member
that defaults into an *adjacent, wrong-direction* bucket — here,
"unverified" landing in **Fixed** rather than in "needs a human to look at
it" — produces a report that looks complete and green while quietly
under-counting the exact class of outcome the new state was created to
surface. The failure is silent specifically because the output shape looks
correct; only the count is wrong.

## Why This Matters

This is the same "audit every dereference in the function, not just the
one named in the finding" discipline documented in
[manifest-generator-value-shape-validation.md](../logic-errors/manifest-generator-value-shape-validation.md)'s
2026-07-16 update, applied to enumerations instead of object fields. It is
distinct from
[multi-doc-schema-rename-drift.md](multi-doc-schema-rename-drift.md),
which is about a field *rename* drifting across docs that redocument the
same name instead of importing one canonical source — this pattern is
about a *new member added* to an existing closed set, where the drift is
an absent case rather than a mismatched name. It is also distinct from the
general "structured partial-result contract" lineage
([bash-to-node-port-drops-fail-closed-and-bounds.md](../security-issues/bash-to-node-port-drops-fail-closed-and-bounds.md))
in that those docs are about a contract being *bypassed* by a new failure
path; the semgrep half of this finding is about the contract being
*followed* everywhere except one consumer's enumeration falling one member
short.

## When to Apply

- Adding a new outcome/status/verdict value anywhere that already has 2+
  downstream readers with their own closed case list (templates, bucket
  counters, switch statements, enum-typed fields).
- Reviewing a PR that extends a producer's vocabulary — search for every
  consumer's case list before approving, not just the producer's own
  template.
- Any bucket/counter whose categories sum to a total used for a pass/fail
  decision (a CI gate, a batch summary) — an unhandled member silently
  inflating the "success" bucket corrupts that decision more dangerously
  than one that inflates an "unknown" bucket.

## Examples

**Bad** (`fix-batch.md`, before fix — illustrative, not verbatim): a commit
that finished in the new "unverified" state has no counter of its own, so
whatever `else`/default branch the summary loop falls into increments
**Fixed** — the batch report shows 12 Fixed / 0 Skipped / 0 Failed and
looks clean, but some of those 12 were never actually confirmed.

**Good**: `fix.md` Step 12 and `semgrep-conventions/SKILL.md`'s trailer
were updated in this PR to add the third `cannot-verify` rendering and
table row alongside `verified`/`unverified` — the two consumers that were
fixed. `scan-verifier.md`'s own template and `fix-batch.md`'s bucket count
were correctly identified as needing the same third slot and were
deferred (not silently left as "fixed elsewhere, so this one is covered
too") — the fix is incomplete until those two land, and the PR's own
disclosure says so rather than claiming full coverage.

**Good** (council, applied in this PR):
`opencode-reviewer.md`'s `PACK_BYTES` guard now emits the full
`verdict=UNAVAILABLE` / `confidence=N/A` / `summary=...` triplet, cleans up
`$OUTPUT_FILE`/`$STDERR_FILE` alongside `$PACK_FILE`, and exits `0` (a
handled non-verdict outcome, not a tool crash) — the size guard is now a
member of the same closed set every other exit path in the file
populates, not a bypass of it.
