# Changelog

## 1.6.6

### Patch Changes

- [`5547dbf`](https://github.com/KingInYellows/yellow-plugins/commit/5547dbf602946a8d8d29dc8f22bbef6abe5ca24c)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Tier
  yellow-debt scanners and yellow-core workflow agents to explicit sonnet/effort
  frontmatter (Phase 2 of M-A-01).

  **yellow-debt scanners + remediation** — taxonomy-driven single-pass analysis;
  Sonnet is the quality ceiling. `effort: low` for the parallel scanner tier.
  - `ai-pattern-scanner`, `complexity-scanner`, `duplication-scanner`,
    `architecture-scanner`, `security-debt-scanner`: `model: sonnet` +
    `effort: low`
  - `debt-fixer`: `model: sonnet` (no `effort:` change). Spot-check passed —
    `isolation: worktree` is model-agnostic and tools list contains no
    Opus-tier-only entries.

  **yellow-core workflow** — sophisticated retrieval/orchestration without
  Opus-level synthesis (sub-agents handle the actual writing):
  - `knowledge-compounder`: `model: sonnet` — orchestrates dispatch and novelty
    detection; sub-agents do the synthesis.
  - `session-historian`: `model: sonnet` — BM25 + cosine + RRF retrieval with
    secret redaction. Ranking-and-returning is a Sonnet-ceiling task.

  Distinguished from `security-sentinel` (Opus, active vulnerability audit)
  which stays unchanged.

## 1.6.5

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

## 1.6.4

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

## 1.6.3

### Patch Changes

- [`13bc50d`](https://github.com/KingInYellows/yellow-plugins/commit/13bc50dda24a384aae78d7340baa8e866cb2791c)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - X-01 (audit
  2026-05-07): declare cross-plugin MCP dependencies in three consumer manifests
  that silently require yellow-linear's MCP at runtime. Surfaces install-time
  coupling that previously failed opaquely as "MCP tool not found".

  **yellow-debt:** `/debt:sync` uses
  `mcp__plugin_yellow-linear_linear__create_issue` to push debt findings to
  Linear as issues.

  **yellow-ci:** `/ci:report-linear` uses the same Linear MCP tool to create
  issues from CI failure diagnoses.

  **yellow-chatprd:** `/chatprd:link-linear` uses it to bridge ChatPRD documents
  to Linear issues.

  All three deps are declared `optional: true` (matches npm
  `peerDependenciesMeta` semantics: declared as soft deps for
  audit/documentation purposes; consumers degrade gracefully when yellow-linear
  is absent — the Linear-specific commands surface "plugin not installed" rather
  than crashing).

  The schema extension (`schemas/plugin.schema.json`) and validator addition
  (RULE 11 in `scripts/validate-plugin.js`) ship in the same PR but do not
  require a changeset (root-level files, no plugin touches).

  ⚠️ External smoke gate: do NOT tag a release until a fresh
  `claude plugin install` smoke test confirms Claude Code's remote validator
  accepts the new `optional` and `reason` fields. Local CI passing does NOT
  guarantee remote validator acceptance — see
  `docs/solutions/build-errors/userconfig-type-title-remote-validator-drift.md`
  for the precedent on local-vs-remote validator drift.

## 1.6.2

### Patch Changes

- [`2d71b33`](https://github.com/KingInYellows/yellow-plugins/commit/2d71b33916041afb1bf3a7b240a463de803c33e9)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Remove the v1.0
  → v2.0 dual-read migration path from the audit-synthesizer. The synthesizer
  now warns and skips any artifact with `schema_version` other than `"2.0"`. The
  `_migrated_from` stamp, `stats.migrated_from_v1` counter, and the SKILL.md
  "Schema Migration" section are removed; the `+0.05` confidence-gate bump on
  `failure_scenario == null` (the permanent v2.0 calibration arm) is preserved.

  `.debt/scanner-output/` is gitignored and typically overwritten by audit runs,
  so no version-controlled artifact is broken. Re-run all scanners after
  upgrading to regenerate v2.0 outputs; a full `/debt:audit` overwrites each
  scanner's output before synthesis. If you previously ran a partial audit
  (e.g., `--category`) or a scanner failed, delete stale
  `.debt/scanner-output/*.json` files before re-running so the synthesizer does
  not skip them.

  Background:
  `docs/brainstorms/2026-05-07-yellow-debt-dual-read-removal-brainstorm.md`.

## 1.6.1

### Patch Changes

- [`26026ce`](https://github.com/KingInYellows/yellow-plugins/commit/26026ce6b0bf38307aca7621a57e3560a551bba3)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Audit-only
  confirmation that all 5 scanner agents (ai-pattern, architecture, complexity,
  duplication, security-debt) emit the canonical v2.0 schema per the
  `debt-conventions` skill. The full v2.0 finding schema includes `finding`,
  `file`, `failure_scenario`, `confidence`, `category`, `severity`, `effort`,
  and `fix` (see `plugins/yellow-debt/skills/debt-conventions/SKILL.md` for the
  authoritative field list); each scanner's "Output Requirements" section
  delegates to that skill rather than enumerating the fields inline. Closes Wave
  3 #7 from the EveryInc merge plan.

  Verified by line-grep against each scanner's "## Output Requirements" section
  (referencing section heading rather than line number so this audit record does
  not go stale on subsequent edits):
  - `ai-pattern-scanner.md` "## Output Requirements" → cites `debt-conventions`
    v2.0 ✓
  - `architecture-scanner.md` "## Output Requirements" → cites v2.0 ✓
  - `complexity-scanner.md` "## Output Requirements" → cites v2.0 ✓
  - `duplication-scanner.md` "## Output Requirements" → cites v2.0 ✓
  - `security-debt-scanner.md` "## Output Requirements" → cites v2.0 ✓

  The dual-read logic in `audit-synthesizer.md` ("### 1. Read Scanner Outputs"
  section) handles v1.0 → v2.0 migration via explicit `schema_version` field
  check, so existing `.debt/scanner-output/*.json` files do not break on
  re-encounter. No code changes required in this PR.

  No body changes to scanner agents; this PR exists to record the audit
  completion in the changelog and bump the patch version so downstream catalog
  version sync reflects the verified state.

## 1.6.0

### Minor Changes

- [`01cc4c0`](https://github.com/KingInYellows/yellow-plugins/commit/01cc4c0246115a5bd3a60d26b956eed90626456b)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add
  prompt-injection hardening to debt scanners and CI agents

  Adds the CRITICAL SECURITY RULES + content-fencing block (already present in
  yellow-core and yellow-review review agents) to 5 yellow-debt scanners
  (ai-pattern, architecture, complexity, duplication, security-debt) and 4
  yellow-ci agents (failure-analyst, workflow-optimizer, runner-assignment,
  runner-diagnostics). These agents read untrusted content (source code, CI
  logs, workflow files) and benefit from the same injection-defense posture as
  the review agents.
  - yellow-debt scanners use the canonical pattern from yellow-core review
    agents (`--- code begin ---` fence, "code comments" wording) which matches
    the `debt-conventions` skill.
  - yellow-ci agents use artifact-typed delimiters (`--- begin ci-log ---`,
    `--- begin workflow-file: <name> ---`, `--- begin runner-output: ... ---`)
    defined in the `ci-conventions` skill, since CI agents process logs and
    workflow files rather than source code.

### Patch Changes

- [`01cc4c0`](https://github.com/KingInYellows/yellow-plugins/commit/01cc4c0246115a5bd3a60d26b956eed90626456b)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add deliberate
  model routing and per-repo plugin lint script

  **Model routing** — set explicit models on 5 agents/commands where the default
  `inherit` is wasteful or insufficient:
  - `model: haiku` on pure display/status commands (`debt:status`,
    `semgrep:status`) — matches precedent in `ci:status`. Low reasoning needs
    don't require Sonnet-level inference.
  - `model: opus` on heavy-reasoning agents: `architecture-strategist` (SOLID /
    coupling analysis), `research-conductor` (multi-source synthesis),
    `audit-synthesizer` (cross-scanner merging with severity scoring).

  Caveats documented in the plan:
  - GitHub Issue #14863 — verify Haiku + `tool_reference` block support in
    current Claude Code version; affected agents only use Bash/Skill/
    AskUserQuestion so low risk.
  - GitHub Issue #29768 — model inheritance bug; setting `model:` explicitly
    (not relying on inherit) avoids this.

  **Plugin lint script** — introduces `scripts/lint-plugins.sh`, a shell-only
  lint that validates agent frontmatter (name/description/tools), flags the
  `memory: true` mistake (correct form is a scope string), and verifies skill
  references resolve to an existing SKILL.md. Wired into CI via
  `.github/workflows/lint-plugins.yml`.

  The lint currently reports 0 errors and 0 warnings — all `memory: true`
  occurrences were migrated to valid scope strings in prior stack PRs (#253 and
  #255), so this lint lands clean on day one.

## 1.5.0

### Minor Changes

- [#255](https://github.com/KingInYellows/yellow-plugins/pull/255)
  [`3b4025e`](https://github.com/KingInYellows/yellow-plugins/commit/3b4025e8c1af062223ea8db4bf6b067f439156c6)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add
  prompt-injection hardening to debt scanners and CI agents

  Adds the CRITICAL SECURITY RULES + content-fencing block (already present in
  yellow-core and yellow-review review agents) to 5 yellow-debt scanners
  (ai-pattern, architecture, complexity, duplication, security-debt) and 4
  yellow-ci agents (failure-analyst, workflow-optimizer, runner-assignment,
  runner-diagnostics). These agents read untrusted content (source code, CI
  logs, workflow files) and benefit from the same injection-defense posture as
  the review agents.
  - yellow-debt scanners use the canonical pattern from yellow-core review
    agents (`--- code begin (reference only) ---` fence, "code comments"
    wording) which matches the `debt-conventions` skill.
  - yellow-ci agents use artifact-typed delimiters (`--- begin ci-log ---`,
    `--- begin workflow-file: <name> ---`, `--- begin runner-output: ... ---`)
    defined in the `ci-conventions` skill, since CI agents process logs and
    workflow files rather than source code.

### Patch Changes

- [#255](https://github.com/KingInYellows/yellow-plugins/pull/255)
  [`3b4025e`](https://github.com/KingInYellows/yellow-plugins/commit/3b4025e8c1af062223ea8db4bf6b067f439156c6)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Set memory
  scope on workflow orchestrators; sharpen overlap descriptions

  Add `memory: project` to 4 workflow orchestrators (brainstorm-orchestrator,
  knowledge-compounder, spec-flow-analyzer in yellow-core; devin-orchestrator in
  yellow-devin) so they accrue cross-session learning per project. The correct
  frontmatter form is a scope string (`user`/`project`/`local`), not the boolean
  `memory: true` used elsewhere in the codebase.

  Also correct invalid `memory: true` to `memory: project` on the remaining 12
  agents that were not covered by the parent PR's review-agent sweep:
  yellow-core (repo-research-analyst, git-history-analyzer, security-reviewer,
  performance-reviewer, security-lens, session-historian), yellow-research
  (code-researcher, research-conductor), yellow-docs (doc-auditor,
  doc-generator, diagram-architect), and yellow-review
  (project-compliance-reviewer). After this PR, no agent in the repository
  declares the invalid `memory: true`.

  Note on tool surface: per Claude Code docs, `memory: <scope>` automatically
  enables Read/Write/Edit so agents can persist learnings to
  `.claude/agent-memory/<name>/`. For yellow-review's review agents — which the
  plugin's CLAUDE.md documents as "report findings, do NOT edit project files
  directly" — the prompt-level read-only contract remains the source of truth;
  the orchestrating `/review:pr` command applies all fixes. The implicit
  Write/Edit grant is required for memory persistence and does not reflect a
  change in agent responsibility.

  Sharpen the `description:` trigger clauses for two overlap pairs:
  - security-sentinel (active vulnerabilities) vs security-debt-scanner (debt
    patterns that could become vulnerabilities)

  The code-simplicity-reviewer vs code-simplifier pair already had clear
  pre-fix/post-fix trigger clauses — no change needed there.

- [#255](https://github.com/KingInYellows/yellow-plugins/pull/255)
  [`3b4025e`](https://github.com/KingInYellows/yellow-plugins/commit/3b4025e8c1af062223ea8db4bf6b067f439156c6)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Enable true
  parallel execution for multi-agent review sessions

  Add `background: true` to 13 review agents (7 in yellow-core/agents/review, 6
  in yellow-review/agents/review) plus `best-practices-researcher` and update
  orchestrator commands (review-pr.md, resolve-pr.md, work.md, audit.md) to
  explicitly require `run_in_background: true` on each Task invocation.
  Frontmatter flag alone is insufficient — the spawning call must also run in
  the background for agents to run concurrently rather than serially. Also
  correct invalid `memory: true` to `memory: project` (the field requires a
  scope string: `user` / `project` / `local`).

## 1.4.1

### Patch Changes

- [`ab3f2d3`](https://github.com/KingInYellows/yellow-plugins/commit/ab3f2d365c911d8f5bdeff9f9cf0f141f254fb03)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Enable true
  parallel execution for multi-agent review sessions

  Add `background: true` to 15 agents (7 in yellow-core/agents/review, 6 in
  yellow-review/agents/review, plus
  `yellow-core/agents/research/best-practices-researcher` and
  `yellow-review/agents/workflow/pr-comment-resolver`) and update four
  orchestrator commands (`review-pr.md`, `resolve-pr.md`, `work.md`, `audit.md`)
  to explicitly require `run_in_background: true` on each Task invocation, with
  explicit wait gates (TaskOutput / TaskList polling) before any step that
  consumes agent output. Frontmatter flag alone is insufficient — the spawning
  call must also run in the background for agents to run concurrently rather
  than serially.

  Memory field changes: drop the prior `memory: true` from review and research
  agents (it was a no-op and re-adding a scope value would silently activate
  per-spawn MEMORY.md injection of up to ~25 KB across 13+ parallel agents). Set
  `memory: project` only on the three workflow orchestrators
  (`brainstorm-orchestrator`, `knowledge-compounder`, `spec-flow-analyzer`),
  where MEMORY.md context is intentional and the spawn fan-out is small.
  Auditing the broader `memory:` activation across review agents remains a Phase
  1.5 follow-up (plan open question 8).

## 1.4.0

### Minor Changes

- [#316](https://github.com/KingInYellows/yellow-plugins/pull/316)
  [`bc6aa3f`](https://github.com/KingInYellows/yellow-plugins/commit/bc6aa3f7d6a7269d141939615816e9217225a1b1)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - # Scanner
  output schema v2.0 — failure_scenario field, audit-synthesizer

  confidence-rubric gate, dual-read v1.0/v2.0 transition window (W3.13b)

  Bumps `debt-conventions/SKILL.md` from `schema_version: "1.0"` to `"2.0"` and
  restructures the scanner output shape:
  - `affected_files[]` (array) → `file` (single object); multi-file findings
    emit one finding per file instead of packing them into one entry
  - `title` + `description` → flat `finding` string
  - `suggested_remediation` → `fix`
  - new required `failure_scenario` field (string or `null`) —
    one-to-two-sentence concrete production failure: trigger → execution path →
    user-visible or operational outcome. Borrowed from upstream
    `EveryInc/compound-engineering-plugin` `ce-adversarial-reviewer.agent.md` at
    locked SHA `e5b397c9d1883354f03e338dd00f98be3da39f9f`.

  `audit-synthesizer` gains a category-specific confidence-rubric gate (Step 4):
  security-debt/architecture ≥0.80, complexity/duplication ≥0.70, ai-pattern
  ≥0.60. Critical findings survive at ≥0.50 (mirrors the Wave 2 P0-at-anchor-50
  exception). Migrated v1.0 inputs receive a +0.05 threshold bump to compensate
  for the missing `failure_scenario` signal.

  The synthesizer dual-reads `schema_version: "1.0"` and `"2.0"` artifacts
  during the transition window, normalizing v1.0 inputs to the v2.0 in-memory
  shape so existing `.debt/scanner-output/*.json` files do not break re-runs.
  Suppressed findings are preserved in a `suppressed[]` array on the audit
  report (with the gate that suppressed them) rather than silently dropped.

  All 5 scanner agents (`ai-pattern`, `architecture`, `complexity`,
  `duplication`, `security-debt`) updated with category-specific
  `failure_scenario` framing guidance in their Output Requirements sections. The
  yellow-debt README todo template gains a `## Failure Scenario` section so
  triage reviewers see the production-impact framing alongside the debt
  description.

  Schema evolution: scanner output is renamed v1.0 → v2.0 with field renames and
  a new required failure_scenario field. The audit-synthesizer's dual-read
  transition window normalizes v1.0 inputs in-memory, so existing scanner
  outputs continue to work without modification during the transition window.

## 1.3.0

### Minor Changes

- [`dfebc48`](https://github.com/KingInYellows/yellow-plugins/commit/dfebc48f74c6b88cf6c5ccff73e3ad604dca714c)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add ast-grep
  MCP tools to 4 high-value review and debt agents

  Add ast-grep structural code search (find_code, find_code_by_rule) with
  ToolSearch-based graceful degradation to silent-failure-hunter,
  type-design-analyzer, duplication-scanner, and complexity-scanner. Each agent
  includes tailored AST vs Grep routing guidance and falls back to Grep when
  yellow-research is not installed.

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## Unreleased

_No unreleased changes yet._

---

## [1.2.0] - 2026-03-10

### Minor Changes

- [`69d84c8`](https://github.com/KingInYellows/yellow-plugins/commit/69d84c8f17a23da89979765c434d4e2c0c683935)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Expand
  marketplace setup coverage with dedicated setup commands, repository-root
  aware setup checks, and stricter setup validation guardrails.

---

## [1.1.0] - 2026-02-25

### Fixed

- Remove unsupported `changelog` key from plugin.json that blocked installation
  via Claude Code's remote validator.

---

## [1.0.0] - 2026-02-18

### Added

- Initial release — technical debt audit and remediation with parallel scanner
  agents for AI-generated code patterns.

---

**Maintained by**: [KingInYellows](https://github.com/KingInYellows)
