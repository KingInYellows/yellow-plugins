---
name: morph:setup
description: "Check prerequisites and configure Morph API key. Use when first installing the plugin, when morph tools fail, or to verify API connectivity."
argument-hint: ''
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
  - ToolSearch
---

# Set Up yellow-morph

Verify prerequisites, confirm a Morph API key is configured (via plugin
`userConfig` — the recommended path — or shell `MORPH_API_KEY` as fallback),
pre-install `@morphllm/morphmcp` into the plugin data directory so the first
tool call is instant, and verify API connectivity.

## Workflow

### Step 1: Check Prerequisites

Run all prerequisite checks in a single Bash call:

```bash
printf '=== Prerequisites ===\n'
command -v rg   >/dev/null 2>&1 && printf 'ripgrep (rg):  OK\n' || printf 'ripgrep (rg):  NOT FOUND\n'
command -v node >/dev/null 2>&1 && printf 'node:          OK (%s)\n' "$(node --version 2>/dev/null)" || printf 'node:          NOT FOUND\n'
command -v npm  >/dev/null 2>&1 && printf 'npm:           OK (%s)\n' "$(npm --version 2>/dev/null)" || printf 'npm:           NOT FOUND\n'
printf '\n=== Environment ===\n'
[ -n "${MORPH_API_KEY:-}" ] && printf '%-28s set — fallback path\n' 'MORPH_API_KEY (shell):' || printf '%-28s not set\n' 'MORPH_API_KEY (shell):'
```

Collect **all** failures before stopping — report them together.

Stop conditions (after reporting all):

- `rg` not found: "ripgrep is required for WarpGrep. Install from
  https://github.com/BurntSushi/ripgrep#installation"
- `node` not found: "Node.js 22.22.0 or later is required. Install from
  https://nodejs.org/"
- `npm` not found: "npm is required (bundled with Node.js). Verify Node.js
  installation."
- Node <22.22.0: "Node.js 22.22.0 or later is required. Current: vX.Y.Z. Please
  upgrade."

Shell `MORPH_API_KEY` not set is **not** a failure — the `userConfig` path
(recommended) stores the key in the system keychain instead.

### Step 2: Verify Morph API Key is Configured

The yellow-morph plugin reads its API key from `userConfig.morph_api_key`
(prompted at plugin-enable time) with shell `MORPH_API_KEY` as a power-user
fallback.

Use `ToolSearch` with query `"+morph edit_file"` to check whether the MCP
server has started. If `mcp__plugin_yellow-morph_morph__edit_file` is
visible, the key is configured and accepted — skip to Step 3.

If the tool is NOT visible, the MCP server did not start. Ask via
AskUserQuestion: "No Morph API key is configured. How would you like to
provide one?"

- **Answer the userConfig prompt (recommended)** → "Run
  `/plugin disable yellow-morph` then `/plugin enable yellow-morph`.
  Claude Code will prompt you for the key; it is stored in the system
  keychain (or `~/.claude/.credentials.json` at 0600 perms on Linux). No
  shell export and no Claude Code restart are required — the MCP server
  picks up the new key when it starts on the next tool invocation. Get a
  key at https://morphllm.com (free tier: 250K credits/month)."
- **Export as shell env var (fallback, power users)** → "Add
  `export MORPH_API_KEY=your-key-here` to `~/.zshrc` or `~/.bashrc`, then
  **restart Claude Code**. This path is less ergonomic because it requires
  the restart, but it continues to work for users who prefer shell-level
  secrets management."
- **Skip (I just want to check prereqs)** → Stop here. Privacy note
  applies regardless: "Note: Morph tools send code to Morph's API servers.
  Free/Starter tiers retain data for 90 days. See
  https://morphllm.com/privacy"

### Step 3: Pre-install morphmcp into the plugin data directory

The plugin ships a wrapper script that installs `@morphllm/morphmcp` on
first invocation, but running the install during setup gives the user a
visible progress indicator and surfaces install errors immediately rather
than hanging the first tool call.

```bash
DATA_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.claude/plugins/data/yellow-morph}"
ROOT_DIR="${CLAUDE_PLUGIN_ROOT:?CLAUDE_PLUGIN_ROOT must be set}"

mkdir -p "$DATA_DIR"
cp "${ROOT_DIR}/package.json" "${DATA_DIR}/package.json"
cp "${ROOT_DIR}/package-lock.json" "${DATA_DIR}/package-lock.json"
# Use `npm ci` (not `npm install`) to match the wrapper and hook — this
# enforces the committed lockfile so the same transitive deps land here,
# in SessionStart, and on first tool invocation.
(cd "$DATA_DIR" && env -u MORPH_API_KEY npm ci --no-audit --no-fund --loglevel=error) 2>&1
```

On success: "morphmcp installed to ${DATA_DIR}/node_modules. First tool
call will be instant."

Handle install failures with actionable messages:

- **Permission error writing ${DATA_DIR}**: "Cannot write to plugin data
  directory. Check permissions: `ls -ld ${DATA_DIR}`."
- **npm ENOSPC (disk full)**: "Disk full. Free space under ${DATA_DIR} and
  retry."
- **npm ECONNREFUSED / 403**: "Cannot reach the npm registry. Check
  network / proxy settings (HTTP_PROXY, HTTPS_PROXY)."
- **Other npm errors**: print the tail of npm output, suggest re-running
  `/morph:setup` after fixing, and continue — the SessionStart hook and
  wrapper script will retry on next session.

### Step 4: Verify API Connectivity (optional — skipped without shell env)

If shell `MORPH_API_KEY` is set, test connectivity:

```bash
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' \
  --connect-timeout 5 --max-time 10 \
  -H "Authorization: Bearer ${MORPH_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"model":"morph-v3-fast","messages":[{"role":"user","content":"test"}],"max_tokens":1}' \
  https://api.morphllm.com/v1/chat/completions 2>/dev/null)
CURL_EXIT=$?
if [ "$CURL_EXIT" -ne 0 ]; then
  printf 'API response: UNREACHABLE (curl exit %d)\n' "$CURL_EXIT"
else
  printf 'API response: %s\n' "$HTTP_CODE"
fi
```

- **200**: API key valid.
- **401**: "API key is invalid. Check your MORPH_API_KEY value." Stop.
- **403**: "API key is forbidden. Your account may be suspended." Stop.
- **000 or empty**: "Cannot reach Morph API. Check network connectivity to
  api.morphllm.com." Stop.
- **429**: "Rate limit exceeded. You may have exhausted your free tier
  credits." Warn, continue.

If shell `MORPH_API_KEY` is not set but the MCP tool was visible in Step 2,
skip this step — the userConfig key is not readable from the shell.
Connectivity is implicitly verified by the MCP server having started with
tools exposed.

### Step 5: Report

Display a summary of all checks. Include a privacy note:

```text
Privacy: Code is sent to api.morphllm.com. Free/Starter retains data 90 days.
         Enterprise offers zero-data-retention (ZDR). See https://morphllm.com/privacy
```

Report overall status as PASS or FAIL based on the checks above.
