---
name: research-patterns
user-invokable: false
description: Reference conventions for yellow-research plugin — slug naming, output format, source selection, API key setup, graceful degradation, and when to compound findings.
---

# Research Patterns

## Slug Naming

Convert the research topic to a slug for the output filename:

- Characters: `[a-z0-9-]` only — lowercase, hyphens, no spaces or special chars
- Max length: 40 characters
- Examples:
  - "React Server Components 2026" → `react-server-components-2026`
  - "How does EXA neural search work?" → `exa-neural-search`
  - "Competitor analysis: Notion vs Linear" → `notion-vs-linear-competitor`
- Collision handling: if `docs/research/<slug>.md` exists, append `-2`, `-3`

## Output Location

All deep research saves to: `docs/research/<slug>.md`

Create the directory if it doesn't exist:
```bash
mkdir -p docs/research
```

## Output Format

```markdown
# <Topic Title>

**Date:** YYYY-MM-DD
**Sources:** Perplexity, EXA, Tavily (list which were used)

## Summary

[2-3 sentence executive summary]

## Key Findings

### <Subtopic 1>
[Findings with source citations]

### <Subtopic 2>
[Findings with source citations]

## Sources

- [Source Title](URL) — brief note on what was found here
```

## Source Selection Guide

| Query Type | Primary Source | Secondary |
|------------|---------------|-----------|
| Library / framework docs | Context7 | EXA `get_code_context_exa` |
| Code examples, GitHub patterns | EXA `get_code_context_exa` | GitHub grep |
| Recent news, current events | Perplexity `perplexity_search` | Tavily `tavily_search` |
| Competitive / company research | EXA `company_research_exa` | Perplexity |
| Deep technical report | Perplexity `perplexity_research` | Tavily `tavily_research` |
| Long-horizon async report | Parallel `create_deep_research_task` | EXA `deep_researcher_start` |
| Specific URL content | EXA `crawling_exa` | Tavily `tavily_extract` |

## When to Compound Findings

After `/research:deep`, run `/compound` if the findings include:
- A novel architectural pattern worth sharing with the team
- A critical gotcha or anti-pattern discovered
- An institutional decision that will recur (e.g., "we use X instead of Y because...")
- A bug root cause that took significant investigation

Routine informational research does not need to be compounded.

## Graceful Degradation

If an MCP server is unavailable (key not set, connection error, rate limit):
- Log a brief note: "Skipping [source] — unavailable"
- Continue with remaining sources
- Never fail completely if at least 1 source is available
- If all sources fail, surface the error clearly

## API Key Setup

Add to `~/.zshrc` (or equivalent shell config):

```sh
export EXA_API_KEY="your-key-here"
export TAVILY_API_KEY="your-key-here"
export PERPLEXITY_API_KEY="your-key-here"
export PARALLEL_API_KEY="your-key-here"
```

Get keys from:
- EXA: https://exa.ai/
- Tavily: https://tavily.com/
- Perplexity: https://www.perplexity.ai/settings/api
- Parallel: https://platform.parallel.ai/

After adding keys: source `~/.zshrc` and restart Claude Code.

## MCP Tool Name Verification

After installing yellow-research, always verify actual tool names before
writing agent code or troubleshooting:

```
ToolSearch "exa"
ToolSearch "tavily"
ToolSearch "perplexity"
ToolSearch "parallel"
```

Or run `/mcp` in Claude Code to see all registered tools.

**Never trust LLM-generated tool names** — they may be fictitious. Empirical
verification is required. If names differ from what's in agents/commands,
update the `allowed-tools` lists.
