---
spec: plans/specs/yellow-council-v2-four-cli.md
spec-r-ids:
  [
    R1,
    R2,
    R3,
    R4,
    R5,
    R6,
    R7,
    R8,
    R9,
    R10,
    R11,
    R12,
    R13,
    R14,
    R15,
    R16,
    R17,
    R18,
    R19,
    R20,
    R21,
    R22,
    R23,
    R24,
    R25,
    R26,
    R27,
    R28,
    R29,
    R30,
  ]
depends_on:
  [
    yellow-council-v2-four-cli-03-synthesis-bias-mitigation,
    yellow-council-v2-four-cli-04-quota-and-opencode-routing,
  ]
---

# Plan: Evidence Verification + V2 Finalization

## Context

The riskiest and final shell. Tier 1-2 evidence verification makes the council's
citations mechanically checked instead of self-asserted: Tier 1 window match
through `quote-ground.sh batch` (the cited line plus or minus 3 on the
working-tree file, after redaction and whitespace normalization; the helper
takes no ref, so a caller that needs a committed line checks that ref out
first, and contexts with no checkout skip to Tier 2), Tier 2 fuzzy similarity ≥85 via an optional
`rapidfuzz` dependency. Verification classifies findings into the five-bucket
synthesis structure (never gates or discards), rewires the rubric's "correctness
of cited evidence" dimension from self-assessed to verification-backed
(completing the R15 partial started in the synthesis shell), and is bounded
(top-50 per reviewer, concurrent with prompt construction). The shell closes V2
with the cross-cutting finalization sweep: skill/doc lockstep, both
configuration tables, component counts, manual e2e scenarios, and the final
validation pass across everything the earlier shells shipped.

