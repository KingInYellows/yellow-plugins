---
name: chatprd:search
description: >
  Search ChatPRD workspace for documents. Use when user wants to "find a PRD",
  "search for docs about", "look up the spec for", or find any existing ChatPRD
  document.
argument-hint: '[search query]'
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
  - ToolSearch
  - mcp__plugin_chatprd_chatprd__search_documents
  - mcp__plugin_chatprd_chatprd__get_document
---

# Search ChatPRD Documents

Search the ChatPRD workspace for documents matching a query.

## Workflow

### Step 1: Read Workspace Config

```bash
if [ ! -f .claude/yellow-chatprd.local.md ]; then
  printf '[chatprd] No workspace configured.\n'
  printf 'Run /chatprd:setup to set your default org and project.\n'
  exit 1
fi
```

Read `.claude/yellow-chatprd.local.md` and parse `org_id` and `org_name` from
the YAML frontmatter. If `org_id` is empty: Report "Config malformed. Re-run
`/chatprd:setup`." and stop.

### Step 2: Parse and Validate Input

Check `$ARGUMENTS` for a search query:

- **If provided:** Validate per `chatprd-conventions` skill input validation
  rules (max 500 chars, reject path traversal, trim whitespace, strip HTML).
- **If empty:** Ask via AskUserQuestion: "What are you looking for? (e.g., auth
  PRD, API spec, onboarding plan)"

### Step 3: Search

Display: "Searching in **[org_name]**..."

Call `search_documents` with the query. Pass the `org_id` from config as the
organization scope if the tool schema supports it — check the tool's input
schema at runtime to confirm. If no org scope parameter exists, search is global
across the authenticated account.

### Step 4: Display Results

Present results as a numbered list:

- Title
- Project (if available)
- Last updated date (if available)

If no results found: suggest broadening the search query or using
`/chatprd:list` to browse all documents.

### Step 5: View Details (Optional)

If user wants details on a specific result, call `get_document` to retrieve and
display the full content.

## Error Handling

See `chatprd-conventions` skill for full error mapping (authentication,
subscription, document not found, rate limiting, network timeouts, and MCP tool
availability).
