# Changelog

## 2.3.3

### Patch Changes

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

## 2.3.2

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

## 2.3.1

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

## 2.3.0

### Minor Changes

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

## [2.2.0] - 2026-04-17

### Minor Changes

- **Adopt `userConfig` for credential entry.** `DEVIN_SERVICE_USER_TOKEN`
  (sensitive) and `DEVIN_ORG_ID` (non-sensitive — IDs are not secrets) are now
  declared as `userConfig` fields in `plugin.json`. Claude Code prompts for them
  at plugin-enable time and stores the token in the system keychain (or
  `~/.claude/.credentials.json` at 0600 perms on Linux). Commands still read the
  shell env vars for curl invocations, so existing shell-env setups continue to
  work unchanged — userConfig is an additive UX improvement, not a breaking
  change. `/setup:all` now classifies the plugin READY when either source is
  present.
- `/devin:setup` now emits a dual-source drift WARNING when userConfig is
  configured but the corresponding shell env var is empty, noting that
  `/devin:*` curl-based commands will return 401 until the shell export is also
  added.

### Migration (existing users)

- No action required for existing shell-env setups — they continue working
  unchanged. `DEVIN_SERVICE_USER_TOKEN` and `DEVIN_ORG_ID` shell exports are
  still read by all `/devin:*` commands.
- Recommended for new installs: answer the userConfig prompt at plugin enable so
  the token is keychain-backed and Claude Code's MCP env substitution handles
  authentication for the MCP server without a shell export. **`/devin:*`
  curl-based commands still need the same values exported in the shell** — they
  do not read userConfig directly. In this release the two sources remain
  independent for backward compat: keychain backs the MCP, shell env backs the
  curl-based commands. Power users who want the curl path to work without a
  shell export can author a thin per-command CLI bridge that resolves the
  credential from the keychain at invocation time — see yellow-morph's
  `bin/start-morph.sh` for a reference pattern of that shape.

## 2.1.2

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

## 2.1.1

### Patch Changes

- [`9c01fbf`](https://github.com/KingInYellows/yellow-plugins/commit/9c01fbf4f95973bdeab77a67eb4b68d62d0bdc29)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Fix 403 error
  when sending messages to Devin sessions by adding ManageOrgSessions permission
  probe to setup and PR comment fallback to message/review-prs commands

## 2.1.0

### Minor Changes

- [`f2e890a`](https://github.com/KingInYellows/yellow-plugins/commit/f2e890aff6868a7926eab930c20dbddc33c2683f)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add a
  `/devin:review-prs` command for discovering Devin-authored PRs in the current
  repository, triaging review findings, and choosing whether to fix them locally
  or send remediation back to Devin.

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.0.1] - 2026-02-25

### Fixed

- Remove unsupported `changelog` key from plugin.json that blocked installation
  via Claude Code's remote validator.

---

## [2.0.0] - 2026-02-23

### Added

- Add devin-orchestrator agent for multi-step plan-implement-review cycles.

### Changed

- Migrate to Devin V3 API. Breaking change: all session management endpoints
  updated.

---

## [1.0.0] - 2026-02-18

### Added

- Initial release — Devin.AI integration for multi-agent workflows: delegate
  tasks, research codebases, orchestrate plan-implement-review chains.

---

**Maintained by**: [KingInYellows](https://github.com/KingInYellows)
