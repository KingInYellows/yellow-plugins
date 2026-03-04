# ChatPRD MCP Server Capabilities, API Features, and Expansion Opportunities for Claude Code Plugin Integration

**Date:** 2026-03-03
**Sources:** Perplexity Deep Research, Tavily Research (pro), Tavily URL extraction (chatprd.ai docs, MCP page, templates page, collaboration page, connectors docs, tool selector docs, Linear/GitHub connector docs, quickstart, chat docs, writing docs, template docs), ChatPRD MCP tool schema introspection (all 13 tools), existing yellow-chatprd plugin source code analysis.

## Summary

ChatPRD is the leading AI-powered product documentation platform used by 100,000+ product managers. It provides AI document generation from 20+ templates, real-time collaborative editing with inline comments and versioning, a conversational AI chat interface for brainstorming and coaching, and MCP connectors to GitHub, Linear, Notion, Atlassian (Jira/Confluence), Granola, Google Drive, and Slack. The ChatPRD MCP server at `https://app.chatprd.ai/mcp` exposes **13 tools** -- the plugin currently uses only 8 of them, leaving 5 tools (`list_chats`, `search_chats`, `list_project_documents`, `get_user_profile`, `list_documents`) unused. Significant expansion opportunities exist around chat history access, project-scoped document listing, user profile/subscription awareness, template management commands, and deeper cross-plugin workflows.

## Key Findings

### 1. Complete MCP Tool Inventory (13 Tools)

The ChatPRD MCP server at `https://app.chatprd.ai/mcp` exposes exactly 13 tools. Here is the complete inventory with schemas, organized by category:

#### Document Management (5 tools)

| Tool | Description | Key Parameters | Plugin Status |
|------|-------------|----------------|---------------|
| `list_documents` | List user's personal documents | `limit` (default 10), `projectId` (optional) | **NOT USED** |
| `get_document` | Retrieve document by UUID with full content | `documentUuid` (required), `organizationId` (optional) | Used |
| `search_documents` | Text search across document titles and content | `query` (required) | Used |
| `create_document` | Create document with AI-generated content | `title` (required), `outline` (required array of {name, description}), `templateId`, `projectId`, `organizationId` | Used |
| `update_document` | Update document with instructions | `documentUuid` (required), `instructions` (required), `organizationId`, `assistantId` | Used |

#### Project and Organization (3 tools)

| Tool | Description | Key Parameters | Plugin Status |
|------|-------------|----------------|---------------|
| `list_projects` | List user's projects, optionally org-scoped | `organizationId`, `limit` (default 50) | Used |
| `list_user_organizations` | List user's org memberships | `limit` (default 10) | Used |
| `list_organization_documents` | List documents in a specific org | `organizationId` (required), `projectId`, `limit` (default 10) | Used |
| `list_project_documents` | List documents for a specific project | `projectId` (required), `organizationId`, `limit` (default 50) | **NOT USED** |

#### Chat and Conversations (2 tools)

| Tool | Description | Key Parameters | Plugin Status |
|------|-------------|----------------|---------------|
| `list_chats` | List user's chat history with metadata | `organizationId`, `projectId`, `limit` (default 10) | **NOT USED** |
| `search_chats` | Search chat history by content | `query` (required), `organizationId`, `projectId`, `limit` (default 10) | **NOT USED** |

#### Templates and Profile (2 tools)

| Tool | Description | Key Parameters | Plugin Status |
|------|-------------|----------------|---------------|
| `list_templates` | List available document templates | `organizationId`, `includeSystem` (default true), `limit` (default 50) | Used |
| `get_user_profile` | Get user name, email, subscription status | (none) | **NOT USED** |

**Summary: 8 tools used, 5 tools unused** (`list_documents`, `list_project_documents`, `list_chats`, `search_chats`, `get_user_profile`).

### 2. ChatPRD Product Capabilities (Full Feature Map)

**Core Document Engine:**
- AI-powered document generation from prompts, outlines, meeting notes, or uploaded files
- 20+ built-in templates (see Template section below)
- Real-time editor with AI-assisted section rewrites showing before/after diffs
- Multi-Doc Mode: create multiple documents from a single chat session
- Document versioning with full history, comparison, and version switching
- Import/export to Notion, Confluence, Google Docs, Markdown, Word

**AI/Chat Features:**
- Conversational AI interface for brainstorming, strategic coaching, and feedback
- Context-aware generation that pulls from connected tools (Linear issues, GitHub repos, Notion pages, meeting notes)
- File uploads supporting 20+ file types (PDF, DOCX, PPTX, code files, images)
- Google Drive file picker for direct upload
- Writing Mode toggle with template selection and settings per conversation
- Project-scoped conversations with persistent context (instructions, files, references)
- Chat branching for distinct conversation threads

