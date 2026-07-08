# yellow-composio

Optional Composio accelerator for batch workflows with local usage tracking.

## Upgrading from v1.2.x to v1.3.0

v1.3.0 converts the bundled Composio MCP from `type: http` to a `command`-type
stdio wrapper. This is a transport-level change; tool names and behavior are
identical. Existing keychain-stored credentials are preserved.

**After Claude Code picks up the new plugin manifest, run:**

```text
/plugin disable yellow-composio
/plugin enable yellow-composio
```

The disable/enable cycle re-registers the MCP server with its new
`command`-type configuration. If you skip this step, the previous `type: http`
registration may linger until your next session restart.

**New: shell env fallback for multi-host fleets.** v1.3.0 honors
`COMPOSIO_MCP_URL` and `COMPOSIO_API_KEY` shell env vars when the userConfig
fields are empty. Set them in your shell rc / direnv / secrets manager and
the wrapper picks them up automatically — no per-host userConfig prompts
needed. See `/multi-host-fleet` (in yellow-core) for the full fleet pattern.

**Empty URL no longer cascades.** Previously, a blank `composio_mcp_url`
broke `claude doctor` for all other MCPs (`SDK auth failed: "/" cannot be
parsed as a URL`). The v1.3.0 wrapper now exits non-zero on empty values,
so only Composio fails to start — other MCPs are unaffected.

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
     dashboard or `npx @composio/mcp@latest setup YOUR_CUSTOMER_ID YOUR_APP_ID`.
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

This plugin bundles a `command`-type stdio Composio MCP server via
`plugin.json` — a small wrapper (`bin/start-composio.sh`) resolves the
credentials and execs a Node.js proxy (`bin/composio-proxy.mjs`) that bridges
stdio MCP JSON-RPC to Composio's HTTPS endpoint. Node.js 18+ must be on PATH
for the bundled server to start (the Claude.ai-native and manual
`claude mcp add` prefixes do not require it). Tools appear under
`mcp__plugin_yellow-composio_composio-server__*` after the `userConfig`
prompts are answered. The plugin also provides:

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
