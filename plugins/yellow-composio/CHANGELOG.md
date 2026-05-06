# Changelog

## 1.2.0

### Minor Changes

- [`cd2aa52`](https://github.com/KingInYellows/yellow-plugins/commit/cd2aa523fefd8aa5d6c6e1a4ca308903f02a8bb4)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - # Bundle the
  Composio MCP server in `plugin.json` with userConfig prompts

  Replace the documentation-passthrough `/composio:setup` story with an actual
  installer. `plugins/yellow-composio/.claude-plugin/plugin.json` now declares:
  - `userConfig.composio_mcp_url` (`type: string`, non-sensitive) — the
    per-customer MCP URL the user generates at https://mcp.composio.dev or via
    `npx @composio/mcp@latest setup <customer_id> <app_id>`.
  - `userConfig.composio_api_key` (`type: string`, sensitive) — Composio API
    key, sent as `X-API-Key` header on every MCP request, stored in the system
    keychain.
  - `mcpServers.composio-server` (`type: http`) — `url` and `headers.X-API-Key`
    read from `${user_config.composio_mcp_url}` and
    `${user_config.composio_api_key}` respectively.

  Tools appear under `mcp__plugin_yellow-composio_composio-server__COMPOSIO_*`.

  ## Compatibility

  Existing users who configured Composio manually via
  `claude mcp add --transport http composio-server ...` keep working — their
  entry in `~/.claude.json` is independent of this plugin's bundled MCP and
  continues to expose tools under `mcp__composio-server__*`. The plugin's
  `/composio:setup` and `/composio:status` commands now look for all three
  prefixes (bundled, Claude.ai native, manual) and pick whichever is reachable.
  Users on the manual path can migrate at their own pace by answering the new
  userConfig prompts and removing the manual entry.

  ## Open: ${user_config.\*} substitution in `mcpServers.url` and `headers`

  This is the first plugin in the marketplace to use `${user_config.*}`
  substitution inside `mcpServers.<name>.url` and inside
  `mcpServers.<name>.headers`. Every prior plugin (yellow-research,
  yellow-morph, yellow-semgrep) only uses `${user_config.*}` inside the `env`
  block of stdio servers. The schema does not field-scope substitution, and the
  harness uses generic `${user_config.KEY}` substitution wherever it appears
  (see `monitors.command` schema description for the security note).
  Substitution should work, but the specific HTTP-server-url +
  http-server-headers paths are empirically untested in this repo until this PR
  ships.

  If a user enables the plugin and the bundled MCP fails to start for this
  reason, the existing manual `claude mcp add` instructions remain in
  `/composio:setup` Step 2 as a fallback — see the "Fallback (manual
  `claude mcp add`)" block. The setup command's tool-prefix detection already
  covers the manual path.

  ## Files changed
  - `plugins/yellow-composio/.claude-plugin/plugin.json` — add `userConfig` and
    `mcpServers.composio-server` blocks.
  - `plugins/yellow-composio/CLAUDE.md` — flip "does NOT bundle an MCP server"
    to describe the bundled MCP and migration path; security notes section
    updated to reflect keychain-stored API key.
  - `plugins/yellow-composio/commands/composio/setup.md` — Step 2 rewritten to
    detect all three tool-name prefixes and to recommend
    `/plugin disable && /plugin enable` for first-time setup, with the manual
    `claude mcp add` instructions retained as the fallback path.
  - `plugins/yellow-composio/README.md` — Quick Start and How It Works sections
    updated to lead with the `userConfig`-prompt path and to document the
    three-prefix detection plus migration guidance for the manual
    `claude mcp add` flow.
  - `plugins/yellow-composio/skills/composio-patterns/SKILL.md` — prefix list
    expanded from two to three (bundled first), and the security note flipped
    from "no API keys stored" to "API key stored in system keychain" to match
    the new bundled path.

## 1.1.0

### Minor Changes

- [`f30767d`](https://github.com/KingInYellows/yellow-plugins/commit/f30767d149525d0b2f3bc3532b4f8a41a5d60ee4)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add
  yellow-composio plugin with setup validation, usage monitoring, and Composio
  integration patterns

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-03-27

### Added

- `/composio:setup` command for MCP validation, connection checking, and usage
  tracking initialization
- `/composio:status` command for usage dashboard with execution counts, per-tool
  breakdown, daily history, and threshold warnings
- `composio-patterns` skill documenting Workbench batch processing,
  Multi-Execute, usage tracking, graceful degradation, and security conventions

---

**Maintained by**: [KingInYellows](https://github.com/KingInYellows)