**Collaboration:**
- Real-time collaborative editing with WebSocket-based transport
- Inline comments with teammate tagging
- Threaded comment discussions
- Document sharing with direct links
- Shared projects as unified context containers for cross-functional teams
- Organization workspaces with granular permission controls and admin dashboard
- Role-based access control (RBAC) for enterprise

**Security/Compliance:**
- SOC 2 Type II certified
- GDPR, CCPA, ISO-27001, FedRAMP, CSA Star Level 1
- SSO (Okta, Azure AD, Google Workspace)
- End-to-end encryption, data never trains models
- Enterprise: custom AI models, audit logging, data residency options

### 3. Template System (Complete Catalog)

ChatPRD ships 20+ templates organized into categories. Custom templates can be created on Pro/Team/Enterprise plans and shared across the organization.

**Core Templates:**
- ChatPRD: PRD (default) -- goals, context, user stories, requirements, success metrics
- No Template -- freeform starting point

**Technical and Product Documentation:**
- API Documentation -- endpoints, auth, error handling
- Technical Design Document -- architecture, components, dependencies, trade-offs
- Product Security Assessment -- security evaluation and mitigation

**Product Planning and Strategy:**
- Product Strategy Document -- vision, market context, goals, roadmap
- Release Plan -- milestones, dependencies, communication
- Go-to-Market Plan -- messaging, channels, timing, success metrics
- Product Launch Checklist -- launch readiness items
- OKRs -- objectives and key results
- PR FAQ -- Amazon-style working backwards approach

**Research, Testing, and UX:**
- Usability Test Plan -- objectives, methodology, criteria, success metrics
- User Testing Plan -- structured user testing framework
- User Personas -- demographics, goals, frustrations, behaviors
- Customer Journey Map -- awareness through advocacy
- Accessibility Compliance Checklist -- WCAG standards

**Analysis and Reporting:**
- Competitive Analysis Report -- competitor comparison

**Community Templates:**
- Aakash's PRD, Peter's PRD, Lenny's 1-Pager, Founding Hypothesis

**AI Code Generation Specialized:**
- PRD for v0.dev -- structured for AI code generation platforms
- App Prototyping with AI Code Generation

**Template Capabilities:**
- Custom template creation (Pro+): import existing, paste text, or build sections manually
- Default template setting per user/team
- Mid-conversation template switching
- Org-wide template sharing on Team plans
- Templates are discoverable via the `list_templates` MCP tool

### 4. Integration Ecosystem

**MCP Connectors (bidirectional, context-in):**

| Connector | Capabilities | Requirement |
|-----------|-------------|-------------|
| **Linear** | Browse issues/projects/sprints, create issues, check status | Pro+ |
| **GitHub** | Search repos/issues/PRs, create issues, check merged PRs | Pro+ |
| **Notion** | Search pages/databases/wikis, import context | Pro+ |
| **Atlassian** (Jira + Confluence) | Search Jira issues, Confluence pages | Pro+ |
| **Granola** | Search meeting notes and transcripts | Pro+ |

**Export/Push Integrations:**

| Integration | Capabilities |
|------------|-------------|
| **Notion** | Import/export pages |
| **Linear** | Create issues from PRDs |
| **Confluence** | Export specs to wiki |
| **Google Docs** | Import/export |
| **Google Drive** | AI search across Drive library, file picker |
| **Slack** | @chatprd in channels, notifications (beta) |
| **Markdown/Word** | Export in portable formats |

**IDE/MCP Client Integrations:**
- Cursor (one-click MCP setup)
- Claude Desktop
- VS Code
- Claude Code (via this plugin)
- Any MCP-compatible IDE

**Tool Selector:** Per-conversation toggle for which connectors are active (wrench icon in chat).

### 5. Chat/AI Features (Detailed)

ChatPRD's chat system is a core feature, not just a sidebar. Key aspects relevant to the plugin:

- **Chats are persistent and addressable** -- each has a title, creation date, external ID, and message count
- **Chats are org-scoped and project-scoped** -- both `list_chats` and `search_chats` accept `organizationId` and `projectId` parameters
- **Chats produce documents** -- documents are generated within chat conversations and linked to them (documents return `thread` metadata)
- **Chat history is searchable** -- `search_chats` searches chat content by query text
- **Multi-doc from chat** -- a single chat can produce multiple documents
- **Chat branching** -- create distinct conversation threads from a single starting point
- **Context persistence** -- Projects keep uploaded files, instructions, and references available across all chats in that project

