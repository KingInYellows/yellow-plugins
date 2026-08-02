# yellow-council V2: Four-CLI Review Council

## Overview

`yellow-council` V1 fans a code review out to 3 CLI reviewers (Codex via
yellow-codex, Gemini, OpenCode) and synthesizes their verdicts descriptively.
V2 re-architects this into a four-reviewer council: an in-process
`claude-reviewer` joins Codex, Gemini (via the Antigravity CLI `agy`, migrated
separately in the standalone Phase G bugfix), and OpenCode routed to a
non-Big-3 lineage (DeepSeek V4 Pro via OpenRouter). Because Claude both
reviews and synthesizes, V2 ships a layered set of prompt-only synthesizer-bias
mitigations (double-blind labels, 2-pass order-swap with flip-as-tie,
self-participant instruction, rubric decomposition, style-bias normalization +
a structured enumerate-then-compare rationale requirement) plus Tier 1-2
evidence verification so cited
`<file>:<line>` claims are mechanically checked rather than self-assessed.
Quota handling is deliberately slim: per-reviewer error-string detection
emitting `verdict=QUOTA_EXHAUSTED` with the provider-reported reset ETA — no
numeric cap tracking (providers no longer publish caps).

Sources of truth for context: `docs/brainstorms/2026-08-01-yellow-council-v2-rescope-brainstorm.md`
(scope decisions) and `docs/research/yellow-council-v2-revalidation-2026-08-01.md`
(codebase + external evidence, annotated). Line locators in the revalidation
record are pre-PR-G; re-verify them at decompose/implementation time — this
spec intentionally cites sections and task IDs, not line numbers.

**Out of scope:** Phase G (Gemini→Antigravity migration — independent urgent
bugfix); reviewer registry abstraction; numeric quota scaffolding
(`quota.json`, pre-flight headroom, `COUNCIL_MIN_REVIEWERS`,
`COUNCIL_QUOTA_RESET`); TH-Score uncertainty gating and length-controlled
scoring (V2.5); multi-round review, fleet management, Tier 3 ast-grep
verification (V3+); direct API auth paths.

## Requirements

### Codex contract normalization (cross-plugin: `plugins/yellow-codex/`)

- **R1.** When codex-reviewer completes a review, it shall return the 6-key
  structured block (`verdict=` / `confidence=` / `summary=` /
  `fenced_output_path=` / `findings_block_begin` / `findings_block_end`)
  matching gemini-reviewer's contract, preserving the existing P1/P2/P3
  finding format inside the delimiters (envelope change only, not content).
- **R2.** When codex-reviewer produces a verdict outside the allowed enum, it
  shall normalize it to `UNKNOWN` via the same case-statement validation the
  other reviewers use.
- **R3.** When `council.md` parses reviewer returns, it shall use one uniform
  parser for all reviewers with no codex-specific branch.

### Four-slot fan-out

- **R4.** When `/council review` runs, it shall fan out to exactly 4 hardcoded
  named reviewer slots — `claude`, `codex`, `gemini`, `opencode` — via
  parallel Task spawns (no registry abstraction).
- **R5.** The new `claude-reviewer` agent shall run in-process (no CLI
  subprocess, no `Bash`), with tools `[Read, Grep, Glob, Write]` (`Write`
  solely to materialize the `fenced_output_path` temp file), `model: inherit`,
  `skills: [council-patterns]`, and emit the same 6-key block as R1.
  - Enforcement honesty: Claude Code has no runtime path-scoping for
    `Write` — granting the tool grants it repo-wide. The actual boundary is
    (a) the R7 validator allowlist entry, which is a review gate, not a
    runtime guard, and (b) the agent prompt's explicit constraint to write
    ONLY the fenced-output temp file under `/tmp`. This is a documented,
    deliberately accepted limitation for V2, not a claim of enforced
    sandboxing.
  - Recorded alternative (decide at PR-A, not now): if PR-A review finds
    the prompt-level constraint too weak, switch to orchestrator-created
    output files — `council.md` writes the fenced file itself from
    claude-reviewer's returned text, and claude-reviewer drops `Write`
    entirely. The spec default stays `[Read, Grep, Glob, Write]` unless
    PR-A overturns it.
