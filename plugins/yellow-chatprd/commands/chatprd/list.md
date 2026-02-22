---
name: chatprd:list
description: >
  List documents in ChatPRD workspace. Use when user wants to "show my PRDs",
  "list documents", "what docs do I have", or browse their ChatPRD workspace.
argument-hint: '[optional: project name or filter]'
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
  - ToolSearch
  - mcp__plugin_chatprd_chatprd__list_organization_documents
  - mcp__plugin_chatprd_chatprd__list_projects
  - mcp__plugin_chatprd_chatprd__get_document
---

# List ChatPRD Documents

Browse documents in the ChatPRD workspace, optionally filtered by project.

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

### Step 2: Parse Input

Check `$ARGUMENTS` for an optional project filter:

- **If provided:** Validate per `chatprd-conventions` skill input validation
  rules (max 500 chars, reject path traversal, trim whitespace, strip HTML).
- **If empty:** Proceed without filter.

### Step 3: Fetch Documents

Display: "Listing documents in **[org_name]**..."

- **If project specified in `$ARGUMENTS`:** Call `list_organization_documents`
  filtered by that project name, scoped to the org from config.
- **If no project:** Call `list_projects` scoped to the org. Present available
  projects and ask via AskUserQuestion: "Filter by project, or show all
  documents?"
  - If user picks a project: `list_organization_documents` filtered by that
    project, scoped to the org.
  - If user picks "show all": `list_organization_documents` without project
    filter, scoped to the org.

### Step 4: Display Results

Present documents as a formatted list (top 20 results):

- Title
- Project (if available)
- Last updated date (if available)

If no documents found: suggest creating one with `/chatprd:create`.

### Step 5: View Details (Optional)

If user wants to read a specific document, call `get_document` to retrieve and
display the full content.

## Error Handling

See `chatprd-conventions` skill for error mapping (auth, rate limiting, server
unavailable). If the configured org is not found (404), report: "Configured org
'[org_name]' not found — it may have been deleted. Re-run `/chatprd:setup`."
