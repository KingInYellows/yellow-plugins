# Changelog

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

- Remove unsupported `changelog` key from plugin.json that blocked installation via Claude Code's remote validator.

---

## [1.0.0] - 2026-02-18

### Added

- Initial release — ChatPRD MCP integration with document management and Linear bridging.

---

**Maintained by**: [KingInYellows](https://github.com/KingInYellows)
