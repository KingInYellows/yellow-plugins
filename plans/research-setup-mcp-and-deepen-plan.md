# Feature: MCP Health Checks in /research:setup + /workflows:deepen-plan

## Problem Statement

The yellow-research plugin has two gaps:

1. `/research:setup` only reports on 3 API-key sources (Tavily, Perplexity, EXA)
   but ignores 4 always-available MCP sources (Context7, Grep MCP, WarpGrep,
   DeepWiki). Users have no way to verify these are reachable.

2. There is no research-backed enrichment step between `/workflows:plan` and
   `/workflows:work`. Plans go from draft to execution without validation against
   the codebase or external knowledge.

## Current State

- `/research:setup` at `plugins/yellow-research/commands/research/setup.md` —
  259 lines, 6 steps, checks 3 API keys with format validation + optional live
  probing. No MCP awareness.
- `/workflows:plan` at `plugins/yellow-core/commands/workflows/plan.md` —
  creates plans at `plans/<name>.md` using 3 templates (MINIMAL/STANDARD/
  COMPREHENSIVE).
- `/workflows:work` at `plugins/yellow-core/commands/workflows/work.md` — reads
  plan from `$ARGUMENTS` path and executes.
- No `/workflows:deepen-plan` exists anywhere.

## Proposed Solution

### Feature 1: MCP Health Checks

Add a new Step 3.5 to `/research:setup` that uses ToolSearch to probe each MCP
source, then extends the Step 4 status table with an "MCP Sources" section.
MCP checks are unconditional (no quota cost, no user opt-in needed). The
capability summary denominator stays at `/3` for API sources but adds a
separate MCP availability line.

### Feature 2: /workflows:deepen-plan

New command at `plugins/yellow-research/commands/workflows/deepen-plan.md`.
Reads an existing plan, auto-extracts research queries from its sections, runs
`repo-research-analyst` (codebase) then `research-conductor` (external) in
sequence, annotates the plan inline with idempotent HTML comment markers, and
writes it back in-place after M3 confirmation.

## Implementation Plan

### Phase 1: Extend /research:setup with MCP Health Checks

- [ ] **1.1: Add ToolSearch and MCP tools to allowed-tools frontmatter**

  Add to frontmatter `allowed-tools`:
  ```yaml
  - ToolSearch
  - mcp__plugin_yellow-core_context7__resolve-library-id
  - mcp__grep__searchGitHub
  - mcp__filesystem-with-morph__warpgrep_codebase_search
  - mcp__plugin_yellow-devin_deepwiki__read_wiki_structure
  ```

- [ ] **1.2: Add new Step 3.5 — MCP Health Checks**

  Insert between existing Step 3 (Optional Live API Testing) and Step 4
  (Report Results). This step runs unconditionally — MCP calls have no quota
  cost, so no user opt-in prompt is needed.

  For each MCP source, the pattern is:

  1. **ToolSearch probe:** Call `ToolSearch "<keyword>"` to load the tool.
     If the exact tool name is absent from results → status = `UNAVAILABLE`.
  2. **Test call:** If found, invoke with minimal arguments. If it returns
     any structured result → `ACTIVE`. If it throws or returns an error →
     `FAIL`.

  **Minimal test calls for each source:**

  | Source | ToolSearch keyword | Test call | Args |
  |---|---|---|---|
  | Context7 | `resolve-library-id` | `resolve-library-id` | `libraryName: "react"` |
  | Grep MCP | `searchGitHub` | `searchGitHub` | `query: "test", maxResults: 1` |
  | WarpGrep | `warpgrep_codebase_search` | `warpgrep_codebase_search` | `query: "README"` |
  | DeepWiki | `read_wiki_structure` | `read_wiki_structure` | `repoName: "facebook/react"` |

  **Error classification tree (for all 4 sources):**
  - Tool not found in ToolSearch results → `UNAVAILABLE`
  - Tool found, call throws exception → `FAIL`
  - Tool found, call returns empty/null → `FAIL`
  - Tool found, call returns any structured data → `ACTIVE`

  **Prose note:** MCP tool calls go through Claude Code's tool dispatch — there
  is no per-call timeout parameter like curl's `--connect-timeout`. If a call
  hangs, Claude Code's internal timeout applies.

