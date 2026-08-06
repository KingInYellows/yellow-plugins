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

---

## Update — 2026-08-02

During `/workflows:expand-shell` plan expansion (not code review) for
yellow-council V2 shell 01, a repo pattern survey verifying the shell's own
premise ("remove a codex special-case from council's parser") found a live
instance of this failure family in production, of a variant this doc had
not yet covered.

**The variant:** unlike PR #676's cases above (a *new* enum member added
later, consumer switch/case not extended to match), this is a producer
(`codex-reviewer`) that **never conformed to an existing consumer contract
from birth** — silently, since the reviewer was added, across **two
independent consumers**, via **two different mechanisms**:

1. `plugins/yellow-council/commands/council/council.md`'s
   `parse_reviewer_return` (`:236-253`) is already uniform across all three
   reviewers — it greps the same 6 fixed keys (`verdict=`, `confidence=`,
   `summary=`, `fenced_output_path=`, the `findings_block_begin/end` block)
   for every reviewer, no codex-specific branch exists. But `codex-reviewer`
   has never emitted those keys, so every Codex return falls through to the
   `"${verdict:-ERROR}"` default at `council.md:251` — the Codex leg of
   `/council` has been silently degraded to `verdict=ERROR` in production.
2. `plugins/yellow-review/commands/review/review-pr.md` Step 6.0
   (`:563-574`) maintains a hand-written "legacy prose normalizer"
   allowlist that converts pre-Wave-2 agents' prose findings into the
   compact JSON schema before Step 1 validates required fields.
   `codex-reviewer` is not on that list, so Step 1 (`:594-608`) drops its
   return outright as malformed — `/review:pr` has also been silently
   discarding every Codex finding.

Both gaps produce plausible-looking output (an `ERROR` verdict reads as a
legitimate outcome, not a parse failure; a missing finding reads as "Codex
found nothing") and were invisible to CI and to normal code review, because
neither consumer ever crashes or errors loudly — same "falls through to a
plausible default" shape this doc's guidance already names, but here the
producer never conformed even once, rather than a later addition breaking
an established contract. As of this writing (2026-08-02) the remediation is
scoped in a new plan (this session's plan-expansion output) but not yet
landed — treat this as the discovered-state record, not a fixed bug.

**How it was found:** neither gap surfaced via `/review:pr` or manual code
review. Both were found because a `/workflows:expand-shell` pattern-survey
subagent was dispatched to verify a shell's premise ("does a codex
special-case exist to remove?") and grepped the actual parser instead of
trusting the shell's description — the same grep that proved the shell's
premise wrong also revealed the production bug. Plan-expansion premise
verification is a detection surface for this failure class, distinct from
and complementary to code review: it fires whenever a plan references an
existing integration/contract, not only when code changes.

**Added guidance — checking for the "never conformed" variant:**

- When a new producer (reviewer, agent, tool) is added, grep every
  documented consumer's parse contract (fixed-key `grep`, allowlist,
  switch/case) for that producer's exact name/output shape — don't infer
  conformance from "the command ran and produced plausible-looking text."
- A conformance check that feeds each producer's real/sample output
  through each consumer's parser and asserts the expected fields populate
  is the check that catches this; "runs without erroring" does not, since
  the silent fallback never throws.
- Enumerate producer × consumer pairs directly from source when auditing
  for this class — gaps present since a producer's introduction commit
  generate no diff for review to have ever caught.
- Treat "producer added, consumer allowlist/keys not updated" as a
  distinct search target from ordinary logic bugs — it lives in the
  parser/allowlist, not the producer's own code.

**Components (this Update):**
`plugins/yellow-council/commands/council/council.md`,
`plugins/yellow-review/commands/review/review-pr.md`,
`plugins/yellow-codex/agents/review/codex-reviewer.md`.

---

## Update — 2026-08-03

The remediation scoped in the previous Update landed in PR #695
(`agent/feat/yellow-council-v2-codex-contract-normalization`):
`codex-reviewer.md` was normalized onto the 6-key contract
(`verdict=`/`confidence=`/`summary=`/`fenced_output_path=`/
`findings_block_begin`...`findings_block_end`) already used by
`gemini-reviewer.md`/`opencode-reviewer.md`, and both downstream consumers
named above (`council.md`'s `parse_reviewer_return`, `review-pr.md`'s Step
6.0 allowlist) were fixed in the same PR to stop silently discarding
Codex's return.

A follow-up 19-persona review + live Codex CLI smoke test of that same PR
found five residual instances of the identical failure mechanism — a
missing, absent, or malformed input silently producing a plausible-looking
"nothing to report" or default value instead of a visible error — inside
`codex-reviewer.md`'s own Step 6 parsing logic. Items 1-2 below were fixed
in the first round of this PR's review-comment resolve pass (commit hashes
are deliberately not cited — the branch is restacked repeatedly, so
pre-restack SHAs go dangling); items 3-5 in the second round:

