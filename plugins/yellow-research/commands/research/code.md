---
name: research:code
description: Inline code research for active development. Use when user asks how a library works, needs code examples, API patterns, or framework documentation. Returns synthesized answer in-context — no file saved.
argument-hint: '<topic or question>'
allowed-tools:
  - Task
  - Read
  - Grep
  - Glob
  - Bash
  - ToolSearch
  - mcp__plugin_yellow-research_exa__get_code_context_exa
  - mcp__plugin_yellow-research_exa__web_search_exa
  - mcp__plugin_compound-engineering_context7__resolve-library-id
  - mcp__plugin_compound-engineering_context7__query-docs
  - mcp__grep__searchGitHub
  - mcp__plugin_perplexity_perplexity__perplexity_search
---

# Code Research

Research code topics inline using EXA, Context7, GitHub, and Perplexity.
Results are returned in-context — no file is saved.

## Workflow

### Step 1: Validate Input

Check `$ARGUMENTS`:
- If empty, respond: "Please provide a topic. Usage: `/research:code <topic>`"
- If provided, proceed with the topic as the research query

### Step 2: Research

Delegate to the `code-researcher` agent with the topic from `$ARGUMENTS`.

The agent will:
- Route the query to the best source (Context7 for library docs, EXA for code
  examples, GitHub grep for code search, Perplexity for recent info)
- Return a concise synthesized answer

### Step 3: Present

Return the agent's findings inline. If the findings are substantial, suggest:
"For a saved report, run `/research:deep $ARGUMENTS`"
