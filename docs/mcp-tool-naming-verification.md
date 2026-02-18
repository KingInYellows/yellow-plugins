# MCP Tool Naming Verification

**Date:** 2026-02-14 **Status:** Verified with naming discrepancy found

## Claude Code MCP Tool Naming Pattern

Claude Code names MCP tools from plugins using the pattern:

```
mcp__plugin_<plugin-name>_<server-key>__<tool-name>
```

Where:

- `<plugin-name>` = the `name` field from `plugin.json`
- `<server-key>` = the key in the `mcpServers` object in `plugin.json`
- `<tool-name>` = the tool name exposed by the MCP server

## Plugin Tool Name Audit

### yellow-linear

- **Plugin name:** `yellow-linear`
- **Server key:** `linear`
- **Expected prefix:** `mcp__plugin_yellow-linear_linear__`
- **Currently used in commands:** `mcp__plugin_linear_linear__`
- **Status:** MISMATCH — commands use short plugin name `linear` instead of
  `yellow-linear`

**Affected files:**

- `commands/linear/create.md`
- `commands/linear/sync.md`
- `commands/linear/triage.md`
- `commands/linear/plan-cycle.md`
- `commands/linear/status.md`
- `agents/workflow/linear-issue-loader.md`
- `agents/workflow/linear-pr-linker.md`
- `agents/research/linear-explorer.md`

### yellow-chatprd

- **Plugin name:** `yellow-chatprd`
- **Server key:** `chatprd`
- **Expected prefix:** `mcp__plugin_yellow-chatprd_chatprd__`
- **Currently used in commands:** `mcp__plugin_chatprd_chatprd__`
- **Status:** MISMATCH — commands use short plugin name `chatprd` instead of
  `yellow-chatprd`

**Affected files:**

- `commands/chatprd/create.md`
- `commands/chatprd/search.md`
- `commands/chatprd/update.md`
- `commands/chatprd/list.md`
- `commands/chatprd/link-linear.md` (also references Linear tools)
- `agents/workflow/document-assistant.md`
- `agents/workflow/linear-prd-bridge.md`

### yellow-devin

- **Plugin name:** `yellow-devin`
- **Server keys:** `deepwiki`, `devin`
- **Expected prefix:** `mcp__plugin_yellow-devin_deepwiki__` and
  `mcp__plugin_yellow-devin_devin__`
- **Currently used in commands:** `mcp__plugin_deepwiki_deepwiki__` and
  `mcp__plugin_devin_devin__`
- **Status:** MISMATCH — commands use short plugin name instead of
  `yellow-devin`

**Affected files:**

- `commands/devin/wiki.md`

### yellow-ruvector

- **Plugin name:** `yellow-ruvector`
- **Server key:** `ruvector`
- **Expected prefix:** `mcp__plugin_yellow-ruvector_ruvector__`
- **Currently used in commands:** `mcp__plugin_yellow-ruvector_ruvector__`
- **Status:** CORRECT

**Files verified:**

- `commands/ruvector/setup.md`
- `commands/ruvector/index.md`
- `commands/ruvector/search.md`
- `commands/ruvector/memory.md`
- `commands/ruvector/learn.md`
- `commands/ruvector/status.md`
- `agents/ruvector/semantic-search.md`
- `agents/ruvector/memory-manager.md`

### yellow-core

- **Plugin name:** `yellow-core`
- **Server key:** `context7`
- **Expected prefix:** `mcp__plugin_yellow-core_context7__`
- **Currently used:** Not directly referenced in command allowed-tools
- **Status:** N/A (context7 used passively by agents, not in allowed-tools)

### gt-workflow / yellow-review / yellow-browser-test / yellow-debt

- **MCP servers:** None defined
- **Status:** N/A

## Summary

| Plugin          | Server Key      | Expected Prefix                          | Current Prefix                           | Match? |
| --------------- | --------------- | ---------------------------------------- | ---------------------------------------- | ------ |
| yellow-linear   | linear          | `mcp__plugin_yellow-linear_linear__`     | `mcp__plugin_linear_linear__`            | NO     |
| yellow-chatprd  | chatprd         | `mcp__plugin_yellow-chatprd_chatprd__`   | `mcp__plugin_chatprd_chatprd__`          | NO     |
| yellow-devin    | deepwiki, devin | `mcp__plugin_yellow-devin_*__`           | `mcp__plugin_deepwiki_*__`               | NO     |
| yellow-ruvector | ruvector        | `mcp__plugin_yellow-ruvector_ruvector__` | `mcp__plugin_yellow-ruvector_ruvector__` | YES    |
| yellow-core     | context7        | N/A                                      | N/A                                      | N/A    |

## Recommendation

**Action required:** Fix MCP tool name prefixes in yellow-linear,
yellow-chatprd, and yellow-devin commands/agents.

**Important caveat:** The exact naming pattern should be verified by installing
the plugin via `claude plugin add` and checking actual tool names with
ToolSearch. The pattern `mcp__plugin_<plugin-name>_<server-key>__<tool>` is
inferred from observed behavior (yellow-ruvector matches, and the system's
deferred tool list uses this pattern).

**Note:** The yellow-devin `wiki.md` command already includes a note: "Verify
exact names via ToolSearch during first use — the actual registered names may
differ." This is a good defensive pattern that all MCP-dependent commands should
follow.

## Remediation Plan

Fix tool names in Phase 2 or as a follow-up PR:

1. Replace `mcp__plugin_linear_linear__` with
   `mcp__plugin_yellow-linear_linear__` in yellow-linear
2. Replace `mcp__plugin_chatprd_chatprd__` with
   `mcp__plugin_yellow-chatprd_chatprd__` in yellow-chatprd
3. Replace `mcp__plugin_deepwiki_deepwiki__` with
   `mcp__plugin_yellow-devin_deepwiki__` in yellow-devin
4. Replace `mcp__plugin_devin_devin__` with `mcp__plugin_yellow-devin_devin__`
   in yellow-devin
5. Replace `mcp__plugin_linear_linear__` with
   `mcp__plugin_yellow-linear_linear__` in yellow-chatprd (cross-plugin refs)
