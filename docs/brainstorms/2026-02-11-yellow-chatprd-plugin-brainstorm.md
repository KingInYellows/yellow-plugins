# ChatPRD Plugin Brainstorm

**Date:** 2026-02-11
**Status:** Draft
**Author:** KingInYellows + Claude

---

## What We're Building

A `yellow-chatprd` plugin that integrates ChatPRD's MCP server into Claude Code workflows. The plugin provides on-demand access to ChatPRD's document creation, search, and update tools through well-crafted commands and auto-triggering agents. It also bridges ChatPRD documents with Linear issues via the existing `yellow-linear` plugin.

**Scope:** Thin MCP wrapper + lightweight Linear bridging (A+C hybrid). ChatPRD handles the heavy AI lifting; the plugin orchestrates and connects.

## Why This Approach

ChatPRD already has a capable AI engine for PRD authoring, review, and document generation. Duplicating that logic would create maintenance burden and fight the tool rather than complement it. Instead, we focus on:

1. **Ergonomic access** — Smart commands and agents that know when to invoke ChatPRD
2. **Linear bridge** — Connect PRD requirements to Linear issues bidirectionally
3. **Template awareness** — Guide users to the right template (built-in + custom) based on context
4. **Project organization** — Help set up and navigate ChatPRD Projects effectively

The "on-demand" philosophy means commands and agents are available when needed but don't force themselves into existing workflows like `/workflows:plan` or `/workflows:brainstorm`.

## Key Decisions

### 1. MCP Server Configuration

- **Remote hosted server** at `https://app.chatprd.ai/mcp`
- Uses `mcp-remote` npm package for Clerk-based OAuth authentication
- Browser-based auth flow — no manual token management
- Requires ChatPRD Team plan (already active)

