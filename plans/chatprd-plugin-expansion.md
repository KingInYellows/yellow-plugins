# Feature: ChatPRD Plugin Expansion (v1.2.0 + v1.3.0)

## Problem Statement

The yellow-chatprd plugin uses only 8 of the 13 available ChatPRD MCP tools,
leaving significant capability on the table. Users lack project-scoped document
listing (stuck with the less precise org-level listing at 10-result limit),
Linear issues created from PRDs have no cross-reference to related specs, there
is no way to review a PRD for completeness against its template, and technical
spec creation does not leverage repository architecture context.

### Current State (v1.1.0)

- 6 commands, 2 agents, 1 conventions skill
- 8/13 MCP tools wired in
- 5 unused: `list_documents`, `list_project_documents`, `list_chats`,
  `search_chats`, `get_user_profile`

### Target State (v1.3.0)

- 6 commands (enhanced), 4 agents (+2 new), 1 conventions skill (updated)
- 13/13 MCP tools wired in where they naturally serve a user need

### References

- Research: `docs/research/chatprd-mcp-capabilities-expansion.md`
- Brainstorm: `docs/brainstorms/2026-03-03-chatprd-plugin-expansion-brainstorm.md`

## Proposed Solution

Two-phase strategic rollout. Phase 1 (v1.2.0) strengthens existing commands and
enriches the Linear bridge -- low-risk changes to existing files only. Phase 2
(v1.3.0) adds two new agents and cross-plugin workflows -- higher ambition,
informed by Phase 1 experience.

### Key Design Decisions

1. **Personal listing mode requires org config** -- `list_documents` is for
   org-member users who want to see their own drafts, not for org-less users.
   This avoids refactoring the config check across all commands.

2. **Related-specs enrichment extracts project ID from workspace config default**
   -- ~~If the response lacks a `projectId` field, fall back to the default
   project from workspace config.~~ Use `default_project_id` from workspace
   config directly. If not configured, skip enrichment silently with a note.

<!-- deepen-plan: external -->
> **Research:** Live MCP probing confirms `get_document` does **NOT** return
> `projectId`, `templateId`, or `templateName`. Response fields are: `uuid`,
> `title`, `createdAt`, `updatedAt`, `content` (Markdown), `contentHtml`
> (HTML), `createdInThread` (thread object). The plan's original assumption
> about extracting project ID from the response is invalid. Use workspace
> config `default_project_id` as the primary source, not a fallback.
<!-- /deepen-plan -->

3. **Document-reviewer uses tiered template matching** -- ~~Try document metadata
   first, then~~ Start with heading-based heuristic (H2 comparison against a
   hardcoded section map). If no match, ask the user. If user declines, provide
   a general completeness review covering common PRD elements.

