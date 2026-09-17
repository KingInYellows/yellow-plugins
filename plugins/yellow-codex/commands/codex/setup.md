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
  curl -fsSL https://chatgpt.com/codex/install.sh | sh   (macOS/Linux)
  powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"   (Windows)
  brew install --cask codex        (macOS)
  https://github.com/openai/codex/releases (standalone binary)
Then re-run /codex:setup
```

If the user chooses **No**: show manual install instructions and continue.

**If codex IS found**, check the version meets the minimum (v0.140.0+):

```bash
MIN_CODEX_VERSION="0.140.0"
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
# Downloader (needed only when the install script has to fetch Codex —
# the CLI itself is a standalone binary with no Node.js dependency)
if command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1; then
  printf '[yellow-codex] downloader: ok (curl or wget)\n'
else
  printf '[yellow-codex] downloader: NOT FOUND (curl or wget needed to install Codex)\n' >&2
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

The Rust-based Codex CLI (v0.118+) stores its authentication in the OS
keyring (libsecret on Linux, Keychain on macOS, Credential Manager on
Windows) — NOT in `~/.codex/auth.json` (that path was the pre-Rust storage
format). The `codex login status` subcommand is the canonical, version-stable
probe; it reads from wherever the current CLI persists credentials and
returns a line like `Logged in using ChatGPT` or `Not logged in`.

```bash
if command -v codex >/dev/null 2>&1; then
  # Note: codex CLI writes login status to stderr (eprintln!), not stdout — capture both via 2>&1.
  # Capture exit code separately so probe failures (keyring locked, config corruption) are
  # distinguishable from the "Not logged in" unauthenticated case (both leave the grep unmatched).
  if login_status=$(codex login status 2>&1); then login_exit=0; else login_exit=$?; fi
  if [ "$login_exit" -eq 0 ] && printf '%s' "$login_status" | grep -qi '^logged in'; then
    # Do NOT echo $login_status — codex CLI may include API key fragments (e.g. "Logged in using an API key - sk-proj-***...")
    printf '[yellow-codex] codex login: authenticated\n'
  elif [ -f "${HOME}/.codex/auth.json" ]; then
    # Check legacy file before reporting probe error — pre-v0.118 CLIs may lack the `login status` subcommand entirely (non-zero exit) yet still be authenticated via auth.json.
    printf '[yellow-codex] codex login: legacy auth.json found (pre-v0.118 format)\n'
  elif [ "$login_exit" -ne 0 ]; then
    printf '[yellow-codex] codex login: probe error (codex login status exited %d; run it manually to diagnose)\n' "$login_exit" >&2
  else
    printf '[yellow-codex] codex login: not configured (run `codex login` to authenticate via ChatGPT)\n'
  fi
else
  printf '[yellow-codex] codex login: skipped (codex CLI not installed)\n'
fi
```

If neither method is configured:

