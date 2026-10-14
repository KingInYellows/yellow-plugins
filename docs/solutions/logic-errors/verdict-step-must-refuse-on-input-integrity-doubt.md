---
title: 'A Report or Verdict Step Must Refuse, Not Warn, When Its Input Artifact Is Doubtful'
date: 2026-10-14
category: logic-errors
track: knowledge
problem: 'An eval report command warned about a doubtful input, then went ahead: it overwrote human judgements, scored mixed, partial or duplicated results, and counted parse errors as misses'
tags:
  - fail-closed
  - eval-harness
  - verdict
  - provenance
  - completeness
  - silent-failure
  - tsv
  - jev-category-eval
components:
  - plugins/yellow-core/lib/jev-category-eval.py
  - plugins/yellow-core/tests/jev-category-eval.bats
---

# A Report or Verdict Step Must Refuse, Not Warn, When Its Input Is Doubtful

## Context

`jev-category-eval.py` has two stages. `run` sends the holdout corpus to a
model and writes a results file (JSONL). `report` reads that file offline,
prints agreement numbers and the pre-registered verdict, and writes
`disagreements.tsv` for a human to judge.

A `/review:pr` pass on PR #1192 found that `report` met doubtful input in six
ways and, each time, warned or guessed and carried on. All six are fixed in
that PR, and each guard has a bats case that fails when the guard is removed
(checked by mutation). Function and test names below are stable; grep them
instead of trusting any line number.

## Guidance

A command that emits a verdict, or that writes a file a human edited, exits
non-zero before the write or the number when its input is in doubt. A warning
printed above a number is not a gate: the number still gets used. Where the
honest answer is "not enough data", the verdict line says so and gives the
reason (`INSUFFICIENT-DATA (...)`).

| Doubt | What ships |
|---|---|
| Existing `disagreements.tsv` is not a private regular file you own, and no `--review` was given | `report` exits 2 before the write. It used to warn, ignore the file, and overwrite it with blank judgements in the same run. |
| The same document path appears twice in the results | `load_rows` exits 2 (`repeats path`). Concatenated runs no longer double-count holdout pairs. |
| Rows carry a `criteria_sha` that differs from the current criteria file | Mixed shas in one results file exit 2. A single sha that differs from the current file gives `INSUFFICIENT-DATA`, because the protocol loaded here is not the one the run used. |
| The run was partial | `run` ends the results file with a summary record (eligible, written, limit, aborted, skipped). `report` withholds the verdict when there is no summary, the run aborted, `--limit` was used, or the counts do not match. |
| A response body is not an answer (non-JSON, oversized, no `answers.category.choice`) | Status `error:bad-response`. It counts toward the abort streak, blocks the verdict, and `run` exits 1 when no row is `ok`. |
| A well-formed choice that is outside the criteria | Status `invalid`, scored as a Jev miss. This is the only meaning `invalid` keeps. |
| A human judgement no longer matches a listed row | Judgements are keyed by `(path, folder, jev)` and never dropped. A changed one is kept as `kind=stale`; one whose document has no `ok` row is kept as `kind=orphan`. |

Two related rules fall out of the same table:

- Match whole strings. Every row, criteria, summary and review validator goes
  through one `_is(pattern, value)` helper built on `fullmatch`, so a value
  ending in a newline cannot pass and inject a TSV row. This is the bug in
  `docs/solutions/logic-errors/regex-dollar-anchor-trailing-newline-bypass.md`,
  and it recurred in a new script.
- Keep error classes apart. "The model gave a wrong answer" and "there was no
  answer" must be different statuses, or every transport or parsing failure
  quietly lowers the score.

## Why This Matters

The verdict is the only output anyone acts on. Each doubt above changes it
without any visible sign: a partial file looks like the full corpus, a
mismatched sha looks like the same experiment, and a parse error looks like a
miss. The overwrite case destroyed hand-written work, which cannot be
recomputed.

## When to Apply

Any report, scorer or promotion step that reads an artifact an earlier run
wrote, especially one that also rewrites a human-edited file. Ask of each
input: is it the whole set, the unique set, and from the same protocol? Then
refuse if the answer is not yes.

## Examples

`plugins/yellow-core/tests/jev-category-eval.bats` has one case per guard,
for example `report: no verdict for results from another criteria file or a
partial run`, `report: keeps orphaned judgements and protects an existing
judged TSV` and `run: a body that is not an answer is error:bad-response, not
invalid`.

## Related

- `docs/solutions/logic-errors/regex-dollar-anchor-trailing-newline-bypass.md`:
  the `re.match` plus `$` trailing-newline bug, repeated in this script's row
  validators before the `_is` helper.
- `docs/solutions/code-quality/unhandled-outcome-defaults-to-success-bucket.md`:
  the related pattern of an unrecognised outcome landing in the success bucket.