- **R6.** The claude-reviewer prompt shall use contrarian framing: apply the
  shared rubric, never self-identify as Claude in output, cite findings as
  `<file>:<line>` plus the verbatim quoted source line the finding is about
  (the shared citation contract R22 verifies against for all four
  reviewers — `verify_finding()` needs an expected string to compare
  against, not just a location), bias toward edge cases / error paths /
  race conditions / security boundaries, and prefer a defensible `REVISE`
  over reflex `APPROVE`.
  - Acceptance: post-ship guardrail — if claude-reviewer's REVISE rate
    deviates from the other 3 reviewers' average by more than ±25%, re-tune.
- **R7.** `scripts/validate-agent-authoring.js` `REVIEW_AGENT_ALLOWLIST` shall
  gain an entry for claude-reviewer documenting the `Write` exception, and
  `pnpm validate:agents` shall pass. This allowlist entry is a review-time
  gate — it makes the exception visible and intentional, not accidental —
  and does not runtime-restrict what paths `Write` can touch; see R5's
  enforcement-honesty note for the actual boundary.
- **R8.** Every per-reviewer loop in `council.md` (parse, synthesis input,
  headline counts, raw-output appendix / report assembly) shall cover all 4
  reviewers; the saved report shall include Claude's raw section.

### Synthesis bias mitigation

