# Feature: Evidence Verification + V2 Finalization

## Overview

The riskiest and final shell. Tier 1-2 evidence verification makes the council's
citations mechanically checked instead of self-asserted: Tier 1 window match
through `quote-ground.sh batch` (the cited line plus or minus 3 on the
working-tree file, after redaction and whitespace normalization; the helper
takes no ref, so a caller that needs a committed line checks that ref out
first, and contexts with no checkout skip to Tier 2), Tier 2 fuzzy similarity
≥85 via an optional `rapidfuzz` dependency. Verification classifies findings
into the five-bucket synthesis structure (never gates or discards), rewires the
rubric's "correctness of cited evidence" dimension from self-assessed to
verification-backed (completing the R15 partial started in the synthesis
shell), and is bounded (top-50 per reviewer, concurrent with prompt
construction). The shell closes V2 with the cross-cutting finalization sweep:
skill/doc lockstep, both configuration tables, component counts, manual e2e
scenarios, and the final validation pass across everything the earlier shells
shipped.

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

## Origin

- Spec: `plans/specs/yellow-council-v2-four-cli.md`
- Covers: R10 (partial: F3/F4 normalizer edge cases), R15 (partial:
  correctness-dimension verification wiring), R22, R23, R24, R25, R26, R27,
  R28, R29, R30
- Shell: yellow-council-v2-four-cli-05-evidence-verification-and-finalization
- Carried follow-ups F1-F4 from the PR #948 review (2026-09-30), restated in
  the Implementation steps below.

## Expansion Decisions

- **F1 — move the synthesis library to `lib/` (user decision, 2026-10-14).**
  The council.md Step 5b helper library moves to
  `plugins/yellow-council/lib/council-synthesis.sh` as a **Tier 4** dual-shell
  library sourced directly from the Step 5 fences via
  `${CLAUDE_PLUGIN_ROOT}`. `verify_finding()` and the bucket helper are added
  there, not inline. The library move is its own step and lands before any
  other code change. Cleanup-only blocks (Cancel, Step 8/9 unlink loops,
  `council_rm_synth_*` copies) stay inline so nothing that has to delete files
  depends on a sourced file.
- **Tier 1 reads the working tree only (shell decision, overrides spec R22's
  `git show HEAD:<file>` wording).** `quote-ground.sh` takes no ref. In
  `review` mode a cited file whose working-tree copy differs from `HEAD`
  (`git diff --quiet HEAD -- <file>` fails) skips Tier 1 and goes to Tier 2
  against the `git show HEAD:<file>` lines. `plan`/`debug`/`question` use the
  working tree. A run outside a git work tree skips Tier 1 for every row.

<!-- deepen-plan: codebase -->
> **Codebase:** In review mode the pack's diff is `BASE…HEAD` (`council.md:376`), but file
> excerpts are read from disk (`council.md:381`).
> - A reviewer citing a line from a dirty excerpt is matched in Tier 2 against
>   `git show HEAD:<file>`, so the line numbers can disagree.
> - A staged new file passes `git diff --quiet HEAD -- <file>`, yet
>   `git show HEAD:<file>` fails on it. Treat that as `bad-citation` or as a
>   working-tree read, explicitly.
> - Spec R22 gives `plan`/`debug`/`question` "working tree with HEAD fallback".
>   This decision drops the fallback silently. Record it as a deliberate
>   override, as was done for the `git show` wording.
<!-- /deepen-plan -->

- **Finding ids come from shell, not from the model.** Pass A already
  enumerates `S<n>-F<k>` ids by hand. The verifier now produces those ids from
  each label's **normalized** text (the `council_normalize_text` output). In
  that text every reviewer's finding header, Codex's included, is already one
  `severity=P<n> <file>:<line> …` line, and the `Evidence:` tail is kept
  verbatim. 5b writes each id into the text Pass A reads (`[S1-F3] severity=…`
  in `forward.txt` and `reverse.txt`), and `verification.tsv` carries the same
  id with its `file` and `line`. Pass A joins on the id and never counts. Ids
  carry labels only, never reviewer names, so the blind is preserved.

<!-- deepen-plan: codebase -->
> **Codebase:** As planned, Pass A cannot reliably join ids to findings. `forward.txt`
> shows normalized text with no finding ids, and the `verification.tsv` columns
> (`id, result, tier, reason`) carry no `file:line`. Two fixes:
> - Add `file` and `line` columns to the TSV, or inject `[S<n>-F<k>]` into each
>   normalized finding line before `forward.txt`/`reverse.txt` are built.
> - Have 5b print a `COUNCIL_SYNTH_VERIFICATION=<path>` pointer line, and have
>   the prose after `council.md` ~L2120 tell Pass A to Read it.
<!-- /deepen-plan -->

- **Merged Agreement correctness = best contributing result.** An Agreement
  group's correctness is the best result among its citations
  (`verified` > `fuzzy-verified` > `unverified`). Corroboration comes from
  the agreement itself; a single grounded citation shows the cited evidence
  exists.
- **Bucket assignment is mechanical.** Pass A records, per finding,
  `group`, `citations` (count of distinct labels in the group), `conflict`
  (yes/no from the Compare step) and correctness. A shell helper
  (`council_assign_bucket`), run in Step 5e, maps those to one of the five
  buckets. The synthesizer copies the result and does not choose buckets.
- **yellow-core becomes a required dependency, `>=2.8.0`.** `quote-ground.sh`
  first shipped in yellow-core 2.8.0 and needs its siblings `validate-fs.sh`
  and `compound-staging.sh`. Claude Code has no optional dependencies: when
  yellow-core is missing, disabled or older than the range, yellow-council
  itself is disabled. The runtime fallback covers only the loads that skip the
  dependency check (`--plugin-dir`, a local-folder marketplace loaded in place,
  `@synced` plugins). There, if `council_core_lib` cannot find yellow-core,
  Tier 1 is skipped with a warning and rows fall to Tier 2 or `unverified`.
  Verification never aborts the council.
- **Codex findings are unverifiable in V2 (user decision, 2026-10-14).**
  yellow-codex builds Codex findings with `jq` from Codex's JSON, which has a
  location but no source line, so they carry no `Evidence:` quote
  (`plugins/yellow-codex/agents/review/codex-reviewer.md:555-560`). They are
  classified `unverified` / `no-evidence` like any other quote-less finding,
  so a Codex-only finding always lands in Unverified Claims. This shell
  documents it as a known lineage limitation and files a follow-up issue
  asking yellow-codex to emit a quoted line. It makes no yellow-codex change.
- **Tier 2 scores fragments too (user decision, 2026-10-14; overrides R22's
  `fuzz.ratio`-only wording).** Each window line scores
  `max(fuzz.ratio, fuzz.partial_ratio)` against 85, and `partial_ratio` counts
  only when the quote is at least 16 characters. `ratio` alone caps a quote
  that is a fragment of a longer line at about 50. The 16-character floor
  stops a short quote scoring 100 against almost any line.
- **The rapidfuzz install hint names apt first (2026-10-14; overrides R23's
  "`pip install rapidfuzz` warning" wording).** On Debian and Ubuntu, Python
  is externally managed (PEP 668), so a bare `pip install rapidfuzz` fails
  there. The warning names `apt install python3-rapidfuzz` first and keeps
  pip for environments that allow it.

<!-- deepen-plan: codebase -->
> **Codebase:** `catalog/plugins/yellow-council.json` has no `dependencies` key today, and
> neither does the generated `plugin.json`. `"version": "*"` passes the schema
> (`semverRange`, `schemas/plugin.schema.json` ~L296-300; precedent
> `catalog/plugins/yellow-review.json:38-43`), but `quote-ground.sh` first shipped
> in yellow-core 2.8.0 (`plugins/yellow-core/CHANGELOG.md:118`). The local install
> cache still holds yellow-core 2.6.0-2.7.0 without it. Use `">=2.8.0"`
> (range-format precedent: `catalog/plugins/yellow-semgrep.json:53`).
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** Claude Code's plugin-dependency docs do not define an `optional` field.
> Every declared dependency is checked at load. If it is missing, disabled or
> out of range, the **dependent plugin is disabled** ("Dependency \"x\" is not
> installed" / "Requires \"x\" ~2.1, installed 3.0"). Installing yellow-council
> auto-installs yellow-core from the same marketplace (v2.1.110+, extended in
> v2.1.116). Ranges resolve through `<plugin>--v<version>` git tags. For a
> relative-path marketplace like this one, Claude Code falls back to the current
> copy and checks the range at load. Consequences:
> - The "yellow-core cannot be found → skip Tier 1 with a warning" fallback only
>   covers loads where the dependency check does not apply: `--plugin-dir`, a
>   local-folder marketplace loaded in place, or `@synced` plugins.
> - `optional` and `reason` inside a dependency object are undocumented upstream,
>   although the repo's `scripts/lib/plugin-rules.js` accepts them. Run
>   `claude plugin validate` on the generated manifest before shipping.
> See https://code.claude.com/docs/en/plugin-dependencies.md and
> https://code.claude.com/docs/en/plugins/troubleshooting.md
<!-- /deepen-plan -->