**Verification handoff contract (same as the synthesis shell):** `verified` and
`fuzzy-verified` both hold correctness (fuzzy surfaces a qualifier in the
report); `unverified` fails correctness, so the finding cannot be
"well-supported" (R15's AND rule). Bucket ties and verdict-splits follow R24's
precedence exactly: single-reviewer findings split by verification;
verdict-split beats agreement; agreement splits by verification. A Pass B
verdict flip stays a `low-confidence-synthesis` tie annotation, never a bucket
reassignment — flip flag and bucket are orthogonal. Verification (R25) runs
concurrent with prompt construction, but this shell must gate correctness
scoring and bucket assignment on `verify_finding()`'s return for each finding —
Pass A may not finalize a finding's rubric output ahead of its own verification
result. This rewires the self-assessed placeholder to the real result without
changing the synthesis shell's mechanical combination rule.

## Produces

- `verify_finding()` helper implementing the Tier 1/Tier 2 cascade with
  `verified` / `fuzzy-verified` / `unverified` results
- Optional-dependency handling for the fuzzy matcher (pre-flight import check,
  soft-skip with install hint, doc note)
- Five-bucket synthesis output with the deterministic bucket-assignment
  precedence rule; unverified findings surfaced, never dropped
- Verification-backed rubric correctness dimension (completes R15)
- Bounded verification execution (per-reviewer cap, concurrency with synthesis
  prompt construction)
- Fully synchronized docs: skill synthesis/verification contract, both
  configuration tables, component counts, README/CHANGELOG
- Expanded manual e2e checklist covering all V2 scenarios
- Final cross-cutting validation pass over the assembled V2
- Carried follow-ups F1-F4 (see "Carried follow-ups")

## Consumes

- Synthesis pipeline with rubric scoring and bucket structure to reorganize
  (from Shell yellow-council-v2-four-cli-03-synthesis-bias-mitigation)
- QUOTA_EXHAUSTED handling and OpenCode routing, needed for the e2e checklist
  and final doc sweep (from Shell
  yellow-council-v2-four-cli-04-quota-and-opencode-routing)
- Council mode dispatch (review / plan / debug / question) that Tier 1 keys its
  lookup target on (from existing codebase)
- `plugins/yellow-core/lib/quote-ground.sh batch` is the Tier 1 check. The
  yellow-core catalog dependency is added in the later shell 05 PR.

## Covers Spec Requirements

- R10 (partial: F3/F4 normalizer edge cases; the rest shipped in shell 03)
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

Deferred out of shell 03. Each is a step below; do not drop them at expand time.

- **F1 — synthesis library location (decide first).** `council.md` is ~3,000
  lines, far past the 500-line command ceiling (RULE 21 only warns), and carries
  the council.md Step 5b helper library (`council_normalize_text`,
  `council_extract_fenced`, `council_assign_labels`, `council_fence_block`)
  inline between the `# >>> council-synthesis-lib` markers. `verify_finding()`
  and the five-bucket logic would add more. Decide — keep inline
  (extraction-tested by `tests/synthesis.bats`) or move to a shipped plugin
  lib/references file the fences source — and record the choice in
  `plugins/yellow-council/CLAUDE.md`. Moving it changes how every council.md
  Step 5 fence and `tests/lib/extract-synthesis-lib.bash` load the helpers. If
  moved, the library is sourced directly from markdown fences under the user's
  login shell (often zsh), so it must also be classified under the
  CONTRIBUTING.md "Bash and zsh" tier contract (Tier 4 if sourced directly),
  registered under `tier4Libraries` in `scripts/shell-compat-config.json`
  (`tier3Libraries` only if every fence sources it through the
  `bash /dev/fd/3 3<<'TAG'` wrapper), given a
  `tests/shell-compat/drivers/<plugin>--<lib>.sh` driver if Tier 4, and pass
  `pnpm test:shell-compat` and `pnpm validate:shell-compat`. Whichever way F1
  goes, update `plugins/yellow-council/CLAUDE.md` where it says `synthesis.bats`
  extracts the Step 5b library "between the `council-synthesis-lib` markers",
  and `tests/lib/extract-synthesis-lib.bash`'s header comment: both go stale
  when the library moves.
- **F2 — council.md Step 7 heredoc.** council.md Step 7 still carries
  `SYNTHESIS_MD` in a quoted heredoc (`<<'__EOF_COUNCIL_SYNTHESIS__'`). Shell 03
  only escapes that delimiter in council.md Step 5b input and in Step 5e's
  quoting rule; a synthesizer-authored (paraphrased) line could still reproduce
  it and run the rest as shell. Stage `SYNTHESIS_MD` through `Write` into a
  fresh `mktemp -d /tmp/council-synth-XXXXXX` created and owned by council.md
  Step 7, and `cat` it from there, like Step 5a does for reviewer text. Keep the
  `council-synth-` prefix so the existing Step 5a stale sweep reclaims an
  orphan. Do not reuse the Step 5e staging dir: Step 5e runs
  `rm -rf -- "$SYNTH_DIR"` right after printing the label map, before council.md
  Step 7, so nothing is left to reuse (unless Step 5e is deliberately changed to
  stop deleting it, which would move cleanup ownership and is out of scope
  here). Each Bash block is a fresh subprocess, so a `trap` set right after
  `mktemp -d` would fire when that block exits, before the separate `Write` call
  can stage the file. Use a cross-call lifecycle instead: (1) one block runs
  `mktemp -d` with no trap, writes a random `.token` file into the dir as Step
  5a does, and prints the complete destination path, `<dir>/synthesis.md` (one
  fixed file name), not just the directory, plus the token value on a separate
  labelled line, which the orchestrator carries as a literal into block (3) as
  Step 5a does (shell variables do not survive, and reading the expected token
  from the same untrusted dir would make the check vacuous); (2) `Write` stages
  `SYNTHESIS_MD` to exactly that printed path, with no other child name and no
  appended segments; (3) a later block first validates the dir and token
  (below), and only then installs the `trap` (removing the dir on every exit of
  that block), so a rejected path never reaches `rm -rf`. The trap body repeats
  the dir validation before deleting. Only after the trap is armed does the
  block validate the destination file and `cat` it, then run the rest of
  council.md Step 7, so a failed or missing `Write` still removes the validated
  dir. The path crosses from one Bash process through model-controlled
  substitution into `Write`, `cat` and `rm -rf`, so every block that reads or
  deletes it first re-validates the dir: it matches `/tmp/council-synth-*` with
  no `..` and no further `/`, is not a symlink, is owned by the current user
  (`-O`), and its `.token` matches the token from (1). Block (3) also validates
  the file before reading it: the destination is exactly `<dir>/synthesis.md`, a
  regular file (`-f`), not a symlink (`! -L`), and owned by the current user
  (`-O`). Refuse and stop on any mismatch; never delete on name alone. `Write`
  is not path-scoped at runtime, so shell validation cannot stop a model that
  deliberately writes elsewhere. The guarantee is narrower: nothing destructive
  trusts a relayed path, and a stray write outside the validated file is never
  read or deleted. The real mitigation for that is a `Write` deny rule; document
  this residual. Cleanup is best effort across calls. If `Write` fails, the
  block (3) trap and the validated `rm -rf -- "<dir>"` run when the orchestrator
  is still running. If the run is cancelled or aborts between (1) and (3), the
  orchestrator cannot run any cleanup, so the staged findings can remain in the
  0700 dir until the next run's Step 5a sweep removes it once it is older than
  24 hours. Document that window (in the council.md Step 7 prose and the
  council.md failure-mode table next to the Step 5a-5e row); do not promise
  cleanup after cancellation unless a cancellation-surviving mechanism is added.
  Sweep what removing the heredoc leaves behind. Keep the
  `__EOF_COUNCIL_SYNTHESIS__` escape in council.md Step 5b input and Step 5e's
  quoting rule as defense in depth, and keep the delimiter golden case in
  `tests/synthesis.bats` (it still guards the 5b escape). Reword Step 5e quoting
  rule 1, which says the delimiter is escaped because Step 7 carries the
  markdown in a heredoc, so it no longer claims a heredoc. Update the four
  council.md comments that still name the Step 7 heredoc (the "inline via quoted
  heredoc" comment, the two "Step 7's heredoc text lands in the report"
  comments, and the escape-set comment in `council_fence_block` that ends
  "...and the Step 7 heredoc delimiter"). If you instead remove the escape,
  remove its `synthesis.bats` case and the 5e rule in the same change.
- **F3 — unclosed code fence.** In `council_normalize_text`, an opening fence
  with no closing fence passes every remaining line of that reviewer's text
  through unnormalized (identity and style signal survive). Chosen behavior:
  hold back the opening-fence line together with every fenced line after it, and
  when input ends with the fence still open, re-process the whole held block,
  opening-fence line included, as ordinary text (no cap). A closed fence keeps
  the byte-for-byte contract unchanged. Reword the library header comment in
  `council.md` ("Copies byte-for-byte: fenced code blocks...") to say "closed
  fenced code blocks; an unclosed fence is normalized as ordinary text, its
  opening line included". Golden cases: a closed fence stays byte-identical; an
  unclosed fence with a reviewer-name line and a bullet line inside it comes out
  scrubbed and flattened, opening fence line included.
- **F4 — bare identifiers lose edge underscores.** `strip_emph` strips
  leading/trailing `*`/`_` runs from any non-path word, so bare `__init__`,
  `_private_fn` or `*ptr` in prose become `init`, `private_fn`, `ptr` — which
  can break a finding's claim text that a reader relies on. F4 applies only to
  the synthesis-side normalized copy; `verify_finding()` passes the
  verbatim cited excerpt to `quote-ground.sh batch` (R22), which redacts and
  whitespace-normalizes both the excerpt and the source line itself, so do not
  run F4 (or any other normalizer pass) on the excerpt passed to verification. F4 narrows spec
  R10 (shell 03 stripped every edge emphasis run): a single word wrapped in
  underscore runs keeps its markers, so those leave a small style fingerprint;
  accepted because a lost identifier breaks evidence while a kept marker only
  leaves style, and R10 stays covered (see Covers). Rule: `*` runs strip only
  when the same-length run wraps the word or phrase on both sides
  (`**important**`, `*x*`); an unpaired leading or trailing `*` (`*ptr`) is
  kept. `_`/`__` runs strip only when they wrap a multi-word phrase
  (`__two words__`); a single word wrapped in underscore runs (`__init__`,
  `_x_`, `__important__`) is treated as an identifier and kept, as is any
  unpaired edge underscore (`_private_fn`). Underscores inside a word
  (`snake_case`) are never touched. `__init__` and `__important__` are
  syntactically identical, so no rule can keep one and strip the other; keeping
  both is the safe side (a lost identifier breaks evidence, a kept emphasis
  marker only leaves style). Update the existing `synthesis.bats` golden case
  that strips `_unbounded_` (a single word wrapped in underscores) so its
  expected output keeps the underscores. Golden cases: `__init__` kept,
  `_private_fn` kept, `*ptr` kept, `**important**` stripped, `__two words__`
  stripped, `snake_case` untouched. `strip_emph` works per whitespace token, so
  multi-word pairing needs phrase-level state, which cannot live in
  `strip_words`: it sees one code-span-free prose segment at a time, so it
  cannot see an opener in one segment and its closer in the next. Hold the
  pairing state at line level, in the caller that walks the whole line,
  precisely so an opener and its closer can straddle an inline code span on the
  same line; bound it to one line (reset at every newline, never carried to the
  next line). Resolve a same-length run that wraps a single token first
  (`**x**`, `*x*`), then pair a multi-word opener with the nearest same-length
  closer on the same line, skipping over inline code spans untouched. Roll back
  an unpaired opener: when the line ends with a run still open, keep the
  opener's emphasis characters verbatim, but still run every token after it
  through `scrub_self` and the other non-emphasis normalization passes (an
  unpaired opener must not let reviewer identity or style signals survive).
  Golden cases that span an inline code span: ``**two `code` words**`` stripped
  to ``two `code` words`` (code span untouched), ``__two `code` words__``
  stripped likewise, ``*ptr `x` y`` kept with its leading `*` (unpaired),
  `*ptr is handled differently by Codex` keeps the `*` but the reviewer name is
  still scrubbed, and a run opened on one line with its closer on the next keeps
  its emphasis characters on both lines. Punctuation-adjacent forms: the rules
  above apply to the token after peeling leading and trailing punctuation
  (`( [ {` and `) ] } . , : ; ! ?`), and the peeled punctuation is kept. Golden
  cases: `__init__()`, `__init__.`, `(__init__)` and `*ptr,` come out intact
  (`__init__()` is mangled today), and `**important**:` comes out as
  `important:`.

## Implementation Steps (High-Level)

The numbers below are this plan's own steps (plan step 0-8). "council.md Step N"
always names a step of `plugins/yellow-council/commands/council/council.md`.

0. **Synthesis library location (F1)** — make and record the decision before any
   council.md Step 5 code is added; if moving, do the move as its own step and
   satisfy F1's shell-compat requirements. Whether the library moves or stays
   inline, plan steps 1 and 7 edit fenced Bash in `council.md`, so
   `pnpm validate:shell-compat` and `pnpm check:shell-parse` (parses the edited
   fenced blocks under bash and zsh) must pass for this shell in both cases.
   Those two checks do not run behavioral assertions; run
   `bats tests/synthesis.bats` from `plugins/yellow-council` as well.
1. **Normalizer fixes (F3, F4)** — implement F3 and F4 in
   `council_normalize_text` per "Carried follow-ups", with their golden cases in
   `plugins/yellow-council/tests/synthesis.bats`; verify them with
   `bats tests/synthesis.bats` from `plugins/yellow-council`.
2. **Verification helper** — Tier 1 calls `quote-ground.sh batch` for the
   window match, with the skip-to-Tier-2 rule for unknown/non-checkout
   contexts. The yellow-core catalog dependency is added in the later shell
   05 PR. Tier 2 fuzzy ratio ≥85; three-state result.
3. **Optional dependency handling** — import probe, soft-skip with warning,
   documented as optional.
4. **Five-bucket synthesis reorganization** — apply the deterministic precedence
   rule (single-reviewer split by verification; verdict-split beats agreement;
   agreement split by verification); surface unverified claims visibly.
5. **Rewire the rubric correctness dimension** — consume verification results
   instead of self-assessment, completing the coupling that kept this phase in
   V2.
6. **Bound the cost** — per-reviewer verification cap and concurrency with
   synthesis prompt construction.
7. **Report staging (F2, council.md Step 7)** — implement F2's cross-call
   staging lifecycle per "Carried follow-ups"; keep exactly one column-0
   `for reviewer in claude codex gemini opencode; do` line in council.md, in
   roster order (`scripts/validate-council-roster.js` Rule D1; the state-driven
   `"${STATE_REVIEWERS[@]}"` loops are exempt). The existing `synthesis.bats`
   extraction does not cover the Step 7 report block, so add extraction of that
   block plus behavioral cases for the lifecycle: path, token and symlink
   guards, trap ordering, a successful read, and cleanup after a failed `Write`.
8. **Finalization sweep** — skill contract, both configuration tables, component
   counts and README/CHANGELOG, manual e2e scenarios (quota ETA, lineage
   warning, tie presentation, single-pass bypass, rubric output, verification
   hit/miss paths), verify every shipped PR carried its changeset, and run the
   full validation suite end-to-end, including `pnpm lint:plugins`,
   `pnpm validate:shell-compat`, `pnpm check:shell-parse`, and the council
   plugin's full Bats suite (`bats tests/` from `plugins/yellow-council`, not
   `synthesis.bats` alone, so `redaction.bats` still verifies that every
   embedded redaction awk copy stays byte-identical) — the Bats run is what
   actually executes the F3/F4 golden cases; the shell lint/parse checks do not.

## Open Questions

- F1: keep the synthesis helper library inline in `council.md` or move it to a
  shipped plugin lib/references file. Decide in plan step 0, before any
  council.md Step 5 code.
