# yellow-morph

Intelligent code editing and search via
[Morph Fast Apply](https://docs.morphllm.com) and
[WarpGrep](https://docs.morphllm.com/sdk/components/warp-grep/tool).

## Installation

```bash
/plugin marketplace add KingInYellows/yellow-plugins
/plugin install yellow-morph@yellow-plugins
```

## Quick Start

```
# Configure API key and verify prerequisites
/morph:setup

# Check API health and tool availability
/morph:status
```

Once configured, morph tools are available automatically — no explicit invocation
needed. Claude will prefer `edit_file` for large edits and
`warpgrep_codebase_search` for intent-based code discovery.

## Commands

| Command          | Description                                          |
| ---------------- | ---------------------------------------------------- |
| `/morph:setup`   | Check prerequisites, configure API key, verify MCP   |
| `/morph:status`  | Show API health and MCP tool availability            |

## How It Works

- **Fast Apply** (`edit_file`) — high-accuracy code merging for complex,
  multi-line edits. 98%+ accuracy at 10,500+ tok/s, scaling to 1,500-line files.
- **WarpGrep** (`warpgrep_codebase_search`) — intent-based code discovery that
  answers "how does X work?" queries without indexing. Sub-6 second average.

See [CLAUDE.md](CLAUDE.md) for detailed tool preference rules, domain separation
with ruvector, cost/credit details, and privacy notes.

## Prerequisites

- **ripgrep** (`rg`) — required by WarpGrep for local search
- **Node.js 18+** — required for MCP server via npx
- **MORPH_API_KEY** — obtain from https://morphllm.com (free tier: 250K
  credits/month)
- **Network access** to api.morphllm.com (port 443)

## Privacy

Both tools send code to Morph's API servers (api.morphllm.com). Free/Starter
tiers retain data for 90 days. Enterprise offers zero-data-retention (ZDR) mode.
See https://morphllm.com/privacy for details.

## License

MIT
