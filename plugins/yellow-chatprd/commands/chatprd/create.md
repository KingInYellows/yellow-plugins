---
name: chatprd:create
description: >
  Create a new document in ChatPRD. Use when user wants to "write a PRD",
  "create a spec", "draft a one-pager", "make an API doc", or create any
  product document in ChatPRD.
argument-hint: "[description of what to create]"
allowed-tools:
  - Read
  - Grep
  - Bash
  - AskUserQuestion
  - ToolSearch
  - mcp__plugin_chatprd_chatprd__create_document
  - mcp__plugin_chatprd_chatprd__search_documents
  - mcp__plugin_chatprd_chatprd__list_templates
  - mcp__plugin_chatprd_chatprd__list_projects
---

# Create ChatPRD Document

Create a new document in ChatPRD from a description, with template selection and duplicate checking.

## Workflow

### Step 1: Parse and Validate Input

Check `$ARGUMENTS` for a document description:
- **If provided:** Validate per `chatprd-conventions` skill input validation rules (max 500 chars, reject path traversal, trim whitespace, strip HTML).
- **If empty:** Ask via AskUserQuestion: "What document would you like to create? (e.g., PRD for auth feature, API doc for payments)"

### Step 2: Dedup Check (Read-Before-Write)

Search for existing documents with similar titles via `search_documents` using key terms from the description.

- If potential duplicates found: present them and ask via AskUserQuestion: "Similar documents exist. Create anyway?"
- If user declines: suggest `/chatprd:update` to modify the existing document instead. Stop.

### Step 3: Template and Project Selection

Fetch templates and projects in parallel:
- `list_templates` — show available templates
- `list_projects` — show available projects

Suggest the best-fit template based on the description (see `chatprd-conventions` skill template guide). Present options via AskUserQuestion:
- Template selection (with recommended option first)
- Project selection (or "No project")

### Step 4: Confirm and Create

Present the creation summary:
- Document description
- Selected template
- Selected project (if any)

Ask user to confirm via AskUserQuestion before creating.

Call `create_document` with description, template, and project.

### Step 5: Report

Display the created document:
- Document title
- URL (if available)
- Suggest next steps: "Update with `/chatprd:update` or link to Linear with `/chatprd:link-linear`"

## Error Handling

See `chatprd-conventions` skill for error mapping (auth, rate limiting, server unavailable).

- If `list_templates` unavailable: skip template selection, use default
- If `list_projects` unavailable: skip project selection, accept freeform text
