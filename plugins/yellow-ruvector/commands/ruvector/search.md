---
name: ruvector:search
description: "Search codebase by meaning using vector similarity. Use when user says \"find code that does X\", \"search for implementations of Y\", \"semantic search\", \"find similar functions\", or \"where is X implemented\"."
argument-hint: '<query>'
allowed-tools:
  - ToolSearch
  - Read
  - Grep
  - mcp__plugin_yellow-ruvector_ruvector__hooks_recall
  - mcp__plugin_yellow-ruvector_ruvector__hooks_capabilities
---

# Semantic Code Search

Search the indexed codebase by meaning using vector similarity.

## Workflow

### Step 1: Validate Query

`$ARGUMENTS` must contain a search query. If empty, report: "Please provide a
search query, e.g., `/ruvector:search authentication logic`"

Sanitize:

- Strip HTML tags (replace `<[^>]+>` with empty string)
- Truncate to 1000 characters maximum
- Reject if empty after sanitization

### Step 2: Check Database

Use ToolSearch to discover ruvector MCP search tools.

1. Call ToolSearch with query `"hooks_recall"`. If not found, fall back to
   Grep.
2. Warmup: call `mcp__plugin_yellow-ruvector_ruvector__hooks_capabilities()`.
   If it errors, fall back to Grep.

If ruvector is unavailable, fall back:

- Extract key terms from the query
- Use Grep to search for those terms
- Report: "ruvector not available — showing keyword search results instead"

### Step 3: Execute Vector Search

Call `mcp__plugin_yellow-ruvector_ruvector__hooks_recall` with:

- `query` = sanitized query text from `$ARGUMENTS`
- `top_k` = 10

If the MCP call errors with timeout, connection refused, or service
unavailable: wait approximately 500 milliseconds and retry exactly once.
If the retry also fails, fall back to Grep with extracted keywords.
Do NOT invent `namespace`, `metadata`, or other unsupported parameters.

### Step 4: Display Results

For each result (ranked by score):

````
### 1. Match (score: 0.87)

**Type:** [tool-provided type if present]

```typescript
async function authenticateUser(req: Request): Promise<User> {
  const token = req.headers.authorization;
  // ... code snippet ...
}
```​
````

Show:

- Score
- Content snippet or code block
- File paths or symbols only if the returned content clearly includes them
- Up to 10 results

### Step 5: Offer Actions

After showing results:

- "Use Read tool to open any referenced files for full context"
- If results seem poor: "Try `/ruvector:index` to rebuild the index"

## Error Handling

See `ruvector-conventions` skill for error catalog.

- **No results:** "No matches found. Try broader terms or run `/ruvector:index`
  to update the index."
- **Low scores (all < 0.5):** "Results have low confidence. Consider rephrasing
  your query."
- **MCP unavailable:** Fall back to Grep with extracted keywords.
