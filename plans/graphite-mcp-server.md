# Feature: Bundle Graphite MCP Server in gt-workflow

## Overview

Add the official Graphite MCP server (built into `gt` CLI v1.6.7+) as a bundled
MCP server in the gt-workflow plugin. This is additive only — all existing CLI
commands remain unchanged. The MCP tools become available for agents and commands
to optionally consume for richer PR/stack data.

## Implementation

- [x] **Step 1: Add `mcpServers.graphite` to plugin.json**
  - File: `plugins/gt-workflow/.claude-plugin/plugin.json`
  - Add `mcpServers` block with stdio transport: `"command": "gt", "args": ["mcp"]`
  - Pattern reference: yellow-research uses `"command"` + `"args"` for stdio MCPs

- [x] **Step 2: Extend `/gt-setup` with version check**
  - File: `plugins/gt-workflow/commands/gt-setup.md`
  - In Step 1 bash block: parse `gt --version` output, extract semver, compare against 1.6.7
  - Add `mcp_server` line to prerequisites output: `ok (v1.6.7+)` or `UPGRADE NEEDED (current: vX.Y.Z, need 1.6.7+)`
  - In Step 2: treat version < 1.6.7 as a **warning** (not a hard stop) — "Upgrade gt to v1.6.7+ to unlock MCP features"
  - In Step 3: add `MCP Server:  available` or `MCP Server:  unavailable (gt < 1.6.7)` to success report

- [x] **Step 3: Update CLAUDE.md MCP integration section**
  - File: `plugins/gt-workflow/CLAUDE.md`
  - Update the `### MCP Tool Integration` section to document the Graphite MCP server
  - Note the `mcp__plugin_gt-workflow_graphite__` tool prefix convention
  - Note that actual tool names must be discovered empirically via ToolSearch after installation

- [x] **Step 4: Bump version and changeset**
  - Run `pnpm changeset` — minor bump (new additive capability)
  - Run `pnpm apply:changesets` to sync versions

## Acceptance Criteria

- `gt mcp` stdio server is declared in plugin.json `mcpServers`
- `/gt-setup` reports MCP server availability based on `gt` version
- `/gt-setup` does NOT hard-fail when `gt` version < 1.6.7
- CLAUDE.md documents the MCP server and tool prefix
- `pnpm validate:schemas` passes
- No changes to existing commands (`/smart-submit`, `/gt-amend`, `/gt-sync`, `/gt-nav`, `/gt-stack-plan`)

## References

- Brainstorm: `docs/brainstorms/2026-03-09-graphite-mcp-server-gt-workflow-brainstorm.md`
- Plugin manifest: `plugins/gt-workflow/.claude-plugin/plugin.json`
- Setup command: `plugins/gt-workflow/commands/gt-setup.md`
- Plugin CLAUDE.md: `plugins/gt-workflow/CLAUDE.md`
- MCP pattern reference: `plugins/yellow-research/.claude-plugin/plugin.json` (stdio MCPs)
- MCP pattern reference: `plugins/yellow-linear/.claude-plugin/plugin.json` (HTTP MCP)
