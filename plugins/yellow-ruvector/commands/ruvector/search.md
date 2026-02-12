---
name: ruvector:search
description: >
  Search codebase by meaning using vector similarity. Use when user says "find
  code that does X", "search for implementations of Y", "semantic search",
  "find similar functions", or "where is X implemented".
argument-hint: "<query>"
allowed-tools:
  - ToolSearch
  - Read
  - Grep
  - mcp__plugin_yellow-ruvector_ruvector__vector_db_search
---

# Semantic Code Search

Search the indexed codebase by meaning using vector similarity.

## Workflow

### Step 1: Validate Query

`$ARGUMENTS` must contain a search query. If empty, report: "Please provide a search query, e.g., `/ruvector:search authentication logic`"

Strip HTML tags. Max 1000 characters.

### Step 2: Check Database

Use ToolSearch to discover ruvector MCP search tools.

If the MCP tool is unavailable or DB is empty, fall back:
- Extract key terms from the query
- Use Grep to search for those terms
- Report: "ruvector not available — showing keyword search results instead"

### Step 3: Execute Vector Search

Call `vector_db_search` (or equivalent discovered via ToolSearch) with:
- Query text from `$ARGUMENTS`
- Namespace: `code`
- Top-k: 10
- Include metadata in results

### Step 4: Display Results

For each result (ranked by similarity):

```
### 1. src/auth/handler.ts (score: 0.87)

**Type:** function | **Symbols:** authenticateUser, validateToken

```typescript
async function authenticateUser(req: Request): Promise<User> {
  const token = req.headers.authorization;
  // ... code snippet ...
}
```​
```

Show:
- File path with similarity score
- Chunk type and symbols from metadata
- Code snippet with syntax highlighting
- Up to 10 results

### Step 5: Offer Actions

After showing results:
- "Use Read tool to open any of these files for full context"
- If results seem poor: "Try `/ruvector:index` to rebuild the index"

## Error Handling

See `ruvector-conventions` skill for error catalog.

- **No results:** "No matches found. Try broader terms or run `/ruvector:index` to update the index."
- **Low scores (all < 0.5):** "Results have low confidence. Consider rephrasing your query."
- **MCP unavailable:** Fall back to Grep with extracted keywords.
