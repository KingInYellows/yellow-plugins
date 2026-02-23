# Brainstorm: ChatPRD Setup Command & Org-Scoped Operations

**Date:** 2026-02-22
**Status:** Design approved — ready for planning
**Feature:** `/chatprd:setup` command + org-aware updates to all existing commands

---

## What We're Building

A `/chatprd:setup` command that:
1. Discovers available organizations via `list_user_organizations`
2. Lets the user pick their default org and a default project within it
3. Persists the selection to `.claude/yellow-chatprd.local.md` (plugin settings pattern)
4. Creates a single project brief/overview document in ChatPRD as a workspace anchor
5. Updates all existing commands (`create`, `list`, `search`, `update`) to read this config and use org-scoped MCP tools automatically

---

## Why This Approach

**Root problem discovered:** The current plugin only uses personal-scope MCP tools (`list_documents`, `create_document`). ChatPRD exposes org-scoped equivalents (`list_organization_documents`, `list_user_organizations`) that the plugin never calls. Every document created today lands in personal space instead of the team org — not an auth issue, but a missing tool usage issue.

**Why a setup command + config persistence:**
- Organization context doesn't change per-command; storing it once is ergonomic
- Follows the established `plugin-settings` pattern: `.claude/yellow-chatprd.local.md` with YAML frontmatter
- "Ask if no config exists, silently use if it does" provides a smooth first-run and repeat-run experience
- Touching all existing commands ensures consistent org scope everywhere, not just in new commands

---

## ChatPRD Data Model

```text
Account (Clerk auth, session-scoped)
  └── Organizations (via list_user_organizations)
        └── Projects (via list_projects — "AI assistants with org scoping")
              └── Documents (via list_organization_documents, create_document)
                    └── Chats (via list_chats — per project/org)
```

**MCP URL:** `https://app.chatprd.ai/mcp` — flat, no org slug in URL. Org is passed as a parameter to each tool.

**Auth:** Account-scoped OAuth via Clerk. No API key. One workspace per account; org membership determines access.

---

## Key Decisions

| Decision | Choice | Reasoning |
|---|---|---|
| Config persistence | `.claude/yellow-chatprd.local.md` YAML frontmatter | Established plugin-settings pattern |
| Behavior without config | Ask on first use, then silently use | Good first-run UX; predictable repeat UX |
| Document initialization | Create one project brief/overview doc | Workspace anchor without being over-opinionated |
| Scope of changes | Update all 5 existing commands + add setup | Full solution; no split experience |
| New MCP tools needed | `list_user_organizations`, `list_organization_documents` | Both currently missing from all allowed-tools |

---

## Config File Schema

**Location:** `.claude/yellow-chatprd.local.md`

```yaml
---
org_id: "org_abc123"
org_name: "Acme Corp"
default_project_id: "proj_456def"
default_project_name: "Product Q1 2026"
setup_completed_at: "2026-02-22"
---

# ChatPRD Workspace

Configured for: Acme Corp
Default project: Product Q1 2026
```

---

## Setup Command Flow

```text
/chatprd:setup

1. Check if config already exists → if yes, ask "reconfigure?"
2. list_user_organizations → display numbered list → AskUserQuestion (pick org)
3. list_projects (org-scoped) → display list → AskUserQuestion (pick default project)
4. M3 confirmation: "Configure yellow-chatprd for org X, project Y?"
5. Write .claude/yellow-chatprd.local.md
6. AskUserQuestion: "Create a project overview document to anchor this workspace?"
7. If yes: list_templates → pick "One-Pager" → AskUserQuestion: project name + brief description
8. create_document (org-scoped, in default project)
9. Report: config saved, document URL
```

---

## Changes to Existing Commands

| Command | Change |
|---|---|
| `/chatprd:list` | Read config; use `list_organization_documents` instead of `list_documents` when org is configured |
| `/chatprd:create` | Read config; pass org_id + project_id to `create_document` |
| `/chatprd:search` | Read config; scope `search_documents` to org when configured |
| `/chatprd:update` | Read config; use org context for `get_document` lookup |
| `document-assistant` agent | Read config; default to org scope for all operations |

All commands: if no config exists, prompt "Run `/chatprd:setup` first to configure your workspace" and stop (no silent fallback to personal scope — that was the original bug).

---

## New MCP Tools to Add to allowed-tools

These tools exist in the ChatPRD MCP API but are not yet used anywhere:

- `mcp__plugin_chatprd_chatprd__list_user_organizations`
- `mcp__plugin_chatprd_chatprd__list_organization_documents`

(Also not yet used: `list_chats`, `search_chats`, `get_user_profile` — out of scope for this feature)

---

## Open Questions (for planning phase)

1. **Exact parameter schemas:** Do `list_organization_documents`, `list_projects`, and `create_document` accept an `organization_id` field? What's the exact parameter name? → Discover empirically via MCP `tools/list` at plan time.
2. **Does `search_documents` accept an org scope?** Or does search always span personal + all orgs? → Test empirically.
3. **What happens when a user is in only one org?** Should setup auto-select it and skip the picker? Or still confirm?
4. **Config in git vs. gitignored?** `.claude/` is typically gitignored, so config is per-machine. Is that correct? (Yes — consistent with plugin-settings pattern.)
5. **Multi-project per org:** If a user switches projects frequently, should there be a `/chatprd:switch-project` command later? → Out of scope for this PR; note as future work.

---

## Out of Scope

- Multi-project switcher command
- Chat/conversation initialization
- Org-level template management
- Syncing setup config across machines
