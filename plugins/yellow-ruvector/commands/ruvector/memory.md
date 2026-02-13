---
name: ruvector:memory
description: >
  Browse, search, and manage stored memories and learnings. Use when user says
  "show memories", "what do we know about X", "list learnings", "delete memory",
  "browse reflexions", or wants to view stored agent knowledge.
argument-hint: "[namespace] [filter]"
allowed-tools:
  - ToolSearch
  - AskUserQuestion
  - mcp__plugin_yellow-ruvector_ruvector__vector_db_search
  - mcp__plugin_yellow-ruvector_ruvector__vector_db_stats
---

# Browse Memories

Browse, search, and manage stored memories and learnings across all namespaces.

## Workflow

### Step 1: Parse Arguments

From `$ARGUMENTS`, extract:
- **Namespace filter:** If first word matches a known namespace (`reflexion`, `skills`, `causal`, `code`, `sessions`), filter to that namespace. Otherwise search all.
- **Text filter:** Remaining text used as search query.

Sanitize all input:
- Strip HTML tags (replace `<[^>]+>` with empty string)
- Namespace names must match `[a-z0-9-]` only, 1-64 chars, no leading/trailing hyphens. Reject `..`, `/`, `~`.
- Text filter: truncate to 1000 characters maximum
- Reject any input that is empty after sanitization

### Step 2: Query Entries

Use ToolSearch to discover ruvector MCP tools.

If a text filter is provided:
- Call `vector_db_search` with the filter text in the target namespace(s)
- Return top 10 results ranked by similarity

If no text filter:
- Call `vector_db_stats` to show counts per namespace
- Call `vector_db_search` with a broad query to show recent entries

### Step 3: Display Results

Show results paginated (10 per page):

```
### Reflexion Entries (23 total)

1. **Missing index caused slow queries** (score: 0.92)
   Trigger: Query timeout on users table
   Action: Always add index on foreign keys
   _2 days ago_

2. **Wrong API version in client** (score: 0.88)
   Trigger: 404 errors from API calls
   Action: Check API version in base URL
   _5 days ago_
```

For `code` namespace entries, check if the source file still exists on disk (orphan detection).

### Step 4: Offer Actions

After displaying results, offer:
- **View detail:** Show full entry with all metadata
- **Delete entry:** Remove a specific entry (confirm first)
- **Delete all in namespace:** Bulk delete with AskUserQuestion confirmation (M3 pattern)

### Step 5: Handle Deletions

For single delete: confirm via AskUserQuestion, then delete.

For bulk delete:
1. Show count: "Delete all 23 reflexion entries?"
2. Use AskUserQuestion to confirm — this is destructive
3. On approval: delete all entries in namespace
4. Report: "Deleted 23 reflexion entries."

## Error Handling

See `ruvector-conventions` skill for error catalog.

- **Empty namespace:** "No entries found in [namespace]. Use `/ruvector:learn` to add learnings."
- **MCP unavailable:** "ruvector not available. Run `/ruvector:setup` to initialize."
- **Orphaned code entries:** "File no longer exists: src/old-file.ts — consider re-indexing."