This means the `list_chats` and `search_chats` tools can surface the *conversational context* behind any document -- the reasoning, decisions, and discussions that led to a PRD.

### 6. Unused Tools: Detailed Analysis and Value

**`list_documents`** (personal documents, project-filterable):
- Different from `list_organization_documents` -- this lists the user's *personal* documents
- Accepts `projectId` for filtering
- Value: Access personal/draft documents not yet in an org

**`list_project_documents`** (project-scoped listing):
- Requires `projectId`, accepts `organizationId`
- Higher default limit (50 vs 10 for `list_organization_documents`)
- Value: More precise document listing when project context is known -- directly replaces the current pattern of listing org docs then filtering by project

**`list_chats`** (chat history):
- Filterable by `organizationId` and `projectId`
- Returns title, creation date, external ID, message count
- Value: Surface the reasoning/discussion history behind documents

**`search_chats`** (chat content search):
- Text search across chat content
- Filterable by org and project scope
- Value: Find past discussions about features, decisions, or requirements

**`get_user_profile`** (subscription and identity):
- Returns name, email, subscription status
- No parameters required
- Value: Subscription-aware feature gating, personalized setup, diagnostics

### 7. Pricing Tier Implications for Plugin Features

| Feature | Free | Pro ($15/mo) | Teams ($29/user/mo) | Enterprise |
|---------|------|-------------|---------------------|------------|
| Basic AI chats | 3 limited | Unlimited | Unlimited | Unlimited |
| MCP access | ? | Yes | Yes | Yes |
| Custom templates | No | Yes | Yes | Yes |
| Projects | No | Yes | Yes | Yes |
| Shared projects | No | No | Yes | Yes |
| Comments | No | No | Yes | Yes |
| Linear integration | No | No | Yes | Yes |
| MCP connectors | No | Yes | Yes | Yes |
| SSO/RBAC | No | No | No | Yes |
| Custom AI models | No | No | No | Yes |

**Plugin implication:** The `get_user_profile` tool returns subscription status, enabling the plugin to proactively warn users about feature availability before they hit errors.

## Expansion Opportunities

### Priority 1: New Commands (using currently unused MCP tools)

**`/chatprd:chats` -- Browse and search chat history**
- Uses: `list_chats`, `search_chats`
- Value: Surface the reasoning behind documents, find past discussions
- Workflow: List recent chats (optionally project-scoped) or search by query, display results with message counts, offer to link related documents
- Trigger phrases: "what did we discuss about", "find the chat about", "show recent conversations"

**`/chatprd:profile` -- Show user profile and subscription status**
- Uses: `get_user_profile`
- Value: Diagnostics, subscription awareness, onboarding
- Could be folded into `/chatprd:setup` as a pre-check step

**`/chatprd:templates` -- Browse and inspect templates**
- Uses: `list_templates` (already available but not exposed as a standalone command)
- Value: Let users explore all available templates with descriptions before creating documents
- Could show system vs. custom templates, suggest templates for use cases

### Priority 2: Enhanced Existing Commands

**Enhance `/chatprd:list` with `list_project_documents`:**
- Currently uses `list_organization_documents` for all listing
- `list_project_documents` is more precise when project context is known and has a higher default limit (50 vs 10)
- When user specifies a project filter, use `list_project_documents` instead of `list_organization_documents` + filtering

**Enhance `/chatprd:setup` with `get_user_profile`:**
- Add a profile/subscription check at the beginning of setup
- Warn users on Free plan that MCP features require Pro+
- Display subscription status in the setup completion summary

**Enhance `/chatprd:search` with chat search:**
- Add a `--chats` or `--include-chats` flag/option
- When searching, also search chats with `search_chats` and present combined results
- "Found 3 documents and 2 conversations matching 'auth redesign'"

**Enhance `/chatprd:create` with `list_project_documents`:**
- Better dedup checking: search within the specific target project rather than globally
- More targeted duplicate detection reduces false positives

### Priority 3: New Agents

**`chat-historian` agent -- Conversational access to chat history:**
- Trigger: "what did we discuss about X", "find the conversation where we decided Y", "show me the chat that led to this PRD"
- Tools: `list_chats`, `search_chats`, `get_document` (to cross-reference)
- Value: Surfaces the *why* behind product decisions, not just the *what*

**`document-reviewer` agent -- AI-powered document review:**
- Trigger: "review this PRD", "check the spec for gaps", "is this PRD complete"
- Tools: `get_document`, `list_templates` (to compare against template structure), `search_chats` (to find original context)
- Workflow: Fetch document, compare against template structure, identify missing sections, check for completeness, suggest improvements via `update_document`

