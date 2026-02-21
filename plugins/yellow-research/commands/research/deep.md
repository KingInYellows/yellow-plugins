---
name: research:deep
description: Multi-source deep research saved to docs/research/. Use when user needs a comprehensive report, competitive analysis, technical landscape overview, or architectural decision support. Saves output as docs/research/<slug>.md.
argument-hint: '<topic>'
allowed-tools:
  - Read
  - Write
  - Bash
  - Task
  - AskUserQuestion
  - ToolSearch
  - mcp__plugin_yellow-research_exa__web_search_exa
  - mcp__plugin_yellow-research_exa__web_search_advanced_exa
  - mcp__plugin_yellow-research_exa__crawling_exa
  - mcp__plugin_yellow-research_exa__deep_researcher_start
  - mcp__plugin_yellow-research_exa__deep_researcher_check
  - mcp__plugin_yellow-research_tavily__tavily_search
  - mcp__plugin_yellow-research_tavily__tavily_extract
  - mcp__plugin_yellow-research_tavily__tavily_research
  - mcp__plugin_yellow-research_tavily__tavily_crawl
  - mcp__plugin_yellow-research_parallel__create_deep_research_task
  - mcp__plugin_yellow-research_parallel__create_task_group
  - mcp__plugin_yellow-research_parallel__get_result
  - mcp__plugin_perplexity_perplexity__perplexity_ask
  - mcp__plugin_perplexity_perplexity__perplexity_research
  - mcp__plugin_perplexity_perplexity__perplexity_reason
  - mcp__grep__searchGitHub
---

# Deep Research

Multi-source research saved to `docs/research/<slug>.md` using Perplexity,
Tavily, EXA, and Parallel Task MCP.

## Workflow

### Step 1: Get Topic

Check `$ARGUMENTS`:
- If provided, use it as the research topic
- If empty, ask via AskUserQuestion: "What topic would you like to research?"

### Step 2: Generate Slug

Convert topic to a slug:
- Lowercase, hyphens only: `[a-z0-9-]`
- Max 40 characters
- Example: "React Server Components 2026" → `react-server-components-2026`

Check for collisions:
```bash
if [ -f "docs/research/<slug>.md" ]; then
  # Try slug-2, slug-3, etc.
fi
```

### Step 3: Prepare Output Directory

```bash
mkdir -p docs/research
```

### Step 4: Research

Delegate to the `research-conductor` agent with the topic. The conductor will:
- Triage complexity (simple/moderate/complex)
- Dispatch parallel queries to appropriate sources
- Handle async Parallel Task and EXA deep research polling
- Return synthesized markdown

### Step 5: Save Output

Write the conductor's output to `docs/research/<slug>.md`.

Report to user:
```
Research saved to docs/research/<slug>.md
```

If the findings contain a major architectural decision, novel pattern, or
institutional knowledge worth keeping: suggest running
`/compound` on the research file.
