---
name: mempalace:search
description: "Search palace memories by semantic similarity with optional wing/room/hall filters. Use when recalling past decisions, facts, or context."
argument-hint: '<query> [--wing <wing>] [--room <room>] [--hall <hall>]'
allowed-tools:
  - ToolSearch
---

# Search Palace

Search for memories in the palace using semantic similarity.

## Workflow

### Step 1: Parse arguments

Extract from `$ARGUMENTS`:
- **query** (required): The search text (first unquoted argument or quoted
  string)
- **--wing** (optional): Filter to a specific wing
- **--room** (optional): Filter to a specific room
- **--hall** (optional): Filter to a specific hall type (hall_facts,
  hall_events, hall_discoveries, hall_preferences, hall_advice)

If query is empty: report "Usage: `/mempalace:search <query>` — provide a
search query." and stop.

### Step 2: Discover MCP tools

Use ToolSearch with query `"+mempalace search"` to find search tools.

### Step 3: Execute search

Choose the most specific search tool based on provided filters:

- **room filter**: Call `mempalace_search_room` with query, room, and limit=5
- **wing filter**: Call `mempalace_search_wing` with query, wing, and limit=5
- **hall filter**: Call `mempalace_search_hall` with query, hall, and limit=5
- **no filter**: Call `mempalace_search` with query and limit=5

### Step 4: Display results

For each result, show:
- Similarity score (as percentage)
- Wing and room location
- Content snippet (first 200 chars)
- Source file reference (if available)

If no results found: suggest broadening the search or checking
`/mempalace:status` to verify the palace has content.
