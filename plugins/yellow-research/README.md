# yellow-research

Deep research plugin for Claude Code. Bundles Perplexity, Tavily, EXA, and
Parallel Task MCP servers with two workflows:

- **`/research:code`** — Inline code research for active development
- **`/research:deep`** — Multi-source deep research saved to `docs/research/`

## Installation

```
/plugin marketplace add KingInYellows/yellow-plugins
```

Then enable `yellow-research` from the plugin list.

**Optional:** Install the `compound-engineering` plugin for Context7 library docs
support in `/research:code`. If absent, the code-researcher falls back to EXA.

## API Key Setup

Add to your shell config (`~/.zshrc` or `~/.bashrc`):

```sh
export EXA_API_KEY="..."          # https://exa.ai/
export TAVILY_API_KEY="..."       # https://tavily.com/
export PERPLEXITY_API_KEY="..."   # https://www.perplexity.ai/settings/api
export PARALLEL_API_KEY="..."     # https://platform.parallel.ai/
```

Restart Claude Code after setting keys.

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
| Perplexity | `@perplexity-ai/mcp-server` | Web-grounded research and reasoning |
| Tavily | `tavily-mcp` | Fast web search and page extraction |
| EXA | `exa-mcp-server` | Neural semantic search, code examples |
| Parallel Task | `task-mcp.parallel.ai` | Async long-horizon research reports |

## Research Conductor

The `research-conductor` agent automatically selects sources based on topic
complexity:

- **Simple topics** → Single Perplexity query
- **Moderate topics** → 2-3 parallel queries (Perplexity + Tavily or EXA)
- **Complex topics** → Full fan-out: Perplexity + Tavily + async EXA + async Parallel Task

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

## Graceful Degradation

If a source MCP is unavailable (key not set, rate limited, connection error),
the plugin skips that source and continues with the rest. Research never fails
completely if at least one source is reachable.