## Pattern Survey

**`plugins/yellow-core/lib/quote-ground.sh` (Tier 1 engine)**
- Execute it with `bash "$QG" batch`; never source it (it refuses, L54-57).
  It needs bash ≥4.4, `jq` and `iconv`.
- Input: JSONL on stdin, one row per finding, `{id,file,line,quote}`.
  Output: one row per input, in order, `{"id","result","matched_line"}`.
  `result` is `grounded`, `ungrounded`, `too-short` or `unsafe-path`.
- Exit 0 means rows were written. Exit 2 means no rows: a missing dependency,
  a non-JSON line, a credential-bearing string id, or a redaction failure.
- Paths resolve against `git rev-parse --show-toplevel` of the cwd. Paths must
  be repo-relative; `validate_file_path` rejects traversal and escaping
  symlinks.
- Out-of-range lines are clamped (`qg_clamp_window`), not rejected. R22 needs
  them rejected, so the council does its own bounds check before calling.
- Matching: per-line `cs_redact_secrets`, then whitespace normalization, then
  a literal substring match within ±3 lines (`QG_MIN_CHARS=8`).
- Tests: `plugins/yellow-core/tests/quote-ground.bats`. Contract:
  `plugins/yellow-core/CLAUDE.md:399-419`. There are no other callers yet;
  `plugins/yellow-core/README.md:158-162` already promises this council PR.

**Locating a sibling plugin's files**
- `sp_sibling_file` in `plugins/yellow-review/lib/sibling-plugin.sh:12-26`
  tries the checkout first, then the newest numeric cache version. It has a
  test override (`RL_CORE_LIB`, `review-ledger.sh:293`).
- `plugins/yellow-debt/lib/validate.sh:10-55` is a fenced-shell variant.
- Dependency declaration format: `catalog/plugins/yellow-review.json:36-48`
  (`{"name","version","optional","reason"}`). The generator copies it into
  `plugin.json`, and `scripts/lib/plugin-rules.js:344` validates it.

**council.md map (`plugins/yellow-council/commands/council/council.md`)**

Steps:
- Step 1 required-tools loop: ~L49.
- Step 2 `MODE` case `plan|review|debug|question`: ~L88-155; help `printf`
  table ~L114-137.
- Step 5 overview: L1339. 5a: L1384. 5b: L1555. 5c Pass A: L2142. 5d: L2197.
  5d resume: L2236. 5e: L2314.
- Step 7: L2707, heredoc at L2783-2788. Its single column-0 roster loop
  `for reviewer in claude codex gemini opencode; do` is at L2809 (Rule D1).

Synthesis library and staging:
- Library markers at L1562/L1856. Inside: `council_normalize_text` (awk with
  `strip_emph` ~L1604, `strip_words` ~L1624, code-span walker
  `strip_outside_code` ~L1642, fence pass-through, the verbatim `Evidence:`
  tail at L1723), `council_extract_fenced` (L1759), `council_assign_labels`
  (L1787) and `council_fence_block` (L1832).
- 5a staging pattern (L1384-1553): `mktemp -d /tmp/council-synth-XXXXXX`, a
  32-hex `.token` from `od -An -N16 -tx1 /dev/urandom`, written with `>|`.
  The stale sweep is `find /tmp -maxdepth 1 -type d -name 'council-synth-*'
  -mmin +1440`. 5b validation order: `-f ! -L -O`, traversal arm
  `*..*|/tmp/council-synth-*/*`, `-d ! -L -O`, a 32-hex token, `.token`
  equality.

Rubric and report text:
- Pass A rubric table: L2171. The self-assessment paragraph to replace:
  L2183-2189.
- Output template: L2484-2584. Buckets today are `### Agreement (cited by 2+
  reviewers)` (L2515) and `### Disagreement (unique to one reviewer or
  conflicting verdicts)` (L2528). Synthesizer rules 1-7: L2549-2578.
- Step 5e quoting rule 1: L2460-2467.
- Comments that still name the Step 7 heredoc: L1829, L2465, L2783, L3493,
  L3631.

Tables and trailing sections:
- Failure Modes table starts at L3700; the 5a-5e rows are at ~L3727-3735.
- Configuration table: L3738-3747. V2 Trajectory: L3749.

<!-- deepen-plan: codebase -->
> **Codebase:** Anchor corrections in council.md (all others in this map were confirmed):
> - `strip_emph` L1614, `strip_words` L1631, `strip_outside_code` L1653.
> - Rubric header L2170, `correctness` row L2172 (L2171 is the separator).
> - Synthesizer rules L2546-2582 (rule 1 L2548, rule 7 L2578-2582).
> - Failure Modes 5a-5e rows L3729-3733.
> - Step 7 heredoc comment L2783-2784, heredoc L2785-2788.
> - `forward.txt`/`reverse.txt` written at L2104-2113.
> - The Step 2 `MODE` case starts at L106.
>
> Outside council.md:
> - `README.md` Output starts at L72; the self-assessed text is at L79.
> - `plugins/yellow-core/README.md` council note is L156-162.
<!-- /deepen-plan -->

**Tests (`plugins/yellow-council/tests/`)**
- `synthesis.bats` (1934 lines) loads the library through `extract_synthesis_lib`
  (`tests/lib/extract-synthesis-lib.bash`).
- `run_in <profile> <awk-impl> <body>` (L56-66) crosses bash, `zsh -f` and
  `zsh -f -o noclobber …` with every awk binary.
- The `_unbounded_` golden case is at L98-137. The delimiter golden case is
  at L236-273.
- `extract_fence_after <file> <heading-prefix> <out>` pulls the first bash
  fence after a heading. It is already used for `'### Step 7'` (L1139).
- `quota-lineage.bats:23-24` reuses `extract_marked_lib` for other libs; keep
  it.
- `redaction.bats:291-310` keeps every shipped redaction awk copy
  byte-identical.

**Tier 4 library conventions (from `plugins/yellow-core/lib/compound-staging.sh:1-28`, `validate-fs.sh`)**
- Header: "sourced only; MUST NOT set top-level shell options".
- Idempotent `_<NAME>_LOADED` guard using `return 0 2>/dev/null || exit 0`.
- No `BASH_SOURCE[0]`; function prefix `council_`.
- Register it in `scripts/shell-compat-config.json` `tier4Libraries`. Without
  that, `scripts/validate-shell-compat.js:1047-1052` fails SHC-008.
- The driver `tests/shell-compat/drivers/<plugin>--<basename>.sh` is
  required by `tests/shell-compat/tier4-libraries.bats:55`. Model it on
  `drivers/yellow-core--validate-fs.sh` (`REPO_ROOT`, `TMPD`, `name=rc`
  lines). The driver must give identical stdout and empty stderr under every
  profile.
- Fences source a lib with `. "${CLAUDE_PLUGIN_ROOT}/lib/<file>.sh"`, as in
  `plugins/yellow-morph/commands/morph/setup.md:100` and
  `plugins/yellow-debt/commands/debt/fix.md:37`.
- A bats test can source the lib directly: `plugins/yellow-debt/tests/validate.bats:6-7`.

**Python helper precedent**
- `plugins/yellow-core/lib/statusline-settings.py` is stdlib-only and invoked
  as `python3 "${CLAUDE_PLUGIN_ROOT}/lib/…py"` behind `command -v python3`.
- No plugin probes for a third-party module today. Use the `have_X`
  predicate pattern from
  `docs/solutions/code-quality/shell-tool-detection-helper-pair-pattern.md`.
