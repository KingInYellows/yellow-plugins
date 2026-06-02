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

Use ToolSearch to discover Composio tools across all known prefixes:

```text
ToolSearch("COMPOSIO_SEARCH_TOOLS")
```

Three possible prefixes exist; in priority order:

1. `mcp__plugin_yellow-composio_composio-server__*` — bundled by this
   plugin (preferred, requires both `userConfig` values to be set).
2. `mcp__claude_ai_composio__*` — Claude.ai native Composio integration
   (legacy, still supported).
3. `mcp__composio-server__*` — manual `claude mcp add` setup
   (legacy / migration path).

If ToolSearch returns at least one Composio tool, record which prefix is
active and proceed to Step 3.

If ToolSearch returns no Composio tools, the bundled MCP did not start.
The `userConfig` fields are NOT marked `required: true` — per
[claude-code#39827](https://github.com/anthropics/claude-code/issues/39827)
the `required` flag does not block install; it only produces a
confusing MCP-startup error. The actual safeguard is the
`bin/start-composio.sh` wrapper, which exits non-zero when either value is
empty, so the bundled MCP never registers with an empty URL (which would
cascade-fail `claude doctor` for the other MCPs). Likely causes:

- The `userConfig` values were never set, or were dismissed at the prompt.
  Fix: `/plugin disable yellow-composio` then `/plugin enable
  yellow-composio` to re-fire the prompts — or set `COMPOSIO_MCP_URL` /
  `COMPOSIO_API_KEY` in your shell env, which the wrapper honors as a
  fallback.
- `${user_config.*}` substitution in `mcpServers.url`/`headers` is not
  supported by your Claude Code version (this plugin is among the first
  in the marketplace to use that pattern; see the Fallback below).
- The MCP URL is reachable but the API key is invalid (401) — see
  Step 3 connectivity probe.

Report:

```text
[yellow-composio] No Composio MCP tools found in this session.

Recommended (bundled MCP server):

  1. Sign up at https://composio.dev and copy your API key from
     https://app.composio.dev/settings.
  2. Generate a per-customer MCP URL via the Composio dashboard or:
       npx @composio/mcp@latest setup YOUR_CUSTOMER_ID YOUR_APP_ID --client claude
  3. Re-prompt the plugin's userConfig:
       /plugin disable yellow-composio
       /plugin enable yellow-composio
     Answer "Composio MCP URL" and "Composio API key" when prompted.
     Tools appear under mcp__plugin_yellow-composio_composio-server__*.
  4. Re-run /composio:setup to verify.

Fallback (manual claude mcp add — for older Claude Code versions or if
the bundled MCP fails to start, e.g., because user_config substitution
in `mcpServers.<name>.url` is not resolved by your harness version):

  claude mcp add --transport http composio-server "YOUR_MCP_URL" \
    --headers "X-API-Key:YOUR_COMPOSIO_API_KEY"

  Then restart Claude Code and re-run /composio:setup. Tools appear
  under mcp__composio-server__* in this configuration.

  Note: this manual path stores YOUR_COMPOSIO_API_KEY as plaintext in
  ~/.claude.json (not the OS keychain). If the bundled path later starts
  working on your version, run `claude mcp remove composio-server` to
  drop the plaintext entry and re-rely on the keychain-backed bundle.
```

Stop here if no tools found.

### Step 3: Probe MCP connectivity

Step 2 confirmed Composio tools are discoverable via ToolSearch. Now call
`COMPOSIO_SEARCH_TOOLS` directly to validate authentication and network
connectivity.

**Note**: The fully-qualified MCP tool name varies by configuration:

- `mcp__plugin_yellow-composio_composio-server__COMPOSIO_SEARCH_TOOLS` —
  bundled MCP from this plugin (preferred).
- `mcp__claude_ai_composio__COMPOSIO_SEARCH_TOOLS` — Claude.ai native
  Composio integration.
- `mcp__composio-server__COMPOSIO_SEARCH_TOOLS` — manual `claude mcp add`
  setup.

Use the exact tool name returned by ToolSearch in Step 2. Step 3 should
exercise the active prefix and proceed even if multiple prefixes are
visible (it is normal for users mid-migration to have both the bundled
and the legacy MCP registered until they remove the manual entry).

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
cat > ".claude/composio-usage.json" << __EOF_COMPOSIO_USAGE__
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
__EOF_COMPOSIO_USAGE__
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
