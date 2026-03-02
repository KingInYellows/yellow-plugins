---
name: statusline:setup
description: "Generate and install an adaptive Python statusline for yellow-plugins. Auto-detects installed plugins and their MCP servers, previews the result, and writes to ~/.claude/settings.json on confirmation. Re-run after installing new plugins."
argument-hint: ''
allowed-tools:
  - Bash
  - Read
  - Write
  - AskUserQuestion
---

# Set Up Yellow Plugins Statusline

Generate a Python statusline script that shows context window usage, git status,
MCP server health per-plugin, model name, agent name, and session duration. The
script uses an adaptive layout: one line when healthy, two lines when alerts are
active.

## Workflow

**Goal: complete setup in 4-5 tool calls.** Batch operations into single Bash
calls to minimize round-trips.

### Step 1: Check Prerequisites and Existing State (ONE Bash call)

Run all checks in a single command:

```bash
printf '=== Prerequisites ===\n'
if command -v python3 >/dev/null 2>&1; then
  py_ver=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null)
  printf 'python3: %s\n' "$py_ver"
  py_ok=$(python3 -c "import sys; print('ok' if sys.version_info >= (3, 7) else 'too_old')" 2>/dev/null)
  printf 'python3_check: %s\n' "$py_ok"
else
  printf 'python3: NOT FOUND\n'
  printf 'python3_check: missing\n'
fi

printf '\n=== Existing State ===\n'
[ -d ~/.claude ] && printf 'claude_dir: exists\n' || printf 'claude_dir: missing\n'
[ -f ~/.claude/yellow-statusline.py ] && printf 'script: exists\n' || printf 'script: missing\n'
[ -f ~/.claude/settings.json ] && printf 'settings: exists\n' || printf 'settings: missing\n'

if [ -f ~/.claude/settings.json ]; then
  if python3 -c "import json, os; d=json.load(open(os.path.expanduser('~/.claude/settings.json'))); print('statusLine:', json.dumps(d.get('statusLine', 'NONE')))" 2>/dev/null; then
    :
  else
    printf 'settings_parse: ERROR (invalid JSON)\n'
  fi
  python3 -c "import json, os; d=json.load(open(os.path.expanduser('~/.claude/settings.json'))); print('disableAllHooks:', d.get('disableAllHooks', False))" 2>/dev/null
fi

printf '\n=== Plugin Detection ===\n'
plugin_cache="$HOME/.claude/plugins/cache"
if [ -d "$plugin_cache" ]; then
  find "$plugin_cache" -path '*/.claude-plugin/plugin.json' -exec python3 -c "
import json, sys, os
for path in sys.argv[1:]:
    try:
        d = json.load(open(path))
        name = d.get('name', 'unknown')
        servers = d.get('mcpServers', {})
        srv_info = []
        for sname, sconf in servers.items():
            stype = sconf.get('type', 'command')
            env_keys = list(sconf.get('env', {}).keys())
            env_str = ','.join(env_keys) if env_keys else '-'
            srv_info.append(f'{sname}({stype},{env_str})')
        print(f'plugin: {name} | servers: {\" \".join(srv_info) if srv_info else \"(none)\"}')
    except Exception as e:
        print(f'plugin_error: {path}: {e}', file=sys.stderr)
" {} +
else
  printf 'plugin_cache: NOT FOUND\n'
fi
```

**Decision tree from output:**

- `python3: NOT FOUND` → stop with error:
  "Python 3.7+ is required. Install from https://python.org or your system
  package manager."
- `python3_check: too_old` → stop with error:
  "Python 3.7+ required (found X.Y). Please upgrade."
- `disableAllHooks: True` → warn: "Your settings have `disableAllHooks: true`.
  The statusline will not appear until you disable that setting."
- `statusLine:` not `NONE` → note the existing config for Step 4.
- `settings_parse: ERROR` → note for Step 5 (will need to create fresh file).

### Step 2: Build Configuration from Detected Plugins

From the Step 1 output, build two Python dicts:

**DETECTED_PLUGINS** — Only plugins that have MCP servers:

```python
DETECTED_PLUGINS = {
    "yellow-core": ["context7"],
    "yellow-research": ["perplexity", "tavily", "exa", "parallel"],
    # ... only what was actually detected in Step 1
}
```

**ENV_REQUIREMENTS** — Only for command-type servers that have env var
dependencies. Map server name to the full list of required env vars:

```python
ENV_REQUIREMENTS = {
    "perplexity": ["PERPLEXITY_API_KEY"],
    "tavily": ["TAVILY_API_KEY"],
    "exa": ["EXA_API_KEY"],
}
```

Rules for building these dicts:

