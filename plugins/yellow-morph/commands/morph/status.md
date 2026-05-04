---
name: morph:status
description: "Show Morph API health and MCP server state. Use when morph tools seem slow, to verify connectivity, or to check tool availability. Note: API health check consumes one API request (counts against rate limits)."
argument-hint: ''
allowed-tools:
  - Bash
  - Read
  - ToolSearch
---

# Morph Status

Show API health and MCP tool availability, classified as one of three states:

- **OFFLINE** — morph MCP tools are not visible to Claude Code. The server
  never started (no key configured, or it crashed at boot). Built-in
  Edit/Grep handle everything.
- **DEGRADED** — MCP tools are loaded, but the API health probe returns a
  non-200 status. Tools are callable but will fail at invocation time.
- **HEALTHY** — MCP tools loaded AND API responds 200.

## Workflow

### Step 1: Check MCP tool visibility (authoritative OFFLINE detection)

Call `ToolSearch` with query `"+morph edit_file"`. If
`mcp__plugin_yellow-morph_morph__edit_file` is NOT returned, the MCP server
did not start — the plugin is **OFFLINE**. Skip the API probe and report:

```text
yellow-morph Status: OFFLINE

MCP Tools
  mcp__plugin_yellow-morph_morph__edit_file       not loaded
  mcp__plugin_yellow-morph_morph__codebase_search not loaded

What to do:
  1. Confirm the plugin is enabled: `/plugin list`
  2. If enabled: the MCP server failed to start. Most likely cause is that
     the `userConfig.morph_api_key` prompt was never answered, or the stored
     value was cleared. Run `/morph:setup` to re-prompt.
  3. If the prompt does not fire on setup, disable and re-enable the plugin
     (`/plugin disable yellow-morph` then `/plugin enable yellow-morph`) —
     known Claude Code quirk (GitHub issue #39827).
  4. If userConfig is already set, check keychain/credentials permissions:
     `ls -l ~/.claude/.credentials.json` (should be 0600, owned by you).
```

If the tool IS visible, continue to Step 2.

### Step 2: Read the configured key source

```bash
printf '=== Environment ===\n'
[ -n "${MORPH_API_KEY:-}" ] && printf 'MORPH_API_KEY (shell):  set (fallback)\n' || printf 'MORPH_API_KEY (shell):  not set\n'
[ -n "${MORPH_WARP_GREP_TIMEOUT:-}" ] && printf 'MORPH_WARP_GREP_TIMEOUT: %s ms\n' "$MORPH_WARP_GREP_TIMEOUT" || printf 'MORPH_WARP_GREP_TIMEOUT: 30000 ms (default)\n'
```

The `userConfig.morph_api_key` value is stored in the system keychain or
`~/.claude/.credentials.json` and is not directly readable from shell — we
rely on MCP tool visibility (Step 1) to confirm it is set and accepted.

### Step 3: Probe API health

The shell env var may not be set even when the plugin is healthy (userConfig
supplies the key to the MCP server directly). Use either the shell env var
when present, or skip the API probe and rely on MCP tool-level health.

```bash
if [ -n "${MORPH_API_KEY:-}" ]; then
  HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' \
    --connect-timeout 5 --max-time 8 \
    -H "Authorization: Bearer ${MORPH_API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"model":"morph-v3-fast","messages":[{"role":"user","content":"ping"}],"max_tokens":1}' \
    https://api.morphllm.com/v1/chat/completions 2>/dev/null)
  CURL_EXIT=$?
  if [ "$CURL_EXIT" -ne 0 ]; then
    printf 'API status: UNREACHABLE (curl exit %d)\n' "$CURL_EXIT"
  else
    printf 'API status: %s\n' "$HTTP_CODE"
  fi
else
  printf 'API status: skipped (probe not possible — key is in keychain, not accessible to bash)\n'
fi
```

- **200**: API reachable and authenticated — **HEALTHY**
- **401**: API key invalid — **DEGRADED** (only reachable when `MORPH_API_KEY`
  is exported in the shell environment)
- **429**: Rate limit exceeded — credits may be exhausted — **DEGRADED** (only
  reachable when `MORPH_API_KEY` is exported in the shell environment)
- **UNREACHABLE / other**: **DEGRADED** (only reachable when `MORPH_API_KEY` is
  exported in the shell environment)
- **Skipped (userConfig-only)**: **HEALTHY (probe skipped — key in keychain,
  not accessible to bash)**. The status command cannot detect invalid keys,
  exhausted credits, or API outages for keychain-backed installs. To probe the
  API directly, temporarily export your key in the shell:
  `export MORPH_API_KEY=<your-key>` and re-run `/morph:status`.

### Step 4: Report

```text
yellow-morph Status: HEALTHY | DEGRADED | OFFLINE
======================================

Environment
  MORPH_API_KEY (shell)     set (fallback) | not set
  userConfig.morph_api_key  assumed set (MCP tools loaded) | unset (OFFLINE)
  MORPH_WARP_GREP_TIMEOUT   30000 ms

API
  Status                    200 (HEALTHY) | 401 (DEGRADED) | skipped (HEALTHY — probe skipped)

MCP Tools
  mcp__plugin_yellow-morph_morph__edit_file       available | not loaded
  mcp__plugin_yellow-morph_morph__codebase_search available | not loaded

Overall: HEALTHY | DEGRADED | OFFLINE
```

### Classification summary

| MCP tools | API probe                | State      |
| --------- | ------------------------ | ---------- |
| not loaded| (not run)                | OFFLINE    |
| loaded    | 200                      | HEALTHY    |
| loaded    | skipped (keychain path)  | HEALTHY (probe skipped) |
| loaded    | 401 / 429 / unreachable  | DEGRADED (shell env path only) |

For each state, print a "What to do" next-step block so the user has a
concrete action to take.
