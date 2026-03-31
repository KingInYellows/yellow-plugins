# yellow-composio Plugin

Optional Composio accelerator for batch workflows with local usage tracking.

## How It Works

This plugin does NOT bundle an MCP server. Composio tools are provided by
the user's MCP connector (prefix varies by configuration -- e.g.,
`mcp__claude_ai_composio__*` for native integrations or
`mcp__composio-server__*` for manual `.mcp.json` setups). The plugin provides:

1. Setup validation to confirm Composio is configured and reachable
2. Local usage tracking since Composio has no billing/usage API
3. A patterns skill documenting Workbench, Multi-Execute, and degradation
   conventions for consuming plugins

## Composio MCP Tools (Not Bundled)

The following tools are provided by the user's Composio MCP connector (not by
this plugin). They are discoverable via ToolSearch:

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

- **No API keys stored** -- Native MCP connector handles credentials
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
