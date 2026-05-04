# Changelog

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.0] - 2026-04-17

### Changed (breaking)

- **Config surface: `MORPH_API_KEY` now read from `userConfig`, not shell env.**
  Claude Code prompts for the key at plugin-enable time and stores it in the
  system keychain (or `~/.claude/.credentials.json` on minimal Linux). Fresh
  installs no longer require a `MORPH_API_KEY` export before launching
  Claude Code, and no longer require a Claude Code restart after setup.
  Power-user fallback via a shell `MORPH_API_KEY` export is also supported
  in 1.1.0 — `bin/start-morph.sh` resolves the userConfig value first, then
  falls through to the shell env var when userConfig is empty.
- **MCP pin bumped from `@morphllm/morphmcp@0.8.110` to `0.8.165`** (55
  versions of upstream fixes).

### Fixed

- **`edit_file` tool was silently disabled.** morphmcp disables `edit_file`
  by default; the plugin had been setting the (non-existent)
  `ENABLED_TOOLS` env var, which is silently ignored. Switched to
  `DISABLED_TOOLS=github_codebase_search` so both `edit_file` and
  `codebase_search` (the two tools the plugin advertises) are now actually
  exposed.
- **Tool name corrected: `warpgrep_codebase_search` → `codebase_search`.**
  The `warpgrep_` prefix does not exist in morphmcp 0.8.165. References
  updated across CLAUDE.md, README, `/morph:status`, and the
  `mcp-integration-patterns` skill. The `mcp__plugin_yellow-morph_morph__edit_file`
  and `mcp__plugin_yellow-morph_morph__codebase_search` names are what
  agents should call going forward.

### Migration

- Existing users: run `claude plugin update yellow-morph@yellow-plugins`.
  Claude Code detects the new `userConfig` field and prompts for the key on
  next plugin enable. Answer the prompt to migrate.
- If your prior setup relied on `mcp__plugin_yellow-morph_morph__warpgrep_codebase_search`,
  agents invoking the old name will fail — update the call site to
  `mcp__plugin_yellow-morph_morph__codebase_search`.

---

## [1.0.0] - 2026-03-03

### Added

- Initial release — Morph Fast Apply and WarpGrep integration via MCP server
- `/morph:setup` command for prerequisites and API key configuration
- `/morph:status` command for API health and MCP tool availability
- CLAUDE.md with tool preference rules and domain separation guidance
- Cross-plugin hints in yellow-core, yellow-review, yellow-debt, yellow-ci
- Updated yellow-research to reference yellow-morph as preferred WarpGrep source

---

**Maintained by**: [KingInYellows](https://github.com/KingInYellows)
