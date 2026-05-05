# Changelog

## [3.0.0] - 2026-04-17

### Major Changes

- **Breaking:** `SEMGREP_APP_TOKEN` now read from `userConfig` by the MCP
  server. Migrated `mcpServers.semgrep.env.SEMGREP_APP_TOKEN` from shell
  env interpolation (`${SEMGREP_APP_TOKEN}`) to Claude Code's native
  `userConfig` (`${user_config.semgrep_app_token}`). The key is marked
  sensitive and prompts at plugin-enable time, stored in the system
  keychain. Fixes the "MCP silently fails to start on fresh install
  because the shell env var wasn't exported before launching Claude
  Code" failure mode.
- Curl-based REST calls in `/semgrep:*` commands continue to read the
  shell `SEMGREP_APP_TOKEN` — keep both sources in sync or run
  `/semgrep:setup`.
- `/semgrep:setup` Step 2 now accepts either source: shell
  `SEMGREP_APP_TOKEN` **or** userConfig `semgrep_app_token`. When only
  userConfig is configured, the curl-based connectivity probe is
  skipped (shell env is the path of record for curl in this plugin).

### Migration (existing users)

- Run `claude plugin update yellow-semgrep@yellow-plugins`. Claude Code
  detects the new `userConfig` field and prompts for the token on next
  plugin enable. Answer the prompt to migrate. The MCP will then start
  correctly without a Claude Code restart.
- If the prompt is skipped, the MCP will see an empty token and fail to
  start. Fix by running `/semgrep:setup` or toggling the plugin.
- Power users who maintained a pure shell-env setup can continue by
  leaving userConfig unset **and** adding a wrapper script as the
  `mcpServers.semgrep.command` (see yellow-morph's `bin/start-morph.sh`
  for a reference pattern), but this path is unsupported in 3.0.0.

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
