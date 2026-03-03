# yellow-research Plugin

Deep research plugin with 4 bundled MCP servers. Three workflows: `/research:code`
(inline, fast), `/research:deep` (multi-source, saved to `docs/research/`), and
`/workflows:deepen-plan` (enrich plans with codebase + external research).

## MCP Servers

All tool names follow `mcp__plugin_yellow-research_<server>__<tool>`.

### perplexity — `PERPLEXITY_API_KEY`

- `perplexity_ask` — Quick factual answers
- `perplexity_search` — Web-grounded search
- `perplexity_research` — Deep multi-source research
- `perplexity_reason` — Step-by-step reasoning

### tavily — `TAVILY_API_KEY`

- `tavily_search` — Real-time web search
- `tavily_extract` — Extract content from URLs
- `tavily_crawl` — Systematic site crawl
- `tavily_map` — Structured site map
- `tavily_research` — Deep research mode

### exa — `EXA_API_KEY`

Default-on tools (enabled by EXA by default):
- `web_search_exa` — General neural web search
- `get_code_context_exa` — Code examples, GitHub, Stack Overflow, docs

Off-by-default tools (enable by adding them to the `tools=` arg in `plugin.json`):
- `company_research_exa` — Company/org research
- `web_search_advanced_exa` — Full-control search with date/domain filters
- `crawling_exa` — Full content of a specific URL
- `deep_researcher_start` — Start async EXA deep research report
- `deep_researcher_check` — Poll async research status

### parallel — OAuth (auto-managed by Claude Code)

- `createDeepResearch` — Launch async research; returns task ID
- `createTaskGroup` — Parallel enrichment for multiple items
- `getResultMarkdown` — Retrieve completed research report
- `getStatus` — Poll async task status before retrieving results

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

- `/research:setup` — Check which API keys and MCP sources are configured and active
- `/research:code [topic]` — Inline code research: delegates to code-researcher,
  returns synthesized answer in-context. No file saved.
- `/research:deep [topic]` — Multi-source deep research: conductor decides
  fan-out strategy, saves to `docs/research/<slug>.md`.
- `/workflows:deepen-plan [plan path]` — Enrich an existing plan with codebase
  validation and external research, annotating inline. Optional step between
  `/workflows:plan` and `/workflows:work`.

### Agents

- `research-conductor` — Routes /research:deep queries. Triages complexity
  (simple/moderate/complex) and dispatches parallel or sequential queries.
- `code-researcher` — Inline code research. Routes by query type: library docs
  → Context7, code examples → EXA, recent → Perplexity.

### Skills

- `research-patterns` — Reference: slug naming, source selection, API key
  setup, graceful degradation, when to compound findings.

## API Key Setup

Add to `~/.zshrc`:

```sh
export EXA_API_KEY="..."
export TAVILY_API_KEY="..."
export PERPLEXITY_API_KEY="..."
```

Source or restart shell after setting. Keys are passed to MCP servers at
startup — restart Claude Code after adding new keys.

The **parallel** server uses OAuth — Claude Code handles authentication
automatically (no API key needed). You'll be prompted to authorize on first use.

## Optional Dependencies

These external tools improve research quality but are not required:

- **yellow-core plugin** — provides Context7
  (`mcp__plugin_yellow-core_context7__resolve-library-id`,
  `mcp__plugin_yellow-core_context7__query-docs`) for official library
  docs. Used by `/research:code` for library queries. Also provides
  `repo-research-analyst` agent used by `/workflows:deepen-plan` for codebase
  validation. Falls back to EXA (for Context7) or skips codebase research
  (for deepen-plan) if not installed.
  Install: `/plugin marketplace add KingInYellows/yellow-plugins` (select
  yellow-core)
- **grep MCP** — provides `mcp__grep__searchGitHub` for GitHub code search.
  Used by `/research:code` and `/research:deep`. No API key required. Configure
  globally in Claude Code MCP settings.
- **yellow-morph plugin** (preferred) — provides WarpGrep
  (`mcp__plugin_yellow-morph_morph-mcp__warpgrep_codebase_search`) for agentic
  codebase search. Replaces the global `filesystem-with-morph` MCP. When both
  are installed, yellow-morph's plugin-namespaced tool is preferred.
  Install: `/plugin marketplace add KingInYellows/yellow-plugins` (select
  yellow-morph)
- **filesystem-with-morph MCP** (legacy) — provides WarpGrep
  (`mcp__filesystem-with-morph__warpgrep_codebase_search`) for agentic
  codebase and GitHub search. No API key required. Configure globally in
  Claude Code MCP settings. When yellow-morph is installed, prefer the
  plugin-namespaced tool instead.
- **yellow-devin plugin** — provides DeepWiki
  (`mcp__plugin_yellow-devin_deepwiki__read_wiki_structure`) for AI-powered
  repo documentation. Install: `/plugin marketplace add
  KingInYellows/yellow-plugins` (select yellow-devin)

Without these, the plugin degrades gracefully: Context7 falls back to EXA,
`searchGitHub` is simply skipped, deepen-plan runs external research only.
`/research:setup` reports all optional sources as UNAVAILABLE with install
instructions.

## Git Operations

This plugin does not perform git operations. Graphite commands and git workflows
do not apply.

## When to Use What

- `/research:setup` — First install, after adding API keys, or to diagnose degraded sources
- `/research:code` — Actively coding, need quick answer about a library or API
- `/research:deep` — Need a comprehensive report saved for later reference
- `/workflows:deepen-plan` — Have a plan from `/workflows:plan` that needs deeper validation before `/workflows:work`
- `research-conductor` auto-triggers via `/research:deep` and `/workflows:deepen-plan` — do not call directly
- `code-researcher` auto-triggers via `/research:code` — do not call directly
