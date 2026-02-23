---
title: "feat: ChatPRD setup command and org-scoped operations"
type: feat
date: 2026-02-22
brainstorm: docs/brainstorms/2026-02-22-chatprd-setup-command-brainstorm.md
---

# feat: ChatPRD Setup Command & Org-Scoped Operations

## Overview

Add a `/chatprd:setup` command that discovers ChatPRD organizations and projects via MCP, persists the user's default org + project to `.claude/yellow-chatprd.local.md`, and optionally creates a project overview document. Update all five existing commands (`create`, `list`, `search`, `update`, `document-assistant`) to read this config and use org-scoped MCP tools automatically.

**Root problem:** The plugin currently uses only personal-scope MCP tools (`list_documents`, `create_document`). ChatPRD exposes `list_user_organizations` and `list_organization_documents` that the plugin never calls — so all documents land in personal space instead of the team org.

---

## Problem Statement

- `list_user_organizations` and `list_organization_documents` MCP tools exist but are unused
- No config persistence — commands never know which org/project to default to
- First-run experience: all commands silently create personal documents
- No way to verify which org context is active

---

## Technical Approach

### Architecture

```text
.claude/yellow-chatprd.local.md   ← written by /chatprd:setup
        │
        ├── read by: create.md, list.md, search.md, update.md
        └── read by: document-assistant.md agent

ChatPRD MCP tools used:
  New: list_user_organizations, list_organization_documents
  Existing: list_projects (needs org_id param), create_document (needs org_id param)
  Unchanged: search_documents (global), get_document, update_document, list_templates
```

### Config File Schema

**Location:** `.claude/yellow-chatprd.local.md`

```yaml
---
schema: "1"
org_id: "org_abc123"
org_name: "Acme Corp"
default_project_id: "proj_456def"
default_project_name: "Product Q1 2026"
setup_completed_at: "2026-02-22T10:30:00Z"
---

# ChatPRD Workspace Config

Configured for: **Acme Corp**
Default project: **Product Q1 2026**

Run `/chatprd:setup` to reconfigure.
```

> **Security:** No credentials stored — auth is handled by MCP OAuth automatically.

### MCP Tool Prefix

All new tools follow the empirically verified prefix used by existing commands:
`mcp__plugin_chatprd_chatprd__`

New tools to add to `allowed-tools`:
- `mcp__plugin_chatprd_chatprd__list_user_organizations`
- `mcp__plugin_chatprd_chatprd__list_organization_documents`

> **⚠️ CRITICAL — Resolve Before Implementation:** The exact parameter names for org-scoped tools (what parameter does `list_organization_documents` accept? `organization_id`? `org_id`?) must be discovered empirically via `ToolSearch` on a live ChatPRD connection before authoring any command file. Wrong parameter names cause silent tool failures.

---

## Implementation Phases

### Phase 1: Schema Discovery (Prerequisite — Must Run First)

**Before writing any files**, connect to ChatPRD MCP and inspect tool schemas.

**Steps:**
1. Use `ToolSearch "list_user_organizations"` to load the tool
2. Inspect the full JSON schema for each org-scoped tool:
   - `list_user_organizations` — What does it return? What parameters?
   - `list_organization_documents` — What org parameter does it accept? (`organization_id`? `org_id`? `workspace_id`?)
   - `list_projects` — Does it accept an org scope parameter?
   - `create_document` — Does it accept `organization_id` and `project_id`?
   - `search_documents` — Does it accept an org scope parameter? (Assumption: no — treat as global)
3. Document exact parameter names in Phase 2 (`chatprd-conventions` skill update)

**Resolution criteria:** All 5 tool schemas documented with exact parameter names and return shapes.

---

### Phase 2: Update `chatprd-conventions` Skill

**File:** `plugins/yellow-chatprd/skills/chatprd-conventions/SKILL.md`

**Add three new sections:**

#### Section: Config Reading Pattern

Canonical pattern that every command uses to read the config:

