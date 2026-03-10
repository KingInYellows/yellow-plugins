# Changelog

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

- Add Graphite MCP server (stdio via `gt mcp`) as bundled MCP server in
  plugin.json. Extend `/gt-setup` to validate gt CLI version 1.6.7+ for MCP
  availability. Update CLAUDE.md with MCP tool documentation.
- Add `/gt-setup` to validate Graphite CLI availability, auth detection, and
  repo initialization before running workflow commands.

- [`69d84c8`](https://github.com/KingInYellows/yellow-plugins/commit/69d84c8f17a23da89979765c434d4e2c0c683935)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Expand
  marketplace setup coverage with dedicated setup commands, repository-root
  aware setup checks, and stricter setup validation guardrails.

---

## [1.1.1] - 2026-03-06

### Patch Changes

- [`9a28a2d`](https://github.com/KingInYellows/yellow-plugins/commit/9a28a2dd7570f741c80c0eb07bdda32165ad5f14)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add
  `/linear:work` bridge command and cross-plugin integration connectors.
  yellow-linear gets a minor bump (new command), yellow-core and gt-workflow get
  patch bumps (behavioral additions to existing commands).

---

## [1.1.0] - 2026-02-25

### Fixed

- Remove unsupported `changelog` key from plugin.json that blocked installation
  via Claude Code's remote validator.

---

## [1.0.0] - 2026-02-18

### Added

- Initial release — Graphite-native workflow commands for stacked PRs, smart
  commits, sync, and stack navigation.

---

**Maintained by**: [KingInYellows](https://github.com/KingInYellows)
