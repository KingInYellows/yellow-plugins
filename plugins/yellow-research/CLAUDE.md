# yellow-research Plugin

Deep research plugin with 3 bundled MCP servers (Tavily, EXA, Parallel Task) plus
Perplexity via the global Perplexity plugin. Two workflows: `/research:code`
(inline, fast) and `/research:deep` (multi-source, saved to `docs/research/`).

## MCP Servers

Bundled servers follow `mcp__plugin_yellow-research_<server>__<tool>`.
Perplexity tools come from the separately installed Perplexity plugin:
`mcp__plugin_perplexity_perplexity__<tool>`.

### perplexity — `PERPLEXITY_API_KEY` (global plugin, not bundled)

- `perplexity_ask` — Quick factual answers
- `perplexity_search` — Web-grounded search
- `perplexity_research` — Deep multi-source research
- `perplexity_reason` — Step-by-step reasoning

### tavily — `TAVILY_API_KEY` (bundled)

- `tavily_search` — Real-time web search
- `tavily_extract` — Extract content from URLs
- `tavily_crawl` — Systematic site crawl
- `tavily_map` — Structured site map
- `tavily_research` — Deep research mode

### exa — `EXA_API_KEY` (bundled)

Default-on tools:
- `web_search_exa` — General neural web search
- `get_code_context_exa` — Code examples, GitHub, Stack Overflow, docs
- `company_research_exa` — Company/org research

Off-by-default tools (enable via Smithery if needed):
- `web_search_advanced_exa` — Full-control search with date/domain filters
- `crawling_exa` — Full content of a specific URL
- `deep_researcher_start` — Start async EXA deep research report
- `deep_researcher_check` — Poll async research status

### parallel — `PARALLEL_API_KEY` (bundled, HTTP Bearer auth)

- `create_deep_research_task` — Launch async research; returns task ID
- `create_task_group` — Parallel enrichment for multiple items
- `get_result` — Retrieve completed research (works for both task types)

## Conventions

- **Slug format:** `[a-z0-9-]` only, max 40 chars, auto-generated from topic
- **Output path:** `docs/research/<slug>.md` (dir created if missing)
- **Code research:** Always inline — never saves a file
- **Deep research:** Always saves — suggests `/compound` for major findings
- **Graceful degradation:** Skip unavailable MCPs; continue with rest
- **Slug collisions:** Append `-2`, `-3` suffix if file exists
- **After install:** Verify actual tool names with ToolSearch — never trust
  LLM-generated names. MCP names in agents/commands may need updating.

## Plugin Components

### Commands

- `/research:code [topic]` — Inline code research: delegates to code-researcher,
  returns synthesized answer in-context. No file saved.
- `/research:deep [topic]` — Multi-source deep research: conductor decides
  fan-out strategy, saves to `docs/research/<slug>.md`.

### Agents

- `research-conductor` — Routes /research:deep queries. Triages complexity
  (simple/moderate/complex) and dispatches parallel or sequential queries.
- `code-researcher` — Inline code research. Routes by query type: library docs
  → Context7, code examples → EXA, recent → Perplexity.

### Skills

- `research-patterns` — Reference: slug naming, source selection, API key
  setup, graceful degradation, when to compound findings.

## Prerequisites

The Perplexity plugin must be installed separately — it is not bundled with
yellow-research. Install it from the Claude Code plugin marketplace and ensure
`PERPLEXITY_API_KEY` is set in your shell.

## API Key Setup

Add to `~/.zshrc`:

```sh
export EXA_API_KEY="..."
export TAVILY_API_KEY="..."
export PERPLEXITY_API_KEY="..."   # used by Perplexity global plugin
export PARALLEL_API_KEY="..."
```

Source or restart shell after setting. Keys are passed to MCP servers at
startup — restart Claude Code after adding new keys.

## When to Use What

- `/research:code` — Actively coding, need quick answer about a library or API
- `/research:deep` — Need a comprehensive report saved for later reference
- `research-conductor` auto-triggers via `/research:deep` — do not call directly
- `code-researcher` auto-triggers via `/research:code` — do not call directly
