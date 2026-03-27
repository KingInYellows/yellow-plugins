---
name: composio:setup
description: "Validate Composio MCP availability, check connections, and initialize local usage tracking. Use when first installing the plugin, after MCP config changes, or when composio tools stop working."
argument-hint: ''
allowed-tools:
  - Bash
  - AskUserQuestion
  - ToolSearch
  - Read
  - Write
---

# Set Up yellow-composio

Validate Composio MCP server availability, check connected apps, and initialize
the local usage tracking counter.

## Workflow

### Step 1: Check prerequisites

Verify `jq` is installed (needed for usage counter increments):

```bash
if command -v jq >/dev/null 2>&1; then
  printf '[yellow-composio] jq: ok (%s)\n' "$(jq --version 2>/dev/null)"
else
  printf '[yellow-composio] Warning: jq not found. Usage tracking will be degraded.\n'
  printf '  Install: brew install jq (macOS) or apt-get install jq (Linux)\n'
fi
```

This is a soft prerequisite -- setup continues without jq.

### Step 2: Check Composio MCP tools

Use ToolSearch to discover Composio tools:

```text
ToolSearch("COMPOSIO_REMOTE_WORKBENCH")
```

If ToolSearch returns no Composio tools, report:

```text
[yellow-composio] Composio MCP server not found.

To configure Composio for Claude Code:

  1. Sign up at https://composio.dev and get your API key
  2. Generate an MCP URL via the Composio dashboard or SDK
  3. Add to Claude Code:

     claude mcp add --transport http composio-server "YOUR_MCP_URL" \
       --headers "X-API-Key:YOUR_COMPOSIO_API_KEY"

  4. Restart Claude Code and re-run /composio:setup

Alternative (npx):
  npx @composio/mcp@latest setup "<customer_id>" "<app_id>" --client claude
```

Stop here if no tools found.

### Step 3: Probe MCP connectivity

Step 2 confirmed Composio tools are discoverable via ToolSearch. Now call
`COMPOSIO_SEARCH_TOOLS` directly to validate authentication and network
connectivity.

**Note**: The fully-qualified MCP tool name varies by configuration
(e.g., `mcp__claude_ai_composio__COMPOSIO_SEARCH_TOOLS` for native
integrations, `mcp__composio-server__COMPOSIO_SEARCH_TOOLS` for manual
`.mcp.json` setups). Use the exact tool name returned by ToolSearch in Step 2.

```text
COMPOSIO_SEARCH_TOOLS({
  queries: [{ use_case: "list available toolkits" }],
  session: { generate_id: true }
})
```

If the call fails:
- **Connection error / timeout**: Report "Composio MCP server is registered but
  unreachable. Check your network connectivity and MCP URL."
- **401 Unauthorized**: Report "Composio API key is expired or invalid.
  Reconfigure your MCP server with a valid API key."
- **Other error**: Report the error message and suggest re-running setup.

Stop on any error.

### Step 4: Check connected apps

Parse the `toolkit_connection_statuses` array from the Step 3 response. For
each toolkit, report its connection status:

```text
Connected Apps:
  github:         ACTIVE
  slack:          ACTIVE
  linear:         ACTIVE
  gmail:          INACTIVE (run COMPOSIO_MANAGE_CONNECTIONS to authenticate)
```

Count the number of ACTIVE connections. If zero, warn that no apps are
connected and suggest using `COMPOSIO_MANAGE_CONNECTIONS` to set up OAuth.

Also extract and store the `session.id` from the response -- note it for
reference but it is session-scoped (not persisted).

### Step 5: Initialize usage counter

Check if `.claude/composio-usage.json` exists:

```bash
USAGE_FILE=".claude/composio-usage.json"
if [ -f "$USAGE_FILE" ]; then
  # Validate existing file is parseable JSON with version field
  if ! command -v jq >/dev/null 2>&1; then
    printf '[yellow-composio] Usage tracking: existing counter found (jq not available, skipping validation)\n'
  elif jq -e '.version' "$USAGE_FILE" >/dev/null 2>&1; then
    printf '[yellow-composio] Usage tracking: existing counter found\n'
  else
    printf '[yellow-composio] Warning: usage counter is corrupted\n'
  fi
else
  printf '[yellow-composio] Usage tracking: not initialized\n'
fi
```

If the file does not exist, create it:

```bash
mkdir -p .claude
MONTH=$(date -u +%Y-%m)
TODAY=$(date -u +%Y-%m-%d)
cat > ".claude/composio-usage.json" << JSONEOF
{
  "version": 1,
  "created": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)",
  "updated": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)",
  "thresholds": {
    "daily_warn": 200,
    "monthly_warn": 8000
  },
  "periods": {
    "$MONTH": {
      "total": 0,
      "by_tool": {},
      "by_day": {
        "$TODAY": 0
      }
    }
  }
}
JSONEOF
printf '[yellow-composio] Usage counter initialized at .claude/composio-usage.json\n'
```

If the file exists but is corrupted (not valid JSON or missing `version`
field), use AskUserQuestion:

> "Usage counter at .claude/composio-usage.json is corrupted. Reset it?"
>
> Options: "Yes, reset counter" / "No, I'll fix it manually"

If reset: delete the file and re-create with the template above.

### Step 6: Report results

Display summary:

```text
yellow-composio Setup Results
==============================
Prerequisites:  jq [ok|missing (degraded)]
MCP Server:     connected (N meta tools available)
Connected Apps: app1, app2, ... (N active)
Usage Tracking: [initialized|existing counter (N executions this month)]
==============================
Setup complete. Run /composio:status to see usage dashboard.
```

## Idempotency

Re-running setup preserves existing usage data. It only resets the counter if
the user explicitly approves via AskUserQuestion when corruption is detected.
