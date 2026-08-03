# Feature: Codex Reviewer Contract Normalization

## Overview

yellow-codex's `codex-reviewer` agent returns free-form P1/P2/P3 prose while
yellow-council's gemini-reviewer and opencode-reviewer emit a structured 6-key
block (`verdict=` / `confidence=` / `summary=` / `fenced_output_path=` /
`findings_block_begin` / `findings_block_end`). Adding a 4th reviewer (next
shell) on the structured contract would leave the council parser with a
codex-only special case. Normalizing codex first makes the 4-way fan-out
parser uniform. This shell is **cross-plugin**: it edits
`plugins/yellow-codex/` (patch changeset for yellow-codex), plus a
council-side cleanup in `plugins/yellow-council/` if any codex special-case
exists in the parser. Every plugin this shell actually edits gets its own
changeset — yellow-codex patch always, plus a yellow-council patch too if
step 3 touches `council.md` — per spec R30.

**Expansion-time correction to the above.** The pattern survey established
that `council.md`'s parser is *already* uniform — there is no codex special
case to remove. The consequence is the opposite of what the shell assumed:
`parse_reviewer_return` already greps for the 6 keys on all three reviewers,
so today every Codex return falls through to the `"${verdict:-ERROR}"`
fallback and the Codex leg of `/council` is silently degraded to `ERROR`.
This work *repairs* that consumer rather than adapting it. Two decisions were
taken at expand time (see Origin):

1. `/review:pr` is patched in this same PR (it also drops codex findings
   today, for an unrelated pre-existing reason), so this PR touches three
   plugins and carries three changesets.
2. `verdict=` is derived from Codex's own `overall_correctness` field with a
   P1-count escalation to `REJECT`.

## Origin

- Spec: `plans/specs/yellow-council-v2-four-cli.md`
- Covers: R1, R2, R3
- Shell: `yellow-council-v2-four-cli-01-codex-contract-normalization`

Expand-time decisions (AskUserQuestion, 2026-08-02):

- **yellow-review consumer:** patch `review-pr.md` in this PR — add a
  findings-block extraction branch *and* add `codex-reviewer` to the
  legacy-prose normalizer list, so no known-broken consumer is left behind.
- **Verdict source:** `overall_correctness` primary, with a P1-count
  escalation to `REJECT`; `UNKNOWN` when the field is absent.

## Pattern Survey

Findings from `repo-research-analyst` over yellow-council, yellow-codex, and
yellow-review, plus direct verification of the cited lines.

**Canonical contract (the reference to copy).**
`plugins/yellow-council/agents/review/gemini-reviewer.md` is the template;
`opencode-reviewer.md` is structurally identical, which confirms the shape is
canonical rather than one agent's quirk. Its pieces:

- Success emit block, `gemini-reviewer.md:439-445` — seven `printf` lines in
  fixed order: `verdict=` / `confidence=` / `summary=` / `fenced_output_path=`
  / `findings_block_begin` / findings / `findings_block_end`.
- Verdict enum + case validation, `gemini-reviewer.md:406-409`:
  `APPROVE|REVISE|REJECT|UNKNOWN|TIMEOUT|ERROR|UNAVAILABLE`, everything else
  collapses to `VERDICT="UNKNOWN"; CONFIDENCE="LOW"`.
- Sentinel escaping, `gemini-reviewer.md:387-393` — `sed` rewrites bare
  `^findings_block_begin$` / `^findings_block_end$` lines inside the findings
  text to `[ESCAPED] ...`. Runs **after** the 200-line / 20000-byte truncation
  cap (`:366-385`) so a truncation cut cannot re-expose a bare sentinel.
- Fenced output file, `gemini-reviewer.md:412-433` —
  `mktemp /tmp/council-gemini-fenced-XXXXXX.txt`, with a *separate* escape
  pass (`:418-421`) for the literal `--- begin/end council-output:<name>`
  fence strings, then the five mandatory fence elements (advisory line, begin
  delimiter, body, end delimiter, re-anchor line).
- Ownership: the reviewer's cleanup (`:449`) deliberately does **not** delete
  `$FENCED_OUTPUT_FILE` — `council.md` reads it for the report and owns it.
