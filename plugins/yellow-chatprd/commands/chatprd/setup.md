---
name: chatprd:setup
description: >
  Configure ChatPRD workspace — set default organization and project for all
  commands. Use when first installing the plugin, when documents are landing in
  the wrong workspace, or when switching to a different org or project.
argument-hint: ''
allowed-tools:
  - Bash
  - Read
  - Write
  - AskUserQuestion
  - ToolSearch
  - mcp__plugin_chatprd_chatprd__list_user_organizations
  - mcp__plugin_chatprd_chatprd__list_projects
  - mcp__plugin_chatprd_chatprd__list_templates
  - mcp__plugin_chatprd_chatprd__create_document
---

# Set Up ChatPRD Workspace

Discover your ChatPRD organizations and projects, save the default org and
project to `.claude/yellow-chatprd.local.md`, and optionally create a project
overview document.

## Workflow

### Step 1: Check Existing Config

```bash
[ -f .claude/yellow-chatprd.local.md ]
```

If the config exists:

- Read `.claude/yellow-chatprd.local.md` and parse `org_name` and
  `default_project_name` from the YAML frontmatter.
- Ask via AskUserQuestion: "ChatPRD is already configured for **[org_name]** /
  **[default_project_name]**. Reconfigure?"
  - **No** → Print the current config summary and stop.
  - **Yes** → Continue to Step 2.

### Step 2: Verify MCP Connectivity

Use `ToolSearch "list_user_organizations"` to confirm the ChatPRD MCP server is
reachable.

If the tool is not found: Report "[chatprd] ChatPRD MCP unavailable. Ensure
Claude Code has browser access for OAuth (required on first connection). Check
plugin installation." and stop.

### Step 3: Discover Organizations

Call `list_user_organizations`.

- **Error or timeout:** Map to error table below and stop.
- **0 results:** Report "No organizations found on your ChatPRD account. Create
  or join a team org at app.chatprd.ai first." and stop.
- **1 result:** Display "Using your only organization: **[org_name]**" —
  auto-select, no picker.
- **2+ results:** Present a numbered list and ask via AskUserQuestion: "Which
  organization is your default workspace?"

### Step 4: Discover Projects

Call `list_projects` scoped to the selected organization.

- **Error:** Map to error table below and stop.
- **0 results:** Report "No projects found in [org_name]. Create a project in
  ChatPRD first, then re-run `/chatprd:setup`." and stop.
- **1 result:** Display "Using the only project: **[project_name]**" —
  auto-select, no picker.
- **2+ results:** Present a numbered list and ask via AskUserQuestion: "Which
  project is your default?"

### Step 5: Confirm Configuration (M3)

Display a summary:

```
Organization:    [org_name]  (id: [org_id])
Default project: [project_name]  (id: [project_id])
```

Ask via AskUserQuestion: "Save this configuration?"

- **Cancel** → Report "Setup cancelled. No changes made." and stop. Do NOT
  write any files.
- **Confirm** → Continue.

### Step 6: Write Config

Write `.claude/yellow-chatprd.local.md`:

```yaml
---
schema: "1"
org_id: "[org_id]"
org_name: "[org_name]"
default_project_id: "[project_id]"
default_project_name: "[project_name]"
setup_completed_at: "[ISO-8601 timestamp]"
---

# ChatPRD Workspace Config

Configured for: **[org_name]**
Default project: **[project_name]**

Run `/chatprd:setup` to reconfigure.
```

### Step 7: Validate Written Config

```bash
grep -q 'org_id:' .claude/yellow-chatprd.local.md && \
grep -q 'default_project_id:' .claude/yellow-chatprd.local.md && \
grep -q 'schema:' .claude/yellow-chatprd.local.md
```

If validation fails: Report "[chatprd] Config validation failed. Check `.claude/`
directory permissions and re-run `/chatprd:setup`." and stop.

### Step 8: Optional — Create Project Overview Document

Ask via AskUserQuestion: "Create a project overview document in ChatPRD to
anchor this workspace?"

- **No** → Skip to Step 9.
- **Yes** → Continue:
  1. Call `list_templates` to find the One-Pager template. Fall back to the
     static template guide in `chatprd-conventions` if unavailable.
  2. Ask via AskUserQuestion: "Enter a brief description for the overview
     document (1–2 sentences):"
  3. Call `create_document` with title "[project_name] Workspace Overview",
     the One-Pager template, and the org + project from config.
  4. **If `create_document` fails:** Report the error as non-fatal: "Document
     creation failed — setup is still complete. Create one later with
     `/chatprd:create`." Continue to Step 9.
  5. On success: Display the document URL.

### Step 9: Report Completion

Print a completion summary:

```
✓ Config written to .claude/yellow-chatprd.local.md
✓ Organization: [org_name]
✓ Default project: [project_name]
[if created] ✓ Overview document: [URL]
```

Advisory: "Note: `.claude/yellow-chatprd.local.md` is gitignored in this
repository. If your project does not have `.claude/` in `.gitignore`, add it
manually."

Ask via AskUserQuestion: "What would you like to do next?"

- `/chatprd:create` — create a new document
- `/chatprd:list` — browse org documents
- `/chatprd:search` — search org documents
- Done

## Error Handling

| Error                     | Message                                                                |
| ------------------------- | ---------------------------------------------------------------------- |
| MCP tool not found        | "[chatprd] ChatPRD MCP unavailable. Check plugin installation."        |
| 0 organizations           | "No organizations found. Create one at app.chatprd.ai."                |
| 0 projects                | "No projects found in [org]. Create one in ChatPRD first."             |
| M3 cancelled              | "Setup cancelled. No changes written."                                 |
| Config validation failed  | "[chatprd] Config validation failed. Check .claude/ permissions."      |
| Document creation failed  | "Document creation failed (setup still complete). Use /chatprd:create." |

See `chatprd-conventions` skill for authentication and rate limit error codes.
