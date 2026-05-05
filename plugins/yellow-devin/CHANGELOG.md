# Changelog

## [2.2.0] - 2026-04-17

### Minor Changes

- **Adopt `userConfig` for credential entry.** `DEVIN_SERVICE_USER_TOKEN`
  (sensitive) and `DEVIN_ORG_ID` (non-sensitive — IDs are not secrets)
  are now declared as `userConfig` fields in `plugin.json`. Claude Code
  prompts for them at plugin-enable time and stores the token in the
  system keychain (or `~/.claude/.credentials.json` at 0600 perms on
  Linux). Commands still read the shell env vars for curl invocations,
  so existing shell-env setups continue to work unchanged — userConfig
  is an additive UX improvement, not a breaking change. `/setup:all`
  now classifies the plugin READY when either source is present.
- `/devin:setup` now emits a dual-source drift WARNING when userConfig
  is configured but the corresponding shell env var is empty, noting
  that `/devin:*` curl-based commands will return 401 until the shell
  export is also added.

### Migration (existing users)

- No action required for existing shell-env setups — they continue
  working unchanged. `DEVIN_SERVICE_USER_TOKEN` and `DEVIN_ORG_ID`
  shell exports are still read by all `/devin:*` commands.
- Recommended for new installs: answer the userConfig prompt at plugin
  enable so the token is keychain-backed and Claude Code's MCP env
  substitution handles authentication for the MCP server without a
  shell export. **`/devin:*` curl-based commands still need the same
  values exported in the shell** — they do not read userConfig directly.
  In this release the two sources remain independent for backward
  compat: keychain backs the MCP, shell env backs the curl-based
  commands. Power users who want the curl path to work without a shell
  export can author a thin per-command CLI bridge that resolves the
  credential from the keychain at invocation time — see
  yellow-morph's `bin/start-morph.sh` for a reference pattern of that
  shape.

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
