# Changelog

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.0.0] - 2026-04-17

### Major Changes

- **Breaking:** all three API keys (`PERPLEXITY_API_KEY`,
  `TAVILY_API_KEY`, `EXA_API_KEY`) migrated to `userConfig`. The
  perplexity, tavily, and exa MCP servers now read their API keys from
  Claude Code's `userConfig` (sensitive, keychain-backed) instead of
  shell env vars. The three keys are declared **optional** — the plugin
  degrades gracefully when any are missing, so skipping the prompts is
  valid for users who only want a subset of research sources.

  Empirically verified behavior (MCP stdio probe, 2026-04-17): perplexity
  hard-fails at startup without `PERPLEXITY_API_KEY` (so its tools
  disappear entirely); tavily and exa start without their keys but return
  runtime errors on tool invocation. Either way, `/research:deep` and
  `/research:code` continue to operate with whichever sources are
  available.

### Migration (existing users)

- Run `claude plugin update yellow-research@yellow-plugins`. Claude Code
  prompts for each key at plugin-enable time; dismiss any you don't want
  stored. Answering preserves the keychain-backed experience; skipping
  leaves the old shell-env path broken for that MCP (since plugin.json
  now references `${user_config.*}`, not `${*_API_KEY}` shell vars).
- Power users who prefer shell env vars can add a thin wrapper script
  per MCP (see yellow-morph's `bin/start-morph.sh` for a pattern), but
  for most users answering the userConfig prompt is the recommended
  path.

---

## [1.3.0] - 2026-03-10

### Minor Changes

- [`1c183f3`](https://github.com/KingInYellows/yellow-plugins/commit/1c183f3529250822df87180b5c9e69dadc2830a0)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add
  auto-install with confirmation for semgrep CLI and ast-grep binary in setup
  commands

### Patch Changes

- [`69d84c8`](https://github.com/KingInYellows/yellow-plugins/commit/69d84c8f17a23da89979765c434d4e2c0c683935)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Expand
  marketplace setup coverage with dedicated setup commands, repository-root
  aware setup checks, and stricter setup validation guardrails.

---

## [1.2.0] - 2026-03-06

### Minor Changes

- [`eb5c43c`](https://github.com/KingInYellows/yellow-plugins/commit/eb5c43c88c810c1452d3d6a034e6bf2e8ea18ee1)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add ast-grep
  MCP server for AST-based structural code search. Bundles 4 new tools
  (find_code, find_code_by_rule, dump_syntax_tree, test_match_code_rule) via
  uvx. Adds health checks for ast-grep and Parallel Task MCP to /research:setup.

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
