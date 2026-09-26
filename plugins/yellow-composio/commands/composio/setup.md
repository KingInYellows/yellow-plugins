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

Verify `jq` (needed for usage counter increments). The bundled MCP server
is native HTTP and does not need Node.

```bash
if command -v jq >/dev/null 2>&1; then
  printf '[yellow-composio] jq: ok (%s)\n' "$(jq --version 2>/dev/null)"
else
  printf '[yellow-composio] Warning: jq not found. Usage tracking will be degraded.\n'
  printf '  Install: brew install jq (macOS) or apt-get install jq (Linux)\n'
  printf '  Note: /composio:status requires jq and will exit without it.\n'
fi
```

`jq` is a soft prerequisite -- setup continues without it.

### Step 2: Check Composio MCP tools

Use ToolSearch to discover Composio tools across all known prefixes:

```text
ToolSearch("COMPOSIO_SEARCH_TOOLS")
```

Three possible prefixes exist; in priority order:

1. `mcp__plugin_yellow-composio_composio-server__*` — bundled by this
   plugin (preferred). Native HTTP at `https://connect.composio.dev/mcp`.
   Claude Code runs the browser OAuth flow. No URL prompt and no API key.
2. `mcp__claude_ai_composio__*` — Claude.ai native Composio integration
   (legacy, still supported).
3. `mcp__composio-server__*` — manual `claude mcp add` setup
   (legacy / headless path).

If ToolSearch returns at least one Composio tool, record which prefix is
active and proceed to Step 3. If the only prefix visible is
`mcp__claude_ai_composio__*`, also record `bundled: unauthenticated` —
the plugin's own server has not finished OAuth. Setup still proceeds, and
Step 6 reports it.

If ToolSearch returns no Composio tools, the MCP is **OFFLINE**. The
bundled server does not start until Claude Code finishes OAuth. Only in
this branch, detect WSL — the browser's OAuth callback to a random
`localhost` port can fail to reach a WSL2 NAT guest:

```bash
case "$(uname -r)" in
  *microsoft-standard*|*WSL2*) wsl=wsl2 ;;
  *[Mm]icrosoft*) wsl=wsl1 ;;
  *) wsl=no ;;
esac
net=unknown
if [ "$wsl" = wsl2 ] && command -v wslinfo >/dev/null 2>&1; then
  net=$(wslinfo --networking-mode 2>/dev/null || printf 'unknown')
fi
printf '[yellow-composio] wsl=%s networking=%s\n' "$wsl" "${net:-unknown}"
```

Tell the user it is OFFLINE (no tools registered this session), then give
the steps for their environment. Tools appear under
`mcp__plugin_yellow-composio_composio-server__*`; restart Claude Code if
they are still missing after login, then re-run `/composio:setup`.

- **`wsl=no`:** open `/mcp`, select composio-server (yellow-composio), and
  choose Authenticate. No browser on this machine (SSH, headless)? Use the
  `--no-browser` login below instead.
- **`wsl=wsl1` or `wsl=wsl2`:** lead with the `--no-browser` login. For
  `wsl2` with `networking=nat` or `unknown`, add as a second option:
  set `networkingMode=mirrored` under `[wsl2]` in `%UserProfile%\.wslconfig`,
  run `wsl --shutdown` from Windows, then use `/mcp` → Authenticate.

The `--no-browser` login, run in a separate terminal (it needs a TTY, so
not through `!` or this session; on WSL, run it from the WSL shell
itself):

```text
  claude mcp login plugin:yellow-composio:composio-server --no-browser
```

Open the printed URL in any browser, finish the Composio login and
consent, then paste the full `http://localhost:<port>/callback?...` URL
the browser lands on (the page itself may fail to load) back into the
terminal. No inbound connection to WSL is needed. That URL holds a one-time
authorization code — paste it only into that terminal, never into this chat.

Consumer-key fallback (last resort). A user-level server takes precedence over
this plugin. It stores the consumer key in plaintext in `~/.claude.json`:

```text
  claude mcp add --scope user --transport http composio-server \
    "https://connect.composio.dev/mcp" \
    --header "x-consumer-api-key:YOUR_CONSUMER_KEY"
```

The key is the For You consumer key (`ck_...`), dashboard path For You →
AI Clients. It is not a Platform project API key. After it is added,
restart Claude Code. Tools appear under `mcp__composio-server__*`. When
the browser path works, run `claude mcp remove composio-server` so the
plugin's OAuth server is the one in use.

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
- **401 Unauthorized**: Report "DEGRADED: Composio rejected the session."
  If the bundled server is the one in use, open `/mcp`, select
  composio-server, and Authenticate again. If a user-level
  `composio-server` was added with `x-consumer-api-key`, that key is
  wrong or expired. Replace it with a For You consumer key (`ck_...`),
  or remove that server and use the plugin's browser OAuth instead.
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
Prerequisites:  jq [ok|missing (degraded)]
MCP Health:     [HEALTHY|DEGRADED|OFFLINE]
Connected Apps: app1, app2, ... (N active)
Usage Tracking: [initialized|existing counter (N executions this month)]
==============================
Setup complete. Run /composio:status to see usage dashboard.
```

When Step 2 recorded `bundled: unauthenticated`, append to `MCP Health:`
the note `(via claude.ai connector; bundled server not authenticated)`
and add one line after the table: authenticate it with `/mcp` →
composio-server → Authenticate, or, on WSL or headless hosts, with the
Step 2 `--no-browser` login in a separate terminal. Do not run the Step 2
WSL probe here — the claude.ai connector works, so nothing is broken.

## Idempotency

Re-running setup preserves existing usage data. It only resets the counter if
the user explicitly approves via AskUserQuestion when corruption is detected.