- Feed text on stdin only, never argv (quote-ground's rule).

**Cross-call staging (F2)**
- Reference shape: `docs/solutions/code-quality/trap-cleanup-across-tool-call-boundaries.md:84-146`.
  Mint with no trap → `Write` → validate the relayed dir and token, then arm
  the trap.
- Residual limits: `docs/solutions/security-issues/shell-owned-state-is-not-a-boundary-against-write.md`.
- Step 7 must relay the dir and token as literals, because `Write` needs the
  path from the model. Say so, and keep "removes the relayed-literal vector,
  not a deliberate Write".
- Settled differences between existing instances: use the `/tmp/council-synth-`
  root (so the 5a sweep reclaims it), require a non-empty suffix (`?*`),
  require a 32-hex token (5b rule), and write `.token` with `>|`.

**Docs to sync**

`plugins/yellow-council/CLAUDE.md`:
- Required Environment: L16-37.
- Synthesis bullet: L86-100.
- Component counts: L131 / L148 / L180.
- Cross-plugin deps: L192 says "does NOT depend on yellow-core".
- 4-column config table: L205-214.
- Testing: L228-229, the sentence about extracting between markers.

`plugins/yellow-council/skills/council-patterns/SKILL.md`:
- Synthesis Contract: L1063. Normalization: L1088.
- `**Rubric.**` (L1158-1169) and `**Buckets.**` (L1170) still say
  "until … lands".

`plugins/yellow-council/README.md`:
- Output: L72. Lineage map: L128-133. Config table: L159-168.
- "V1 / V2" (L179-184) lists verification as future.

Other docs:
- `docs/testing/yellow-council-manual-tests.md`: model new scenarios on
  `2.5 Synthesis bias mitigation` (L119); the last failure scenario is `3.7`
  (L254).
- `plugins/yellow-council/CHANGELOG.md` is generated by Changesets. Never
  edit it by hand.

## Implementation

### Phase A — F1: move the synthesis library (plan step 0; first, alone)

- [x] Step 1: Create `plugins/yellow-council/lib/council-synthesis.sh` with the
  lines currently between `# >>> council-synthesis-lib` and
  `# <<< council-synthesis-lib` in council.md (L1562-1856), moved
  byte-for-byte. That covers `council_normalize_text`,
  `council_extract_fenced`, `council_assign_labels` and
  `council_fence_block`. Add a Tier 4 header comment (sourced only; MUST NOT
  set top-level shell options; dual-shell; no `BASH_SOURCE`) and a
  `_COUNCIL_SYNTHESIS_LOADED` guard (`return 0 2>/dev/null || exit 0`).
  Create the file with a heredoc or script (LF endings), not the Write tool.
- [x] Step 2: In council.md, delete the marker block. Make every Step 5 fence
  that calls those helpers (5b at least; grep 5d-resume and 5e for
  `council_normalize_text|council_extract_fenced|council_assign_labels|council_fence_block`)
  source the library:
  - `COUNCIL_SYNTH_LIB="${CLAUDE_PLUGIN_ROOT}/lib/council-synthesis.sh"`
  - a `[ -f ] && [ ! -L ]` check that goes through the existing
    `council_synth_abort` path, naming the missing file
  - `. "$COUNCIL_SYNTH_LIB"`

  The Cancel / Step 8 / Step 9 cleanup blocks stay inline and source nothing.

<!-- deepen-plan: codebase -->
> **Codebase:** Only the 5b fence calls the four helpers (`council.md` L2005, 2044, 2060,
> 2078, 2091); 5d-resume and 5e call none. 5e will need the lib once Step 21
> adds `council_assign_bucket`.
>
> `council_synth_abort` is defined at L1964-1979, after the state load. To route
> a missing lib through it, place the `[ -f ] && [ ! -L ]` check and the `.`
> source after L1979 and before `LABEL_MAP` (L2005).
<!-- /deepen-plan -->

- [x] Step 3: Register the library under `tier4Libraries` in
  `scripts/shell-compat-config.json`. Add
  `tests/shell-compat/drivers/yellow-council--council-synthesis.sh`, modelled
  on `drivers/yellow-core--validate-fs.sh`. It sources the lib, runs each
  public function on a fixed input and prints `name=rc` plus a checksum of
  the output.
- [x] Step 4: Update `plugins/yellow-council/tests/synthesis.bats` to source
  `$PLUGIN_ROOT/lib/council-synthesis.sh` directly instead of calling
  `extract_synthesis_lib`. Remove the `extract_synthesis_lib` wrapper from
  `tests/lib/extract-synthesis-lib.bash`, but keep `extract_marked_lib` and
  `extract_fence_after`, which `quota-lineage.bats` uses. Rewrite that file's
  header comment (L1-16) so it no longer claims to extract the synthesis
  library.
  - About 12 tests extract the 5b fence and run it standalone
    (`synthesis.bats:522-524, 586, 617, 647, 713, 1229, 1325, 1446`). After
    Step 2 they reach `. "${CLAUDE_PLUGIN_ROOT}/lib/council-synthesis.sh"`.
    Make `run_in` (L56-66) export `CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"` under
    every profile.
  - Once Step 17 derives `MODE` from `$ARGUMENTS` in 5b, set `ARGUMENTS`
    (for example `review`) in each of those tests.

<!-- deepen-plan: codebase -->
> **Codebase:** About 12 existing tests extract the 5b fence and run it standalone with
> only a `sed` substitution of the `<literal CLAUDE_FENCED_FILE …>` placeholder
> (`synthesis.bats:522-524, 586, 617, 647, 713, 1229, 1325, 1446`). Once the
> fence sources `${CLAUDE_PLUGIN_ROOT}/lib/…`, `run_in` (L56-66) must export
> `CLAUDE_PLUGIN_ROOT` for all of them. After Step 17 they also need
> `$ARGUMENTS`, so the fence can derive `MODE`. Step 4 as written only changes
> how `$LIB` is loaded.
<!-- /deepen-plan -->

- [x] Step 5: Add a pinned-text test to `synthesis.bats` with two assertions:
  - council.md no longer contains `council-synthesis-lib` markers;
  - every council.md fence that calls a `council_` synthesis helper also
    sources `lib/council-synthesis.sh`.
- [x] Step 6: Record F1 in `plugins/yellow-council/CLAUDE.md`. Replace the
  L228-229 "between the `council-synthesis-lib` markers" sentence with "the
  synthesis helpers live in `lib/council-synthesis.sh` (Tier 4, sourced by
  the Step 5 fences); `synthesis.bats` sources it directly". Add a one-line
  rationale under a conventions heading.
- [x] Step 7: Run these and keep them green before Phase B:
  - `pnpm validate:shell-compat`
  - `pnpm check:shell-parse`
  - `pnpm test:shell-compat`
  - `bats tests/` (from `plugins/yellow-council`)
  - `node scripts/validate-council-roster.js --write-stamps`, then
    `node scripts/validate-council-roster.js`. Rule S flags any scanned file
    that mentions the council and names two or more reviewers, and
    `lib/council-synthesis.sh` and the test files qualify. Commit the
    refreshed `scripts/council-roster.json`. Repeat both after Phases C and
    E, which add `tests/verification.bats` and more lib code.

<!-- deepen-plan: codebase -->
> **Codebase:** Add Rule S to the Step 7 gate. In `scripts/validate-council-roster.js:998-1010`,
> any scanned file that matches `/council/i` and names ≥2 reviewers counts as
> restating the roster. `.sh`, `.bats` and `.bash` are scanned (`TEXT_EXT`
> ~L960). `tests/` is excluded only at the repo root (L205-228).
> - `lib/council-synthesis.sh` (it carries `self_alias` with all four names),
>   `tests/verification.bats` and `tests/lib/*.bash` will fail with "restates
>   the council roster but is not registered" (L1030-1038).
> - Run `node scripts/validate-council-roster.js --write-stamps` and commit
>   `scripts/council-roster.json`.
>
> Rule D1 matches `^for reviewer in ([a-z0-9 ]+); do$`, requires exactly one
> such line, and pins roster order (L527-545).
<!-- /deepen-plan -->

### Phase B — Normalizer fixes F3/F4 (plan step 1; R10 partial)

- [x] Step 8: **F3 — unclosed fence.** In `council_normalize_text`
  (`lib/council-synthesis.sh`), hold back the opening-fence line and every
  line after it while a fence is open.
  - At end of input with the fence still open, re-process the whole held
    block, opening line included, as ordinary text, with no cap.
  - A closed fence stays byte-for-byte.
  - Reword the library header comment ("Copies byte-for-byte: fenced code
    blocks…") to "closed fenced code blocks; an unclosed fence is normalized
    as ordinary text, its opening line included".
- [x] Step 9: **F4 — keep identifiers.** Rework emphasis stripping (`strip_emph`
  / `strip_words` / `strip_outside_code`).

  Rules for runs of `*`:
  - Strip a run only when a same-length run wraps the word or phrase on both
    sides (`**important**`, `*x*`).
  - Keep an unpaired leading or trailing `*` (`*ptr`).

  Rules for runs of `_` / `__`:
  - Strip only when they wrap a multi-word phrase (`__two words__`).
  - Keep a single word wrapped in underscore runs (`__init__`, `_x_`,
    `__important__`); treat it as an identifier.
  - Keep any unpaired edge underscore (`_private_fn`).
  - Never touch in-word underscores (`snake_case`).

  Where the state lives:
  - Hold the pairing state at line level, in the caller that walks the whole
    line, so an opener and its closer can straddle an inline code span.
  - Reset it at every newline.
  - Resolve a single-token wrap first, then pair a multi-word opener with the
    nearest same-length closer on the same line, skipping inline code spans
    untouched.
  - When a line ends with a run still open, keep the opener's emphasis
    characters but still run every following token through `scrub_self` and
    the other non-emphasis passes.

  Apply the rules after peeling leading `( [ {` and trailing
  `) ] } . , : ; ! ?`, and keep the peeled punctuation.

  F4 must not reach the `Evidence:` tail, which stays byte-for-byte: Step 12
  reads the verification quote from it.

<!-- deepen-plan: codebase -->
> **Codebase:** The awk must stay POSIX/mawk-safe (`council.md:1577`). "Nearest same-length
> closer" alone mis-pairs `*p = *q;`. The stripper also needs flanking checks:
> an opener at a word start and a closer at a word end.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** Under CommonMark 0.31.2, `__init__` is strong emphasis ("init"), and so is
> `**important**:`. `*ptr` and `*p = *q;` stay literal because they have openers
> and no closer. Intraword `_` cannot open or close, but intraword `*` can
> (`a*b*c` → `a<em>b</em>c`). Keeping single-identifier `__x__` is therefore a
> **deliberate deviation** from the spec; say so in SKILL.md's normalization
> section.
>
> Practical heuristic, from regex strippers that broke identifiers (openclaw
> PR #47465 / issue #58969, planderson PR #67, highlight.js #4279):
> 1. Mask code spans first.
> 2. Strip `_`/`__` only when the opener follows start, whitespace or non-`_`
>    punctuation, and the closer precedes end, whitespace or punctuation.
> 3. Never strip when the inner text matches `^[A-Za-z_][A-Za-z0-9_]*$`, or when
>    the run is preceded by `.` or followed by `(`.
> 4. Require the same boundaries for `*`.
>
> Consider adding goldens for `*p = *q;`, `a*b*c`, `**kwargs` and
> `**Note:**text` (literal under CommonMark).
> See https://spec.commonmark.org/0.31.2/ (examples 355-377).
<!-- /deepen-plan -->

- [x] Step 10: Golden cases in `synthesis.bats` (all run through `run_in`
  across shell profiles and awk binaries).

  F3:
  - a closed fence stays byte-identical;
  - an unclosed fence with a reviewer-name line and a bullet inside comes out
    scrubbed and flattened, opening line included.

  F4, single tokens:
  - kept as-is: `__init__`, `_private_fn`, `*ptr`, `snake_case`;
  - stripped: `**important**` and `__two words__`.

  F4, across inline code spans:
  - ``**two `code` words**`` → ``two `code` words``;
  - ``__two `code` words__`` → stripped the same way;
  - ``*ptr `x` y`` keeps its `*`;
  - `*ptr is handled differently by Codex` keeps the `*` and still scrubs
    the name;
  - a run opened on one line and closed on the next keeps its emphasis
    characters on both lines.

  F4, punctuation:
  - `__init__()`, `__init__.`, `(__init__)` and `*ptr,` stay intact;
  - `**important**:` → `important:`.

  Update the existing L98-137 case: `_unbounded_` now keeps its underscores.
  Run `bats tests/synthesis.bats` from `plugins/yellow-council`.

### Phase C — Verification helper (plan steps 2, 3, 6; R22, R23, R25)

- [x] Step 11: Add `"dependencies": [{"name": "yellow-core", "version": ">=2.8.0",
  "optional": false, "reason": "quote-ground.sh batch is the Tier 1 evidence
  check"}]` to `catalog/plugins/yellow-council.json`.
  - `optional` and `reason` follow the `catalog/plugins/yellow-review.json`
    precedent, but the upstream docs do not define them. Run
    `claude plugin validate plugins/yellow-council` on the generated manifest.
  - Run `pnpm generate:manifests`.
  - Refresh `tests/integration/generate-manifests-characterization.test.ts`
    with `pnpm vitest run tests/integration/generate-manifests-characterization.test.ts -u`.
  - Update `plugins/yellow-council/CLAUDE.md` L192 (Cross-Plugin
    Dependencies) to name the dependency. State that a missing, disabled or
    pre-2.8.0 yellow-core disables yellow-council, because Claude Code has no
    optional dependencies.

<!-- deepen-plan: codebase -->
> **Codebase:** Use `">=2.8.0"`, not `"*"`. `quote-ground.sh` first shipped in yellow-core
> 2.8.0, and older cached versions lack it (see the Expansion Decisions note).
> Running `pnpm generate:manifests` copies the range into `plugin.json`.
<!-- /deepen-plan -->

- [x] Step 12: In `lib/council-synthesis.sh`, add
  `council_extract_citations <label> <normalized-file> <tagged-out>`.
  - Walk one label's **normalized** text (the `council_normalize_text`
    output), skipping closed code fences. Normalization already turns every
    reviewer's finding header into one `severity=P<n> <file>:<line> …` line
    (`council.md` ~L1737-1747). That includes Codex's
    `**[P1] codex — file:line** Title.` header, which the raw
    `- [P1] <file>:<line> —` shape never matches. Normalization also keeps
    the `Evidence:` tail byte-for-byte (~L1723).
  - Number each `severity=P<n> <file>:<line>` line as `<label>-F<k>`, with k
    counting from 1 within the label.
  - Emit one JSONL row per finding on stdout: `{id, sev, file, line, quote}`.
    `quote` is the finding's first `Evidence: "…"` text before the next
    `severity=` line, with the outer quotes removed. A finding whose
    Evidence is `N/A — …` or missing gets `quote: null`. Every Codex finding
    takes this path (see Expansion Decisions).
  - Write `<tagged-out>`: the same normalized text with `[<id>] ` prefixed to
    each numbered `severity=` line. 5b builds `forward.txt` and `reverse.txt`
    from these tagged copies, so the ids Pass A sees are the ids in
    `verification.tsv`.
  - Build the JSON with `jq -cn --arg`, never by string concatenation.
  - Rows carry labels only, never reviewer names.

<!-- deepen-plan: codebase -->
> **Codebase:** **High risk: Codex findings have no `Evidence:` line.** They also don't use
> the `- [P1] file:line —` bullet. `plugins/yellow-codex/agents/review/codex-reviewer.md:555-560`
> emits `**[P1] codex — file:line** Title.` with `  Finding:` / `  [codex] confidence:`
> lines, and its record validator (L868-870) accepts only that shape. The raw
> regex in this step therefore never matches Codex. Even a looser match leaves
> every Codex finding `unverified/no-evidence`, a systematic penalty on one
> lineage.
> - Prefer enumerating from the **normalized** text. `council_normalize_text`
>   maps every severity spelling to `severity=P<n> file:line …`
>   (`council.md:1737-1747`) and keeps the `Evidence:` tail byte-exact (L1723).
>   That tail was built for `verify_finding()` (`council.md:1370, 1572`;
>   SKILL.md:1088-1106).
> - Then decide how Codex's evidence-less findings are classified.
> - `jq --arg line` (a string) is accepted by quote-ground (`quote-ground.bats:531-533`).
<!-- /deepen-plan -->

- [x] Step 13: In `lib/council-synthesis.sh`, add
  `council_core_lib <rel>`, ported from `sp_sibling_file`.
  - Look in `${CLAUDE_PLUGIN_ROOT}/../yellow-core/<rel>` first, then the
    newest numeric `${CLAUDE_PLUGIN_ROOT}/../../yellow-core/*/<rel>`.
  - `COUNCIL_CORE_LIB_DIR` is a test-only override; do not document it as a
    user env var.
  - Return non-zero when the file is not found.

<!-- deepen-plan: codebase -->
> **Codebase:** The cache layout `~/.claude/plugins/cache/yellow-plugins/<plugin>/<ver>/`
> holds yellow-core and yellow-council side by side, so
> `${CLAUDE_PLUGIN_ROOT}/../../yellow-core/*/` is right for cached installs.
> `sp_sibling_file` (`sibling-plugin.sh:12-26`) and `RL_CORE_LIB`
> (`review-ledger.sh:290-296`) are confirmed as the model.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** Claude Code warns that "a plugin's root path changes with every version",
> and the cache root can move with `CLAUDE_CODE_PLUGIN_CACHE_DIR`. Markdown
> fences get `${CLAUDE_PLUGIN_ROOT}` by text substitution; it is not exported to
> the processes they start. When both directory probes miss, the
> documented-stable fallback is to resolve `installPath` from
> `claude plugin list --json`.
> See https://code.claude.com/docs/en/plugins/loading.md and
> https://code.claude.com/docs/en/plugins-reference
<!-- /deepen-plan -->

- [x] Step 14: In `lib/council-synthesis.sh`, add
  `council_verify_findings <mode> <in.jsonl> <out.tsv>`, the batch engine.
  Output rows are `id<TAB>file<TAB>line<TAB>result<TAB>tier<TAB>reason`
  (`file` and `line` copied from the citation row), with `result` one of
  `verified`, `fuzzy-verified` or `unverified`. Also add
  `verify_finding <mode> <file> <line> <quote>`, the spec-named one-citation
  wrapper over the same code path.

  Order of operations:
  1. **Strict citation parse, before any file read.** Check the following.
     Any failure gives `unverified` with reason `bad-citation`, and no read is
     attempted.
     - the path matches the quote-ground ASCII allowlist and is
       repo-relative, with no leading `/` or `~` and no `..` segment;
     - `line` matches `^[1-9][0-9]{0,6}$`;
     - `validate_file_path` passes against the git root (sourced from
       yellow-core `lib/validate-fs.sh` via `council_core_lib`);
     - the target is a regular file;
     - `line` ≤ its line count (`awk 'END{print NR}'`).

     `quote: null` gives `unverified` with reason `no-evidence`.
  2. **Choose the target per mode.**
     - `plan`, `debug` and `question` read the working tree.
     - `review` reads the working tree only when
       `git diff --quiet HEAD -- <file>` succeeds. Otherwise the row skips
       Tier 1, and Tier 2 reads `git show HEAD:<file>`.
     - With no git work tree, Tier 1 is skipped for every row.
  3. **Tier 1.** Make one `bash "$QG" batch` call with the cwd at the git
     root. `$QG` comes from `council_core_lib lib/quote-ground.sh`.
     - `grounded` → `verified` (tier 1).
     - `too-short` → `unverified` (reason `too-short`; no Tier 2).
     - `unsafe-path` → `unverified` (`bad-citation`).
     - `ungrounded` → becomes a Tier 2 candidate.
     - A missing quote-ground or batch exit 2: warn on stderr and make every
       still-pending row a Tier 2 candidate. Never abort.
  4. **Tier 2 (R25 cap).** Only each label's top 50 candidates are checked,
     ranked by `sev` P1 > P2 > P3, then k. The rest are `unverified` with
     reason `tier2-cap`.
     - Build the ±3 window from the chosen target.
     - Redact the quote and each window line with `cs_redact_secrets`
       (yellow-core `lib/compound-staging.sh`, sourced via
       `council_core_lib`). Map `[REDACTED:<type>]` to `[REDACTED]` and
       apply the same whitespace normalization as quote-ground.
     - Send `{id, quote, lines[]}` JSONL on stdin to
       `python3 "${CLAUDE_PLUGIN_ROOT}/lib/fuzzy-ratio.py"`.
     - A max score ≥ 85 (Step 15's scorer) → `fuzzy-verified` (tier 2). Otherwise
       `unverified` (reason `no-match`).
  5. Every input id appears exactly once in the output, in input order.

<!-- deepen-plan: codebase -->
> **Codebase:** quote-ground behaviours that Step 14 must handle (confirmed by running it):
> - **Unreadable file.** One unreadable cited file makes the **whole batch**
>   exit 2 (`quote-ground.sh` ~L296-302, `qg_ground_rows`; reproduced with
>   `chmod 000`). Add a `-r` pre-check in the strict parse.
> - **Outside a git repo.** quote-ground falls back to `pwd -P` and returns
>   rows silently `ungrounded`, not exit 2. The "no work tree → skip Tier 1"
>   check must live in the council.
> - **bash version.** quote-ground execs `bash` and needs ≥4.4; council itself
>   only needs 4.3+ or zsh.
> - **Redaction cost.** `cs_redact_secrets` forks sed and awk per call; up to
>   350 window lines per label is slow. Batch lines with an end-mark, as
>   `qg_flush` does (L170-201).
> - **Redaction failure.** On failure it prints `[REDACTED: sanitization failed]`
>   and returns 1 (`compound-staging.sh` ~L276-279). Map that to
>   `verifier-error`.
> - **Multi-line private keys.** The sed range for private keys collapses when
>   fed one line at a time, so a key body line could reach `fuzzy-ratio.py`
>   (local exposure only). quote-ground tracks these ranges in awk.
> - **Output format.** It emits `[REDACTED:<type>]`, but some patterns emit a
>   plain `[REDACTED]`. The planned mapping covers both.
<!-- /deepen-plan -->

- [x] Step 15: Add `plugins/yellow-council/lib/fuzzy-ratio.py`, a small
  script using stdlib plus `rapidfuzz`.
  - Read JSONL from stdin and write `{id, score}` to stdout for each row.
    `score` is the max over `lines` of `fuzz.ratio(quote, line)`, together
    with `fuzz.partial_ratio(quote, line)` when `quote` has at least 16
    characters (see "Tier 2 scores fragments too" in Expansion Decisions).
  - Take no argv data and touch no files.
  - Exit 3 when `rapidfuzz` cannot be imported, so the caller can tell
    "skipped" from "failed".

<!-- deepen-plan: external -->
> **Research:** `fuzz.ratio` is normalized Indel similarity:
> `100·(1 − dist/(len1+len2))`.
> - **Whole-line near-miss.** `ratio` fits. At 85, a 40-char quote vs a 40-char
>   line tolerates about 6 substitutions. Prior art puts 85 mid-range:
>   Microsoft ASSERT uses 88 with a 16-char minimum and a 3-point margin;
>   LegalQuants lq-ai uses ratio ≥95 and notes paraphrases score 70-90.
> - **Fragment of a longer line.** `ratio` fails by construction: a 20-char
>   exact fragment of a 60-char line scores at most 50.
>   - Consider `max(ratio, partial_ratio if len(quote) >= 16)` per window line.
>   - Also score the window lines joined with spaces, to catch multi-line quotes.
>   - R22 names `ratio`, so this is a spec note.
> - **`token_set_ratio`.** Avoid it for code: any superset scores 100.
> - **`process.extractOne(quote, lines, scorer=fuzz.ratio, score_cutoff=85)`.**
>   It returns `(choice, score, index)` or `None`. Pass `scorer` explicitly,
>   since the default is `WRatio`; `processor` has defaulted to `None` since
>   3.0. All of this exists in Ubuntu noble's 3.6.2.
> See https://rapidfuzz.github.io/RapidFuzz/Usage/fuzz.html and
> https://rapidfuzz.github.io/RapidFuzz/Usage/process.html
<!-- /deepen-plan -->

- [x] Step 16: **Optional dependency (R23).** In `lib/council-synthesis.sh`,
  add `council_have_rapidfuzz`, which runs
  `command -v python3 >/dev/null && python3 -c 'import rapidfuzz'` and
  caches the result in a variable.
  - In council.md Step 1, after the required-tools loop, print one warning
    when it is absent:
    `[council] Warning: rapidfuzz not installed — Tier 2 fuzzy evidence verification skipped (Debian/Ubuntu: sudo apt install python3-rapidfuzz; elsewhere: pip install rapidfuzz)`.
  - When absent, Tier 2 candidates become `unverified` with reason
    `tier2-skipped`.
  - Do not add python3 to the required-tools loop.

<!-- deepen-plan: codebase -->
> **Codebase:** - **Placement.** Step 1 runs before mode dispatch, so a warning there prints
>   on bare `/council` and `/council fleet`; Step 2b exists so help does not
>   trigger probes. Emit the warning in Step 2b, after mode dispatch, or at the
>   start of 5b.
> - **Install hint.** This machine's Python is externally managed
>   (`/usr/lib/python3.12/EXTERNALLY-MANAGED`), so `pip install rapidfuzz`
>   fails. `apt-cache policy python3-rapidfuzz` shows 3.6.2+ds-1.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** For the warning text, PEP 668 systems need a different hint than
> `pip install rapidfuzz`:
> - Debian/Ubuntu: `sudo apt install python3-rapidfuzz`. This is what the
>   Debian PEP 668 error itself recommends.
> - A venv hint only works if the `python3` that `fuzzy-ratio.py` runs under is
>   the venv's interpreter.
> - No Homebrew `rapidfuzz` formula was found, so do not suggest
>   `brew install`.
> - The current RapidFuzz README lists Python ≥3.11 for the latest releases;
>   older Pythons get older 3.x wheels with the same API.
> See https://packaging.python.org/en/latest/specifications/externally-managed-environments/
> and https://docs.brew.sh/Language-Runtimes-and-Packages
<!-- /deepen-plan -->

- [x] Step 17: **Concurrent with prompt construction (R25).** In the council.md
  5b fence, after each label's text is normalized (~L2044-2091) and before
  `forward.txt`/`reverse.txt` are written (~L2104):
  - Build `$SYNTH_DIR/citations.jsonl` from each label's normalized text with
    `council_extract_citations`. Build forward and reverse from the id-tagged
    copies it writes.
  - Start `council_verify_findings "$MODE" … >| "$SYNTH_DIR/verification.tsv.tmp" &`
    and record the pid.
  - Build forward and reverse, then `wait "$verify_pid"`.
    - Success: `mv` the temp file to `$SYNTH_DIR/verification.tsv`.
    - Either way, print `COUNCIL_SYNTH_VERIFICATION=$SYNTH_DIR/verification.tsv`.
      Update the prose after the 5b fence (~L2120) so it tells Pass A to Read
      that file.
    - Non-zero: warn, and write `verification.tsv` with every id
      `unverified` and reason `verifier-error`.

  Verification never gates or discards a finding. `MODE` must reach this
  fence; carry it the same way the fence already gets its other Step 2
  values, and check that against the fence. The block must stay Tier 1
  dual-shell: `>|`, no `status` or `path` names, and quoted expansions.

<!-- deepen-plan: codebase -->
> **Codebase:** - **No Step 2 values today.** The 5b fence's only substituted literal is
>   `CLAUDE_FENCED` (L1858). Everything else comes from
>   `.git/council-synth.state` and `council-state.tsv`.
> - **Deriving `MODE`.** Each fence re-derives `MODE` from `$ARGUMENTS` (Step 6
>   at `council.md:2596`; the convention is at L34-37). 5b needs
>   `MODE=$(printf '%s' "$ARGUMENTS" | awk '{print $1}')`.
> - **Fence positions.** `LABEL_MAP` is set at L2005; `forward.txt` and
>   `reverse.txt` are written at L2104-2113.
> - **Orphaned verifier.** If `council_synth_abort` fires between `&` and
>   `wait`, the background verifier is orphaned. Kill `$verify_pid` on the
>   abort path.
> - **`wait` semantics.** `cmd & pid=$!; wait "$pid"` propagates the exit status
>   identically under bash, `zsh -f`, `zsh -f -o noclobber` and `-o monitor`,
>   with no job messages in non-interactive shells. Wait exactly once: a second
>   `wait` on a reaped pid returns 127 in zsh ("not a child of this shell").
<!-- /deepen-plan -->

- [x] Step 18: Bats coverage in a new `plugins/yellow-council/tests/verification.bats`.
  Source the lib, point `COUNCIL_CORE_LIB_DIR` at
  `plugins/yellow-core/lib`, and run in a temp git repo built in `setup`.

  Cases:
  - Tier 1 hit: an exact quote within ±3 → `verified`.
  - Tier 2 hit: a near-miss quote gives `fuzzy-verified` when rapidfuzz is
    importable. Otherwise `skip` with the reason, and CI installs rapidfuzz
    (see Step 33).
  - Tier 2 fragments:
    - an exact fragment of a longer line, at least 16 characters long, gives
      `fuzzy-verified`;
    - a shorter fragment gives `unverified` / `no-match`.
  - Miss → `unverified` / `no-match`.
  - `too-short`.
  - Citation safety → `bad-citation` with no read, covering:
    - `../x`, an absolute path and `~` paths;
    - line `0`, `-1`, `1e3` and a line beyond EOF;
    - a symlink escaping the repo.
  - `no-evidence`.
  - The Tier 2 cap at 51 findings for one label.
  - rapidfuzz absent → `tier2-skipped`, with the python check shimmed to
    fail.
  - quote-ground missing → Tier 2 fallback plus a warning.
  - `review` mode with a dirty cited file skips Tier 1.
  - Ids are label-only and in input order.
  - `council_extract_citations` numbering skips findings inside closed
    fences.
  - A Codex-shaped finding (`**[P1] codex — file:line** Title.` plus a
    `Finding:` line, passed through `council_normalize_text` first) gets an
    id and `no-evidence`.
  - Every `[<id>]` prefix in the tagged text matches a `verification.tsv` row
    with the same `file` and `line`.

### Phase D — Five buckets and a verification-backed rubric (plan steps 4, 5; R15, R24)

- [x] Step 19: Add `council_assign_bucket <citations> <conflict yes|no>
  <correctness>` to `lib/council-synthesis.sh`. It prints exactly one of
  `Agreement (verified)`, `Agreement (unverified)`, `Disagreement`,
  `Single-Reviewer Findings (verified)` or `Unverified Claims`.

  Precedence:
  1. `citations` = 1 → `Single-Reviewer Findings (verified)` when correctness
     is `verified` or `fuzzy-verified`, else `Unverified Claims`.
  2. `citations` ≥ 2 with `conflict=yes` → `Disagreement` (beats Agreement).
  3. `citations` ≥ 2 with `conflict=no` → Agreement, split by correctness.

  Add a golden table of every combination to `synthesis.bats`.
- [x] Step 20: Rewrite council.md 5c Pass A (L2142-2195).
  - **Enumerate** uses the `[S<n>-F<k>]` ids already written into
    `forward.txt` and `reverse.txt`. Each one matches a `verification.tsv`
    row (with `file` and `line`), which Pass A reads with the Read tool from
    the `COUNCIL_SYNTH_VERIFICATION` path. Pass A may not invent, renumber
    or drop ids.
  - **Score:** correctness is copied from that finding's `verification.tsv`
    row. A finding is not scored before its row is read. `fuzzy-verified`
    renders as `fuzzy-verified (fuzzy match)`.
  - Replace the L2183-2189 self-assessment paragraph with the
    verification-backed rule. The rubric domains and the
    `well-supported`/`weakly-supported` combination rule stay unchanged.
  - The Agreement group's correctness is the best contributing result.
  - Add `group`, `citations` and `conflict` columns to the Pass A table and
    to `pass-a.md`. Check that the 5d-resume table-shape check (L2289)
    still accepts it.

<!-- deepen-plan: codebase -->
> **Codebase:** The 5d-resume table-shape check (`council.md:2289-2293`) only requires every
> non-blank line to start with `|`, so the extra `group`, `citations` and
> `conflict` columns pass.
<!-- /deepen-plan -->

- [x] Step 21: In council.md 5e, after the label map is printed and before
  `rm -rf -- "$SYNTH_DIR"`:
  - Read `pass-a.md` and run `council_assign_bucket` per row.
  - Print `BUCKET <id> <bucket>` lines for the synthesizer to copy.
  - Check that every id in `verification.tsv` gets exactly one bucket. A
    missing id is printed as `Unverified Claims` with a stderr warning, never
    dropped.
  - Pass B flips do not change buckets: buckets come from Pass A only.

<!-- deepen-plan: codebase -->
> **Codebase:** - **5e reads nothing today.** The 5e fence (`council.md:2322-2423`) does not
>   read `pass-a.md`; it ends with the label map and `rm -rf`.
> - **Recompute correctness.** Have 5e recompute each id's correctness from
>   `verification.tsv` instead of trusting the model-copied value in `pass-a.md`.
> - **Fail closed.** `council_assign_bucket` should map malformed `citations`
>   (non-integer, 0) or `conflict` (not `yes`/`no`) values to
>   `Unverified Claims`, with a warning on stderr.
<!-- /deepen-plan -->

- [x] Step 22: Rewrite the Step 5 output template (L2484-2584).
  - Replace the Agreement/Disagreement sections with the five headings, in
    order: `### Agreement (verified)`, `### Agreement (unverified)`,
    `### Disagreement`, `### Single-Reviewer Findings (verified)`,
    `### Unverified Claims`.
  - Each Unverified Claims entry shows its reason (`no-match`, `too-short`,
    `bad-citation`, `no-evidence`, `tier2-cap`, `tier2-skipped`,
    `verifier-error`).
  - The per-finding rubric line drops `(self-assessed)`.
  - Rewrite synthesizer rule 3 to "copy the `BUCKET` lines; never choose a
    bucket".
  - Rule 5 drops "until citation verification lands". Rule 6 notes that ties
    annotate but never move a finding.
  - Add a rule that unverified findings are always listed.
  - Add a pinned-text check to `synthesis.bats` that the five headings
    appear in that order.

### Phase E — F2: Step 7 report staging (plan step 7)

- [ ] Step 23: Split council.md Step 7's report block into a cross-call
  lifecycle, under headings `#### 7a — stage` and `#### 7c — assemble` so
  `extract_fence_after` can find each fence.

  **7a block** (no trap):
  1. Run `mktemp -d /tmp/council-synth-XXXXXX`.
  2. Write a 32-hex token (`od -An -N16 -tx1 /dev/urandom | tr -d ' \n'`)
     to `<dir>/.token` with `>|`.
  3. Print the complete `COUNCIL_REPORT_FILE=<dir>/synthesis.md` and, on a
     separate line, `COUNCIL_REPORT_TOKEN=<hex>`.

  **7b:** `Write` stages `SYNTHESIS_MD` to exactly that printed path.

  **7c block:** carries both values as literals. Do not reread the expected
  token from the directory.
  1. Validate the dir:
     - strip the `/tmp/council-synth-` prefix with `case`; reject when it is
       unchanged, empty, `*/*` or `*..*`;
     - the dir is `-d`, `! -L` and `-O`;
     - the literal token is 32 hex characters;
     - `.token` is `-f` and `! -L`, and equals the literal token.

     Refuse and stop on any mismatch. Never delete on the name alone.
  2. Arm `trap` to remove the dir on every exit. The trap body repeats the
     dir validation before `rm -rf -- "<dir>"`.
  3. Validate that the file is exactly `<dir>/synthesis.md`, `-f`, `! -L`
     and `-O`.
  4. `REPORT_CONTENT=$(cat -- "<dir>/synthesis.md")`, then run the rest of
     Step 7 unchanged.

  Keep exactly one column-0 `for reviewer in claude codex gemini opencode; do`
  line in council.md (Rule D1); the `STATE_REVIEWERS` loops are exempt.

  Retarget the four existing
  `extract_fence_after "$COUNCIL_MD" '### Step 7'` calls
  (`synthesis.bats:1139, 1179, 1487, 1600`) to `'#### 7c'`. After the split,
  `'### Step 7'` resolves to the 7a fence, and those tests would silently
  run the wrong block.

<!-- deepen-plan: codebase -->
> **Codebase:** - **Existing callers.** Four existing calls,
>   `extract_fence_after "$COUNCIL_MD" '### Step 7'`
>   (`synthesis.bats:1139, 1179, 1487, 1600`), would silently get the 7a fence
>   after the split, because the helper takes the first bash fence after the
>   heading. Retarget them to `'#### 7c'`.
> - **Existing placeholder.** The Step 7 fence already has a
>   `<literal COUNCIL_SYNTH_DIR value from 5a>` placeholder (`council.md:2718`)
>   and `SYNTH_OWN_DIR` / `SYNTH_STATE_CLAIMED` state cleanup (L2707-2776).
>   Give the new 7a/7c literals distinct names and a defined relationship to it.
> - **Trap.** The 7c trap must compose with `council_cleanup_claude_only` rather
>   than replace it.
<!-- /deepen-plan -->

- [ ] Step 24: Remove the `<<'__EOF_COUNCIL_SYNTHESIS__'` heredoc (L2783-2788)
  and sweep what it leaves behind.
  - Keep the `__EOF_COUNCIL_SYNTHESIS__` escape in `council_fence_block` and
    Step 5e as defense in depth, and keep the `synthesis.bats` delimiter
    golden case.
  - Reword 5e quoting rule 1 (L2460-2467) so it no longer claims Step 7 uses
    a heredoc.
  - Update the comments that name the Step 7 heredoc: the
    `council_fence_block` escape-set comment (now in the lib), the "inline
    via quoted heredoc" comment, and both "Step 7's heredoc text lands in the
    report" comments (~L3493, ~L3631).
- [ ] Step 25: Document the residuals.
  - **Step 7 prose:** `Write` is not path-scoped. The guarantee is that
    nothing destructive trusts a relayed path, and a stray write outside the
    validated file is never read or deleted. The real mitigation is a `Write`
    deny rule.
  - **Failure Modes table:** add a row next to the 5a-5e rows for a run that
    is cancelled or aborts between 7a and 7c. The 0700 dir with the staged
    synthesis remains until the next run's 5a sweep removes it after 24
    hours. A failed `Write` is still cleaned up by the 7c trap.

<!-- deepen-plan: codebase -->
> **Codebase:** `docs/security.md:771-880` ("Synthesis staging directory (yellow-council)")
> already documents the 5a staging validation and the Write residual. Add the
> 7a/7c lifecycle and its residual there too.
<!-- /deepen-plan -->

- [ ] Step 26: Bats cases in `synthesis.bats`. Extract the 7a and 7c fences
  with `extract_fence_after` and run them across `run_in` profiles.
  - path guards: wrong prefix, `..`, an extra `/`, an empty suffix;
  - a symlinked dir and a symlinked `synthesis.md`;
  - wrong-owner checks, where feasible (skip when running as root);
  - token mismatch and non-hex token → refused, and nothing deleted;
  - trap ordering: a rejected path never reaches `rm -rf`;
  - a successful read: content round-trips byte-exact, including a line
    equal to `__EOF_COUNCIL_SYNTHESIS__`;
  - a missing file (failed `Write`) → the validated dir is still removed.

### Phase F — Finalization sweep (plan step 8; R26-R30)

- [ ] Step 27: **R26.** Bring
  `plugins/yellow-council/skills/council-patterns/SKILL.md` into lockstep:
  - the 4-reviewer list, with claude as the in-process exception;
  - per-reviewer invocation blocks;
  - the Synthesis Contract (L1063 onward): double-blind, 2-pass/tie, the
    rubric with verification-backed correctness (L1158-1169), style
    normalization with F3/F4 (L1088), and the five buckets with precedence
    (L1170);
  - `verify_finding()` usage:
    - tiers, mode targets, the cap, the reasons and the optional rapidfuzz;
    - the Tier 2 scorer (`ratio` plus `partial_ratio` at 16 or more
      characters), stated as an R22 override;
    - the Codex `no-evidence` limitation.

  Remove every "until … lands" phrase.
- [ ] Step 28: **R27.** Check that `COUNCIL_DOUBLE_PASS_SYNTHESIS` and
  `COUNCIL_OPENCODE_MODEL` appear in both the 4-column table
  (`plugins/yellow-council/CLAUDE.md` L205-214) and the 3-column table
  (council.md ~L3738-3747), plus the Step 2 help `printf` (~L114-137). This
  shell adds no user env var; `COUNCIL_CORE_LIB_DIR` is test-only.

<!-- deepen-plan: codebase -->
> **Codebase:** R27 is already satisfied. `COUNCIL_DOUBLE_PASS_SYNTHESIS` and
> `COUNCIL_OPENCODE_MODEL` appear in the Step 2 help `printf` (`council.md`
> L130-136), the CLAUDE.md table (L210, L214) and the council.md configuration
> table. This step is verify-only.
<!-- /deepen-plan -->

- [ ] Step 29: **R28.** Update `plugins/yellow-council/CLAUDE.md`:
  - Component counts (L131/L148/L180): Commands (2), Agents (3), Skills
    (1). Recount from disk, and add the `lib/` files if the file lists
    components.
  - Required Environment (L16-37): python3 + rapidfuzz as optional for
    Tier 2, with the same install hint as the Step 16 warning
    (`sudo apt install python3-rapidfuzz` on Debian/Ubuntu, where pip is
    blocked by PEP 668; `pip install rapidfuzz` elsewhere); yellow-core as
    required for Tier 1.
  - The synthesis bullet (L86-100): drop "self-assessed until …".
  - Known Limitations:
    - the Write residual from Step 25;
    - Codex findings always land in Unverified Claims (`no-evidence`),
      because yellow-codex emits no quoted line.

  File a follow-up issue against yellow-codex with `gh issue create`, asking
  codex-reviewer to emit an `Evidence:` quote, and link it from Known
  Limitations.

  Update `plugins/yellow-council/README.md`: the Output section (L72, five
  buckets), the lineage map (L128-133), and "V1 / V2" (L179-184, verification
  shipped). Update the council.md V2 Trajectory (L3749): verification is no
  longer future. The CHANGELOG comes from the changeset; do not edit it by
  hand.

<!-- deepen-plan: codebase -->
> **Codebase:** Sync targets missing from this step:
> - `skills/council-patterns/SKILL.md` ~L1178-1184 lists "quote verification"
>   under remaining deferred features. It needs the same edit as `council.md`
>   L3749-3756.
> - Stale "shell 05" wording at `council.md:1370, 1572, 2185`.
> - `plugins/yellow-core/README.md:158-162` ("The later council shell 05 PR
>   calls …") goes stale. Editing it needs a **yellow-core changeset** as well.
> - `plugins/yellow-council/commands/council/setup.md` (in the roster
>   `SCAN_FILES`) has no line for rapidfuzz, iconv, bash ≥4.4 (for
>   quote-ground) or the yellow-core dependency.
<!-- /deepen-plan -->

- [ ] Step 30: **R29.** In `docs/testing/yellow-council-manual-tests.md`, add
  `2.6 — Evidence verification` with these scenarios: Tier 1 hit, Tier 2 hit
  (rapidfuzz installed, a whitespace/word-level near-miss quote), a miss
  landing in Unverified Claims with its reason, a Codex-only finding in
  Unverified Claims with `no-evidence`, and rapidfuzz absent (the warning,
  then `tier2-skipped`). Then audit the file for the rest of R29 and
  add any that are missing as `2.x`/`3.x` scenarios in the existing format:
  - all-4-APPROVE;
  - one reviewer QUOTA_EXHAUSTED with an ETA matching the provider error;
  - the lineage-collision warning;
  - the OpenCode resolved slug in the report header;
  - a verdict flip presented as a tie;
  - the `--single-pass` bypass;
  - rubric dimensions present in the output.

<!-- deepen-plan: codebase -->
> **Codebase:** - **Already covered.** QUOTA_EXHAUSTED ETA (3.6), lineage collision plus the
>   resolved OpenCode slug (3.7), and verdict flip as a tie, `--single-pass`
>   and rubric dimensions (2.5).
> - **Missing.** All-4-APPROVE and the verification tiers.
> - **Stale.** 2.5 (`docs/testing/yellow-council-manual-tests.md:137-141`)
>   asserts "Agreement / Disagreement" and `correctness … (self-assessed)`.
>   Update it alongside adding 2.6.
<!-- /deepen-plan -->

- [ ] Step 31: **R30 changesets.** Add
  `.changeset/council-evidence-verification.md` with
  `'yellow-council': minor` and a `feat:` title, plus bullets for
  verification, the five buckets, F1-F4 and the yellow-core dependency.
  Check that shells 01-04 each shipped a changeset: grep
  `plugins/yellow-council/CHANGELOG.md` and `git log --diff-filter=A
  -- .changeset/` for the earlier council changesets. Report any gap rather
  than back-filling.

<!-- deepen-plan: codebase -->
> **Codebase:** `plugins/yellow-council/CHANGELOG.md` has entries for shells 02-04: #705
> (claude-reviewer), #948/#971 (0.4.0), #984 (0.4.1) and #992 (0.5.0). A shell
> 01 council changeset could not be confirmed, so report it as a gap.
> `.changeset/` holds no council file now. A yellow-core patch changeset is
> needed if its README note is edited (see Step 29).
<!-- /deepen-plan -->

- [ ] Step 32: Run `pnpm lint:plugins` and `pnpm validate:agents` after the
  markdown edits, and fix anything flagged.
- [ ] Step 33: CI coverage. The job that runs the yellow-council bats suite
  (`plugin-shell-tests`, `.github/workflows/validate-schemas.yml:1436-1499`)
  runs on `ubuntu-latest` (24.04), where `pip install` fails under PEP 668.
  - Add `python3-rapidfuzz` to its existing `apt-get install gawk zsh` line
    (L1467), so the Tier 2 cases run rather than skip.
  - Do not add `actions/setup-python`: its `python3` would shadow the apt
    package.
  - The rapidfuzz-absent case stays covered by the shimmed import check in
    Step 18.
  - Check that the run still fits the job's 15-minute cap (L1445).

<!-- deepen-plan: codebase -->
> **Codebase:** `plugin-shell-tests` is at `.github/workflows/validate-schemas.yml:1436-1499`.
> It runs on `ubuntu-latest` (24.04) with a 15-minute cap (L1445). Its only
> provisioning is `npm i -g bats` (L1456) and `apt-get install gawk zsh`
> (L1467). CI has no Python setup and no pip anywhere; the only `python3` use is
> a heredoc at L1716.
> - **Install.** `pip install rapidfuzz` fails under PEP 668. Add
>   `python3-rapidfuzz` to the existing apt line at L1467 instead.
> - **Dead citation.** The doc cited above,
>   `docs/solutions/build-errors/when-a-bats-test-skips-on-a-missing-tool-ci-can-ke.md`,
>   **does not exist in this tree**. It lives only on the unmerged branch
>   `agent/docs/sweep-promoted-learnings` (6275f44d4). Drop the citation or
>   mark it pending.
> - **Timing.** Check the 15-minute budget once `verification.bats` is added.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** Two conventional CI options:
> - **`actions/setup-python` + `python -m pip install rapidfuzz==X`.** This is
>   GitHub's documented path and the maintainer fix in runner-images #10781.
>   It changes `python3` for every later step in the job.
> - **`sudo apt-get install -y python3-rapidfuzz`.** Noble ships 3.6.2+ds-1 from
>   universe. This is lowest-friction when the job uses system `python3`. It is
>   invisible if setup-python runs anywhere in the job, and runner apt
>   occasionally flakes with "dpkg was interrupted" (runner-images #13259).
>
> `--break-system-packages` works but bypasses PEP 668 deliberately.
> `pip --user` is blocked too, and `pipx` cannot provide an importable library.
> Since the dependency is optional, keep the shimmed no-rapidfuzz path in the
> suite as well.
> See https://github.com/actions/runner-images/issues/10781 and
> https://www.ubuntuupdates.org/package/core/noble/universe/base/python3-rapidfuzz
<!-- /deepen-plan -->

## Edge Cases

<!-- deepen-plan: codebase -->
> **Codebase:** Expect a high Unverified Claims volume. Review packs do not number their
> excerpt lines; a grep of `council.md` and SKILL.md finds line-numbering only in
> redaction comments. Reviewers therefore estimate line numbers, and many
> citations will fall outside ±3. Consider printing per-reason counts in the
> report, and treat the manual `2.6` run as calibration before tightening or
> loosening the window.
<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->
> **Codebase:** Verification adds new failure surfaces that the Failure Modes table (`council.md`
> L3700, 5a-5e rows L3729-3733) should list:
> - quote-ground exiting 2 for the whole batch on one unreadable file;
> - `cs_redact_secrets` returning its sanitization-failed sentinel;
> - an orphaned background verifier when 5b aborts before `wait`;
> - `python3` present but not the interpreter that has rapidfuzz installed (venv
>   or setup-python mismatch). The import probe and the actual run must use the
>   same `python3`.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** Because a declared dependency is hard, a user whose yellow-core is
> disabled, or older than the range, gets yellow-council **disabled entirely**,
> not a degraded Tier 1. Mention this in CLAUDE.md "Cross-Plugin Dependencies"
> and in setup.md. See https://code.claude.com/docs/en/plugins/troubleshooting.md
<!-- /deepen-plan -->

## Verification

- `pnpm validate:shell-compat` → expected: no SHC errors; `lib/council-synthesis.sh` classified Tier 4
- `pnpm check:shell-parse` → expected: all edited council.md fences parse under bash and zsh
- `pnpm test:shell-compat` → expected: `yellow-council--council-synthesis.sh` driver passes under bash, zsh and zsh+noclobber
- `cd plugins/yellow-council && bats tests/` → expected: all of `synthesis.bats` (F3/F4 goldens, buckets, Step 7 lifecycle, pinned-text checks), `verification.bats`, `redaction.bats` (awk copies byte-identical), `extract.bats` and `quota-lineage.bats` pass
- `cd plugins/yellow-core && bats tests/quote-ground.bats` → expected: unchanged and green
- `node scripts/validate-council-roster.js` → expected: Rule D1 passes (one column-0 roster loop); Rule S finds every new lib and test file registered in `scripts/council-roster.json`
- `pnpm generate:manifests && pnpm validate:generated` → expected: no drift; yellow-council `plugin.json` lists the yellow-core dependency
- `pnpm validate:schemas && pnpm test:unit && pnpm test:integration && pnpm lint && pnpm typecheck` → expected: green
- `pnpm validate:agents && pnpm lint:plugins` → expected: green
- `pnpm validate:versions` → expected: no drift
- Manual: `/council review` on a branch with a known-good citation, a near-miss quote and a fabricated quote → expected: one finding in each of Agreement/Single-Reviewer (verified), a `fuzzy-verified (fuzzy match)` rubric line, and an Unverified Claims entry with reason `no-match`. Then run the manual-test doc `2.6` scenarios.

## Context Files

- `plugins/yellow-council/commands/council/council.md` — orchestrator: Step 1 pre-flight, Step 5 synthesis, Step 7 report, failure-mode and config tables
- `plugins/yellow-council/lib/council-synthesis.sh` — (new) moved synthesis library, plus the verification and bucket helpers
- `plugins/yellow-council/lib/fuzzy-ratio.py` — (new) Tier 2 rapidfuzz ratio over stdin
- `plugins/yellow-core/lib/quote-ground.sh` — Tier 1 batch engine (execute only)
- `plugins/yellow-core/lib/validate-fs.sh`, `plugins/yellow-core/lib/compound-staging.sh` — `validate_file_path`, `cs_redact_secrets` (Tier 4, sourceable)
- `plugins/yellow-review/lib/sibling-plugin.sh` — `sp_sibling_file`, the model for `council_core_lib`
- `plugins/yellow-council/tests/synthesis.bats`, `tests/lib/extract-synthesis-lib.bash`, `tests/redaction.bats`, `tests/quota-lineage.bats` — existing test harness
- `scripts/shell-compat-config.json`, `tests/shell-compat/tier4-libraries.bats`, `tests/shell-compat/drivers/yellow-core--validate-fs.sh` — Tier 4 registration and driver model
- `scripts/validate-council-roster.js` — Rule D1 (single roster loop)
- `catalog/plugins/yellow-council.json`, `catalog/plugins/yellow-review.json` — dependency declaration
- `plugins/yellow-council/CLAUDE.md`, `plugins/yellow-council/README.md`, `plugins/yellow-council/skills/council-patterns/SKILL.md`, `docs/testing/yellow-council-manual-tests.md` — finalization sweep targets
- `plans/complete/yellow-council-v2-four-cli-03-synthesis-bias-mitigation.md` — handoff contract (L13-34, L143, L193)
- `docs/solutions/code-quality/trap-cleanup-across-tool-call-boundaries.md`, `docs/solutions/security-issues/shell-owned-state-is-not-a-boundary-against-write.md` — F2 staging shape and residual wording

## References

<!-- deepen-plan: external -->
> **Research:** External sources consulted by `/flow:deepen-plan` (2026-10-14):
> - rapidfuzz scorers: https://rapidfuzz.github.io/RapidFuzz/Usage/fuzz.html ,
>   https://rapidfuzz.github.io/RapidFuzz/Usage/process.html ,
>   https://github.com/rapidfuzz/RapidFuzz
> - Citation-grounding prior art: https://github.com/responsibleai/ASSERT/blob/c26c8425/assert_ai/core/judge_citations.py ,
>   https://github.com/LegalQuants/lq-ai/blob/main/api/app/citation/verification.py ,
>   https://github.com/zoharbabin/due-diligence-agents/blob/main/src/dd_agents/search/citation_verifier.py
> - PEP 668 / CI install: https://packaging.python.org/en/latest/specifications/externally-managed-environments/ ,
>   https://github.com/actions/runner-images/issues/10781 ,
>   https://github.com/actions/runner-images/issues/13259 ,
>   https://launchpad.net/ubuntu/noble/+source/rapidfuzz ,
>   https://docs.brew.sh/Language-Runtimes-and-Packages
> - Claude Code plugin dependencies and loading: https://code.claude.com/docs/en/plugin-dependencies.md ,
>   https://code.claude.com/docs/en/plugins/troubleshooting.md ,
>   https://code.claude.com/docs/en/plugins/loading.md ,
>   https://code.claude.com/docs/en/plugins-reference
> - CommonMark emphasis: https://spec.commonmark.org/0.31.2/ ; regex-stripper
>   identifier bugs: https://github.com/openclaw/openclaw/pull/47465 ,
>   https://github.com/openclaw/openclaw/issues/58969 ,
>   https://github.com/highlightjs/highlight.js/issues/4279
<!-- /deepen-plan -->
