---
name: chatprd:search
description: >
  Search ChatPRD workspace for documents. Use when user wants to "find a PRD",
  "search for docs about", "look up the spec for", or find any existing
  ChatPRD document.
argument-hint: "[search query]"
allowed-tools:
  - Read
  - AskUserQuestion
  - ToolSearch
  - mcp__plugin_chatprd_chatprd__search_documents
  - mcp__plugin_chatprd_chatprd__get_document
---

# Search ChatPRD Documents

Search the ChatPRD workspace for documents matching a query.

## Workflow

### Step 1: Parse and Validate Input

Check `$ARGUMENTS` for a search query:
- **If provided:** Validate per `chatprd-conventions` skill input validation rules (max 500 chars, reject path traversal, trim whitespace, strip HTML).
- **If empty:** Ask via AskUserQuestion: "What are you looking for? (e.g., auth PRD, API spec, onboarding plan)"

### Step 2: Search

Call `search_documents` with the query.

### Step 3: Display Results

Present results as a numbered list:
- Title
- Project (if available)
- Last updated date (if available)

If no results found: suggest broadening the search query or using `/chatprd:list` to browse all documents.

### Step 4: View Details (Optional)

If user wants details on a specific result, call `get_document` to retrieve and display the full content.

## Error Handling

See `chatprd-conventions` skill for error mapping (auth, rate limiting, server unavailable).
