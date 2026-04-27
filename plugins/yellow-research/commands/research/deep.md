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
  - mcp__plugin_yellow-research_ceramic__ceramic_search
  - mcp__plugin_yellow-research_exa__web_search_exa
  - mcp__plugin_yellow-research_exa__web_search_advanced_exa
  - mcp__plugin_yellow-research_exa__crawling_exa
  - mcp__plugin_yellow-research_exa__company_research_exa
  - mcp__plugin_yellow-research_exa__deep_researcher_start
  - mcp__plugin_yellow-research_exa__deep_researcher_check
  - mcp__plugin_yellow-research_tavily__tavily_search
  - mcp__plugin_yellow-research_tavily__tavily_extract
  - mcp__plugin_yellow-research_tavily__tavily_research
  - mcp__plugin_yellow-research_tavily__tavily_crawl
  - mcp__plugin_yellow-research_tavily__tavily_map
  - mcp__plugin_yellow-research_parallel__createDeepResearch
  - mcp__plugin_yellow-research_parallel__createTaskGroup
  - mcp__plugin_yellow-research_parallel__getResultMarkdown
  - mcp__plugin_yellow-research_parallel__getStatus
  - mcp__plugin_yellow-research_perplexity__perplexity_ask
  - mcp__plugin_yellow-research_perplexity__perplexity_research
  - mcp__plugin_yellow-research_perplexity__perplexity_reason
  - mcp__grep__searchGitHub
  - mcp__plugin_yellow-research_ast-grep__find_code
  - mcp__plugin_yellow-research_ast-grep__find_code_by_rule
  - mcp__plugin_yellow-research_ast-grep__dump_syntax_tree
  - mcp__plugin_yellow-research_ast-grep__test_match_code_rule
---

# Deep Research

Multi-source research saved to `docs/research/<slug>.md` using Ceramic,
Perplexity, Tavily, EXA, Parallel Task, and ast-grep MCP.

## Workflow

### Step 1: Get Topic

Check `$ARGUMENTS`:
- If provided, set TOPIC=$ARGUMENTS
- If empty, ask via AskUserQuestion: "What topic would you like to research?" and set TOPIC to the response

### Step 2: Generate Slug

Generate a safe slug using Bash:

```bash
SLUG=$(echo "$TOPIC" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | tr -s '-' | sed 's/^-//;s/-$//' | cut -c1-40 | sed 's/-$//')
echo "$SLUG" | grep -qE '^[a-z0-9][a-z0-9-]{0,39}$' || SLUG="research-$(date +%Y%m%d%H%M%S | cut -c1-14)"
```

Check for collisions and increment suffix if needed:

```bash
TARGET="docs/research/${SLUG}.md"
N=2
while [ -f "$TARGET" ]; do
  TARGET="docs/research/${SLUG}-${N}.md"
  N=$((N + 1))
done
```

Use `$TARGET` as the output path.

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
