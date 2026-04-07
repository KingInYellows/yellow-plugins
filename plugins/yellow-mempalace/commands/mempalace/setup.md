---
name: mempalace:setup
description: "Validate prerequisites, install CLI, initialize palace, and verify MCP connection. Use when first installing the plugin, after upgrades, or when mempalace tools fail."
allowed-tools:
  - Bash
  - ToolSearch
  - AskUserQuestion
---

# Set Up yellow-mempalace

Validate prerequisites, install the mempalace CLI, initialize the palace
directory, and verify MCP tool availability.

## Workflow

### Step 0: Install or upgrade mempalace CLI

Check if `mempalace` is already installed:

```bash
command -v mempalace >/dev/null 2>&1 && printf '[yellow-mempalace] mempalace: ok (%s)\n' "$(mempalace --version 2>/dev/null)"
```

If `mempalace` is NOT found, use AskUserQuestion:

> "mempalace CLI not found. Install it now? (Required for memory storage,
> search, and MCP tools)"
>
> Options: "Yes, install mempalace" / "No, I'll install manually"

If the user chooses **Yes**: run the install script:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/install-mempalace.sh"
```

If the user chooses **No**: report that mempalace is required and stop.

### Step 1: Validate prerequisites

Check required tools:

```bash
command -v python3 >/dev/null 2>&1 && printf '[yellow-mempalace] python3: ok (%s)\n' "$(python3 --version 2>/dev/null)" || printf '[yellow-mempalace] python3: MISSING (required)\n'
```

If python3 is missing: stop with error and install guidance.

### Step 2: Check palace initialization

Check if a palace exists in the current project:

```bash
if [ -d ".mempalace" ] || mempalace status >/dev/null 2>&1; then
  printf '[yellow-mempalace] Palace: initialized\n'
  mempalace status 2>/dev/null | head -5
else
  printf '[yellow-mempalace] Palace: not initialized\n'
fi
```

If palace is NOT initialized, use AskUserQuestion:

> "No palace found in this project. Initialize one now?"
>
> Options: "Yes, initialize palace here" / "No, skip for now"

If the user chooses **Yes**:

```bash
mempalace init .
```

### Step 3: Verify MCP tools

Use ToolSearch with query `"+mempalace"` to discover available MCP tools.

Expected core tools (minimum 4 to confirm MCP is working):
- `mcp__plugin_yellow-mempalace_mempalace__mempalace_status`
- `mcp__plugin_yellow-mempalace_mempalace__mempalace_search`
- `mcp__plugin_yellow-mempalace_mempalace__mempalace_list_wings`
- `mcp__plugin_yellow-mempalace_mempalace__mempalace_add_drawer`

If fewer than 4 tools found:
- Check if mempalace version supports MCP: `mempalace --version`
- If version < 3.0.0: "Upgrade with: pipx upgrade mempalace"
- If version >= 3.0.0: "MCP server may have failed to start. Try restarting
  Claude Code. If `mempalace mcp` is not a valid subcommand, the MCP server
  may need to be invoked as `python -m mempalace.mcp_server` — update
  plugin.json accordingly."

### Step 4: Report summary

Display a summary table:

```
yellow-mempalace Setup Summary
──────────────────────────────
mempalace CLI   : [version or MISSING]
Python          : [version or MISSING]
Palace          : [initialized / not initialized]
MCP tools       : [count] tools discovered
Status          : [Ready / Needs attention]
```

If all checks pass: "Setup complete. Try `/mempalace:status` to see your
palace overview."

If palace not initialized: "Run `mempalace init .` to create a palace, then
`mempalace mine .` to index your project."