- Early-return arms emit a **3-key partial** (`verdict=` / `confidence=` /
  `summary=`, no fenced path, no findings block) then `exit 0`:
  `:85-93` (binary missing → `UNAVAILABLE`), `:104-109` (malformed pack →
  `ERROR`), `:247-255` (exit 124/137 → `TIMEOUT`), `:256-264` (exit 126/127 →
  `UNAVAILABLE`), `:265-286` (other nonzero → `ERROR`), `:312-327`
  (ingest-token missing → `ERROR`).

**Frontmatter reality check.** gemini-reviewer and opencode-reviewer both
declare `tools: [Bash, Write, Read, Grep, Glob]`, but both build the fenced
file with `mktemp` + brace-group redirection in Bash — `Write` is not what
materializes it. `codex-reviewer.md:6-10` declares `tools: [Bash, Read, Grep,
Glob]` and already creates `OUTPUT_FILE` / `STDERR_FILE` the same Bash way, so
**no `tools:` change and no validator-allowlist change is needed here.**
`codex-reviewer.md` is already in `REVIEW_AGENT_ALLOWLIST`
(`scripts/validate-agent-authoring.js:80`, W1.5 exception recorded 2026-04-29);
that entry is path-based and stays valid. The R7 allowlist edit belongs to
shell 02 (claude-reviewer) — do not pull it forward.

**Current codex-reviewer gap.** `plugins/yellow-codex/agents/review/codex-reviewer.md`
has no verdict concept at all. Step 7 (`:224-238`) emits only an injection
fence plus a free-text `Codex review: X P1, Y P2, Z P3 ...` line. Missing
versus the contract: all six keys, sentinel escaping, fenced-path handoff, and
enum validation. Every early exit returns prose: `:66-77` (binary missing),
`:101-116` (diff > 100K est. tokens → a single P3 finding), `:137-158`
(timeout 124/137, exit 2 auth-vs-argparse split, exit 1 rate-limit, other
nonzero) — and the Step 4 failure branches currently only `printf` a
diagnostic and **fall through** to Step 5, which then reads an empty
`OUTPUT_FILE`. `Constraints` line 248 ("return empty findings gracefully")
states the old contract in prose and must be rewritten.

**Verdict source available.** `codex exec review --json` emits
`overall_correctness: "patch is correct" | "patch is incorrect"`,
`overall_explanation`, and `overall_confidence_score` (0.0-1.0) — documented at
`plugins/yellow-codex/skills/codex-patterns/SKILL.md:184-206` and mirrored in
`plugins/yellow-codex/schemas/review-findings.json`. Per-finding `priority` 0-3
already maps to P1/P2/P3 at `codex-reviewer.md:165-181`.

**Consumers.**

- `plugins/yellow-council/commands/council/council.md:236-253`
  (`parse_reviewer_return`) — already uniform, greps the 6 keys for all
  reviewers. The Step 7-9 report loop (`:374`, `for reviewer in codex gemini
  opencode`) is uniform too. **Nothing to remove.** Note `council.md:197-199`
  (catch spawn failure → mark `UNAVAILABLE`) is fan-out soft-skip for the
  optional yellow-codex dependency, *not* a parse branch — leave it alone.
- `plugins/yellow-review/commands/review/review-pr.md` — dispatches
  codex-reviewer conditionally; its Step 6.0 legacy-prose normalizer list
  (`:563-574`, mirrored in the dispatch table at `:525-540`) does **not**
  include `codex-reviewer`, so Step 1 validation (`:594-608`) drops the whole
  return today. Pre-existing, unrelated to this change, but in scope by
  decision.
- `plugins/yellow-review/references/review-pr/legacy-fallback.md:19-22` —
  legacy path spawns codex-reviewer with the same prose assumption.
- `plugins/yellow-review/skills/pr-review-workflow/SKILL.md:334-344` —
  documents codex-reviewer's return as bare `[codex]`-tagged P1/P2/P3.
- `plugins/yellow-codex/commands/codex/review.md` — calls the CLI directly,
  does **not** spawn the agent. Not a consumer.

