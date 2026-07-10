# yellow-council

## 0.2.6

### Patch Changes

- [#628](https://github.com/KingInYellows/yellow-plugins/pull/628)
  [`811ae11`](https://github.com/KingInYellows/yellow-plugins/commit/811ae114f1bd4eb75cda5c5bb8d40149ceb5b9f5)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - docs: align the
  Codex reviewer-leg read-only invocation description with the `-c`
  config-override form (`sandbox_mode="read-only"`, `approval_policy="never"`) —
  `-s`/`-a` no longer parse on `codex exec review` as of codex-cli 0.140.0.

## 0.2.5

### Patch Changes

- [#605](https://github.com/KingInYellows/yellow-plugins/pull/605)
  [`ff312b4`](https://github.com/KingInYellows/yellow-plugins/commit/ff312b4baec6d207a09ac47f7c7370754ae25035)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! -
  Progressive-disclosure splits (Tier 2 C6): move conditional and late-sequence
  detail out of oversized skill and command files into `references/` files
  behind imperative load stubs, verbatim (except positional cross-reference
  words like "above"/"below" corrected for the new file locations, and the
  review-pr Steps 9a/9b top-level skip-gate merged into one provably-equivalent
  condition).
  - `yellow-core/skills/optimize/SKILL.md` 461 → 297 lines (judge protocol,
    pagination layouts, failure modes, design rationale → `references/`)
  - `yellow-core/skills/compound-lifecycle/SKILL.md` 414 → 291 lines
    (staleness/clustering formulas + config keys, report template, archive
    rationale → `references/`)
  - `yellow-council/skills/council-patterns/SKILL.md`: only the non-executed
    Cross-References provenance bullets move (grep-confirmed unconsumed); every
    runtime-load-bearing preloaded section stays inline
  - New command-file pattern (no prior precedent): `/review:pr` legacy
    fallback + Steps 9a/9b, `/workflows:work` Graphite cheat-sheet, and
    `/setup:all` Steps 1.6/1.7 move to plugin-local `references/` dirs loaded
    via `${CLAUDE_PLUGIN_ROOT}` stubs at their branch points
  - Manual stub-firing e2e checklist at
    `docs/testing/c6-progressive-disclosure-stub-firing-checklist.md`; stale
    provenance comment in `debugging/SKILL.md` corrected

## 0.2.4

### Patch Changes

- [#575](https://github.com/KingInYellows/yellow-plugins/pull/575)
  [`1df6023`](https://github.com/KingInYellows/yellow-plugins/commit/1df602315d3d3fa53487d5c57b4e3625bc15d64b)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - fix: persist
  reviewer verdicts/confidences/fenced-paths to a deterministic state file in
  /council Step 4 and re-load it at the top of Steps 7-9 — associative arrays
  populated in one bash block do not survive into later blocks, so the
  report-assembly and cleanup steps previously read empty REVIEWER\_\* arrays

## 0.2.3

### Patch Changes

- [#507](https://github.com/KingInYellows/yellow-plugins/pull/507)
  [`0cae892`](https://github.com/KingInYellows/yellow-plugins/commit/0cae8920e98592d467c86e19372ca8998c05db04)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! -
  docs(skill-descriptions): trim non-load-bearing content from 8 skill
  descriptions while preserving WHAT + WHEN + differentiating clauses.

  Targets 7 yellow-core skills (compound-lifecycle 686→220, ideation 664→202,
  optimize 613→234, debugging 518→225, session-history 516→242,
  agent-native-audit 377→250, agent-native-architecture 314→224) and 1
  yellow-council skill (council-patterns 285→190). Total reduction: 2,186 chars
  (55% across modified skills).

  Rationale: descriptions over ~250 chars are in a documented degradation zone
  where trailing content is invisible to Claude's auto-invocation logic
  (anthropics/claude-code#44780, observed 2026-05-09; community-reported
  behavior, not documented in the official schema). The trim removes enumerated
  trigger phrase lists, body-content repetition, and methodology bleed — content
  that adds no signal at skill-selection time and was actively suppressing
  routing accuracy on the verbose skills. The five-principle enumeration in
  agent-native-architecture, the OFFLINE/DEGRADED/HEALTHY classification in
  mcp-health-probe, and the temporal differentiator in
  memory-recall/remember-pattern were all preserved as load-bearing selection
  signal.

  Updates CONTRIBUTING.md "Skill Description Budget" section to reconcile the
  existing "don't trim for budget" guidance with the new "trim non-load-bearing
  content for selection accuracy" principle. The two are compatible. The
  `user-invokable: false` carve-out clarifies that documentation-bloat trims
  (capability enumerations, body-content repetition) are valid for internal
  skills; budget pressure alone is not.

  See plans/complete/skill-description-audit.md and
  docs/brainstorms/2026-05-09-claude-code-skill-bloat-brainstorm.md for the full
  audit methodology and per-skill before/after analysis.

## 0.2.2

### Patch Changes

- [`b52d058`](https://github.com/KingInYellows/yellow-plugins/commit/b52d0583f1afd9cc11259b8e4eac62a124596623)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add explicit
  `model:` and `effort:` frontmatter to 8 phase-1 agents to escape the
  inheritance trap on narrow-role agents and add chain-of-thought depth to
  synthesizers/orchestrators.
  - `product-lens-reviewer` (yellow-docs): `model: sonnet` (matches sibling
    reviewers' explicit tiering)
  - `gemini-reviewer`, `opencode-reviewer` (yellow-council): `model: haiku` +
    `effort: low` — CLI relay agents that do no reasoning
  - `learnings-researcher` (yellow-core): `model: haiku` + `effort: low` — BM25
    retrieval, no synthesis; called on every `/review:pr` and `/workflows:plan`
  - `runner-assignment` (yellow-ci): `model: haiku` + `effort: low` —
    deterministic label-matching against fixed runner taxonomy
  - `audit-synthesizer` (yellow-debt): `effort: high` (model already `opus`) —
    cross-scanner deduplication and confidence gating benefit from extended CoT
  - `research-conductor` (yellow-research): `effort: high` (model already
    `opus`) — multi-source fan-out routing involves ambiguous decomposition
  - `brainstorm-orchestrator` (yellow-core): `model: sonnet` + `effort: high` —
    iterative dialogue with research integration; Sonnet is the structured-
    orchestration ceiling

## 0.2.1

### Patch Changes

- [`c3cdfdb`](https://github.com/KingInYellows/yellow-plugins/commit/c3cdfdb5a2c0d260e32096a524c4712fe277d019)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add `$schema`
  pointer to all remaining plugin manifests:
  `https://json.schemastore.org/claude-code-plugin-manifest.json`

  Per https://code.claude.com/docs/en/plugins-reference, Claude Code's plugin
  loader ignores this field at load time, but editors and IDEs use it for
  autocomplete and inline validation against the official remote validator
  schema. yellow-core received the pointer earlier in the stack as a
  single-plugin probe; this PR extends it to the other 17.

  Also documents local vs remote validator divergence in CONTRIBUTING.md with a
  recipe for empirical install testing (`claude plugin validate`,
  `claude --plugin-url`, fresh-install probe). The `claude plugin validate` CI
  integration is deferred to a follow-up PR pending CI runtime evaluation.

## 0.2.0

### Minor Changes

- [`955cf03`](https://github.com/KingInYellows/yellow-plugins/commit/955cf03a9067003482c9968c799ff18672ffd3f3)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Initial release
  of yellow-council plugin: on-demand cross-lineage council command
  (`/council <mode>`) fanning out to Codex (via yellow-codex), Gemini, and
  OpenCode CLIs in parallel for advisory consensus. Four modes: `plan`,
  `review`, `debug`, `question`. Synchronous fan-out with 600s per-reviewer
  timeout and partial-result reporting on timeout. Inline synthesis (Headline /
  Agreement / Disagreement) plus persisted report at
  `docs/council/<date>-<mode>-<slug>.md`. PR1 ships the scaffold + manifests +
  spike documentation; full reviewer agents and `/council` command
  implementation land in subsequent stacked PRs
  (yellow-council-core-implementation, yellow-council-polish-and-tests).

## 0.1.0

### Minor Changes

- Initial release: on-demand cross-lineage council command (`/council <mode>`)
  fanning out to Codex (via yellow-codex), Gemini, and OpenCode CLIs in
  parallel. Four modes: `plan`, `review`, `debug`, `question`. Synchronous
  fan-out with 600s per-reviewer timeout and partial-result reporting. Inline
  synthesis (Headline / Agreement / Disagreement) plus persisted report at
  `docs/council/<date>-<mode>-<slug>.md`. V1 scaffold + spikes; full
  implementation lands in subsequent PRs.
