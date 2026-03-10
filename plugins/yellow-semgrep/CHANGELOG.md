# Changelog

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

## [1.1.0] - 2026-03-09

### Changed

- **BREAKING (MCP):** Migrated MCP server from deprecated `uvx semgrep-mcp`
  (standalone, archived Oct 2025) to built-in `semgrep mcp` subcommand.
  Requires semgrep **v1.146.0+**.
- `/semgrep:setup` now checks semgrep version and offers upgrade if below
  v1.146.0. Provides version-aware MCP diagnostics.
- Install script (`install-semgrep.sh`) now supports upgrading outdated
  semgrep installs instead of exiting early.

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
