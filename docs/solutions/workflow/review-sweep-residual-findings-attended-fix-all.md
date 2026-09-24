---
title:
  'Unattended review sweeps drop non-safe_auto findings — attended sweeps should
  fix everything found, not just safe_auto items'
date: 2026-09-24
category: workflow
track: knowledge
problem:
  '/review:pr findings that are not safe_auto are never applied or persisted;
  /review:resolve only touches GitHub threads, so an unattended sweep silently
  loses them'
tags:
  - review-sweep
  - review-pr
  - findings-persistence
  - attended-vs-unattended
  - knowledge-compounder
components:
  - plugins/yellow-review/commands/review/sweep-all.md
  - plugins/yellow-review/commands/review/review-pr.md
  - plugins/yellow-review/commands/review/resolve-pr.md
---

## Context

`/review:sweep-all` run over yellow-plugins PRs #840, #843, #853 (2026-09-24).
On PR #840, 9 reviewers produced 10 residual findings — including one P1 at
confidence 100 and two verified-accurate P2 doc errors — and **none** of them
were `safe_auto`, so `/review:pr` applied none of them and persisted none of
them anywhere. `/review:resolve` only reconciles pre-existing GitHub review
threads; it has no mechanism to pick up findings that were never posted as
threads in the first place. In an unattended sweep, every one of those 10
findings would have evaporated with the chat transcript the moment the session
ended.

A full design for fixing this at the infrastructure level (a durable JSONL
findings ledger, a new `/review:triage` command, deterministic fingerprint
dedup, dismissed-finding context injection) has already been researched and
brainstormed in this repo — **this doc intentionally does not duplicate that
material**:

- `docs/research/review-findings-persistence.md` — ~70-source research survey of
  how other tools persist review findings (SARIF fingerprint lifecycle, git
  notes, out-of-tree ledgers, task trackers) plus a GitHits addendum on this
  plugin's own upstream history.
- `docs/brainstorms/2026-09-23-review-findings-ledger-brainstorm.md` — the
  locked design: ledger at
  `$(git rev-parse --git-common-dir)/yellow-review/findings/<pr>.jsonl`, a new
  `/review:triage` command as sole owner, attended = fix everything / unattended
  = safe-only, local-only discovery, deterministic-fingerprint dedup with
  dismissed-context injection, re-verify + prune on close.

That design is not implemented yet. This doc captures the **interim,
already-actionable guidance** for anyone running a sweep before the ledger and
`/review:triage` land.

## Guidance

When running `/review:sweep-all` (or `/review:pr`) **attended** — a human is
present and reviewing the transcript in real time — do not stop at `safe_auto`
findings. Apply every verified finding the review surfaces, regardless of
`autofix_class`. The `safe_auto`/`gated_auto`/`manual` gate exists to protect
_unattended_ runs where no human can catch a bad auto-apply; a present human
already provides that safety function, so gating them too just guarantees the
finding is lost with no compensating safety benefit.

Concretely, during this sweep: PR #840 had all 10 residual findings applied and
pushed in a single commit (doc accuracy fixes, `validate-doc-counts.js` hardened
to fail on missing `SCAN_FILES` entries and to match counts split across wrapped
lines, plus tests) rather than left as `manual`/`gated_auto` residue. PR #843
(16 findings, including several release-process hazards) and PR #853
(doc-accuracy + a stale CI remediation message) followed the same pattern.

## Why This Matters

`/review:resolve`'s contract is GitHub-threads-only by design (GraphQL
`reviewThreads`, `isResolved`/`isOutdated`) — it was never meant to be a general
findings store, and widening it to also parse chat-only findings would conflate
two genuinely different data sources with different lifecycles (that's Key
Decision #2 in the brainstorm). Until the ledger exists, the _only_ way a
non-`safe_auto` finding survives past the end of a sweep session is for someone
to have applied it while a human was still watching. Defaulting an attended
sweep to "fix only what's marked safe" silently reproduces the exact loss the
brainstorm was written to prevent, just one layer up (transcript loss instead of
design gap).

## When to Apply

- Any attended `/review:pr` or `/review:sweep`/`/review:sweep-all` run, today,
  before the ledger + `/review:triage` land.
- Does not apply to unattended/non-interactive sweep invocations — those should
  keep the existing `safe_auto`-only gate until the ledger exists to catch what
  they leave behind.
- Once `/review:triage` ships, re-check this doc against the brainstorm's locked
  decisions — the attended-fix-all behavior is meant to move from "manual
  practice" to the tool's own documented semantics (Key Decision #3), and this
  doc can likely be folded into that command's own docs.

## Examples

- PR #840: an adversarial reviewer's claim that "gt-workflow hooks don't fire on
  Codex" was checked and found **false** (`entrypoint-codex.js` exists); a
  separate claim that "the push hook fails open on an unparseable envelope" was
  checked and found **true** (`run-hook.js`) — both required reading source, not
  trusting the reviewer's confidence score, before deciding what to fix.
- PR #843: release-process findings fixed in the same attended pass included
  `force_publish` unconditionally setting `should_publish=true` (able to
  republish from a moved `main` HEAD), a `gh run list --limit 1` race right
  after merge (fixed by `--commit <sha>` + `gh run watch --exit-status`), the
  bot-created Version PR running no PR CI, and deleting a release tag re-arming
  auto-publish.
