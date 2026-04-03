---
name: codex:setup
description: "Detect Codex CLI, verify OpenAI authentication, and install if needed. Run after first install or when codex commands fail."
argument-hint: ''
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
---

# Set Up yellow-codex

Validate prerequisites, detect the Codex CLI binary, verify OpenAI
authentication, and optionally install if missing.

## Workflow

### Step 0: Install or upgrade Codex CLI

Check if `codex` is already installed:

```bash
command -v codex >/dev/null 2>&1 && printf '[yellow-codex] codex: ok (%s)\n' "$(codex --version 2>/dev/null)"
```

If `codex` is NOT found, use AskUserQuestion:

> "Codex CLI not found. Install it now? (Required for all /codex commands)"
>
> Options: "Yes, install codex" / "No, I'll install manually"

If the user chooses **Yes**: run the install script:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/install-codex.sh"
```

If the install script exits non-zero, print a warning with manual instructions
and continue to Step 1:

```text
[yellow-codex] Warning: codex installation failed. Install manually:
  npm install -g @openai/codex     (requires Node.js 22+)
  brew install --cask codex        (macOS)
  https://github.com/openai/codex/releases (standalone binary)
Then re-run /codex:setup
```

If the user chooses **No**: show manual install instructions and continue.

**If codex IS found**, check the version meets the minimum (v0.118.0+):

```bash
MIN_CODEX_VERSION="0.118.0"
codex_version_output=$(codex --version 2>/dev/null || true)
installed_version=$(printf '%s\n' "$codex_version_output" | grep -Eo '[0-9]+(\.[0-9]+)+' | head -n1 || true)
version_gte() {
  local i av bv
  local -a a b
  IFS='.' read -r -a a <<< "$1"
  IFS='.' read -r -a b <<< "$2"
  for ((i=0; i<${#b[@]}; i++)); do
    av="${a[i]:-0}"
    bv="${b[i]:-0}"
    av="${av%%[^0-9]*}"
    bv="${bv%%[^0-9]*}"
    av="${av:-0}"
    bv="${bv:-0}"
    if ((av > bv)); then return 0; fi
    if ((av < bv)); then return 1; fi
  done
  return 0
}
```

If the installed version is below minimum, use AskUserQuestion to offer upgrade.

### Step 1: Validate Prerequisites

Check required CLI tools:

```bash
# Node.js 22+ (hard prerequisite for Codex CLI)
if command -v node >/dev/null 2>&1; then
  node_major=$(node -e "console.log(process.versions.node.split('.')[0])")
  if [ "$node_major" -ge 22 ]; then
    printf '[yellow-codex] node: ok (v%s)\n' "$(node --version 2>/dev/null)"
  else
    printf '[yellow-codex] node: v%s (v22+ required for Codex CLI)\n' "$(node --version 2>/dev/null)" >&2
  fi
else
  printf '[yellow-codex] node: NOT FOUND (required for Codex CLI)\n' >&2
fi

# jq (soft prerequisite — warn if missing)
if command -v jq >/dev/null 2>&1; then
  printf '[yellow-codex] jq: ok\n'
else
  printf '[yellow-codex] jq: not found (degraded — JSON parsing limited)\n' >&2
fi
```

### Step 2: Verify Authentication

Codex CLI supports two authentication methods. Check both:

**Method 1: OPENAI_API_KEY environment variable**

```bash
if [ -n "${OPENAI_API_KEY:-}" ]; then
  # Validate format (sk- or sk-proj- prefix)
  if printf '%s' "$OPENAI_API_KEY" | grep -qE '^sk-(proj-)?[a-zA-Z0-9_-]{20,}$'; then
    printf '[yellow-codex] OPENAI_API_KEY: set (format valid)\n'
  else
    printf '[yellow-codex] OPENAI_API_KEY: set (unexpected format)\n' >&2
  fi
else
  printf '[yellow-codex] OPENAI_API_KEY: not set\n'
fi
```

**Method 2: ChatGPT OAuth via `codex login`**

```bash
if [ -f "${HOME}/.codex/auth.json" ]; then
  if command -v jq >/dev/null 2>&1; then
    auth_mode=$(jq -r '.auth_mode // empty' "${HOME}/.codex/auth.json" 2>/dev/null || true)
    if [ "$auth_mode" = "chatgpt" ]; then
      printf '[yellow-codex] codex login: authenticated (ChatGPT OAuth)\n'
    elif [ -n "$auth_mode" ]; then
      printf '[yellow-codex] codex login: authenticated (%s)\n' "$auth_mode"
    else
      printf '[yellow-codex] codex login: auth file exists but mode unknown\n'
    fi
  else
    printf '[yellow-codex] codex login: auth file exists (jq not installed; mode unknown)\n'
  fi
else
  printf '[yellow-codex] codex login: not configured\n'
fi
```

If neither method is configured:

```text
[yellow-codex] Warning: No authentication configured.
  Option 1: export OPENAI_API_KEY="sk-..." in ~/.zshrc
  Option 2: codex login (authenticates via ChatGPT)
```

Never echo the actual API key value. If detected, replace output with:
`--- redacted credential at line N ---`

### Step 3: Detect Codex Configuration

```bash
CODEX_CONFIG="${HOME}/.codex/config.toml"
if [ -f "$CODEX_CONFIG" ]; then
  # Extract key settings (model, approval mode)
  codex_model=$(grep -E '^model\s*=' "$CODEX_CONFIG" 2>/dev/null | sed 's/.*=\s*"\?\([^"]*\)"\?/\1/' || true)
  printf '[yellow-codex] Config: %s\n' "$CODEX_CONFIG"
  if [ -n "$codex_model" ]; then
    printf '[yellow-codex] Default model: %s\n' "$codex_model"
  fi
else
  printf '[yellow-codex] Config: default (no ~/.codex/config.toml)\n'
fi
```

### Step 4: Test Invocation

If codex is installed and auth is configured, run a quick test:

```bash
if command -v codex >/dev/null 2>&1; then
  test_output=$(timeout 15 codex exec --ephemeral -a never -s read-only -m gpt-5.4-mini "Reply with exactly: yellow-codex-setup-ok" -o /dev/stdout 2>/dev/null) || true
  if printf '%s' "$test_output" | grep -qi "yellow-codex-setup-ok"; then
    printf '[yellow-codex] Test invocation: ok\n'
  elif [ -n "$test_output" ]; then
    printf '[yellow-codex] Test invocation: response received (model accessible)\n'
  else
    printf '[yellow-codex] Test invocation: no response (check auth and network)\n' >&2
  fi
fi
```

### Step 5: Report Results

Display a summary table:

```text
yellow-codex Setup Results
─────────────────────────────
Prerequisites:  node [ok v22.x | missing] | jq [ok | missing (degraded)]
Codex CLI:      installed (vX.X.X) | not installed
Auth (API key): set | not set
Auth (OAuth):   authenticated | not configured
Config:         default | custom (~/.codex/config.toml)
Test:           ok | failed | skipped
─────────────────────────────
Setup complete. Run /codex:review to test a code review.
```

If any step had a warning, list warnings at the bottom.

## Error Handling

| Condition | Message | Action |
|---|---|---|
| `codex` not found (Step 0) | AskUserQuestion: install now? | Offer install or show manual instructions |
| `codex` below v0.118.0 (Step 0) | AskUserQuestion: upgrade now? | Offer upgrade |
| Install script fails (Step 0) | "codex installation failed" | Warn, continue to Step 1 |
| Node < 22 | "v22+ required for Codex CLI" | Warn, suggest standalone binary |
| No auth configured | "No authentication configured" | Show both auth methods |
| Test invocation fails | "no response (check auth and network)" | Warn, suggest re-auth |
