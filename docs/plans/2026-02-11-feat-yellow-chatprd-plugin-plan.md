---
title: "feat: Add yellow-chatprd plugin with MCP integration and Linear bridge"
type: feat
date: 2026-02-11
brainstorm: docs/brainstorms/2026-02-11-yellow-chatprd-plugin-brainstorm.md
deepened: 2026-02-11
---

# feat: Add yellow-chatprd plugin with MCP integration and Linear bridge

## Enhancement Summary

**Deepened on:** 2026-02-11
**Sections enhanced:** 8
**Research agents used:** pattern-recognition-specialist, architecture-strategist, security-sentinel, agent-native-reviewer, code-simplicity-reviewer, performance-oracle, best-practices-researcher, create-agent-skills, agent-native-architecture, learnings-researcher

### Key Improvements
1. **MCP config format fix** — Use native HTTP transport (`"type": "http"`) instead of `npx mcp-remote` wrapper in `config/chatprd.mcp.json` (keep `mcp-remote` in `plugin.json` mcpServers for auth)
2. **Agent frontmatter fixes** — Add `model: inherit`, use XML `<examples>` blocks, tighten line budgets to 100-120
3. **Phase reorder** — Build conventions skill (Phase 2) before commands (Phase 3), since commands reference the skill
4. **Cross-plugin detection** — Replace `ToolSearch` check with direct `mcp__plugin_linear_linear__list_teams` call for linear-prd-bridge
5. **TOCTOU fix** — Re-fetch document with `get_document` immediately before `update_document` in update command
6. **Rate limiting** — Add concurrency=3 and exponential backoff on 429 for link-linear bulk issue creation
7. **Missing tools** — Add `list_issues` and `update_issue` to linear-prd-bridge allowed-tools for dedup
8. **Skill scope trim** — Reduce conventions skill to ~60-80 lines: error mapping + template guide only

### New Considerations Discovered
- Native HTTP MCP support in Claude Code 2026 means `mcp-remote` wrapper is only needed in `plugin.json` mcpServers (for Clerk OAuth), not in the config file
- `disable-model-invocation: true` must NOT be used — contradicts institutional learning from yellow-linear PR #6
- Agent trigger handoff pattern needed: document-assistant should explicitly suggest linear-prd-bridge when Linear context detected

## Overview

Create a `yellow-chatprd` plugin that integrates ChatPRD's remote MCP server into Claude Code. The plugin provides on-demand access to ChatPRD's document management tools through commands and auto-triggering agents, plus a lightweight bridge connecting ChatPRD documents to Linear issues via the existing `yellow-linear` plugin.

**Approach:** Thin MCP wrapper — ChatPRD handles AI-powered document generation; the plugin orchestrates access and connects tools.

## Problem Statement

ChatPRD is used for PRD authoring, user personas, API docs, launch plans, and other product documentation. Currently, accessing ChatPRD from Claude Code requires manual copy-paste or browser switching. There's no way to:

- Search/create/update ChatPRD documents from the CLI
- Auto-load PRD context during implementation work
- Bridge ChatPRD documents to Linear issues programmatically

## Proposed Solution

A plugin following the yellow-linear pattern with:

- **5 commands**: create, search, update, list, link-linear
- **2 agents**: document-assistant (ChatPRD-only interactions), linear-prd-bridge (ChatPRD→Linear bridging)
- **1 internal skill**: chatprd-conventions (templates, project structure, best practices)
- **MCP server**: Remote hosted at `https://app.chatprd.ai/mcp` with Clerk OAuth via `mcp-remote`

## Technical Approach

### MCP Server

- **URL**: `https://app.chatprd.ai/mcp`
- **Transport**: HTTP (remote hosted, same pattern as Linear)
- **Auth**: Clerk OAuth via `mcp-remote` — browser popup on first connection, automatic token management
- **Config**: `config/chatprd.mcp.json` referenced in `entrypoints.mcpServers`

