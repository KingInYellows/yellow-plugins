# Changelog

## 1.4.3

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

## 1.4.2

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

## 1.4.1

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

## 1.4.0

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

## 1.3.0

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

## 1.2.0

### Minor Changes

- [`095f325`](https://github.com/KingInYellows/yellow-plugins/commit/095f3255d7402b45d22f6d10f33a7665590c67e3)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add layered
  runner targets configuration system with new `/ci:setup-runner-targets`
  command, global/per-repo config resolution, session-start hook routing
  summary, and semantic scoring in runner-assignment agent.

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.0] - 2026-02-25

### Fixed

- Remove unsupported `changelog` key from plugin.json that blocked installation
  via Claude Code's remote validator.

---

## [1.0.0] - 2026-02-18

### Added

- Initial release — CI failure diagnosis, workflow linting, and runner health
  management for self-hosted GitHub Actions runners.

---

**Maintained by**: [KingInYellows](https://github.com/KingInYellows)
