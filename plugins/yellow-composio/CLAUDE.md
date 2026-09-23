# yellow-composio Plugin

Optional Composio accelerator for batch workflows with local usage tracking.

## How It Works

This plugin bundles Composio Connect as a native HTTP MCP server at
`https://connect.composio.dev/mcp` (`type: http`, no headers). Claude Code
performs browser OAuth. A stdio proxy that injects an API key never
surfaces that challenge, so `bin/start-composio.sh` is gone. There is no
`userConfig` and no SessionStart hook. Setup is `/mcp` → `composio-server`
→ Authenticate. App connections (Gmail, Slack, GitHub, and the rest) stay
on `COMPOSIO_MANAGE_CONNECTIONS` after the MCP session is authenticated.

Headless hosts that cannot open a browser can register a user-level server
with a For You consumer key (`ck_...`). Claude Code prefers that server
over the plugin. See `/composio:setup`. That key is not a Platform project
API key, and `https://mcp.composio.dev/<id>` is not a substitute URL.

The plugin still detects externally-configured Composio MCPs as a
migration aid (`mcp__claude_ai_composio__*` for the Claude.ai native
integration, `mcp__composio-server__*` for manual `claude mcp add`).
Detection runs in `/composio:setup` and is independent of the bundled MCP.

The plugin provides:

1. Bundled HTTP MCP server on the shared Connect URL, authenticated with OAuth
2. Setup validation to confirm Composio is configured and reachable
3. Local usage tracking since Composio has no billing/usage API
4. A patterns skill documenting Workbench, Multi-Execute, and degradation
   conventions for consuming plugins

## Composio MCP Tools

These tools are now bundled via this plugin (preferred) and may also be
provided by external connectors (legacy / fallback). All variants are
discoverable via ToolSearch:

- `COMPOSIO_SEARCH_TOOLS` -- Discover tools, get schemas, check connection status
- `COMPOSIO_GET_TOOL_SCHEMAS` -- Full parameter schemas for specific tools
- `COMPOSIO_MULTI_EXECUTE_TOOL` -- Run up to 50 tools in parallel
- `COMPOSIO_MANAGE_CONNECTIONS` -- OAuth flow, API key auth for apps
- `COMPOSIO_REMOTE_WORKBENCH` -- Persistent Python sandbox (4-min timeout)
- `COMPOSIO_REMOTE_BASH_TOOL` -- Bash commands in the sandbox

## Graceful Degradation

Composio is an enhancement, never a dependency. All workflows must function
without it:

1. Detect via `ToolSearch("COMPOSIO_REMOTE_WORKBENCH")`
2. If not found: skip Composio path, use local approach silently
3. If found: use Composio-accelerated path
4. If Composio call fails at runtime: fall back to local, note briefly

## Plugin Components

### Commands (2)

- `/composio:setup` -- Validate MCP availability, check connections, init usage counter
- `/composio:status` -- Usage dashboard with execution counts and threshold warnings

### Skills (1)

- `composio-patterns` -- Tool reference, Workbench batch processing, Multi-Execute,
  usage tracking, graceful degradation, error catalog, security notes

### Agents (0)

No agents. Batch orchestration agents deferred until patterns stabilize.

## Usage Tracking

Local counter at `.claude/composio-usage.json` tracks:
- Total executions per month
- Per-tool breakdown
- Per-day breakdown
- Configurable warning thresholds

Composio has no billing API. This is the only way to monitor execution budget.

## Security Notes

- **OAuth for the bundled server** -- Claude Code stores the MCP OAuth
  session. The plugin manifest has no API key and no URL field. Never
  echo a consumer key from the headless `claude mcp add` fallback.
- **Remote execution** -- Workbench runs on Composio's cloud. Do not send
  secrets, private keys, or proprietary algorithms
- **Content fencing** -- Wrap all Composio responses in `--- begin/end ---`
  delimiters per repository convention
- **Usage counter** -- Contains only execution counts, no sensitive data

## Cross-Plugin Dependencies

None. The bundled server does not source yellow-core.

### Consuming Plugins

No other marketplace plugin currently calls Composio tools (only CHANGELOG
history mentions earlier yellow-review / yellow-semgrep / yellow-linear plans).

## Testing

No plugin-local shell suite. The bundled server is declarative HTTP.
`pnpm validate:schemas` covers the generated manifest.

## Known Limitations

- Composio has no billing/usage API -- local tracking is best-effort
- Workbench has a hard 4-minute execution timeout per call
- Remote file paths (`/home/user/...`) do not map to local filesystem
- Parallel session counter increments may drift slightly (last-writer-wins)
- No cross-plugin `skills:` preloading -- consumers embed patterns inline
- Composio sandbox isolation details are not publicly documented
