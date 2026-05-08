# Changelog

## 1.3.1

### Patch Changes

- [`13bc50d`](https://github.com/KingInYellows/yellow-plugins/commit/13bc50dda24a384aae78d7340baa8e866cb2791c)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - X-01 (audit
  2026-05-07): declare cross-plugin MCP dependencies in three consumer manifests
  that silently require yellow-linear's MCP at runtime. Surfaces install-time
  coupling that previously failed opaquely as "MCP tool not found".

  **yellow-debt:** `/debt:sync` uses
  `mcp__plugin_yellow-linear_linear__create_issue` to push debt findings to
  Linear as issues.

  **yellow-ci:** `/ci:report-linear` uses the same Linear MCP tool to create
  issues from CI failure diagnoses.

  **yellow-chatprd:** `/chatprd:link-linear` uses it to bridge ChatPRD documents
  to Linear issues.

  All three deps are declared `optional: true` (matches npm
  `peerDependenciesMeta` semantics: declared as soft deps for
  audit/documentation purposes; consumers degrade gracefully when yellow-linear
  is absent — the Linear-specific commands surface "plugin not installed" rather
  than crashing).

  The schema extension (`schemas/plugin.schema.json`) and validator addition
  (RULE 11 in `scripts/validate-plugin.js`) ship in the same PR but do not
  require a changeset (root-level files, no plugin touches).

  ⚠️ External smoke gate: do NOT tag a release until a fresh
  `claude plugin install` smoke test confirms Claude Code's remote validator
  accepts the new `optional` and `reason` fields. Local CI passing does NOT
  guarantee remote validator acceptance — see
  `docs/solutions/build-errors/userconfig-type-title-remote-validator-drift.md`
  for the precedent on local-vs-remote validator drift.

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.3.0] - 2026-03-03

### Added

- `document-reviewer` agent for PRD completeness analysis against templates
- `project-dashboard` agent for one-stop project document overview
- DeepWiki context injection in `/chatprd:create` for technical templates
- User profile check in `/chatprd:setup` with subscription awareness
- Chat history context in `document-assistant` search results
- Document review patterns in `chatprd-conventions` skill
- Dashboard formatting conventions in `chatprd-conventions` skill

### Changed

- `document-assistant` agent now shows related conversation count in searches

---

## [1.2.0] - 2026-03-03

### Added

- Three listing modes in `/chatprd:list`: project-scoped, org-scoped, personal
- Related-specs enrichment in `/chatprd:link-linear` and `linear-prd-bridge`
- Listing tool selection guide in `chatprd-conventions` skill
- Related-specs pattern in `chatprd-conventions` skill

### Changed

- `document-assistant` agent now supports three listing modes
- `linear-prd-bridge` agent includes related specs in Linear issue descriptions

---

## [1.1.0] - 2026-02-25

### Fixed

- Remove unsupported `changelog` key from plugin.json that blocked installation
  via Claude Code's remote validator.

---

## [1.0.0] - 2026-02-18

### Added

- Initial release — ChatPRD MCP integration with document management and Linear
  bridging.

---

**Maintained by**: [KingInYellows](https://github.com/KingInYellows)
