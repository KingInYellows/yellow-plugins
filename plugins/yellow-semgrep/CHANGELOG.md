# Changelog

## 4.1.1

### Patch Changes

- [#534](https://github.com/KingInYellows/yellow-plugins/pull/534)
  [`70a5148`](https://github.com/KingInYellows/yellow-plugins/commit/70a5148a24e5213ed4a69fb21e3ba2ac8af36782)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - refactor:
  de-duplicate install-script helpers via a build-time generator

  The `version_gte()` semver comparator and the color-output helpers
  (`error`/`warning`/`success` + the `RED/GREEN/YELLOW/NC` constants) were
  copy-pasted byte-identically across the plugin install scripts (debt findings
  014/015/036/037).
  - `scripts/snippets/install-helpers.sh` +
    `scripts/snippets/install-version-gte.sh` — canonical sources, single point
    of truth.
  - `scripts/sync-shell-snippets.js` — generator that injects each canonical
    snippet into the consuming install scripts between
    `# >>> generated: <name> >>>` / `# <<< generated: <name> <<<` sentinel
    markers. `pnpm generate:snippets` regenerates; `pnpm validate:snippets` (and
    now `pnpm validate:schemas`, run in CI) fails on drift.
  - `install-codex.sh` and `install-semgrep.sh` embed both snippets;
    `install.sh` (yellow-ruvector) and `install-ast-grep.sh` (yellow-research)
    embed `install-helpers` only. yellow-ruvector keeps its own `version_lt` (a
    distinct comparator); yellow-research does not need version comparison.

  No behavior change — the embedded blocks are byte-identical to the prior
  inline copies. Gates: `generate:snippets` + `validate:snippets` (drift caught
  on tamper, clean on sync), `validate:plugins`, shellcheck, bash -n.

- [#533](https://github.com/KingInYellows/yellow-plugins/pull/533)
  [`c42f470`](https://github.com/KingInYellows/yellow-plugins/commit/c42f470babb5c71ac0c8fe5d1fba98edc7f9ca12)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - refactor: dedup
  yellow-research MCP wrappers and credential-status hook scaffold

  Consolidates two families of copy-pasted shell (debt findings 011/012/013 and
  024/025).
  - **011/012/013** — the three
    `yellow-research/bin/start-{exa,perplexity, tavily}.sh` MCP wrappers carried
    a byte-identical userConfig→env resolution block. Extracted to
    `bin/lib/resolve-mcp-key.sh` (`resolve_mcp_key VAR`); each wrapper is now ~4
    lines plus its distinct `npx` invocation. New `tests/resolve-mcp-key.bats`
    (5 tests).
  - **024/025** — `yellow-research` and `yellow-semgrep`'s
    `hooks/write-credential-status.sh` shared a ~40-line scaffold (version read,
    field classification, status write, `{"continue": true}` exit). Extracted to
    `credential_hook_scaffold` in `yellow-core/lib/credential-status.sh`; both
    hooks are now down to a source-guard plus the plugin-specific field-spec
    list. New `credential_hook_scaffold` tests in `credential-status.bats` (4
    tests).

  Both hooks still emit `{"continue": true}` on every path. Gates:
  `validate:plugins`, Bats (resolver 5, credential-status 16), shellcheck — all
  green.

## 4.1.0

### Minor Changes

- [#511](https://github.com/KingInYellows/yellow-plugins/pull/511)
  [`08c644d`](https://github.com/KingInYellows/yellow-plugins/commit/08c644dfecfc880121a761b457a0a5932215515f)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! -
  fix(yellow-semgrep): honor shell env as fallback for SEMGREP_APP_TOKEN

  The previous `plugin.json` env block set `SEMGREP_APP_TOKEN` directly to
  `${user_config.semgrep_app_token}`, which OVERWROTE any pre-existing shell env
  `SEMGREP_APP_TOKEN` with an empty string when the user dismissed the
  userConfig prompt. Power users on multi-host fleets who set the token in
  `.zshrc` / direnv / a secrets manager were silently downgraded to a broken MCP
  server.

  This change introduces `bin/start-semgrep.sh` (mirroring the canonical
  yellow-research/yellow-morph wrapper pattern) that resolves the token in this
  precedence order:
  1. userConfig value (preferred)
  2. Shell env `SEMGREP_APP_TOKEN` (fallback)
  3. Unset entirely (MCP sees "absent" not "empty string")

  Also adds a SessionStart hook (`hooks/write-credential-status.sh`) emitting
  `credential-status.json` per the protocol introduced in the previous
  yellow-core PR. `/setup:all` will consume this to render an accurate
  classification for yellow-semgrep without probing the keychain.

## 4.0.4

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

## 4.0.3

### Patch Changes

- [#386](https://github.com/KingInYellows/yellow-plugins/pull/386)
  [`8496a31`](https://github.com/KingInYellows/yellow-plugins/commit/8496a313eec4e9c0953357f6365dee760dfdc3c2)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - # Fix
  `userConfig` manifest validator drift — add required `type` and `title`

  Add `"type": "string"` and `"title": "<sentence-case label>"` to every
  `userConfig` entry in the four plugins that declared user-supplied
  credentials. The Claude Code remote validator (surfaced via `claude doctor`)
  rejects any `userConfig` entry missing either field; local CI was passing
  because `schemas/plugin.schema.json` made `type` optional and used `label`
  instead of `title`.

  Affected entries (7 total):
  - `yellow-devin`: `devin_service_user_token`, `devin_org_id`
  - `yellow-research`: `perplexity_api_key`, `tavily_api_key`, `exa_api_key`
  - `yellow-morph`: `morph_api_key`
  - `yellow-semgrep`: `semgrep_app_token`

  Companion changes outside the plugins (no changeset needed — repo root):
  - `schemas/plugin.schema.json` — `userConfigEntry` tightened: `type` and
    `title` now required, `type` enum extended with `directory` and `file`
    (parity with remote validator), unused `label` property removed, dead
    `allOf` branch (the `if not required type` fall-through) removed,
    `directory`/`file` default-type-string constraint branches added.
  - `scripts/validate-plugin.js` — RULE 9 added: hand-rolled `userConfig`
    enforcement (per-entry `type` enum check + `title` non-empty string check).
    The repo's local CI does not currently AJV-load `plugin.schema.json`, so
    script-level enforcement is what actually catches this drift before
    `claude doctor`.
  - `docs/solutions/build-errors/userconfig-type-title-remote-validator-drift.md`
    — new solutions doc cross-referencing the prior `changelog`/`repository`
    drift incidents.

  **Behavior change for users:** `sensitive: true` (or `false` for
  `devin_org_id`) is preserved verbatim — keychain storage and credential
  masking are unchanged. The new `title` field is a UI label only; it never
  carries the credential value. Plugin install behavior is unchanged for
  existing users; the change unblocks fresh installs that hit the strict remote
  validator.

## 4.0.2

### Patch Changes

- [`fa03464`](https://github.com/KingInYellows/yellow-plugins/commit/fa0346466d40a10510a379438e6995daffb90ea3)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Close the
  semgrep-mcp-migration plan after runtime tool-list verification against the
  built-in `semgrep mcp` server (semgrep v1.154.0): drop `semgrep_whoami` from
  the documented MCP tool surface (it is not exposed by the built-in server) and
  rewrite the stale "whoami does not work with API tokens" caveat in `CLAUDE.md`
  and `README.md` to point at REST `GET /api/v1/me` as the authoritative
  token-validation path. Affects
  `plugins/yellow-semgrep/{CLAUDE.md,README.md,commands/semgrep/setup.md}`.
  Documentation-only — no behavior changes.

## 4.0.1

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

## 4.0.0

### Major Changes

- [#259](https://github.com/KingInYellows/yellow-plugins/pull/259)
  [`160f021`](https://github.com/KingInYellows/yellow-plugins/commit/160f02182e5e37d66658fcd1d567893bf3026e0e)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Roll out
  userConfig-based credential storage across five plugins, replacing or
  augmenting shell environment variable lookups with Claude Code userConfig.
  - **yellow-semgrep** (BREAKING): `SEMGREP_APP_TOKEN` is now read from
    `userConfig.semgrep_app_token` instead of the shell environment variable.
    Users who supplied the token only via `SEMGREP_APP_TOKEN` in their shell
    profile must re-enter it via the userConfig prompt (run `/semgrep:setup`);
    the shell env path no longer feeds the MCP server at startup.
  - **yellow-research** (BREAKING): All three API keys (`PERPLEXITY_API_KEY`,
    `TAVILY_API_KEY`, `EXA_API_KEY`) are migrated to userConfig. Existing users
    who relied solely on shell env vars must answer the userConfig prompt to
    continue using the plugin; run `/research:setup` to re-enter credentials.
  - **yellow-devin** (additive): HTTP-MCP userConfig declaration added for
    `devin_service_user_token` and `devin_org_id`. The shell env fallback
    (`DEVIN_SERVICE_USER_TOKEN`, `DEVIN_ORG_ID`) continues to work; no action
    required for current users.
  - **yellow-core** (additive): New `mcp-health-probe` skill defining a
    canonical three-state MCP health classification (OFFLINE / DEGRADED /
    HEALTHY) for `/<plugin>:status` commands. The existing
    `mcp-integration-patterns` skill is split into three focused sub-skills for
    narrower auto-invocation: `memory-recall-pattern`,
    `memory-remember-pattern`, and `morph-discovery-pattern`. The umbrella
    `mcp-integration-patterns` skill is retained until consumers migrate. The
    `/setup:all` env-variable dashboard gains a `check_key()` helper that
    reports shell env vs userConfig state per credential.

## [3.0.0] - 2026-04-17

### Major Changes

- **Breaking:** `SEMGREP_APP_TOKEN` now read from `userConfig` by the MCP
  server. Migrated `mcpServers.semgrep.env.SEMGREP_APP_TOKEN` from shell env
  interpolation (`${SEMGREP_APP_TOKEN}`) to Claude Code's native `userConfig`
  (`${user_config.semgrep_app_token}`). The key is marked sensitive and prompts
  at plugin-enable time, stored in the system keychain. Fixes the "MCP silently
  fails to start on fresh install because the shell env var wasn't exported
  before launching Claude Code" failure mode.
- Curl-based REST calls in `/semgrep:*` commands continue to read the shell
  `SEMGREP_APP_TOKEN` — keep both sources in sync or run `/semgrep:setup`.
- `/semgrep:setup` Step 2 now accepts either source: shell `SEMGREP_APP_TOKEN`
  **or** userConfig `semgrep_app_token`. When only userConfig is configured, the
  curl-based connectivity probe is skipped (shell env is the path of record for
  curl in this plugin).

### Migration (existing users)

- Run `claude plugin update yellow-semgrep@yellow-plugins`. Claude Code detects
  the new `userConfig` field and prompts for the token on next plugin enable.
  Answer the prompt to migrate. The MCP will then start correctly without a
  Claude Code restart.
- If the prompt is skipped, the MCP will see an empty token and fail to start.
  Fix by running `/semgrep:setup` or toggling the plugin.
- Power users who maintained a pure shell-env setup can continue by leaving
  userConfig unset **and** adding a wrapper script as the
  `mcpServers.semgrep.command` (see yellow-morph's `bin/start-morph.sh` for a
  reference pattern), but this path is unsupported in 3.0.0.

## 2.0.1

### Patch Changes

- [`31da4b1`](https://github.com/KingInYellows/yellow-plugins/commit/31da4b14740f8eea7fc45501b94a2151c5a36009)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Fix shell
  portability and reliability in setup scripts. Replace bash-only version_gte()
  with POSIX-compatible implementation in install-codex.sh and
  install-semgrep.sh. Add fnm/nvm activation before Node version check and guard
  against fnm multishell ephemeral npm prefix in install-codex.sh. Fix dashboard
  reliability in setup:all by replacing Python heredoc with python3 -c,
  snapshotting tool paths to prevent PATH drift, and using find|xargs instead of
  find|while for plugin cache detection. Add web-app pre-flight check to
  browser-test:setup.

## 2.0.0

### Major Changes

- [`3603a9e`](https://github.com/KingInYellows/yellow-plugins/commit/3603a9e850cfdc7f55ad93db38f85686dcbd8462)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - #
  yellow-semgrep MCP migration

  BREAKING (MCP): migrate the plugin from deprecated `uvx semgrep-mcp` to the
  built-in `semgrep mcp` subcommand, requiring Semgrep CLI v1.146.0+ with
  version-aware setup and install diagnostics.

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.0] - 2026-03-10

### Minor Changes

- [`1c183f3`](https://github.com/KingInYellows/yellow-plugins/commit/1c183f3529250822df87180b5c9e69dadc2830a0)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add
  auto-install with confirmation for semgrep CLI and ast-grep binary in setup
  commands

---

## [1.0.0] - 2026-03-04

### Added

- Initial release — Semgrep security finding remediation via hybrid MCP + REST
  API architecture.
- Commands: `/semgrep:setup`, `/semgrep:status`, `/semgrep:scan`,
  `/semgrep:fix`, `/semgrep:fix-batch`.
- Agents: `finding-fixer` (autofix-first with LLM fallback), `scan-verifier`
  (post-fix regression detection).
- Skill: `semgrep-conventions` with API patterns, triage state mappings, fix
  strategy decision tree, and security rules.
- References: `api-reference`, `fix-patterns`, `triage-states`.

---

**Maintained by**: [KingInYellows](https://github.com/KingInYellows)
