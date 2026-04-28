---
name: palace-protocol
description: "The Palace Protocol for interacting with MemPalace — wake-up sequence, query-before-assert pattern, memory stack usage, and when to use search vs KG vs navigation. Use when agents need guidance on how to interact with the palace correctly."
user-invokable: false
---

# Palace Protocol

## What It Does

Defines how agents should interact with MemPalace to maintain data integrity
and get the best results: wake-up sequence, core query-before-assert rules,
memory stack layers, and tool selection guidance for search vs knowledge graph
vs navigation.

## When to Use

Load when an agent needs to decide which mempalace tool fits the task, or at
the start of a session that will draw from palace memory. Reference the
"When to Use What" table to pick between search, KG, and navigation tools.

## Usage

### Wake-Up Sequence

On first interaction with the palace in a session:

1. Call `mempalace_status` to load palace overview and protocol spec
2. Note the wing count, room count, and drawer count
3. Use this context to scope subsequent queries

### Core Rules

1. **Query before asserting**: Never state facts about a person, project, or
   event without first querying the palace. Use `mempalace_search` or
   `mempalace_kg_query` to verify.

2. **Verify facts**: If a memory seems outdated, check the knowledge graph
   with `as_of` date filtering. Facts may have been invalidated.

3. **Record learnings**: After significant sessions, use `mempalace_diary_write`
   or `mempalace_add_drawer` to persist new knowledge.

4. **Invalidate, don't delete**: When facts change, use `mempalace_kg_invalidate`
   to end validity rather than deleting. This preserves the temporal record.

### Memory Stack (L0-L3)

| Layer | Content | When Loaded | Token Budget |
|-------|---------|-------------|-------------|
| **L0** | Identity context | Always (wake-up) | ~50 tokens |
| **L1** | Critical facts | Always (wake-up) | ~120 tokens |
| **L2** | Room recall | On-demand (scoped search) | Variable |
| **L3** | Deep semantic search | On-demand (cross-palace) | Variable |

- L0+L1 are loaded via `mempalace wake-up` (~170 tokens total)
- L2 is triggered by wing/room-scoped searches
- L3 is triggered by unfiltered `mempalace_search`

### When to Use What (Tool Selection)

| Need | Tool | Why |
|------|------|-----|
| "What do we know about X?" | `mempalace_search` | Broad semantic search |
| "What's in the auth wing?" | `mempalace_search_wing` | Scoped, higher precision |
| "What decisions did we make?" | `mempalace_search_hall` with `hall_facts` | Type-filtered |
| "Who works on what?" | `mempalace_kg_query` | Entity relationships |
| "What changed since January?" | `mempalace_kg_timeline` | Temporal history |
| "How are X and Y connected?" | `mempalace_find_tunnels` | Cross-wing discovery |
| "Save this decision" | `mempalace_add_drawer` | Verbatim storage |
| "Update a fact" | `mempalace_kg_invalidate` + `mempalace_kg_add` | Temporal fact management |

### Content Filing Guidelines

When adding content to the palace:

- **Always store verbatim** — never summarize or compress before filing
- **Choose the right wing** — match the primary domain (project, person, topic)
- **Choose a specific room** — narrow topics get better retrieval
- **Check for duplicates** — call `mempalace_check_duplicate` before `add_drawer`
- **Include source context** — use the `source_file` parameter when available
