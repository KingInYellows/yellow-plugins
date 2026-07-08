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

Verify `jq` (needed for usage counter increments) and `node` (needed to run
the bundled MCP proxy):

```bash
if command -v jq >/dev/null 2>&1; then
  printf '[yellow-composio] jq: ok (%s)\n' "$(jq --version 2>/dev/null)"
else
  printf '[yellow-composio] Warning: jq not found. Usage tracking will be degraded.\n'
  printf '  Install: brew install jq (macOS) or apt-get install jq (Linux)\n'
  printf '  Note: /composio:status requires jq and will exit without it.\n'
fi

if command -v node >/dev/null 2>&1; then
  node_ver=$(node --version 2>/dev/null)
  node_major=$(printf '%s' "$node_ver" | sed 's/^v//' | cut -d. -f1)
  if [ "${node_major:-0}" -ge 18 ]; then
    printf '[yellow-composio] node: ok (%s)\n' "$node_ver"
  else
    printf '[yellow-composio] node: TOO OLD (%s) -- required for the bundled MCP path only.\n' "$node_ver"
    printf '  The bundled proxy (bin/composio-proxy.mjs) calls the global fetch() API,\n'
    printf '  which needs Node 18+. Not needed for the Claude.ai-native or manual\n'
    printf '  "claude mcp add" prefixes. Upgrade from https://nodejs.org if you use the bundle.\n'
  fi
else
  printf '[yellow-composio] node: NOT FOUND -- required for the bundled MCP path only.\n'
  printf '  The bundled server runs "node bin/composio-proxy.mjs"; without node it\n'
  printf '  cannot start. Not needed for the Claude.ai-native or manual "claude mcp add"\n'
  printf '  prefix. Install Node.js 18+ from https://nodejs.org if you use the bundle.\n'
fi
```

Both are soft prerequisites -- setup continues without them. A missing or
too-old `node` only matters for the bundled MCP prefix (see Step 2 for what
it means when no tools are found).

### Step 2: Check Composio MCP tools

Use ToolSearch to discover Composio tools across all known prefixes:

```text
ToolSearch("COMPOSIO_SEARCH_TOOLS")
```

Three possible prefixes exist; in priority order:

1. `mcp__plugin_yellow-composio_composio-server__*` — bundled by this
   plugin (preferred, requires both `userConfig` values to be set AND
   `node` on PATH — the bundled server runs `node bin/composio-proxy.mjs`).
2. `mcp__claude_ai_composio__*` — Claude.ai native Composio integration
   (legacy, still supported; does not use the bundled wrapper or node).
3. `mcp__composio-server__*` — manual `claude mcp add` setup
   (legacy / migration path; does not use the bundled wrapper or node).

If ToolSearch returns at least one Composio tool, record which prefix is
active and proceed to Step 3.