```bash
# 1. Check config exists
if [ ! -f .claude/yellow-chatprd.local.md ]; then
  printf '[chatprd] No workspace configured.\n'
  printf '[chatprd] Run /chatprd:setup to set your default org and project.\n'
  exit 1
fi

# 2. Validate required fields
if ! grep -q 'org_id:' .claude/yellow-chatprd.local.md || \
   ! grep -q 'default_project_id:' .claude/yellow-chatprd.local.md || \
   ! grep -q 'schema:' .claude/yellow-chatprd.local.md; then
  printf '[chatprd] Config malformed. Re-run /chatprd:setup.\n' >&2
  exit 1
fi
```

Or via `Read` tool: Read `.claude/yellow-chatprd.local.md` and parse `org_id`, `org_name`, `default_project_id`, `default_project_name` from YAML frontmatter.

**Decision:** Use `Read` tool (not Bash grep) for extracting values, since the model can directly parse YAML frontmatter. Use Bash for the existence check only.

#### Section: Org Error Codes

Add to the error mapping table:

| Error | Message | Action |
|---|---|---|
| No config file | "No workspace configured. Run /chatprd:setup first." | Stop command |
| Config malformed | "Config malformed. Re-run /chatprd:setup." | Stop command |
| Org not found (404 on org-scoped call) | "Configured org '[org_name]' not found — it may have been deleted. Re-run /chatprd:setup." | Stop command |
| No organizations | "No organizations found on your ChatPRD account. Create or join a team org at app.chatprd.ai first." | Stop setup |
| No projects in org | "No projects found in [org_name]. Create a project in ChatPRD first, then re-run /chatprd:setup." | Stop setup |

#### Section: Org-Scoped Tool Parameter Names

Document the exact parameter names resolved in Phase 1. Example:

```yaml
list_organization_documents:
  organization_id: <value from org_id in config>

list_projects (org-scoped):
  organization_id: <value from org_id in config>

create_document (org-scoped):
  organization_id: <value from org_id in config>
  project_id: <value from default_project_id in config>
```

> Fill in exact names after Phase 1 empirical discovery.

---

### Phase 3: Create `/chatprd:setup` Command

**File:** `plugins/yellow-chatprd/commands/chatprd/setup.md` ← **NEW FILE**

#### Frontmatter

```yaml
---
description: Configure ChatPRD workspace — set default organization and project for all commands
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
```

> Note: `list_organization_documents` is NOT needed in setup — only `list_user_organizations`, `list_projects`, and optional `create_document`.

#### Command Flow

```text
Step 1: Check existing config
  - Bash: [ -f .claude/yellow-chatprd.local.md ]
  - If exists: Read it, extract current org_name + default_project_name
  - AskUserQuestion: "ChatPRD is configured for [org_name] / [project_name]. Reconfigure?"
    - NO → Print current config summary, stop (F5 path)
    - YES → Continue

Step 2: Verify MCP connectivity
  - ToolSearch "list_user_organizations"
  - If tool not found: "[chatprd] ChatPRD MCP unavailable. Ensure Claude Code has browser access
    for OAuth. See plugin README." → Stop

Step 3: Discover organizations
  - list_user_organizations (no params)
  - If error/timeout: map to chatprd-conventions error table → Stop
  - If 0 results: "No organizations found. Create or join a team org at app.chatprd.ai first." → Stop
  - If 1 result: Display "Using your only organization: [org_name]" — auto-select, no picker
  - If N results: AskUserQuestion with numbered list → user picks

Step 4: Discover projects in selected org
  - list_projects (organization_id: <selected_org_id>)
  - If error: map to error table → Stop
  - If 0 results: "No projects found in [org_name]. Create a project in ChatPRD first." → Stop
  - If 1 result: Display "Using the only project: [project_name]" — auto-select, no picker
  - If N results: AskUserQuestion with numbered list → user picks

Step 5: M3 Confirmation
  - Display summary table:
    Organization:     Acme Corp  (org_id: org_abc123)
    Default project:  Product Q1 2026  (proj_id: proj_456)
  - AskUserQuestion: "Save this configuration?"
    - Cancel → "Setup cancelled. No changes made." → Stop (nothing written)
    - Confirm → Continue

Step 6: Write config
  - Write .claude/yellow-chatprd.local.md with full schema
  - Include schema: "1", org_id, org_name, default_project_id, default_project_name, setup_completed_at

Step 7: Validate written config (read-back check)
  - Bash: grep -q 'org_id:' .claude/yellow-chatprd.local.md
  - Bash: grep -q 'default_project_id:' .claude/yellow-chatprd.local.md
  - Bash: grep -q 'schema:' .claude/yellow-chatprd.local.md
  - If any check fails: "[chatprd] Config validation failed. Check .claude/ permissions
    and re-run /chatprd:setup." → Stop

Step 8: Optional — Create project overview document
  - AskUserQuestion: "Create a project overview document in ChatPRD to anchor this workspace?"
    - No → Skip to Step 9
    - Yes → Continue
  - list_templates (to find One-Pager template ID)
  - AskUserQuestion: "Enter a brief description for your project overview (1-2 sentences):"
  - create_document:
      title: "[project_name] Workspace Overview"
      template: One-Pager (or fallback from conventions skill if list_templates fails)
      organization_id: <org_id>
      project_id: <default_project_id>
      content: Brief description from user
  - If create_document fails: Non-fatal. Report error, continue to Step 9.
  - Display document URL on success.

Step 9: Report completion
  - Print summary:
      ✓ Config written to .claude/yellow-chatprd.local.md
      ✓ Organization: [org_name]
      ✓ Default project: [project_name]
      [optional] ✓ Overview document: [URL]
  - Note: "Note: .claude/yellow-chatprd.local.md is gitignored in this project.
    If your project does not have .claude/ in .gitignore, add it manually."
  - AskUserQuestion: "What would you like to do next?"
    - /chatprd:create — create a new document
    - /chatprd:list — browse org documents
    - /chatprd:search — search org documents
    - Done
```

