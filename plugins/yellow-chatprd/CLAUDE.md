# yellow-chatprd Plugin

ChatPRD MCP integration with document management workflows and Linear bridging
for Claude Code.

## Overview

This plugin integrates ChatPRD's remote MCP server into Claude Code, providing
on-demand access to ChatPRD's document management tools through commands and
auto-triggering agents. A lightweight bridge connects ChatPRD documents to
Linear issues via the `yellow-linear` plugin.

**Approach:** Thin MCP wrapper — ChatPRD handles AI-powered document generation;
the plugin orchestrates access and connects tools.

## Authentication

- **Method:** Native MCP HTTP OAuth (Clerk-backed)
- **Flow:** Browser popup on first connection, automatic token management
  thereafter
- **Requirement:** ChatPRD account (no API key needed)
- **Note:** Requires browser access — will not work in headless SSH sessions

## Components

### Commands (6)

- `/chatprd:setup` — Configure default org and project with profile check
- `/chatprd:create` — Create a new document in ChatPRD with optional DeepWiki
  context for technical templates
- `/chatprd:search` — Search ChatPRD workspace for documents
- `/chatprd:update` — Update an existing ChatPRD document
- `/chatprd:list` — List documents in ChatPRD workspace (project-scoped,
  org-scoped, or personal)
- `/chatprd:link-linear` — Create Linear issues from a ChatPRD document

### Agents (4)

**Workflow:**

- `document-assistant` — ChatPRD document management (create, read, update,
  search) with supplementary chat context. Does NOT handle Linear bridging.
- `linear-prd-bridge` — Bridge ChatPRD documents to Linear issues with
  related-specs enrichment. Only triggers when Linear is explicitly mentioned
  alongside document context.
- `document-reviewer` — PRD completeness analysis against template structure.
  Reviews documents for missing/thin/adequate sections.
- `project-dashboard` — One-stop project overview showing document inventory,
  coverage gaps, and activity context. Read-only.

### Skills (1)

- `chatprd-conventions` — Error mapping, template guide, input validation,
  document review patterns, and dashboard formatting reference

## When to Use What

Commands and agents overlap intentionally to serve different invocation
patterns:

| Use Case                                          | Use This                     |
| ------------------------------------------------- | ---------------------------- |
| Configure workspace org/project                   | `/chatprd:setup`             |
| Quick document creation                           | `/chatprd:create`            |
| Find a specific document                          | `/chatprd:search`            |
| Modify document content                           | `/chatprd:update`            |
| Browse all documents                              | `/chatprd:list`              |
| Create Linear issues from PRD                     | `/chatprd:link-linear`       |
| Conversational document work (create/read/update) | `document-assistant` agent   |
| "Create issues from this PRD"                     | `linear-prd-bridge` agent    |
| "Review this PRD" / "Is this spec complete?"      | `document-reviewer` agent    |
| "What docs exist for project X?"                  | `project-dashboard` agent    |

## Cross-Plugin Dependencies

- **yellow-linear** — Required for `/chatprd:link-linear` command and
  `linear-prd-bridge` agent. Graceful degradation with install message when not
  present.
- **yellow-devin** — Optional for `/chatprd:create` (DeepWiki context injection
  for technical templates). Graceful degradation with tip message when not
  installed.

## Git Operations

This plugin does not perform git operations. Graphite commands and git workflows
do not apply.

## Known Limitations

- MCP-only — no offline mode, no local fallback
- Requires browser for Clerk OAuth — fails in headless SSH sessions
- Manual retry on transient MCP failures
- ChatPRD tool schemas may change — commands may need updates
- One-way Linear bridge only — no continuous sync, no link persistence
