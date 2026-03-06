# Changelog

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.1]

### Patch Changes

- [`c6b5a9b`](https://github.com/KingInYellows/yellow-plugins/commit/c6b5a9b473cb95df73e3c867d9b6c649b98b28ab)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Fix hooks.json
  sync with plugin.json: add missing PreToolUse hook entry, update PostToolUse
  matcher to include MultiEdit. Replace broken `npx ruvector hooks verify` in
  setup.md with direct script checks.

---

## [1.1.0] - 2026-02-25

### Fixed

- Remove unsupported `changelog` key from plugin.json that blocked installation
  via Claude Code's remote validator.

---

## [1.0.0] - 2026-02-18

### Added

- Initial release — persistent vector memory and semantic code search for Claude
  Code agents via ruvector MCP server.

---

**Maintained by**: [KingInYellows](https://github.com/KingInYellows)
