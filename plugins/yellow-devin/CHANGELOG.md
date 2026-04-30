# Changelog

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