#### Error Table (bottom of file)

| Situation | Message |
|---|---|
| MCP tool not found | "[chatprd] ChatPRD MCP unavailable. See README." |
| 0 organizations | "No organizations found. Create one at app.chatprd.ai." |
| 0 projects | "No projects found in [org]. Create one in ChatPRD first." |
| M3 cancelled | "Setup cancelled. No changes written." |
| Config write failed | "Config validation failed. Check .claude/ permissions." |
| Document create failed | "Document creation failed (setup still complete). Create one later with /chatprd:create." |

---

### Phase 4: Update All Consuming Commands

For each command, make these changes:

#### 4a. `allowed-tools` Changes (All Commands)

| File | Add | Remove | Keep |
|---|---|---|---|
| `create.md` | `Read` | — | All existing (`list_projects` body gets org_id param added) |
| `list.md` | `Read`, `Bash`, `mcp__...__list_organization_documents` | `mcp__...__list_documents` | All existing |
| `search.md` | `Read`, `Bash` | — | All existing |
| `update.md` | `Read`, `Bash` | — | All existing |

> Note: `create.md` never called `list_documents` — it uses `list_projects` for the project picker, which stays but now receives `organization_id` as a body param. Only `list.md` swaps `list_documents` for `list_organization_documents`.

#### 4b. Config-Reading Step (All Commands)

Add as **Step 1** in each command, before any existing steps:

```text
Step 1: Read workspace config
  - Bash: if [ ! -f .claude/yellow-chatprd.local.md ]; then
      printf '[chatprd] No workspace configured.\n'
      printf 'Run /chatprd:setup to set your default org and project.\n'
      exit 1
    fi
  - Read .claude/yellow-chatprd.local.md
  - Parse: ORG_ID, ORG_NAME, DEFAULT_PROJECT_ID, DEFAULT_PROJECT_NAME from YAML frontmatter
  - Validate: ORG_ID is non-empty; if empty: "[chatprd] Config malformed. Re-run /chatprd:setup."
```

#### 4c. `/chatprd:list` — Full Step Changes

**Before:** calls `list_projects` if no filter, then `list_documents`
**After:** calls `list_organization_documents` with org_id from config

Updated flow:
1. (NEW) Read config → parse ORG_ID, DEFAULT_PROJECT_ID
2. Display: "Listing documents in [ORG_NAME]"
3. If `$ARGUMENTS` contains a project filter → use it; else ask user (project picker or "show all")
4. `list_organization_documents` (organization_id: ORG_ID, [project_id: filter if selected])
5. Display numbered list (title, project, date) — top 20
6. Offer to `get_document` for full content

#### 4d. `/chatprd:create` — Full Step Changes

