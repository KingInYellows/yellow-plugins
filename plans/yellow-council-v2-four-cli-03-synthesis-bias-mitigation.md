# Feature: Synthesis Bias Mitigation

## Overview

With Claude both reviewing and synthesizing, synthesizer bias is V2's #1
quality risk. This plan rebuilds the orchestrator's synthesis step as a
layered, prompt-only mitigation pipeline: style normalization (2026 research:
style bias now dominates position bias), double-blind randomized labels,
chain-of-thought-first synthesis with a self-participant instruction, 2-pass
order-swap where verdict flips become ties (never silently resolved), and
per-finding rubric decomposition. All mitigations compose; none require new
infrastructure. The rubric's "correctness of cited evidence" dimension is
self-assessed here and gets rewired to real verification by the final shell
(`yellow-council-v2-four-cli-05-evidence-verification-and-finalization`) —
that split is the R15 partial boundary.

**Verification handoff contract:** correctness maps directly to
`verify_finding()`'s three-state result once wired — `verified` and
`fuzzy-verified` both hold correctness (fuzzy surfaces a qualifier in the
report), `unverified` fails correctness and the finding cannot be
"well-supported" (R15's AND rule). Bucket ties and verdict-splits follow
R24's precedence exactly: single-reviewer findings split by verification;
verdict-split beats agreement; agreement splits by verification. A Pass B
verdict flip is a `low-confidence-synthesis` tie annotation only, never a
bucket reassignment — flip flag and bucket are orthogonal. Verification (R25)
runs concurrent with prompt construction, but correctness scoring and bucket
assignment must await `verify_finding()`'s return for that finding; this
plan's self-assessed placeholder must already honor that ordering and return
a three-state-compatible result so the final shell can swap the input source
without touching the combination rule.

**Scope boundary:** this plan keeps V1's Agreement / Disagreement buckets —
the five-bucket structure (R24) and `verify_finding()` (R22) land in shell 05.
Quota detection for reviewer slots (R16–R18) is shell 04; this plan only
handles the synthesizer's *own* Pass-B quota wall (R14).

## Origin

- Spec: `plans/specs/yellow-council-v2-four-cli.md`
- Covers: R9, R10, R11, R12, R13, R14, R15 (partial: rubric-scoring — correctness self-assessed until shell 05)
- Cross-cutting per-PR obligations touched: R26 (skill contract), R27 (env var in both tables), R29 (manual e2e scenarios for this PR's features), R30 (CI gate + minor changeset)
- Shell: yellow-council-v2-four-cli-03-synthesis-bias-mitigation
- Depends on (archived): `plans/complete/yellow-council-v2-four-cli-02-claude-reviewer-fanout.md`

## Pattern Survey

**Consumes, verified at expand time (2026-09-30, trunk `dab83f3d`):**

- 4-way fan-out + uniform parse (from shell 02): `council.md` Step 4 spawns
  claude/codex/gemini/opencode; `parse_reviewer_return()` (~L359–1046) is the
  single parser, storing into `REVIEWER_VERDICTS` / `REVIEWER_CONFIDENCES` /
  `REVIEWER_SUMMARIES` / `REVIEWER_FENCED_PATHS` / `REVIEWER_FINDINGS`
  (declared ~L356, assigned ~L1035–1041).
- Style-bias guidance: `docs/solutions/code-quality/llm-as-judge-style-bias-dominance.md`
  — Fix section: sed strip of `^#{1,6} `, `**bold**`, bullets; explicit
  "ignore formatting" judge instruction; CoT gives the largest reduction
  (−0.14); rubric + CoT combined; order-swap kept only as a sanity check
  (position bias < 0.04).

**Where synthesis lives now:** `council.md` "Step 5: Synthesis — V1 simple"
(L1051–1188) is prose, not a bash fence. Template at ~L1131–1170; V1 rules
at ~L1172–1186 — rule 5 ("No weighting, no scoring, no quote verification")
contradicts R15 and must be rewritten. The `[ESCAPED]` sandwich-fence
instruction is at ~L1080–1110; codex uses its native `codex-output` fence
label.

**State across fences:** each bash fence is a fresh subprocess. Summary and
findings text is NOT in `$STATE_FILE` (`$GIT_ROOT/.git/council-state.tsv`,
4 TSV columns `reviewer verdict confidence fenced_path`, truncated by `: >|`
at ~L354). It survives only in the Agent return (CLI legs, already redacted)
or the redacted fenced file on disk (claude leg — must be read from disk,
never from context). Cross-fence values travel by **literal substitution**:
Step 4 prints `CLAUDE_FENCED_FILE=...` (~L286) and Steps 6–9 substitute a
`<literal CLAUDE_FENCED_FILE value from Step 4>` placeholder; Step 7 takes
`SYNTHESIS_MD` via a quoted heredoc (~L1340). Do not add rows to
`$STATE_FILE` — Step 7's reader (~L1333) and Steps 8/9 read fixed columns.

**Randomness idiom:** `od -An -N8 -tx1 /dev/urandom | tr -d ' \n'`
(`plugins/yellow-review/lib/review-ledger.sh:72`, `plugins/yellow-jules/commands/jules/*.md`).
No `shuf`/`$RANDOM` in council. A 4-element permutation needs new code
(random sort keys via `od -tu2`, then `sort -n`) that runs under bash and
zsh.

**Flag/env conventions:** Step 2 (L78–113) splits `MODE` / `REST` and prints
help (env-var lines L102–104). Per-mode flags parse in Step 3 (`--base`
~L126–170, `--paths` ~L197–221). Env validation canonical form:
`council-patterns/SKILL.md:953–970` (`${COUNCIL_TIMEOUT:-600}` + `case` on
invalid → warn + fall back).

**Validator constraints that bite this change:**

- `scripts/validate-council-roster.js` Rule D1 requires **exactly one**
  column-0 line matching `^for reviewer in ([a-z0-9 ]+); do$` in
  `council.md` (the Step 7 appendix loop, ~L1364). Any new per-reviewer loop
  must iterate `"${STATE_REVIEWERS[@]}"` or a differently named variable —
  never a second fixed-list `for reviewer in claude codex gemini opencode; do`.
- The per-reviewer fenced-path shape check exists at four mirrored sites
  (Steps 6/7/8/9, note at ~L1236–1242) — this plan does not touch them.
- The redaction awk is byte-identity-guarded by `redaction.bats` — do not
  touch it. `strip_deco()` (`SKILL.md:150`) is a redaction helper, not a
  markdown flattener; do not reuse it.
- Test files embedding marker text must build markers from parts (see
  `extract.bats`, `M_ANCHOR="function strip""_deco..."`) so Rule R does not
  flag them.

**Docs anchors:** `council-patterns/SKILL.md` "Synthesis Format (V1)"
(L1024–1044) says the template lives only in Step 5 — keep that rule; the
skill carries the *contract*, not the template. Configuration tables:
`council.md` ~L2121 (3-col `Var | Default | Purpose`) and
`plugins/yellow-council/CLAUDE.md` ~L154–161 (4-col
`Var | Type | Default | Purpose`). Failure Modes table: `council.md` ~L2096–2118.
Manual tests: `docs/testing/yellow-council-manual-tests.md` (Phase 2 per-mode
E2E ~L50, Phase 3 failure paths ~L119).

**Prior-shell precedent:** `plans/complete/yellow-council-v2-four-cli-02-claude-reviewer-fanout.md`
— per-site audit step, stale-string grep in Verification, changeset + CRLF
`sed` as the last step.

## Implementation

- [x] Step 1: **`--single-pass` flag + `COUNCIL_DOUBLE_PASS_SYNTHESIS` (R13).**
  In `council.md` Step 2, strip a standalone `--single-pass` token from
  `$REST` *before* per-mode parsing (so `plan`/`question` free text and
  `--base`/`--paths` parsing never see it) and record it. Read
  `COUNCIL_DOUBLE_PASS_SYNTHESIS` with the SKILL.md:953 case/warn pattern:
  `1` (default) → 2-pass, `0` → single-pass, anything else → warn and keep
  2-pass. Either disable wins. Print one line
  `COUNCIL_SYNTHESIS_PASSES=<1|2>` for literal substitution into Step 5
  (fresh-subprocess rule). Add `--single-pass` to the review-mode help line
  and `COUNCIL_DOUBLE_PASS_SYNTHESIS (1)` to the help env-var lines
  (~L102–104). The flag is accepted in every mode (synthesis is
  mode-independent); document it as `/council review --single-pass` per R13.

- [x] Step 2: **Normalization helper `council_normalize_text` (R10).** Add a
  bash function in a new Step 5 fence ("5a — normalize") that reads stdin
  and writes flattened text: strip ATX heading markers (`^#{1,6} `),
  `**`/`__` bold and `*`/`_` emphasis *outside* backtick code spans, bullet
  and numbered-list markers, blockquote `>` prefixes, horizontal rules, and
  collapse runs of blank lines; canonicalize reviewer-specific severity
  prefixes (codex `[P1]`/`P1:` style, `CRITICAL`/`HIGH` banners) to one
  `severity=<P1|P2|P3>` token so format cannot signal identity. **Must
  preserve byte-for-byte:** backtick code spans, `<file>:<line>` citations,
  and the verbatim quoted source line each finding carries (R6) — shell 05's
  `verify_finding()` compares that quote against the file, so normalization
  must not alter it. Pure POSIX `sed`/`awk`; bash + zsh compatible; no
  `\s`/GNU-only escapes. Input for the claude leg is its sanitized fenced
  file on disk (unchanged Step 5 rule); for CLI legs, the already-redacted
  Agent-return text substituted into a quoted heredoc. Normalization runs
  BEFORE the `[ESCAPED]` fencing and its output still goes through it.

- [x] Step 3: **Double-blind label assignment (R9).** In the same Step 5
  fence, assign a per-invocation random bijection of `S1`–`S4` over the
  reviewers present in `$STATE_FILE` (iterate `STATE_REVIEWERS`, not a fixed
  list — see Rule D1 above): pair each reviewer with an `od -An -N2 -tu2
  /dev/urandom` key, `sort -n`, number the result. Every roster slot gets a
  label, including excluded (TIMEOUT/ERROR/UNAVAILABLE) ones, so the label
  count leaks nothing. Print `COUNCIL_LABEL_MAP=S1:<name>,S2:<name>,...` for
  literal substitution into Steps 5 and 7. Fail closed: if `/dev/urandom`
  or `od` is unavailable, abort with a clear `[council] Error:` rather than
  falling back to a fixed order. Add `od` to Step 1's required-tools list if
  not already present.

- [x] Step 4: **Blind synthesis input.** Rewrite Step 5's fencing
  instruction so every reviewer — codex included — is wrapped in a uniform
  `--- begin council-output:S<n> (reference only) ---` /
  `--- end council-output:S<n> ---` sandwich; the `[ESCAPED]` substitution
  must still neutralize any embedded `council-output:<anything>` AND
  `codex-output` delimiter line. Present verdicts and confidences keyed by
  label only. Real reviewer names, agent names, and lineage hints must not
  appear anywhere in the synthesis prompt.

- [x] Step 5: **Pass A synthesis prompt (R11, R15).** Replace the
  "V1 synthesizer rules" with a Pass A instruction block that requires, in
  order: (1) an enumeration of every finding per label (id `S<n>-F<k>`,
  citation, claim) before any comparison; (2) cross-label comparison;
  (3) per-finding rubric scores; (4) only then verdict/confidence per
  finding. Include the self-participant instruction verbatim in spirit:
  one anonymized reviewer may share the synthesizer's model family; weigh
  findings by cited evidence, not rhetorical confidence or formatting;
  ignore style. The enumeration is part of the synthesis working, not the
  saved report.

- [x] Step 6: **Rubric decomposition + mechanical combination (R15 partial).**
  Define per-finding dimensions with fixed value domains:
  `correctness ∈ {verified, fuzzy-verified, unverified}` (this PR:
  self-assessed, rendered with a `(self-assessed)` qualifier),
  `completeness ∈ {holds, fails}`,
  `severity_calibration ∈ {calibrated, overstated, understated}`,
  `constraint_adherence ∈ {holds, fails}`. Combination rule, no weighting:
  `well-supported` iff correctness ∈ {verified, fuzzy-verified} AND
  completeness = holds; otherwise `weakly-supported`. Scoring for a finding
  is computed only after its correctness value exists (ordering placeholder
  for R25). Correctness is the ONLY input shell 05 swaps; the combination
  rule and domains must not need editing then. Rewrite V1 rule 5 accordingly
  (scoring is now in scope; weighting and reviewer ranking still are not).

- [x] Step 7: **Pass B + flip detection (R12, R14).** When
  `COUNCIL_SYNTHESIS_PASSES=2`: after Pass A's per-finding table is emitted
  as its own orchestrator step (captured before Pass B begins), issue Pass B
  as a separate step with the labeled blocks in reversed order (S4→S1) and
  the same instructions. Compare per finding: if verdict or confidence tier
  differs, mark `low-confidence-synthesis` and present a tie showing both
  readings (Pass A / Pass B) — never pick one. The flip flag never moves a
  finding between buckets. Document in Step 5 that this is a prompt-level
  reordering within one context (positional-consistency check, not isolated
  passes — see spec "Synthesis locus").

- [x] Step 8: **Pass B quota-wall fallback (R14).** If Pass B cannot be
  produced (Claude quota wall before or during its completion — match the
  spec R17 claude strings `session limit.*resets`, `weekly limit.*resets`,
  `Opus limit.*resets`, `usage limit reached.*try again`, case-insensitive),
  ship Pass A's synthesis unchanged with a headline annotation naming the
  skipped flip-analysis and the parsed reset ETA (or `ETA unknown`). No
  in-session retry. A non-quota Pass B failure gets the same Pass-A-only
  shipment with a generic "flip-analysis skipped" annotation.

- [x] Step 9: **Report template + de-anonymization.** Update the Step 5
  report template: headline gains `Low-confidence synthesis: N of M
  findings (P%)` when 2-pass ran, omits it entirely when single-pass (R13),
  and carries the R14 annotation when applicable. Agreement / Disagreement
  entries show rubric dimensions and the well-supported/weakly-supported
  result, with `low-confidence-synthesis` ties rendered as both readings.
  De-anonymize ONLY at report assembly: map `S<n>` → display name via the
  substituted `COUNCIL_LABEL_MAP` in the Agreement/Disagreement quote lines
  and Reviewer Status; Step 7's raw-output appendix keeps using real names.
  Add a one-line report note that labels were randomized per run. Leave
  Step 7's fixed `for reviewer in claude codex gemini opencode; do` loop
  (~L1364) untouched.

- [x] Step 10: **Failure Modes + Configuration tables (R27).** Add rows to
  `council.md`'s Failure Modes table: invalid `COUNCIL_DOUBLE_PASS_SYNTHESIS`
  (warn, 2-pass), Pass B quota wall (ship Pass A + ETA annotation, no retry),
  label generation failure (abort). Add `COUNCIL_DOUBLE_PASS_SYNTHESIS` to
  BOTH tables: `council.md` Configuration (3-col) and
  `plugins/yellow-council/CLAUDE.md` Configuration (4-col, Type `0 \| 1`,
  Default `1`). Update `council.md`'s "V2 Trajectory" list only if an item
  is now shipped (none of its current items are — leave it).

- [x] Step 11: **Synthesis contract in the skill (R26).** Replace
  `council-patterns/SKILL.md` "Synthesis Format (V1)" with "Synthesis
  Contract (V2)": keep the "template lives only in Step 5" rule; document
  pipeline order (normalize → anonymize → Pass A → Pass B → assemble →
  de-anonymize), normalization rules and what it must preserve, S1–S4
  randomized labels and the uniform `council-output:S<n>` fence, the
  enumerate-then-compare requirement and self-participant instruction,
  2-pass semantics (tie, orthogonal to buckets, disable paths, quota
  fallback, single-context limitation), and the rubric domains + combination
  rule with the explicit note that correctness is self-assessed until
  `verify_finding()` lands. Update non-goals: no weighting, no reviewer
  ranking. Update `plugins/yellow-council/CLAUDE.md` / `README.md` prose
  that describes V1-only descriptive synthesis.

- [x] Step 12: **Bats coverage for the new bash.** Add
  `plugins/yellow-council/tests/synthesis.bats` that extracts the Step 5
  normalize/label fence from `council.md` (add a small extractor to
  `tests/lib/` keyed on a unique fence marker comment; build any marker
  strings from parts per `extract.bats`) and asserts, under bash and zsh:
  headings/bold/bullets are flattened; backtick spans, `path/to/f.ts:42`
  citations and a quoted source line containing `**`/`_` survive
  byte-for-byte; codex-style `[P1]` and another reviewer's `P1:` normalize
  to the same token; the label map over 4 reviewers is always a bijection of
  S1–S4 (loop ~100 runs) and not constant across runs; missing
  `/dev/urandom` fails closed. Confirm CI's `bats plugins/yellow-council/tests/`
  step (`.github/workflows/validate-schemas.yml` ~L1483) picks the file up.

- [x] Step 13: **Manual e2e scenarios (R29 slice).** In
  `docs/testing/yellow-council-manual-tests.md` add: verdict-flip presented
  as tie; `--single-pass` bypass (and `COUNCIL_DOUBLE_PASS_SYNTHESIS=0`)
  omits the low-confidence headline; rubric dimensions present per finding;
  no real reviewer names in the synthesis working, real names restored in
  the saved report.

- [x] Step 14: **Changeset + CRLF + gate (R30).** `pnpm changeset` →
  `"yellow-council": minor`. Run `sed -i 's/\r$//'` on every file this plan
  touched. Run the Verification block.

## Verification

- `pnpm validate:schemas && pnpm test:unit && pnpm lint && pnpm typecheck` -> expected: all pass (R30 baseline)
- `pnpm validate:agents && pnpm lint:plugins` -> expected: pass (plugin Markdown changed)
- `pnpm validate:shell-compat && pnpm check:shell-parse` -> expected: new fences parse and lint under bash and zsh
- `node scripts/validate-council-roster.js` -> expected: pass; Rule D1 still finds exactly one fixed `for reviewer in claude codex gemini opencode; do` line
- `cd plugins/yellow-council && bats tests/` -> expected: `extract.bats`, `redaction.bats`, and new `synthesis.bats` all green
- `pnpm test:shell-compat` -> expected: pass
- `rg -n 'COUNCIL_DOUBLE_PASS_SYNTHESIS' plugins/yellow-council/CLAUDE.md plugins/yellow-council/commands/council/council.md` -> expected: hits in both config tables and the help text
- `rg -n 'No weighting, no scoring, no quote verification|Synthesis Format \(V1\)|V1 synthesizer rules' plugins/yellow-council` -> expected: no hits
- `rg -n 'council-output:<reviewer>' plugins/yellow-council/commands/council/council.md` -> expected: none left in the synthesis-input instruction (uniform `S<n>` fence); appendix/persisted-report fences may keep real names
- `ls .changeset/*.md | xargs rg -l '"?yellow-council"?: minor'` -> expected: one changeset
- Manual (from Step 13): one `/council review` run shows randomized labels differ across two runs, a low-confidence headline line, and rubric dimensions per finding; `--single-pass` omits the headline line

## Context Files

- `plugins/yellow-council/commands/council/council.md` — Step 2 args (L78–113), Step 5 synthesis (L1051–1188), Step 7 appendix loop (~L1364), Failure Modes (~L2096), Configuration (~L2121)
- `plugins/yellow-council/skills/council-patterns/SKILL.md` — Synthesis Format (V1) L1024–1044 → contract; env-validation pattern L953–970; Injection Fence Format L558
- `plugins/yellow-council/CLAUDE.md` — 4-col Configuration table (~L154–161)
- `plugins/yellow-council/README.md` — synthesis description
- `docs/solutions/code-quality/llm-as-judge-style-bias-dominance.md` — normalization + CoT + rubric guidance (Consumes)
- `docs/testing/yellow-council-manual-tests.md` — manual e2e scenarios
- `scripts/validate-council-roster.js` / `scripts/council-roster.json` — Rule D1 single-fixed-loop constraint, Rule R marker scan
- `plugins/yellow-council/tests/extract.bats`, `plugins/yellow-council/tests/lib/extract-redaction-awk.bash` — test and extraction patterns
- `plugins/yellow-review/lib/review-ledger.sh:72` — `od /dev/urandom` idiom
- `plans/specs/yellow-council-v2-four-cli.md` — R9–R15, R24/R25 handoff contract, "Synthesis locus" limitation
- `plans/complete/yellow-council-v2-four-cli-02-claude-reviewer-fanout.md` — prior-shell plan shape