- [ ] **1.3: Extend Step 4 status table with MCP Sources section**

  Add after the "Parallel Task server (OAuth)" block:

  ```text
  MCP Sources (no API key required — always available if plugin installed)
    Source         Plugin          Status
    -----------    -----------     --------
    Context7       yellow-core     ACTIVE
    Grep MCP       (global)        ACTIVE
    WarpGrep       (global)        UNAVAILABLE
    DeepWiki       yellow-devin    ACTIVE
  ```

  Three status values: `ACTIVE` / `FAIL` / `UNAVAILABLE`.

  **Capability summary update:** Keep the existing `N/3 sources` line for API
  keys. Add a new line: `MCP sources: 3/4 available`.

- [ ] **1.4: Add MCP setup instructions to Step 5**

  When an MCP source is `UNAVAILABLE`, show install instructions:

  | Source | Install instruction |
  |---|---|
  | Context7 | `Install yellow-core: /plugin marketplace add KingInYellows/yellow-plugins` (select yellow-core) |
  | Grep MCP | `Configure grep MCP globally in Claude Code MCP settings` |
  | WarpGrep | `Configure filesystem-with-morph MCP globally in Claude Code MCP settings` |
  | DeepWiki | `Install yellow-devin: /plugin marketplace add KingInYellows/yellow-plugins` (select yellow-devin) |

  When status is `FAIL`: "Source is installed but test call failed. Try
  restarting Claude Code."

- [ ] **1.5: Update Error Handling table**

  Add rows:
  ```
  | ToolSearch returns no match | "[source] UNAVAILABLE — plugin not installed or MCP not configured." | Record, continue |
  | MCP test call throws       | "[source] FAIL — tool found but test call errored." | Record, continue |
  | MCP test call empty result  | "[source] FAIL — tool returned no data." | Record, continue |
  ```

- [ ] **1.6: Update Step 3 prompt text**

  Current text says "1 small call per present key." Since MCP checks now run
  unconditionally after Step 3 regardless of user choice, update the prompt
  to: "Test live API connectivity? MCP sources are always checked (no quota
  cost). This option controls whether API key sources are also probed."

### Phase 2: Create /workflows:deepen-plan Command

- [ ] **2.1: Create command file with frontmatter**

  File: `plugins/yellow-research/commands/workflows/deepen-plan.md`

  ```yaml
  ---
  name: workflows:deepen-plan
  description: "Enrich an existing plan with codebase validation and external research, annotating inline. Use when a plan needs deeper validation before starting /workflows:work."
  argument-hint: '[plan file path]'
  allowed-tools:
    - Bash
    - Read
    - Write
    - Edit
    - Glob
    - Agent
    - ToolSearch
    - AskUserQuestion
  ---
  ```

  Note: The `workflows:` namespace is shared across plugins — yellow-core owns
  `plan`, `work`, `brainstorm`, `review`, `compound`; yellow-research adds
  `deepen-plan`. Claude Code resolves commands by `name:` field, not directory.

- [ ] **2.2: Step 1 — Validate and read plan file**

  If `$ARGUMENTS` is empty:
  1. Run `ls plans/*.md 2>/dev/null` via Bash.
  2. If plans exist, show them via AskUserQuestion: "Which plan should I
     enrich?" with file names as options.
  3. If no plans exist, stop: "No plan files found in plans/. Run
     /workflows:plan first."

  If `$ARGUMENTS` is provided:
  1. **Path validation:** Reject if path contains `..`, starts with `/` or
     `~`, or resolves outside the project root. Stop with: "Invalid path.
     Plan file must be a relative path within the project."
  2. Read the file. If it does not exist, stop: "Plan file not found at
     [path]. Available plans:" and list `plans/*.md`.

- [ ] **2.3: Step 2 — Check for existing annotations (idempotency)**

  Grep for `<!-- deepen-plan:` in the plan content.

  If found:
  1. Report: "This plan has existing deepen-plan annotations. Re-enriching
     will replace them with fresh research."
  2. Ask via AskUserQuestion: "Continue?" / "Cancel"
  3. If Cancel: stop with "No changes made to [path]."
  4. If Continue: strip all content between `<!-- deepen-plan: ... -->` and
     `<!-- /deepen-plan -->` markers (inclusive) before proceeding.

