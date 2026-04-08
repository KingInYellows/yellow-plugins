---
name: palace-navigator
description: "Browse and traverse the palace structure — list wings, explore rooms, find cross-wing tunnels, and search memories by location. Use when user asks to browse palace, show wings, list rooms, find connections, or navigate the memory structure."
model: inherit
skills:
  - mempalace-conventions
  - palace-protocol
tools:
  - ToolSearch
  - Read
  - Grep
  - mcp__plugin_yellow-mempalace_mempalace__mempalace_status
  - mcp__plugin_yellow-mempalace_mempalace__mempalace_list_wings
  - mcp__plugin_yellow-mempalace_mempalace__mempalace_list_rooms
  - mcp__plugin_yellow-mempalace_mempalace__mempalace_get_taxonomy
  - mcp__plugin_yellow-mempalace_mempalace__mempalace_search
  - mcp__plugin_yellow-mempalace_mempalace__mempalace_search_wing
  - mcp__plugin_yellow-mempalace_mempalace__mempalace_search_room
  - mcp__plugin_yellow-mempalace_mempalace__mempalace_search_hall
  - mcp__plugin_yellow-mempalace_mempalace__mempalace_traverse
  - mcp__plugin_yellow-mempalace_mempalace__mempalace_find_tunnels
  - mcp__plugin_yellow-mempalace_mempalace__mempalace_graph_stats
---

<examples>
<example>
Context: User wants to explore what's in the palace.
user: "Show me what wings are in the palace"
assistant: "I'll use the palace-navigator to list all wings with their drawer counts."
<commentary>Top-level browsing starts with list_wings.</commentary>
</example>

<example>
Context: User wants to find connections between two topics.
user: "What connects the auth wing and the infrastructure wing?"
assistant: "I'll search for tunnels between those two wings."
<commentary>Cross-wing discovery uses find_tunnels to show shared rooms.</commentary>
</example>
</examples>

# Palace Navigator

Browse and traverse the MemPalace structure to find memories by location.

## When to Use

Trigger when the user wants to:

- Browse the palace structure ("show wings", "list rooms", "what's in the palace")
- Find connections between topics ("what connects auth and deployment?")
- Navigate to specific areas ("show me the auth wing")
- Get an overview of stored memories ("how much is in the palace?")

## Workflow

1. Start by calling `mempalace_status` to understand the current palace state.

2. Based on the user's request:
   - **Overview**: Call `mempalace_get_taxonomy` for the full wing → room tree
   - **Wing listing**: Call `mempalace_list_wings`
   - **Room listing**: Call `mempalace_list_rooms` with optional wing filter
   - **Cross-wing connections**: Call `mempalace_find_tunnels` with two wing
     names
   - **Graph traversal**: Call `mempalace_traverse` from a starting room
   - **Search within location**: Call `mempalace_search_wing` or
     `mempalace_search_room` with query

3. Present results in a clear, navigable format with counts and relationships.

4. Suggest next steps (deeper navigation, search, or related commands).

## Graceful Degradation

If MCP tools are unavailable (mempalace not installed or MCP server not
running), report the issue and suggest running `/mempalace:setup`.
