# Brainstorm: Graphite MCP Server in gt-workflow

## What We're Building

Adding the official Graphite MCP server as a bundled MCP server in the gt-workflow plugin. The Graphite MCP server is built into the `gt` CLI itself (v1.6.7+) and runs via `gt mcp` as a stdio transport -- no separate npm package or API token required. It uses the existing `gt` CLI authentication.

The integration is **additive only**: all existing CLI-based commands (`/smart-submit`, `/gt-amend`, `/gt-sync`, `/gt-nav`, `/gt-stack-plan`) remain unchanged. The MCP tools become available for agents and commands to optionally consume for richer data -- PR comments, review status, CI checks, stack metadata -- that the CLI does not easily expose.

Changes required:
- **plugin.json**: Add `mcpServers.graphite` entry with `"command": "gt", "args": ["mcp"]`
- **/gt-setup**: Extend to verify `gt` CLI version is 1.6.7+ (required for MCP server support)
- **CLAUDE.md**: Document available MCP tools and the `mcp__plugin_gt-workflow_graphite__` prefix convention

## Why This Approach

The Graphite MCP server being embedded in the `gt` CLI binary makes this the simplest possible integration path. There is no separate auth to manage, no API key to configure, and no additional binary to install -- if you have `gt` v1.6.7+, you have the MCP server. This mirrors the pattern used by yellow-linear (HTTP MCP in plugin.json, setup validates connectivity) but is even simpler because auth is inherited from the CLI.

We chose additive-only over gradual migration because the existing CLI commands are stable and well-tested. The MCP tools provide complementary capabilities (richer PR metadata, review status) rather than replacements for what the CLI already does well (branch creation, submission, sync). Migration of specific commands to prefer MCP tools can be evaluated later once the tool surface is understood through real usage.

## Key Decisions

- **stdio transport via `gt mcp`**: The Graphite MCP server is not a standalone package. It runs as a subprocess of the `gt` binary. The plugin.json entry will be `{"command": "gt", "args": ["mcp"]}`.
- **Minimum CLI version 1.6.7**: The MCP server was introduced in this version. `/gt-setup` must check the version and report if upgrade is needed. This is a soft prerequisite -- existing CLI commands still work without MCP, but MCP tools will be unavailable.
- **Tool name prefix**: Per codebase conventions, bundled MCP server tools will be prefixed `mcp__plugin_gt-workflow_graphite__`. Actual tool names must be discovered empirically via `ToolSearch` after installation -- never assumed from documentation or training data.
- **No new commands in this iteration**: The MCP server is wired up and validated, but no new commands are created that depend on it. Commands can adopt MCP tools in follow-up work once the tool surface is understood.
- **No changes to existing commands**: `/smart-submit`, `/gt-amend`, `/gt-sync`, `/gt-nav`, and `/gt-stack-plan` continue to use the `gt` CLI directly.

## Open Questions

- What tools does the Graphite MCP server actually expose? The tool surface needs to be discovered empirically after wiring up the server. This will determine what new commands or enrichments are possible.
- Should `/gt-setup` treat MCP server unavailability (gt version too old) as a warning or a hard stop? Given the additive nature, a warning with "upgrade to unlock MCP features" seems appropriate.
- Are there any environment variables or configuration flags needed for `gt mcp` beyond what the CLI already has? The research suggests it uses existing auth, but this needs verification.
- Which existing commands would benefit most from MCP tool enrichment in a follow-up? Likely candidates: `/gt-nav` (richer stack metadata), `/smart-submit` (PR review status before submitting).
