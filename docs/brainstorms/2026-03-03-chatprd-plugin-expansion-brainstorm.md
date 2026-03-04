# ChatPRD Plugin Expansion Brainstorm

**Date:** 2026-03-03
**Plugin:** yellow-chatprd (currently v1.1.0)
**Research:** [docs/research/chatprd-mcp-capabilities-expansion.md](../research/chatprd-mcp-capabilities-expansion.md)

## What We're Building

A two-phase strategic expansion of the yellow-chatprd plugin to use all 13
ChatPRD MCP tools (currently 8/13), adding high-value new capabilities,
strengthening existing commands, and building cross-plugin workflows. The
expansion prioritizes impact over coverage -- every new tool integration serves
a concrete user need rather than wiring up tools for completeness.

### Current State (v1.1.0)

- **6 commands:** setup, create, search, update, list, link-linear
- **2 agents:** document-assistant, linear-prd-bridge
- **1 skill:** chatprd-conventions
- **8/13 MCP tools used:** `get_document`, `search_documents`, `create_document`,
  `update_document`, `list_projects`, `list_user_organizations`,
  `list_organization_documents`, `list_templates`
- **5 MCP tools unused:** `list_documents`, `list_project_documents`,
  `list_chats`, `search_chats`, `get_user_profile`

### Target State (v1.3.0)

- **6 commands** (enhanced): setup, create, search, update, list, link-linear
- **4 agents** (+2 new): document-assistant, linear-prd-bridge,
  document-reviewer, project-dashboard
- **1 skill** (updated): chatprd-conventions
- **13/13 MCP tools used** (all wired in where they naturally fit)

## Why This Approach

### Decision Log (5 Questions)

**Q1: What is the most important outcome?**
A strategic mix of high-value new capabilities, strengthened existing commands,
and cross-plugin workflows. Not full coverage for its own sake -- every tool
integration must serve a concrete user need.

**Q2: How does chat history fit into the workflow?**
Low priority. Chat history tools (`list_chats`, `search_chats`) are interesting
but not a primary driver. Deprioritize dedicated chat commands and agents. Wire
these tools in lightly where convenient (e.g., as optional scope in existing
search) rather than building dedicated surfaces.

**Q3: Which existing command enhancements matter most?**
Smarter listing. `/chatprd:list` should use `list_project_documents` when a
project is specified (more precise results, higher default limit of 50 vs 10)
and `list_documents` for personal/draft documents not yet in an org.
Subscription awareness and combined chat+document search are lower priority.

**Q4: Where to invest in cross-plugin workflows?**
Two directions: (1) Enrich the existing Linear bridge by using
`list_project_documents` to find related specs and include them as references
in Linear issue descriptions. (2) Add DeepWiki context injection to
`/chatprd:create` so technical specs and API docs get repository architecture
context automatically. Skip GitHub bridge for now.

**Q5: Which new agents to build?**
Both: (1) `document-reviewer` for PRD completeness checking against templates,
missing section identification, and improvement suggestions. (2)
`project-dashboard` for a one-stop overview of all documents and activity
within a project.

### Approach Considered

Three approaches were evaluated:

**Approach A: Broad Sweep** -- Ship everything in a single v1.2.0 release.
Rejected: large scope increases risk, harder to review, blocks everything if
any component has design issues.

**Approach B: Two-Phase Strategic Rollout (chosen)** -- Phase 1 strengthens
existing commands and the Linear bridge (low-risk, immediate value). Phase 2
builds new agents and cross-plugin workflows (higher ambition, informed by
Phase 1 experience). Chosen because it reduces risk, delivers incremental
value, and lets Phase 1 feedback inform Phase 2 design.

**Approach C: Agent-First** -- Build new agents before enhancing existing
commands. Rejected: creates inconsistency (new agents would use
`list_project_documents` while `/chatprd:list` still uses the less precise
`list_organization_documents`), and new agents are harder to validate without
established patterns.

## Key Decisions

### Phase 1: Strengthen and Enrich (v1.2.0)

Phase 1 touches only existing files. It wires in 2 of the 5 unused tools
(`list_project_documents`, `list_documents`) and enriches the Linear bridge
with related-specs context.

#### 1.1 Enhance `/chatprd:list` with Smarter Listing

**Current behavior:** Always calls `list_organization_documents` regardless of
scope. Limited to 10 results by default. Cannot access personal/draft
documents outside an org.

**New behavior -- three listing modes:**