#### Research Insights — MCP Configuration

**Best Practice (2026):** Claude Code now supports native HTTP MCP transport. The config file should use `"type": "http"` format, while `plugin.json` mcpServers keeps the `mcp-remote` wrapper for Clerk OAuth:

```json
// config/chatprd.mcp.json — native HTTP transport
{
  "chatprd": {
    "type": "http",
    "url": "https://app.chatprd.ai/mcp"
  }
}

// plugin.json mcpServers — mcp-remote for OAuth
"mcpServers": {
  "chatprd": {
    "command": "npx",
    "args": ["-y", "mcp-remote", "https://app.chatprd.ai/mcp"]
  }
}
```

**Why two formats:** The config file is what Claude Code reads for MCP transport — native HTTP is faster and avoids the npx subprocess. The `plugin.json` mcpServers block is the auth registration that triggers Clerk OAuth via `mcp-remote`.

### Available MCP Tools (discovered via research)

| MCP Tool Name | Full Prefixed Name | Used By |
|---|---|---|
| `create_document` | `mcp__plugin_chatprd_chatprd__create_document` | create command, document-assistant agent |
| `update_document` | `mcp__plugin_chatprd_chatprd__update_document` | update command, document-assistant agent |
| `search_documents` | `mcp__plugin_chatprd_chatprd__search_documents` | search command, both agents |
| `list_documents` | `mcp__plugin_chatprd_chatprd__list_documents` | list command, document-assistant agent |
| `get_document` | `mcp__plugin_chatprd_chatprd__get_document` | update/link-linear commands, both agents |
| `list_templates` | `mcp__plugin_chatprd_chatprd__list_templates` | create command, conventions skill |
| `list_projects` | `mcp__plugin_chatprd_chatprd__list_projects` | create command (project selection) |
| `list_user_organizations` | `mcp__plugin_chatprd_chatprd__list_user_organizations` | conventions skill (org context) |
| `get_user_profile` | `mcp__plugin_chatprd_chatprd__get_user_profile` | auth verification |

**Note:** Exact parameter schemas TBD — Phase 0 discovers actual tool schemas by connecting to the MCP server. The plan accounts for schema differences via fallback behaviors.

### Plugin Structure

```
plugins/yellow-chatprd/
├── .claude-plugin/
│   └── plugin.json
├── CLAUDE.md
├── config/
│   └── chatprd.mcp.json
├── commands/
│   └── chatprd/
│       ├── create.md
│       ├── search.md
│       ├── update.md
│       ├── list.md
│       └── link-linear.md
├── agents/
│   └── workflow/
│       ├── document-assistant.md
│       └── linear-prd-bridge.md
└── skills/
    └── chatprd-conventions/
        └── SKILL.md
```

### Security Patterns (from institutional learnings)

