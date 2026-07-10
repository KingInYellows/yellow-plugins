# Changelog

## 1.3.6

### Patch Changes

- [#629](https://github.com/KingInYellows/yellow-plugins/pull/629)
  [`24d3aa6`](https://github.com/KingInYellows/yellow-plugins/commit/24d3aa6ec7112bca54d24553553e9e031e879cd3)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - fix: deny
  Write/Edit/MultiEdit on the doc-auditor agent (its `memory: project`
  frontmatter auto-grants write tools) and document the read-only Bash exception
  — `disallowedTools` alone cannot stop shell-routed writes, so the agent now
  carries an explicit no-write-via-Bash contract limiting Bash to `git log`,
  `git blame`, and `git ls-files`.

- [#634](https://github.com/KingInYellows/yellow-plugins/pull/634)
  [`c7b5ae2`](https://github.com/KingInYellows/yellow-plugins/commit/c7b5ae251853e8e3c1f95872b0752bc1083d2ab5)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Audit doc-drift
  sweep (2026-07-09 full-marketplace audit, Wave 4): add the three standard
  SKILL.md headings (`## What It Does` / `## When to Use` / `## Usage`) to the 8
  skills flagged by RULE 15b — yellow-ci `ci-conventions`
  - `diagnose-ci`, yellow-codex `codex-patterns`, yellow-composio
    `composio-patterns`, yellow-core `create-agent-skills`, yellow-docs
    `docs-conventions`, yellow-research `research-patterns`, yellow-semgrep
    `semgrep-conventions` — clearing every RULE 15b advisory warning. Also adds
    Ceramic to yellow-research's marketplace.json description (mirroring
    plugin.json), and fixes the root README MCP counts against mechanical counts
    (nine MCP-bundling plugins, six yellow-research servers) with a one-line
    yellow-mempalace deprecation footnote under the MCP table.

## 1.3.5

### Patch Changes

- [#574](https://github.com/KingInYellows/yellow-plugins/pull/574)
  [`c23acde`](https://github.com/KingInYellows/yellow-plugins/commit/c23acde014fed8d04be5a991c08912c966678428)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - fix: align
  /docs:review adversarial depth derivation with the agent's first-match-wins
  tier predicates (the old text could pass depth="quick" for documents the
  agent's own Quick predicate rejects); rewrite the command description to lead
  with when-to-use trigger phrases and name the commands to use instead for
  out-of-scope requests

## 1.3.4

### Patch Changes

- [`bc32211`](https://github.com/KingInYellows/yellow-plugins/commit/bc322111486b01d4ccd4bdd07bf35e912f7f745d)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - feat(agents):
  close model/effort coverage gaps for 9 agents (M-A-05)

  Closes the three coverage gaps identified during M-A-01..M-A-04 review (PRs
  #467/469/470/471/477) that fell outside the original five-PR rollout scope.

  **6 agents downgraded `inherit` → `sonnet`** (no `effort:` — caller-flexible):
  - `yellow-core/agents/research/best-practices-researcher.md`
  - `yellow-core/agents/research/git-history-analyzer.md` (note: no
    `subagent_type` callers in commands or skills today; tier change is for
    consistency and future direct invocations)
  - `yellow-core/agents/research/repo-research-analyst.md`
  - `yellow-docs/agents/analysis/doc-auditor.md`
  - `yellow-docs/agents/generation/diagram-architect.md`
  - `yellow-docs/agents/generation/doc-generator.md`

  **3 yellow-review agents retain `model: opus` and gain explicit `effort:`**:
  - `agent-cli-readiness-reviewer` — `effort: high` (7-principle structured
    rubric, multi-axis but bounded)
  - `agent-native-reviewer` — `effort: high` (parity-matrix reasoning,
    structured)
  - `adversarial-reviewer` — `effort: xhigh` (constructs novel failure
    scenarios; no rubric ceiling — additional CoT directly expands the
    failure-mode search space rather than re-applying the same axes)

  **Establishes `xhigh` vs `high` vs `max` convention.** This PR is the first
  use of `xhigh` in the repo; `max` remains unused (community sources indicate
  it may be Opus 4.6-exclusive and return API errors on other model versions —
  avoid in agents that ship across Opus versions). The decision rule is now
  documented in
  `docs/solutions/code-quality/subagent-frontmatter-field-catalog.md` as part of
  this PR.

  Once PR #477 (V3/V4 model/effort validation rules) lands, all 9 agents will be
  inapplicable to those rules: none are in `agents/scanners/` or `agents/ci/`
  (V3 inert), and none of their `name:` fields match the
  synthesizer/orchestrator/conductor/aggregator/compounder pattern (V4 inert).
  No allowlist updates will be required when PR #477 merges.

## 1.3.3

### Patch Changes

- [`6367eae`](https://github.com/KingInYellows/yellow-plugins/commit/6367eae6811d1f5c3a0615f3a46730fd358299ab)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Tier
  yellow-core review/workflow personas + 2 yellow-docs reviewers to explicit
  `model:` frontmatter (Phase 3b of M-A-01).

  **yellow-core (8 files)** — single-axis review and structured analysis; Sonnet
  is the quality ceiling:
  - Review personas: code-simplicity-reviewer, pattern-recognition-specialist,
    test-coverage-analyst, polyglot-reviewer, security-lens, security-reviewer,
    performance-reviewer
  - Workflow: spec-flow-analyzer (UX flow analysis with defined axes)

  `security-sentinel`, `performance-oracle`, and `architecture-strategist` stay
  on `opus` (no change) — primary discovery agents and architectural judgment.

  **yellow-docs (2 files)**:
  - `feasibility-reviewer`: `model: sonnet` — structured feasibility assessment
    matching the sibling pattern (design-lens, scope-guardian,
    security-lens-reviewer, coherence-reviewer are all already explicitly
    tiered)
  - `adversarial-document-reviewer`: `model: sonnet` + `effort: high` — applies
    a structured challenge protocol; the adversarial angle benefits from
    extended chain-of-thought, but the protocol is structured enough that Sonnet
    is the appropriate ceiling

  **Already-correct (no edit) yellow-docs siblings** confirmed via grep:
  `design-lens-reviewer`, `scope-guardian-reviewer`, `security-lens-reviewer`
  all carry `model: sonnet` already — closes the documentation gap surfaced
  during planning.

  Per docs/research/model-selection-token-context-optimization.md.

## 1.3.2

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

## 1.3.1

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

## 1.3.0

### Minor Changes

- [`ef44204`](https://github.com/KingInYellows/yellow-plugins/commit/ef44204540e1ad2499cd9d9efa4d173c914dde6c)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add
  `/docs:review` command and 7 new persona reviewer agents for multi-perspective
  review of planning documents (PRDs, brainstorms, specs, ADRs, plans, design
  docs).

  **New command:**
  - `/docs:review <path>` — orchestrates parallel persona review with
    confidence-rubric aggregation. Mirrors yellow-review's Wave 2 pattern:
    optional learnings pre-pass, parallel persona dispatch, suppress findings
    with `confidence < 75` (except safe-auto and P0 escapes), optional safe-auto
    application, optional compound hand-off.

  **New review/ agents directory** (auto-discovered; no plugin.json edit
  needed):
  - `coherence-reviewer` (haiku) — Internal consistency, contradictions,
    terminology drift, broken cross-references. Safe-auto patterns: header/body
    count mismatch, stale cross-reference, terminology drift between two
    interchangeable synonyms.
  - `design-lens-reviewer` (sonnet) — Information architecture, interaction
    states, user flows, accessibility, AI-slop check. Dimensional 0–10 rating;
    only emit findings for 7/10 or below.
  - `feasibility-reviewer` — Architecture reality, shadow path tracing
    (happy/nil/empty/error), dependencies, performance feasibility, migration
    safety, implementability.
  - `product-lens-reviewer` — Premise challenge (always first), strategic
    consequences (trajectory, identity, adoption, opportunity cost, compounding
    direction), implementation alternatives, goal-requirement alignment,
    prioritization coherence. Internal vs. external product context calibration.
  - `scope-guardian-reviewer` (sonnet) — "What already exists?", scope-goal
    alignment, complexity challenge, priority dependency analysis, completeness
    principle.
  - `security-lens-reviewer` (sonnet) — Plan-level threat model: attack surface
    inventory, auth/authz gaps, data exposure, third-party trust boundaries,
    secrets management.
  - `adversarial-document-reviewer` — CONDITIONAL persona, invoked when document
    has more than 5 requirements OR risk-domain keywords (auth, payments,
    migration, compliance, PII, cryptography). Depth-calibrated
    (quick/standard/deep). Five techniques: premise challenging, assumption
    surfacing, decision stress-testing, simplification pressure, alternative
    blindness.

  All 7 personas are read-only (`tools: [Read, Grep, Glob]`), 3-segment
  `subagent_type` compliant, and emit the standard yellow-docs compact-return
  JSON schema with category-appropriate fields. Adapted from upstream
  compound-engineering v3.3.2 at locked SHA
  `e5b397c9d1883354f03e338dd00f98be3da39f9f`. Bash stripped from tools per
  review-agent read-only contract.

  CLAUDE.md and README.md updated: agent count 3 → 10, command count 5 → 6, new
  Review agent table, new "When to Use" row for `/docs:review`.

  Closes Wave 3 #2 from the EveryInc merge plan.

## 1.2.1

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

## 1.2.0

### Minor Changes

- [#290](https://github.com/KingInYellows/yellow-plugins/pull/290)
  [`65e2938`](https://github.com/KingInYellows/yellow-plugins/commit/65e29382c2df760ef62efca337c1fc6160193245)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Fix
  `subagent_type` 2-segment → 3-segment format across the `review:pr` keystone
  and other command files. Claude Code's Task registry resolves agents by the
  literal `plugin:directory:agent-name` triple from frontmatter — the 2-segment
  `plugin:agent-name` form silently mismatches and causes the
  graceful-degradation guard to skip every cross-plugin persona spawn.

  Also updates `scripts/validate-agent-authoring.js` to register both 2-segment
  and 3-segment forms (transitional — the 2-segment form remains accepted by the
  validator so non-keystone callers fail loudly only on the runtime mismatch,
  not on CI). New code should always emit the 3-segment form.

  `yellow-review` (MINOR — keystone behavior fix, no API change):
  - `commands/review/review-pr.md` — Step 3d `learnings-researcher` dispatch
    (`yellow-core:research:learnings-researcher`), the entire always-on /
    conditional / supplementary persona dispatch table (17 entries: 4 always-on
    plus 12 conditional plus 1 supplementary — `yellow-review:review:*` for the
    10 in-plugin personas, `yellow-core:review:*` for the 6 security / perf /
    architecture / pattern / simplicity / polyglot personas,
    `yellow-codex:review:codex-reviewer` for the optional supplementary), Step 8
    `yellow-review:review:code-simplifier`, and Step 9a
    `yellow-core:workflow:knowledge-compounder` all corrected to the
    three-segment registry form.
  - `commands/review/review-all.md` — `learnings-researcher` Task example in the
    inlined per-PR pipeline corrected to
    `yellow-core:research:learnings-researcher`.
  - `skills/pr-review-workflow/SKILL.md` — Cross-Plugin Agent References
    examples corrected to `yellow-core:review:security-sentinel` and
    `yellow-codex:review:codex-reviewer`; pattern hint expanded from
    `yellow-core:<agent-name>` to `yellow-core:<dir>:<agent-name>` so future
    authors copy the right form.
  - `agents/review/code-reviewer.md` — Deprecation stub frontmatter and body
    migration prose updated to spell out the three-segment form
    (`yellow-review:review:code-reviewer` →
    `yellow-review:review:project-compliance-reviewer`); the stub's
    residual_risks JSON also corrected so any caller still landing on the stub
    gets a copy-pasteable replacement string.
  - `CLAUDE.md` Cross-Plugin Agent References — Both intro paragraphs updated to
    specify the three-segment form with a concrete example.

  `yellow-core` (MINOR — self-reference fix on Wave 2 keystone agent and core
  workflow commands):
  - `agents/research/learnings-researcher.md` Integration section — Standalone
    invocation example corrected to `yellow-core:research:learnings-researcher`.
  - `commands/workflows/compound.md` — `knowledge-compounder` dispatch corrected
    to `yellow-core:workflow:knowledge-compounder`.
  - `commands/workflows/work.md` — Codex rescue dispatch corrected to
    `yellow-codex:workflow:codex-executor`.

  `yellow-docs` (MINOR — every cross-agent dispatch was 2-segment):
  - `commands/docs/audit.md` — `doc-auditor` →
    `yellow-docs:analysis:doc-auditor`.
  - `commands/docs/diagram.md` — `diagram-architect` →
    `yellow-docs:generation:diagram-architect`.
  - `commands/docs/generate.md` — `doc-generator` →
    `yellow-docs:generation:doc-generator`.
  - `commands/docs/refresh.md` — both `doc-auditor` and `doc-generator`
    references updated as above.

  `yellow-research` (MINOR — deepen-plan dispatch was 2-segment):
  - `commands/workflows/deepen-plan.md` — `repo-research-analyst` →
    `yellow-core:research:repo-research-analyst`; `research-conductor` →
    `yellow-research:research:research-conductor`.

  Triggers a marketplace release so consumers' plugin caches refresh; the
  keystone is otherwise dispatch-blocked end-to-end.

### Patch Changes

- [#288](https://github.com/KingInYellows/yellow-plugins/pull/288)
  [`6ca3de4`](https://github.com/KingInYellows/yellow-plugins/commit/6ca3de44a1ee1d8dc428222e0976c51567e332a7)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Fix
  subagent_type format to 3-segment (plugin:directory:agent) across keystone
  orchestrator and command files.

  The Wave 2 keystone (`/review:pr`) Step 4 dispatch table, Step 3d learnings
  pre-pass, Step 7 code-simplifier pass, and Step 9a knowledge-compounding step
  all referenced agents using the 2-segment form (e.g.
  `yellow-review:correctness-reviewer`). The Claude Code agent registry requires
  the 3-segment form (`yellow-review:review:correctness-reviewer`, where the
  middle segment is the agent's subdirectory under `plugins/<name>/agents/`).
  The 2-segment form fails dispatch with "Agent type not found" — meaning every
  persona spawn from the new keystone would error even after the cache picks up
  the new agents.

  This is purely a documentation / orchestration-prose fix; no agent behaviour
  changes. Affected files:
  - `plugins/yellow-review/commands/review/review-pr.md` — 17 dispatch table
    entries + 3 inline `subagent_type:` references
  - `plugins/yellow-review/commands/review/review-all.md` — 1 inline reference
    (parity with review-pr.md Step 3d)
  - `plugins/yellow-review/skills/pr-review-workflow/SKILL.md` — 2 cross-plugin
    Task examples (security-sentinel, codex-reviewer); pattern hint expanded to
    clarify the 3-segment shape
  - `plugins/yellow-review/agents/review/code-reviewer.md` — deprecation-stub
    migration guidance (was pointing users to the wrong format)
  - `plugins/yellow-core/commands/workflows/compound.md` — knowledge-compounder
    dispatch
  - `plugins/yellow-core/commands/workflows/work.md` — codex-executor rescue
    dispatch
  - `plugins/yellow-core/agents/research/learnings-researcher.md` — usage-doc
    invocation example
  - `plugins/yellow-docs/commands/docs/audit.md`, `diagram.md`, `generate.md`,
    `refresh.md` — 5 doc-auditor / diagram-architect / doc-generator dispatches

  Discovered while running a manual /review:pr trial against PR #287 (Wave 3
  trial branch). Every Wave 2 persona dispatch errored with "Agent type not
  found" until the 3-segment form was used. This blocks the keystone from
  running end-to-end even after a plugin cache refresh.

## 1.1.0

### Minor Changes

- [`e3ef6ff`](https://github.com/KingInYellows/yellow-plugins/commit/e3ef6ffbd175c44756d1c6ac7511b1040d2e9720)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add yellow-docs
  documentation plugin with 5 commands (setup, audit, generate, diagram,
  refresh), 3 agents, and 1 shared skill. Register in marketplace and setup:all.

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## 1.0.0

### Added

- Initial release
- `/docs:setup` — validate prerequisites and detect project structure
- `/docs:audit` — scan repo for documentation gaps, staleness, and coverage
- `/docs:generate` — AI-assisted documentation generation with human review
- `/docs:diagram` — context-aware Mermaid diagram generation
- `/docs:refresh` — update stale docs based on code changes
