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

Check required tools and Python version:

```bash
if command -v python3 >/dev/null 2>&1; then
  py_ver=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null)
  py_ok=$(python3 -c "import sys; print('ok' if sys.version_info >= (3, 10) else 'too_old')" 2>/dev/null)
  printf '[yellow-mempalace] python3: %s (%s)\n' "$py_ok" "$py_ver"
else
  printf '[yellow-mempalace] python3: MISSING (required)\n'
fi
```

If python3 is missing: stop with error and install guidance.
If python3 is below 3.10: warn that mempalace may fail to install due to
onnxruntime/PyTorch requiring 3.10+. Recommend Python 3.11+ for best
compatibility.

### Step 2: Check palace initialization

Check if a palace exists:

```bash
if [ -d "$HOME/.mempalace" ] || mempalace status >/dev/null 2>&1; then
  printf '[yellow-mempalace] Palace: initialized\n'
  mempalace status 2>/dev/null | head -5
else
  printf '[yellow-mempalace] Palace: not initialized\n'
fi
```

If palace is NOT initialized, use AskUserQuestion:

> "No palace found at ~/.mempalace/. Initialize one now?"
>
> Options: "Yes, initialize palace" / "No, skip for now"

If the user chooses **Yes**:

```bash
mempalace init
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
  Claude Code. Check that `mempalace mcp` runs without errors by running it
  manually in a terminal."

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
