# Changelog

## 2.2.0

### Minor Changes

- **Adopt `userConfig` for credential entry.** `DEVIN_SERVICE_USER_TOKEN`
  (sensitive) and `DEVIN_ORG_ID` are now declared as `userConfig` fields in
  `plugin.json`. Claude Code prompts for them at plugin-enable time and
  stores the token in the system keychain (or
  `~/.claude/.credentials.json` at 0600 perms on Linux). Commands still
  read the shell env vars for curl invocations, so existing shell-env
  setups continue to work unchanged — userConfig is an additive UX
  improvement, not a breaking change. `/setup:all` now classifies the
  plugin READY when either source is present.

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
