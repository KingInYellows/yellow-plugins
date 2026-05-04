# Changelog

## 1.2.0

### Minor Changes

- [`4d034f2`](https://github.com/KingInYellows/yellow-plugins/commit/4d034f26117da84d15707094fe8970210ad76bee)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - yellow-morph:
  migrate Morph API key from shell `MORPH_API_KEY` to plugin `userConfig`
  (Claude Code prompts at plugin-enable time and stores in the system keychain).
  Shell `MORPH_API_KEY` remains supported as a power-user fallback. Ship
  `bin/start-morph.sh` wrapper and a SessionStart prewarm hook that install
  `@morphllm/morphmcp@0.8.165` into `${CLAUDE_PLUGIN_DATA}` — serialized via an
  atomic `mkdir`-lock so wrapper and hook cannot run concurrent `npm ci`. Fix
  `ENABLED_TOOLS` no-op (morphmcp ignores it; switch to
  `DISABLED_TOOLS=github_codebase_search`). Correct WarpGrep tool name from the
  non-existent `warpgrep_codebase_search` to `codebase_search`.

  yellow-core: update `setup:all` classification probe so yellow-morph is
  detected via the renamed `codebase_search` tool, and refresh the
  mcp-integration-patterns skill to reference the new tool name.

  yellow-research: rename the `filesystem-with-morph` global MCP probe in
  `/research:setup` to `codebase_search` (current name), with
  `warpgrep_codebase_search` retained in `allowed-tools` as a backward-
  compatibility hedge for users still on an older global MCP version.

### Patch Changes

- [`4d034f2`](https://github.com/KingInYellows/yellow-plugins/commit/4d034f26117da84d15707094fe8970210ad76bee)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Hardening of
  the @morphllm/morphmcp install path:
  - Extract shared install primitives into
    `plugins/yellow-morph/lib/install-morphmcp.sh` (path validation, mkdir-lock,
    npm ci wrapper, cleanup). `bin/start-morph.sh`,
    `hooks/scripts/prewarm-morph.sh`, and `/morph:setup` Step 3 now source the
    lib instead of each carrying its own copy of the install protocol — single
    source of truth for the install contract.
  - Add stale-lock recovery to the mkdir install lock: each holder writes its
    PID into `$LOCK_DIR/pid` on acquisition. Subsequent acquirers detect a dead
    owner via `kill -0` and clear the lock once before retrying. Recovers
    automatically from SIGKILL / OOM of a prior holder instead of forcing 20s of
    timeout-then-manual-cleanup on every later install.
  - Tighten the npm ci environment from `unset MORPH_API_KEY` to `env -i` with
    an explicit allowlist (HOME, PATH, NPM_CONFIG_USERCONFIG,
    NPM_CONFIG_GLOBALCONFIG, NPM_CONFIG_PREFIX). Postinstall scripts in
    transitive deps no longer inherit any session secrets — not just
    MORPH_API_KEY but also ANTHROPIC_API_KEY, GITHUB_TOKEN, and anything else
    exported into Claude Code's process environment.

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.0] - 2026-04-17

### Changed (breaking)

- **Config surface: `MORPH_API_KEY` now read from `userConfig`, not shell env.**
  Claude Code prompts for the key at plugin-enable time and stores it in the
  system keychain (or `~/.claude/.credentials.json` on minimal Linux). Fresh
  installs no longer require a `MORPH_API_KEY` export before launching Claude
  Code, and no longer require a Claude Code restart after setup. Power-user
  fallback via a shell `MORPH_API_KEY` export is also supported in 1.1.0 —
  `bin/start-morph.sh` resolves the userConfig value first, then falls through
  to the shell env var when userConfig is empty.
- **MCP pin bumped from `@morphllm/morphmcp@0.8.110` to `0.8.165`** (55 versions
  of upstream fixes).

### Fixed

- **`edit_file` tool was silently disabled.** morphmcp disables `edit_file` by
  default; the plugin had been setting the (non-existent) `ENABLED_TOOLS` env
  var, which is silently ignored. Switched to
  `DISABLED_TOOLS=github_codebase_search` so both `edit_file` and
  `codebase_search` (the two tools the plugin advertises) are now actually
  exposed.
- **Tool name corrected: `warpgrep_codebase_search` → `codebase_search`.** The
  `warpgrep_` prefix does not exist in morphmcp 0.8.165. References updated
  across CLAUDE.md, README, `/morph:status`, and the `mcp-integration-patterns`
  skill. The `mcp__plugin_yellow-morph_morph__edit_file` and
  `mcp__plugin_yellow-morph_morph__codebase_search` names are what agents should
  call going forward.

### Migration

- Existing users: run `claude plugin update yellow-morph@yellow-plugins`. Claude
  Code detects the new `userConfig` field and prompts for the key on next plugin
  enable. Answer the prompt to migrate.
- If your prior setup relied on
  `mcp__plugin_yellow-morph_morph__warpgrep_codebase_search`, agents invoking
  the old name will fail — update the call site to
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