**Changeset convention.** `.changeset/yellow-council-antigravity-migration.md`
is the shape: frontmatter `"<plugin-name>": patch`, blank line, prose body.

## Implementation

- [x] Step 1: Record the audit for the PR description — write the
      before/after gap table (what `codex-reviewer.md` Step 7 emits today vs.
      the 6 keys `parse_reviewer_return` greps for) into the PR body draft,
      including the finding that `council.md`'s Codex leg currently resolves to
      `verdict=ERROR` via the `"${verdict:-ERROR}"` fallback at
      `council.md:251`. No file edits in this step.

- [x] Step 2: In `plugins/yellow-codex/agents/review/codex-reviewer.md`, add a
      new `### 7a. Verdict, Confidence, and Summary Derivation` subsection
      before the return step. Parse the `codex exec review --json` result for
      `overall_correctness`, `overall_explanation`, and
      `overall_confidence_score`, then set:
      `VERDICT=APPROVE` when `overall_correctness` is `patch is correct`;
      `VERDICT=REVISE` when it is `patch is incorrect`;
      escalate to `VERDICT=REJECT` when the P1 count reaches a named constant
      `CODEX_REJECT_P1_THRESHOLD=3` (define it inline with a one-line rationale
      comment — a fixed integer, never a subjective "many");
      `VERDICT=UNKNOWN` (with `CONFIDENCE=LOW`) when `overall_correctness` is
      absent or unparseable, mirroring `gemini-reviewer.md:396-403`.
      Map `overall_confidence_score` to `CONFIDENCE`: `HIGH` at >= 0.75,
      `MEDIUM` at >= 0.50, else `LOW`; `N/A` only on the partial arms of
      Step 4 below. Set `SUMMARY` from `overall_explanation` truncated with
      `head -c 500`, matching `gemini-reviewer.md:363`.

- [x] Step 3: In the same file, add the verdict enum case-statement verbatim
      from `gemini-reviewer.md:406-409` —
      `case "$VERDICT" in APPROVE|REVISE|REJECT|UNKNOWN|TIMEOUT|ERROR|UNAVAILABLE) ;; *) VERDICT="UNKNOWN"; CONFIDENCE="LOW" ;; esac`
      — placed after all assignment paths in Step 7a and before any emit. This
      is R2.

- [x] Step 4: Rewrite `### 7. Return Findings` (`codex-reviewer.md:224-238`) to
      emit the canonical block in this exact operation order, which must not be
      reordered: (a) run the existing Step 6 redaction awk over the findings
      text; (b) apply the 200-line / 20000-byte truncation cap copied from
      `gemini-reviewer.md:366-385`; (c) apply sentinel escaping copied from
      `gemini-reviewer.md:387-393`; (d) build `FENCED_OUTPUT_FILE` via
      `mktemp /tmp/council-codex-fenced-XXXXXX.txt`, escaping literal
      `--- begin codex-output` / `--- end codex-output` strings first
      (`gemini-reviewer.md:418-421` pattern) and emitting all five fence
      elements; (e) emit the seven `printf` lines in
      `gemini-reviewer.md:439-445` order. Keep the P1/P2/P3 finding format from
      Step 5 unchanged inside the delimiters — envelope change only. Do NOT
      delete `$FENCED_OUTPUT_FILE` in the agent's cleanup; add the same
      "council.md owns this file" comment as `gemini-reviewer.md:450`.

- [x] Step 5: Give every early-exit path a structured return, so no outcome
      falls through as unparseable prose. Full 6-key block (it has findings):
      Step 3 diff-too-large (`codex-reviewer.md:101-116`) →
      `verdict=UNAVAILABLE`, findings block retaining the existing P3
      diff-too-large finding. 3-key partial (`verdict=`/`confidence=N/A`/
      `summary=`, then `exit 0`), matching gemini's early arms: Step 1 binary
      missing (`:66-77`) → `UNAVAILABLE`; Step 4 exit 124/137 → `TIMEOUT`;
      Step 4 exit 2 auth branch → `ERROR`; Step 4 exit 2 argparse branch →
      `ERROR`; Step 4 exit 1 rate-limit → `ERROR`; Step 4 other nonzero →
      `ERROR`. Each Step 4 branch must **stop** after emitting — today they
      only `printf` and fall through into Step 5's `cat "$OUTPUT_FILE"`.
      (Rate-limit stays `ERROR` here: `QUOTA_EXHAUSTED` is added to the enum by
      spec R16 in shell 04. Do not add it now.)

