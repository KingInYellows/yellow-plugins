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

1. **Enable the plugin and answer the `userConfig` prompts**:

   ```text
   /plugin enable yellow-composio
   ```

   Two prompts appear on enable:
   - **Composio MCP URL** -- per-customer endpoint, looks like
     `https://mcp.composio.dev/<id>`. Generate via the Composio
     dashboard or `npx @composio/mcp@latest setup <customer_id> <app_id>`.
   - **Composio API key** -- from <https://app.composio.dev/settings>
     (stored in the OS keychain).

2. **Run setup**:

   ```text
   /composio:setup
   ```

3. **Check usage**:

   ```text
   /composio:status
   ```

If you previously ran `claude mcp add --transport http composio-server ...`
manually, that registration keeps working as a fallback. The bundled path is
preferred because the API key is keychain-stored. See `/composio:setup` for
the full migration walk-through.

## Commands

| Command | Description |
|---------|-------------|
| `/composio:setup` | Validate MCP availability, check connections, init usage counter |
| `/composio:status` | Usage dashboard with execution counts and threshold warnings |

## How It Works

This plugin bundles a `type: http` Composio MCP server via `plugin.json`.
Tools appear under `mcp__plugin_yellow-composio_composio-server__*` after
the `userConfig` prompts are answered. The plugin also provides:

- **Setup validation** -- Confirms Composio is configured and reachable
- **Usage tracking** -- Local counter since Composio has no billing API
- **Integration patterns** -- Documents Workbench, Multi-Execute, and
  degradation patterns for consuming plugins
- **Three-prefix detection** -- `/composio:setup` recognizes the bundled
  prefix as well as the legacy `mcp__claude_ai_composio__*` (Claude.ai
  native) and `mcp__composio-server__*` (manual `claude mcp add`) prefixes

### Optional Accelerator Model

Composio is never required. Consuming plugins (yellow-review, yellow-semgrep,
yellow-linear) detect Composio availability via ToolSearch at runtime. When
present, they use Composio for batch processing acceleration. When absent,
they fall back to existing local approaches with zero user-visible difference.

## Prerequisites

- Composio account ([composio.dev](https://composio.dev))
- A Composio MCP URL and API key (entered via `userConfig` on plugin enable,
  or via a manual `claude mcp add` fallback)
- `jq` (recommended for usage tracking)

## License

MIT
