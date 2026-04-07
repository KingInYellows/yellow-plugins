---
name: mempalace:status
description: "Show palace overview including wings, rooms, drawers, and knowledge graph stats. Use when checking palace health or verifying initialization."
allowed-tools:
  - Bash
  - ToolSearch
---

# Palace Status

Show a comprehensive overview of the current palace.

## Workflow

### Step 1: Discover MCP tools

Use ToolSearch with query `"+mempalace status"` to find the status tool.

### Step 2: Get palace status

Call `mcp__plugin_yellow-mempalace_mempalace__mempalace_status` with no
parameters.

If the tool is unavailable or errors, fall back to CLI:

```bash
mempalace status 2>&1
```

### Step 3: Get knowledge graph stats

Call `mcp__plugin_yellow-mempalace_mempalace__mempalace_kg_stats` with no
parameters.

If unavailable, skip this section.

### Step 4: Display summary

Present the results in a formatted overview:

```
Palace Overview
───────────────
Wings    : [count]
Rooms    : [count]
Drawers  : [count]
Path     : [palace path]

Knowledge Graph
───────────────
Entities : [count]
Triples  : [count] ([active] active, [expired] expired)
```

If the palace is empty (0 drawers): suggest "Run `/mempalace:mine .` to index
your project, or `/mempalace:mine ~/chats/ --mode convos` to import
conversation history."