- [x] Step 6: Update the file's own prose to match the new contract — rewrite
      the `Constraints` bullet at `codex-reviewer.md:248` ("If Codex is
      unavailable or fails, return empty findings gracefully") to state that
      every exit returns a structured verdict block, and update the
      frontmatter `description:` (`:3`) so it names the 6-key structured return
      instead of only "P1/P2/P3 format". Keep `description:` single-line — no
      folded scalars.

- [x] Step 7: Verify R3 rather than editing for it — grep
      `plugins/yellow-council/commands/council/council.md` for any
      `codex`-conditional parse branch and confirm `parse_reviewer_return`
      (`:236-253`) and the Step 7 report loop (`:374`) are reviewer-agnostic.
      Record the result in the PR description. Explicitly leave
      `council.md:197-199` (spawn-failure → `UNAVAILABLE` soft-skip for the
      optional yellow-codex dependency) intact — it is fan-out, not parsing.

- [x] Step 8: Patch the `/review:pr` consumer so codex findings stop being
      dropped. In `plugins/yellow-review/commands/review/review-pr.md`
      Step 6.0 (`:563-574`): add a pre-normalization branch that, when a
      return begins with `verdict=`, extracts the text between
      `findings_block_begin` / `findings_block_end` and feeds *that* to the
      existing prose normalizer; and add `codex-reviewer` to the exhaustive
      legacy-prose normalizer list. Mirror the list addition in the dispatch
      table at `:525-540`. Keep the two copies of the list in sync — they are
      documented as needing to match.

- [ ] Step 9: Update the remaining yellow-review docs that describe the old
      return shape: `plugins/yellow-review/references/review-pr/legacy-fallback.md:19-22`
      and `plugins/yellow-review/skills/pr-review-workflow/SKILL.md:334-344`.

- [ ] Step 10: Update `plugins/yellow-council/skills/council-patterns/SKILL.md`
      — in the "Reviewer-Specific CLI Flag Pattern → Codex" subsection
      (`:341-344`), note that codex-reviewer now emits the same 6-key contract
      as the Gemini and OpenCode slots, for symmetry with those subsections.

- [ ] Step 11: Update `plugins/yellow-codex/CLAUDE.md` — the `codex-reviewer`
      line under "Agents (3)" and the "Output parsing" convention bullet, so
      the plugin's own docs describe the structured return. Repo rule: update
      the plugin's CLAUDE.md when behavior changes.

- [ ] Step 12: Derive the changeset set from `git diff --name-only` rather than
      from assumption — one `.changeset/<slug>.md` per plugin actually touched.
      Expected: `"yellow-codex": patch` (Steps 2-6, 11),
      `"yellow-review": patch` (Steps 8-9), `"yellow-council": patch`
      (Step 10). Drop any of the three if its plugin ended up untouched. Run
      `sed -i 's/\r$//'` on each new changeset file (WSL2 CRLF).

- [ ] Step 13: Run the verification gates below and fix anything they surface.

## Verification

- Offline contract check (primary gate — no Codex CLI or auth required):
  write a synthetic codex-reviewer return to a temp file and pipe it through
  the exact `parse_reviewer_return` extractors from `council.md:240-244`
  (`grep -m1 '^verdict='`, `'^confidence='`, `'^summary='`,
  `'^fenced_output_path='`, and
  `awk '/^findings_block_begin$/{flag=1;next} /^findings_block_end$/{flag=0} flag'`).
  -> expected: all five fields populate non-empty for the success block; and
  for each partial arm (`UNAVAILABLE`, `TIMEOUT`, `ERROR`), `verdict` is the
  intended enum value and never falls back to the `"${verdict:-ERROR}"` default
  at `council.md:251`.
- Sentinel-escape check: run the same offline check with a synthetic finding
  whose body contains bare `findings_block_end` on its own line.
  -> expected: the parsed findings text still contains the full finding, with
  the sentinel rewritten to `[ESCAPED] findings_block_end`.
- `/review:pr` consumer check (gate for Steps 8-9 — these are the steps added
  beyond the shell's `Produces`, so they must not ship asserted-only): feed the
  same synthetic 6-key return through the Step 6.0 branch added in Step 8.
  -> expected: the `**[P1] ... **` / `Finding:` / `Fix:` lines inside the
  findings block are extracted and normalized into the compact-return envelope
  (`reviewer`, `findings`, `residual_risks`, `testing_gaps`), and the return
  survives Step 1 validation at `review-pr.md:594-608` instead of being dropped.
  Also confirm `codex-reviewer` now appears in BOTH copies of the normalizer
  list (`review-pr.md:563-574` and the dispatch table at `:525-540`).
  Note: `[ESCAPED] findings_block_*` lines from Step 4's sentinel escaping pass
  through into finding text — cosmetic, not a drop; do not strip them here.
- `pnpm validate:agents` -> expected: exit 0, no W1.5 / frontmatter violations
  on `codex-reviewer.md`.
- `pnpm validate:schemas` -> expected: exit 0.
- `pnpm test:unit && pnpm lint && pnpm typecheck` (CI baseline gate, R30)
  -> expected: all pass.
- `git diff --name-only` cross-checked against `.changeset/` contents
  -> expected: every plugin with a changed file under `plugins/<name>/` has a
  matching changeset, and no changeset names an untouched plugin.
- `file plans/../.changeset/*.md` or `grep -c $'\r'` on new files
  -> expected: zero CR bytes (LF only).
- Live smoke test (secondary — requires `codex` CLI + auth): run
  `/council review` on a small diff -> expected: the report shows a Codex row
  with populated verdict / confidence / summary lines rather than the current
  `ERROR`.

## Context Files

- `plugins/yellow-codex/agents/review/codex-reviewer.md` — the file being
  normalized; Steps 1-7 and the `Constraints` block all change.
- `plugins/yellow-council/agents/review/gemini-reviewer.md` — the reference
  implementation; copy its escaping, enum case-statement, fence construction,
  and emit order verbatim.
- `plugins/yellow-council/agents/review/opencode-reviewer.md` — second witness
  that the gemini shape is canonical; consult on any ambiguity.
- `plugins/yellow-council/commands/council/council.md` — the consumer
  (`parse_reviewer_return`, `:236-253`); verified uniform, expected to remain
  unedited.
- `plugins/yellow-review/commands/review/review-pr.md` — second consumer;
  Step 6.0 normalizer and the dispatch table both change.
- `plugins/yellow-review/references/review-pr/legacy-fallback.md`,
  `plugins/yellow-review/skills/pr-review-workflow/SKILL.md` — docs describing
  the old return shape.
- `plugins/yellow-codex/skills/codex-patterns/SKILL.md` — source of truth for
  the `codex exec review --json` schema (`overall_correctness` etc.); read-only
  reference, the CLI contract itself does not change.
- `plugins/yellow-council/skills/council-patterns/SKILL.md` — Codex subsection
  gains the 6-key note.
- `scripts/validate-agent-authoring.js` — `REVIEW_AGENT_ALLOWLIST` at `:80`
  already covers codex-reviewer; confirm no edit is needed, do not add the R7
  entry that belongs to shell 02.
- `.changeset/yellow-council-antigravity-migration.md` — changeset format
  example.

## Out of Scope

- The 300s codex-reviewer timeout (yellow-council's CLAUDE.md routes changes
  there to a separate yellow-codex issue).
- Adding `QUOTA_EXHAUSTED` to the verdict enum — spec R16, shell 04.
- The `REVIEW_AGENT_ALLOWLIST` entry for claude-reviewer — spec R7, shell 02.
- R26 / R28 council doc-lockstep sweeps beyond the single Codex subsection
  note in Step 10.
- Reconciling codex-reviewer's Step 6 redaction pattern list with
  council-patterns' 11-pattern canonical list (a real divergence the survey
  found — `ses_` is absent — but a separate security-hardening change).
