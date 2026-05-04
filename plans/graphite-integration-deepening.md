# Feature: Deepen Graphite Integration Across Yellow-Plugins

> **Status: Implemented (PRs #162, #163, #164, all merged)** —
> `workflows:work` is now stack-aware (parses `## Stack Decomposition` +
> `<!-- stack-topology: -->` metadata, dispatches stack execution loop).
> `gt-stack-plan` no longer pre-creates scaffold commits. Remaining
> `git push` references are intentional documented exceptions (e.g., devin
> degraded-mode in `review-prs.md:419-422`).

## Overview

Eliminate residual `git push` for branch operations, make `workflows:work`
stack-aware for bottom-up stacked PR execution, and repurpose `gt-stack-plan` as
a pure decomposition tool. The goal is a single coherent Graphite-first workflow:
plan -> decompose -> work (bottom-up, one PR at a time).

## Problem Statement

### Current Pain Points

1. **`gt-stack-plan` pre-creates branches** with scaffold commits before work
   begins. This leads to orphaned branches when plans change mid-execution and
   forces a top-down mental model that doesn't match how stacked diffs are
   actually built.

2. **`workflows:work` is single-branch** -- it reads a plan, creates one branch,
   implements everything, and submits one PR. No awareness of stack
   decomposition. For multi-PR features, the user must manually create branches
   and run `/workflows:work` repeatedly.

3. **Operational docs still reference `git push`** for branch operations (~25
   references across CONTRIBUTING.md, runbook.md, releases.md, etc.) despite
   the `check-git-push.sh` hook blocking it in Claude sessions.

### User Impact

Developers following operational runbooks encounter conflicting guidance: plugin
CLAUDE.md files say "never `git push`" but the runbook's remediation procedures
use `git push origin main`. The stacked PR workflow requires manual
branch management between plan creation and execution.

## Proposed Solution

<!-- deepen-plan: external -->
> **Research:** Graphite CLI's `gt create` automatically stacks branches when
> invoked on a non-trunk branch -- this is the foundational design, not opt-in.
> Running `gt create -am "message"` on a feature branch creates a new branch
> stacked on top. `gt submit --stack` publishes all branches and creates/updates
> PRs idempotently. Mid-stack changes via `gt modify -a` trigger automatic
> upstack restacking; conflicts pause execution and require `gt continue` or
> `gt abort`. Name collisions fail -- `gt create` errors if the branch already
> exists. See: https://graphite.com/docs/create-stack
<!-- /deepen-plan -->

### High-Level Architecture

```
workflows:plan ──> gt-stack-plan (enriches plan with decomposition) ──> workflows:work (executes bottom-up)
                       │                                                        │
                       │  Writes ## Stack Decomposition                         │  Reads ## Stack Decomposition
                       │  to plan document                                      │  Creates branches just-in-time
                       │  No branch creation                                    │  Submits each before starting next
                       ▼                                                        ▼
                  plans/<name>.md                                    gt create → implement → gt submit → repeat
```

### Key Design Decisions

1. **Tag pushes remain as raw `git push`** -- Graphite has no tag management.
   Already documented in versioning.md. Focus exclusively on branch pushes.

2. **Stack-awareness lives in `workflows:work`**, not `workflows:plan` -- the
   plan documents what; the work command executes how.

3. **`gt-stack-plan` repurposed as plan-only** -- Phase 3 (branch creation)
   removed. Keeps decomposition logic (Phase 1 + Phase 2). "Save plan only"
   becomes the only path.

4. **Comprehensive doc sweep with targeted exceptions** -- git-auth.md gets
   callout only (auth reference doc), docs/solutions/ left as historical record,
   CI tag scripts confirmed legitimate.

5. **`gh pr create` needs no migration** -- all 11 references are already "never
   do this" prohibition statements.

### Trade-offs Considered

| Decision | Alternative | Why rejected |
|----------|------------|-------------|
| Repurpose gt-stack-plan | Deprecate entirely | Decomposition logic is valuable, non-trivial work worth preserving |
| Repurpose gt-stack-plan | Keep as alternative path | Two competing workflows = two doc sets, inevitable divergence |
| Per-item submit | Submit all at end | Incremental review is the point of stacked PRs |
| Checkpoint between items | Fully autonomous | Prevents runaway execution; "continue all" option reduces friction |
| Lightweight audit per item | Full smart-submit per item | 35 agent runs for a 5-item stack is excessive; full audit on final item only |

## Stack Decomposition Contract

This is the interface between `gt-stack-plan` (producer) and `workflows:work`
(consumer). Both commands must agree on this format.

<!-- deepen-plan: external -->
> **Research:** Structured markdown as a machine-readable contract between CLI
> commands has established prior art. The prd-to-tasks pattern uses numbered
> subsections with typed fields per item (`{Phase#}{Track}.{Task#}`) and explicit
> contracts between parallel tracks. mdflow treats markdown as executable
> specifications. saku (markdown task runner) uses headings for tasks, code blocks
> for commands, and nesting for dependencies. Best practice: use consistent H2/H3
> hierarchy for machine parsing, typed label:value fields, explicit dependency
> references (not inferred from ordering), and consider mdast for AST-level
> parsing over regex. See: https://github.com/syntax-tree/mdast
<!-- /deepen-plan -->

### Format

The `## Stack Decomposition` section is appended to the plan document by
`gt-stack-plan`. It uses structured markdown with numbered subsections per stack
item:

```markdown
## Stack Decomposition

<!-- stack-topology: linear -->
<!-- stack-trunk: main -->

### 1. feat/branch-slug-one
- **Type:** feat
- **Description:** Short description of what this PR does
- **Scope:** path/to/file1.ts, path/to/file2.ts
- **Tasks:** 1.1, 1.2, 1.3
- **Depends on:** (none)
- **Linear:** ENG-123

### 2. feat/branch-slug-two
- **Type:** fix
- **Description:** Short description of what this PR does
- **Scope:** path/to/file3.ts
- **Tasks:** 2.1, 2.2
- **Depends on:** #1
- **Linear:** ENG-124
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| Heading (`### N. type/branch-name`) | Yes | Stack position and branch name |
| **Type** | Yes | Conventional commit prefix (feat, fix, refactor, docs, etc.) |
| **Description** | Yes | One-line summary for the PR title |
| **Scope** | Yes | Files/directories this item touches |
| **Tasks** | Yes | Plan task IDs (from `## Implementation Plan`) this item covers |
| **Depends on** | Yes | `(none)` or `#N` references to prerequisite items |
| **Linear** | No | Linear issue ID if applicable |

### HTML Comments

| Comment | Values | Description |
|---------|--------|-------------|
| `stack-topology` | `linear`, `parallel`, `mixed` | How items relate |
| `stack-trunk` | Branch name | Base branch for the stack |

### Topology

- **linear**: Each item depends on the previous (classic stack). `workflows:work`
  creates each branch on top of the last with `gt create`.
- **parallel**: Items are independent, all branch off trunk. `workflows:work`
  creates each branch off trunk separately.
- **mixed**: Some items are stacked, others are parallel. `Depends on` field
  determines the graph. (Future consideration -- v1 supports linear and parallel
  only.)

### Standalone invocation

When `gt-stack-plan` is invoked without a plan file path (plain text or empty
args), it writes to `.gt-stack-plan.md` in the repo root as a fallback. This
file uses the same format but is standalone rather than appended to a plan.

## Implementation Plan

### Phase 1: Stack Decomposition Contract (PR 1)

<!-- deepen-plan: codebase -->
> **Codebase:** Output styles are auto-loaded via `plugin.json`'s
> `"outputStyles": "./output-styles"` directive (line 24 of
> `plugins/gt-workflow/.claude-plugin/plugin.json`). Claude Code loads all `.md`
> files from this directory into system context automatically. No code changes
> needed to register the new file -- placing it in the directory is sufficient.
<!-- /deepen-plan -->

- [x] 1.1: Create output style `plugins/gt-workflow/output-styles/stack-decomposition.md`
  defining the structured format above with examples for linear, parallel, and
  mixed topologies
- [x] 1.2: Update `plugins/gt-workflow/output-styles/stack-plan.md` to reference
  the new decomposition format (the visual tree format for confirmation display
  stays; the decomposition section format is the new contract)
- [x] 1.3: Add format documentation to `plugins/gt-workflow/CLAUDE.md` in a new
  `## Stack Decomposition Format` section explaining the contract between
  gt-stack-plan and workflows:work

### Phase 2: Repurpose gt-stack-plan (PR 2, depends on PR 1)

<!-- deepen-plan: codebase -->
> **Codebase:** Phase 3 starts at line 181 but lines 232-238 are
> `## Success Criteria` which belong to the command as a whole, not Phase 3.
> The correct deletion range is **lines 181-230**. Lines 232-238 must be
> preserved and updated to reflect plan-only behavior (e.g., remove "Branches
> created in correct order via Graphite" criterion). Internal Phase 3 reference
> confirmed at line 64: "used in Phase 2 for branch naming and in Phase 3 for
> the mapping table." No other internal Phase 3 refs in Phase 1 or Phase 2.
<!-- /deepen-plan -->

- [x] 2.1: Remove Phase 3 (Create Branches) from
  `plugins/gt-workflow/commands/gt-stack-plan.md` -- delete lines 181-230
  (branch creation, verification, stack display, issue mapping output).
  Preserve and update `## Success Criteria` at lines 232-238
- [x] 2.2: Move Linear issue mapping table into `## Stack Decomposition` output
  (each item gets a `Linear:` field) instead of terminal output in Phase 3
- [x] 2.3: Update Phase 2 confirmation prompt (lines ~157-177): remove "Create
  these branches now (Recommended)" option. New options: "Save to plan /
  Adjust / Cancel". If plan file path was provided as argument, "Save to plan"
  appends `## Stack Decomposition` to that file. If standalone invocation,
  write to `.gt-stack-plan.md`.
- [x] 2.4: Handle re-runs: if `## Stack Decomposition` already exists in the
  plan file, replace it (don't duplicate). Use Edit tool to find and replace
  the section.
- [x] 2.5: Remove internal references to Phase 3 in Phase 1 (e.g., "used in
  Phase 3" at line ~47) and Phase 2
- [x] 2.6: Update `plugins/gt-workflow/CLAUDE.md` command reference to reflect
  the new behavior (no branch creation, plan-only output)
- [x] 2.7: Update `plugins/gt-workflow/README.md` gt-stack-plan description

### Phase 3: Stack-Aware workflows:work (PR 3, depends on PR 2)

<!-- deepen-plan: codebase -->
> **Codebase:** `workflows:work` currently has NO structured section-level
> markdown parsing. It reads the plan as a blob and creates TaskCreate entries.
> There is no existing pattern for detecting `## Heading` sections to reuse.
> The Stack Decomposition detection and parsing logic will be entirely new.
> The `Write` and `Edit` tools are already in work.md's `allowed-tools` (lines
> 8-9), so the permission model for writing `## Stack Progress` back to plan
> files is already correct. Note: workflows:work currently NEVER writes back to
> plan files -- this introduces a novel write-back concern.
<!-- /deepen-plan -->

- [x] 3.1: Add stack detection in Phase 1 of `plugins/yellow-core/commands/workflows/work.md`.
  After reading the plan file, check for `## Stack Decomposition` section. If
  present, parse it into structured data: item number, branch name, type,
  description, scope, tasks, depends-on, linear ID, topology, trunk branch.
- [x] 3.2: Add stack progress tracking. After completing each stack item, write
  a `## Stack Progress` section to the plan file:
  ```markdown
  ## Stack Progress
  <!-- Updated by workflows:work. Do not edit manually. -->
  - [x] 1. feat/branch-slug-one (completed 2026-03-10)
  - [x] 2. feat/branch-slug-two
  ```
  On resume (re-invocation with same plan file), read this section and skip
  completed items. Cross-reference with `gt log short` to verify branches exist.
<!-- deepen-plan: external -->
> **Research:** Best practices for bottom-up stacked PR execution: (1) Start
> with small stacks (2-3 branches) during adoption. (2) Each slice should be
> independently reviewable. (3) Only merge the lowest mergeable branch to avoid
> orphaning dependents. (4) Leverage review parallelization -- while PR N is
> under review, work on PR N+1. (5) `gt submit --stack` publishes all branches
> at once and creates/updates PRs idempotently, so repeated submission after each
> item is safe. (6) Alternative tools (spr, ghstack) use commit-based models;
> Graphite's branch-based model is already the right fit here.
> See: https://graphite.com/docs/command-reference
<!-- /deepen-plan -->

- [x] 3.3: Implement stack execution loop in Phase 2 (Execute). For each
  incomplete stack item, bottom-up:
  1. Create branch: `gt create "<branch-name>"` (for linear topology, this
     creates on top of the previous branch; for parallel, checkout trunk first
     via `gt checkout <trunk>`)
  2. Filter plan tasks to only those listed in the item's `Tasks:` field
  3. Execute those tasks (existing implementation logic)
  4. Commit via `gt modify -m "<type>: <description>"`
  5. Run tests scoped to changed files
  6. Submit via `gt submit --no-interactive`
  7. Update `## Stack Progress` in plan file
  8. Present checkpoint: "Item N of M complete. [Continue to next / Revise
     remaining / Stop here]" via AskUserQuestion. Include a "Continue all
     remaining" option to skip future checkpoints.
- [x] 3.4: Adapt Phase 3 (Quality Check) for stack mode. Run lightweight checks
  per item (tests only). Full review agent suite runs only on the final item
  or when explicitly requested at a checkpoint.
- [x] 3.5: Adapt Phase 4 (Ship It) for stack mode. In single-branch mode,
  delegate to `/smart-submit` as before. In stack mode, submission happens
  per-item in 3.3 step 6, so Phase 4 becomes a summary: list all submitted
  PRs, show stack with `gt log short`, sync Linear if applicable.
- [x] 3.6: Add error handling for `gt create` failures mid-stack. If branch
  creation fails: stop, report which items succeeded, show stack state via
  `gt log short`, and ask user how to proceed.
- [x] 3.7: Handle the no-decomposition case: if `## Stack Decomposition` is
  absent, execute exactly as today (single branch). Zero behavioral change
  for existing plans.
- [x] 3.8: Update the `## Safety` or `## Guidelines` section at the bottom of
  work.md to document the stack execution model and its constraints.

### Phase 4: Update workflows:plan Post-Generation (PR 4, depends on PR 2)

<!-- deepen-plan: codebase -->
> **Codebase:** Confirmed: Phase 5 (lines 358-399) already promotes gt-stack-plan
> to option 1 when `## Linear Issues` is present (line 376). Task 4.1 is
> effectively a no-op for ordering logic. The actual work is in task 4.2:
> updating option descriptions to clarify the plan-only behavior.
<!-- /deepen-plan -->

- [x] 4.1: Update Phase 5 (Post-Generation) in
  `plugins/yellow-core/commands/workflows/plan.md`. When the plan has a
  `## Linear Issues` section, promote "Decompose into stacked PRs" to option 1
  (already the case). Clarify that this invokes the repurposed gt-stack-plan
  which enriches the plan file -- no branches are created.
- [x] 4.2: Update option descriptions to reflect the new flow:
  - "Decompose into stacked PRs (`/gt-stack-plan`)" -- adds `## Stack Decomposition` to the plan
  - "Start implementation (`/workflows:work`)" -- if decomposition exists, executes bottom-up
- [x] 4.3: Consider adding a combined option: "Decompose and start working" that
  chains `/gt-stack-plan` then `/workflows:work` automatically. Implement only
  if the Skill tool supports chaining cleanly; otherwise document as a
  two-step manual flow.

### Phase 5: Documentation Sweep (Independent PR, off trunk)

Branch-push `git push` references migrated to `gt submit --no-interactive` (or
annotated as operator procedures):

- [x] 5.1: **CONTRIBUTING.md** line 215 -- emergency release procedure. Replace
  `git push` with `gt submit --no-interactive`. Keep `git push --tags` on
  line 218 (tag push, legitimate). Add note: "For emergency pushes outside
  Graphite, disable the hook temporarily or push from a terminal outside
  Claude Code."
<!-- deepen-plan: codebase -->
> **Codebase:** All line numbers verified correct. Note: line 1296
> (`git push origin :refs/tags/v2.0.0`) is a tag-ref deletion, not a branch
> push -- correctly omitted from migration scope. Document this explicitly
> during implementation to avoid confusion. All other references at lines 227,
> 275, 329, 754, 1041, 1046, 1292, 1317, 1339 are branch-push operations
> confirmed by content inspection.
<!-- /deepen-plan -->

- [x] 5.2: **docs/operations/runbook.md** -- 9 branch-push references across
  remediation sections (lines 227, 275, 329, 754, 1041, 1046, 1292, 1317,
  1339). Replace each with `gt submit --no-interactive` where the procedure
  is a normal branch push. For emergency/operator procedures that bypass
  normal workflow (revert on main, fork sync), add annotation:
  "Operator procedure -- runs outside Claude Code via terminal."
- [x] 5.3: **docs/operations/git-auth.md** -- Add callout at top:
  ```
  > **Note:** This repository uses Graphite for all branch pushes. The `git push`
  > commands below demonstrate git authentication mechanics. For the development
  > workflow, use `gt submit --no-interactive` instead. See CONTRIBUTING.md.
  ```
  Leave all examples as-is. For rollback procedures (lines 299-371), add
  inline annotation: "Operator procedure."
- [x] 5.4: **.github/releases.md** -- Lines 793, 829: replace `git push origin
  main` with `gt submit --no-interactive` for version-mismatch and test-failure
  fix procedures. Leave all tag-push references (lines 33, 89, 111, 560, 670,
  677, 687, 723, 797, 799) untouched. Line 834 (`git push origin v1.2.3
  --force`): leave as-is (tag force-push).
- [x] 5.5: **docs/cli/publish.md** -- Lines 314, 371: replace branch-push
  references with `gt submit --no-interactive`.
- [x] 5.6: **docs/marketplace-quickstart.md** -- Line 133: replace `git push
  origin main` with `gt submit --no-interactive`.
- [x] 5.7: **docs/plugin-template.md** -- Line 524: replace `git push &&
  git push --tags` with `gt submit --no-interactive && git push --tags`
  (keep tag push).
- [x] 5.8: **docs/solutions/workflow/wsl2-crlf-pr-merge-unblocking.md** --
  Line 151: this is a solution doc (historical). Per decision, leave as-is.
  Actually, this is an operational fix procedure, not a retrospective.
  Replace with `gt submit --no-interactive`.
- [x] 5.9: **docs/operations/release-checklist.md** -- Lines 810, 1172: verify
  these are tag pushes (likely legitimate). If tag push, leave as-is. If
  branch push, migrate.
- [x] 5.10: **docs/operations/versioning.md** -- Line 56: already annotated as
  intentional tag push. Leave as-is. Verify the annotation is clear.

### Phase 6: Plugin Meta Updates (Independent PR, off trunk)

- [x] 6.1: Update `plugins/gt-workflow/CLAUDE.md` -- Add section on stack
  decomposition format, update command descriptions, document the new
  plan-only behavior of gt-stack-plan
- [x] 6.2: Update `plugins/gt-workflow/README.md` -- Reflect the new gt-stack-plan
  behavior and the stack-aware workflows:work integration
- [x] 6.3: Update `plugins/yellow-core/CLAUDE.md` -- Document the stack-aware
  workflows:work capability and its dependency on gt-workflow plugin
- [x] 6.4: Verify `check-git-push.sh` hook behavior -- Confirm it blocks only
  branch pushes, not tag pushes. If it blocks tag pushes, document this as
  intentional (tag pushes happen outside Claude Code). Do NOT modify the hook
  unless explicitly requested.

## Stack Decomposition

<!-- stack-topology: mixed -->
<!-- stack-trunk: main -->

### 1. docs/stack-decomposition-contract
- **Type:** docs
- **Description:** Define stack decomposition output format contract
- **Scope:** plugins/gt-workflow/output-styles/, plugins/gt-workflow/CLAUDE.md
- **Tasks:** 1.1, 1.2, 1.3
- **Depends on:** (none)

### 2. refactor/gt-stack-plan-plan-only
- **Type:** refactor
- **Description:** Repurpose gt-stack-plan as plan-only decomposition tool
- **Scope:** plugins/gt-workflow/commands/gt-stack-plan.md, plugins/gt-workflow/CLAUDE.md, plugins/gt-workflow/README.md
- **Tasks:** 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7
- **Depends on:** #1

### 3. feat/workflows-work-stack-aware
- **Type:** feat
- **Description:** Add stack-aware bottom-up execution to workflows:work
- **Scope:** plugins/yellow-core/commands/workflows/work.md
- **Tasks:** 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8
- **Depends on:** #2

### 4. feat/workflows-plan-post-generation
- **Type:** feat
- **Description:** Update workflows:plan post-generation for stack flow
- **Scope:** plugins/yellow-core/commands/workflows/plan.md
- **Tasks:** 4.1, 4.2, 4.3
- **Depends on:** #2

### 5. docs/git-push-migration-sweep
- **Type:** docs
- **Description:** Migrate branch-push git push references to gt submit
- **Scope:** CONTRIBUTING.md, docs/operations/, docs/cli/, docs/marketplace-quickstart.md, docs/plugin-template.md, .github/releases.md
- **Tasks:** 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10
- **Depends on:** (none)

### 6. docs/plugin-meta-updates
- **Type:** docs
- **Description:** Update plugin CLAUDE.md and README files for stack workflow
- **Scope:** plugins/gt-workflow/CLAUDE.md, plugins/gt-workflow/README.md, plugins/yellow-core/CLAUDE.md, plugins/gt-workflow/hooks/check-git-push.sh
- **Tasks:** 6.1, 6.2, 6.3, 6.4
- **Depends on:** #2, #3

## Technical Specifications

### Files to Modify

- `plugins/gt-workflow/commands/gt-stack-plan.md` -- Remove Phase 3, update
  confirmation, add decomposition output logic
- `plugins/yellow-core/commands/workflows/work.md` -- Add stack detection,
  progress tracking, stack execution loop, adapted quality/ship phases
- `plugins/yellow-core/commands/workflows/plan.md` -- Update post-generation
  option descriptions
- `plugins/gt-workflow/CLAUDE.md` -- Add decomposition format docs, update
  command descriptions
- `plugins/gt-workflow/README.md` -- Reflect new gt-stack-plan behavior
- `plugins/yellow-core/CLAUDE.md` -- Document stack-aware capability
- `CONTRIBUTING.md` -- Migrate emergency release procedure
- `docs/operations/runbook.md` -- Migrate 9 branch-push references
- `docs/operations/git-auth.md` -- Add callout header
- `.github/releases.md` -- Migrate 2 branch-push fix procedures
- `docs/cli/publish.md` -- Migrate 2 branch-push references
- `docs/marketplace-quickstart.md` -- Migrate 1 reference
- `docs/plugin-template.md` -- Migrate 1 reference

### Files to Create

- `plugins/gt-workflow/output-styles/stack-decomposition.md` -- Format contract
  for the `## Stack Decomposition` section

### Files NOT Modified

- `plugins/gt-workflow/hooks/check-git-push.sh` -- Hook behavior unchanged
  (blocks all `git push` including tag pushes; tag pushes happen outside Claude
  Code)
- `docs/solutions/` -- Historical retrospective docs left as-is
- `docs/operations/versioning.md` -- Already annotated as intentional tag push
- `docs/operations/release-checklist.md` -- Likely tag pushes only (verify
  during implementation)
- `scripts/ci/release-tags.sh` -- CI tag automation, legitimate

## Acceptance Criteria

1. `gt-stack-plan` no longer creates branches -- it produces a
   `## Stack Decomposition` section in the plan file (or `.gt-stack-plan.md`
   for standalone use)
2. `workflows:work` detects `## Stack Decomposition` and executes bottom-up:
   creates branches just-in-time, implements per-item, submits each via
   `gt submit --no-interactive`
3. `workflows:work` with no decomposition section works identically to today
   (zero regression for existing plans)
4. `workflows:work` tracks progress via `## Stack Progress` section and can
   resume from where it left off in a new session
5. `workflows:work` presents checkpoints between stack items with
   continue/revise/stop options
6. All branch-push `git push` references in operational docs are migrated or
   annotated per the exceptions list
7. All tag-push references remain unchanged
8. `pnpm validate:schemas` passes after all changes
9. No changes to the `check-git-push.sh` hook behavior

## Edge Cases & Error Handling

<!-- deepen-plan: external -->
> **Research:** `gt create` fails with an error when the branch name already
> exists -- it does not silently overwrite or stack. Recovery: use a different
> name, or use `gt modify` to amend the existing branch. For detached HEAD
> states, `gt create` likely fails because it cannot determine parent branch
> context -- use `gt checkout` first.
> See: https://graphite.com/docs/troubleshooting
<!-- /deepen-plan -->

1. **Existing branch name collision** -- When `gt create` encounters a branch
   that already exists (from a previous partial run), check `## Stack Progress`
   and `gt log short`. If the branch has commits beyond scaffold, treat as
   completed. If it's a bare branch, offer to reuse or rename.

2. **Trunk changes between stack items** -- Do NOT auto-sync mid-stack. Stacked
   PRs should be based on each other, not rebased to trunk between items.
   Suggest `gt repo sync` + `gt stack restack` at checkpoints if the user wants.

3. **Context window exhaustion** -- `## Stack Progress` in the plan file enables
   manual resume. Each completed item is persisted to disk before moving on.

4. **Mid-stack quality failure** -- If tests fail for item N, stop and ask user.
   Do not proceed to item N+1 since it depends on N (in linear topology). For
   parallel topology, skip the failed item and continue to the next independent
   item.

<!-- deepen-plan: codebase -->
> **Codebase:** Risk: The `Tasks:` field maps plan document IDs (e.g., "1.1,
> 1.2") to stack items. However, `workflows:work` currently creates its own
> TaskCreate entries from scratch (Phase 1, step 6). The mapping between plan
> document task IDs and runtime TaskCreate IDs is undefined. Implementation
> must either: (a) use plan task IDs as TaskCreate descriptions, or (b) parse
> the plan's `## Implementation Plan` to extract task text for matching items.
<!-- /deepen-plan -->

5. **Changeset strategy for stacked PRs** -- One changeset in the bottom branch
   covering the whole feature. Subsequent branches inherit it. If CI requires
   per-branch changesets, add a thin changeset per branch referencing the
   feature changeset.

6. **Decomposition revision mid-execution** -- At each checkpoint, offer "Revise
   remaining decomposition." If selected, re-run the decomposition section in
   the plan file (overwriting unfinished items) and resume from the current
   position.

7. **gt-stack-plan invoked standalone without plan file** -- Write to
   `.gt-stack-plan.md` in repo root (existing fallback behavior). Mention in
   output that `/workflows:work` can consume this file.

## References

- Brainstorm: `docs/brainstorms/2026-03-10-graphite-integration-deepening-brainstorm.md`
- Current gt-stack-plan: `plugins/gt-workflow/commands/gt-stack-plan.md`
- Current workflows:work: `plugins/yellow-core/commands/workflows/work.md`
- Current workflows:plan: `plugins/yellow-core/commands/workflows/plan.md`
- Graphite MCP plan: `plans/graphite-mcp-server.md`
- gt-workflow CLAUDE.md: `plugins/gt-workflow/CLAUDE.md`
- Stack plan output style: `plugins/gt-workflow/output-styles/stack-plan.md`
- check-git-push hook: `plugins/gt-workflow/hooks/check-git-push.sh`

<!-- deepen-plan: external -->
> **Research:** Additional references from external research:
> - Graphite create-stack docs: https://graphite.com/docs/create-stack
> - Graphite command reference: https://graphite.com/docs/command-reference
> - Graphite mid-stack updates: https://graphite.com/docs/update-mid-stack-branches
> - Graphite restacking: https://graphite.com/docs/restack-branches
> - mdast (Markdown AST): https://github.com/syntax-tree/mdast
> - prd-to-tasks pattern: https://lobehub.com/skills/eurelian-ai-dev-workflow-prd-to-tasks
> - Backlog.md (markdown task management): https://gorannikolovski.com/blog/from-vibe-to-structure-how-backlogmd-transforms-your-development-workflow
<!-- /deepen-plan -->
