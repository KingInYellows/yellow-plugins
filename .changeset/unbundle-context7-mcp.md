---
"yellow-core": patch
"yellow-research": patch
---

Unbundle context7 MCP from yellow-core; repoint yellow-research callers to user-level

Remove the bundled `mcpServers.context7` entry from `plugins/yellow-core/.claude-plugin/plugin.json` to avoid the dual-OAuth-pop-up issue when users have context7 installed both at user level and bundled inside yellow-core (the namespace collision pattern documented in `docs/solutions/integration-issues/duplicate-mcp-url-double-oauth.md`). Per CE PR #486 (compound-engineering v2.62.0, 2026-04-03) parity.

- **yellow-core:** `mcpServers` block removed from `plugin.json`; `best-practices-researcher` agent's tool list updated to user-level `mcp__context7__*` names; CLAUDE.md/README.md updated to recommend user-level install; statusline/setup.md no longer lists yellow-core as having an MCP.
- **yellow-research:** `code-researcher` agent, `/research:code` command, `/research:setup` command, `research-patterns` skill, CLAUDE.md, and README.md all repointed from `mcp__plugin_yellow-core_context7__*` to user-level `mcp__context7__*`. ToolSearch availability check + EXA fallback preserved (existing prose).

**User action:** install context7 at user level via `/plugin install context7@upstash` (or via Claude Code MCP settings UI). The user-level context7 server registers tools as `mcp__context7__resolve-library-id` and `mcp__context7__query-docs`. yellow-research's `code-researcher` falls back to EXA `get_code_context_exa` if user-level context7 is not detected by ToolSearch — no behavior change for users without context7.

Roll back by re-adding the `mcpServers.context7` block to `plugins/yellow-core/.claude-plugin/plugin.json` and reverting the tool-name repoints in yellow-research.