- [ ] **2.4: Step 3 — Auto-extract research queries**

  Parse the plan for these sections (in order of priority):
  - `## Problem Statement` / `## Overview`
  - `## Proposed Solution` / `## High-Level Architecture`
  - `## Technical Details` / `## Technical Specifications`
  - `## Edge Cases` / `## Edge Cases & Error Handling`

  For each section found, derive one research query by extracting the core
  topic/technology/pattern mentioned. Target 2-4 queries total. Format each
  as a natural language question (e.g., "What are best practices for X in
  Y context?").

  If the plan has only MINIMAL sections (no Problem Statement, no Technical
  Details), derive queries from `## Overview` and `## Implementation` only.
  If zero queries can be derived (all sections empty or trivial), skip to
  Step 6 and report "Plan sections too sparse for research enrichment. Add
  more detail with /workflows:plan first."

- [ ] **2.5: Step 4 — Codebase research (repo-research-analyst)**

  Launch via Agent tool:
  ```
  subagent_type: yellow-core:research:repo-research-analyst
  prompt: "Given this plan, find relevant existing code, patterns, file
  paths, and hidden dependencies that validate or challenge the proposed
  approach. Plan content: [plan text]"
  ```

  If the agent is unavailable (yellow-core not installed), log a warning
  and skip to Step 5 with no codebase findings.

  Collect findings: file paths confirmed/corrected, existing patterns found,
  dependency issues identified, gaps where codebase has no answer.

- [ ] **2.6: Step 5 — External research (research-conductor)**

  Shape queries from Step 3 to focus on gaps not answered by Step 4.
  Remove queries that codebase research fully resolved.

  Launch via Agent tool:
  ```
  subagent_type: yellow-research:research:research-conductor
  prompt: "Research these specific questions to fill gaps in a
  development plan. Questions: [remaining queries]. Context: [brief
  plan summary]."
  ```

  If the agent is unavailable (MCP sources not configured), log a warning
  and proceed with codebase-only findings.

  Collect findings: external references, best practices, library docs,
  community patterns.

- [ ] **2.7: Step 6 — Annotate plan inline**

  For each finding, identify the most relevant plan section and insert an
  annotation block after the relevant paragraph:

  ```markdown
  <!-- deepen-plan: codebase -->
  > **Codebase validation:** The pattern at `src/auth/middleware.ts:42`
  > already implements this approach. Consider reusing `validateToken()`.
  <!-- /deepen-plan -->
  ```

  ```markdown
  <!-- deepen-plan: external -->
  > **Research finding:** The React docs recommend using `useSyncExternalStore`
  > for this pattern. See: https://react.dev/reference/react/useSyncExternalStore
  <!-- /deepen-plan -->
  ```

  Annotation placement rules:
  - Codebase validation findings → near the relevant task in `## Implementation Plan`
  - File path corrections → inline in `## Technical Details`
  - External references → under `## References` (create if missing)
  - Risk/edge case findings → under `## Edge Cases` (create if missing)
  - General best practices → under `## Proposed Solution`

  If annotation count is 0 after both agents run: skip write, report "Both
  agents ran but produced no actionable findings. Plan unchanged at [path]."

- [ ] **2.8: Step 7 — M3 confirmation and write**

  Show via AskUserQuestion:
  ```
  Plan enrichment summary for [path]:
    Sections annotated: [list section names]
    Codebase findings:  [count]
    External findings:   [count]
    Total annotations:   [count]

  Write enriched plan?
  ```
  Options: "Yes, write" / "No, cancel"

  If Cancel: stop with "No changes made to [path]."
  If Yes: write the annotated plan back to the same path using Write tool.

- [ ] **2.9: Step 8 — Next steps**

  Show via AskUserQuestion:
  ```
  Plan enriched at [path].

  What would you like to do next?
  ```
  Options:
  - "Start implementation (/workflows:work [path])"
  - "Review the enriched plan"
  - "Done"

- [ ] **2.10: Add Error Handling table**

  ```
  | Error | Message | Action |
  |---|---|---|
  | $ARGUMENTS empty, no plans exist | "No plan files found in plans/." | Stop |
  | Plan file not found | "Plan file not found at [path]." | Stop, list available |
  | Path contains .. or is absolute | "Invalid path. Must be relative, within project." | Stop |
  | Zero research queries extracted | "Plan too sparse for enrichment." | Stop |
  | repo-research-analyst unavailable | "yellow-core not installed. Skipping codebase research." | Warn, continue |
  | research-conductor unavailable | "Research MCPs not configured. Codebase-only enrichment." | Warn, continue |
  | Both agents return no findings | "No actionable findings. Plan unchanged." | Stop |
  | User cancels at M3 | "No changes made to [path]." | Stop |
  | Write fails | "Failed to write enriched plan. Check file permissions." | Stop |
  ```

### Phase 3: Integration and Documentation

- [ ] **3.1: Update yellow-research CLAUDE.md**

  Add `/workflows:deepen-plan` to the Commands section.
  Add `yellow-core` to Optional Dependencies with note about
  `repo-research-analyst`.
  Update "When to Use What" section.

- [ ] **3.2: Update yellow-research README.md**

  Add command to the command listing. Update component counts.

- [ ] **3.3: Register command in plugin.json if needed**

  Check if yellow-research's plugin.json needs a commands entry for
  `workflows/deepen-plan.md`. (Most plugins auto-discover from directory
  structure, but verify.)

## Technical Details

### Files to Modify

- `plugins/yellow-research/commands/research/setup.md` — Add Step 3.5 (MCP
  health checks), extend Step 4 table, extend Step 5 instructions, update
  Step 3 prompt, add Error Handling rows, update allowed-tools
- `plugins/yellow-research/CLAUDE.md` — Add deepen-plan docs
- `plugins/yellow-research/README.md` — Update command list

### Files to Create

- `plugins/yellow-research/commands/workflows/deepen-plan.md` — New command

### Key Tool Names

| Tool | Full name | ToolSearch keyword |
|---|---|---|
| Context7 resolve | `mcp__plugin_yellow-core_context7__resolve-library-id` | `resolve-library-id` |
| Grep MCP search | `mcp__grep__searchGitHub` | `searchGitHub` |
| WarpGrep search | `mcp__filesystem-with-morph__warpgrep_codebase_search` | `warpgrep_codebase_search` |
| DeepWiki structure | `mcp__plugin_yellow-devin_deepwiki__read_wiki_structure` | `read_wiki_structure` |

### Agent subagent_type Values

| Agent | subagent_type |
|---|---|
| repo-research-analyst | `yellow-core:research:repo-research-analyst` |
| research-conductor | `yellow-research:research:research-conductor` |

## Acceptance Criteria

- [ ] `/research:setup` displays all 7 sources (3 API + 4 MCP) in a unified table
- [ ] Each MCP source gets a real ToolSearch + test call probe, not just a listing
- [ ] MCP failures are graceful — per-source FAIL/UNAVAILABLE, never abort
- [ ] MCP install instructions appear for UNAVAILABLE sources
- [ ] `/workflows:deepen-plan plans/foo.md` reads, enriches, and writes the plan
- [ ] Empty $ARGUMENTS lists available plans and prompts user to pick
- [ ] Invalid/missing paths produce clear error messages
- [ ] Codebase research runs before external; external queries are narrowed by gaps
- [ ] Annotations use idempotent `<!-- deepen-plan: source -->` markers
- [ ] Re-running strips old annotations before re-enriching
- [ ] M3 confirmation shows annotation summary before writing
- [ ] Cancel at M3 produces "No changes made" and stops
- [ ] Falls back gracefully if yellow-core or research MCPs unavailable

## Edge Cases

- **MINIMAL template plans:** Only have Overview + Implementation — query
  extraction works from these two sections, may produce fewer queries
- **Plans with existing HTML comments:** Annotation markers use the
  `deepen-plan:` prefix to distinguish from other comments
- **Cross-plugin namespace:** `workflows:deepen-plan` registers via `name:`
  field alongside yellow-core's `workflows:plan` — no collision
- **WarpGrep test call on empty repo:** Falls back to `FAIL` if search
  returns nothing; this is acceptable since the tool is still reachable
- **ToolSearch caching:** Results reflect session-start state; newly installed
  plugins need a Claude Code restart to appear

## References

- Brainstorm: `docs/brainstorms/2026-03-01-yellow-research-setup-mcp-health-checks-brainstorm.md`
- Existing setup: `plugins/yellow-research/commands/research/setup.md`
- Plan workflow: `plugins/yellow-core/commands/workflows/plan.md`
- Work workflow: `plugins/yellow-core/commands/workflows/work.md`
- research-conductor: `plugins/yellow-research/agents/research/research-conductor.md`
- repo-research-analyst: `plugins/yellow-core/agents/research/repo-research-analyst.md`
- ChatPRD setup (ToolSearch probe pattern): `plugins/yellow-chatprd/commands/chatprd/setup.md`
