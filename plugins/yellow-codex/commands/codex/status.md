---
name: codex:status
description: "Check running Codex processes and recent session history. Use to monitor long-running Codex tasks or debug hung processes."
argument-hint: ''
allowed-tools:
  - Bash
---

# Codex Status

Check the state of any running or recent Codex processes and sessions.

## Workflow

### Step 1: Check Codex CLI

```bash
if command -v codex >/dev/null 2>&1; then
  codex_version=$(codex --version 2>/dev/null || echo "unknown")
  printf '[yellow-codex] CLI: codex v%s\n' "$codex_version"
else
  printf '[yellow-codex] CLI: not installed\n'
  printf '  Run /codex:setup to install.\n'
fi
```

### Step 2: Check Running Processes

```bash
codex_procs=$(pgrep -af codex 2>/dev/null || true)
if [ -n "$codex_procs" ]; then
  proc_count=$(printf '%s\n' "$codex_procs" | wc -l)
  printf '[yellow-codex] Running processes: %d\n' "$proc_count"
  printf '%s\n' "$codex_procs" | head -5
else
  printf '[yellow-codex] Running processes: none\n'
fi
```

### Step 3: Check Session Files

```bash
CODEX_SESSIONS="${HOME}/.codex/sessions"
if [ -d "$CODEX_SESSIONS" ]; then
  session_count=$(find "$CODEX_SESSIONS" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)
  printf '[yellow-codex] Saved sessions: %d\n' "$session_count"
  if [ "$session_count" -gt 0 ]; then
    printf '  Recent:\n'
    ls -lt "$CODEX_SESSIONS" 2>/dev/null | head -5
  fi
else
  printf '[yellow-codex] Saved sessions: none (no ~/.codex/sessions/)\n'
fi
```

### Step 4: Check Authentication

```bash
if [ -n "${OPENAI_API_KEY:-}" ]; then
  printf '[yellow-codex] Auth: OPENAI_API_KEY set\n'
elif [ -f "${HOME}/.codex/auth.json" ]; then
  if command -v jq >/dev/null 2>&1; then
    auth_mode=$(jq -r '.auth_mode // "unknown"' "${HOME}/.codex/auth.json" 2>/dev/null || echo "unknown")
    printf '[yellow-codex] Auth: codex login (%s)\n' "$auth_mode"
  else
    printf '[yellow-codex] Auth: codex login (auth file exists, jq not installed)\n'
  fi
else
  printf '[yellow-codex] Auth: not configured\n'
fi
```

### Step 5: Check Configuration

```bash
CODEX_CONFIG="${HOME}/.codex/config.toml"
if [ -f "$CODEX_CONFIG" ]; then
  codex_model=$(grep -E '^model\s*=' "$CODEX_CONFIG" 2>/dev/null | sed 's/.*=\s*"\?\([^"]*\)"\?/\1/' || true)
  printf '[yellow-codex] Config: %s\n' "$CODEX_CONFIG"
  if [ -n "$codex_model" ]; then
    printf '[yellow-codex] Default model: %s\n' "$codex_model"
  fi
else
  printf '[yellow-codex] Config: defaults (no config.toml)\n'
fi
```

### Step 6: Report Summary

```
yellow-codex Status
─────────────────────────────
CLI:        {installed vX.X.X | not installed}
Auth:       {API key | OAuth | not configured}
Config:     {custom | defaults}
Model:      {default model from config}
Processes:  {N running | none}
Sessions:   {N saved | none}
─────────────────────────────
```
