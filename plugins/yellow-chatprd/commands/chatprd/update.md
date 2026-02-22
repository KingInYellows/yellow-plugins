---
name: chatprd:update
description: >
  Update an existing ChatPRD document. Use when user wants to "update the PRD",
  "add requirements to", "revise the spec", or modify any existing ChatPRD
  document.
argument-hint: '[document title or description of changes]'
allowed-tools:
  - Bash
  - Read
  - Grep
  - AskUserQuestion
  - ToolSearch
  - mcp__plugin_chatprd_chatprd__search_documents
  - mcp__plugin_chatprd_chatprd__get_document
  - mcp__plugin_chatprd_chatprd__update_document
---

# Update ChatPRD Document

Find and update an existing document in ChatPRD with TOCTOU protection.

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

Check `$ARGUMENTS` for a document title, ID, or change description:

- **If provided:** Validate per `chatprd-conventions` skill input validation
  rules (max 500 chars, reject path traversal, trim whitespace, strip HTML).
- **If empty:** Ask via AskUserQuestion: "Which document do you want to update?"

### Step 3: Find Document

Call `search_documents` to locate the target document. Pass the `org_id` from
config as the organization scope if the tool schema supports it.

- If multiple matches: present results and ask user to confirm which one via
  AskUserQuestion.
- If no matches: suggest `/chatprd:search` with different terms or
  `/chatprd:list` to browse. Stop.

### Step 4: Validate and Show Current Content (C1)

Call `get_document` to verify the document exists and retrieve its current
content.

Display the current content summary so the user can see what they're modifying.

### Step 5: Describe Changes

Ask user to describe the desired changes via AskUserQuestion:

- "What changes should be made to this document?"

### Step 6: TOCTOU Re-fetch (H1)

**Critical:** Re-fetch the document with `get_document` immediately before
writing. The content may have changed during the user interaction in Step 5. Do
NOT rely on the content fetched in Step 4.

### Step 7: Confirm Changes (M3)

Present the proposed changes to the user. If the document content changed since
Step 4, highlight the differences. Ask user to confirm via AskUserQuestion
before applying.

### Step 8: Update

Call `update_document` with the changes applied to the freshly-fetched content.

### Step 9: Report

Display confirmation:

- Document title
- Summary of changes applied
- Document URL (if available)

## Error Handling

See `chatprd-conventions` skill for error mapping (auth, rate limiting, not
found, server unavailable).

- If document was deleted between Steps 4 and 6: report "Document no longer
  exists" and stop.
