---
date: 2026-02-21
topic: yellow-research-plugin
---

# yellow-research Plugin

## What We're Building

A personal deep-research plugin for Claude Code that bundles best-in-class
research MCP servers (Perplexity, Tavily, EXA, GitHub/code search) and
exposes them through two distinct workflows: **code research** (inline,
context-sensitive, for active development) and **deep research** (multi-source,
saved to `docs/research/`, for long-horizon investigation).

The plugin uses a hybrid architecture: clean commands as entry points, a
conductor agent for intelligent routing in complex queries, and optional skills
for reusable research patterns.

## Two Core Workflows

### Code Research (`/research:code`)

**Trigger:** Actively coding and need to understand a library, API, pattern,
or find real-world examples.

**Behavior:**
- Inline output — synthesized answer in-context, no file saved
- Searches technical sources (EXA for semantic code search, GitHub grep,
  Context7 for library docs)
- Fast, focused: one or two targeted queries, not a multi-source deep dive
- Can compound major findings via `/compound` if the discovery is significant

### Deep Research (`/research:deep`)

**Trigger:** Long-horizon investigation — competitive analysis, technical
landscape, architectural decision support, unfamiliar domain.

**Behavior:**
- Output saved to `docs/research/<slug>.md`
- Conductor agent decides query strategy based on complexity:
  - Simple: single detailed query to Perplexity or EXA
  - Moderate: 2-3 parallel queries to complementary sources
  - Complex: full fan-out across all MCPs, converged synthesis
- Substantial findings can be passed to `/compound` for institutional knowledge

## MCP Servers

| Server | Role | Source |
|--------|------|--------|
| **Perplexity** | Web-grounded deep research, reasoning, recent news | npm/npx |
| **Tavily** | Fast web search + page extraction/crawl | npm/npx |
| **EXA** | Neural semantic search — strong for technical/code content | npm/npx |
| **GitHub search** | Code search across public repos | grep MCP or GitHub MCP |
| **Parallel-task-MCP** | Async task spawning for concurrent multi-source queries | research exact pkg in planning |

> **Note on parallelism:** The parallel-task-MCP enables truly async fan-out.
> For planning phase: verify exact npm package name and API surface.

## Why This Approach

**Hybrid architecture (commands + conductor + skills)** was chosen over:

- **Two-command only (A):** Too rigid — doesn't handle complexity adaptively.
  The conductor agent inside deep research adds intelligence without exposing
  complexity to the user.
- **Pure conductor (B):** Unpredictable for the user. Commands provide a clear
  surface with defined behavior, while the conductor handles internal routing.
- **Per-source skills (C):** Over-engineered for personal use. MCP servers
  are already the "skills" — a thin wrapper per-source adds boilerplate without value.

## Key Decisions

- **Plugin name:** `yellow-research`
- **Code research output:** Inline (no saved file). Compound major findings manually.
- **Deep research output:** `docs/research/<slug>.md` (auto-named from query)
- **Conductor scope:** Internal to deep research only — code research stays thin
- **MCP selection principle:** Best coverage across semantic (EXA), web (Perplexity/Tavily),
  and code (GitHub/grep) — avoid redundancy
- **Context7 MCP:** Already in compound-engineering — do NOT re-bundle. Code
  research can call it natively (it's already available)

## Plugin Structure (Sketch)

```
plugins/yellow-research/
  .claude-plugin/
    plugin.json          # mcpServers + commands + agents + skills
  agents/
    research-conductor.md  # Routes deep research queries, decides fan-out
    code-researcher.md     # Inline code research, uses EXA + GitHub
  commands/
    code.md              # /research:code — inline code research
    deep.md              # /research:deep — saved multi-source deep research
  skills/
    research-patterns.md # Conventions: output format, slug naming, compound trigger
  README.md
```

## Open Questions

1. **Parallel-task-MCP:** What is the exact npm package name? Is it
   `@anthropic-ai/mcp-server-tasks` or a community package? Verify in planning.
2. **EXA MCP:** Does `exa-mcp-server` require an API key env var? Confirm setup.
3. **Perplexity MCP:** Already in this repo via compound-engineering — confirm
   whether to declare a separate `mcpServers` entry or rely on the existing plugin.
4. **Tavily MCP:** Same question — already declared in compound-engineering.
   For a standalone yellow-research plugin install, does it need its own entry?
5. **Slug generation:** Should `docs/research/<slug>.md` be auto-generated from
   the query, or prompt the user to confirm the filename?
6. **Agent triggers:** Should `code-researcher` or `research-conductor` auto-trigger
   on certain patterns (e.g., "research X", "how does X work in Y"), or only
   on explicit command invocation?

## Next Steps

→ `/workflows:plan` to answer the HOW — MCP package names, command bodies,
  agent system prompts, plugin.json structure.
