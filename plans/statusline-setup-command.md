# Feature: `/statusline:setup` Command for Yellow Plugins

## Problem Statement

Users of the yellow-plugins ecosystem have no at-a-glance visibility into their
session state: context window consumption, MCP server health across plugins, git
status, or which model/agent is active. Claude Code supports custom statuslines
via Python/Bash scripts, but there's no `statusLine` field in `plugin.json` —
plugins can't inject statusline content natively. Users must manually create and
maintain a statusline script.

### User Impact

- Users don't notice context window exhaustion until Claude Code warns them
- MCP server failures (missing API keys, crashed processes) go unnoticed until a
  command fails
- No unified view of the plugin ecosystem's health during a session

### Expected Outcome

A `/statusline:setup` command that auto-detects installed yellow-plugins,
generates a tailored Python statusline script, previews it, and installs it into
`~/.claude/settings.json` — all in under 30 seconds with 3-4 tool calls.

## Proposed Solution

### High-Level Architecture

1. **Setup command** (`/statusline:setup`) in the `yellow-core` plugin that:
   - Scans `~/.claude/plugins/cache/` for installed yellow-plugins
   - Reads each plugin's `plugin.json` to extract MCP server declarations
   - Generates a Python statusline script with segments tailored to detected
     plugins
   - Previews the output and gets user confirmation
   - Writes `~/.claude/yellow-statusline.py` and merges `statusLine` config into
     `~/.claude/settings.json`

2. **Generated Python script** (`~/.claude/yellow-statusline.py`) with:
   - Segment-as-function architecture: each segment returns `(text, alert_level)`
   - Adaptive layout: 1 line normal, 2 lines when alerts are active
   - File-based caching for expensive operations (git, MCP health)
   - Zero external dependencies (Python 3 stdlib only)

### Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Plugin home | `yellow-core` | Cross-cutting concern; yellow-core is the foundational plugin |
| Command namespace | `statusline:setup` | New namespace (not `workflows:`) since this is infrastructure, not a workflow |
| Script language | Python 3 | Native JSON, clean segment architecture, robust error isolation |
| MCP health strategy | Env var check for command servers, "installed" for HTTP servers | No network calls in hot path — script runs on every assistant message |
| Layout | Adaptive 1-line/2-line | Compact when healthy, expands only when attention needed |
| Detection | Baked-in at generation time | Faster than runtime scanning; user re-runs setup after adding plugins |

### Trade-offs Considered

- **Runtime detection vs baked-in config**: Runtime detection always shows
  current plugins but adds ~10-50ms file I/O on cache miss. Baked-in config is
  faster and simpler. Chose baked-in; document "re-run /statusline:setup after
  installing new plugins."
- **Network health checks vs env var proxy**: HTTP pings would give real
  connectivity status but add 100-2000ms latency and may be cancelled by the
  300ms debounce. Env var checks are instant. Chose env var checks for command
  servers, "installed" status for HTTP servers.
- **New plugin vs yellow-core**: A standalone `yellow-statusline` plugin would
  avoid coupling. But yellow-core already hosts all workflow commands and is the
  natural home for ecosystem infrastructure. Chose yellow-core.

## Implementation Plan

### Phase 1: Command File

- [ ] 1.1: Create `plugins/yellow-core/commands/statusline/setup.md`
  - YAML frontmatter: `name: statusline:setup`, allowed-tools: `[Bash, Read, Write, AskUserQuestion]`
  - Workflow sections following the established setup command pattern

### Phase 2: Python Statusline Script (Generated Template)

The setup command will generate this script. We need to design the template that
gets written to `~/.claude/yellow-statusline.py`.

- [ ] 2.1: Design the segment functions
  - `segment_model(data)` — Show model display name (e.g., `Opus`)
  - `segment_git(data)` — Branch name + staged/modified counts from `git status --porcelain`
  - `segment_context(data)` — Unicode progress bar + percentage, color-coded by threshold
  - `segment_mcp_health(data)` — Plugin-level rollup from baked-in config
  - `segment_agent(data)` — Show agent name when present
  - `segment_duration(data)` — Session duration formatted as `Xm`
  - Each function returns `(text: str, alert_level: int)` where 0=normal, 1=warning, 2=critical
  - Each function wrapped in try/except for error isolation

