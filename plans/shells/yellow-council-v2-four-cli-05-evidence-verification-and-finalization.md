---
spec: plans/specs/yellow-council-v2-four-cli.md
spec-r-ids: [R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13, R14, R15, R16, R17, R18, R19, R20, R21, R22, R23, R24, R25, R26, R27, R28, R29, R30]
depends_on: [yellow-council-v2-four-cli-03-synthesis-bias-mitigation, yellow-council-v2-four-cli-04-quota-and-opencode-routing]
---

# Plan: Evidence Verification + V2 Finalization

## Context

The riskiest and final shell. Tier 1-2 evidence verification makes the
council's citations mechanically checked instead of self-asserted: Tier 1
mode-dependent exact match (committed line for review mode, working tree
with fallback for plan/debug/question modes), Tier 2 fuzzy similarity ≥85
via an optional `rapidfuzz` dependency. Verification classifies findings
into the five-bucket synthesis structure (never gates or discards), rewires
the rubric's "correctness of cited evidence" dimension from self-assessed to
verification-backed (completing the R15 partial started in the synthesis
shell), and is bounded (top-50 per reviewer, concurrent with prompt
construction). The shell closes V2 with the cross-cutting finalization
sweep: skill/doc lockstep, both configuration tables, component counts,
manual e2e scenarios, and the final validation pass across everything the
earlier shells shipped.

