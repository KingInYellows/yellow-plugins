# Brainstorm: Linear Plugin Cross-Plugin Integration

**Date:** 2026-02-22
**Status:** Ready for planning
**Author:** KingInYellow

## What We're Building

Four targeted improvements to the yellow-linear plugin ecosystem that close the gap between Linear issues and the rest of the workflow toolchain:

1. **Fix `/debt:sync`** — Wire the stubbed debt-to-Linear sync in yellow-debt to actual Linear MCP calls
2. **`/linear:sync-all`** — Periodic command to audit open Linear issues, find merged PRs, and bulk-close completed work
3. **`/linear:delegate [issue-id]`** — Fetch a Linear issue and kick off a Devin session with full context
4. **`/ci:report-linear [run?]`** — Diagnose a CI failure and create a Linear bug with failure context

## Why This Approach

### Architecture: Caller-Owns Pattern

Cross-plugin features live in the plugin that *initiates* the workflow, not in yellow-linear as a hub. This keeps each plugin cohesive and avoids coupling yellow-linear to every other plugin.

- **yellow-debt** already has `/debt:sync` stub — just needs wiring to Linear MCP tools
- **yellow-linear** gets `sync-all` (pure Linear audit) and `delegate` (starts from Linear issue context)
- **yellow-ci** adds `report-linear` (CI failure context lives there)

**Why not a yellow-integrations plugin?** For a personal project, a dedicated integration plugin adds install complexity without benefit. Claude Code registers MCP tools globally — a command in yellow-debt can call `mcp__plugin_linear_linear__*` as long as yellow-linear is installed. Cross-plugin integration is just placement and graceful degradation.

**Why not hub-owns (yellow-linear as hub)?** Gets unwieldy fast. A 12th plugin shouldn't require touching yellow-linear. The caller-owns pattern already exists in yellow-debt (`/debt:sync`) and yellow-chatprd (`/chatprd:link-linear`).

### Sync: Periodic Command, Not a Hook

The user prefers a `/linear:sync-all` command over a merge hook for the sync workflow. This avoids complexity (hooks require detecting merge events), gives the user control over when to run it, and handles issues that fell through the cracks.

## Key Decisions

### 1. `/debt:sync` — Complete the Wire-Up (yellow-debt)

**Current state:** The command has `# In actual implementation:` stubs where Linear MCP calls should go.

**What to build:**
- Replace stubs with actual `mcp__plugin_linear_linear__*` calls: `create_issue`, `list_issues` (dedup check), `list_issue_labels` (fetch "technical-debt" label or create it)
- Idempotency: check existing issues by label + title before creating (dedup)
- Rollback offer: if sync fails mid-batch, offer to delete already-created issues
- Graceful degradation: if yellow-linear not installed, fail fast with install instructions

**Constraint:** Requires yellow-linear to be installed. Use the established fail-fast pattern from yellow-chatprd.

### 2. `/linear:sync-all` — Periodic Status Audit (yellow-linear)

**What to build:**
- Fetch all issues with status In Progress / In Review (dynamically, no hardcoded status names)
- For each issue, extract branch name from issue identifier pattern, check `gh pr view` for PR status
- If PR is merged → suggest transitioning to Done
- If PR is closed without merge → suggest Cancelled or Backlog
- Batch confirmation before any writes (M3 pattern), H1 TOCTOU re-fetch before each update
- Rate limiting: exponential backoff, delay for batches > 5

**Scope:** Read issues → check PR status → propose transitions → confirm → write. No auto-close without user approval.

### 3. `/linear:delegate [issue-id]` — Linear → Devin Handoff (yellow-linear)

**What to build:**
- Validate issue ID (C1: fetch from Linear first)
- Display full issue summary (title, description, acceptance criteria, priority)
- Ask user to confirm delegation and specify any additional context for Devin
- Create Devin session via `mcp__plugin_yellow-devin_devin__*` tools with enriched prompt (issue title + description + branch naming convention)
- Add a comment on the Linear issue with the Devin session URL (M3 pattern: show before commenting)
- Suggest transitioning issue to In Progress

**Graceful degradation:** If yellow-devin not installed, display instructions to install it.

**Open question:** Should we also create the git branch before handing to Devin? Devin can create it, but pre-creating ensures our naming convention is used.

### 4. `/ci:report-linear [run?]` — CI Failure → Linear Bug (yellow-ci)

**What to build:**
- Run failure analysis via `failure-analyst` agent (same as `/ci:diagnose`)
- Enrich finding with: failing step, error output (truncated), workflow name, run URL
- Propose a Linear bug title + description to the user (M3 pattern: show before creating)
- Create issue via `mcp__plugin_linear_linear__create_issue` with label "ci-failure"
- Return issue ID and URL; optionally delegate to Devin via `/linear:delegate`

**Graceful degradation:** If yellow-linear not installed, output the bug report as markdown for manual creation.

## Scope Boundaries (What We're NOT Building)

- **Webhooks or continuous sync** — all operations are on-demand
- **Two-way sync** — Linear remains the source of truth; external events create/update issues but don't pull changes back
- **Cycle creation via MCP** — not available in Linear MCP; still requires Linear UI
- **Comment thread management** — reading/responding to discussion threads is deferred
- **Sub-issue support** — deferred; MCP has `sub_issue_write` but not a current priority

## Open Questions

1. **Branch pre-creation for Devin delegation** — Should `/linear:delegate` create the branch before handing off, or let Devin handle it?
2. **Label creation in debt:sync** — Should we create a "technical-debt" label if it doesn't exist, or require the user to create it first?
3. **CI report dedup** — Should `/ci:report-linear` check for existing open CI-failure issues for the same workflow before creating a new one?
4. **Allowed-tools for yellow-devin MCP in yellow-linear** — Need to confirm actual tool names via `ToolSearch` before authoring `/linear:delegate`; can't trust memory.

## Implementation Order (Suggested)

1. `/linear:sync-all` — standalone, no dependencies on other plugins
2. Fix `/debt:sync` — stub already exists, mostly wiring
3. `/ci:report-linear` — new command but follows established patterns
4. `/linear:delegate` — most complex (Devin MCP + Linear MCP + branch creation question)
