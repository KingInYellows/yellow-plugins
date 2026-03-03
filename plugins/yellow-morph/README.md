# yellow-morph

Intelligent code editing and search via
[Morph Fast Apply](https://docs.morphllm.com) and
[WarpGrep](https://docs.morphllm.com/sdk/components/warp-grep/tool).

## Installation

```
/plugin marketplace add KingInYellows/yellow-plugins
/plugin install yellow-morph@yellow-plugins
```

## Quick Start

```bash
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

### Fast Apply (`edit_file`)

Morph's Fast Apply replaces Claude's built-in Edit tool for complex edits. It
accepts "lazy edit snippets" with `// ... existing code ...` markers — you
describe what changes, morph handles the merge. 98%+ accuracy at 10,500+ tok/s,
scaling to 1,500-line files.

**When to use:** Changes spanning 3+ non-contiguous lines, or files exceeding
200 lines.

**When NOT to use:** Non-code files (.md, .json, .yaml), small single-line
replacements.

### WarpGrep (`warpgrep_codebase_search`)

Intent-based code search that answers questions like "how does authentication
work?" or "what calls this function?" — no indexing required. Completes in ~3.8
steps (sub-6 seconds).

**When to use:** Intent-based queries, finding callers, blast radius analysis.

**When NOT to use:** Exact pattern matching (use built-in Grep), searching for
secrets (use built-in Grep).

## Prerequisites

- **ripgrep** (`rg`) — required by WarpGrep for local search
- **Node.js 18+** — required for MCP server via npx
- **MORPH_API_KEY** — obtain from https://morphllm.com (free tier: 250K
  credits/month)
- **Network access** to api.morphllm.com (port 443)

## Cost

| Tool       | Credits per call  | Approximate cost |
| ---------- | ----------------- | ---------------- |
| Fast Apply | 2,000-5,000       | $0.001-$0.005    |
| WarpGrep   | 500-2,000         | ~$0.001          |

Free tier: 250K credits/month, 200 requests/month.

## Privacy

Both tools send code to Morph's API servers (api.morphllm.com). Free/Starter
tiers retain data for 90 days. Enterprise offers zero-data-retention (ZDR) mode.
See https://morphllm.com/privacy for details.

## Cross-Plugin Integration

- **yellow-ruvector** — WarpGrep handles discovery ("find code I haven't seen"),
  ruvector handles recall ("what did I learn about X")
- **yellow-core, yellow-review, yellow-debt, yellow-ci** — morph tools available
  in freeform conversations alongside these plugins

## License

MIT
