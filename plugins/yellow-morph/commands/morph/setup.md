---
name: morph:setup
description: "Check prerequisites and configure Morph API key. Use when first
  installing the plugin, when morph tools fail, or to verify API connectivity."
argument-hint: ''
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
---

# Set Up yellow-morph

Verify prerequisites, configure MORPH_API_KEY, and verify MCP server
connectivity.

## Workflow

### Step 1: Check Prerequisites

Run all prerequisite checks in a single Bash call:

```bash
printf '=== Prerequisites ===\n'
command -v rg   >/dev/null 2>&1 && printf 'ripgrep (rg):  OK\n' || printf 'ripgrep (rg):  NOT FOUND\n'
command -v node >/dev/null 2>&1 && printf 'node:          OK (%s)\n' "$(node --version 2>/dev/null)" || printf 'node:          NOT FOUND\n'
command -v npx  >/dev/null 2>&1 && printf 'npx:           OK\n' || printf 'npx:           NOT FOUND\n'
printf '\n=== Environment ===\n'
[ -n "${MORPH_API_KEY:-}" ] && printf '%-20s set (%s...)\n' 'MORPH_API_KEY:' "$(printf '%s' "$MORPH_API_KEY" | head -c 4)" || printf '%-20s NOT SET\n' 'MORPH_API_KEY:'
```

Collect **all** failures before stopping — report them together.

Stop conditions (after reporting all):
- `rg` not found: "ripgrep is required for WarpGrep. Install from
  https://github.com/BurntSushi/ripgrep#installation"
- `node` not found: "Node.js 18+ is required. Install from https://nodejs.org/"
- `npx` not found: "npx is required (bundled with Node.js). Verify Node.js
  installation."
- Node <18: "Node.js 18+ is required. Current: vX.Y.Z. Please upgrade."

Node version check: If node version is below 18, stop with: "Node.js 18+ is
required. Current: vX.Y.Z. Please upgrade Node.js from https://nodejs.org/,
then re-run /morph:setup."

`MORPH_API_KEY` not set is a warning, not a stop — continue to Step 2.

### Step 2: API Key Configuration

If `MORPH_API_KEY` is not set:

Ask via AskUserQuestion: "MORPH_API_KEY is not set. Do you have a Morph API
key?"

- **Yes, I have one** → "Please set it in your shell profile and restart Claude
  Code:
  ```bash
  echo 'export MORPH_API_KEY=your-key-here' >> ~/.zshrc  # or ~/.bashrc
  source ~/.zshrc
  ```
  Then re-run `/morph:setup` to verify."
  Show info: "Get a key at https://morphllm.com — free tier includes 250K
  credits/month."
  Stop here (cannot verify without key).

- **No, I need one** → "Sign up at https://morphllm.com to get an API key.
  Free tier includes 250K credits/month (200 requests/month)."
  Show privacy note: "Note: Morph tools send code to Morph's API servers.
  Free/Starter tiers retain data for 90 days. See https://morphllm.com/privacy"
  Stop here.

If `MORPH_API_KEY` is set: continue to Step 3.

### Step 3: Verify API Connectivity

Test API key with a minimal completion call:

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

- **200**: API key valid. Continue to Step 4.
- **401**: "API key is invalid. Check your MORPH_API_KEY value." Stop.
- **403**: "API key is forbidden. Your account may be suspended." Stop.
- **000 or empty**: "Cannot reach Morph API. Check network connectivity to
  api.morphllm.com." Stop.
- **429**: "Rate limit exceeded. You may have exhausted your free tier credits."
  Warn, continue.

### Step 4: Verify MCP Package

Check that the MCP package is accessible from the npm registry:

```bash
npm view @morphllm/morphmcp@0.8.110 version 2>/dev/null || echo "NPM_LOOKUP_FAILED"
```

- Version output (e.g., `0.8.110`): Package accessible. Continue to Step 5.
- `NPM_LOOKUP_FAILED`: "Cannot query npm registry for @morphllm/morphmcp. Check
  npm access." Warn, continue.

### Step 5: Report

Display a summary of all checks. Include a privacy note:

```text
Privacy: Code is sent to api.morphllm.com. Free/Starter retains data 90 days.
         Enterprise offers zero-data-retention (ZDR). See https://morphllm.com/privacy
```

Report overall status as PASS or FAIL based on the checks above.