**Before:** calls `list_projects` for picker, then `create_document` (personal scope)
**After:** uses DEFAULT_PROJECT_ID from config as default; still lets user override

Updated flow:
1. (NEW) Read config → parse ORG_ID, DEFAULT_PROJECT_ID, DEFAULT_PROJECT_NAME
2. Validate input (existing dedup search step unchanged)
3. `list_templates` (unchanged)
4. AskUserQuestion: "Create in default project ([DEFAULT_PROJECT_NAME]) or choose another?"
   - Default → use DEFAULT_PROJECT_ID
   - Choose → `list_projects` (organization_id: ORG_ID) → picker
5. M3 confirmation (unchanged, but now shows org context)
6. `create_document` (organization_id: ORG_ID, project_id: selected_project_id, ...)
7. Report with document URL

#### 4e. `/chatprd:search` — Full Step Changes

**Assumption:** `search_documents` is global — no org scope parameter. Verify empirically in Phase 1.
If global: search step is unchanged. Config is read (for future use) but not passed to search.
If org-scoped: add `organization_id: ORG_ID` param to `search_documents` call.

Updated flow:
1. (NEW) Read config → parse ORG_ID (used for stale-config error detection only, or passed to search)
2. Display: "Searching in [ORG_NAME]..."
3. `search_documents` (add org_id param IF schema supports it — resolve in Phase 1)
4. Rest unchanged

#### 4f. `/chatprd:update` — Full Step Changes

**Before:** `search_documents` → `get_document` → (discuss) → re-fetch → `update_document`
**After:** Config adds org context for the initial search; update itself is unchanged (doc ID is sufficient)

Updated flow:
1. (NEW) Read config → parse ORG_ID
2. `search_documents` (with org scope if supported — same as search command decision)
3. `get_document` (C1 pattern — show current state; unchanged)
4. (Discuss changes — unchanged)
5. H1 re-fetch before write (unchanged)
6. M3 confirm → `update_document` (unchanged — uses doc ID, no org param needed)

---

### Phase 5: Update `document-assistant` Agent

**File:** `plugins/yellow-chatprd/agents/workflow/document-assistant.md`

**Changes:**
1. Add `Read`, `Bash`, `mcp__plugin_chatprd_chatprd__list_organization_documents` to `allowed-tools`
2. Add opening rule: "At the start of any session, check `.claude/yellow-chatprd.local.md`. If missing, surface: 'Run /chatprd:setup to configure your workspace' and stop."
3. Replace `list_documents` → `list_organization_documents` (org-scoped)
4. In create flow: default to `default_project_id` from config, offer to override
5. In list flow: use `list_organization_documents` with org context

> `list_user_organizations` is NOT added to the agent — the agent reads `org_id` from the already-written config. It has no reason to re-discover organizations.
>
> Keep agent under 120 lines — trim LLM training data, keep safety rules + trigger clauses.

---

## Acceptance Criteria

### Functional

- [x] `/chatprd:setup` discovers and displays all orgs/projects via MCP before writing any config
- [x] Config written to `.claude/yellow-chatprd.local.md` with `schema: "1"` and all required fields
- [x] Config validated by read-back grep after write; failure surfaces actionable error
- [x] Single-org accounts auto-select silently and surface the choice in M3 confirmation
- [x] Zero-org and zero-project states produce clear, actionable error messages (no crash)
- [x] M3 cancellation writes nothing to disk
- [x] Existing config triggers "Reconfigure?" prompt showing current values before overwriting
- [x] All five commands (`create`, `list`, `search`, `update`, `document-assistant`) check for config on first use
- [x] Missing config produces: "[chatprd] No workspace configured. Run /chatprd:setup."
- [x] `/chatprd:list` uses `list_organization_documents` (not `list_documents`)
- [x] `/chatprd:create` defaults to `default_project_id` from config; user can override
- [x] Optional document creation failure is non-fatal; setup completes successfully regardless
- [x] Gitignore advisory included in setup completion report

### Non-Functional

- [x] Setup command ≤ 7 MCP tool calls on happy path (ToolSearch + list_orgs + list_projects + [optional: list_templates + create_document])
- [x] All commands include `Read` in `allowed-tools` for config reading
- [x] `ToolSearch` present in all commands that use deferred MCP tools
- [x] No `2>/dev/null` on meaningful commands (grep checks are allowed)
- [x] Config field values not interpolated into format strings
- [x] No credentials stored in config — OAuth is MCP-managed

