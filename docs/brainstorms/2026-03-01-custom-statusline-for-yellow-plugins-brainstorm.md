# Custom Statusline for Yellow Plugins

**Date:** 2026-03-01
**Status:** Brainstorm

## What We're Building

A `/statusline:setup` command for the yellow-plugins ecosystem that auto-detects which yellow plugins are installed, generates a Python statusline script tailored to those plugins, previews the result for the user, and installs it into `~/.claude/yellow-statusline.py` + updates `~/.claude/settings.json` upon confirmation.

The statusline uses an **adaptive layout**: a single compact line during normal operation that expands to two lines when something needs attention (context window > 70%, an MCP server is down, or git has uncommitted changes).

### Must-Have Segments

- **Context window usage** -- Visual progress bar with percentage, color-coded by threshold (green < 70%, yellow 70-89%, red 90%+).
- **Git branch + dirty state** -- Current branch name with staged/modified file counts. Color shifts when the working tree is dirty.
- **MCP server health (plugin-level rollup)** -- Groups MCP servers by their parent plugin and shows a ratio (e.g., `research:3/4 core:1/1 linear:1/1`). Highlights any plugin with degraded servers.

### Nice-to-Have Segments

- **Active agent name** -- Displayed when running with `--agent` or agent settings configured.
- **Session duration** -- Wall-clock time since session start, formatted as `Xm Ys`.
- **Model name** -- Current model display name (e.g., `Opus`).

### Creative Additions Worth Exploring

- **Workflow phase indicator** -- If the session is inside a brainstorm, plan, or review workflow, show a breadcrumb like `workflow:brainstorm/phase-3`. This could be driven by detecting known file patterns (e.g., recent writes to `docs/brainstorms/`, `plans/`, or PR review activity).
- **Context pressure trend** -- Instead of just current %, show a directional arrow (up/down/stable) based on whether context usage is accelerating. Calculated by comparing the last two `used_percentage` values via a simple cache file.
- **Plugin command hint** -- When an MCP server is down, show the relevant setup command (e.g., `run /research:setup`) as a quick-fix hint on the alert line.

### Not Included

- Session cost tracking (not selected).
- Lines added/removed (not selected).

## Why This Approach

### Python with Segment-as-Function Architecture

Python was chosen over Bash and Node.js for these reasons:

1. **Native JSON parsing** -- No `jq` dependency. The statusline receives JSON via stdin; Python's `json.load(sys.stdin)` handles it directly.
2. **Clean segment architecture** -- Each segment is a function that returns a `(text, alert_level)` tuple. The adaptive layout logic is a simple check: if any segment returns `alert_level > 0`, render two lines. This is easy to read, test, and extend.
3. **Robust error isolation** -- Each segment runs inside its own `try/except`. If git is not available or an MCP health check fails, that segment degrades gracefully without blanking the entire statusline.
4. **Maintainability** -- Conditional logic for adaptive expansion, ANSI color management, and cached health checks are all cleaner in Python than in Bash. The generated script remains readable enough for users to hand-edit.

The tradeoff is requiring Python 3, but this is present on virtually all developer machines and is already a dependency for several yellow-plugins MCP servers.

### Setup Command with Detect + Confirm Flow

The `/statusline:setup` command follows the pattern established by `/research:setup` and `/devin:setup`:

1. **Detect** -- Scan the plugin cache directory (`~/.claude/plugins/cache/yellow-plugins/`) for installed yellow plugins. For each, read its `plugin.json` to extract registered MCP servers.
2. **Generate** -- Build a Python statusline script with segments tailored to the detected plugins. Only include MCP health checks for plugins that are actually installed. Include all must-have segments unconditionally; include nice-to-have segments with sensible defaults.
3. **Preview** -- Show the user: which plugins were detected, which segments will be included, and a mock rendering of what the statusline will look like in normal and alert states.
4. **Confirm** -- Ask for explicit confirmation before writing `~/.claude/yellow-statusline.py` and updating `~/.claude/settings.json`.

This avoids surprising the user while still being low-friction. Running the command again regenerates the script (useful after installing new plugins).

## Key Decisions

### Adaptive Layout Rules

