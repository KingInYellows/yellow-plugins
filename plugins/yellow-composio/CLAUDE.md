# yellow-composio Plugin

Optional Composio accelerator for batch workflows with local usage tracking.

## How It Works

This plugin bundles a Composio MCP server via a small `command`-type stdio
wrapper (`bin/start-composio.sh` + `bin/composio-proxy.mjs`) that resolves
credentials and proxies stdio MCP JSON-RPC to Composio's HTTPS endpoint.

**Why stdio + proxy instead of `type: http`?** Claude Code's `${VAR}`
substitution in HTTP MCP `headers` fields is a confirmed bug
([anthropics/claude-code#51581](https://github.com/anthropics/claude-code/issues/51581)).
The wrapper sidesteps this — it runs in a normal shell subprocess where
both `userConfig` and shell env are visible. Composio's official
recommendation is `claude mcp add --transport http`, but that path
cannot honor `COMPOSIO_MCP_URL` / `COMPOSIO_API_KEY` shell env vars,
which blocks dotfile-managed multi-host fleets.

**Credential resolution precedence** (in `bin/start-composio.sh`):
1. `userConfig.composio_mcp_url` / `composio_api_key` (keychain — preferred)
2. Shell env `COMPOSIO_MCP_URL` / `COMPOSIO_API_KEY` (fleet fallback)
3. Unset → wrapper exits **non-zero**, preventing the bundled MCP from
   registering with an empty URL (which would cascade-fail `claude doctor`
   for all other MCPs in the session).

`required: true` was removed from the userConfig fields. Per
[#39827](https://github.com/anthropics/claude-code/issues/39827) it does
NOT block install — it merely produces a confusing MCP-startup error. The
wrapper's hard exit on empty values is the actual safeguard. The
SessionStart hook (`hooks/check-mcp-url.sh`) also writes a
`credential-status.json` consumed by `/setup:all` for dashboard
classification.

The plugin still detects externally-configured Composio MCPs as a
migration aid (`mcp__claude_ai_composio__*` for the Claude.ai native
integration, `mcp__composio-server__*` for manual `.mcp.json` setups
predating this plugin). Detection runs in `/composio:setup` and is
independent of the bundled MCP — for new enables it cannot activate
against an empty bundled `userConfig` because `required: true` blocks
that state, but legacy pre-v1.2.4 installs may still be in it until
re-enabled.

The plugin provides:

1. Bundled MCP server with `userConfig`-prompt-driven credentials
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

No agents in v1. Batch orchestration agents deferred until patterns stabilize.

## Usage Tracking

Local counter at `.claude/composio-usage.json` tracks:
- Total executions per month
- Per-tool breakdown
- Per-day breakdown
- Configurable warning thresholds

Composio has no billing API. This is the only way to monitor execution budget.

## Security Notes

- **API key stored in system keychain** -- Composio API key is sensitive
  `userConfig` (`composio_api_key`) and held in the OS keychain. The MCP
  URL is non-sensitive and held in plain `userConfig` storage. Never
  echo either value in command output or commits.
- **Remote execution** -- Workbench runs on Composio's cloud. Do not send
  secrets, private keys, or proprietary algorithms
- **Content fencing** -- Wrap all Composio responses in `--- begin/end ---`
  delimiters per repository convention
- **Usage counter** -- Contains only execution counts, no sensitive data

## Cross-Plugin Dependencies

| Dependency | Purpose | Required? |
|---|---|---|
| None | This plugin has no dependencies | N/A |

### Consuming Plugins (v1.1+)

| Plugin | Workflow | Composio Use |
|---|---|---|
| yellow-review | review:all, review:pr | Cross-PR finding aggregation |
| yellow-semgrep | semgrep:fix-batch | Batch scan execution |
| yellow-linear | sync-all, triage, plan-cycle | Issue batch-fetch and classification |

## Known Limitations

- Composio has no billing/usage API -- local tracking is best-effort
- Workbench has a hard 4-minute execution timeout per call
- Remote file paths (`/home/user/...`) do not map to local filesystem
- Parallel session counter increments may drift slightly (last-writer-wins)
- No cross-plugin `skills:` preloading -- consumers embed patterns inline
- Composio sandbox isolation details are not publicly documented
