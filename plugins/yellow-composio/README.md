# yellow-composio

Optional Composio accelerator for batch workflows with local usage tracking.

## OAuth on the shared Connect URL

The bundled server is native HTTP at `https://connect.composio.dev/mcp`.
Enable does not ask for a URL or an API key. Claude Code opens a browser
OAuth flow.

After updating from the stdio wrapper or a saved consumer key:

```text
/plugin disable yellow-composio
/plugin enable yellow-composio
```

Then open `/mcp`, select `composio-server`, and choose Authenticate.
A headless host that cannot open a browser can still add a user-level
server with a For You consumer key (`ck_...`). See `/composio:setup`.

## Installation

```bash
/plugin marketplace add KingInYellows/yellow-plugins
```

Then install the plugin:

```bash
/plugin install yellow-composio@yellow-plugins
```

## Quick Start

1. **Enable the plugin**:

   ```text
   /plugin enable yellow-composio
   ```

   No URL or API key prompt. Open `/mcp`, select `composio-server`, and
   choose Authenticate. Finish the browser login.

2. **Run setup**:

   ```text
   /composio:setup
   ```

3. **Check usage**:

   ```text
   /composio:status
   ```

If you previously ran `claude mcp add` with an API key, that user-level
server takes precedence over this plugin. Remove it with
`claude mcp remove composio-server` once browser OAuth works. See
`/composio:setup`.

## Commands

| Command | Description |
|---------|-------------|
| `/composio:setup` | Validate MCP availability, check connections, init usage counter |
| `/composio:status` | Usage dashboard with execution counts and threshold warnings |

## How It Works

This plugin bundles a native HTTP Composio MCP server at
`https://connect.composio.dev/mcp`. Claude Code authenticates it with
browser OAuth. Tools appear under
`mcp__plugin_yellow-composio_composio-server__*` after that login. The
plugin also provides:

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
- A browser session for Claude Code's OAuth prompt on
  `https://connect.composio.dev/mcp`. Headless hosts can use the
  consumer-key fallback in `/composio:setup`.
- `jq` (recommended for usage tracking)

## License

MIT
