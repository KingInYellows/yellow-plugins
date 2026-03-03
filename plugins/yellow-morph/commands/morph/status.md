---
name: morph:status
description: "Show Morph API health and MCP server state. Use when morph tools
  seem slow, to verify connectivity, or to check tool availability. Note: API
  health check consumes one API request (counts against rate limits)."
argument-hint: ''
allowed-tools:
  - Bash
  - Read
  - ToolSearch
---

# Morph Status

Show API health and MCP tool availability.

## Workflow

### Step 1: Check Environment

```bash
printf '=== Environment ===\n'
[ -n "${MORPH_API_KEY:-}" ] && printf 'MORPH_API_KEY:  set\n' || printf 'MORPH_API_KEY:  NOT SET\n'
[ -n "${MORPH_WARP_GREP_TIMEOUT:-}" ] && printf 'MORPH_WARP_GREP_TIMEOUT: %s ms\n' "$MORPH_WARP_GREP_TIMEOUT" || printf 'MORPH_WARP_GREP_TIMEOUT: 30000 ms (default)\n'
```

If `MORPH_API_KEY` is not set: report "MORPH_API_KEY not set. Run `/morph:setup`
to configure." and stop.

### Step 2: Check API Health

```bash
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
```

- **200**: API reachable and authenticated
- **401**: "API key invalid"
- **429**: "Rate limit exceeded — credits may be exhausted"
- **Other**: "API unreachable (HTTP $HTTP_CODE)"

### Step 3: Check MCP Tool Availability

Use ToolSearch to check if morph MCP tools are loaded:

```bash
ToolSearch query: "+morph edit"
```

Report whether `mcp__plugin_yellow-morph_morph__edit_file` and `mcp__plugin_yellow-morph_morph__warpgrep_codebase_search` are available.

### Step 4: Report

```text
yellow-morph Status
===================

Environment
  MORPH_API_KEY         set
  MORPH_WARP_GREP_TIMEOUT  30000 ms

API
  Status                OK (200)

MCP Tools
  mcp__plugin_yellow-morph_morph__edit_file             available | not loaded
  mcp__plugin_yellow-morph_morph__warpgrep_codebase_search  available | not loaded

Overall: HEALTHY | DEGRADED | OFFLINE
```
