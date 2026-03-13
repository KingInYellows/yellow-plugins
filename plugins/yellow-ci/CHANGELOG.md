# Changelog

## 1.2.0

### Minor Changes

- [`095f325`](https://github.com/KingInYellows/yellow-plugins/commit/095f3255d7402b45d22f6d10f33a7665590c67e3)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add layered
  runner targets configuration system with new `/ci:setup-runner-targets`
  command, global/per-repo config resolution, session-start hook routing
  summary, and semantic scoring in runner-assignment agent.

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

## [1.0.0] - 2026-02-18

### Added

- Initial release — CI failure diagnosis, workflow linting, and runner health
  management for self-hosted GitHub Actions runners.

---

**Maintained by**: [KingInYellows](https://github.com/KingInYellows)