**Config pattern** (follows yellow-linear's approach):

```json
// config/chatprd.mcp.json
{
  "chatprd": {
    "command": "npx",
    "args": ["-y", "mcp-remote", "https://app.chatprd.ai/mcp"]
  }
}
```

### 2. Available MCP Tools

ChatPRD exposes three tools via MCP:

| Tool | Purpose | Plugin Usage |
|------|---------|-------------|
| **Create Document** | Generate new docs using ChatPRD AI | `/chatprd:create`, document-assistant agent |
| **Update Document** | Modify existing docs | `/chatprd:update`, document-assistant agent |
| **Search Documents** | Find and retrieve doc content | `/chatprd:search`, all agents for context lookup |

### 3. Plugin Components

#### Commands (4)

| Command | Description | Key Behavior |
|---------|-------------|-------------|
| `/chatprd:create` | Create a new document in ChatPRD | Takes description + optional template hint. Uses Create Document MCP tool. Suggests templates based on context. |
| `/chatprd:search` | Search ChatPRD workspace | Takes search query. Returns matching documents with summaries. |
| `/chatprd:update` | Update an existing ChatPRD document | Takes document reference + changes. Uses Update Document MCP tool. |
| `/chatprd:link-linear` | Bridge a ChatPRD doc to Linear issues | Searches ChatPRD for a doc, extracts requirements, creates/links Linear issues via yellow-linear MCP tools. |

#### Agents (2)

| Agent | Triggers On | Behavior |
|-------|-------------|----------|
| **document-assistant** | "write a PRD", "create a spec", "draft a one-pager", "update the PRD", "what does the PRD say about..." | Auto-detects intent, searches existing docs first, then creates or updates via MCP. Suggests templates when creating. Handles all ChatPRD-only interactions. |
| **linear-prd-bridge** | "link PRD to Linear", "create issues from PRD", "sync PRD with Linear" | Bridges ChatPRD docs TO Linear issues only. Searches ChatPRD for a doc, extracts requirements, creates/links Linear issues. Only triggers when Linear is explicitly mentioned alongside PRD/doc context. |

#### Skills (1, internal)

| Skill | Purpose |
|-------|---------|
| **chatprd-conventions** | Shared reference for ChatPRD project structure, template guidance, PRD best practices for AI consumption. Referenced by agents and commands. Not user-invocable. |

### 4. Template Strategy

**Known constraint:** The 3 MCP tools don't include a "List Templates" endpoint. Template awareness is prompt-based, not API-based.

- The `chatprd-conventions` skill contains a static mapping of template names to use cases (e.g., "user persona" → User Persona Template)
- The document-assistant agent includes the template name in the Create Document prompt (e.g., "Create a user persona using the User Persona template")
- Custom templates are referenced by name — user tells the plugin which custom template to use
- If ChatPRD's MCP adds template listing later, we can make this dynamic

### 5. ChatPRD Projects Integration

**Known constraint:** No MCP tool for project management. Project context is user-provided, not auto-detected.

- The `chatprd-conventions` skill documents recommended project naming patterns
- Commands accept an optional project name argument — no auto-detection in v1
- Project organization guidance lives in the skill, not enforced by commands

### 6. Linear Bridge Design

The `link-linear` command and `linear-prd-bridge` agent connect two MCP servers:

**ChatPRD MCP** (search/read docs) → **extract requirements** → **Linear MCP** (create/link issues)

Flow:
1. Search ChatPRD for the relevant document
2. Parse requirements, user stories, or acceptance criteria from the doc
3. Create Linear issues with references back to the ChatPRD doc
4. Optionally update the ChatPRD doc with Linear issue links

**Dependency:** Requires `yellow-linear` plugin to be installed for Linear MCP access.

### 7. MCP Capability Assumptions

Features in this design depend on MCP tool behaviors we haven't verified yet. During implementation, we need to discover:

| Assumption | Affects | Fallback if False |
|------------|---------|-------------------|
| Search returns full doc content | Linear bridge requirement extraction | Bridge only links by title/URL, no content parsing |
| Create accepts template name in prompt | Template suggestion | Skip template hints, let ChatPRD pick |
| Documents are addressable by title or ID | Update and link-linear commands | Require user to paste ChatPRD URL |
| Search results include document metadata | All search-based flows | Show raw results, let user pick |

**Implementation order should prioritize MCP tool discovery** — connect the server first, inspect tool schemas, then build commands around actual capabilities.

## Plugin Structure

```
plugins/yellow-chatprd/
├── .claude-plugin/
│   └── plugin.json
├── CLAUDE.md
├── README.md
├── config/
│   └── chatprd.mcp.json
├── commands/
│   └── chatprd/
│       ├── create.md
│       ├── search.md
│       ├── update.md
│       └── link-linear.md
├── agents/
│   └── workflow/
│       ├── document-assistant.md
│       └── linear-prd-bridge.md
└── skills/
    └── chatprd-conventions/
        └── SKILL.md
```

## Open Questions

1. **MCP tool parameter schemas** — We need to discover the exact parameter names and schemas for ChatPRD's 3 MCP tools (Create, Update, Search). These aren't fully documented publicly. We'll discover them during implementation when the MCP server connects.

2. **Linear @chatprd bot overlap** — ChatPRD has a native Linear bot that can be @mentioned in issue comments. Should the plugin's Linear bridge replace this, complement it, or stay aware of it to avoid duplication?

3. **Document ID references** — How does ChatPRD's MCP server reference specific documents? By ID, title, or URL? This affects how the `update` and `link-linear` commands identify documents.

4. **Offline/cached access** — Should the plugin cache recent PRD content locally for when MCP is unavailable, or always require live access? (Leaning toward always-live for v1.)

5. **Cross-plugin dependency** — The `link-linear` command requires `yellow-linear` to be installed. Resolved: gracefully degrade with a clear error message ("Install yellow-linear plugin for Linear bridging") rather than enforcing a hard dependency.

## What's Out of Scope (v1)

- Complex sync logic between ChatPRD, Linear, and local markdown files
- Project management commands (creating/managing ChatPRD Projects via MCP)
- Document approval/review workflows within Claude Code
- Template creation/management commands (use ChatPRD's UI for this)
- Deep integration with `/workflows:plan` or `/workflows:brainstorm` (on-demand only)
- Export/format conversion commands

## Research Sources

- [ChatPRD MCP Integration](https://intercom.help/chatprd/en/articles/11917863-mcp-model-context-protocol-integration)
- [ChatPRD MCP Product Page](https://www.chatprd.ai/product/mcp)
- [PRD Best Practices for Claude Code](https://www.chatprd.ai/resources/PRD-for-Claude-Code)
- [ChatPRD Projects](https://intercom.help/chatprd/en/articles/10450666-chatprd-projects)
- [ChatPRD Template Library](https://intercom.help/chatprd/en/articles/9492176-template-library)
- [ChatPRD Linear Integration](https://linear.app/integrations/chatprd)
- [ChatPRD Team Features](https://www.chatprd.ai/product/features/collaborate-with-team)
- [mcp-remote npm package](https://www.npmjs.com/package/mcp-remote)