- **Project-scoped (project specified):** Use `list_project_documents` with the
  resolved project ID. Higher default limit (50 vs 10). More precise results
  because the API filters server-side rather than the command filtering
  client-side after fetching all org docs.
- **Org-scoped (no project, org context):** Continue using
  `list_organization_documents` as today. This remains the right tool for
  "show me everything in the org."
- **Personal (new):** Add an option to list personal/draft documents via
  `list_documents`. Trigger: user asks for "my drafts", "personal docs", or
  passes a `--personal` style qualifier. This surfaces documents not yet
  assigned to an org.

**Files changed:**
- `commands/chatprd/list.md` -- Add `list_project_documents` and
  `list_documents` to allowed-tools. Update Step 3 routing logic to select the
  appropriate tool based on scope. Update Step 4 to handle the higher result
  count from project-scoped listing.
- `agents/workflow/document-assistant.md` -- Update List Flow to match the new
  three-mode routing. Add `list_project_documents` and `list_documents` to
  allowed-tools.
- `skills/chatprd-conventions/SKILL.md` -- Document the three listing modes and
  when to use each tool. Add `list_project_documents` to the org-scoped tools
  section.

**New MCP tools wired in:** `list_project_documents`, `list_documents`

#### 1.2 Enrich Linear Bridge with Related Specs

**Current behavior:** The `linear-prd-bridge` agent and `/chatprd:link-linear`
command create Linear issues from a single ChatPRD document. Issue descriptions
reference only the source document title.

**New behavior:** After fetching the source document (Step 4 in the command,
Step 2 in the agent), call `list_project_documents` scoped to the same project
as the source document. Identify related specs (other documents in the same
project) and include them as reference links in each Linear issue description.

**Example output in a Linear issue description:**

```
## References
- Source: Auth Feature PRD (ChatPRD)
- Related specs in this project:
  - Auth API Documentation
  - Auth Technical Design Document
  - Auth User Personas
```

