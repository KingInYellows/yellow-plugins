---
title: 'Reactive-Only Upgrade Triggers Miss Sub-Threshold States Silently'
date: 2026-07-17
category: logic-errors
track: bug
problem: 'Re-embed only ran when a store hit a specific error, so corpora under a separate size threshold never upgraded and never errored'
tags:
  [
    silent-failure,
    reactive-error-handling,
    threshold-gated-logic,
    embedding-provenance,
    guard-clause,
    ruvector,
  ]
components: [plugins/yellow-ruvector/commands/ruvector/seed-solutions.md]
---

# Reactive-Only Upgrade Triggers Miss Sub-Threshold States Silently

## Problem

**General pattern first:** when a feature's "upgrade path" is wired to fire
only in reaction to a specific error signal, and a *separate* piece of logic
decides whether the underlying condition that error signal reports on is even
reachable, the two can disagree — the error is a sufficient condition for
running the upgrade, but not a necessary one. Any state that satisfies the
underlying need without also tripping that specific error slips through with
no error, no log, and no upgrade.

**Concrete instance:** `plugins/yellow-ruvector/commands/ruvector/seed-solutions.md`
Step 6 documents ADR-210's embedding-provenance behavior for `ruvector`
0.2.34. Three behaviors are "observed live": legacy (pre-provenance) stores
are write-locked and surface `ERR_LEGACY_STORE_READONLY` on any write, which
this command's own guidance treated as the trigger to unlock and re-embed the
store. Separately, ADR-074's tiered embedder only auto-upgrades a store from
hash-based to full semantic embeddings once the corpus crosses a **50+ doc**
threshold. A freshly-seeded corpus smaller than that threshold is neither a
legacy store (so it never throws `ERR_LEGACY_STORE_READONLY`) nor large
enough to trip the tiered embedder's own auto-upgrade — it is simply seeded,
counted, and reported as a clean success, while every entry stays
hash-embedded. The command's re-embed step was gated entirely behind the
error branch, so this population never ran it.

## Symptoms

- A `/ruvector:seed-solutions` run against a small (sub-50-doc) corpus
  reports all documents seeded successfully, zero failures, zero errors — and
  looks identical in the summary table to a run that reached full semantic
  embedding.
