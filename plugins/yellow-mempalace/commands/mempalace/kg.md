---
name: mempalace:kg
description: "Query, add, or invalidate temporal knowledge graph facts. Use when managing entity relationships, checking what was true at a point in time, or viewing entity timelines."
argument-hint: '<action> [args...]'
allowed-tools:
  - ToolSearch
  - AskUserQuestion
---

# Knowledge Graph

Manage the temporal knowledge graph — entity relationships with validity
windows.

## Workflow

### Step 1: Parse arguments

Extract action from `$ARGUMENTS`:

- **query** `<entity>` `[--as-of YYYY-MM-DD]` — Look up entity relationships
- **add** `<subject>` `<predicate>` `<object>` `[--from YYYY-MM-DD]` — Create
  a new fact
- **invalidate** `<subject>` `<predicate>` `<object>` — End a fact's validity
- **timeline** `[entity]` — Show chronological history

If no action or unrecognized action: show usage help with examples.

### Step 2: Discover MCP tools

Use ToolSearch with query `"+mempalace kg"` to find KG tools.

### Step 3: Execute action

**query**: Call `mempalace_kg_query` with entity and optional as_of date.
Display relationships grouped by direction (outgoing/incoming) with validity
windows.

**add**: Call `mempalace_kg_add` with subject, predicate, object, and optional
valid_from. Confirm the triple was created.

Example: `/mempalace:kg add "auth-service" "uses" "JWT" --from 2026-03-15`

**invalidate**: Call `mempalace_kg_invalidate` with subject, predicate, object.
Use AskUserQuestion to confirm before invalidating: "Invalidate fact:
[subject] [predicate] [object]?"

**timeline**: Call `mempalace_kg_timeline` with optional entity. Display
chronological list of facts with validity periods.

### Step 4: Display results

For query results, show each relationship as:
```
[subject] --[predicate]--> [object]
  Valid: [from] → [to or "present"]
  Source: [closet reference if available]
```

For timeline, show chronologically with dates.
