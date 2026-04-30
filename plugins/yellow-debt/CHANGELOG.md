# Changelog

## 1.3.0

### Minor Changes

- [`dfebc48`](https://github.com/KingInYellows/yellow-plugins/commit/dfebc48f74c6b88cf6c5ccff73e3ad604dca714c)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add ast-grep
  MCP tools to 4 high-value review and debt agents

  Add ast-grep structural code search (find_code, find_code_by_rule) with
  ToolSearch-based graceful degradation to silent-failure-hunter,
  type-design-analyzer, duplication-scanner, and complexity-scanner. Each agent
  includes tailored AST vs Grep routing guidance and falls back to Grep when
  yellow-research is not installed.

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## Unreleased

_No unreleased changes yet._

---

## [1.2.0] - 2026-03-10

### Minor Changes

- [`69d84c8`](https://github.com/KingInYellows/yellow-plugins/commit/69d84c8f17a23da89979765c434d4e2c0c683935)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Expand
  marketplace setup coverage with dedicated setup commands, repository-root
  aware setup checks, and stricter setup validation guardrails.

---

## [1.1.0] - 2026-02-25

### Fixed

- Remove unsupported `changelog` key from plugin.json that blocked installation
  via Claude Code's remote validator.

---

## [1.0.0] - 2026-02-18

### Added

- Initial release — technical debt audit and remediation with parallel scanner
  agents for AI-generated code patterns.

---

**Maintained by**: [KingInYellows](https://github.com/KingInYellows)