- Paraphrase-style recall queries against the freshly-seeded entries
  underperform silently: hash embeddings only match near-exact string
  overlap, so semantically equivalent but differently-worded recalls (the
  entire point of ADR-210's provenance work) return nothing, with no error
  anywhere in the pipeline to explain why.
- The gap only shows up by inspecting `hooks_stats` or the embedding mode of
  an individual entry after the fact — nothing in the command's own control
  flow asks "did this corpus actually reach full embedding," only "did a
  specific error fire."

## What Didn't Work

Treating `ERR_LEGACY_STORE_READONLY` as equivalent to "this store needs a
re-embed." It is a sufficient trigger (a legacy store definitely needs one),
but the corpus-size threshold is an independent, silent path to the same
underlying need (full semantic embedding) that never surfaces as an error at
all — it's not a failure, it's the tiered embedder correctly deciding "not
enough documents yet" and leaving the corpus in a valid-but-lesser mode by
design. A guard written for one path (react to the error) has no way to
observe the other path's outcome unless it checks explicitly.

## Solution

Run the re-embed step **unconditionally** after Step 5 (seeding) completes,
regardless of whether `ERR_LEGACY_STORE_READONLY` fired:

- The re-embed operation is idempotent — running it against a store that is
  already fully embedded is a cheap no-op, so there is no correctness or
  performance cost to calling it every time instead of only reactively.
- The command's summary table now includes an explicit **embedding
  provenance** line (sourced from `hooks_stats` or the reembed call's own
  output) reporting the resulting mode — hash vs. full semantic — so a
  sub-threshold or otherwise-still-hash-mode result is visible in the output
  instead of indistinguishable from full success.

## Why This Works

Reactive-only remediation is only as complete as the union of every error
condition that can signal "remediation needed." The moment a second,
independent mechanism (here: ADR-074's own threshold-gated auto-upgrade) can
leave the system in the same needs-remediation state without emitting that
error, the reactive trigger has a blind spot by construction — it was scoped
to the error it knows about, not to the underlying condition it exists to
fix. Making the remediation step unconditional (and cheap/idempotent) closes
the blind spot without needing to enumerate every possible silent path into
the fixable state. Reporting the resulting mode explicitly closes the
second half of the gap: even an unconditional fix is only as good as the
visibility into whether it actually reached the desired end state.

## Prevention

- When a remediation or upgrade step is gated behind "if this specific error
  occurs," ask whether the underlying condition the error represents has any
  *other* path into existence that would not throw that error. A
  threshold-gated auto-upgrade, a size cap, a feature flag, or a fallback
  default are all common sources of a silent alternate path.
- Prefer an idempotent, unconditional remediation step over an
  error-triggered one whenever the cost of running it on an
  already-remediated system is negligible — this eliminates the blind spot
  entirely instead of trying to enumerate every trigger condition.
- Never let "the run completed with zero errors" stand in for "the system
  reached the intended end state" in a command's own reported output —
  surface the actual resulting mode/state explicitly so a silently
  incomplete upgrade is visible, not just absent from the error count.

## Update — 2026-07-17 (round 2): a sibling counting bug in the same command

A second review round on the same command found a different bug in the
adjacent durability-verification logic (Step 2/Step 8 in
`seed-solutions.md`): the re-check used `grep -c 'ERROR-FIX:'
.ruvector/intelligence.json` and compared the result to "zero" to detect a
stale-writer clobber. `grep -c` counts **matching lines**, not
occurrences — on a compact, single-line JSON store (the common case for
`intelligence.json`), every entry collapses onto line 1, so `grep -c`
returns `1` regardless of whether the file holds 1 entry or 32. A clobber
that dropped most entries but left at least one `ERROR-FIX:` string
anywhere in the file would report a non-zero, "looks fine" count.

**Fix:** switched to occurrence counting (`grep -o 'ERROR-FIX:' file | wc
-l`), plus capturing an explicit baseline count *before* seeding (Step 2)
and comparing Step 8's re-check against `baseline + seeded`, not just
against zero — the same "don't compare against a fixed constant when the
real expected value is computable" fix that generalizes beyond this one
command.

**General rule, distinct from this doc's main lesson but sharing its root
shape:** a check whose *counting primitive* silently degrades under a
common data shape (single-line/minified files, in this case) can pass
clean while the condition it exists to catch is actually present — the
same "the check ran and reported success, but success was measured
wrong" failure shape as the main lesson above, just at the level of the
counting tool rather than the trigger condition. When verifying a count
in shell, default to an occurrence-counting idiom (`grep -o ... | wc -l`,
or a tool-native count) over `grep -c`, and ask what the file's realistic
shape is (pretty-printed vs. minified/single-line) before trusting a
line-based count as a proxy for an occurrence count.

## Update — 2026-07-18 (round 3): the counting fix itself needed a permissions fix

The round-2 fix above (`grep -o 'ERROR-FIX:' file | wc -l`) shipped
without a `Bash(wc -l:*)` grant in the command's `allowed-tools` —
the permission engine authorizes each piped subcommand independently,
so covering `grep -o` did not implicitly cover `wc -l`. See
`docs/solutions/code-quality/claude-code-command-authoring-anti-patterns.md`
#25 for the general rule (any pipe-shape fix must be re-checked against
the grant list in the same edit).

## Related

- `docs/solutions/logic-errors/bash-pipe-head-exit-code-masking.md` — a
  different flavor of the same root idea: a guard clause that looks like it
  covers a failure mode but structurally cannot fire for it.
- `docs/solutions/logic-errors/iterate-until-clean-loop-stop-condition.md` —
  stop conditions that never trigger for a valid but unanticipated state.
- `docs/solutions/integration-issues/ruvector-worktree-db-symlink.md` — same
  PR, same file's sibling fix (dangling-symlink heal); another case of a
  guard's happy-path condition not covering every real state.
- `docs/solutions/code-quality/claude-code-command-authoring-anti-patterns.md`
  #25 — the grant-per-pipe-stage bug the round-2 counting fix above
  introduced.