- [ ] 2.2: Design the layout engine
  - Collect all segment results
  - If max(alert_levels) == 0: render single line with all segments joined by ` | `
  - If max(alert_levels) > 0: Line 1 = primary segments, Line 2 = alert details
  - Alert details: which MCP servers are unhealthy (with setup command hint), context warning, git dirty count

- [ ] 2.3: Design the caching layer
  - Git cache: `$TMPDIR/yellow-sl-git` with 5s TTL (default `/tmp` if `$TMPDIR` unset)
  - MCP cache: `$TMPDIR/yellow-sl-mcp` with 30s TTL (default `/tmp` if `$TMPDIR` unset)
  - Resolve via `os.environ.get("TMPDIR", "/tmp")` for cross-platform portability
  - Use `os.path.getmtime()` for TTL checks — no dependencies
  - Stable filenames (not PID-based) since each run is a new process

- [ ] 2.4: Design color system
  - Respect `NO_COLOR` env var and `TERM=dumb`
  - Use 16-color ANSI codes for maximum compatibility:
    - Green (`\033[32m`) for healthy/normal
    - Yellow (`\033[33m`) for warnings (context 70-89%, git dirty, MCP degraded)
    - Red (`\033[31m`) for critical (context 90%+, MCP all down)
    - Cyan (`\033[36m`) for informational (model name, git branch)
    - Reset (`\033[0m`) after every colored segment

### Phase 3: Setup Command Workflow

The command markdown will instruct Claude to follow these steps:

- [ ] 3.1: Step 1 — Check prerequisites
  - Verify Python 3 is available: `python3 --version`
  - Check `~/.claude/` directory exists
  - Check if `~/.claude/yellow-statusline.py` already exists
  - Check if `~/.claude/settings.json` exists and has `statusLine` key
  - Check if `disableAllHooks` is true in settings (statusline won't work)
  - Single Bash call for all checks

- [ ] 3.2: Step 2 — Detect installed plugins
  - Scan `~/.claude/plugins/cache/` for directories containing yellow-plugin manifests
  - For each found plugin, read `.claude-plugin/plugin.json`
  - Extract `mcpServers` object (keys = server names, values = config)
  - Classify each server: HTTP type (always "installed") vs command type (check env var)
  - Build the `DETECTED_PLUGINS` dict and `ENV_REQUIREMENTS` dict
  - Single Bash call using `find` + `python3 -c` inline

- [ ] 3.3: Step 3 — Generate the Python script
  - Use Write tool to create `~/.claude/yellow-statusline.py`
  - Embed the detected plugins as a baked-in `DETECTED_PLUGINS` dict
  - Embed the env var requirements as `ENV_REQUIREMENTS` dict
  - Include all segment functions, layout engine, caching, and color system
  - Set executable permission

- [ ] 3.4: Step 4 — Preview
  - Show the user:
    - Which plugins were detected (table)
    - Which segments are included
    - Mock rendering of normal state (1 line)
    - Mock rendering of alert state (2 lines)
  - If existing statusline config found, show current config and warn

- [ ] 3.5: Step 5 — Confirm and install
  - AskUserQuestion: "Install this statusline?" with options:
    - "Yes, install" / "No, cancel" / (if existing) "Replace existing"
  - On confirm: merge `statusLine` into `~/.claude/settings.json`
  - Use `python3 -c` to safely merge JSON (read, update key, write back)
  - Preserve all existing settings (enabledPlugins, permissions, etc.)

- [ ] 3.6: Step 6 — Validate and report
  - Read back `~/.claude/settings.json` to verify `statusLine` key
  - Read back `~/.claude/yellow-statusline.py` to verify it exists
  - Report success with next steps:
    - "Statusline will appear after your next assistant message"
    - "Re-run /statusline:setup after installing new plugins"
    - "To remove: delete statusLine from ~/.claude/settings.json"

### Phase 4: Plugin Registration

- [ ] 4.1: Update `plugins/yellow-core/CLAUDE.md`
  - Add `/statusline:setup` to the Commands section (bump count from 5 to 6)
  - Add to "When to Use What" section (if it exists)

- [ ] 4.2: Update `plugins/yellow-core/README.md`
  - Add `/statusline:setup` to commands table

- [ ] 4.3: Optionally bump `plugins/yellow-core/.claude-plugin/plugin.json` version

## Technical Specifications

### Files to Create

- `plugins/yellow-core/commands/statusline/setup.md` — The slash command definition

### Files to Modify

- `plugins/yellow-core/CLAUDE.md` — Add command to list (line ~41-47)
- `plugins/yellow-core/README.md` — Add command to documentation

### Files Generated at Runtime (by the setup command)

- `~/.claude/yellow-statusline.py` — Generated Python statusline script
- `~/.claude/settings.json` — Merged with `statusLine` configuration

### Dependencies

- Python 3 (standard library only: `json`, `sys`, `os`, `subprocess`, `time`, `pathlib`)
- No new npm/pip packages

### Stdin JSON Schema (consumed by generated script)

```json
{
  "model": { "id": "claude-opus-4-6", "display_name": "Opus" },
  "context_window": {
    "used_percentage": 45,
    "remaining_percentage": 55,
    "context_window_size": 200000
  },
  "cost": { "total_duration_ms": 120000 },
  "cwd": "/path/to/project",
  "agent": { "name": "security-reviewer" },
  "vim": { "mode": "NORMAL" }
}
```

Fields `agent` and `vim` may be absent. `used_percentage` may be `null` early in
session.

### Settings.json Integration

```json
{
  "statusLine": {
    "type": "command",
    "command": "python3 ~/.claude/yellow-statusline.py"
  }
}
```

### Generated Script Structure

```python
#!/usr/bin/env python3
"""Yellow Plugins Statusline — generated by /statusline:setup"""
import json, sys, os, subprocess, time

# --- Config (baked in at generation time) ---
DETECTED_PLUGINS = {
    "yellow-core": ["context7"],
    "yellow-research": ["perplexity", "tavily", "exa", "parallel"],
    # ... only plugins that are actually installed
}
ENV_REQUIREMENTS = {
    "perplexity": "PERPLEXITY_API_KEY",
    "tavily": "TAVILY_API_KEY",
    "exa": "EXA_API_KEY",
}
CONTEXT_WARN = 70
CONTEXT_CRIT = 90
GIT_CACHE_TTL = 5
MCP_CACHE_TTL = 30

# --- Color helpers ---
USE_COLOR = os.environ.get('NO_COLOR') is None and os.environ.get('TERM') != 'dumb'

def c(code, text):
    return f"\033[{code}m{text}\033[0m" if USE_COLOR else text

# --- Cache helpers ---
def read_cache(path, ttl):
    try:
        if time.time() - os.path.getmtime(path) < ttl:
            return open(path).read()
    except (OSError, ValueError):
        pass
    return None

def write_cache(path, content):
    try:
        with open(path, 'w') as f:
            f.write(content)
    except OSError:
        pass

# --- Segment functions ---
def segment_model(data):
    name = data.get('model', {}).get('display_name', '?')
    return (c('36', f"[{name}]"), 0)

def segment_context(data):
    pct = data.get('context_window', {}).get('used_percentage')
    if pct is None:
        return ("ctx:--", 0)
    pct = int(pct)
    bar_width = 10
    filled = pct * bar_width // 100
    bar = '\u2588' * filled + '\u2591' * (bar_width - filled)
    if pct >= CONTEXT_CRIT:
        return (c('31', f"{bar} {pct}%"), 2)
    elif pct >= CONTEXT_WARN:
        return (c('33', f"{bar} {pct}%"), 1)
    return (c('32', f"{bar} {pct}%"), 0)

def segment_git(data):
    cached = read_cache('/tmp/yellow-sl-git', GIT_CACHE_TTL)
    if cached:
        parts = cached.split('|')
        branch, staged, modified = parts[0], int(parts[1]), int(parts[2])
    else:
        try:
            branch = subprocess.check_output(
                ['git', 'rev-parse', '--abbrev-ref', 'HEAD'],
                stderr=subprocess.DEVNULL, timeout=2
            ).decode().strip()
            status = subprocess.check_output(
                ['git', 'status', '--porcelain'],
                stderr=subprocess.DEVNULL, timeout=2
            ).decode()
            staged = sum(1 for l in status.splitlines() if l and l[0] in 'MADRC')
            modified = sum(1 for l in status.splitlines() if l and len(l) > 1 and l[1] in 'MD')
            write_cache('/tmp/yellow-sl-git', f"{branch}|{staged}|{modified}")
        except Exception:
            return ("git:--", 0)
    dirty = staged + modified
    if dirty:
        parts = []
        if staged: parts.append(f"+{staged}")
        if modified: parts.append(f"~{modified}")
        return (c('33', f"{branch} {' '.join(parts)}"), 1)
    return (c('36', branch), 0)

def segment_mcp_health(data):
    # Check env vars for command-type servers, assume HTTP servers are OK
    alerts = []
    summaries = []
    for plugin, servers in DETECTED_PLUGINS.items():
        short = plugin.replace('yellow-', '')
        ok = 0
        for s in servers:
            env = ENV_REQUIREMENTS.get(s)
            if env is None or os.environ.get(env):
                ok += 1
            else:
                alerts.append(f"{s}: ${env} missing (run /{short}:setup)")
        if ok == len(servers):
            summaries.append(c('32', f"{short}:OK"))
        else:
            summaries.append(c('33', f"{short}:{ok}/{len(servers)}"))
    text = ' '.join(summaries)
    alert = 1 if alerts else 0
    return (text, alert, alerts if alerts else [])

def segment_agent(data):
    agent = data.get('agent', {}).get('name')
    if agent:
        return (c('35', f"@{agent}"), 0)
    return (None, 0)

def segment_duration(data):
    ms = data.get('cost', {}).get('total_duration_ms')
    if ms is None:
        return (None, 0)
    minutes = int(ms) // 60000
    return (f"{minutes}m", 0)

# --- Layout engine ---
def render():
    data = json.load(sys.stdin)
    segments = []
    alert_details = []
    max_alert = 0

    for fn in [segment_model, segment_context, segment_git, segment_mcp_health,
               segment_agent, segment_duration]:
        result = fn(data)
        text, alert = result[0], result[1]
        if text is None:
            continue
        segments.append(text)
        max_alert = max(max_alert, alert)
        if len(result) > 2 and result[2]:
            alert_details.extend(result[2])

    line1 = ' | '.join(segments)
    print(line1)

    if max_alert > 0 and alert_details:
        color = '31' if max_alert >= 2 else '33'
        print(c(color, ' | '.join(alert_details)))

if __name__ == '__main__':
    try:
        render()
    except Exception:
        pass  # Never crash — blank statusline is better than error
```

### Plugin-to-MCP-Server Map (Current Ecosystem)

| Plugin | MCP Servers | Type | Env Var Check |
|---|---|---|---|
| yellow-core | context7 | HTTP | — (always OK) |
| yellow-research | perplexity | command | `PERPLEXITY_API_KEY` |
| yellow-research | tavily | command | `TAVILY_API_KEY` |
| yellow-research | exa | command | `EXA_API_KEY` |
| yellow-research | parallel | HTTP | — (always OK) |
| yellow-devin | deepwiki | HTTP | — (always OK) |
| yellow-devin | devin | HTTP | — (always OK) |
| yellow-chatprd | chatprd | HTTP | — (always OK) |
| yellow-linear | linear | HTTP | — (always OK) |
| yellow-ruvector | ruvector | command | — (no env var needed) |

Plugins without MCP servers (yellow-ci, yellow-debt, yellow-review,
yellow-browser-test, gt-workflow) are detected but shown as plugin count only,
not in MCP health.

## Testing Strategy

- Manual testing: Run `/statusline:setup` in a fresh Claude Code session
  - Verify plugin detection finds all installed yellow-plugins
  - Verify generated script produces valid output
  - Verify settings.json merge preserves existing settings
  - Verify statusline appears after next assistant message
- Edge cases to test manually:
  - No yellow-plugins installed (show helpful message)
  - Existing statusline config (warn before replace)
  - Missing Python 3 (clear error message)
  - `disableAllHooks` is true (warn that statusline won't work)
  - `NO_COLOR` set (verify no ANSI codes in output)
  - Missing env vars (verify alert line shows which are missing)

## Acceptance Criteria

1. `/statusline:setup` detects all installed yellow-plugins with MCP servers
2. Generated script renders correctly with ANSI colors in a terminal
3. Adaptive layout: 1 line when all healthy, 2 lines when alerts present
4. Context window bar changes color at 70% (yellow) and 90% (red) thresholds
5. MCP health shows plugin-level rollup (e.g., `research:3/4 core:OK`)
6. Missing API keys trigger alert line with setup command hint
7. Settings.json merge preserves all existing settings
8. Script handles null/missing JSON fields gracefully (never crashes)
9. Respects `NO_COLOR` environment variable
10. Setup command warns if existing statusline config would be overwritten

## Edge Cases & Error Handling

| Scenario | Handling |
|---|---|
| Python 3 not installed | Stop with clear error + install instructions |
| Python 3 < 3.7 | Stop with "Python 3.7+ required" (f-strings, subprocess.run) |
| `python3` not on PATH but `python` is | Try `python3` first, fall back to `python --version` check |
| `~/.claude/` doesn't exist | Create it with `mkdir -p` |
| No yellow-plugins installed | Generate minimal statusline (context + git + model only), skip MCP segment |
| Only plugins without MCP servers | Same as above — skip MCP health segment, show note |
| Existing `statusLine` in settings | Show current config, offer: "Replace" / "Back up + replace" / "Cancel" |
| Existing `yellow-statusline.py` from prior run | Treat as re-generation; show version comparison if version marker present |
| User declines confirmation | Show "Setup cancelled. No files were modified." and exit |
| `disableAllHooks` is true | Warn that statusline won't work with this setting |
| `settings.json` has invalid JSON | Report error, offer to create fresh file (after backing up corrupt one) |
| `settings.json` does not exist | Create it with just the `statusLine` key |
| `used_percentage` is null | Show `ctx:--` placeholder |
| `agent` field absent | Skip agent segment |
| `agent` field structure | Access as `data.get('agent', {}).get('name')` — object with `name` key |
| Git not available | Show `git:--` placeholder, alert_level 0 (not an error) |
| Not in a git repository | Show `git:--` placeholder, alert_level 0 |
| Cache file permission error | Skip caching, compute fresh each time |
| Cache at `/tmp/` cleaned by OS | Script recreates on next run; use `$TMPDIR` fallback |
| Script cancelled mid-execution (debounce) | Cache ensures next run is fast; handle `BrokenPipeError` |
| Concurrent sessions sharing cache | Acceptable — cache is read-only between writes, no corruption risk |
| Ruvector health check (no env var) | Check if `.ruvector/` exists in cwd; treat as "installed" if present |
| Tilde expansion in settings.json | Resolve to absolute path at setup time (e.g., `/home/user/.claude/...`) |
| settings.json write corruption | Atomic write: write to `.tmp`, read back and validate, then `mv` to final |
| File write permissions denied | Report error with suggested fix (`chmod` or check ownership) |

## SpecFlow Analysis Resolutions

Key gaps identified by specification flow analysis and their resolutions:

### Conflict Resolution Strategy (Critical)

When `statusLine` already exists in `settings.json`:
1. Show the existing `command` value
2. Offer three AskUserQuestion options:
   - **"Replace existing statusline"** — overwrite with yellow-statusline
   - **"Back up and replace"** — copy existing script to `*.backup`, then replace
   - **"Cancel"** — exit without changes

### Ruvector Health Strategy (Critical)

Ruvector is command-based with no API key. Neither the "check env var" nor
"report installed" strategy is appropriate. Resolution:
- Check if `.ruvector/` directory exists in the current working directory
- If present: report as healthy (ruvector is initialized for this project)
- If absent: report as "not initialized" (suggest `/ruvector:setup`)
- This is a lightweight filesystem check, no subprocess needed

### Session Duration Computation

The stdin JSON provides `cost.total_duration_ms` which tracks wall-clock session
duration. Use this directly — no need for a separate timestamp file.

### Settings.json Write Safety

This is a new pattern for the codebase (existing setup commands are read-only).
Safety measures:
1. Read existing file with `json.load()`
2. Check for JSONC (comments) — warn user if detected
3. Merge only the `statusLine` key
4. Write to `settings.json.tmp` with `json.dump(indent=2)`
5. Read back `.tmp` and validate JSON parses correctly
6. Atomic rename `settings.json.tmp` → `settings.json`
7. If any step fails, leave original untouched

### Absolute Path Resolution

Use the absolute path resolved at setup time in settings.json:
```json
"command": "python3 /home/<user>/.claude/yellow-statusline.py"
```
This avoids tilde expansion ambiguity. The setup command resolves `~` via
`os.path.expanduser('~')` at generation time.

### Script Version Marker

Bake a version into the generated script header:
```python
STATUSLINE_VERSION = "1.0.0"
GENERATED_AT = "2026-03-01T12:00:00Z"
DETECTED_PLUGINS = { ... }
```
On subsequent `/statusline:setup` runs, compare versions and show what changed.

### Post-Install Validation

After writing the script, run it with mock stdin data to verify it produces
non-empty output:
```bash
echo '{"model":{"display_name":"Test"},"context_window":{"used_percentage":45}}' | python3 ~/.claude/yellow-statusline.py
```
If output is empty or the script errors, report the failure before updating
settings.json.

## Performance Considerations

- Script target: < 100ms total execution time
- Git operations: cached for 5 seconds (subprocess calls take ~20-50ms)
- MCP health: cached for 30 seconds (env var checks are instant, ~1ms)
- JSON parsing: ~1ms via `json.load(sys.stdin)`
- Color rendering: ~0ms (string concatenation)
- Total without cache: ~50-80ms. With cache: ~5-10ms.
- Claude Code debounces at 300ms and cancels in-flight scripts, so < 100ms is safe.

## Open Questions (Resolved)

| Question | Resolution |
|---|---|
| Plugin cache path portability | Use `~/.claude/plugins/cache/` and scan for yellow-plugin manifests by checking for `plugin.json` files. This is the documented path per the README. |
| MCP health for command servers | Check env var presence as proxy. No runtime pings. |
| Upstream `statusLine` in plugin.json | Out of scope — track as a future proposal to Anthropic. |
| Regeneration trigger | Document "re-run /statusline:setup after installing new plugins." |
| Existing statusline conflict | Detect, warn, offer replace or cancel. |

## References

- Brainstorm: `docs/brainstorms/2026-03-01-custom-statusline-for-yellow-plugins-brainstorm.md`
- Official docs: https://code.claude.com/docs/en/statusline
- Existing setup patterns: `plugins/yellow-research/commands/research/setup.md`,
  `plugins/yellow-ruvector/commands/ruvector/setup.md`
- Plugin manifest: `plugins/yellow-core/.claude-plugin/plugin.json`
- UI Style Guide: `docs/ui/style-guide.md`