If ToolSearch returns no Composio tools, the MCP is **OFFLINE** — no
Composio tools are registered in this session. For the bundled prefix this
means `bin/start-composio.sh` exited non-zero rather than launching the
proxy. The wrapper exits non-zero when either credential is empty (the
`userConfig` fields are NOT `required: true` — per
[claude-code#39827](https://github.com/anthropics/claude-code/issues/39827)
`required` does not block install, so the wrapper's hard exit is the actual
safeguard against registering an empty URL that would cascade-fail
`claude doctor` for the other MCPs), or when `node` is missing so the
wrapper's `exec node bin/composio-proxy.mjs` cannot run.

Run this diagnostic to determine which case applies. It is self-contained
-- do not rely on Step 1's variables, since each fenced block is a fresh
subprocess:

```bash
# Re-derive node presence (Step 1 ran in a separate subprocess). The bundled
# proxy calls global fetch(), which requires Node 18+; an old node on PATH
# is treated the same as a missing one. Scoped to the bundled prefix only --
# the Claude.ai-native and manual prefixes don't need node.
if command -v node >/dev/null 2>&1; then
  node_ver=$(node --version 2>/dev/null)
  node_major=$(printf '%s' "$node_ver" | sed 's/^v//' | cut -d. -f1)
  if [ "${node_major:-0}" -ge 18 ]; then
    printf 'node: ok (%s)\n' "$node_ver"
  else
    printf 'node: too_old (%s)\n' "$node_ver"
  fi
else
  printf 'node: MISSING\n'
fi

# Read this plugin's credential-status.json (written by the SessionStart
# hook). Path is $CLAUDE_PLUGIN_DATA when set, else the documented disk path.
STATUS_FILE="${CLAUDE_PLUGIN_DATA:-$HOME/.claude/plugins/data/yellow-composio}/credential-status.json"
if [ -f "$STATUS_FILE" ] && command -v jq >/dev/null 2>&1; then
  if jq -e . "$STATUS_FILE" >/dev/null 2>&1; then
    PRESENT=$(jq '[.credentials[]? | select(.present == true)] | length' "$STATUS_FILE" 2>/dev/null)
    TOTAL=$(jq '(.credentials // []) | length' "$STATUS_FILE" 2>/dev/null)
    printf 'credentials: %s/%s present (per credential-status.json)\n' "$PRESENT" "$TOTAL"
  else
    # Malformed JSON: never assume "absent" from a parse failure.
    printf 'credentials: status file present but unparseable -- status unknown\n'
  fi
elif [ -f "$STATUS_FILE" ]; then
  printf 'credentials: status file present but jq unavailable -- status unknown\n'
else
  # No status file yet (no SessionStart has fired, or the hook could not
  # write it). Fall back to shell-env presence only.
  if [ -n "${COMPOSIO_MCP_URL:-}" ] && [ -n "${COMPOSIO_API_KEY:-}" ]; then
    printf 'credentials: both shell env vars set (no status file yet)\n'
  else
    printf 'credentials: no status file and shell env vars unset -- likely unconfigured\n'
  fi
fi
```

Interpret the diagnostic and give remediation in this priority order (the
first matching case wins — later fixes cannot help until earlier ones are
resolved):

1. **node MISSING or too_old** — install or upgrade to Node.js 18+
   (https://nodejs.org). Nothing else can fix the bundled MCP path until
   `node` 18+ is on PATH: when missing, the wrapper's `exec node ...` line
   cannot run at all; when too old, `node bin/composio-proxy.mjs` starts but
   its calls to the global `fetch()` API fail. (If you use the
   Claude.ai-native or manual prefix instead, node is not required — skip to
   the Last resort block below.)
2. **status unknown** (the credentials line reads "status file present but
   unparseable" or "status file present but jq unavailable") — presence
   cannot be determined from a file that couldn't be read. Install jq
   (`brew install jq` or `apt-get install jq`) if that's the cause, or
   inspect `$STATUS_FILE` for corruption. If it persists, restart Claude
   Code and re-run /composio:setup so the SessionStart hook rewrites it.
3. **credentials not present** (status file shows fewer than 2 present, OR
   no status file and shell env vars unset) — the `userConfig` values were
   never set or were dismissed at the prompt. Re-fire the keychain-backed
   prompts, or export the shell env vars for dotfile-managed fleets:
       /plugin disable yellow-composio
       /plugin enable yellow-composio
     Answer "Composio MCP URL" and "Composio API key" when prompted. Tools
     then appear under mcp__plugin_yellow-composio_composio-server__*.
   To obtain values: sign up at https://composio.dev, copy your API key from
   https://app.composio.dev/settings, and generate a per-customer MCP URL
   via the dashboard or:
       npx @composio/mcp@latest setup YOUR_CUSTOMER_ID YOUR_APP_ID --client claude
   Fleet alternative: export COMPOSIO_MCP_URL and COMPOSIO_API_KEY in your
   shell — the wrapper honors them as a fallback.
4. **credentials present but tools still invisible** (status file shows both
   present AND node ok) — the bundled MCP registers at session start, so a
   restart is needed to pick up newly-configured credentials. Restart Claude
   Code, then re-run /composio:setup. If you recently set the URL, first
   confirm it begins with `https://` — the wrapper rejects a non-HTTPS URL
   (see the SessionStart warning), which also presents as "credentials
   present but tools invisible" and a restart alone will not fix it.
5. **status file missing but you just enabled the plugin** — no SessionStart
   has fired yet to write the status file. Restart Claude Code (or
   disable/enable) and re-run /composio:setup.

Report the state and the tailored remediation, e.g.:

```text
[yellow-composio] Composio MCP: OFFLINE (no tools registered this session).

<remediation for the first matching case above>
```

Last resort (manual `claude mcp add` — only if the bundled wrapper cannot
run on your setup, e.g. an unsupported Claude Code version):

```text
  claude mcp add --transport http composio-server "YOUR_MCP_URL" \
    --headers "X-API-Key:YOUR_COMPOSIO_API_KEY"

  Then restart Claude Code and re-run /composio:setup. Tools appear
  under mcp__composio-server__* in this configuration.

  Note: this manual path stores YOUR_COMPOSIO_API_KEY as plaintext in
  ~/.claude.json (not the OS keychain). If the bundled path later starts
  working, run `claude mcp remove composio-server` to drop the plaintext
  entry and re-rely on the keychain-backed bundle.
```

Stop here if no tools found.

### Step 3: Probe MCP connectivity

Step 2 confirmed Composio tools are discoverable via ToolSearch (the MCP is
not OFFLINE). Now call `COMPOSIO_SEARCH_TOOLS` directly to validate
authentication and network connectivity, distinguishing **HEALTHY** (tools
registered AND upstream responds) from **DEGRADED** (tools registered but
the upstream API fails).

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

If the call succeeds, the server is **HEALTHY** — proceed to Step 4.

If the call fails, the server is **DEGRADED** (tools are registered but the
upstream API is failing):
- **Connection error / timeout**: Report "DEGRADED: Composio MCP server is
  registered but unreachable. Check your network connectivity and MCP URL."
- **401 Unauthorized**: Report "DEGRADED: Composio API key is expired or
  invalid. Reconfigure your MCP server with a valid API key."
- **Other error**: Report "DEGRADED:" plus the error message and suggest
  re-running setup.

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
Prerequisites:  jq [ok|missing (degraded)], node [ok|missing (bundled MCP path unavailable)]
MCP Health:     [HEALTHY|DEGRADED|OFFLINE]
Connected Apps: app1, app2, ... (N active)
Usage Tracking: [initialized|existing counter (N executions this month)]
==============================
Setup complete. Run /composio:status to see usage dashboard.
```

## Idempotency

Re-running setup preserves existing usage data. It only resets the counter if
the user explicitly approves via AskUserQuestion when corruption is detected.
