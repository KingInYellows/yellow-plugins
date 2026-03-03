---
name: chatprd:create
description: "Create a new document in ChatPRD. Use when user wants to \"write a PRD\", \"create a spec\", \"draft a one-pager\", \"make an API doc\", or create any product document in ChatPRD."
argument-hint: '[description of what to create]'
allowed-tools:
  - Read
  - Grep
  - Bash
  - AskUserQuestion
  - ToolSearch
  - mcp__plugin_yellow-chatprd_chatprd__create_document
  - mcp__plugin_yellow-chatprd_chatprd__search_documents
  - mcp__plugin_yellow-chatprd_chatprd__list_templates
  - mcp__plugin_yellow-chatprd_chatprd__list_projects
---

# Create ChatPRD Document

Create a new document in ChatPRD from a description, with template selection and
duplicate checking.

## Workflow

### Step 1: Read Workspace Config

```bash
# Kept inline for command self-containedness — see chatprd-conventions Workspace Config section
if [ ! -f .claude/yellow-chatprd.local.md ] || \
   ! grep -qE '^org_id: ".+"' .claude/yellow-chatprd.local.md; then
  printf '[chatprd] No workspace configured or config malformed.\n' >&2
  printf 'Run /chatprd:setup to set your default org and project.\n' >&2
  exit 1
fi
```

Read `.claude/yellow-chatprd.local.md` and parse `org_id`, `org_name`,
`default_project_id`, `default_project_name` from the YAML frontmatter.

### Step 2: Parse and Validate Input

Check `$ARGUMENTS` for a document description:

- **If provided:** Validate per `chatprd-conventions` skill input validation rules.
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
  - Choose another → call `list_projects` scoped to the org and present a picker.
    If `list_projects` fails, fall back to `default_project_id` from config with a
    user-facing notice.
    If `list_projects` returns an error or 404 (org not found): report "Configured
    org not found — it may have been deleted. Re-run `/chatprd:setup` to
    reconfigure." and stop.

### Step 5: Inject Repository Context (Optional)

Only applies to technical templates ("Technical Design Document" or "API
Documentation"). For non-technical templates, skip to Step 6.

a. Discover DeepWiki tools via `ToolSearch` with query `"read_wiki_structure"`.
   If not found: display "Tip: Install yellow-devin for automatic repository
   context in technical specs." Skip to Step 6.

b. Ask via `AskUserQuestion`: "Pull architecture context from the repository
   via DeepWiki? [Yes / No]". If no, skip to Step 6.

c. Determine the repository name from git remote:
   ```bash
   git remote get-url origin 2>/dev/null | sed 's/.*github.com[:/]//' | sed 's/.git$//'
   ```
   If the result is empty (no git remote or not a GitHub repo): display
   "No repository detected. Proceeding without DeepWiki context." Skip to
   Step 6.

d. Call `read_wiki_structure` with the repo name. If empty or error: display
   "No repository context available from DeepWiki. Proceeding without it."
   Skip to Step 6.

e. Extract architecture-relevant sections and inject into the document outline
   as additional `description` content (e.g., architecture section gets
   component overview, dependencies section gets dependency list).

**Cross-plugin dependency:** yellow-devin (optional). Graceful degradation at
every step — the command works identically without yellow-devin installed.

### Step 6: Confirm and Create

Present the creation summary:

- Document description
- Selected template
- Organization: [org_name]
- Project: [selected project name]
- Repository context: [included / not included]

Ask user to confirm via AskUserQuestion before creating.

Call `create_document` with description, template, organization (from config),
and project.

### Step 7: Report

Display the created document:

- Document title
- URL (if available)
- Suggest next steps: "Update with `/chatprd:update` or link to Linear with
  `/chatprd:link-linear`"

## Error Handling

See `chatprd-conventions` skill for error mapping (auth, rate limiting, server
unavailable).

- If `list_templates` unavailable: skip template selection, use default
- If `list_projects` unavailable or fails: use `default_project_id` from config
  and inform user: "Could not load project list — using default project
  **[default_project_name]**." Do NOT accept freeform project names.