**`project-dashboard` agent -- Project status overview:**
- Trigger: "what's the status of project X", "show me the project overview", "what docs exist for the mobile project"
- Tools: `list_project_documents`, `list_chats`, `list_projects`, `get_document`
- Value: One-stop overview of all documents and conversations within a project

### Priority 4: Cross-Plugin Workflows

**ChatPRD + Linear sync enhancement:**
- Current: One-way, one-time bridge (PRD to Linear issues)
- Expansion: Use `search_chats` to find the original discussion context and include it in Linear issue descriptions
- Expansion: Use `list_project_documents` to find related specs and link them in Linear issue references

**ChatPRD + GitHub integration:**
- New command: `/chatprd:link-github` -- Create GitHub issues from a PRD (mirrors `/chatprd:link-linear` but for GitHub)
- Requires: yellow-github plugin (if it exists) or direct GitHub MCP tools
- Value: Teams using GitHub Issues instead of Linear get the same workflow

**ChatPRD + Devin/DeepWiki integration:**
- Use DeepWiki to provide codebase context when creating technical specs
- When creating a Technical Design Document, pull architecture context from the repo via DeepWiki

### Priority 5: Skills and Conventions Enhancements

**Update `chatprd-conventions` skill:**
- Add chat-related error mapping (for `list_chats`/`search_chats` failures)
- Add `get_user_profile` subscription status mapping to feature availability
- Add `list_project_documents` as a preferred tool for project-scoped listings

**New skill: `chatprd-chat-patterns`:**
- Conventions for chat history access, formatting chat results, linking chats to documents
- Chat result display format (title, message count, date, project, linked documents)

### Priority 6: Workflow/Agent Improvements

**`update_document` `assistantId` parameter:**
- The `update_document` tool accepts an `assistantId` parameter (currently unused by the plugin)
- This likely controls which AI assistant/model processes the update instructions
- Investigation: Determine if this can be used to specify project-specific assistants for better context-aware updates

**Template-driven workflows:**
- `/chatprd:create` could support template aliases: `/chatprd:create --template=api-doc Payment Gateway API`
- Pre-map template IDs to short names in the conventions skill

## Architecture Notes

### MCP Server Details
- **Endpoint:** `https://app.chatprd.ai/mcp`
- **Transport:** HTTP (MCP standard, JSON-RPC 2.0)
- **Auth:** Native MCP HTTP OAuth via Clerk -- browser popup on first connection, automatic token refresh
- **No API key required** -- OAuth handles everything
- **Limits:** No published rate limits or quotas; MCP ecosystem standard is 4MB max message size, 30s batch timeout

### Tool Schema Observations
- All tools use JSON Schema draft-07
- All tools have `additionalProperties: false` (strict schemas)
- Organization scoping is inconsistent: some tools require `organizationId`, others accept it optionally, `search_documents` does not accept it at all
- `create_document` requires a structured `outline` array (not freeform text) -- each item needs `name` and `description`
- `update_document` uses natural language `instructions` (not structured content replacement)
- `list_documents` vs `list_organization_documents` vs `list_project_documents` represent three different scoping levels (personal/org/project)

## Sources

- [ChatPRD Homepage](https://chatprd.ai)
- [ChatPRD MCP Product Page](https://www.chatprd.ai/product/mcp)
- [ChatPRD Collaboration Features](https://www.chatprd.ai/product/features/collaborate-with-team)
- [ChatPRD Write PRD Features](https://www.chatprd.ai/product/features/write-prd)
- [ChatPRD Included Templates](https://www.chatprd.ai/docs/included-templates)
- [ChatPRD Docs Index](https://www.chatprd.ai/docs)
- [ChatPRD Quickstart](https://www.chatprd.ai/docs/quickstart)
- [ChatPRD Using the Chat](https://www.chatprd.ai/docs/using-the-chat)
- [ChatPRD Writing Documents](https://www.chatprd.ai/docs/writing-documents)
- [ChatPRD Creating and Using Templates](https://www.chatprd.ai/docs/create-and-use-templates)
- [ChatPRD MCP Connectors Overview](https://www.chatprd.ai/docs/mcp-connectors)
- [ChatPRD Tool Selector](https://www.chatprd.ai/docs/tool-selector)
- [ChatPRD GitHub Connector](https://www.chatprd.ai/docs/github-mcp-connector)
- [ChatPRD Linear Connector](https://www.chatprd.ai/docs/linear-mcp-connector)
- [ChatPRD Pricing](https://www.chatprd.ai/pricing)
- [ChatPRD Enterprise](https://www.chatprd.ai/enterprise)
- [Linear ChatPRD Integration](https://linear.app/integrations/chatprd)
