---
name: morph:setup
description: "Check prerequisites and configure Morph API key. Use when first
  installing the plugin, when morph tools fail, or to verify API connectivity."
argument-hint: ''
allowed-tools:
  - Bash
  - Read
  - Write
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
[ -n "${MORPH_API_KEY:-}" ] && printf '%-20s set (%s...)\n' 'MORPH_API_KEY:' "$(printf '%s' "$MORPH_API_KEY" | head -c 8)" || printf '%-20s NOT SET\n' 'MORPH_API_KEY:'
```

Collect **all** failures before stopping — report them together.

Stop conditions (after reporting all):
- `rg` not found: "ripgrep is required for WarpGrep. Install from
  https://github.com/BurntSushi/ripgrep#installation"
- `node` not found: "Node.js 18+ is required. Install from https://nodejs.org/"
- `npx` not found: "npx is required (bundled with Node.js). Verify Node.js
  installation."

Node version check: If node version is below 18, warn: "Node.js 18+ is
recommended. Current: vX.Y.Z"

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
  -H "Authorization: Bearer ${MORPH_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"model":"morph-v3-fast","messages":[{"role":"user","content":"test"}],"max_tokens":1}' \
  https://api.morphllm.com/v1/chat/completions 2>/dev/null)
printf 'API response: %s\n' "$HTTP_CODE"
```

- **200**: API key valid. Continue to Step 4.
- **401**: "API key is invalid. Check your MORPH_API_KEY value." Stop.
- **403**: "API key is forbidden. Your account may be suspended." Stop.
- **000 or empty**: "Cannot reach Morph API. Check network connectivity to
  api.morphllm.com." Stop.
- **429**: "Rate limit exceeded. You may have exhausted your free tier credits."
  Warn, continue.

### Step 4: Verify MCP Package

```bash
npm view @morphllm/morphmcp version 2>/dev/null || echo "NPM_LOOKUP_FAILED"
```

- **Version output**: Package accessible. Record version and compare with
  pinned version in plugin.json.
- **NPM_LOOKUP_FAILED**: "Cannot query npm for @morphllm/morphmcp. Check npm
  registry access." Warn, continue.

### Step 5: Report

```text
yellow-morph Setup Check
========================

Prerequisites
  ripgrep (rg)   OK
  node           OK (v22.x.x)
  npx            OK

API
  MORPH_API_KEY   set (morph-k_...)
  API status      OK (authenticated)
  MCP package     @morphllm/morphmcp@0.8.110 (pinned in plugin.json)

Privacy
  Data retention: 90 days (free/starter) | ZDR available (enterprise)
  Code is sent to api.morphllm.com for processing

Overall: PASS
```

Ask via AskUserQuestion: "Setup complete. What would you like to do next?"
Options: "Test morph tools" (suggest a sample edit_file and warpgrep call),
"Check status" (`/morph:status`), "Done".

## Error Handling

| Error | Message | Action |
|---|---|---|
| `rg` not found | "Install ripgrep: https://github.com/BurntSushi/ripgrep" | Collect, stop |
| `node` not found | "Install Node.js 18+: https://nodejs.org/" | Collect, stop |
| `npx` not found | "npx required (bundled with Node.js)" | Collect, stop |
| Node <18 | "Node.js 18+ recommended. Current: vX.Y.Z" | Warn, continue |
| `MORPH_API_KEY` not set | Prompt for key or signup | Guided flow, stop |
| API key invalid (401) | "API key is invalid" | Stop |
| API forbidden (403) | "Account may be suspended" | Stop |
| Network error (000) | "Cannot reach api.morphllm.com" | Stop |
| Rate limit (429) | "Rate limit exceeded" | Warn, continue |
| npm lookup failed | "Cannot query npm registry" | Warn, continue |