- HTTP-type servers (`type: "http"`) → always considered healthy, no env check
- Command-type servers with `env` field → extract all env var names into a list
- Command-type servers without `env` (e.g., ruvector) → no env check; use
  special ruvector health check (`.ruvector/` directory existence)
- Plugins with zero MCP servers → omit from DETECTED_PLUGINS entirely

If no plugins with MCP servers were detected, set `DETECTED_PLUGINS = {}` and
skip the MCP health segment in the generated script.

### Step 3: Generate and Write the Python Script

Resolve the absolute home path first:

```bash
python3 -c "import os; print(os.path.expanduser('~'))"
```

Use the Write tool to create `~/.claude/yellow-statusline.py` with the full
Python script below. Replace `DETECTED_PLUGINS`, `ENV_REQUIREMENTS`, the
`GENERATED_AT` timestamp, and the `STATUSLINE_VERSION` with actual values.

Create `~/.claude/` if it does not exist:

```bash
mkdir -p ~/.claude
```

The generated script content:

```python
#!/usr/bin/env python3
"""Yellow Plugins Statusline — generated by /statusline:setup
Re-run /statusline:setup after installing or removing plugins."""
import json, sys, os, subprocess, time, traceback

# --- Config (baked in by /statusline:setup) ---
STATUSLINE_VERSION = "1.0.0"
GENERATED_AT = "REPLACE_WITH_ISO_TIMESTAMP"
DETECTED_PLUGINS = REPLACE_WITH_DETECTED_PLUGINS
ENV_REQUIREMENTS = REPLACE_WITH_ENV_REQUIREMENTS
RUVECTOR_CHECK = REPLACE_WITH_BOOLEAN  # True if yellow-ruvector is installed
CONTEXT_WARN = 70
CONTEXT_CRIT = 90
GIT_CACHE_TTL = 5
CACHE_DIR = os.path.expanduser("~/.claude")

# --- Color helpers ---
USE_COLOR = (
    os.environ.get("NO_COLOR") is None
    and os.environ.get("TERM") != "dumb"
)

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
        with open(path, "w") as f:
            f.write(content)
    except OSError:
        pass

# --- Segment functions ---
# Each returns (text, alert_level) or (text, alert_level, alert_details_list).
# alert_level: 0=normal, 1=warning, 2=critical.
# If text is None, the segment is skipped.

def segment_model(data):
    name = data.get("model", {}).get("display_name", "?")
    return (c("36", f"[{name}]"), 0)

def segment_context(data):
    pct = data.get("context_window", {}).get("used_percentage")
    if pct is None:
        return ("ctx:--", 0)
    pct = int(pct)
    bar_w = 10
    filled = pct * bar_w // 100
    bar = "\u2588" * filled + "\u2591" * (bar_w - filled)
    if pct >= CONTEXT_CRIT:
        return (c("31", f"{bar} {pct}%"), 2, [f"ctx: {pct}% (critical)"])
    elif pct >= CONTEXT_WARN:
        return (c("33", f"{bar} {pct}%"), 1, [f"ctx: {pct}% (warning)"])
    return (c("32", f"{bar} {pct}%"), 0)

def segment_git(data):
    cache_path = os.path.join(CACHE_DIR, "yellow-sl-git")
    cached = read_cache(cache_path, GIT_CACHE_TTL)
    if cached:
        parts = cached.split("\n")
        if len(parts) == 3:
            try:
                branch, staged, modified = parts[0], int(parts[1]), int(parts[2])
            except ValueError:
                return ("git:--", 0)
        else:
            return ("git:--", 0)
    else:
        try:
            git_cwd = data.get("cwd")
            branch = subprocess.check_output(
                ["git", "rev-parse", "--abbrev-ref", "HEAD"],
                stderr=subprocess.DEVNULL, timeout=2, cwd=git_cwd
            ).decode().strip()
            status = subprocess.check_output(
                ["git", "status", "--porcelain"],
                stderr=subprocess.DEVNULL, timeout=2, cwd=git_cwd
            ).decode()
            lines = [l for l in status.splitlines() if l]
            staged = sum(1 for l in lines if l[0] in "MADRC")
            modified = sum(1 for l in lines if len(l) > 1 and l[1] in "MD")
            write_cache(cache_path, f"{branch}\n{staged}\n{modified}")
        except Exception:
            return ("git:--", 0)
    dirty = staged + modified
    if dirty:
        info = []
        if staged:
            info.append(f"+{staged}")
        if modified:
            info.append(f"~{modified}")
        detail_parts = []
        if staged:
            detail_parts.append(f"{staged} staged")
        if modified:
            detail_parts.append(f"{modified} modified")
        return (c("33", f"{branch} {' '.join(info)}"), 1, [f"git: {', '.join(detail_parts)}"])
    return (c("36", branch), 0)

def segment_mcp_health(data):
    if not DETECTED_PLUGINS:
        return (None, 0)
    alerts = []
    summaries = []
    cwd = data.get("cwd", os.getcwd())
    for plugin, servers in sorted(DETECTED_PLUGINS.items()):
        short = plugin.replace("yellow-", "")
        ok = 0
        total = len(servers)
        for s in servers:
            envs = ENV_REQUIREMENTS.get(s)
            if s == "ruvector" and RUVECTOR_CHECK:
                # Special check: .ruvector/ directory in cwd
                if os.path.isdir(os.path.join(cwd, ".ruvector")):
                    ok += 1
                else:
                    alerts.append(f"ruvector: .ruvector/ missing (run /ruvector:setup)")
            elif envs is None or all(os.environ.get(e) for e in envs):
                ok += 1
            else:
                missing = [e for e in (envs or []) if not os.environ.get(e)]
                alerts.append(f"{s}: ${', $'.join(missing)} not set (run /{short}:setup)")
        if ok == total:
            summaries.append(c("32", f"{short}:OK"))
        else:
            summaries.append(c("33", f"{short}:{ok}/{total}"))
    text = " ".join(summaries)
    alert = 1 if alerts else 0
    return (text, alert, alerts if alerts else [])

def segment_agent(data):
    agent = data.get("agent", {})
    name = agent.get("name") if isinstance(agent, dict) else None
    if name:
        return (c("35", f"@{name}"), 0)
    return (None, 0)

def segment_duration(data):
    ms = data.get("cost", {}).get("total_duration_ms")
    if ms is None:
        return (None, 0)
    total_s = int(ms) // 1000
    minutes = total_s // 60
    seconds = total_s % 60
    if minutes < 1:
        return (f"{seconds}s", 0)
    return (f"{minutes}m {seconds}s", 0)

# --- Layout engine ---
def render():
    data = json.load(sys.stdin)
    segments = []
    alert_details = []
    max_alert = 0

    for fn in [segment_model, segment_context, segment_git,
               segment_mcp_health, segment_agent, segment_duration]:
        try:
            result = fn(data)
        except Exception:
            continue
        text, alert = result[0], result[1]
        if text is None:
            continue
        segments.append(text)
        max_alert = max(max_alert, alert)
        if len(result) > 2 and result[2]:
            alert_details.extend(result[2])

    line1 = " | ".join(segments)
    print(line1)

    if max_alert > 0 and alert_details:
        color = "31" if max_alert >= 2 else "33"
        print(c(color, " | ".join(alert_details)))

if __name__ == "__main__":
    try:
        render()
    except BrokenPipeError:
        pass  # Claude Code cancelled mid-output
    except Exception:
        try:
            with open(os.path.join(CACHE_DIR, "yellow-sl-error.log"), "a") as f:
                f.write(traceback.format_exc())
        except Exception:
            pass  # Never crash — blank statusline is better than error
```

