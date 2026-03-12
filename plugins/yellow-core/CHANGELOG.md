# Changelog

## 1.4.1

### Patch Changes

- [`e3ef6ff`](https://github.com/KingInYellows/yellow-plugins/commit/e3ef6ffbd175c44756d1c6ac7511b1040d2e9720)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add yellow-docs
  documentation plugin with 5 commands (setup, audit, generate, diagram,
  refresh), 3 agents, and 1 shared skill. Register in marketplace and setup:all.

## 1.4.0

### Minor Changes

- [`7565442`](https://github.com/KingInYellows/yellow-plugins/commit/7565442d220810f5a20e833eaf75976875cbe4c8)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add stack-aware
  bottom-up execution to workflows:work. When a plan contains a
  `## Stack Decomposition` section, workflows:work creates branches just-in-time
  and executes each stack item sequentially with checkpoints and progress
  tracking.

### Patch Changes

- [`906430f`](https://github.com/KingInYellows/yellow-plugins/commit/906430f988f7a8f333d3faa530bbcfb6f87cfca3)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Update
  yellow-core CLAUDE.md to document stack-aware workflows:work capability and
  gt-workflow dependency for stack decomposition features.

- [`dc72dfa`](https://github.com/KingInYellows/yellow-plugins/commit/dc72dfa52c47a0578171071c452b58350b85b5bc)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Update
  workflows:plan post-generation options to clarify that gt-stack-plan adds
  decomposition to the plan (no branches created) and workflows:work executes
  bottom-up when decomposition exists.

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## Unreleased

_No unreleased changes yet._

---

## [1.3.0] - 2026-03-10

### Minor Changes

- [`69d84c8`](https://github.com/KingInYellows/yellow-plugins/commit/69d84c8f17a23da89979765c434d4e2c0c683935)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Expand
  marketplace setup coverage with dedicated setup commands, repository-root
  aware setup checks, and stricter setup validation guardrails.

### Patch Changes

- [`91908d9`](https://github.com/KingInYellows/yellow-plugins/commit/91908d935feb46fbb447a67eae997e5f491e3c05)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add MCP warmup
  and retry-once patterns to all consuming commands for ruvector integration
  consistency. Harden install.sh and setup.md to require global binary in PATH.

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
