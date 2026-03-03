# yellow-morph Plugin

Intelligent code editing and search via Morph Fast Apply and WarpGrep.

## MCP Server

- **morph-mcp** — Stdio transport via `npx @morphllm/morphmcp@0.8.110`
- Requires `MORPH_API_KEY` environment variable (will not start without it)
- Tools: `edit_file`, `warpgrep_codebase_search`
- Lifecycle: starts on first MCP tool call, shuts down on session end
- First call may be slow (20-40s cold start on first npx download; subsequent
  sessions use npm cache and start in seconds)

## Tool Preference Rules

### edit_file (Fast Apply) vs built-in Edit

- Prefer `mcp__plugin_yellow-morph_morph-mcp__edit_file` when the change spans
  3+ non-contiguous lines OR when the target file exceeds 200 lines
- Continue using built-in Edit for small, precise single-line replacements where
  the exact old_string is known and unique
- Never use `edit_file` for non-code files (.md, .json, .yaml, .yml, .toml,
  .env, .xml, .ini, .cfg) — always use built-in Edit for these
- Fast Apply accepts "lazy edit snippets" with `// ... existing code ...`
  markers — the AI specifies what changes, morph handles the merge
- Scales to 1,500-line files at 99.2% accuracy

### warpgrep_codebase_search (WarpGrep) vs built-in Grep

- Prefer `mcp__plugin_yellow-morph_morph-mcp__warpgrep_codebase_search` for
  intent-based queries ("how does authentication work?", "find error handling
  for payment failures", "what calls this function?")
- Continue using built-in Grep for exact pattern matching (regex, literal
  strings, known function names)
- WarpGrep runs in an isolated context window — does not pollute main context
- Completes in 3.8 steps average (sub-6 seconds)
- Auto-excludes node_modules, vendor, build output, .git

## Domain Separation: WarpGrep vs ruvector

When both yellow-morph and yellow-ruvector are installed:

- **WarpGrep** = "find code I haven't seen" — intent-based discovery, stateless,
  no indexing. Use for exploring unfamiliar code, finding callers, blast radius,
  and intent queries.
- **ruvector** = "recall something I learned before" — persistent memory,
  similarity search, indexed. Use for recalling past learnings, finding similar
  patterns, and session memory.

Routing rules:
- Discovery query about unseen code → `warpgrep_codebase_search`
- Recall query about past learning or similar pattern → ruvector tools
- If ruvector is not installed → WarpGrep handles all code search
- If yellow-morph is not installed → ruvector and built-in Grep handle search

## Graceful Degradation

- If `edit_file` fails (API error, timeout, credits exhausted): fall back to
  built-in Edit tool. Note the fallback briefly.
- If `warpgrep_codebase_search` fails: fall back to built-in Grep. Note the
  fallback briefly.
- If `MORPH_API_KEY` is not set: MCP server does not start. All workflows
  continue with built-in tools. No error.
- Morph is an enhancement, never a dependency. No workflow should block on morph
  tool availability.

## Security and Privacy

- **Data transmission:** Both `edit_file` and `warpgrep_codebase_search` send
  code to Morph's API servers (api.morphllm.com)
- **Data retention:** Free/Starter tiers retain data for 90 days. Enterprise
  offers zero-data-retention (ZDR) mode.
- **Sensitive files:** Do not use WarpGrep to search files that may contain
  secrets (.env, credentials.json, private keys). Use built-in Grep for these.
- **API key:** Transmitted via headers (standard HTTPS). Never log or display.
- **Privacy details:** https://morphllm.com/privacy

## Plugin Components

### Commands (2)

- `/morph:setup` — Check prerequisites, configure API key, verify MCP server
- `/morph:status` — Show API health and MCP tool availability

## Git Operations

This plugin does not perform git operations. Graphite commands and git workflows
do not apply.

## Prerequisites

- ripgrep (`rg`) installed — required by WarpGrep for local search
- Node.js 18+ — required for MCP server via npx
- `MORPH_API_KEY` environment variable — obtain from https://morphllm.com
- Network egress to api.morphllm.com (port 443)

## Cost Considerations

- Fast Apply: ~2,000-5,000 credits per edit (~$0.001-$0.005)
- WarpGrep: ~500-2,000 credits per search (~$0.001)
- Free tier: 250K credits/month, 200 requests/month
- Prefer built-in Edit and Grep for trivial operations to conserve credits

## Known Limitations

- Both tools require network connectivity — no offline mode
- Free tier: 250K credits, 200 requests/month (may exhaust in 1-3 active
  sessions)
- WarpGrep timeout: 30s default (configurable via MORPH_WARP_GREP_TIMEOUT env
  var)
- edit_file is not suitable for non-code files (configs, markdown, YAML)
- First npx download may take 20-40s; subsequent sessions use npm cache
- Code is sent to Morph's API — not suitable for air-gapped environments
