# Changelog

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## Unreleased

### Changed

- Expand `/setup:all` from a 9-plugin yellow-only dashboard to a
  marketplace-wide setup orchestrator with stricter readiness checks, new
  delegated setup commands, and setup coverage validation in repo checks.

---

## [1.2.0] - 2026-03-06

### Minor Changes

- [`0f5b2a1`](https://github.com/KingInYellows/yellow-plugins/commit/0f5b2a1916516291e058b991c30a50c1ef890cac)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add /setup:all
  command — unified orchestrator that checks prerequisites, environment
  variables, and config files across all 9 plugins, then offers interactive
  setup for plugins that need attention with a before/after summary.

### Patch Changes

- [`9a28a2d`](https://github.com/KingInYellows/yellow-plugins/commit/9a28a2dd7570f741c80c0eb07bdda32165ad5f14)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add
  `/linear:work` bridge command and cross-plugin integration connectors.
  yellow-linear gets a minor bump (new command), yellow-core and gt-workflow get
  patch bumps (behavioral additions to existing commands).

---

## [1.1.0] - 2026-02-25

### Added

- Add /workflows:brainstorm command and brainstorm-orchestrator agent for
  pre-planning requirement exploration. Add /workflows:compound command for
  documenting solved problems.

### Fixed

- Remove unsupported `changelog` key from plugin.json that blocked installation
  via Claude Code's remote validator.

---

## [1.0.0] - 2026-02-18

### Added

- Initial release — developer toolkit with review agents, research agents, and
  workflow commands.

---

**Maintained by**: [KingInYellows](https://github.com/KingInYellows)
