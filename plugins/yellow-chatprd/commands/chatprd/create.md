---
name: chatprd:create
description: >
  Create a new document in ChatPRD. Use when user wants to "write a PRD",
  "create a spec", "draft a one-pager", "make an API doc", or create any product
  document in ChatPRD.
argument-hint: '[description of what to create]'
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

Create a new document in ChatPRD from a description, with template selection and
duplicate checking.

## Workflow

### Step 1: Read Workspace Config

```bash
if [ ! -f .claude/yellow-chatprd.local.md ]; then
  printf '[chatprd] No workspace configured.\n'
  printf 'Run /chatprd:setup to set your default org and project.\n'
  exit 1
fi
```

Read `.claude/yellow-chatprd.local.md` and parse `org_id`, `org_name`,
`default_project_id`, `default_project_name` from the YAML frontmatter.
If `org_id` is empty: Report "Config malformed. Re-run `/chatprd:setup`." and stop.

### Step 2: Parse and Validate Input

Check `$ARGUMENTS` for a document description:

- **If provided:** Validate per `chatprd-conventions` skill input validation
  rules (max 500 chars, reject path traversal, trim whitespace, strip HTML).
- **If empty:** Ask via AskUserQuestion: "What document would you like to
  create? Please provide a concise (<= 500 characters) description including
  product, surface area, and goal (e.g., PRD for auth feature, API doc for
  payments)."

### Step 3: Dedup Check (Read-Before-Write)

Search for existing documents with similar titles via `search_documents` using
key terms from the description.

- If potential duplicates found: present them and ask via AskUserQuestion:
  "Similar documents exist. Create anyway?"
- If user declines: suggest `/chatprd:update` to modify the existing document
  instead. Stop.

### Step 4: Template and Project Selection

Fetch templates in parallel with checking the project default:

- `list_templates` — show available templates

Suggest the best-fit template based on the description (see
`chatprd-conventions` skill template guide). Present options via AskUserQuestion:

- Template selection (with recommended option first)
- Project: Ask "Create in default project (**[default_project_name]**) or choose
  another?"
  - Default → use `default_project_id` from config
  - Choose another → call `list_projects` scoped to the org and present a picker

### Step 5: Confirm and Create

Present the creation summary:

- Document description
- Selected template
- Organization: [org_name]
- Project: [selected project name]

Ask user to confirm via AskUserQuestion before creating.

Call `create_document` with description, template, organization (from config),
and project.

### Step 6: Report

Display the created document:

- Document title
- URL (if available)
- Suggest next steps: "Update with `/chatprd:update` or link to Linear with
  `/chatprd:link-linear`"

## Error Handling

See `chatprd-conventions` skill for error mapping (auth, rate limiting, server
unavailable).

- If `list_templates` unavailable: skip template selection, use default
- If `list_projects` unavailable: skip project selection, accept freeform text