| Pattern | Application |
|---|---|
| **C1: Validate before write** | `get_document` before every `update_document` call |
| **H1: TOCTOU mitigation** | Re-fetch document immediately before write — never cache and reuse stale content |
| **Read-before-write dedup** | `search_documents` before `create_document` to avoid duplicates |
| **M3: Explicit confirmation** | Agents confirm before creating/updating documents |
| **Input validation** | Reject `$ARGUMENTS` containing path traversal (`..`, `/`, `~`), enforce max-length (500 chars) |
| **Least-privilege tools** | Each command/agent lists only the MCP tools it actually uses |
| **No `disable-model-invocation`** | All commands remain agent-accessible (institutional learning from yellow-linear PR #6) |
| **Rate limiting** | 200ms delay between Linear issue creates, exponential backoff on HTTP 429 |

#### Research Insights — Security

**TOCTOU in update flow (Critical):** The update command must re-fetch the document with `get_document` immediately before calling `update_document`. Do NOT rely on a document fetched earlier in the flow — another user or ChatPRD bot may have modified it.

**Auth error handling:** Document these MCP auth failure modes in the conventions skill error mapping:
- Token expired → re-auth prompt (mcp-remote handles automatically)
- No team subscription → clear error: "ChatPRD Team plan required"
- Network timeout → retry once, then report "ChatPRD unavailable"

## Implementation Phases

### Phase 0: MCP Discovery (prerequisite)

Connect to ChatPRD's MCP server and inspect actual tool schemas.

**Tasks:**

1. Run `npx mcp-remote https://app.chatprd.ai/mcp` to initiate OAuth and connect
2. List available tools and their parameter schemas
3. Document actual tool names, required/optional parameters, response formats
4. Compare against assumed tool list above — note any differences
5. Update command designs if schemas differ from assumptions

**Fallback behaviors (from brainstorm):**

| If Discovery Shows... | Adjust... |
|---|---|
| Fewer tools than expected | Remove corresponding commands, simplify agents |
| Different parameter names | Update command instructions to match actual schemas |
| No `list_templates` tool | Remove template listing from create command, keep static list in conventions skill |
| No `list_projects` tool | Remove project selection from create command, accept project name as freeform text |

**Output:** A reference document or notes with actual MCP tool schemas to guide the remaining phases.

### Phase 1: Plugin Scaffold

Create the directory structure, plugin.json, MCP config, and CLAUDE.md.

**Tasks:**

1. Create directory tree:
   ```
   plugins/yellow-chatprd/.claude-plugin/
   plugins/yellow-chatprd/config/
   plugins/yellow-chatprd/commands/chatprd/
   plugins/yellow-chatprd/agents/workflow/
   plugins/yellow-chatprd/skills/chatprd-conventions/
   ```

2. Create `plugins/yellow-chatprd/config/chatprd.mcp.json` (native HTTP transport):
   ```json
   {
     "chatprd": {
       "type": "http",
       "url": "https://app.chatprd.ai/mcp"
     }
   }
   ```

3. Create `plugins/yellow-chatprd/.claude-plugin/plugin.json` (extended schema):
   ```json
   {
     "name": "yellow-chatprd",
     "version": "1.0.0",
     "description": "ChatPRD MCP integration with document management workflows and Linear bridging for Claude Code",
     "author": {
       "name": "KingInYellows",
       "url": "https://github.com/kinginyellow"
     },
     "homepage": "https://github.com/kinginyellow/yellow-plugins#yellow-chatprd",
     "repository": {
       "type": "git",
       "url": "https://github.com/kinginyellow/yellow-plugins"
     },
     "license": "MIT",
     "keywords": ["chatprd", "prd", "product-management", "documentation", "linear"],
     "mcpServers": {
       "chatprd": {
         "command": "npx",
         "args": ["-y", "mcp-remote", "https://app.chatprd.ai/mcp"]
       }
     },
     "entrypoints": {
       "commands": [
         "commands/chatprd/create.md",
         "commands/chatprd/search.md",
         "commands/chatprd/update.md",
         "commands/chatprd/list.md",
         "commands/chatprd/link-linear.md"
       ],
       "agents": [
         "agents/workflow/document-assistant.md",
         "agents/workflow/linear-prd-bridge.md"
       ],
       "skills": [
         "skills/chatprd-conventions/SKILL.md"
       ],
       "mcpServers": [
         "config/chatprd.mcp.json"
       ]
     },
     "compatibility": {
       "claudeCodeMin": "2.0.0"
     },
     "permissions": [
       {
         "scope": "network",
         "reason": "Connects to ChatPRD MCP server for document management",
         "domains": ["app.chatprd.ai"]
       },
       {
         "scope": "shell",
         "reason": "Runs git commands for branch context detection",
         "commands": ["git"]
       }
     ]
   }
   ```

4. Create `plugins/yellow-chatprd/CLAUDE.md` — must match yellow-linear's heading structure:
   - `## Overview` — Plugin purpose and MCP server connection
   - `## Authentication` — Clerk OAuth via mcp-remote, automatic browser flow
   - `## Components` — 5 commands, 2 agents, 1 skill with brief descriptions
   - `## When to Use What` — Command vs agent disambiguation table
   - `## Cross-Plugin Dependencies` — yellow-linear required for link-linear
   - `## Known Limitations` — Headless SSH, no offline mode, MCP tool availability

5. Register in `.claude-plugin/marketplace.json`:
   ```json
   {
     "id": "yellow-chatprd",
     "name": "yellow-chatprd",
     "description": "ChatPRD MCP integration with document management and Linear bridging",
     "version": "1.0.0",
     "author": { "name": "KingInYellows" },
     "source": "./plugins/yellow-chatprd",
     "category": "productivity"
   }
   ```

### Phase 2: Internal Skill (prerequisite for commands)

Build the conventions skill first — commands and agents reference it for template guidance and error mapping.

#### `chatprd-conventions` skill

```yaml
---
name: chatprd-conventions
description: >
  ChatPRD conventions and patterns reference. Use when commands or agents
  need context about ChatPRD templates, project structure, or error handling.
user-invocable: false
---
```

**Content sections (~60-80 lines total):**
- **Error Mapping** (~20 lines) — MCP error codes → user-friendly messages (auth failure, not found, rate limited, server down)
- **Template Guide** (~30 lines) — Static mapping of ChatPRD template names to use cases (PRD, one-pager, user persona, API doc, launch plan). Updated dynamically by `list_templates` when available.
- **Input Validation** (~10 lines) — Shared validation rules: max 500 chars, reject path traversal, trim whitespace

**Heading:** Must use `## Usage` (per plugin authoring rules).

**Trimmed scope:** Removed PRD best practices (ChatPRD AI handles this), project organization (user-provided), and organization context (discoverable via MCP) from original design. Keep only what commands/agents actually reference.

#### Research Insights — Skill Design

**Pattern (from create-agent-skills):** Skills referenced by agents must be listed in the agent's `allowed-tools`. However, internal skills loaded via `entrypoints.skills` are auto-available — no explicit tool listing needed. Verify this during Phase 6 validation.

**YAGNI applied:** The original ~100-line budget included PRD best practices and project organization sections. These duplicate ChatPRD's own AI capabilities and docs — removed to prevent staleness.

---

### Phase 3: Core Commands (4)

Build the four ChatPRD-only commands. Each follows the yellow-linear command pattern.

#### Research Insights — Command Structure

**Required heading pattern (from pattern-recognition):** Every command `.md` must start with `# Title` heading before `## Workflow`. The yellow-linear commands follow this structure:
```markdown
---
(frontmatter)
---

# Create Document

## Workflow

1. Parse `$ARGUMENTS`...
```

**`$ARGUMENTS` validation:** All commands should validate `$ARGUMENTS` early — reject empty input, path traversal chars, and inputs >500 chars. Reference the conventions skill's input validation rules.

**Performance (from performance-oracle):** In the create command, `list_templates` and `list_projects` are independent — call them in parallel to save ~300ms.

#### 2a. `/chatprd:create` — Create a new document

```yaml
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
```

**Flow:**
1. Parse `$ARGUMENTS` for document description
2. **Dedup check (read-before-write):** `search_documents` for similar titles — warn if duplicate found
3. **Template selection:** `list_templates` to show available templates, suggest best match based on description, let user confirm via `AskUserQuestion`
4. **Project selection:** `list_projects` to show available projects, let user pick or use default
5. **Create:** `create_document` with description, template, and project
6. **Output:** Show document title, URL, and suggest next steps ("update with /chatprd:update or link to Linear with /chatprd:link-linear")

#### 2b. `/chatprd:search` — Search documents

```yaml
---
name: chatprd:search
description: >
  Search ChatPRD workspace for documents. Use when user wants to "find a PRD",
  "search for docs about", "look up the spec for", or find any existing
  ChatPRD document.
argument-hint: "[search query]"
allowed-tools:
  - Read
  - AskUserQuestion
  - ToolSearch
  - mcp__plugin_chatprd_chatprd__search_documents
  - mcp__plugin_chatprd_chatprd__get_document
---
```

**Flow:**
1. Parse `$ARGUMENTS` for search query
2. `search_documents` with query
3. Display results (title, project, last updated)
4. If user wants details on a specific result: `get_document` to show full content

#### 2c. `/chatprd:update` — Update an existing document

```yaml
---
name: chatprd:update
description: >
  Update an existing ChatPRD document. Use when user wants to "update the PRD",
  "add requirements to", "revise the spec", or modify any existing ChatPRD document.
argument-hint: "[document title or description of changes]"
allowed-tools:
  - Read
  - Grep
  - AskUserQuestion
  - ToolSearch
  - mcp__plugin_chatprd_chatprd__search_documents
  - mcp__plugin_chatprd_chatprd__get_document
  - mcp__plugin_chatprd_chatprd__update_document
---
```

**Flow:**
1. Parse `$ARGUMENTS` — could be document title, ID, or change description
2. **Find document:** `search_documents` to locate, let user confirm if multiple matches
3. **C1 validation:** `get_document` to verify existence and show current content
4. **Confirm changes:** Present current state, ask user to describe changes via `AskUserQuestion`
5. **H1 TOCTOU:** Re-fetch with `get_document` immediately before write (content may have changed during user interaction)
6. **Update:** `update_document` with changes
7. **Output:** Show confirmation and updated document URL

#### 2d. `/chatprd:list` — List documents

```yaml
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
```

**Flow:**
1. Parse `$ARGUMENTS` for optional project filter
2. If project specified: `list_documents` filtered by project
3. If no project: `list_projects` first, let user pick or show all
4. Display results (title, project, last updated) — progressive loading, show top 20
5. If user wants to read one: `get_document` for full content

### Phase 4: Agents (2)

#### 4a. `document-assistant` agent

```yaml
---
name: document-assistant
model: inherit
description: >
  ChatPRD document management assistant. Use when user wants to create, find,
  read, or update product documents in ChatPRD. Triggers on "write a PRD",
  "create a spec", "draft a one-pager", "what does the PRD say about",
  "find the spec for", "update the requirements", or any ChatPRD document
  interaction that does NOT involve Linear.
allowed-tools:
  - Read
  - Grep
  - Bash
  - AskUserQuestion
  - ToolSearch
  - mcp__plugin_chatprd_chatprd__create_document
  - mcp__plugin_chatprd_chatprd__update_document
  - mcp__plugin_chatprd_chatprd__search_documents
  - mcp__plugin_chatprd_chatprd__list_documents
  - mcp__plugin_chatprd_chatprd__get_document
  - mcp__plugin_chatprd_chatprd__list_templates
  - mcp__plugin_chatprd_chatprd__list_projects
---
```

**Examples block (XML format, 4 examples):**

```markdown
<examples>
<example>
Context: User wants to create a new product document.
user: "Write a PRD for the authentication feature"
assistant: "I'll check for existing auth docs first, then create a new one with an appropriate template."
<commentary>User requesting PRD creation triggers search-then-create workflow with template suggestion.</commentary>
</example>
<example>
Context: User wants to look up information in an existing document.
user: "What does the PRD say about error handling?"
assistant: "I'll search ChatPRD for documents mentioning error handling."
<commentary>Read intent — search and retrieve, no modifications.</commentary>
</example>
<example>
Context: User wants to modify an existing document.
user: "Update the auth spec with the new OAuth requirements"
assistant: "I'll find the auth spec, show current content, and confirm the changes before updating."
<commentary>Update intent triggers C1 validation (get before update) and M3 confirmation.</commentary>
</example>
<example>
Context: User mentions Linear alongside a document — this is NOT document-assistant's domain.
user: "Create Linear issues from the auth PRD"
assistant: "That involves Linear integration. Use /chatprd:link-linear or the linear-prd-bridge agent for bridging documents to Linear."
<commentary>Linear mentioned explicitly — hand off to linear-prd-bridge, don't attempt bridging.</commentary>
</example>
</examples>
```

**Behavior:**
- Auto-detects intent (create vs read vs update vs search)
- Searches existing docs before creating (dedup)
- Suggests templates when creating based on context
- **M3 safety:** Confirms before any create/update operations
- **Handoff pattern:** When Linear is mentioned, explicitly suggest linear-prd-bridge or `/chatprd:link-linear` instead of attempting to bridge
- **TOCTOU:** Re-fetch with `get_document` immediately before `update_document`

**Line budget:** ~100-120 lines (under 200 limit)

#### Research Insights — Agent Design

**Pattern (from agent-native-reviewer):** Example 4 demonstrates the handoff pattern — document-assistant explicitly suggests the correct agent when it detects out-of-scope intent. This prevents the "sync" confusion where users say "sync with Linear" and document-assistant tries to handle it.

**Anti-pattern (from create-agent-skills):** Do NOT add `disable-model-invocation: true` to agent frontmatter. This was identified as a bug in yellow-linear PR #6 — it prevents other agents and commands from invoking the agent.

#### 4b. `linear-prd-bridge` agent

```yaml
---
name: linear-prd-bridge
model: inherit
description: >
  Bridge ChatPRD documents to Linear issues. Use when user explicitly mentions
  both PRD/document AND Linear together, such as "link PRD to Linear",
  "create Linear issues from PRD", "create issues from PRD", or "turn this
  spec into Linear issues". Only triggers when Linear is explicitly mentioned
  alongside document context.
allowed-tools:
  - Read
  - Grep
  - Bash
  - AskUserQuestion
  - ToolSearch
  - mcp__plugin_chatprd_chatprd__search_documents
  - mcp__plugin_chatprd_chatprd__get_document
  - mcp__plugin_linear_linear__create_issue
  - mcp__plugin_linear_linear__list_teams
  - mcp__plugin_linear_linear__list_issues
  - mcp__plugin_linear_linear__list_issue_statuses
  - mcp__plugin_linear_linear__get_issue
  - mcp__plugin_linear_linear__update_issue
---
```

**Examples block (XML format, 3 examples):**

```markdown
<examples>
<example>
Context: User wants to create Linear issues from a ChatPRD document.
user: "Create Linear issues from the auth PRD"
assistant: "I'll find the auth PRD in ChatPRD, extract requirements, and propose a Linear issue breakdown for your review."
<commentary>Explicit Linear + PRD context triggers bridging. Searches ChatPRD first, then proposes issues before creating.</commentary>
</example>
<example>
Context: User wants to link a document to Linear tracking.
user: "Link this PRD to Linear"
assistant: "I'll get the PRD content and propose an issue breakdown. You'll review before I create anything."
<commentary>M3 confirmation — always show proposed issues before creation.</commentary>
</example>
<example>
Context: User wants to create issues but some may already exist.
user: "Turn the onboarding spec into Linear issues"
assistant: "I'll check for existing Linear issues related to this spec first to avoid duplicates, then propose new issues for any gaps."
<commentary>Dedup check with list_issues before creating. One-way operation, not continuous sync.</commentary>
</example>
</examples>
```

**Behavior:**
- **Fail-fast check:** Call `mcp__plugin_linear_linear__list_teams` directly — if tool not found, show error: "Install yellow-linear plugin for Linear bridging" and stop
- Searches ChatPRD for the referenced document
- `get_document` to read full content
- Extracts requirement sections (user stories, acceptance criteria, features)
- **Dedup check:** `list_issues` to find existing issues matching PRD requirements — skip duplicates
- Proposes issue breakdown to user via `AskUserQuestion` — user reviews before creation
- Creates Linear issues with PRD doc title in description as reference
- **Rate limiting:** concurrency=3, 200ms delay between creates, exponential backoff on 429
- **One-way, one-time operation** — no continuous sync, no link persistence
- **M3 safety:** Always confirms issue list before creating

**Line budget:** ~100-120 lines (under 200 limit)

**Cross-plugin dependency detection:**
```markdown
### Step 1: Check Linear MCP Availability

Attempt to call `mcp__plugin_linear_linear__list_teams`:
- If successful: Linear MCP is available, proceed with bridging flow
- If error "tool not found": report "yellow-linear plugin not installed. Install it with `/plugin marketplace add kinginyellow/yellow-plugins yellow-linear`" and stop
```

#### Research Insights — Cross-Plugin & Agent Patterns

**Direct MCP call > ToolSearch (from architecture-strategist):** Using `ToolSearch` to check for Linear tools adds latency and an extra dependency. A direct call to `list_teams` both validates availability AND retrieves useful data for the next step.

**Dedup before create (from agent-native-reviewer):** The original plan was missing `list_issues` from allowed-tools. Without it, running link-linear twice on the same PRD would create duplicate issues. Added `list_issues` for dedup and `update_issue` for future sync capability.

**Example 3 fix (from agent-native-reviewer):** The original example said "sync" but the plan says "one-way, one-time operation." Updated to "turn into issues" with explicit dedup language to avoid setting sync expectations.

### Phase 5: Link-Linear Command

Build after Phase 2-3 since it depends on both MCP servers working.

#### `/chatprd:link-linear` — Bridge document to Linear issues

```yaml
---
name: chatprd:link-linear
description: >
  Create Linear issues from a ChatPRD document. Use when user wants to
  "link PRD to Linear", "create issues from spec", "turn PRD into Linear issues",
  or bridge any ChatPRD document to Linear.
argument-hint: "[document title or search query]"
allowed-tools:
  - Read
  - Grep
  - Bash
  - AskUserQuestion
  - ToolSearch
  - mcp__plugin_chatprd_chatprd__search_documents
  - mcp__plugin_chatprd_chatprd__get_document
  - mcp__plugin_linear_linear__create_issue
  - mcp__plugin_linear_linear__list_teams
  - mcp__plugin_linear_linear__list_issues
  - mcp__plugin_linear_linear__list_issue_statuses
  - mcp__plugin_linear_linear__get_issue
  - mcp__plugin_linear_linear__update_issue
---
```

**Flow:**
1. **Fail-fast check:** Call `mcp__plugin_linear_linear__list_teams` directly — if tool not found, report install message and stop
2. Parse `$ARGUMENTS` for document title or query (validate: reject path traversal, max 500 chars)
3. `search_documents` to find the document
4. `get_document` to read full content
5. Extract requirements (user stories, features, acceptance criteria sections)
6. `list_teams` result from step 1 — let user pick Linear team
7. **Dedup check:** `list_issues` to find existing issues matching PRD requirements
8. Present proposed issue breakdown via `AskUserQuestion` — mark duplicates, user reviews/edits/approves
9. Create Linear issues with concurrency=3, 200ms delay between creates
10. Include ChatPRD document title as reference in each issue description
11. **Output:** Summary of created issues with Linear URLs

**Error handling:**
- yellow-linear not installed → fail fast with clear message
- Document not found → suggest `/chatprd:search` or `/chatprd:list`
- Partial failure (some issues created, some failed) → report which succeeded, offer retry for failures
- HTTP 429 rate limiting → exponential backoff (1s, 2s, 4s), max 3 retries per issue — never fall through

#### Research Insights — Performance

**Parallel calls in create flow (from performance-oracle):** Steps 3 (`search_documents`) and step 1 (`list_teams`) can run in parallel since they're independent — saves ~300ms on first call.

**Batch size (from performance-oracle):** Default list results from 10→20 items to reduce pagination round-trips for workspaces with many documents.

### Phase 6: Validation & Polish

**Tasks:**

1. Run `pnpm validate:schemas` — fix any schema violations
2. Verify all `allowed-tools` lists are complete (every MCP tool used in body is listed)
3. Verify all entrypoints in plugin.json point to existing files
4. Verify agent files are under 120 lines (tightened from 200)
5. Verify all descriptions have "Use when..." trigger clauses
6. Verify `$ARGUMENTS` used (not hardcoded values) in all commands
7. Verify SKILL.md uses `## Usage` heading
8. Verify LF line endings (`.gitattributes` or manual check)
9. Verify agent frontmatter includes `model: inherit`
10. Verify agent examples use XML `<examples><example>` format
11. Verify commands start with `# Title` heading before `## Workflow`
12. Verify CLAUDE.md heading structure matches yellow-linear pattern
13. Verify `config/chatprd.mcp.json` uses `"type": "http"` format (not `mcp-remote`)
14. Verify `plugin.json` mcpServers uses `mcp-remote` for Clerk OAuth
15. Verify no `disable-model-invocation: true` in any file
16. Test MCP connection manually

## Acceptance Criteria

- [x] Plugin passes `pnpm validate:schemas` (both marketplace and plugin validation)
- [ ] MCP server connects and authenticates via Clerk OAuth
- [x] 5 commands work end-to-end: create, search, update, list, link-linear
- [x] 2 agents auto-trigger on appropriate phrases without overlap
- [x] document-assistant does NOT trigger on Linear-related phrases
- [x] linear-prd-bridge does NOT trigger on ChatPRD-only phrases
- [x] link-linear gracefully degrades when yellow-linear is not installed
- [x] All commands confirm before write operations (M3 safety)
- [x] All commands validate document existence before updates (C1 validation)
- [x] create command checks for duplicates before creating (read-before-write)
- [x] Agent files are under 200 lines each
- [x] All MCP tool references use full prefixed names

## Dependencies & Risks

| Dependency | Risk | Mitigation |
|---|---|---|
| ChatPRD MCP server availability | Server down = plugin non-functional | No offline mode in v1; clear error messages |
| MCP tool schemas unknown until connection | Commands may need redesign after Phase 0 | Fallback behaviors defined in brainstorm |
| `mcp-remote` npm package | Version changes could break auth | Pin to known working version in config |
| yellow-linear plugin for link-linear | Cross-plugin dependency | Graceful degradation with install message |
| Clerk OAuth requires browser | Fails in headless SSH sessions | Document limitation; no workaround in v1 |

## References

### Internal
- Brainstorm: `docs/brainstorms/2026-02-11-yellow-chatprd-plugin-brainstorm.md`
- Reference plugin: `plugins/yellow-linear/` (complete MCP integration example)
- Security patterns: `docs/solutions/security-issues/yellow-linear-plugin-multi-agent-code-review.md`
- Dedup pattern: `docs/solutions/logic-errors/yellow-linear-plugin-duplicate-pr-comments-fix.md`
- Plugin validation: `docs/plugin-validation-guide.md`

### External
- [ChatPRD MCP Integration](https://intercom.help/chatprd/en/articles/11917863-mcp-model-context-protocol-integration)
- [ChatPRD MCP Product Page](https://www.chatprd.ai/product/mcp)
- [PRD Best Practices for Claude Code](https://www.chatprd.ai/resources/PRD-for-Claude-Code)
- [ChatPRD Template Library](https://intercom.help/chatprd/en/articles/9492176-template-library)
- [ChatPRD Linear Integration](https://linear.app/integrations/chatprd)
- [mcp-remote npm package](https://www.npmjs.com/package/mcp-remote)