After writing, set executable:

```bash
chmod +x ~/.claude/yellow-statusline.py
```

### Step 4: Preview and Conflict Check

Show the user a summary. Format it as a clear text block:

```text
Yellow Plugins Statusline — Preview
====================================

Detected plugins:
  Plugin            MCP Servers                    Status
  ----------------  ----------------------------   ------
  yellow-core       context7 (HTTP)                OK
  yellow-research   perplexity, tavily, exa, ...   3/4 keys set
  ...

Segments: [Model] | Context Bar | Git Branch | MCP Health | @Agent | Duration

Normal (1 line):
  [Opus] | ████████░░ 45% | main | core:OK research:OK | 12m

Alert (2 lines):
  [Opus] | ██████████ 78% | main +2~1 | core:OK research:3/4
  perplexity: $PERPLEXITY_API_KEY not set (run /research:setup)
```

Use actual detected plugin data for the preview. Show which env vars are
currently missing.

If an existing `statusLine` was found in Step 1, show it prominently:

```text
Existing statusline detected:
  command: "python3 /home/user/.claude/some-other-statusline.py"
```

### Step 5: Confirm and Install

Use AskUserQuestion to get confirmation.

**If NO existing statusLine:**

> "Install the yellow-plugins statusline?"
>
> Options: "Yes, install" / "No, cancel"

**If existing statusLine found:**

> "An existing statusline is configured. What would you like to do?"
>
> Options: "Replace existing" / "Back up existing and replace" / "Cancel"

If user cancels: print "Setup cancelled. No files were modified." and stop.

If user chose "Back up existing and replace":

