---
name: mempalace-conventions
description: "MemPalace MCP tool naming, palace structure terminology, memory types, search patterns, KG format, error handling, and graceful degradation conventions. Use when agents or commands need mempalace integration context."
user-invokable: false
---

# MemPalace Conventions

## MCP Tool Naming

All tools follow the pattern:
`mcp__plugin_yellow-mempalace_mempalace__mempalace_<tool_name>`

Example: `mcp__plugin_yellow-mempalace_mempalace__mempalace_search`

## Palace Structure Terminology

| Term | Description | Example |
|------|-------------|---------|
| **Wing** | Top-level container (project, person, topic) | `wing_myproject` |
| **Room** | Specific subject within a wing | `auth-migration` |
| **Hall** | Memory type classifier within a wing | `hall_facts` |
| **Tunnel** | Cross-wing connection (room in multiple wings) | `jwt-setup` in both auth and myproject |
| **Closet** | Summary pointing to original content | Compressed overview |
| **Drawer** | Original verbatim content (never summarized) | Raw source text |

## Memory Types (Halls)

| Hall | Purpose | Example Content |
|------|---------|-----------------|
| `hall_facts` | Decisions and locked-in choices | "We chose GraphQL over REST" |
| `hall_events` | Sessions, milestones, debugging | "Auth migration completed 2026-03-15" |
| `hall_discoveries` | Breakthroughs and insights | "ChromaDB performs 3x better with room filtering" |
| `hall_preferences` | Habits, opinions, likes | "Team prefers conventional commits" |
| `hall_advice` | Recommendations and solutions | "Use pipx for Python tools to avoid PEP 668" |

## Search Filter Patterns

Narrow searches progressively for better results:
1. **Unfiltered**: `mempalace_search` — broad search across entire palace
2. **Wing-filtered**: `mempalace_search_wing` — +12% retrieval boost
3. **Room-filtered**: `mempalace_search_room` — +34% retrieval boost
4. **Hall-filtered**: `mempalace_search_hall` — filter by memory type

Always prefer the most specific filter available.

## Knowledge Graph Triple Format

```
subject --predicate--> object
  valid_from: YYYY-MM-DD
  valid_to: YYYY-MM-DD (or null if still valid)
  source_closet: reference to source
```

- Use `kg_query` with `as_of` date to see point-in-time state
- Use `kg_invalidate` to end a fact's validity (never delete)
- Use `kg_timeline` for chronological entity history

## Error Handling

| Error | Action |
|-------|--------|
| MCP tool not found | Run ToolSearch to discover tools; suggest `/mempalace:setup` |
| MCP execution error | Report error; suggest checking `mempalace status` |
| Palace not initialized | Suggest `mempalace init` or `/mempalace:setup` |
| Empty search results | Suggest broadening query or checking `/mempalace:status` |
| Duplicate detected | Show existing drawer; ask user whether to proceed |

## Graceful Degradation

- If MCP tools are unavailable: report clearly, suggest `/mempalace:setup`
- If palace is empty: guide user to `/mempalace:mine` for initial indexing
- If ChromaDB cold start delays: first MCP call may take 2-5 seconds — this
  is normal
- Never silently fail — always report the issue to the user

## Input Validation

- Search queries: strip HTML tags, max 1000 characters
- Wing/room names: lowercase, alphanumeric with hyphens
- KG entities: non-empty strings, max 200 characters
- Content for drawers: non-empty, verbatim (never summarize before filing)
