---
name: ruvector:learn
description: "Record a learning, mistake, or pattern for future sessions. Use when user says \"remember this\", \"save this pattern\", \"record this mistake\", \"learn from this\", \"don't forget X\", or wants to persist an insight."
argument-hint: '[learning description]'
allowed-tools:
  - ToolSearch
  - AskUserQuestion
  - mcp__plugin_yellow-ruvector_ruvector__hooks_remember
  - mcp__plugin_yellow-ruvector_ruvector__hooks_recall
  - mcp__plugin_yellow-ruvector_ruvector__hooks_capabilities
---

# Record a Learning

Store a structured learning entry for retrieval in future sessions.

## Workflow

### Step 1: Gather Learning Context

If `$ARGUMENTS` is provided, sanitize it first:

- Strip HTML tags (replace `<[^>]+>` with empty string)
- Truncate to 2000 characters maximum
- Reject if empty after sanitization

Use the sanitized text as the learning description.

If empty, use AskUserQuestion to gather:

- **What happened?** (the situation or trigger)
- **What's the insight?** (what was learned)
- **What's the action?** (how to apply this in the future)

### Step 2: Determine Storage Type

Based on the learning content, route to the appropriate `type` value:

| Signal                                       | Type                                            |
| -------------------------------------------- | ----------------------------------------------- |
| Mistake, error, failure, correction, retry   | `context`                                       |
| Successful pattern, technique, best practice | `decision`                                      |
| Code-specific implementation note            | `code`                                          |
| Repo/project-wide background                 | `project`                                       |
| Unclear                                      | Ask via AskUserQuestion with the four options   |

Do not invent `namespace` parameters. The current MCP schema accepts `content`
and optional `type`.

### Step 3: Construct Entry

Build a structured plain-text entry:

- **Content:** Human-readable description combining context + insight + action
  (minimum 20 words)
- **Structure:** Include all three parts explicitly so future recall remains useful
- **Timestamp:** Current UTC time

### Step 4: Check for Duplicates

1. Call ToolSearch("hooks_remember"). If not found, report
   "ruvector not available. Run `/ruvector:setup` to initialize." and stop.
2. Also call ToolSearch("hooks_recall"). If not found, skip dedup and proceed
   to Step 5.
3. Warmup: call `mcp__plugin_yellow-ruvector_ruvector__hooks_capabilities()`.
   If it errors, report "ruvector not available right now. Check
   `/ruvector:status` and try again." and stop.
4. Call `mcp__plugin_yellow-ruvector_ruvector__hooks_recall` with
   `query=constructed content`, `top_k=1`.
5. If the MCP call errors with timeout, connection refused, or service
   unavailable: wait approximately 500 milliseconds and retry exactly once.
   If the retry also fails, skip dedup and proceed to Step 5.

If a match with score > 0.85 is found:

- Show the existing entry
- Use AskUserQuestion: "A similar learning already exists. Store anyway?"
- If rejected, stop

### Step 5: Store Entry

Call `mcp__plugin_yellow-ruvector_ruvector__hooks_remember` with:

- `content` = constructed entry
- `type` = selected storage type

If the MCP call errors with timeout, connection refused, or service
unavailable: wait approximately 500 milliseconds and retry exactly once.
If the retry also fails, report the error and suggest checking
`/ruvector:status`.

### Step 6: Confirm

Report the stored entry:

- Type
- Brief summary
- Entry ID (if returned by MCP)
- "This learning will be loaded in future sessions via the SessionStart hook."

## Error Handling

See `ruvector-conventions` skill for error catalog.

- **Quality gate:** If content is under 20 words, ask user to provide more
  context.
- **MCP unavailable:** "ruvector not available. Run `/ruvector:setup` to
  initialize."
- **Storage failure:** Report error, suggest checking `/ruvector:status`.
