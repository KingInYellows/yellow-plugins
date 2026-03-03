---
name: morph:status
description: "Show Morph API health and MCP server state. Use when morph tools
  seem slow, to verify connectivity, or to check tool availability."
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
[ -n "${MORPH_WARP_GREP_TIMEOUT:-}" ] && printf 'WARP_GREP_TIMEOUT: %s ms\n' "$MORPH_WARP_GREP_TIMEOUT" || printf 'WARP_GREP_TIMEOUT: 30000 ms (default)\n'
```

If `MORPH_API_KEY` is not set: report "MORPH_API_KEY not set. Run `/morph:setup`
to configure." and stop.

### Step 2: Check API Health

```bash
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' \
  --connect-timeout 5 --max-time 10 \
  -H "Authorization: Bearer ${MORPH_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"model":"morph-v3-fast","messages":[{"role":"user","content":"ping"}],"max_tokens":1}' \
  https://api.morphllm.com/v1/chat/completions 2>/dev/null)
printf 'API status: %s\n' "$HTTP_CODE"
```

- **200**: API reachable and authenticated
- **401**: "API key invalid"
- **429**: "Rate limit exceeded — credits may be exhausted"
- **Other**: "API unreachable (HTTP $CODE)"

### Step 3: Check MCP Tool Availability

Use ToolSearch to check if morph MCP tools are loaded:

```
ToolSearch query: "+morph edit"
```

Report whether `edit_file` and `warpgrep_codebase_search` are available.

### Step 4: Report

```text
yellow-morph Status
===================

Environment
  MORPH_API_KEY         set
  WARP_GREP_TIMEOUT     30000 ms

API
  Status                OK (200)

MCP Tools
  edit_file             available | not loaded
  warpgrep_codebase_search  available | not loaded

Overall: HEALTHY | DEGRADED | OFFLINE
```
