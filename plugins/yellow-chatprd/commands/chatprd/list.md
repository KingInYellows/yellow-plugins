---
name: chatprd:list
description: >
  List documents in ChatPRD workspace. Use when user wants to "show my PRDs",
  "list documents", "what docs do I have", or browse their ChatPRD workspace.
argument-hint: "[optional: project name or filter]"
allowed-tools:
  - AskUserQuestion
  - ToolSearch
  - mcp__plugin_chatprd_chatprd__list_documents
  - mcp__plugin_chatprd_chatprd__list_projects
  - mcp__plugin_chatprd_chatprd__get_document
---

# List ChatPRD Documents

Browse documents in the ChatPRD workspace, optionally filtered by project.

## Workflow

### Step 1: Parse Input

Check `$ARGUMENTS` for an optional project filter:
- **If provided:** Validate per `chatprd-conventions` skill input validation rules (max 500 chars, reject path traversal, trim whitespace).
- **If empty:** Proceed without filter.

### Step 2: Fetch Documents

- **If project specified:** Call `list_documents` filtered by project name.
- **If no project:** Call `list_projects` first. Present available projects and ask via AskUserQuestion: "Filter by project, or show all documents?"
  - If user picks a project: `list_documents` filtered by that project.
  - If user picks "show all": `list_documents` without filter.

### Step 3: Display Results

Present documents as a formatted list (top 20 results):
- Title
- Project (if available)
- Last updated date (if available)

If no documents found: suggest creating one with `/chatprd:create`.

### Step 4: View Details (Optional)

If user wants to read a specific document, call `get_document` to retrieve and display the full content.

## Error Handling

See `chatprd-conventions` skill for error mapping (auth, rate limiting, server unavailable).
