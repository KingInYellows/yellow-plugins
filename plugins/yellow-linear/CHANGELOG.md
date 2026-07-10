# Changelog

## 1.3.3

### Patch Changes

- [#630](https://github.com/KingInYellows/yellow-plugins/pull/630)
  [`ea6b47b`](https://github.com/KingInYellows/yellow-plugins/commit/ea6b47bbb51ab44431fcf3433d8896e7d4466fba)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - docs: correct
  both CLAUDE.md restatements of the `/linear:delegate` dependency — the command
  validates the `DEVIN_SERVICE_USER_TOKEN`/`DEVIN_ORG_ID` environment variables
  (delegate.md Step 1), not yellow-devin plugin presence; installing
  yellow-devin is one way to obtain the credentials, not a hard plugin
  dependency.

## 1.3.2

### Patch Changes

- [#570](https://github.com/KingInYellows/yellow-plugins/pull/570)
  [`97cea5f`](https://github.com/KingInYellows/yellow-plugins/commit/97cea5f21595ad8f839f01357a5b1097383b7b09)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - fix: migrate to
  current Linear MCP tool names — `create_issue`/`update_issue` → `save_issue`,
  `create_comment` → `save_comment`, `list_initiative_updates` →
  `get_status_updates`, `create_initiative_update` → `save_status_update` —
  across all command/agent bodies and allowed-tools lists, and update call prose
  to the upsert parameter names (`id`, `state`, `team`, `labels`, `project`).
  The old names no longer exist on the Linear MCP server, so every write
  operation failed with "tool not found".

## 1.3.1

### Patch Changes

- [`c3cdfdb`](https://github.com/KingInYellows/yellow-plugins/commit/c3cdfdb5a2c0d260e32096a524c4712fe277d019)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add `$schema`
  pointer to all remaining plugin manifests:
  `https://json.schemastore.org/claude-code-plugin-manifest.json`

  Per https://code.claude.com/docs/en/plugins-reference, Claude Code's plugin
  loader ignores this field at load time, but editors and IDEs use it for
  autocomplete and inline validation against the official remote validator
  schema. yellow-core received the pointer earlier in the stack as a
  single-plugin probe; this PR extends it to the other 17.

  Also documents local vs remote validator divergence in CONTRIBUTING.md with a
  recipe for empirical install testing (`claude plugin validate`,
  `claude --plugin-url`, fresh-install probe). The `claude plugin validate` CI
  integration is deferred to a follow-up PR pending CI runtime evaluation.

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
- Add `/linear:setup` to validate Linear MCP visibility, first-use OAuth
  readiness, and Graphite availability.

---

## [1.2.0] - 2026-03-06

### Minor Changes

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

- Initial release — Linear MCP integration with PM workflows for issues,
  projects, initiatives, cycles, and documents.

---

**Maintained by**: [KingInYellows](https://github.com/KingInYellows)