<!-- deepen-plan: external -->
> **Research:** Live MCP probing confirms `get_document` returns **no template
> metadata** (no `templateId` or `templateName`). Additionally, `list_templates`
> returns **metadata only** (id, title, description, isSystem) -- no section
> structure or section names. The plan must maintain a **local hardcoded section
> map** (template title -> expected H2 sections) to enable completeness review.
> The `description` field from `list_templates` is prose (e.g., "This template
> provides a comprehensive guide for documenting APIs...") and is not
> machine-parseable into section names. Tier 1 (metadata check) must be removed
> from the matching algorithm.
<!-- /deepen-plan -->

4. **DeepWiki tools are dynamically discovered** -- Not listed in static
   `allowed-tools` to keep yellow-devin as a soft dependency.

<!-- deepen-plan: codebase -->
> **Codebase:** This approach follows established precedent. `yellow-core`
> `/workflows:work` (line 60-74) discovers `hooks_recall` via ToolSearch with
> graceful degradation. `yellow-research` `/research:setup` (lines 196-241)
> probes four MCP sources via ToolSearch. The query `"+deepwiki read_wiki"`
> will match `mcp__plugin_yellow-devin_deepwiki__read_wiki_structure`. All MCP
> tool names verified against the deferred tools list -- confirmed accurate.
<!-- /deepen-plan -->

5. **Chat tools are supplementary only** -- `search_chats` runs in parallel with
   `search_documents`, never blocks or delays primary results. Failures are
   silently suppressed.

6. **`get_user_profile` failure is non-blocking** -- Setup continues with a
   warning if the profile check fails.

## Implementation Plan

### Phase 1: Strengthen and Enrich (v1.2.0)

5 files changed, 0 new files. Wires in 2 unused tools (`list_project_documents`,
`list_documents`).

#### Task 1.1: Enhance `/chatprd:list` with Three Listing Modes

**File:** `plugins/yellow-chatprd/commands/chatprd/list.md`

**Changes:**

1. Add to `allowed-tools` frontmatter:
   ```yaml
   - mcp__plugin_yellow-chatprd_chatprd__list_project_documents
   - mcp__plugin_yellow-chatprd_chatprd__list_documents
   ```

<!-- deepen-plan: codebase -->
> **Codebase:** Current Step 3 in `list.md` (lines 44-59) already has routing
> logic for project-specified vs no-project cases, both using
> `list_organization_documents`. The new three-mode routing extends this with
> `list_project_documents` for project-scoped and `list_documents` for personal.
> Current `allowed-tools` (lines 10-12) confirm only `list_organization_documents`,
> `list_projects`, and `get_document` are wired in.
<!-- /deepen-plan -->

2. Replace the current Step 3 (which always calls `list_organization_documents`)
   with a three-mode routing step:

   **Step 3: Route to Appropriate Listing Tool**

   Determine listing mode from `$ARGUMENTS`:

   - **Project-scoped** (user specifies a project name or the default project is
     configured): Resolve project name to ID via `list_projects`. Call
     `list_project_documents` with the resolved `projectId` and workspace
     `organizationId`. This returns up to 50 results (vs 10 for org-scoped).

   - **Org-scoped** (no project specified, no personal qualifier): Call
     `list_organization_documents` with workspace `organizationId` as today.
     This is the default mode.

   - **Personal** (user says "my drafts", "personal docs", or "my documents"):
     Call `list_documents` without `organizationId`. Surfaces the user's own
     documents regardless of org/project assignment.

3. Update Step 4 to handle the potentially larger result set from project-scoped
   listing (up to 50 vs 10). Format output consistently across all three modes.

4. Add to the inline error table:
   - `list_project_documents` 404: "Project not found. Check the project name
     or use `/chatprd:list` without a project filter."
   - `list_documents` empty results: "No personal documents found. Your
     documents may be in an organization -- try `/chatprd:list` without the
     personal filter."

**Acceptance criteria:**
- [ ] `$ARGUMENTS` containing a project name routes to `list_project_documents`
- [ ] Default (no arguments) routes to `list_organization_documents`
- [ ] "my drafts" / "personal docs" routes to `list_documents`
- [ ] All three modes produce consistent output formatting
- [ ] Error table covers new tool failure cases

#### Task 1.2: Update Document-Assistant Agent for Three Listing Modes

**File:** `plugins/yellow-chatprd/agents/workflow/document-assistant.md`

**Changes:**

1. Add to `allowed-tools`:
   ```yaml
   - mcp__plugin_yellow-chatprd_chatprd__list_project_documents
   - mcp__plugin_yellow-chatprd_chatprd__list_documents
   ```

2. Update the List Flow section to match the three-mode routing from Task 1.1.
   The agent should detect intent from conversational context (not CLI flags):
   - "Show docs in the mobile project" -> project-scoped
   - "List all docs" / "Show documents" -> org-scoped
   - "Show my drafts" / "My personal documents" -> personal

<!-- deepen-plan: codebase -->
> **Codebase:** The List Flow section is at lines 92-96 of
> `document-assistant.md` -- a simple 3-line section. The Handoff section is at
> lines 110-116 with two existing bullet points (link-linear command and
> linear-prd-bridge agent). Adding a third bullet for document-reviewer is
> straightforward.
<!-- /deepen-plan -->

3. Add a handoff clause in the existing Handoff section:
   "When the user asks for document review, completeness check, or gap analysis,
   suggest the `document-reviewer` agent." (Prepares for Phase 2 discoverability.)

**Acceptance criteria:**
- [ ] Agent detects listing mode from natural language
- [ ] Agent uses correct MCP tool for each mode
- [ ] Handoff to document-reviewer is mentioned (future-proofs for Phase 2)

#### Task 1.3: Enrich Linear Bridge with Related Specs

**Files:**
- `plugins/yellow-chatprd/commands/chatprd/link-linear.md`
- `plugins/yellow-chatprd/agents/workflow/linear-prd-bridge.md`

**Changes to `link-linear.md`:**

1. Add to `allowed-tools`:
   ```yaml
   - mcp__plugin_yellow-chatprd_chatprd__list_project_documents
   ```

2. Add **Step 5: Fetch Related Specs** (renumber existing Steps 5+ to 6+):

   After Step 4 (Read Document Content), determine the source document's
   project:

   a. ~~Check the `get_document` response for a `projectId` field.~~
   b. Use the `default_project_id` from workspace config.
   c. If not configured, set `related_specs = []` and skip to Step 6.

<!-- deepen-plan: external -->
> **Research:** `get_document` does not return `projectId` (confirmed via live
> probe). The only reliable source for project association is the workspace
> config `default_project_id`. Step (a) must be removed. The fallback chain
> simplifies to: workspace config default -> skip.
<!-- /deepen-plan -->

   If a project ID is available, call `list_project_documents` with that
   `projectId`. Filter out the source document itself. Store the remaining
   documents as `related_specs` (title + document UUID).

   **Timeout:** If `list_project_documents` does not respond within 5 seconds,
   set `related_specs = []` and proceed. Log: "Related specs could not be
   loaded."

3. Update the issue creation step (now Step 9) to include a References section
   in each Linear issue description when `related_specs` is non-empty:

   ```markdown
   ## References
   - Source: [Document Title] (ChatPRD)
   - Related specs in this project:
     - [Spec Title 1]
     - [Spec Title 2]
   ```

**Changes to `linear-prd-bridge.md`:**

Mirror the same related-specs pattern:

1. Add `mcp__plugin_yellow-chatprd_chatprd__list_project_documents` to
   `allowed-tools`.
2. **Add a workspace config read step** before the related-specs step (the agent
   currently has no config check, unlike `document-assistant`).
3. Add a related-specs step between "Find ChatPRD Document" and "Extract
   Requirements" using `default_project_id` from the newly-read config.
4. Update issue creation to include references.

<!-- deepen-plan: codebase -->
> **Codebase:** `linear-prd-bridge.md` currently has **no workspace config
> check** in its workflow (confirmed at lines 49-126). Its Step 2 goes directly
> to "Find ChatPRD Document" via `search_documents`. The `document-assistant`
> agent reads config at lines 53-60. To use `default_project_id` for the
> related-specs fallback, the agent needs `Read` added to `allowed-tools` (it
> currently only has `Bash`, `AskUserQuestion`, `ToolSearch` + MCP tools) and a
> new workspace config read step. Alternatively, add `Bash` usage to read the
> config (Bash is already in allowed-tools).
<!-- /deepen-plan -->

**Acceptance criteria:**
- [ ] Related specs appear in Linear issue descriptions when available
- [ ] Graceful degradation when document has no project association
- [ ] 5-second timeout prevents latency regression
- [ ] Source document is excluded from related specs list

#### Task 1.4: Update Conventions Skill

**File:** `plugins/yellow-chatprd/skills/chatprd-conventions/SKILL.md`

**Additions:**

1. **Listing Tool Selection Guide** (new section after Workspace Config):

   ```markdown
   ## Listing Tool Selection

   Three listing tools serve different scopes:

   | Tool | Scope | Default Limit | Use When |
   |------|-------|---------------|----------|
   | `list_project_documents` | Project | 50 | User specifies a project or context is project-scoped |
   | `list_organization_documents` | Organization | 10 | Default listing, no project specified |
   | `list_documents` | Personal/User | 10 | User asks for "my drafts" or personal documents |

   **Hierarchy:** personal < org < project (most specific).
   Never use `list_documents` as a substitute for `list_project_documents` --
   `list_documents` returns only the current user's documents, while
   `list_project_documents` returns all documents in a project regardless of
   author.
   ```

2. **Error mapping additions** to the existing Error Mapping table:
   - `list_project_documents` 404: "Project not found. Verify project name with
     `list_projects`." Action: Suggest listing without project filter.
   - `list_documents` empty: "No personal documents found." Action: Suggest
     org-scoped listing.

3. **Related-Specs Pattern** (new section):

   ```markdown
   ## Related-Specs Pattern

   When enriching external outputs (e.g., Linear issues) with project context:

   1. Extract project ID from document metadata or workspace config default.
   2. Call `list_project_documents` with the project ID.
   3. Filter out the source document.
   4. Include remaining documents as reference links.
   5. If project ID unavailable or API times out (5s), skip silently.

   Include all project documents initially. Filter by relevance in future
   iterations if reference lists become unwieldy.
   ```

**Acceptance criteria:**
- [ ] Listing tool selection guide documents all three tools with when-to-use
- [ ] Error mapping covers new tool failure cases
- [ ] Related-specs pattern is documented for reuse

#### Task 1.5: Version Bump and Metadata Updates

**Files:**
- `plugins/yellow-chatprd/.claude-plugin/plugin.json` -- version to `1.2.0`
- `plugins/yellow-chatprd/package.json` -- version to `1.2.0`
- `plugins/yellow-chatprd/CHANGELOG.md` -- Add v1.2.0 entry
- `plugins/yellow-chatprd/CLAUDE.md` -- Update component descriptions

**CHANGELOG entry:**

```markdown
## [1.2.0] - 2026-03-XX

### Added

- Three listing modes in `/chatprd:list`: project-scoped, org-scoped, personal
- Related-specs enrichment in `/chatprd:link-linear` and `linear-prd-bridge`
- Listing tool selection guide in `chatprd-conventions` skill
- Related-specs pattern in `chatprd-conventions` skill

### Changed

- `document-assistant` agent now supports three listing modes
- `linear-prd-bridge` agent includes related specs in Linear issue descriptions
```

**CLAUDE.md updates:**
- Update `/chatprd:list` description to mention three listing modes
- Update `linear-prd-bridge` description to mention related-specs enrichment
- Note `list_project_documents` and `list_documents` as newly used MCP tools

<!-- deepen-plan: codebase -->
> **Codebase:** The current CHANGELOG.md uses horizontal rules (`---`) between
> version entries. The proposed entries must include these separators for
> consistency. Also, `README.md` (lines 39-44) has an Agents table listing 2
> agents. Phase 2 will need README updated too -- adding a README update task
> is recommended for Phase 2 (Task 2.7).
<!-- /deepen-plan -->

**Acceptance criteria:**
- [ ] Both plugin.json and package.json show `1.2.0`
- [ ] CHANGELOG follows Keep a Changelog format with `---` separators
- [ ] CLAUDE.md accurately reflects enhanced capabilities

---

### Phase 2: New Capabilities (v1.3.0)

2 new files, 5 files enhanced. Wires in remaining 3 tools (`get_user_profile`,
`list_chats`, `search_chats`).

#### Task 2.1: Build Document-Reviewer Agent

**New file:** `plugins/yellow-chatprd/agents/workflow/document-reviewer.md`

**Frontmatter:**

```yaml
---
name: document-reviewer
model: inherit
description: >-
  AI-powered document review and completeness analysis. Use when user wants to
  "review this PRD", "check the spec for gaps", "is this PRD complete", or
  "what's missing from the auth spec".
allowed-tools:
  - Read
  - Bash
  - AskUserQuestion
  - ToolSearch
  - mcp__plugin_yellow-chatprd_chatprd__get_document
  - mcp__plugin_yellow-chatprd_chatprd__search_documents
  - mcp__plugin_yellow-chatprd_chatprd__list_templates
  - mcp__plugin_yellow-chatprd_chatprd__update_document
---
```

**Examples block:** 3-4 examples following the `<examples>` pattern:
- "Review the auth PRD" -> search, fetch, analyze, present findings
- "Is the API spec complete?" -> search, fetch, template comparison
- "What's missing from the mobile spec?" -> search, fetch, gap analysis
- "Fix the gaps in the payment PRD" -> search, fetch, analyze, offer update

**Workflow:**

1. **Step 1: Read Workspace Config** -- Standard config check from conventions.

2. **Step 2: Find Document** -- Parse user request for document title/query.
   Validate input per conventions. Call `search_documents`. If multiple matches,
   present list and ask user to select via `AskUserQuestion`. If zero matches,
   report "No documents found matching '[query]'. Try `/chatprd:search` to
   browse."

3. **Step 3: Fetch Document (C1)** -- Call `get_document` with the selected
   document UUID. Store full content.

4. **Step 4: Determine Template** -- Tiered matching:

   a. ~~**Metadata check:** Inspect `get_document` response for a template
      identifier field.~~ **Skipped -- `get_document` has no template metadata.**

   b. **Heading heuristic:** Extract all H2 headings from the document's
      Markdown `content` field. Compare against a **hardcoded section map**
      maintained in the agent (or in `chatprd-conventions`). The section map
      defines expected H2 headings for each known template (e.g., PRD template
      expects "Goals", "Context", "User Stories", "Requirements", "Success
      Metrics"). Select the template with >=60% heading overlap. If multiple
      templates match above threshold, pick the highest overlap.

   c. **User fallback:** If the heuristic produces no match, ask via
      `AskUserQuestion`: "Could not determine the template used for this
      document. Which template should I compare against?" Present top templates
      from the hardcoded section map.

   d. **General review:** If user declines template selection or says "none",
      proceed with a general completeness review using common PRD elements
      (Problem Statement, User Stories, Requirements, Success Metrics,
      Technical Considerations).

<!-- deepen-plan: external -->
> **Research:** `list_templates` returns only metadata (id, title, description,
> isSystem, default) -- **no section names or structure**. The `description`
> field is prose, not machine-parseable. There is no `get_template` tool. The
> agent must maintain a **hardcoded section map** that maps template titles to
> expected H2 headings. This map should be defined in `chatprd-conventions`
> skill (under the new "Document Review Patterns" section) for reusability. The
> initial map should cover the 6 most common templates: PRD, Technical Design
> Document, API Documentation, User Personas, One-Pager, and Product Strategy
> Document. Section names can be derived from the ChatPRD included templates
> documentation at https://www.chatprd.ai/docs/included-templates.
<!-- /deepen-plan -->

5. **Step 5: Analyze Completeness** -- Compare document against the determined
   template structure. For each expected section, classify:

   - **Missing** -- Section heading absent from document
   - **Thin** -- Section present but under ~50 words or lacks specificity
     (no concrete details, only placeholder text)
   - **Adequate** -- Section present with substantive content

   Also check for structural patterns:
   - User stories without acceptance criteria
   - Requirements without success metrics
   - Technical sections without trade-off analysis

6. **Step 6: Present Review** -- Output structured findings:

   ```
   ## Document Review: [Title]

   **Template:** [Template Name] (or "General Review")
   **Overall:** [X] sections adequate, [Y] thin, [Z] missing

   ### Missing Sections
   - **[Section Name]** -- [What this section should contain]

   ### Thin Sections
   - **[Section Name]** -- Currently [N] words. Consider adding: [suggestions]

   ### Structural Issues
   - [Issue description and recommendation]

   ### Adequate Sections
   - [Section Name] (X words)
   ```

7. **Step 7: Offer Improvements (M3)** -- Ask via `AskUserQuestion`:
   "Would you like me to suggest improvements for the [missing/thin] sections?"

   If yes:
   - Re-fetch document with `get_document` (H1 TOCTOU mitigation)
   - Compose improvement instructions
   - Present the proposed changes for M3 confirmation
   - Call `update_document` with the improvement instructions

**Guidelines:**
- Never modify a document without explicit user confirmation (M3)
- Always re-fetch before writing (H1)
- Reference `chatprd-conventions` skill for error mapping and input validation
- If document exceeds 5000 words, summarize each section before comparison

**Acceptance criteria:**
- [ ] Agent finds and fetches documents by title/query
- [ ] Template matching uses tiered approach (metadata -> heuristic -> user -> general)
- [ ] Review output classifies sections as missing/thin/adequate
- [ ] Improvement suggestions require M3 confirmation
- [ ] TOCTOU re-fetch before any update_document call
- [ ] Large document handling (>5000 words) via summarization

#### Task 2.2: Build Project-Dashboard Agent

**New file:** `plugins/yellow-chatprd/agents/workflow/project-dashboard.md`

**Frontmatter:**

```yaml
---
name: project-dashboard
model: inherit
description: >-
  One-stop project overview showing all documents, coverage gaps, and activity.
  Use when user asks "what's the status of project X", "show me the project
  overview", "what docs exist for the mobile project", or "project dashboard".
allowed-tools:
  - Read
  - Bash
  - AskUserQuestion
  - ToolSearch
  - mcp__plugin_yellow-chatprd_chatprd__list_project_documents
  - mcp__plugin_yellow-chatprd_chatprd__list_projects
  - mcp__plugin_yellow-chatprd_chatprd__get_document
  - mcp__plugin_yellow-chatprd_chatprd__list_templates
  - mcp__plugin_yellow-chatprd_chatprd__list_chats
---
```

**Examples block:** 3 examples:
- "Show me the auth project dashboard" -> list project docs, categorize, report
- "What docs exist for mobile?" -> list, present inventory
- "Project overview for payments" -> list, categorize, find gaps, suggest

**Workflow:**

1. **Step 1: Read Workspace Config** -- Standard config check.

2. **Step 2: Resolve Project** -- Parse user request for project name. Call
   `list_projects` scoped to workspace org. Match by name (case-insensitive
   substring). If multiple matches, present options via `AskUserQuestion`. If
   zero matches, display all available projects and ask user to select or
   rephrase.

3. **Step 3: Fetch Project Documents** -- Call `list_project_documents` with the
   resolved `projectId` and workspace `organizationId`. Returns up to 50
   documents.

   **Zero documents case:** Display: "Project **[name]** exists but has no
   documents yet. Consider creating:" followed by a suggested starter set
   (PRD, Technical Design Document) and offer `/chatprd:create`.

4. **Step 4: Categorize Documents** -- Group documents by type based on title
   keywords and template metadata (if available). Categories:
   - PRDs / Requirements
   - Technical Specs / Design Docs
   - API Documentation
   - User Research (Personas, Journey Maps, Testing Plans)
   - Strategy / Planning (OKRs, Launch Plans, Go-to-Market)
   - Other

5. **Step 5: Fetch Activity Context** -- Call `list_chats` with the `projectId`
   to get recent conversation count. If `list_chats` fails, suppress silently
   and omit the conversations line from the dashboard.

6. **Step 6: Analyze Coverage** -- Compare document categories against a
   "complete project" template:
   - Has a PRD? (core requirement)
   - Has a Technical Design Document? (needed for engineering handoff)
   - Has API Documentation? (if the project involves APIs)
   - Has User Personas? (recommended for user-facing features)
   - Has a Launch Plan? (recommended for shipped features)

   Identify missing categories and flag them as suggestions.

7. **Step 7: Present Dashboard** -- Output:

   ```
   ## Project Dashboard: [Name]

   **Documents:** [N] total | **Conversations:** [M] recent

   ### Document Inventory

   **PRDs & Requirements ([count])**
   - [Title 1]
   - [Title 2]

   **Technical Specs ([count])**
   - [Title 3]

   **API Documentation ([count])**
   - (none)

   ...

   ### Coverage Gaps
   - No API Documentation found -- consider `/chatprd:create` with the
     API Documentation template
   - No User Personas found -- helpful for user-facing features

   ### Actions
   - Drill into any document: "Show me [document title]"
   - Create missing docs: `/chatprd:create [template] for [project]`
   - Review a doc: use the `document-reviewer` agent
   ```

**Guidelines:**
- Read-only agent -- never creates or modifies documents directly
- Offer creation via `/chatprd:create` suggestions, not direct API calls
- Reference `chatprd-conventions` skill for error mapping
- Suppress `list_chats` failures silently (supplementary data only)

**Acceptance criteria:**
- [ ] Agent resolves project by name with disambiguation
- [ ] Zero-documents case handled with starter suggestions
- [ ] Documents categorized by type
- [ ] Coverage gaps identified against common project template
- [ ] Conversations count from `list_chats` included (graceful on failure)
- [ ] Actions section offers drill-down and creation paths

#### Task 2.3: Add DeepWiki Context to `/chatprd:create`

**File:** `plugins/yellow-chatprd/commands/chatprd/create.md`

**Changes:**

1. Do NOT add DeepWiki tools to the static `allowed-tools` frontmatter (keeps
   yellow-devin as an optional soft dependency).

<!-- deepen-plan: codebase -->
> **Codebase:** Current `create.md` has Step 4 (Template and Project Selection,
> lines 59-77) followed by Step 5 (Confirm and Create, line 79). There is no
> distinct "outline generation" step -- `create_document` is called directly in
> Step 5. The DeepWiki context should be injected into the `outline` parameter's
> `description` fields before the `create_document` call. Note: "Step 4.5"
> fractional numbering is non-standard -- all other commands use integer steps.
> Consider renumbering to Step 5 and bumping current Step 5->6, Step 6->7.
<!-- /deepen-plan -->

2. Add **Step 4.5: Inject Repository Context (Optional)** between template
   selection and document creation:

   a. Check if the selected template is technical: "Technical Design Document"
      or "API Documentation".

   b. If not technical, skip to Step 5.

   c. If technical, attempt to discover DeepWiki tools via `ToolSearch` with
      query `"+deepwiki read_wiki"`.

   d. If DeepWiki tools not found: display "Tip: Install yellow-devin for
      automatic repository context in technical specs." Skip to Step 5.

   e. If found, ask via `AskUserQuestion`: "Pull architecture context from
      the repository via DeepWiki? [Yes / No]"

   f. If no: skip to Step 5.

   g. If yes: determine the repository name from git remote (Bash:
      `git remote get-url origin | sed 's/.*github.com[:/]//' | sed 's/.git$//'`).
      Call `mcp__plugin_yellow-devin_deepwiki__read_wiki_structure` with the
      repo name.

   h. If `read_wiki_structure` returns empty or errors: display "No repository
      context available from DeepWiki. Proceeding without it." Skip to Step 5.

   i. If successful: extract architecture-relevant sections. Inject them into
      the document outline as additional `description` content in relevant
      sections (e.g., architecture section gets component overview, dependencies
      section gets dependency list from the repo).

**Cross-plugin dependency:** yellow-devin (optional). Graceful degradation at
every step -- the command works identically without yellow-devin installed.

**Acceptance criteria:**
- [ ] Only triggers for technical templates (TDD, API Documentation)
- [ ] DeepWiki tools discovered dynamically, not in static allowed-tools
- [ ] Graceful degradation: missing plugin, empty wiki, API error
- [ ] User can decline repo context injection
- [ ] Repository name extracted from git remote automatically

#### Task 2.4: Add User Profile to `/chatprd:setup`

**File:** `plugins/yellow-chatprd/commands/chatprd/setup.md`

**Changes:**

1. Add to `allowed-tools`:
   ```yaml
   - mcp__plugin_yellow-chatprd_chatprd__get_user_profile
   ```

2. Add **Step 1.5: Profile Check** (after existing Step 1, before Step 2):

   Call `get_user_profile`. Display:

   ```
   Logged in as **[firstName] [lastName]** ([email]) -- [subscription plan]
   ```

   If Free plan (empty or no active subscription in `subscriptions` array):
   warn "Some ChatPRD features require a Pro or Team plan. Setup will continue,
   but you may encounter feature limitations."

<!-- deepen-plan: external -->
> **Research:** `get_user_profile` returns: `id` (number), `clerkId` (string),
> `email` (string), `firstName` (string|null), `lastName` (string|null),
> `createdAt`, `updatedAt`, `isDeleted` (boolean), `subscriptions` (array of
> subscription objects). Note: subscription status is in a `subscriptions` array,
> not a simple `subscription_status` string. The plan should parse this array
> to determine plan tier. Names may be null -- handle gracefully.
<!-- /deepen-plan -->

   **Non-blocking:** If `get_user_profile` fails or times out, log: "Could not
   fetch profile -- continuing setup." Proceed to Step 2.

3. Optionally store `subscription_status` in workspace config as a non-required
   field. Treat as an optional additive field (no schema version bump needed).
   Commands that need it should check presence and re-fetch via
   `get_user_profile` on demand if absent.

**Acceptance criteria:**
- [ ] Profile displayed at start of setup flow
- [ ] Free plan warning shown when applicable
- [ ] Profile check failure does not block setup
- [ ] Subscription status optionally stored in workspace config

#### Task 2.5: Wire Chat Tools into Existing Agents

**Files:**
- `plugins/yellow-chatprd/agents/workflow/document-assistant.md`
- `plugins/yellow-chatprd/agents/workflow/project-dashboard.md` (already has `list_chats`)

**Changes to `document-assistant.md`:**

1. Add to `allowed-tools`:
   ```yaml
   - mcp__plugin_yellow-chatprd_chatprd__search_chats
   ```

2. In the Read/Search Flow, after `search_documents` returns results, add:

   Call `search_chats` in parallel with `search_documents` using the same query.
   If `search_chats` returns results, append: "Also found [N] related ChatPRD
   conversations." Do not display chat content unless the user asks. If
   `search_chats` fails, suppress silently.

**Key constraint:** `search_chats` must never block or delay the primary
`search_documents` response. Run in parallel, not sequentially.

**Acceptance criteria:**
- [ ] `search_chats` called alongside `search_documents` in parallel
- [ ] Chat results mentioned as supplementary context only
- [ ] Failures silently suppressed
- [ ] Primary search flow unaffected by chat tool latency

#### Task 2.6: Update Conventions Skill for Phase 2

**File:** `plugins/yellow-chatprd/skills/chatprd-conventions/SKILL.md`

**Additions:**

1. **`get_user_profile` error mapping:**
   - API failure: "Could not fetch profile." Action: Non-blocking, continue.
   - Authentication required: Same as existing auth mapping.

2. **Document review patterns** (new section):

   ```markdown
   ## Document Review Patterns

   ### Severity Levels

   - **Missing** -- Section expected by template but absent from document
   - **Thin** -- Section present but under ~50 words or lacking specifics
   - **Adequate** -- Section present with substantive content

   ### Template Section Map (Hardcoded)

   Since `get_document` returns no template metadata and `list_templates`
   returns no section structure, maintain a static section map here:

   | Template Title | Expected H2 Sections |
   |---------------|---------------------|
   | ChatPRD: PRD | Goals, Context, User Stories, Requirements, Success Metrics, Technical Considerations |
   | Technical Design Document | Overview, Architecture, Components, Dependencies, Trade-offs, Implementation Plan |
   | API Documentation | Purpose, Authentication, Endpoints, Error Handling, Rate Limits |
   | User Personas | Demographics, Goals, Frustrations, Behaviors, Scenarios |
   | One-Pager | Problem, Solution, Key Metrics, Timeline |
   | Product Strategy Document | Vision, Market Context, Goals, Roadmap, Success Metrics |

   This map is used by the `document-reviewer` agent for heading-based
   template matching (>=60% H2 overlap). Update when ChatPRD adds new
   templates or changes section structure.

   ### Template Matching Algorithm

   1. ~~Check `get_document` response metadata~~ (not available)
   2. H2 heading comparison against Template Section Map (>=60% match)
   3. Ask user via AskUserQuestion
   4. Fall back to general completeness review

   ### General Review Elements (when template unknown)

   Problem Statement, User Stories/Requirements, Success Metrics, Technical
   Considerations, Dependencies, Timeline/Milestones
   ```

<!-- deepen-plan: external -->
> **Research:** The template section map above is derived from ChatPRD's
> included templates documentation. Section names should be verified against
> actual documents created with each template. The map will need periodic
> updates as ChatPRD evolves its template catalog. Consider adding a
> `last_verified` date to the section map for staleness tracking.
<!-- /deepen-plan -->

3. **Dashboard formatting** (new section):

   ```markdown
   ## Dashboard Formatting

   ### Document Categories

   Group by: PRDs & Requirements, Technical Specs, API Documentation,
   User Research, Strategy & Planning, Other.

   ### Coverage Analysis

   Compare against: PRD (core), Technical Design Doc (engineering handoff),
   API Documentation (if API-related), User Personas (user-facing features),
   Launch Plan (shipped features).

   ### Chat Context

   `list_chats` results are supplementary. Suppress errors silently.
   Display only the count; full content on user request only.
   ```

4. **Subscription status in workspace config:**
   Document `subscription_status` as an optional field in the workspace config
   format. Commands should check presence and re-fetch if absent.

**Acceptance criteria:**
- [ ] Review patterns documented with severity levels and matching algorithm
- [ ] Dashboard formatting conventions specified
- [ ] `get_user_profile` error mapping added
- [ ] Subscription status documented as optional config field

#### Task 2.7: Version Bump and Metadata Updates

**Files:**
- `plugins/yellow-chatprd/.claude-plugin/plugin.json` -- version to `1.3.0`
- `plugins/yellow-chatprd/package.json` -- version to `1.3.0`
- `plugins/yellow-chatprd/CHANGELOG.md` -- Add v1.3.0 entry
- `plugins/yellow-chatprd/CLAUDE.md` -- Update for new agents and capabilities

**CHANGELOG entry:**

```markdown
## [1.3.0] - 2026-03-XX

### Added

- `document-reviewer` agent for PRD completeness analysis against templates
- `project-dashboard` agent for one-stop project document overview
- DeepWiki context injection in `/chatprd:create` for technical templates
- User profile check in `/chatprd:setup` with subscription awareness
- Chat history context in `document-assistant` search results
- Document review patterns in `chatprd-conventions` skill
- Dashboard formatting conventions in `chatprd-conventions` skill

### Changed

- `document-assistant` agent now shows related conversation count in searches
- `project-dashboard` agent includes conversation count from `list_chats`
```

**CLAUDE.md updates:**
- Add `document-reviewer` and `project-dashboard` to Agents section
- Update "When to Use What" table with new agent trigger phrases
- Add yellow-devin as optional cross-plugin dependency
- Update MCP tool usage summary to 13/13

**README.md updates:**
- Update Agents table to include `document-reviewer` and `project-dashboard`
- Update feature descriptions to reflect new capabilities

<!-- deepen-plan: codebase -->
> **Codebase:** `README.md` (lines 39-44) currently lists 2 agents in its
> Agents table. This will go stale after Phase 2 unless updated. Adding it here.
<!-- /deepen-plan -->

**Acceptance criteria:**
- [ ] Both plugin.json and package.json show `1.3.0`
- [ ] CHANGELOG follows Keep a Changelog format with `---` separators
- [ ] CLAUDE.md accurately documents all 4 agents
- [ ] README.md Agents table updated to show all 4 agents
- [ ] "When to Use What" table updated
- [ ] Cross-plugin dependencies section includes yellow-devin

## Technical Specifications

### Files to Modify

| File | Phase | Change |
|------|-------|--------|
| `plugins/yellow-chatprd/commands/chatprd/list.md` | 1 | Three listing modes |
| `plugins/yellow-chatprd/agents/workflow/document-assistant.md` | 1+2 | Three listing modes + search_chats |
| `plugins/yellow-chatprd/commands/chatprd/link-linear.md` | 1 | Related-specs enrichment |
| `plugins/yellow-chatprd/agents/workflow/linear-prd-bridge.md` | 1 | Related-specs enrichment |
| `plugins/yellow-chatprd/skills/chatprd-conventions/SKILL.md` | 1+2 | New tool mappings + review/dashboard patterns |
| `plugins/yellow-chatprd/commands/chatprd/create.md` | 2 | DeepWiki context injection |
| `plugins/yellow-chatprd/commands/chatprd/setup.md` | 2 | Profile diagnostics |
| `plugins/yellow-chatprd/.claude-plugin/plugin.json` | 1+2 | Version bumps |
| `plugins/yellow-chatprd/package.json` | 1+2 | Version bumps |
| `plugins/yellow-chatprd/CHANGELOG.md` | 1+2 | New entries |
| `plugins/yellow-chatprd/CLAUDE.md` | 1+2 | Updated documentation |
| `plugins/yellow-chatprd/README.md` | 2 | Updated Agents table |

### Files to Create

| File | Phase | Purpose |
|------|-------|---------|
| `plugins/yellow-chatprd/agents/workflow/document-reviewer.md` | 2 | PRD completeness review agent |
| `plugins/yellow-chatprd/agents/workflow/project-dashboard.md` | 2 | Project overview agent |

### MCP Tool Wiring Map

| MCP Tool | Phase | Wired Into |
|----------|-------|------------|
| `list_project_documents` | 1 | list.md, document-assistant, link-linear.md, linear-prd-bridge, project-dashboard |
| `list_documents` | 1 | list.md, document-assistant |
| `get_user_profile` | 2 | setup.md |
| `list_chats` | 2 | project-dashboard |
| `search_chats` | 2 | document-assistant |

### Cross-Plugin Dependencies

| Plugin | Dependency Type | Used By | Degradation |
|--------|----------------|---------|-------------|
| yellow-linear | Soft (existing) | link-linear.md, linear-prd-bridge | Install message + stop |
| yellow-devin | Soft (new) | create.md | Tip message + continue without context |

### MCP Tool Response Schemas (Verified)

<!-- deepen-plan: external -->
> **Research:** All tool response schemas verified via live MCP probing:
>
> **`get_document`** returns: `uuid`, `title`, `createdAt`, `updatedAt`,
> `content` (Markdown), `contentHtml` (HTML), `createdInThread` ({uuid, title,
> assistant}). **No `projectId`, `templateId`, or `templateName`.**
>
> **`list_project_documents`** input: `projectId` (required), `organizationId`
> (optional), `limit` (default 50). Returns array of document objects.
>
> **`list_documents`** input: `limit` (default 10), `projectId` (optional).
> Returns array: [{uuid, title, createdAt, updatedAt, threadId}].
>
> **`list_chats`** input: `limit` (default 10), `organizationId` (optional),
> `projectId` (optional). Returns: [{uuid, title, createdAt, updatedAt,
> assistant, _count: {messages}}].
>
> **`search_chats`** input: `query` (required), `limit`, `organizationId`,
> `projectId`. Same response shape as `list_chats`.
>
> **`get_user_profile`** input: none. Returns: {id, clerkId, email, firstName,
> lastName, createdAt, updatedAt, isDeleted, subscriptions[]}.
>
> **`list_templates`** input: `organizationId`, `includeSystem` (default true),
> `limit` (default 50). Returns: [{id, title, description, isSystem, default,
> share, createdAt, updatedAt}]. **No section structure.**
>
> **MCP errors:** Two-tier model. Protocol: JSON-RPC 2.0 error codes (-32600
> to -32099). Tool-level: successful JSON-RPC response with `isError: true` and
> text message in `content` array. Parse error text for routing.
<!-- /deepen-plan -->

## Testing Strategy

- **Manual testing per command:** Run each modified command with different
  argument combinations to verify routing (project-scoped, org-scoped, personal)
- **Cross-plugin testing:** Verify DeepWiki integration with and without
  yellow-devin installed
- **Error path testing:** Test with invalid project names, missing documents,
  network timeouts
- **Agent testing:** Invoke each agent with its trigger phrases and verify
  correct MCP tool usage

## Edge Cases & Error Handling

| Scenario | Handling |
|----------|----------|
| `get_document` has no projectId field | Use `default_project_id` from config; skip if unconfigured |
| `list_project_documents` timeout (>5s) | Skip enrichment, log warning |
| Template matching fails all tiers | General review with common PRD elements |
| DeepWiki returns empty wiki | "No context available", proceed without |
| `get_user_profile` fails during setup | Warning, continue setup |
| `search_chats` fails in document-assistant | Suppress silently |
| `list_chats` fails in project-dashboard | Omit conversations line |
| Project has 0 documents | Suggest starter set with /chatprd:create |
| Project name resolves to 0 matches | Show available projects, ask to rephrase |
| Document >5000 words in reviewer | Summarize sections before comparison |
| Free plan user hits feature gate | Show subscription status + upgrade hint |

## Acceptance Criteria

### Phase 1 (v1.2.0)

1. `/chatprd:list` routes to correct tool based on project/org/personal scope
2. Linear issues created via `/chatprd:link-linear` include related specs
3. `chatprd-conventions` documents listing tool selection and related-specs pattern
4. All changes follow existing patterns (frontmatter, step numbering, M3, C1, H1)
5. Version bumped to 1.2.0 in both manifests

### Phase 2 (v1.3.0)

1. `document-reviewer` agent reviews PRDs against template structure
2. `project-dashboard` agent shows full project inventory with coverage gaps
3. `/chatprd:create` offers DeepWiki context for technical templates
4. `/chatprd:setup` shows profile and subscription status
5. Chat tools wired as supplementary context in existing agents
6. All new agents follow established patterns (examples, conventions ref, M3/H1)
7. Version bumped to 1.3.0 in both manifests
8. 13/13 MCP tools wired in