```text
[yellow-codex] Warning: No authentication configured.
  Option 1: export OPENAI_API_KEY="sk-..." in ~/.zshrc
  Option 2: codex login (authenticates via ChatGPT, stored in OS keyring)
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
auth_ok=0
if [ -n "${OPENAI_API_KEY:-}" ]; then
  auth_ok=1
elif command -v codex >/dev/null 2>&1; then
  # Re-probe here because separate Bash tool calls do not share shell state.
  if login_status=$(codex login status 2>&1); then login_exit=0; else login_exit=$?; fi
  if [ "$login_exit" -eq 0 ] && printf '%s' "$login_status" | grep -qi '^logged in'; then
    auth_ok=1
  elif [ -f "${HOME}/.codex/auth.json" ]; then
    auth_ok=1
  fi
fi

if command -v codex >/dev/null 2>&1 && [ "$auth_ok" -eq 1 ]; then
  # Probe the same shape every real invocation in this plugin uses: when
  # CODEX_MODEL is exported (the override every real review/rescue/analysis
  # invocation passes), the probe exercises that model too, so a green test
  # actually certifies the production path instead of only the account
  # default. CODEX_SMOKE_MODEL overrides the probed model for this probe
  # only, without touching CODEX_MODEL (never a gpt-5.4* name — legacy,
  # rejected by ChatGPT-account auth). With neither set, no -m is passed and
  # codex resolves ~/.codex/config.toml then the account default, matching
  # an unconfigured production invocation. If the account rejects the
  # probed model, retry once without it. This call does not pass --json, so
  # the API error is on stderr. mktemp created the files, so `>|`: zsh
  # noclobber refuses a plain `>` onto an existing path.
  SETUP_ERR_FILE=$(mktemp /tmp/codex-setup-err-XXXXXX.txt)
  smoke_model="${CODEX_SMOKE_MODEL:-${CODEX_MODEL:-}}"
  if [ -n "${CODEX_SMOKE_MODEL:-}" ]; then
    smoke_model_source=CODEX_SMOKE_MODEL
  else
    smoke_model_source=CODEX_MODEL
  fi
  smoke_retried=0
  test_output=$(timeout 45 codex exec --ephemeral -c 'approval_policy="never"' -c 'mcp_servers={}' -s read-only ${smoke_model:+-m} ${smoke_model:+"$smoke_model"} "Reply with exactly: yellow-codex-setup-ok" -o /dev/stdout 2>| "$SETUP_ERR_FILE"); smoke_exit=$?
  if [ -n "$smoke_model" ] && [ "$smoke_exit" -ne 0 ] && grep -q "invalid_request_error" "$SETUP_ERR_FILE" 2>/dev/null; then
    printf '[yellow-codex] Test invocation: model %s (from %s) rejected for this account (HTTP 400); retrying with the account default\n' "$smoke_model" "$smoke_model_source"
    smoke_retried=1
    # The retry overwrites the capture: the branches below report only the
    # attempt that ran last (the original rejection was already printed).
    test_output=$(timeout 45 codex exec --ephemeral -c 'approval_policy="never"' -c 'mcp_servers={}' -s read-only "Reply with exactly: yellow-codex-setup-ok" -o /dev/stdout 2>| "$SETUP_ERR_FILE"); smoke_exit=$?
  fi
  smoke_result=failed
  if printf '%s' "$test_output" | grep -qi "yellow-codex-setup-ok"; then
    smoke_result=ok
    printf '[yellow-codex] Test invocation: ok\n'
  elif [ "$smoke_exit" -eq 124 ]; then
    printf '[yellow-codex] Test invocation: timed out after 45s (slow model or network) — re-run /codex:setup, or set CODEX_SMOKE_MODEL to a faster model\n' >&2
  elif [ -n "$test_output" ] && [ "$smoke_exit" -eq 0 ]; then
    smoke_result=ok
    printf '[yellow-codex] Test invocation: response received (model accessible)\n'
  elif grep -q "invalid_request_error" "$SETUP_ERR_FILE" 2>/dev/null; then
    # A 400 from whichever attempt ran last. Bounded excerpt: CLI stderr is
    # untrusted output, redacted with the same credential patterns as
    # codex-executor's diagnostic block before it reaches the terminal.
    if [ "$smoke_retried" -eq 1 ] || [ -z "$smoke_model" ]; then
      printf '[yellow-codex] Test invocation: the account default model was rejected (HTTP 400) — check the model key in ~/.codex/config.toml or your account entitlements:\n' >&2
    else
      printf '[yellow-codex] Test invocation: request rejected (HTTP 400) — set CODEX_SMOKE_MODEL to a model this account allows, or unset it:\n' >&2
    fi
    printf -- '--- begin codex-diagnostics (reference only) ---\n' >&2
    grep -m1 -o '"message":"[^"]*"' "$SETUP_ERR_FILE" 2>/dev/null | head -c 200 | awk '{
      line = NR
      # OpenAI project keys (must precede generic sk- pattern)
      gsub(/sk-proj-[a-zA-Z0-9_-]+/, "--- redacted credential at line " line " ---")
      # OpenAI / generic sk- API keys
      gsub(/sk-[a-zA-Z0-9_-]{20}[a-zA-Z0-9_-]*/, "--- redacted credential at line " line " ---")
      # GitHub tokens (ghp_, gho_, ghs_, ghu_)
      gsub(/gh[pous]_[A-Za-z0-9_]{36}[A-Za-z0-9_]*/, "--- redacted credential at line " line " ---")
      # GitHub fine-grained PATs
      gsub(/github_pat_[A-Za-z0-9_]{22}[A-Za-z0-9_]*/, "--- redacted credential at line " line " ---")
      # AWS access keys
      gsub(/AKIA[0-9A-Z]{16}/, "--- redacted credential at line " line " ---")
      # Bearer tokens in output
      gsub(/[Bb]earer [A-Za-z0-9_\.\-]{20}[A-Za-z0-9_\.\-]*/, "--- redacted credential at line " line " ---")
      # Authorization headers with token values
      gsub(/[Aa]uthorization:[[:space:]]*[^ ]{20}[^ ]*/, "--- redacted credential at line " line " ---")
      # Generic private key blocks
      gsub(/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "--- redacted credential at line " line " ---")
      print
    }' >&2
    printf '\n' >&2
    printf -- '--- end codex-diagnostics ---\n' >&2
  elif grep -qE "unexpected argument|invalid value|unrecognized subcommand|required arguments" "$SETUP_ERR_FILE" 2>/dev/null; then
    printf '[yellow-codex] Test invocation: CLI argument parse error (flag drift?):\n' >&2
    grep -m2 -E "^error:" "$SETUP_ERR_FILE" 2>/dev/null >&2
  else
    printf '[yellow-codex] Test invocation: no response (check auth and network)\n' >&2
  fi
  printf '[yellow-codex] smoke_result=%s\n' "$smoke_result"
  rm -f "$SETUP_ERR_FILE"
else
  printf '[yellow-codex] Test invocation: skipped (codex CLI or authentication unavailable)\n'
fi
```

### Step 5: Report Results

Display a summary table:

```text
yellow-codex Setup Results
─────────────────────────────
Prerequisites:  downloader [ok | missing] | jq [ok | missing (degraded)]
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
| `codex` below v0.140.0 (Step 0) | AskUserQuestion: upgrade now? | Offer upgrade |
| Install script fails (Step 0) | "codex installation failed" | Warn, continue to Step 1 |
| No curl/wget | "curl or wget needed to install Codex" | Warn, suggest brew cask or the GitHub release binary |
| No auth configured | "No authentication configured" | Show both auth methods |
| Test invocation parse error (Step 4, parse error on stderr) | "CLI argument parse error (flag drift?)" | Report clap error line |
| Smoke model rejected (Step 4, `CODEX_SMOKE_MODEL` or `CODEX_MODEL` set) | "model X (from CODEX_SMOKE_MODEL/CODEX_MODEL) rejected for this account (HTTP 400); retrying with the account default" | Automatic retry without `-m` |
| Test invocation HTTP 400 (Step 4) | "the account default model was rejected" / "request rejected (HTTP 400)" | Fix `model` in `~/.codex/config.toml` / set or unset `CODEX_SMOKE_MODEL` |
| Test invocation timed out (Step 4, exit 124) | "timed out after 45s" | Re-run; try a faster `CODEX_SMOKE_MODEL` |
| Test invocation fails | "no response (check auth and network)" | Warn, suggest re-auth |
