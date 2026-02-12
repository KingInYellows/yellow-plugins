---
name: ruvector:learn
description: >
  Record a learning, mistake, or pattern for future sessions. Use when user
  says "remember this", "save this pattern", "record this mistake", "learn
  from this", "don't forget X", or wants to persist an insight.
argument-hint: "[learning description]"
allowed-tools:
  - ToolSearch
  - AskUserQuestion
  - mcp__plugin_yellow-ruvector_ruvector__vector_db_insert
  - mcp__plugin_yellow-ruvector_ruvector__vector_db_search
---

# Record a Learning

Store a structured learning entry (reflexion, skill, or causal observation) for retrieval in future sessions.

## Workflow

### Step 1: Gather Learning Context

If `$ARGUMENTS` is provided, use it as the learning description.

If empty, use AskUserQuestion to gather:
- **What happened?** (the situation or trigger)
- **What's the insight?** (what was learned)
- **What's the action?** (how to apply this in the future)

### Step 2: Determine Namespace

Based on the learning content, route to the appropriate namespace:

| Signal | Namespace |
|--------|-----------|
| Mistake, error, failure, correction, retry | `reflexion` |
| Successful pattern, technique, best practice | `skills` |
| "X caused Y", debugging observation | `causal` |
| Unclear | Ask via AskUserQuestion with the three options |

Validate namespace name matches `[a-z0-9-]` (see `ruvector-conventions` skill).

### Step 3: Construct Entry

Build a structured entry per the schema in `ruvector-conventions` skill:

- **Content:** Human-readable description combining context + insight + action (minimum 20 words)
- **Metadata:** Appropriate fields for the chosen namespace (`trigger`/`insight`/`action` for reflexion, `pattern`/`context`/`benefit` for skills, `cause`/`effect`/`context` for causal)
- **Timestamp:** Current UTC time

### Step 4: Check for Duplicates

Use ToolSearch to discover ruvector search tools, then search the target namespace for similar entries (cosine similarity).

If a match with score > 0.85 is found:
- Show the existing entry
- Use AskUserQuestion: "A similar learning already exists. Store anyway?"
- If rejected, stop

### Step 5: Store Entry

Call `vector_db_insert` (via ToolSearch discovery) with the constructed entry in the appropriate namespace.

### Step 6: Confirm

Report the stored entry:
- Namespace
- Brief summary
- Entry ID (if returned by MCP)
- "This learning will be loaded in future sessions via the SessionStart hook."

## Error Handling

See `ruvector-conventions` skill for error catalog.

- **Quality gate:** If content is under 20 words, ask user to provide more context.
- **MCP unavailable:** "ruvector not available. Run `/ruvector:setup` to initialize."
- **Storage failure:** Report error, suggest checking `/ruvector:status`.
