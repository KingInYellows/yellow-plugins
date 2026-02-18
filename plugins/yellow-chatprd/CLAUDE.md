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

### Commands (5)

- `/chatprd:create` — Create a new document in ChatPRD (PRD, spec, one-pager,
  API doc)
- `/chatprd:search` — Search ChatPRD workspace for documents
- `/chatprd:update` — Update an existing ChatPRD document
- `/chatprd:list` — List documents in ChatPRD workspace
- `/chatprd:link-linear` — Create Linear issues from a ChatPRD document

### Agents (2)

**Workflow:**

- `document-assistant` — ChatPRD document management (create, read, update,
  search). Does NOT handle Linear bridging.
- `linear-prd-bridge` — Bridge ChatPRD documents to Linear issues. Only triggers
  when Linear is explicitly mentioned alongside document context.

### Skills (1)

- `chatprd-conventions` — Error mapping, template guide, and input validation
  reference for commands and agents

## When to Use What

Commands and agents overlap intentionally to serve different invocation
patterns:

| Use Case                                          | Use This                   |
| ------------------------------------------------- | -------------------------- |
| Quick document creation                           | `/chatprd:create`          |
| Find a specific document                          | `/chatprd:search`          |
| Modify document content                           | `/chatprd:update`          |
| Browse all documents                              | `/chatprd:list`            |
| Create Linear issues from PRD                     | `/chatprd:link-linear`     |
| Conversational document work (create/read/update) | `document-assistant` agent |
| "Create issues from this PRD"                     | `linear-prd-bridge` agent  |

## Cross-Plugin Dependencies

- **yellow-linear** — Required for `/chatprd:link-linear` command and
  `linear-prd-bridge` agent. Graceful degradation with install message when not
  present.

## Known Limitations

- MCP-only — no offline mode, no local fallback
- Requires browser for Clerk OAuth — fails in headless SSH sessions
- Manual retry on transient MCP failures
- ChatPRD tool schemas may change — commands may need updates
- One-way Linear bridge only — no continuous sync, no link persistence
