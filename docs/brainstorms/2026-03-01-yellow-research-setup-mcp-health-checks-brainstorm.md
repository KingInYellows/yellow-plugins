# Brainstorm: yellow-research Setup MCP Health Checks and deepen-plan Workflow Command

Date: 2026-03-01

## What We're Building

### 1. MCP Health Checks in `/research:setup`

Extend the existing `/research:setup` command to cover all research sources — not
just the three API-key-based providers (Tavily, Perplexity, EXA) but also the four
always-available MCP sources: Context7, Grep MCP, WarpGrep, and DeepWiki. Each MCP
source gets a lightweight test call that reports pass or fail, displayed alongside
the existing API key status output.

Sources to health-check:

- **Context7** (`yellow-core` plugin) — library docs and code examples
- **Grep MCP** — GitHub code pattern search
- **WarpGrep** (`mcp__filesystem-with-morph`) — agentic codebase and GitHub search
- **DeepWiki** (`yellow-devin` plugin) — AI-powered repository documentation

Each health check invokes a minimal, low-cost test call (e.g., a trivial query or
listing call) and reports one of: `PASS`, `FAIL`, or `UNAVAILABLE` (tool not found
via ToolSearch).

### 2. `/workflows:deepen-plan` Command

A new optional command that sits between `/workflows:plan` and `/workflows:work`:

```text
/workflows:plan → [/workflows:deepen-plan] → /workflows:work
```

It takes a plan file path as its argument, automatically extracts research queries
from the plan's content (Overview, Problem Statement, Technical Details sections),
runs codebase research first via `repo-research-analyst`, then fills gaps with
external research via `research-conductor`, and annotates the plan file in-place
with the findings — inserting references, risk notes, and validation findings
directly into the relevant sections.

## Why This Approach

### For `/research:setup` MCP health checks

Displaying MCP status alongside API key status gives users a complete picture of
their research capability in one command. Health-checking (not just listing) matches
what the command already does for API keys — consistency matters more than
simplicity here. Users need to know if a tool is actually callable, not just
theoretically present. A lightweight test call catches plugin misconfiguration,
missing OAuth tokens, or server startup failures that a static listing would miss.

### For `/workflows:deepen-plan`

Making research extraction fully automatic (no prompting the user for focus areas)
keeps the command frictionless — it is already optional in the workflow, so the user
has chosen to invoke it deliberately. Auto-extraction from the plan text is reliable
because `/workflows:plan` produces structured sections with consistent headings.
Codebase research runs first because it validates the plan against actual code
(catching assumptions about file paths, patterns, or APIs that are already wrong),
then external research fills the gaps that local context cannot answer. Annotating
inline rather than appending a separate section means `/workflows:work` consumes an
enriched plan without needing to know deepen-plan was run — it just sees a more
detailed plan at the same path.

## Key Decisions

### `/research:setup` MCP health checks

- **Health-check, not status-display only.** Each MCP source gets a real test call,
  not just a "tool found" check. Rationale: a misconfigured or unstarted MCP server
  passes a ToolSearch check but fails at call time.
- **ToolSearch first.** Before invoking any MCP tool, run ToolSearch to load it.
  If ToolSearch returns no match, report `UNAVAILABLE` and skip the test call.
- **Graceful degradation per source.** A failing MCP health check does not abort
  setup — it reports `FAIL` for that source and continues to the next.
- **Unified output format.** All sources (API key and MCP) use the same status
  display: provider name, status badge, and a one-line description of what it
  provides.
- **ToolSearch must be in `allowed-tools`.** The command already uses ToolSearch
  for EXA; extend it to cover the four MCP sources too.

### `/workflows:deepen-plan`

- **Auto-extract research queries.** Parse the plan for Overview, Problem Statement,
  Proposed Solution, and Technical Details sections. Derive 2-4 research queries
  from the content. No user input required before research starts.
- **Codebase research first.** `repo-research-analyst` runs before external
  research. Its findings narrow the scope of external queries (avoid re-researching
  things the codebase already answers).
- **External research fills gaps only.** `research-conductor` is invoked with
  queries shaped around what codebase research did NOT resolve — not a repeat of
  the same queries.
- **Inline annotation, not addendum.** Findings are inserted into the existing plan
  sections they relate to. References go under `## References`. Risk notes go under
  `## Edge Cases` or `## Security Considerations`. Validation findings (e.g.,
  "file path confirmed correct") go inline near the relevant task or technical spec.
- **Plan path is the only argument.** The command takes `$ARGUMENTS` as the plan
  file path (same format as `/workflows:work`). No other input is required.
- **Overwrites the plan file in-place.** `/workflows:work` reads the plan at the
  same path — enrichment must land there for the handoff to be seamless.
- **Idempotent annotation markers.** Each inserted annotation is marked with a
  comment tag (e.g., `<!-- deepen-plan: source -->`) so re-running deepen-plan can
  detect and skip or replace existing annotations rather than duplicating them.
- **yellow-research dependency.** This command depends on `research-conductor`
  (which requires yellow-research to be installed). If the agent is unavailable,
  deepen-plan falls back to codebase research only and notes the limitation in the
  plan.
- **Lives in yellow-research plugin.** Since it depends on yellow-research tooling,
  the command belongs in `plugins/yellow-research/commands/workflows/deepen-plan.md`
  rather than yellow-core.

## Open Questions

- **Which lightweight test call for each MCP?** Each health check needs a minimal
  real invocation. Good candidates: Context7 `resolve-library-id` with a known
  library name (e.g., "react"), WarpGrep with a trivial search, DeepWiki
  `read_wiki_structure` on a well-known public repo, Grep MCP with a single-file
  search. Needs verification that these are the cheapest/safest calls for each tool.

- **Annotation conflict resolution.** If the user has manually edited a section
  that deepen-plan wants to annotate, how should it behave? Options: overwrite,
  append alongside, skip that section. The idempotent marker approach handles
  re-runs but not manual edits.

- **Should deepen-plan show a diff or summary before writing?** The plan gets
  modified in-place with no undo. An M3 confirmation showing what sections will be
  annotated (not the full content, just section names and annotation count) would
  align with the project's confirmation pattern for bulk writes — worth deciding
  before implementation.

- **Where does deepen-plan surface if yellow-research is not installed?** The
  command lives in yellow-research, so it simply does not exist for users without
  the plugin. Is that the right boundary, or should a stub in yellow-core point
  users toward installing yellow-research?