The statusline renders as **one line** when all of these are true:
- Context window usage < 70%
- All detected MCP servers are healthy
- Git working tree is clean (no staged or modified files)

It expands to **two lines** when any alert condition triggers:
- **Line 1 (always):** Model name, git branch, context bar, MCP rollup summary, duration
- **Line 2 (alert only):** Specific alert details -- which MCP servers are down (with setup command hint), context pressure warning, or git dirty file counts

### MCP Health Check Strategy

- **Discovery:** Parse each detected plugin's `plugin.json` to get the list of expected MCP servers (both `command`-based and `http`-based).
- **Health check:** For HTTP-based servers (like context7, parallel), attempt a lightweight HTTP HEAD request with a 2-second timeout. For command-based servers (like perplexity, tavily, exa), check if the process is reachable -- but since these are spawned by Claude Code on demand, "healthy" means "the plugin is installed and the env var is set" rather than "the process is running."
- **Caching:** Health results are cached to `/tmp/yellow-statusline-mcp-cache` with a 30-second TTL. This prevents repeated network calls on every statusline refresh (which fires after every assistant message).
- **Display:** Plugin-level rollup: `research:3/4` means 3 of 4 research plugin MCP servers are healthy. A plugin with all servers healthy shows as `research:OK`.

### Color Scheme

| Element | Normal | Warning | Critical |
|---------|--------|---------|----------|
| Context bar | Green (`\033[32m`) | Yellow (`\033[33m`) at 70% | Red (`\033[31m`) at 90% |
| Git branch | Cyan (`\033[36m`) | Yellow if dirty | -- |
| MCP rollup | Green if all OK | Yellow if degraded | Red if all down |
| Alert line | -- | Yellow background | Red background |

### Script Generation Details

The generated Python script structure:

```
#!/usr/bin/env python3
"""Yellow Plugins Statusline - generated by /statusline:setup"""

# --- Config (regenerated on each setup run) ---
DETECTED_PLUGINS = { ... }  # plugin name -> list of MCP server names
CACHE_TTL = 30
ALERT_THRESHOLDS = { "context_warn": 70, "context_crit": 90 }

# --- Segment functions ---
def segment_model(data): ...
def segment_context(data): ...
def segment_git(data): ...
def segment_mcp_health(data): ...
def segment_agent(data): ...
def segment_duration(data): ...

# --- Layout engine ---
def render(segments): ...  # adaptive single/double line logic

# --- Main ---
if __name__ == "__main__":
    data = json.load(sys.stdin)
    segments = [segment_model, segment_context, segment_git, segment_mcp_health, ...]
    print(render([s(data) for s in segments]))
```

### Settings Integration

The setup command writes or updates `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "python3 ~/.claude/yellow-statusline.py"
  }
}
```

Note: The script is named `yellow-statusline.py` (not `statusline.sh`) to avoid conflicting with any existing user statusline script. The setup command checks for an existing `statusLine` config and warns before overwriting.

## Open Questions

1. **Plugin cache path portability** -- Is `~/.claude/plugins/cache/yellow-plugins/` the stable, documented path for installed plugins across all platforms? If this changes, the detection logic breaks. Should we also support a fallback scan of `.claude/settings.json` MCP server entries?

2. **MCP health for command-based servers** -- Servers like perplexity and tavily are spawned by Claude Code on demand. There is no long-running process to ping. Should we check for the presence of required env vars (e.g., `PERPLEXITY_API_KEY`) as a proxy for "healthy," or simply report "installed" vs "not installed" and skip runtime health?

3. **Statusline as a plugin feature** -- Currently `plugin.json` has no `statusLine` field. Should we propose this upstream to Anthropic? A plugin-native statusline hook would eliminate the need for a setup command entirely. Worth tracking but not blocking on.

4. **Regeneration trigger** -- After a user installs a new yellow plugin, the statusline won't know about it until `/statusline:setup` is run again. Should the script itself detect new plugins at runtime (heavier, but always current) or should we just document "re-run setup after installing new plugins"?

5. **Conflict with existing statuslines** -- If a user already has a custom statusline, the setup command should offer to merge rather than replace. How sophisticated should this merge be? Options range from "warn and abort" to "wrap their existing script as an additional segment."