**Files changed:**
- `commands/chatprd/link-linear.md` -- Add
  `mcp__plugin_yellow-chatprd_chatprd__list_project_documents` to
  allowed-tools. Add Step 4.5 (between "Read Document Content" and "Dedup
  Check") to fetch related specs. Update Step 8 issue creation to include
  references.
- `agents/workflow/linear-prd-bridge.md` -- Add
  `mcp__plugin_yellow-chatprd_chatprd__list_project_documents` to
  allowed-tools. Add a related-specs step between "Find ChatPRD Document" and
  "Extract Requirements." Update issue creation to include references.

**New MCP tools wired in:** `list_project_documents` (reused from 1.1)

#### 1.3 Update Conventions Skill

**Additions to `chatprd-conventions`:**

- **Listing tool selection guide:** When to use `list_project_documents` vs
  `list_organization_documents` vs `list_documents`. Include the scoping
  hierarchy: personal < org < project (most precise).
- **`list_project_documents` error mapping:** 404 project not found, empty
  results vs API error distinction (same pattern as existing org-scoped tools).
- **`list_documents` error mapping:** Empty results for personal docs (suggest
  creating a document or checking org docs).
- **Related-specs pattern:** Convention for fetching sibling documents in the
  same project for cross-referencing in Linear issues or other contexts.

**Files changed:**
- `skills/chatprd-conventions/SKILL.md`

#### Phase 1 MCP Tool Coverage After v1.2.0: 10/13

Tools wired in: existing 8 + `list_project_documents` + `list_documents` = 10.
Remaining: `list_chats`, `search_chats`, `get_user_profile` (deferred to
Phase 2 or later).

---

### Phase 2: New Capabilities (v1.3.0)

Phase 2 adds new files (2 agents) and enhances existing commands with
cross-plugin workflows. It wires in the remaining 3 unused tools.

#### 2.1 Document Reviewer Agent

**Purpose:** AI-powered PRD completeness checking. Fetches a document, compares
it against its template structure, identifies missing or thin sections, and
suggests improvements.

**Trigger phrases:** "review this PRD", "check the spec for gaps", "is this
PRD complete", "what's missing from the auth spec"

**MCP tools used:** `get_document`, `list_templates`, `search_documents`

**Workflow:**

1. Parse user request for a document title or query. Validate input.
2. `search_documents` to locate the document. User confirms if multiple
   matches.
3. `get_document` to fetch full content.
4. `list_templates` to fetch template definitions. Match the document's
   template (from document metadata or by structural analysis).
5. Compare document sections against template structure. Identify:
   - Missing sections (present in template, absent in document)
   - Thin sections (present but under ~50 words or lacking specificity)
   - Structural gaps (e.g., user stories without acceptance criteria)
6. Present findings as a structured review with severity (missing / thin /
   suggestion).
7. Offer to apply improvements via `update_document` with M3 confirmation.

**New file:** `agents/workflow/document-reviewer.md`

**Allowed tools:** `Read`, `Bash`, `AskUserQuestion`, `ToolSearch`,
`mcp__plugin_yellow-chatprd_chatprd__get_document`,
`mcp__plugin_yellow-chatprd_chatprd__search_documents`,
`mcp__plugin_yellow-chatprd_chatprd__list_templates`,
`mcp__plugin_yellow-chatprd_chatprd__update_document`

#### 2.2 Project Dashboard Agent

**Purpose:** One-stop overview of all documents within a ChatPRD project.
Shows document inventory, identifies gaps in project coverage, and suggests
next documents to create.

**Trigger phrases:** "what's the status of project X", "show me the project
overview", "what docs exist for the mobile project", "project dashboard"

**MCP tools used:** `list_project_documents`, `list_projects`, `get_document`

**Workflow:**

1. Parse user request for a project name. Validate input.
2. Read workspace config for org context.
3. `list_projects` scoped to org to resolve project name to ID. User confirms
   if ambiguous.
4. `list_project_documents` with the resolved project ID. Fetch all documents
   (up to the 50 default limit).
5. Categorize documents by type/template (PRDs, technical specs, API docs,
   user personas, etc.) based on titles and available metadata.
6. Present a structured dashboard:
   - Document count by category
   - List of all documents with title, template type, last updated
   - Coverage analysis: common document types that are missing (e.g., "This
     project has a PRD but no Technical Design Document or API Documentation")
7. Offer to drill into any document via `get_document` or create missing
   documents via `/chatprd:create`.

**New file:** `agents/workflow/project-dashboard.md`

**Allowed tools:** `Read`, `Bash`, `AskUserQuestion`, `ToolSearch`,
`mcp__plugin_yellow-chatprd_chatprd__list_project_documents`,
`mcp__plugin_yellow-chatprd_chatprd__list_projects`,
`mcp__plugin_yellow-chatprd_chatprd__get_document`,
`mcp__plugin_yellow-chatprd_chatprd__list_templates`

#### 2.3 DeepWiki Context for Technical Specs

**Purpose:** When creating Technical Design Documents or API Documentation via
`/chatprd:create`, automatically pull repository architecture context from
DeepWiki (via yellow-devin plugin) and include it in the document outline.

**Trigger condition:** User runs `/chatprd:create` and selects a technical
template (Technical Design Document, API Documentation). The command detects
the template type and offers to pull repo context.

**Workflow addition to `/chatprd:create`:**

After template selection (Step 4), if the selected template is technical:

1. Check if yellow-devin plugin is available by attempting to use ToolSearch
   for DeepWiki tools.
2. If available: ask user via AskUserQuestion: "Pull architecture context from
   the repo via DeepWiki? [Yes] [No]"
3. If yes: call DeepWiki `read_wiki_structure` to get the repo's architectural
   overview. Extract relevant sections (architecture, components,
   dependencies).
4. Inject the extracted context into the document outline as additional
   `description` content in the relevant outline sections (e.g., architecture
   section gets repo structure context, dependencies section gets dependency
   list).
5. If yellow-devin is not installed or user declines: proceed without context
   (no degradation).

**Files changed:**
- `commands/chatprd/create.md` -- Add DeepWiki tool discovery step. Add
  conditional context injection between template selection and document
  creation. Add DeepWiki tools to allowed-tools (conditional, via ToolSearch).

**Cross-plugin dependency:** yellow-devin (optional, graceful degradation)

#### 2.4 User Profile in Setup Diagnostics

**Purpose:** Wire `get_user_profile` into `/chatprd:setup` as a diagnostic
pre-check. Show the user their subscription status and warn if features
require a higher plan.

**Workflow addition to `/chatprd:setup`:**

At the beginning of setup (before org selection):

1. Call `get_user_profile` to fetch name, email, subscription status.
2. Display: "Logged in as **[name]** ([email]) -- [subscription] plan"
3. If Free plan: warn "Some ChatPRD MCP features require a Pro or Team plan.
   Setup will continue, but you may encounter feature limitations."
4. Store subscription status in the workspace config for downstream commands
   to reference.

**Files changed:**
- `commands/chatprd/setup.md` -- Add `get_user_profile` to allowed-tools. Add
  profile check step at the beginning. Update config file format to include
  subscription status.
- `skills/chatprd-conventions/SKILL.md` -- Add `get_user_profile` error
  mapping. Document subscription status in workspace config format.

**New MCP tool wired in:** `get_user_profile`

#### 2.5 Light Chat Tool Wiring

**Purpose:** Wire `list_chats` and `search_chats` lightly into existing
surfaces without building dedicated commands or agents. These are low-priority
per the brainstorm decisions, but wiring them in completes 13/13 coverage.

**Where they fit:**
- `document-assistant` agent: Add `search_chats` to allowed-tools. In the
  Read/Search Flow, after `search_documents` returns results, optionally
  mention: "Also found [N] related conversations" (without fetching full chat
  content unless user asks).
- `project-dashboard` agent: Add `list_chats` to allowed-tools. Include a
  "Recent conversations" count in the project dashboard output.

**No dedicated commands.** No `chat-historian` agent. These tools provide
supplementary context only.

#### Phase 2 MCP Tool Coverage After v1.3.0: 13/13

Tools wired in: Phase 1's 10 + `get_user_profile` + `list_chats` +
`search_chats` = 13. Full coverage.

---

### Summary of All File Changes

| File | Phase | Change Type |
|------|-------|-------------|
| `commands/chatprd/list.md` | 1 | Enhanced (three listing modes) |
| `commands/chatprd/link-linear.md` | 1 | Enhanced (related specs in issues) |
| `agents/workflow/document-assistant.md` | 1 | Enhanced (three listing modes) |
| `agents/workflow/linear-prd-bridge.md` | 1 | Enhanced (related specs in issues) |
| `skills/chatprd-conventions/SKILL.md` | 1 | Updated (new tool mappings, patterns) |
| `agents/workflow/document-reviewer.md` | 2 | New file |
| `agents/workflow/project-dashboard.md` | 2 | New file |
| `commands/chatprd/create.md` | 2 | Enhanced (DeepWiki context injection) |
| `commands/chatprd/setup.md` | 2 | Enhanced (profile diagnostics) |
| `CLAUDE.md` | 1+2 | Updated (new agents, enhanced descriptions) |
| `package.json` | 1+2 | Version bumps |
| `.claude-plugin/plugin.json` | 1+2 | Version bumps |

### MCP Tool Wiring Map

| MCP Tool | Phase | Used By |
|----------|-------|---------|
| `list_project_documents` | 1 | `/chatprd:list`, `document-assistant`, `/chatprd:link-linear`, `linear-prd-bridge`, `project-dashboard` |
| `list_documents` | 1 | `/chatprd:list`, `document-assistant` |
| `get_user_profile` | 2 | `/chatprd:setup` |
| `list_chats` | 2 | `project-dashboard` |
| `search_chats` | 2 | `document-assistant` |

## Open Questions

1. **`list_project_documents` pagination:** The default limit is 50. If a
   project has more than 50 documents, do we need to implement pagination or
   is 50 sufficient for the initial release? Check against real-world project
   sizes.

2. **DeepWiki tool availability detection:** The current plan uses ToolSearch
   to discover DeepWiki tools at runtime. Need to confirm the exact tool names
   exposed by yellow-devin (`read_wiki_structure`, `read_wiki_contents`,
   `ask_question`) and which one provides the best architectural summary.

3. **Workspace config format change:** Phase 2 adds subscription status to
   `.claude/yellow-chatprd.local.md`. Need to decide if this is a breaking
   change requiring a config migration step in `/chatprd:setup`, or if it can
   be treated as an optional field that existing configs simply lack.

4. **Document-reviewer template matching:** Documents may not have explicit
   template metadata in the `get_document` response. Need to verify what
   metadata is returned and whether structural analysis (section heading
   matching) is a reliable fallback for determining which template was used.

5. **Related specs relevance filtering:** When enriching Linear issues with
   related specs from `list_project_documents`, should all project documents
   be listed as references, or should there be relevance filtering (e.g., only
   documents updated in the last 30 days, or only documents matching certain
   template types)?

6. **`assistantId` parameter in `update_document`:** The research noted this
   parameter is currently unused by the plugin. Worth investigating whether it
   controls which AI model processes the update -- could be valuable for the
   document-reviewer agent if it enables more specialized review behavior.
