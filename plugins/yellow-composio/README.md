# yellow-composio

Optional Composio accelerator for batch workflows with local usage tracking.

## Installation

```bash
/plugin marketplace add KingInYellows/yellow-plugins
```

Then install the plugin:

```bash
/plugin install yellow-composio@yellow-plugins
```

## Quick Start

1. **Configure Composio MCP server** (if not already done):

   ```bash
   claude mcp add --transport http composio-server "YOUR_MCP_URL" \
     --headers "X-API-Key:YOUR_COMPOSIO_API_KEY"
   ```

2. **Run setup**:

   ```text
   /composio:setup
   ```

3. **Check usage**:

   ```text
   /composio:status
   ```

## Commands

| Command | Description |
|---------|-------------|
| `/composio:setup` | Validate MCP availability, check connections, init usage counter |
| `/composio:status` | Usage dashboard with execution counts and threshold warnings |

## How It Works

This plugin does **not** bundle an MCP server. Composio tools are provided by
Claude's native MCP connector. The plugin provides:

- **Setup validation** -- Confirms Composio is configured and reachable
- **Usage tracking** -- Local counter since Composio has no billing API
- **Integration patterns** -- Documents Workbench, Multi-Execute, and
  degradation patterns for consuming plugins

### Optional Accelerator Model

Composio is never required. Consuming plugins (yellow-review, yellow-semgrep,
yellow-linear) detect Composio availability via ToolSearch at runtime. When
present, they use Composio for batch processing acceleration. When absent,
they fall back to existing local approaches with zero user-visible difference.

## Prerequisites

- Composio account ([composio.dev](https://composio.dev))
- Composio MCP server configured in Claude Code
- `jq` (recommended for usage tracking)

## License

MIT
