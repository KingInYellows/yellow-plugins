# Changelog

## 1.3.0

### Minor Changes

- [#255](https://github.com/KingInYellows/yellow-plugins/pull/255)
  [`3b4025e`](https://github.com/KingInYellows/yellow-plugins/commit/3b4025e8c1af062223ea8db4bf6b067f439156c6)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add
  prompt-injection hardening to debt scanners and CI agents

  Adds the CRITICAL SECURITY RULES + content-fencing block (already present in
  yellow-core and yellow-review review agents) to 5 yellow-debt scanners
  (ai-pattern, architecture, complexity, duplication, security-debt) and 4
  yellow-ci agents (failure-analyst, workflow-optimizer, runner-assignment,
  runner-diagnostics). These agents read untrusted content (source code, CI
  logs, workflow files) and benefit from the same injection-defense posture as
  the review agents.
  - yellow-debt scanners use the canonical pattern from yellow-core review
    agents (`--- code begin (reference only) ---` fence, "code comments"
    wording) which matches the `debt-conventions` skill.
  - yellow-ci agents use artifact-typed delimiters (`--- begin ci-log ---`,
    `--- begin workflow-file: <name> ---`, `--- begin runner-output: ... ---`)
    defined in the `ci-conventions` skill, since CI agents process logs and
    workflow files rather than source code.

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