1. **Fixed.** No `command -v jq` guard (mirrors the existing `command -v
   codex` check in Step 1) — jq's absence degrades Step 6 to a plausible
   `verdict=UNKNOWN`/no-findings return indistinguishable from a real
   review. Now guarded at `codex-reviewer.md:98-104` (Step 1, before the
   paid Codex invocation) and `codex-reviewer.md:377-384` (Step 6,
   belt-and-braces re-check).
2. **Fixed.** No `[ -s "$OUTPUT_FILE" ]` existence/non-empty guard before
   Step 6 parses it — a stale or missing handoff file produced the same
   plausible-looking empty-findings/`UNKNOWN` result, mirroring
   `gemini-reviewer.md:166`'s equivalent `PACK_FILE` guard, which
   `codex-reviewer.md` lacked. Now guarded at `codex-reviewer.md:385-392`.
3. **Fixed.** The all-or-nothing FIELDS `jq` extraction could diverge from
   the partial-output FINDINGS extraction on a single malformed field,
   silently disabling the P1-count REJECT escalation while the findings
   text still looked complete — no `jq empty "$OUTPUT_FILE"` upfront
   validity check existed to short-circuit to `verdict=ERROR` before
   either extraction ran. Now guarded at `codex-reviewer.md:402` (fails
   closed to `verdict=ERROR` before any extraction).
4. **Fixed.** `jq`'s stderr was suppressed (`2>/dev/null`) on every field
   extraction, conflating "malformed JSON" with "valid JSON, field
   absent" — the resulting warning text misdirected triage toward the
   wrong root cause. The `jq empty` gate at `codex-reviewer.md:402` now
   captures and surfaces the real jq parse error before the lenient
   extractions run, so the two causes are distinguishable.
5. **Fixed.** `OVERALL_CONFIDENCE_SCORE` had no numeric-validation guard,
   unlike the adjacent `P1_COUNT` guard — malformed input could silently
   produce a confidently-wrong `HIGH` via string comparison in the `awk`
   threshold call. Now guarded at `codex-reviewer.md:545-547` (decimal
   case guard plus an in-awk 0-1 range check, defaulting to LOW).

All five were open findings as of the review that surfaced them
(2026-08-03). Items 1-2 were fixed in PR #695's first resolve round;
items 3-5 in its second, on 2026-08-06. The lesson
stands: fixing the contract-normalization bug did not, on its own, fix
the fallback-safety gaps in the new parsing logic that replaced the old
one; the same "silently degrade to plausible default" mechanism this doc
tracks simply moved from "producer never emits the contract" (previous
Update) to "producer's own parser has no guard against malformed/missing
input" — inside code written to close the first gap, and closing those
took two further review rounds after the fix commit claimed resolution.

**Added guidance — a fix for a "never-conformed" gap can reintroduce the
same mechanism internally:** when the fix for a never-conformed-consumer
gap is "make the producer parse a new structured format," audit the new
parsing code itself for the same class of gap — missing
tool-availability checks, missing existence/non-empty guards on handoff
files, and suppressed parser-error output are the concrete instances found
here. Closing the contract at the interface does not guarantee the new
implementation's own error paths don't default to a plausible-looking
success state.

**Components (this Update):**
`plugins/yellow-codex/agents/review/codex-reviewer.md`.
