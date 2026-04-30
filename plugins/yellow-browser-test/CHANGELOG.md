# Changelog

## 1.1.1

### Patch Changes

- [`31da4b1`](https://github.com/KingInYellows/yellow-plugins/commit/31da4b14740f8eea7fc45501b94a2151c5a36009)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Fix shell
  portability and reliability in setup scripts. Replace bash-only version_gte()
  with POSIX-compatible implementation in install-codex.sh and
  install-semgrep.sh. Add fnm/nvm activation before Node version check and guard
  against fnm multishell ephemeral npm prefix in install-codex.sh. Fix dashboard
  reliability in setup:all by replacing Python heredoc with python3 -c,
  snapshotting tool paths to prevent PATH drift, and using find|xargs instead of
  find|while for plugin cache detection. Add web-app pre-flight check to
  browser-test:setup.

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

- Initial release — autonomous web app testing with agent-browser:
  auto-discovery, structured flows, and bug reporting.

---

**Maintained by**: [KingInYellows](https://github.com/KingInYellows)