- **R9.** Before synthesis, reviewer identities shall be replaced with labels
  `S1`–`S4` randomized per invocation (chosen to avoid colliding with this
  spec's own `R`-prefixed requirement ids); the true mapping shall be
  restored in the final report's attribution sections.
- **R10.** Before synthesis, each reviewer's findings text shall be
  normalized: markdown/formatting stripped or flattened so styling and
  verbosity differences cannot signal identity or inflate weight (style-bias
  countermeasure, per `docs/solutions/code-quality/llm-as-judge-style-bias-dominance.md`).
- **R11.** The synthesizer prompt shall require a structured
  enumerate-then-compare rationale — enumerate all findings first, then
  compare — before rendering any verdict, and shall include a
  self-participant instruction: one anonymized reviewer may share the
  synthesizer's model family, and findings must be weighed by cited
  evidence, not rhetorical confidence.
- **R12.** When 2-pass synthesis is enabled (default ON), the two passes are
  prompt-level reorderings evaluated within a single orchestrator context —
  a positional-consistency check, NOT two independently invoked, isolated
  passes. The synthesizer retains awareness of Pass A's order and findings
  when constructing Pass B; full pass isolation requires the dedicated
  synthesis subagent explicitly deferred to V3 (see Design's "Synthesis
  locus" for the documented limitation and revisit trigger). Within that
  constraint, any finding whose verdict or confidence tier differs between
  the two reorderings shall be marked `low-confidence-synthesis` and
  presented as a tie showing both readings — never silently resolved. The
  headline shall report the low-confidence count and percentage.
- **R13.** Users shall be able to disable the second pass globally
  (`COUNCIL_DOUBLE_PASS_SYNTHESIS=0`) or per-invocation
  (`/council review --single-pass`); when disabled, the headline shall omit
  the low-confidence annotation.
- **R14.** Pass A and Pass B are issued as two separate orchestrator steps
  (sequential completions within the same context, not sub-steps of one
  shared completion), so Pass A's result is already captured before Pass B
  is requested. When Pass B's construction fails outright — a Claude quota
  wall hit before Pass B starts or completes — the run shall ship Pass A's
  synthesis with a headline annotation naming the skipped flip-analysis and
  the quota ETA; Pass B shall not be retried in-session. If the quota wall
  instead lands mid-way through Pass B's own completion, there is no partial
  Pass B result to salvage: the run degrades to the same Pass-A-only
  annotation and says so in the headline — inline synthesis cannot resume a
  completion once the quota wall lands inside it.
- **R15.** Synthesis shall score each finding on independent rubric
  dimensions — correctness of cited evidence (backed by R22
  verification), completeness, severity calibration, constraint adherence —
  combined mechanically (a finding is "well-supported" only if correctness
  AND completeness hold; no weighting math in V2).

### Quota exhaustion (slim)

- **R16.** `QUOTA_EXHAUSTED` shall be added to the verdict enum in all four
  reviewer agent files and `council.md`'s parser, treated as an
  UNAVAILABLE-class verdict: excluded from synthesis, surfaced in the
  headline with the reset ETA. (Without all five updates the case-statement
  fallback silently normalizes it to `UNKNOWN`.)
- **R17.** Each reviewer shall detect its provider's quota-exhaustion signals
  and distinguish them from transient errors:
  claude — `/session limit.*resets/i`, `/weekly limit.*resets/i`,
  `/Opus limit.*resets/i`, fallback `/usage limit reached.*try again/i`;
  never generic rate-limit text or HTTP 529;
  codex — `insufficient_quota`, `model_cap_exceeded` vs. transient 429;
  gemini/agy — `RESOURCE_EXHAUSTED` floor plus any Phase-G-spike-verified
  strings; opencode — provider error passthrough from the
  `opencode run --format json` error event.
  - Orchestrator-side detection: this per-reviewer matching only runs once
    a reviewer agent has actually started, so it cannot fire when the
    claude-reviewer Task fails to SPAWN at all (session/weekly limit hit
    before the agent runs) — there is no reviewer process to do the
    matching. In that case `council.md` itself shall classify the spawn
    failure against the same claude quota-string match set above and
    synthesize the R18 `QUOTA_EXHAUSTED` block on the slot's behalf, so the
    ETA and classification survive instead of degrading to a generic
    `ERROR`.
- **R18.** On quota exhaustion a reviewer shall return the full 6-key block
  with `verdict=QUOTA_EXHAUSTED`, `confidence=N/A`, the parsed reset ETA in
  `summary=`, `fenced_output_path=/dev/null`, and an empty findings block —
  so the uniform parser (R3) needs no special case.

### OpenCode fourth-lineage routing

- **R19.** `opencode-reviewer` shall honor a `COUNCIL_OPENCODE_MODEL` env var
  with three distinct states, distinguished by presence rather than by value
  alone (a `${VAR+x}`-style presence check, not a plain `${VAR:-default}`
  collapse of empty-and-unset): **unset** (the variable is not exported at
  all) → default to the spike-verified slug for DeepSeek V4 Pro; **set but
  empty** (exported as `""`) → V1 behavior, no `--model` flag passed at all;
  **set non-empty** → pass `--model "$COUNCIL_OPENCODE_MODEL"` verbatim.
  None of the three states disturb the existing `PACK_BYTES` guard's
  early-exit envelope.
  - Acceptance: the routing recipe (slug form, auth mechanism) comes from the
    Task 4.0 spike (`opencode models` output is authoritative); the
    rescinded `defaultProvider`-in-`opencode.json` mechanism must not be used.
- **R20.** When the configured model is unavailable, opencode-reviewer shall
  return `verdict=UNAVAILABLE` with an actionable error naming the fix
  (`opencode auth login <provider>` / choose a listed model) rather than
  failing the council run.
- **R21.** Pre-flight shall perform best-effort lineage detection for all 4
  slots and emit a non-blocking warning when two reviewers resolve to the
  same lineage; the report header shall show each slot's resolved model.

### Evidence verification

- **R22.** A `verify_finding()` helper shall verify each finding's
  `<file>:<line>` citation against its accompanying verbatim quoted source
  line (R6): Tier 1 mode-dependent exact match — compare the quoted excerpt
  against the actual line content at that citation (`review` mode →
  `git show HEAD:<file>`; `plan`/`debug`/`question` modes → working tree
  with HEAD fallback; unknown or non-checkout context → skip to Tier 2);
  Tier 2 fuzzy match via `rapidfuzz` `fuzz.ratio(quoted_excerpt,
  actual_line) >= 85` — `fuzz.ratio` needs two strings to compare, and line
  existence alone cannot verify claim correctness; returning `verified` /
  `fuzzy-verified` / `unverified`.
  - Acceptance (citation safety): before any file read, `verify_finding()`
    shall strictly parse the `<file>:<line>` citation, reject any path that
    resolves outside the repository root (including traversal sequences),
    and reject any line number that is not a bounded positive integer
    within the target file's line count. Malformed or out-of-bounds
    citations are treated as `unverified` without attempting a file read.
- **R23.** `rapidfuzz` shall be an optional dependency: pre-flight import
  check, Tier 2 soft-skipped with a `pip install rapidfuzz` warning when
  absent, documented in CLAUDE.md.
- **R24.** Synthesis output shall use the five-bucket structure — Agreement
  (verified), Agreement (unverified), Disagreement, Single-Reviewer Findings
  (verified), Unverified Claims — with deterministic precedence:
  citation_count 1 → single-reviewer buckets split by verification;
  citation_count ≥2 with non-unanimous verdicts → Disagreement (takes
  precedence over Agreement); citation_count ≥2 unanimous → Agreement split
  by verification. Unverified findings are surfaced, never discarded.
- **R25.** Verification cost shall be bounded: Tier 2 capped at the top 50
  findings per reviewer, and verification shall run concurrently with
  synthesis prompt construction.

### Documentation, sync, and validation

- **R26.** `council-patterns/SKILL.md` shall stay in lockstep with shipped
  behavior: 4-reviewer list (claude as the in-process exception), per-reviewer
  invocation blocks, the full synthesis contract (double-blind, 2-pass/tie,
  rubric, style normalization, five buckets), and `verify_finding()` usage.
- **R27.** Every new env var (`COUNCIL_DOUBLE_PASS_SYNTHESIS`,
  `COUNCIL_OPENCODE_MODEL`) shall appear in BOTH configuration tables — the
  4-column table in `plugins/yellow-council/CLAUDE.md` and the 3-column table
  in `council.md`'s help output.
- **R28.** `plugins/yellow-council/CLAUDE.md` component counts shall match
  reality after V2 (including fixing the pre-existing "Commands (1)" → 2
  drift); README lineage map and CHANGELOG shall be updated.
- **R29.** `docs/testing/yellow-council-manual-tests.md` shall gain e2e
  scenarios: all-4-APPROVE; one reviewer QUOTA_EXHAUSTED with ETA matching
  the provider error; lineage-collision warning; OpenCode resolved slug in
  report header; verdict-flip presented as tie; `--single-pass` bypass;
  rubric dimensions present in output; Tier 1 hit / Tier 2 hit / miss →
  Unverified Claims.
- **R30.** Each PR shall pass the CI baseline gate (`pnpm validate:schemas &&
  pnpm test:unit && pnpm lint && pnpm typecheck`) and carry a changeset for
  every plugin it touches (patch for the PR-0 refactor; minor for the
  additive yellow-council PRs), following the three-way version-sync model.

## Design

### Architecture: asymmetric 4-slot fan-out

`council.md` Step 4 spawns 4 parallel Task subagents. Three wrap external
CLIs (codex / agy / opencode) via Bash; `claude-reviewer` is in-process pure
reasoning — the asymmetry is documented in SKILL.md rather than abstracted
away (traces to R4, R5). All five files share one return contract: the 6-key
block with verdict enum
`APPROVE|REVISE|REJECT|UNKNOWN|TIMEOUT|ERROR|UNAVAILABLE|QUOTA_EXHAUSTED`
(R1, R16, R18), which is what keeps the parser uniform (R3).

**R0 decision rule (fixed now so decompose never re-litigates):** if the
Phase G spike shows `agy` requires an API key or per-token billing for
consumer accounts, the Google slot is NOT removed and no registry is added —
the gemini slot's invocation is instead routed through OpenCode/OpenRouter
`google/gemini-*` slugs, keeping the 4-slot shape and lineage map intact.

### Synthesis pipeline (order matters)

1. Collect 4 reviewer blocks → parse (R3, R8)
2. Normalize findings text: strip markdown/styling (R10)
3. Anonymize: randomized S1–S4 labels (R9)
4. Verify citations: `verify_finding()` cascade, capped + concurrent (R22, R25)
5. Pass A synthesis — enumerate-then-compare rationale first,
   self-participant instruction, per-finding rubric dimensions (R11, R15)
6. Pass B with reversed order unless disabled; flip → tie +
   `low-confidence-synthesis` (R12, R13, R14)
7. Bucket assignment by the deterministic precedence rule (R24)
8. De-anonymize for the report's attribution sections; headline reports
   verdict counts, quota ETAs, low-confidence percentage (R8, R16)

The rubric's "correctness of cited evidence" dimension consumes step 4's
verification result — this is the deliberate R15↔R22 coupling that kept
Phase 5 in V2.

**Synthesis locus (decided at spec time):** synthesis is inline orchestrator
logic in V2 — a dedicated synthesis Task subagent is explicitly rejected for
V2 (extra Claude message per pass, more orchestration code in PR-B).

**Documented limitation:** because both synthesis passes run inline, the
R12 two-pass mechanism is a prompt-level reordering evaluated within a
single orchestrator context, not two independently invoked, isolated
passes — the synthesizer retains awareness of Pass A's order and findings
when constructing Pass B, so it is a positional-consistency check, not a
blind re-evaluation. R14's separate-orchestrator-step framing keeps Pass A's
result safe from a Pass B quota failure, but it does not give the two passes
independent context. Full pass isolation requires the dedicated synthesis
subagent, deferred to V3. Revisit this decision if post-V2 bias measurements
show inline synthesis leaking lineage labels, or if the R12 positional check
proves too weak in practice; the V3-grade alternative is CARE-style
correlated-judge aggregation.

### Quota detection

Detection is error-string driven exclusively (no `quota.json`, no numeric
headroom math): each reviewer owns its provider's match set (R17) and the
shared stub-return shape (R18). Rationale: providers stopped publishing
numeric caps (Anthropic), changed metering units (Codex → minutes of
reasoning), or have unpublished quota models (Antigravity) — see the
revalidation record's Phase 3 annotation.

### OpenCode routing

`COUNCIL_OPENCODE_MODEL` follows the established env-var-with-default
convention (`CODEX_MODEL`, `COUNCIL_OPENCODE_VARIANT` precedents); no
`userConfig` (reserved for API keys/URLs marketplace-wide). The Task 4.0
spike resolves the slug and auth recipe empirically before implementation;
its result is recorded in `docs/spikes/opencode-cli-format-json-2026-05-04.md`
(traces to R19, R20).

### Evidence verification cascade

Tier 1 is mode-dependent exact match; Tier 2 is `rapidfuzz` similarity ≥85
(locked library decision — similarity-only need, 0–100 scale, C++-backed);
Tier 3 (ast-grep) deferred to V3 (R22, R23). Verification classifies, never
gates: unverified findings land in a visible bucket (R24).

### PR stack (input to decompose, not binding)

PR-0 (R1–R3, yellow-codex, patch) → PR-A (R4–R8) → PR-B (R9–R15) →
PR-C (R16–R18) → PR-D (R19–R21) → PR-E (R22–R25). R26–R30 are cross-cutting
per-PR obligations. PR-0 is cross-plugin and needs its own changeset; PR-G
(Phase G) precedes the stack independently and shifts line numbers — all
locators must be re-verified against post-PR-G reality at expansion time.

## Open Questions

- **R0 outcome (Antigravity subscription-auth continuity).** Resolves
  empirically in the Phase G spike; the response to either outcome is already
  fixed by the R0 decision rule above — no spec branch needed.
- **OpenCode → OpenRouter slug/auth recipe.** Resolves empirically from the
  Task 4.0 spike (`opencode models` output authoritative); not
  user-decidable.
