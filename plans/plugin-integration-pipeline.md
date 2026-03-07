# Feature: Plugin Integration Pipeline Connectors

## Problem Statement

Each plugin (yellow-linear, yellow-core, gt-workflow, yellow-devin) works well
in isolation, but handoffs between them are manual and disconnected. After
`/linear:plan-cycle` assigns issues to a cycle, there is no suggested next step.
`/workflows:plan` cannot pull context from Linear issues automatically.
`/gt-stack-plan` does not understand Linear issue IDs. PR submission via Graphite
does not update Linear statuses. Devin delegation is available but never surfaced
during triage or cycle planning.

## Proposed Solution

Add explicit "pipeline connector" steps to existing commands and create one new
command (`/linear:work`) that bridges Linear issues into the core workflow
pipeline. Each command knows what comes after it and offers the transition with
context pre-loaded. The plan file remains the central intermediary artifact.

<!-- deepen-plan: external -->
> **Research:** The `/linear:work` bridge command acts as a **saga/orchestrator**
> — a pattern where a central coordinator sequences plugin invocations, tracks
> which steps completed, and handles degradation on failure. In Claude Code's
> plugin system, this translates to: the command `.md` file reads the plan for
> context, invokes downstream commands via `Skill` tool in sequence, writes
> results back to intermediate markdown files, and presents the next step via
> `AskUserQuestion`. This is the dominant orchestration pattern in the existing
> codebase (see `/workflows:work` which already orchestrates `/smart-submit` →
> `/review:pr` via Skill).
<!-- /deepen-plan -->

### Key Design Decisions

1. **Devin delegation is always manual, always early** -- surfaced during
   triage/plan-cycle only, never automated.
2. **One PR per Linear issue** as the default mapping, many-to-one acceptable.
3. **Auto-apply safe Linear transitions** (In Review on submit), **confirm
   terminal transitions** (Done on merge). New two-tier safety model.
4. **Plan file is the intermediary** -- Linear issues feed into it, Graphite
   stacks come out of it.
5. **Context passes via brainstorm docs** -- `/linear:work` writes a
   pre-populated brainstorm doc that `/workflows:plan` auto-detects (Phase 1).
6. **Issue-to-PR mapping via branch naming** -- `feat/<ISSUE-ID>-<slug>` as
   primary mapping, aligning with existing `linear-workflows` convention.
7. **Linear status updates via Skill delegation** -- `/workflows:work` invokes
   `/linear:sync` after submit (not embedded in `/smart-submit`), keeping
   gt-workflow Linear-unaware.

### Target Flow

```
linear:triage / linear:plan-cycle
        |
        +---> [Delegate to Devin]  (manual, early decision)
        |
        +---> linear:work <issue-id(s)>
                    |
                    +---> workflows:plan  (single issue, auto-loads Linear context)
                    |           |
                    |           +---> workflows:work  (single PR)
                    |           +---> gt-stack-plan   (stacked PRs)
                    |                       |
                    |                       +---> workflows:work per branch (manual)
                    |
                    +---> gt-stack-plan     (multiple issues, direct to stack)
                                |
                                +---> workflows:work per branch
                                            |
                                            +---> smart-submit
                                                      |
                                                      +---> linear:sync (via Skill)
                                                                |
                                                                +---> Auto: "In Review"
                                                                +---> Confirm: "Done"
```

## Implementation Plan

### Phase 0: Prerequisite Investigation

- [ ] **0.1: Verify Linear MCP tool naming**

  Run the Linear MCP server locally and confirm whether the current mutation
  tool is `update_issue` or `save_issue`.

  If the tool was renamed, update `allowed-tools` in all affected commands
  (`triage.md`, `plan-cycle.md`, `sync.md`, `delegate.md`, `sync-all.md`,
  `linear-pr-linker.md`, and the new `/linear:work`) before starting the
  implementation phases below.

### Phase 1: New `/linear:work` Command (yellow-linear)

This is the keystone connector -- the bridge from Linear issues to workflows.

