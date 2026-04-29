# yellow-research

Deep research plugin for Claude Code. Bundles Ceramic, Perplexity, Tavily,
EXA, Parallel Task, and ast-grep MCP servers with three workflows:

- **`/research:code`** — Inline code research for active development
- **`/research:deep`** — Multi-source deep research saved to `docs/research/`
- **`/workflows:deepen-plan`** — Enrich plans with codebase + external research

## Installation

```
/plugin marketplace add KingInYellows/yellow-plugins
```

Then enable `yellow-research` from the plugin list.

**Optional:** Install the user-level `context7` MCP for library-docs support
in `/research:code` (`/plugin install context7@upstash`). If absent, the
code-researcher falls back to EXA. Install the `yellow-core` plugin for the
`repo-research-analyst` agent.

**ast-grep:** The ast-grep MCP server requires the `ast-grep` binary. Run
`/research:setup` which offers to install it automatically via npm. Or install
manually: `npm install -g @ast-grep/cli`.

## API Key Setup

Add to your shell config (`~/.zshrc` or `~/.bashrc`):

```sh
export EXA_API_KEY="..."          # https://exa.ai/
export TAVILY_API_KEY="..."       # https://tavily.com/
export PERPLEXITY_API_KEY="..."   # https://www.perplexity.ai/settings/api
export CERAMIC_API_KEY="..."      # https://platform.ceramic.ai/keys
                                  # (REST live-probe only; the MCP uses OAuth)
```

Restart Claude Code after setting keys.

The **Parallel Task** and **Ceramic** servers use OAuth — Claude Code handles
authentication automatically. You'll be prompted to authorize on first use
(no API key needed). `CERAMIC_API_KEY` is optional and only powers the
`/research:setup` REST live-probe.

## Usage

### Code Research (inline)

```
/research:code how does React Server Components work?
/research:code stripe webhooks typescript
/research:code difference between zod and valibot
```

Returns a concise answer in-context. No file saved.

### Deep Research (saved report)

```
/research:deep competitive analysis of vector databases 2026
/research:deep technical landscape of MCP server authentication patterns
/research:deep how do large language models handle long context
```

Saves a structured report to `docs/research/<slug>.md`. For major findings,
run `/compound` to add to institutional knowledge.

## MCP Servers

| Server | Package | Purpose |
|--------|---------|---------|
| Ceramic | `mcp.ceramic.ai` | Lexical web search, ~$0.05/1K queries |
| Perplexity | `@perplexity-ai/mcp-server` | Web-grounded research and reasoning |
| Tavily | `tavily-mcp` | Fast web search and page extraction |
| EXA | `exa-mcp-server` | Neural web search, code examples |
| Parallel Task | `task-mcp.parallel.ai` | Async long-horizon research reports |
| ast-grep | `ast-grep-mcp` (via uvx) | AST-based structural code search |

## Research Conductor

The `research-conductor` agent automatically selects sources based on topic
complexity:

- **Simple topics** → Ceramic first (keyword-tight); Perplexity fallback
- **Moderate topics** → Ceramic + Perplexity + Tavily in parallel
- **Complex topics** → Full fan-out: Ceramic + Perplexity + Tavily + async EXA + async Parallel Task

## Output Format

Deep research reports saved to `docs/research/<slug>.md`:

```markdown
# Topic Title

**Date:** 2026-02-21
**Sources:** Perplexity, EXA, Tavily

## Summary

Executive summary of findings.

## Key Findings

### Subtopic 1
...

## Sources

- [Source](URL) — what was found here
```

## Commands

| Command | Description |
|---|---|
| `/research:setup` | Check which API keys and MCP sources are active |
| `/research:code [topic]` | Inline code research — returns answer in-context, no file saved |
| `/research:deep [topic]` | Multi-source deep research — saves report to `docs/research/<slug>.md` |
| `/workflows:deepen-plan [path]` | Enrich a plan with codebase validation + external research |

## Graceful Degradation

If a source MCP is unavailable (key not set, rate limited, connection error),
the plugin skips that source and continues with the rest. Research never fails
completely if at least one source is reachable.
