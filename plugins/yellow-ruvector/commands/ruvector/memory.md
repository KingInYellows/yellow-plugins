---
name: ruvector:memory
description: "Browse and search stored memories and learnings. Use when user says \"show memories\", \"what do we know about X\", \"list learnings\", \"browse reflexions\", or wants to view stored agent knowledge."
argument-hint: '[filter]'
allowed-tools:
  - ToolSearch
  - AskUserQuestion
  - mcp__plugin_yellow-ruvector_ruvector__hooks_recall
  - mcp__plugin_yellow-ruvector_ruvector__hooks_stats
  - mcp__plugin_yellow-ruvector_ruvector__hooks_capabilities
---

# Browse Memories

Browse and search stored memories and learnings exposed by the current ruvector
MCP surface.

## Workflow

### Step 1: Parse Arguments

Treat `$ARGUMENTS` as a free-text filter. If the first word is a legacy label
such as `reflexion`, `skills`, `causal`, `code`, or `sessions`, keep it in the
query as a hint only; the current MCP schema does not expose server-side
namespace filtering.

Sanitize all input:

- Strip HTML tags (replace `<[^>]+>` with empty string)
- Text filter: truncate to 1000 characters maximum
- If empty after sanitization, treat it as "no filter"

### Step 2: Query Entries

1. Call ToolSearch("hooks_recall"). If not found, report:
   "ruvector not available. Run `/ruvector:setup` to initialize." and stop.
2. Warmup: call `mcp__plugin_yellow-ruvector_ruvector__hooks_capabilities()`.
   If it errors, report "ruvector not available right now. Check
   `/ruvector:status` and try again." and stop.

If a text filter is provided:

- Call `mcp__plugin_yellow-ruvector_ruvector__hooks_recall` with the filter text
- Return top 10 results ranked by similarity

If no text filter:

- Call `hooks_stats` to show the overall store summary (if available)
- Call `hooks_recall` with a broad query to show recent entries

For `hooks_recall`, if the MCP call errors with timeout, connection refused, or
service unavailable: wait approximately 500 milliseconds and retry exactly
once. If the retry also fails, report the failure and stop.

### Step 3: Display Results

Show results paginated (10 per page):

```
### Memory Results

1. **Missing index caused slow queries** (score: 0.92)
   Type: decision
   Content: Query timeout on users table. Add an index on foreign keys...
   _2 days ago_

2. **Wrong API version in client** (score: 0.88)
   Type: context
   Content: 404 errors from API calls. Check API version in the base URL...
   _5 days ago_
```

If `hooks_stats` returned an overview, show it before the result list.

### Step 4: Offer Actions

After displaying results, offer:

- **View detail:** Show full entry with all metadata
- **Refine query:** Search again with a narrower or broader phrase
- **Open referenced files:** Use Read if a result mentions a concrete path
- **Deletion note:** Current ruvector MCP tools do not expose delete operations;
  if asked to delete entries, explain that the command is read-only today

## Error Handling

See `ruvector-conventions` skill for error catalog.

- **No results:** "No matching memories found. Try a broader query or add a
  learning with `/ruvector:learn`."
- **MCP unavailable:** "ruvector not available. Run `/ruvector:setup` to
  initialize."