- [ ] **1.1: Create `plugins/yellow-linear/commands/linear/work.md`**

  New command file with:
  - **YAML frontmatter:** `name: linear:work`, `description: "Start working on a Linear
    issue — loads context and routes to plan or stack. Use when 'work on
    ENG-123', 'start issue', 'pick up this ticket'."`
  - **argument-hint:** `'<issue-id(s) or cycle-name>'`
  - **allowed-tools:** Linear MCP tools (`get_issue`, `list_issues`,
    `list_cycles`, `list_issue_statuses`, `list_comments`), `Bash`, `Read`,
    `Write`, `AskUserQuestion`, `ToolSearch`, `Skill`

<!-- deepen-plan: codebase -->
> **Codebase:** The frontmatter `name` field should be `linear:work`, not
> `work`. All existing yellow-linear commands use fully-qualified names:
> `linear:triage`, `linear:plan-cycle`, `linear:sync`, `linear:delegate`,
> `linear:create`. See `plugins/yellow-linear/commands/linear/delegate.md:2`
> for the pattern.
<!-- /deepen-plan -->

  **Workflow steps:**

  1. **Parse arguments:** If matches `[A-Z]{2,5}-[0-9]{1,6}` pattern(s), treat
     as issue IDs. Otherwise, treat as cycle name and fetch issues from that
     cycle via `list_cycles` + `list_issues`, then present selection UI.
  2. **Validate issues (C1 pattern):** Fetch each issue via `get_issue`.
     Validate exists and is accessible. Check status:
     - If Done/Cancelled: warn "issue appears already handled", confirm or abort.
     - If In Review: warn "issue already has a PR in review", confirm or abort.
     - If In Progress and assigned to someone else: warn and confirm.
  3. **Display issue context:** Show title, description, acceptance criteria,
     priority, labels, recent comments for each issue.
  4. **Write brainstorm doc:** Write a pre-populated context document to
     `docs/brainstorms/<date>-<ISSUE-ID>-<slug>-brainstorm.md` (for example,
     `2026-03-04-ENG-123-auth-flow-brainstorm.md`) containing:
     - Issue title, ID, priority, status
     - Full description and acceptance criteria
     - Recent comments (last 5)
     - Links back to Linear
     - Cross-references if multiple issues

<!-- deepen-plan: codebase -->
> **Codebase:** The brainstorm doc naming convention is
> `<date>-<topic>-brainstorm.md`, not `<issue-id>-<slug>.md`. Every existing
> brainstorm file follows this pattern (e.g.,
> `2026-03-04-plugin-integration-pipeline-brainstorm.md`), and
> `/workflows:brainstorm` explicitly outputs to
> `docs/brainstorms/<date>-<topic>-brainstorm.md`. The `/linear:work` command
> should follow: `docs/brainstorms/<date>-<ISSUE-ID>-<slug>-brainstorm.md`
> (e.g., `2026-03-04-ENG-123-auth-flow-brainstorm.md`). This ensures
> `/workflows:plan` Phase 1 auto-detection continues to work since it scans
> `docs/brainstorms/` for `.md` files.
<!-- /deepen-plan -->

  5. **Update Linear status:** Transition issue(s) to "In Progress" before
     handing off to the downstream workflow (auto-apply, safe transition).
  6. **Route to workflow:** Present options via `AskUserQuestion`:
     - **Single issue:** "Plan this issue (`/workflows:plan <title>`)" or
       "Plan as stacked PRs (`/gt-stack-plan <brainstorm-path>`)"
     - **Multiple issues:** "Plan as stacked PRs (`/gt-stack-plan <path>`)" or
       "Plan each issue separately"
  7. **Invoke via Skill tool:** Call the selected command with pre-filled args.
     Graceful degradation: if target plugin not installed, output install
     instructions and suggest manual workflow.

- [ ] **1.2: Add Skill tool trigger description**

  Ensure the `description` field matches natural language: "work on ENG-123",
  "start issue", "pick up this ticket", "begin working on".

### Phase 2: "What Next?" Connectors (yellow-linear)

Add post-completion routing to triage and plan-cycle commands.

