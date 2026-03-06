# Changelog

## 1.2.0

### Minor Changes

- Add ast-grep MCP server for AST-based structural code search. Bundles 4 new
  tools (find_code, find_code_by_rule, dump_syntax_tree, test_match_code_rule)
  via uvx. Adds health checks for ast-grep and Parallel Task MCP to
  /research:setup.

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

## [1.0.0] - 2026-02-23

### Added

- Initial release — bundled research MCP servers: Perplexity, Tavily, EXA, and
  Parallel Task for multi-source deep research.

---

**Maintained by**: [KingInYellows](https://github.com/KingInYellows)