### Quality

- [x] `chatprd-conventions` skill updated with: config reading pattern, org error codes, exact tool parameter names (from Phase 1)
- [x] `document-assistant` agent stays under 120 lines (117 lines)
- [x] All new command files use LF line endings (WSL2 CRLF risk — run `sed -i 's/\r$//'` after Write)

---

## Dependencies & Prerequisites

- ChatPRD Pro/Team/Enterprise plan required for MCP access (documented in README)
- ChatPRD OAuth must be authorized via browser before running setup (headless SSH won't work)
- Phase 1 (schema discovery) must complete before Phase 3 or 4 can be authored
- `chatprd-conventions` skill update (Phase 2) must complete before any consuming command update (Phases 3-4)

---

## Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Org-scoped tool parameter names differ from `organization_id` | Medium | High | Phase 1 empirical discovery is mandatory before authoring |
| `search_documents` has no org scope | Low | Low | Treat search as global; document as known limitation |
| `create_document` doesn't accept org/project params | Medium | High | Verify in Phase 1; if not supported, create in default project only |
| WSL2 CRLF on new command files | High | Medium | Run `sed -i 's/\r$//'` after every Write tool call |
| Agent context window: document-assistant too long after changes | Low | Low | Count lines before and after; trim if >120 |
| User with personal-only ChatPRD account (no orgs) | Medium | Medium | GAP-1 handled: explicit error + link to app.chatprd.ai |

---

## Files Changed

| File | Status | Change |
|---|---|---|
| `plugins/yellow-chatprd/commands/chatprd/setup.md` | **NEW** | Full setup command |
| `plugins/yellow-chatprd/skills/chatprd-conventions/SKILL.md` | **UPDATE** | Config pattern + org errors + tool schemas |
| `plugins/yellow-chatprd/commands/chatprd/create.md` | **UPDATE** | Config read step + org-scoped create |
| `plugins/yellow-chatprd/commands/chatprd/list.md` | **UPDATE** | Config read step + list_organization_documents |
| `plugins/yellow-chatprd/commands/chatprd/search.md` | **UPDATE** | Config read step + (optional org scope) |
| `plugins/yellow-chatprd/commands/chatprd/update.md` | **UPDATE** | Config read step + org context for search |
| `plugins/yellow-chatprd/agents/workflow/document-assistant.md` | **UPDATE** | Config check + org-scoped tools |

Total: 1 new file, 6 updated files.

> **Out of scope:** `link-linear.md` uses `search_documents` (read-only, global) and `get_document` (by ID, no org param). It creates Linear issues, not ChatPRD documents — no org-scoped write risk. Include in a follow-up PR if org-scoped search is desired there.

---

## Open Questions (Resolved in Plan)

| Question | Decision |
|---|---|
| Single org: auto-select? | Yes — display "Using your only org: X", surface in M3 |
| Single project: auto-select? | Yes — same pattern as single org |
| Cancellation at M3: write config? | No — clean exit, nothing written |
| `search_documents` org scope | Treat as global until verified empirically in Phase 1 |
| Schema version field | `schema: "1"` — first field in YAML frontmatter |
| Document creation failure | Non-fatal — config already written, report error, continue |
| Config reading mechanism | `Read` tool for value extraction; `Bash if [ ! -f ]` for existence |

---

## References

- Brainstorm: `docs/brainstorms/2026-02-22-chatprd-setup-command-brainstorm.md`
- ChatPRD MCP tool list: https://www.chatprd.ai/product/mcp
- Pattern model: `plugins/yellow-browser-test/commands/browser-test/setup.md` (config write + validate)
- Pattern model: `plugins/yellow-ruvector/commands/ruvector/setup.md` (prereq checks + AskUserQuestion flow)
- Anti-patterns: `docs/solutions/code-quality/claude-code-command-authoring-anti-patterns.md`
- MCP naming: `docs/solutions/integration-issues/mcp-bundled-server-tool-naming-and-plugin-authoring-patterns.md`
- Plugin settings: `plugins/yellow-core/skills/create-agent-skills/SKILL.md` (lines 345-381)