**Verification handoff contract (same as the synthesis shell):** `verified`
and `fuzzy-verified` both hold correctness (fuzzy surfaces a qualifier in the
report); `unverified` fails correctness, so the finding cannot be
"well-supported" (R15's AND rule). Bucket ties and verdict-splits follow
R24's precedence exactly: single-reviewer findings split by verification;
verdict-split beats agreement; agreement splits by verification. A Pass B
verdict flip stays a `low-confidence-synthesis` tie
annotation, never a bucket reassignment — flip flag and bucket are
orthogonal. Verification (R25) runs concurrent with prompt construction, but
this shell must gate correctness scoring and bucket assignment on
`verify_finding()`'s return for each finding — Pass A may not finalize a
finding's rubric output ahead of its own verification result. This rewires
the self-assessed placeholder to the real result without changing the
synthesis shell's mechanical combination rule.

## Produces

- `verify_finding()` helper implementing the Tier 1/Tier 2 cascade with
  `verified` / `fuzzy-verified` / `unverified` results
- Optional-dependency handling for the fuzzy matcher (pre-flight import
  check, soft-skip with install hint, doc note)
- Five-bucket synthesis output with the deterministic bucket-assignment
  precedence rule; unverified findings surfaced, never dropped
- Verification-backed rubric correctness dimension (completes R15)
- Bounded verification execution (per-reviewer cap, concurrency with
  synthesis prompt construction)
- Fully synchronized docs: skill synthesis/verification contract, both
  configuration tables, component counts, README/CHANGELOG
- Expanded manual e2e checklist covering all V2 scenarios
- Final cross-cutting validation pass over the assembled V2
- Carried follow-ups F1-F4 (see "Carried follow-ups")

## Consumes

- Synthesis pipeline with rubric scoring and bucket structure to reorganize
  (from Shell yellow-council-v2-four-cli-03-synthesis-bias-mitigation)
- QUOTA_EXHAUSTED handling and OpenCode routing, needed for the e2e
  checklist and final doc sweep (from Shell
  yellow-council-v2-four-cli-04-quota-and-opencode-routing)
- Council mode dispatch (review / plan / debug / question) that Tier 1
  keys its lookup target on (from existing codebase)

## Covers Spec Requirements

- R15 (partial: correctness-dimension-verification-wiring)
- R22
- R23
- R24
- R25
- R26
- R27
- R28
- R29
- R30

## Carried follow-ups (from PR #948 review, 2026-09-30)

Deferred out of shell 03. Each is a step below; do not drop them at expand
time.

- **F1 — synthesis library location (decide first).** `council.md` is ~3,000
  lines, far past the 500-line command ceiling (RULE 21 only warns), and
  carries the Step 5b helper library (`council_normalize_text`,
  `council_extract_fenced`, `council_assign_labels`, `council_fence_block`)
  inline between the
  `# >>> council-synthesis-lib` markers. `verify_finding()` and the five-bucket
  logic would add more. Decide — keep inline (extraction-tested by
  `tests/synthesis.bats`) or move to a shipped plugin lib/references file the
  fences source — and record the choice in `plugins/yellow-council/CLAUDE.md`.
  Moving it changes how every Step 5 fence and `tests/lib/extract-synthesis-lib.bash`
  load the helpers. If moved, the library is sourced directly from markdown
  fences under the user's login shell (often zsh), so it must also be classified
  under the CONTRIBUTING.md "Bash and zsh" tier contract (Tier 4 if sourced
  directly), registered in `scripts/shell-compat-config.json`, given a
  `tests/shell-compat/drivers/<plugin>--<lib>.sh` driver if Tier 4, and pass
  `pnpm test:shell-compat` and `pnpm validate:shell-compat`.
- **F2 — Step 7 heredoc.** Step 7 still carries `SYNTHESIS_MD` in a quoted
  heredoc (`<<'__EOF_COUNCIL_SYNTHESIS__'`). Shell 03 only escapes that
  delimiter in 5b input and in 5e's quoting rule; a synthesizer-authored
  (paraphrased) line could still reproduce it and run the rest as shell.
  Stage `SYNTHESIS_MD` through `Write` into a fresh
  `mktemp -d /tmp/council-synth-XXXXXX` created and owned by Step 7, and `cat`
  it from there, like 5a does for reviewer text. Keep the `council-synth-`
  prefix so the existing 5a stale sweep reclaims an orphan.
  Do not reuse the 5e staging dir: 5e runs `rm -rf -- "$SYNTH_DIR"` right
  after printing the label map, before Step 7, so nothing is left to reuse
  (unless 5e is deliberately changed to stop deleting it, which would move
  cleanup ownership and is out of scope here). Each Bash block is a fresh
  subprocess, so a `trap` set right after `mktemp -d` would fire when that
  block exits, before the separate `Write` call can stage the file. Use a
  cross-call lifecycle instead: (1) one block runs `mktemp -d` with no trap,
  writes a random `.token` file into the dir as 5a does, and prints the path;
  (2) `Write` stages `SYNTHESIS_MD` there; (3) a later block installs the
  `trap` (removing the dir on every exit of that block), then `cat`s the file
  and runs the rest of Step 7. The path crosses from one Bash process through
  model-controlled substitution into `Write`, `cat` and `rm -rf`, so every
  block that reads, writes or deletes it first re-validates it: the path
  matches `/tmp/council-synth-*` with no `..` and no further `/`, is not a
  symlink, is owned by the current user (`-O`), and its `.token` matches the
  token from (1). Refuse and stop on any mismatch; never delete on name alone.
  Cleanup is best effort across calls. If `Write` fails, the block (3) trap and
  the validated `rm -rf -- "<dir>"` run when the orchestrator is still running.
  If the run is cancelled or aborts between (1) and (3), the orchestrator
  cannot run any cleanup, so the staged findings can remain in the 0700 dir
  until the next run's 5a sweep removes it once it is older than 24 hours.
  Document that window (in the Step 7 prose and the council.md failure-mode
  table next to the 5a-5e row); do not promise cleanup after cancellation
  unless a cancellation-surviving mechanism is added.
- **F3 — unclosed code fence.** In `council_normalize_text`, an opening fence
  with no closing fence passes every remaining line of that reviewer's text
  through unnormalized (identity and style signal survive). Buffer fenced
  lines and, at end of input, re-process an unclosed fence as ordinary text,
  or cap it; add a golden case.
- **F4 — bare identifiers lose edge underscores.** `strip_emph` strips
  leading/trailing `*`/`_` runs from any non-path word, so bare `__init__`,
  `_private_fn` or `*ptr` in prose become `init`, `private_fn`, `ptr` — which
  can break a finding's claim text that a reader relies on. F4 applies only to
  the synthesis-side normalized copy; `verify_finding()` must compare the
  verbatim cited excerpt against the source line (R22), so do not run F4 (or any
  other normalizer pass) on the excerpt passed to verification. Rule: `*` runs
  strip only when the same-length run wraps the word or
  phrase on both sides (`**important**`, `*x*`); an unpaired leading or
  trailing `*` (`*ptr`) is kept. `_`/`__` runs strip only when they wrap a
  multi-word phrase (`__two words__`); a single word wrapped in underscore
  runs (`__init__`, `_x_`, `__important__`) is treated as an identifier and
  kept, as is any unpaired edge underscore (`_private_fn`). Underscores inside
  a word (`snake_case`) are never touched. `__init__` and `__important__` are
  syntactically identical, so no rule can keep one and strip the other; keeping
  both is the safe side (a lost identifier breaks evidence, a kept emphasis
  marker only leaves style). Golden cases: `__init__` kept,
  `_private_fn` kept, `*ptr` kept, `**important**` stripped, `__two words__`
  stripped, `snake_case` untouched. `strip_emph` works per whitespace token, so
  multi-word pairing needs phrase-level state: `strip_words` must track an open
  run across tokens and strip it only when a matching closing run arrives.

## Implementation Steps (High-Level)

0. **Synthesis library location (F1)** — make and record the decision before
   any Step 5 code is added; if moving, do the move as its own step and satisfy
   F1's shell-compat requirements. Whether the library moves or stays inline,
   Steps 1 and 7 edit fenced Bash in `council.md`, so `pnpm validate:shell-compat`
   and `pnpm check:shell-parse` (parses the edited fenced blocks under bash and
   zsh) must pass for this shell in both cases.
1. **Normalizer fixes (F3, F4)** — implement F3 and F4 in
   `council_normalize_text` per "Carried follow-ups", with their golden cases.
2. **Verification helper** — Tier 1 mode-dependent exact match with the
   skip-to-Tier-2 rule for unknown/non-checkout contexts; Tier 2 fuzzy
   ratio ≥85; three-state result.
3. **Optional dependency handling** — import probe, soft-skip with warning,
   documented as optional.
4. **Five-bucket synthesis reorganization** — apply the deterministic
   precedence rule (single-reviewer split by verification; verdict-split
   beats agreement; agreement split by verification); surface unverified
   claims visibly.
5. **Rewire the rubric correctness dimension** — consume verification
   results instead of self-assessment, completing the coupling that kept
   this phase in V2.
6. **Bound the cost** — per-reviewer verification cap and concurrency with
   synthesis prompt construction.
7. **Step 7 report staging (F2)** — implement F2's cross-call staging
   lifecycle per "Carried follow-ups"; keep the Step 7 appendix loop untouched
   (`scripts/validate-council-roster.js` Rule D1).
8. **Finalization sweep** — skill contract, both configuration tables,
   component counts and README/CHANGELOG, manual e2e scenarios (quota ETA,
   lineage warning, tie presentation, single-pass bypass, rubric output,
   verification hit/miss paths), verify every shipped PR carried its
   changeset, and run the full validation suite end-to-end, including
   `pnpm validate:shell-compat` and `pnpm check:shell-parse`.

## Open Questions

- F1: keep the synthesis helper library inline in `council.md` or move it to a
  shipped plugin lib/references file. Decide in Step 0, before any Step 5 code.