<!-- deepen-plan: codebase -->
> **Codebase:** The "What Next?" `AskUserQuestion` routing pattern is already
> established in 8+ commands across the ecosystem (e.g., `/workflows:plan`
> Phase 5 line 347, `/ci:setup` line 227, `/devin:setup` line 248). This is a
> safe, well-tested convention. However, **same-plugin Skill invocation is
> untested territory** — all existing `Skill` invocations are cross-plugin
> (e.g., yellow-core invoking gt-workflow's `/smart-submit`, yellow-core
> invoking yellow-review's `/review:pr`). Phase 2 proposes triage invoking
> `/linear:work` and `/linear:delegate` within the same yellow-linear plugin.
> Verify same-plugin Skill invocation works in Claude Code, or fall back to
> `AskUserQuestion`-based "suggest and let user invoke" (matching how setup
> commands present "What Next?" options without programmatic invocation).
<!-- /deepen-plan -->

- [ ] **2.1: Modify `plugins/yellow-linear/commands/linear/triage.md`**

  Changes:
  - Add `Skill` to `allowed-tools` list
  - After existing Step 7 (Summary), add **Step 8: What Next?**
  - Step 8 uses `AskUserQuestion` with options:
    1. "Start working on an issue (`/linear:work`)"
    2. "Delegate an issue to Devin (`/linear:delegate`)"
    3. "Done for now"
  - If option 1 or 2: ask which issue (present recently triaged issue IDs)
  - If same-plugin `Skill` invocation works: invoke the selected command
    directly with pre-filled args
  - If same-plugin `Skill` invocation fails: fall back to the standard
    `AskUserQuestion`-only pattern by displaying the exact command string and
    letting the user invoke it manually

- [ ] **2.2: Modify `plugins/yellow-linear/commands/linear/plan-cycle.md`**

  Changes:
  - Add `Skill` to `allowed-tools` list
  - After existing Step 7 (Summary), add **Step 8: What Next?**
  - Step 8 uses `AskUserQuestion` with options:
    1. "Start working on an issue (`/linear:work <issue-id>`)"
    2. "Plan the full cycle as a stack (`/linear:work <cycle-name>`)"
    3. "Delegate an issue to Devin (`/linear:delegate <issue-id>`)"
    4. "Done for now"
  - If option 1 or 3: present cycle issue IDs for selection
  - If same-plugin `Skill` invocation works: invoke the selected command
    directly with pre-filled args
  - If same-plugin `Skill` invocation fails: fall back to the standard
    `AskUserQuestion`-only pattern by displaying the exact command string and
    letting the user invoke it manually

### Phase 3: Linear Context in `/workflows:plan` (yellow-core)

Ensure `/workflows:plan` picks up Linear context written by `/linear:work`.

- [ ] **3.1: Modify `plugins/yellow-core/commands/workflows/plan.md` Phase 1**

  The command already checks `docs/brainstorms/` in Phase 1, Steps 1-2. Changes:
  - Add a note in the brainstorm-detection logic: "If a brainstorm doc contains
    a `## Linear Issue` section with issue IDs, treat those as source-of-truth
    requirements. Include issue IDs in the plan file header for downstream
    mapping."
  - In Phase 4 (Plan Writing), add a `## Linear Issues` metadata section to the
    plan template when Linear context is detected:
    ```markdown
    ## Linear Issues
    - ENG-123: Title of issue
    - ENG-456: Title of other issue
    ```
  - In Phase 5 (Post-Generation), if Linear issues are present, add
    `/gt-stack-plan` as the first suggested option (since multi-issue plans
    benefit most from stacking).

<!-- deepen-plan: codebase -->
> **Codebase:** `/workflows:plan` Phase 5 already has a specific ordered list
> of "What would you like to do next?" options (line 349 of
> `plugins/yellow-core/commands/workflows/plan.md`): (1) Start implementation
> `/workflows:work`, (2) Enrich `/workflows:deepen-plan`, (3) Decompose
> `/gt-stack-plan`, (4) Create GitHub issue, (5) Simplify, (6) Something else.
> The plan says "add `/gt-stack-plan` as the first suggested option" but does
> not specify the exact new ordering. Recommend: when Linear issues are
> detected, reorder to: (1) `/gt-stack-plan` (promoted from #3), (2)
> `/workflows:work`, (3) `/workflows:deepen-plan`, rest unchanged. This keeps
> the existing option set intact while surfacing the most relevant choice first.
<!-- /deepen-plan -->

### Phase 4: Issue-Aware Stack Planning (gt-workflow)

Teach `/gt-stack-plan` to use Linear issue IDs in branch names.

- [ ] **4.1: Modify `plugins/gt-workflow/commands/gt-stack-plan.md`**

  Changes to Phase 1 (Understand):
  - When reading a plan file, check for a `## Linear Issues` section.
  - If found, extract issue IDs and titles.

  Changes to Phase 2 (Design):
  - When designing the stack, default to **one branch per Linear issue** (1:1
    mapping). Each branch name follows `feat/<ISSUE-ID>-<slug>` convention.
  - If a natural decomposition requires many-to-one (multiple issues in one PR),
    present the deviation to the user and confirm.
  - Include issue ID in the branch `gt create` scaffold message.

  Changes to Phase 3 (Create Branches):
  - When creating branches with `gt create`, use the
    `feat/<ISSUE-ID>-<description>` naming pattern.
  - After stack creation, output the issue-to-branch mapping table:
    ```
    Stack created:
    Branch                        | Linear Issue
    feat/ENG-123-add-auth-model   | ENG-123
    feat/ENG-456-add-auth-api     | ENG-456
    ```
  - Suggest: "Work through the stack bottom-up with
    `/workflows:work plans/<name>.md`"

### Phase 5: Post-Submit Linear Sync (yellow-core + yellow-linear)

Add automatic Linear status updates after Graphite submission.

- [ ] **5.1: Modify `plugins/yellow-core/commands/workflows/work.md` Phase 4**

  After the existing `/smart-submit` Skill invocation (line ~350), add a new
  step:

  **Step: Post-Submit Linear Sync**
  - Extract issue ID from current branch name using
    `[A-Z]{2,5}-[0-9]{1,6}` pattern.
  - If issue ID found, invoke `/linear:sync --auto-tier1` via Skill tool.
  - `/linear:sync` already handles: fetching issue, detecting PR state,
    suggesting status transition with confirmation.
  - Graceful degradation: if yellow-linear not installed, skip silently.

- [ ] **5.2: Update `linear-workflows` SKILL.md with two-tier safety model**

  Modify `plugins/yellow-linear/skills/linear-workflows/SKILL.md` to document:
  - **Tier 1 (Auto-apply):** Non-terminal, reversible transitions. Currently:
    `* -> In Progress`, `* -> In Review`. Applied with post-hoc notification
    ("Updated ENG-123 to In Review") but no pre-confirmation.
  - **Tier 2 (Confirm):** Terminal or ambiguous transitions. Currently:
    `* -> Done`, `* -> Cancelled`, `* -> Backlog`. Requires explicit user
    confirmation (existing M3 pattern).
  - This is an evolution of M3, not a replacement. M3 continues to apply to
    Tier 2 transitions.

<!-- deepen-plan: codebase -->
> **Codebase:** This two-tier model represents a deliberate loosening of the
> current M3 safety rule. The existing `linear-workflows` SKILL.md (line 174)
> states: "Agents that modify Linear state must request explicit user
> confirmation before writes." And `linear-pr-linker.md` (line 101) reinforces:
> "DO NOT auto-update without explicit user consent." The SKILL.md update must
> include explicit rationale for this evolution — specifically that Tier 1
> transitions are reversible, non-destructive, and triggered by explicit user
> actions (invoking `/smart-submit` implies intent to transition to "In
> Review"). Document which transitions belong to each tier as a closed list,
> not an open-ended classification.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** Prior art from Terraform, GitHub CLI, Factory.ai, and Linear's
> own automation supports this two-tier approach. The classification criteria
> for auto-apply vs confirm should be: (1) **Reversibility** — can the prior
> state be restored? (2) **Information destruction** — does the transition
> archive/delete data? (3) **External notifications** — does it notify team
> members? (4) **Cascading effects** — does it close PRs or cancel related
> tasks? Auto-apply when ALL four are safe; confirm when ANY is risky. In
> Claude Code's plugin context, Tier 1 uses text output for post-hoc
> notification ("Updated ENG-123 to In Review"), while Tier 2 uses
> `AskUserQuestion` with default "No" for destructive transitions. Consider
> adding a `pipeline.confirmationLevel` setting in the SKILL.md for users who
> want all transitions confirmed.
<!-- /deepen-plan -->

- [ ] **5.3: Update `/linear:sync` to respect the two-tier model**

  Modify `plugins/yellow-linear/commands/linear/sync.md`:
  - Add a `--auto-tier1` argument for programmatic invocation from
    `/workflows:work`.
  - When suggesting a transition to In Review: auto-apply and notify.
  - When suggesting a transition to Done: require confirmation (existing
    behavior).
  - When `--auto-tier1` is present, apply Tier 1 transitions without
    `AskUserQuestion`; manual invocations continue to prompt.
  - Update `/workflows:work` Phase 5.1 to pass `--auto-tier1` when invoking via
    Skill after `/smart-submit`.

<!-- deepen-plan: codebase -->
> **Codebase:** `/linear:sync` currently uses `AskUserQuestion` for **every**
> status transition (line 94 of `sync.md`: "Present the suggestion via
> AskUserQuestion and let user confirm or choose a different status"). The
> Phase 5.3 change needs a mechanism to distinguish manual invocation
> (`/linear:sync` typed by user) from programmatic invocation (Skill tool call
> from `/workflows:work`). Options: (A) Add an argument like `--auto-tier1` or
> `--after-submit` that `/workflows:work` passes when invoking via Skill, which
> triggers auto-apply for Tier 1. (B) Always auto-apply Tier 1 regardless of
> invocation context (simpler but changes behavior for manual users). Recommend
> option (A) to preserve existing manual behavior while enabling automation.
<!-- /deepen-plan -->

### Phase 6: Prerequisite Fix

- [ ] **6.1: Update `/linear:delegate` API endpoint**

  In `plugins/yellow-linear/commands/linear/delegate.md`, update the base URL
  from `https://api.devin.ai/v3beta1` to `https://api.devin.ai/v3/` to match
  the stable API documented in yellow-devin's CLAUDE.md.

### Phase 7: Cross-Plugin Documentation

- [ ] **7.1: Update yellow-linear CLAUDE.md**

  Add `/linear:work` to the component inventory. Update the "Cross-Plugin
  Dependencies" section to document:
  - Optional dependency on yellow-core (`/workflows:plan`, `/workflows:work`)
  - Optional dependency on gt-workflow (`/gt-stack-plan`)
  - Graceful degradation when either is missing

- [ ] **7.2: Update yellow-core CLAUDE.md**

  Document the new post-submit Linear sync step in `/workflows:work`. Update
  cross-plugin dependencies to note optional yellow-linear integration.

- [ ] **7.3: Update gt-workflow CLAUDE.md**

  Document `/gt-stack-plan`'s new Linear issue awareness. Note that this is
  input-only (reads issue IDs from plan metadata) and does not create a runtime
  dependency on yellow-linear.

- [ ] **7.4: Update `plugins/yellow-linear/README.md`**

  Update the command list and command count to reflect the new `/linear:work`
  command (7 commands -> 8 commands).

- [ ] **7.5: Update root `README.md`**

  Update the yellow-linear entry from "7 commands" to "8 commands".

<!-- deepen-plan: codebase -->
> **Codebase:** Phase 7 is missing README.md updates. The root `README.md`
> (line 28) lists yellow-linear as "3 agents, 7 commands, 1 skill, 1 MCP" —
> adding `/linear:work` changes this to 8 commands.
> `plugins/yellow-linear/README.md` also lists commands and needs updating.
> Add tasks: (7.4) Update `plugins/yellow-linear/README.md` command list and
> count, (7.5) Update root `README.md` yellow-linear entry to "8 commands".
> This brings the estimated scope to 1 new file, 7 modified files, 3 CLAUDE.md
> updates, **+ 2 README updates**.
<!-- /deepen-plan -->

## Acceptance Criteria

1. After `/linear:plan-cycle`, user is prompted with "What Next?" offering
   work, delegate, and done options.
2. After `/linear:triage`, user is prompted with "What Next?" offering work,
   delegate, and done options.
3. `/linear:work ENG-123` fetches issue context, writes a brainstorm doc, and
   routes to `/workflows:plan` or `/gt-stack-plan` with context pre-loaded.
4. `/linear:work` with multiple issue IDs routes to `/gt-stack-plan` and creates
   branches named `feat/<ISSUE-ID>-<slug>`.
5. `/workflows:plan` detects Linear context in brainstorm docs and includes a
   `## Linear Issues` section in the generated plan.
6. `/gt-stack-plan` creates 1:1 issue-to-branch mappings when Linear issues are
   present in the plan.
7. After `/smart-submit` within `/workflows:work`, Linear issue status
   transitions to "In Review" automatically (Tier 1).
8. When `/linear:sync` is run after a PR is merged, the "Done" transition
   requires user confirmation (Tier 2).
9. All cross-plugin Skill invocations degrade gracefully with install
   instructions when the target plugin is missing.
10. `/linear:delegate` uses the stable v3 API endpoint.

## Edge Cases

- **Issue already In Progress (assigned to others):** Warn and confirm.
- **Issue already In Review or Done:** Warn that work may be duplicated.
- **Multiple issues with tight coupling:** Allow many-to-one PR mapping with
  explicit confirmation.
- **Target plugin not installed:** Output install command, suggest manual
  alternative.
- **Branch name collision:** If branch already exists, `gt create` will fail --
  let the error propagate and suggest the user check existing branches.
- **No issue ID extractable from branch:** Post-submit sync step skips silently.

<!-- deepen-plan: codebase -->
> **Codebase:** Missing edge case: **MCP tool naming discrepancy.** The
> deferred tool listing shows `mcp__plugin_yellow-linear_linear__save_issue`
> but all existing commands reference `update_issue` in their `allowed-tools`
> (triage.md:11, plan-cycle.md:12, sync.md:11, delegate.md:11, sync-all.md:13,
> linear-pr-linker.md:10). If the Linear MCP server renamed `update_issue` to
> `save_issue`, all 6 commands and the new `/linear:work` need the updated tool
> name. Investigate before implementation — this could be a blocking issue if
> `update_issue` no longer resolves at runtime.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** For graceful degradation in Claude Code's plugin system, the
> established pattern (confirmed across 50+ instances in the codebase) is:
> check if the target command/MCP tool is available, and if not, output a
> human-readable install instruction and suggest the manual alternative. In
> Claude Code specifically, this means checking Skill tool availability (the
> Skill tool will fail if the plugin isn't installed) and catching that failure
> gracefully. The command `.md` should include explicit fallback instructions:
> "If Skill invocation fails with plugin not found: output
> `yellow plugin install <name>` and describe the manual workflow equivalent."
<!-- /deepen-plan -->

## Implementation Order

Phases can be partially parallelized:

```
Phase 6 (prereq fix)  ─────────────────────────> (independent, do first)
Phase 1 (linear:work) ─────────────────────────> Phase 2 (what next?)
Phase 3 (plan context) ────> Phase 4 (stack plan) ────> Phase 5 (post-submit sync)
Phase 7 (docs) ────────────────────────────────> (after all code changes)
```

Estimated changes: 1 new file, 7 modified files, 3 CLAUDE.md updates, 2 README updates.

## References

- Brainstorm: `docs/brainstorms/2026-03-04-plugin-integration-pipeline-brainstorm.md`
- Existing commands:
  - `plugins/yellow-linear/commands/linear/triage.md`
  - `plugins/yellow-linear/commands/linear/plan-cycle.md`
  - `plugins/yellow-linear/commands/linear/sync.md`
  - `plugins/yellow-linear/commands/linear/delegate.md`
  - `plugins/yellow-core/commands/workflows/plan.md`
  - `plugins/yellow-core/commands/workflows/work.md`
  - `plugins/gt-workflow/commands/gt-stack-plan.md`
  - `plugins/gt-workflow/commands/smart-submit.md`
- Conventions: `plugins/yellow-linear/skills/linear-workflows/SKILL.md`
- Plugin schema: `schemas/plugin.schema.json`
- Research sources:
  - Factory.ai Auto-Run Mode — three-tier risk classification with safety interlocks
  - Terraform plan-then-apply — confirmation model with `-auto-approve` bypass
  - GitHub CLI — evolved confirmation safeguards for destructive operations
  - Linear Conceptual Model — automatic state transitions driven by git/PR activity
  - Microsoft Saga Pattern — orchestrator pattern for cross-service workflows
