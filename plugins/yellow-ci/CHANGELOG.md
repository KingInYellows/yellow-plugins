# Changelog

## 1.4.5

### Patch Changes

- [#572](https://github.com/KingInYellows/yellow-plugins/pull/572)
  [`2cca221`](https://github.com/KingInYellows/yellow-plugins/commit/2cca2214b65ad82b8e52c41b813010c4de5eeb0b)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - fix: replace
  stale Linear MCP tool name in /ci:report-linear (`create_issue` → `save_issue`
  with `team`/`labels` params); add executable validation snippets to /ci:setup
  (sources `validate_ssh_host`/`validate_ssh_key_path` via
  `${CLAUDE_PLUGIN_ROOT}`); wire failure-analyst log fetch through
  `redact_secrets` instead of a prose-only redaction instruction

## 1.4.4

### Patch Changes

- [#530](https://github.com/KingInYellows/yellow-plugins/pull/530)
  [`27af862`](https://github.com/KingInYellows/yellow-plugins/commit/27af8620ffeeb797cd0e3ac7edbf58511f9d10dc)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - refactor:
  decompose god functions in yellow-ci shell libs and scripts/

  Decomposes seven flagged complexity hotspots (debt audit findings 005, 018,
  020, 027, 028, 030, 031) — pure extraction, no behavior change. Each refactor
  is covered by characterization or pre-existing tests run before and after.
  - `resolve-runner-targets.sh`: extract `rt_atomic_write()` (deduplicates the
    two tmp+rename cache writes) and `emit_runner_json()` (the JSON-build loop)
    out of the ~213-line `resolve_runner_targets()`. New characterization suite
    `tests/resolve-runner-targets.bats` (8 tests) committed first.
  - `validate.sh`: flatten `validate_ssh_host()`'s 4-deep IPv4 nesting into
    `_validate_private_ipv4()`; split `validate_runner_targets_file()` into
    `_rt_check_yaml_syntax()`, `_rt_check_runner_names()`,
    `_rt_check_target_counts()`.
  - `scripts/validate-agent-authoring.js`: decompose the 225-line top-level scan
    into `validateAgentFile()`, `buildTwoToThreeSegmentMap()`,
    `validateSubagentReferences()`, `validateCommandFiles()`, and a `main()`.
  - `scripts/lint-plugins.sh`: extract the nested skill-reference block into
    `check_skill_references()`.
  - `scripts/backfill-solution-frontmatter.js`: split `processEntry()` into
    `computeAdditions()` + `writeEntry()`; split `fmGetScalar()`'s 3 YAML-form
    branches into `resolveScalarValue()`.

  All gates green: yellow-ci Bats (147 tests), `pnpm test:integration` (99),
  `pnpm lint`, shellcheck.

- [#532](https://github.com/KingInYellows/yellow-plugins/pull/532)
  [`be06a57`](https://github.com/KingInYellows/yellow-plugins/commit/be06a571a9e8817870eec61b5844aec3c5182163)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - fix: remediate
  7 security-debt patterns across 6 plugins and root scripts

  Targeted fixes for the security-debt findings (006, 009, 017, 022, 023,
  032, 033) from the 2026-05-13 audit.
  - **006** `yellow-research/scripts/install-ast-grep.sh`: replace `curl … | sh`
    with download-to-temp over `--proto =https`, shebang sanity-check, then
    execute the local copy. The uv installer URL is version-pinned for
    reproducibility.
  - **009** `scripts/export-ci-metrics.sh`: allowlist-validate `STAGE` /
    `STATUS` and validate `ADDITIONAL_LABELS` key/value pairs before they are
    embedded in Prometheus label output — prevents label injection.
  - **017** `yellow-devin/commands/devin/delegate.md`: validate the git remote
    URL format and wrap the gathered Repository/Branch context in
    `--- begin/end repository context (reference only) ---` fencing before it
    enters the Devin task prompt.
  - **022** `yellow-composio/hooks/check-mcp-url.sh`: drop the brittle hardcoded
    cache-path fallback for `CLAUDE_PLUGIN_ROOT` — skip the credential-status
    write when it is unset rather than guessing a path.
  - **023** `yellow-ci/hooks/scripts/session-start.sh`: hash the `$PWD`-derived
    cache key (md5, 32 chars) so deeply-nested paths cannot exceed the 255-byte
    filename limit and break the cache path.
  - **032** `gt-workflow/hooks/check-commit-message.sh`: extend the `-m` grep to
    also match single-quoted arguments — `-m 'feat: x'` previously bypassed
    conventional-commit enforcement entirely.
  - **033** `yellow-morph/lib/install-morphmcp.sh`: validate `owner_pid` is
    numeric before `kill -0`, treating an empty/corrupt pid file as a stale lock
    instead of passing garbage to `kill`.

  Gates: `pnpm validate:plugins`, yellow-ci Bats (147), shellcheck, bash -n —
  all green.

- [#529](https://github.com/KingInYellows/yellow-plugins/pull/529)
  [`8a004b7`](https://github.com/KingInYellows/yellow-plugins/commit/8a004b7f30dcd0b9858f027b7cb5f57d120d398c)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - refactor:
  extract validate_file_path to shared yellow-core/lib/validate-fs.sh

  `validate_file_path()` (and `canonicalize_project_dir()`) were copy-pasted
  across `yellow-ci`, `yellow-ruvector`, and `yellow-debt` with divergent
  implementations — a security fix to one copy was easily missed in the others
  (debt audit findings 002/003/004).
  - `plugins/yellow-core/lib/validate-fs.sh` — new canonical home for both
    functions, sourced via `${CLAUDE_PLUGIN_ROOT}/../yellow-core/lib/` per the
    `credential-status.sh` precedent. Canonical impl = yellow-ruvector's
    (separate `canonicalize_project_dir`, `tr -d` newline detection, explicit
    symlink-escape block) plus two deliberate enhancements: optional `$2`
    project root with git-toplevel fallback (yellow-debt callers rely on it),
    and internal root canonicalization for reliable containment checks.
  - The three plugins' local `lib/validate.sh` files now source the shared
    helper with a `[ -f ]` guard and keep only their plugin-specific validators.
  - `plugins/yellow-core/tests/validate-fs.bats` — canonical test suite; each
    plugin's `validate.bats` sources the shared lib directly.

  Review pass follow-ups in this PR:
  - Idempotency guard (`_VALIDATE_FS_LOADED`) added to validate-fs.sh so
    double-sourcing (test setup + runtime hook chain) is safe.
  - yellow-debt declares yellow-core as a required `dependencies` entry; the
    consuming `lib/validate.sh` now warns to stderr when the helper is absent
    rather than letting callers fail silently at exit 127.
  - AGENTS.md and `plugins/yellow-{core,debt,ruvector}` docs updated to point to
    the new shared lib (parallel to the credential-status.sh precedent).
  - `ruvector-conventions` SKILL.md updated to describe the actual `cd+pwd -P` /
    `realpath` validation (no longer `realpath -m`).

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