```bash
python3 -c "
import json, os, shlex, shutil
settings_path = os.path.expanduser('~/.claude/settings.json')
try:
    with open(settings_path) as f:
        cmd = json.load(f).get('statusLine', {}).get('command', '')
    # Extract the script path (last token handles 'python3 /path/to/script.py')
    parts = shlex.split(cmd)
    script = parts[-1] if parts else ''
    if script and os.path.isfile(script):
        shutil.copy2(script, script + '.backup')
        print(f'Backed up {script} -> {script}.backup')
    else:
        print('No existing statusline script found to back up.', file=__import__('sys').stderr)
except Exception as e:
    print(f'Backup skipped: {e}', file=__import__('sys').stderr)
"
```

Then merge `statusLine` into `~/.claude/settings.json` using an atomic write.
Resolve the absolute path to the script:

```bash
python3 -c "
import json, os, re, shlex, shutil, sys

home = os.path.expanduser('~')
script_path = os.path.join(home, '.claude', 'yellow-statusline.py')
settings_path = os.path.join(home, '.claude', 'settings.json')
tmp_path = settings_path + '.tmp'

# Read existing or start fresh
settings = {}
if os.path.isfile(settings_path):
    try:
        with open(settings_path) as f:
            settings = json.load(f)
    except json.JSONDecodeError as e:
        with open(settings_path) as f:
            raw = f.read()
        if re.search(r'(^\s*//|/\*)', raw, re.MULTILINE):
            print('Error: settings.json contains JSONC comments. Please remove comments or manually add the statusLine key.', file=sys.stderr)
            sys.exit(1)
        backup_path = settings_path + '.corrupt.backup'
        shutil.copy2(settings_path, backup_path)
        print(f'Warning: settings.json is corrupt ({e}). Backed up to {backup_path} and creating fresh.', file=sys.stderr)
    except OSError as e:
        print(f'Warning: Could not read settings.json ({e}). Creating fresh.', file=sys.stderr)

# Merge statusLine key
settings['statusLine'] = {
    'type': 'command',
    'command': f'python3 {shlex.quote(script_path)}'
}

# Atomic write: tmp -> validate -> rename
with open(tmp_path, 'w') as f:
    json.dump(settings, f, indent=2)
    f.write('\n')

# Validate tmp file
with open(tmp_path) as f:
    json.load(f)  # Throws if invalid

os.replace(tmp_path, settings_path)
print(f'Updated {settings_path}')
print(f'  statusLine.command = python3 {script_path}')
"
```

### Step 6: Validate and Report

Run the generated script with mock data to verify it works:

```bash
echo '{"model":{"display_name":"Test","id":"test"},"context_window":{"used_percentage":45,"remaining_percentage":55,"context_window_size":200000},"cost":{"total_duration_ms":120000},"cwd":"/tmp"}' | python3 ~/.claude/yellow-statusline.py
```

If the output is non-empty and the exit code is 0, report success.

Read back `~/.claude/settings.json` to confirm `statusLine` is present:

```bash
python3 -c "import json, os; d=json.load(open(os.path.expanduser('~/.claude/settings.json'))); print('statusLine:', json.dumps(d.get('statusLine'), indent=2))"
```

Display the final report:

```text
Yellow Plugins Statusline — Installed
======================================

  Script:    ~/.claude/yellow-statusline.py
  Settings:  ~/.claude/settings.json (statusLine key added)
  Plugins:   X detected (Y with MCP servers)
  Version:   1.0.0

The statusline will appear after your next assistant message.

To reconfigure:  /statusline:setup  (re-run after installing new plugins)
To remove:       Delete the "statusLine" key from ~/.claude/settings.json
```

Then ask via AskUserQuestion: "What would you like to do next?" with options:
"Done", "Test it (send a message to see the statusline)".

## Error Handling

| Error | Message | Action |
|---|---|---|
| Python 3 not found | "Python 3.7+ is required. Install from python.org." | Stop |
| Python 3 < 3.7 | "Python 3.7+ required (found X.Y). Please upgrade." | Stop |
| Plugin cache not found | "No plugin cache at ~/.claude/plugins/cache/. Are yellow-plugins installed?" | Warn, generate minimal script |
| No MCP-enabled plugins | "No plugins with MCP servers detected. MCP health segment disabled." | Continue, skip MCP segment |
| settings.json invalid JSON | "Could not parse settings.json. A fresh file will be created." | Warn, create new |
| settings.json write failed | "Could not write settings.json. Check permissions on ~/.claude/." | Stop |
| Script validation failed | "Generated script produced no output. Check Python installation." | Stop before writing settings |
| disableAllHooks is true | "Warning: disableAllHooks is true — statusline won't appear." | Warn, continue |
| User cancels | "Setup cancelled. No files were modified." | Stop |
| Backup copy failed | "Could not back up existing script. Proceeding without backup." | Warn, continue |
