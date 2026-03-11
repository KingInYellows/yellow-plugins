# Brainstorm: Graphite Integration Deepening

## What We're Building

A coordinated set of changes to deepen Graphite integration across the
yellow-plugins repository. Three workstreams:

1. **Stack-aware `workflows:work`** -- The work command gains the ability to
   read a `## Stack Decomposition` section from a plan document and execute it
   bottom-up. Each stacked PR is created, worked on, and submitted via
   `gt submit --no-interactive` before the next branch is created on top. No
   premature branch creation.

2. **Repurpose `gt-stack-plan` as plan-only** -- Remove the branch-creation
   phase (Phase 3) from `gt-stack-plan`. It becomes a pure decomposition tool:
   analyze a plan file, determine dependency ordering, map Linear issues to
   branch names, and write a `## Stack Decomposition` section into the plan
   document. The confirmation prompt simplifies from four options (Create /
   Adjust / Save plan only / Cancel) to three (Save to plan / Adjust / Cancel).

3. **Comprehensive documentation sweep** -- Replace branch-push `git push`
   references with `gt submit --no-interactive` across operational docs.
   Targeted exceptions for reference material, historical docs, and legitimate
   CI tag scripts.

## Why This Approach

The current workflow has a gap between planning and execution. `gt-stack-plan`
pre-creates all branches with scaffold commits before any work begins. This
leads to orphaned branches when plans change mid-execution and forces a
top-down mental model that does not match how stacked diffs are actually built.

The bottom-up approach -- plan the decomposition, then execute one slice at a
time, submitting each before starting the next -- matches the natural flow of
stacked PR development. It also eliminates the competing workflow paths
(pre-create vs manual) in favor of a single coherent model.

The documentation sweep ensures consistency: Claude sessions, human developers,
and operational runbooks all point to the same Graphite-first workflow.

## Key Decisions

### 1. Tag pushes remain as raw `git push`

Graphite has no concept of tag management. Tags are used exclusively in the
release pipeline (`publish-release.yml` triggers on tag push). The codebase
already documents this convention in `docs/operations/versioning.md` line 56:
"Tags are not managed by Graphite -- raw git push is correct here." The
`check-git-push.sh` PreToolUse hook blocks branch pushes during Claude
sessions; tag pushes during release operations are intentional human actions.

Scope: focus exclusively on branch-push references.

### 2. Change locus is `workflows:work`, not `workflows:plan`

The plan command's role is to document what gets built and in what order. The
work command's role is to execute it. Stack-awareness belongs in execution.
`workflows:plan` already offers `/gt-stack-plan` as a next step and supports
Linear issue metadata that feeds into stack decomposition. The plan command
needs no behavioral changes beyond potentially adjusting the next-step menu
ordering to surface stack decomposition more prominently.

The flow becomes: `workflows:plan` creates plan -> `gt-stack-plan` enriches
with stack decomposition -> `workflows:work` executes bottom-up.

### 3. `gt-stack-plan` becomes plan-only (not deprecated, not kept as alternative)

Three options were considered:

- **Deprecate** -- Premature. The decomposition logic (dependency analysis,
  Linear issue mapping, branch naming) is non-trivial and valuable. Throwing it
  away wastes good work.
- **Keep as alternative** -- Creates two competing paths (pre-create vs
  bottom-up) with two sets of documentation and inevitable divergence.
- **Repurpose as plan-only** (selected) -- Preserves the decomposition logic,
  eliminates the problematic branch-creation phase, and creates clear separation
  of concerns across three commands.

Concretely: `gt-stack-plan` Phase 1 (Understand the Feature) and Phase 2
(Design the Stack) stay as-is. Phase 3 (Create Branches) is removed. The
"Save plan only" path becomes the only path.

### 4. Documentation sweep: comprehensive with targeted exceptions

The sweep covers approximately 25 branch-push references across operational
docs. Three categories of exceptions:

- **`docs/operations/git-auth.md`** -- Reference document about git
  authentication mechanics. The `git push` commands illustrate how SSH keys
  and tokens work, not a workflow prescription. Add a callout at the top noting
  "This repo uses Graphite for branch pushes -- see CONTRIBUTING.md" and leave
  examples as-is. Rewriting `git push origin main` to `gt submit` in an SSH
  key configuration doc would confuse readers.
- **`docs/solutions/` files** -- Retrospective incident docs. Rewriting
  historical context would be revisionist. Leave as historical record.
- **`scripts/ci/release-tags.sh`** -- CI automation pushing tags, not branches.
  Confirmed legitimate.

Files requiring migration:

- `CONTRIBUTING.md` (emergency release section, line 215)
- `docs/operations/runbook.md` (multiple fix-and-rerun sections)
- `docs/plugin-template.md` (push checklist)
- `.github/releases.md` (branch-push sections, not tag-push sections)
- `docs/cli/publish.md` (manual retry section)
- `docs/marketplace-quickstart.md` (line 133)
- `docs/operations/release-checklist.md` (branch-push references only)
- `plans/plugin-versioning-automation.md` (line 302)

### 5. `gh pr create` references need no migration

All existing `gh pr create` references in the codebase are already prohibition
statements ("never use `gh pr create`"). No migration work needed -- these are
already correct.

### 6. Stack execution model in `workflows:work`

The stack-aware execution in `workflows:work` should follow this pattern:

- Read `## Stack Decomposition` from the plan document
- If present, enter stack execution mode; if absent, execute as today (single
  branch)
- For each stack item, bottom-up:
  - Create the branch with `gt create <branch-name>`
  - Execute the tasks scoped to that stack item
  - Run tests and quality checks
  - Submit via `gt submit --no-interactive` (or delegate to `/smart-submit`)
  - Create the next branch on top with `gt create <next-branch-name>`
- Track progress: which stack items are complete, which is current
- Handle interruptions gracefully: if the user stops mid-stack, the completed
  PRs are already submitted and the remaining plan is still readable

Branches are created just-in-time, not upfront. Each branch exists only after
its predecessor has been submitted.

## Open Questions

- **Stack item granularity in the plan document** -- Should the
  `## Stack Decomposition` section use a specific machine-readable format (e.g.,
  YAML front matter, structured markdown with known headings per item), or
  should `workflows:work` parse free-form markdown? A structured format is more
  reliable but adds authoring friction.

- **Mid-stack failures** -- If a stack item fails quality checks or tests, should
  `workflows:work` stop the entire stack and ask the user, or attempt to fix and
  retry? Current `workflows:work` already has blocker-handling logic, but stack
  context adds complexity (a failure in item 2 blocks items 3-N).

- **Stack reordering** -- If during execution the developer realizes item 3
  should come before item 2, how should `workflows:work` handle reordering?
  This may be out of scope for v1 (just stop and re-plan), but worth
  considering.

- **Independent vs stacked PRs** -- Not all plan decompositions are linear
  stacks. Some items may be independent (parallel branches off trunk) rather
  than stacked. Should the decomposition format support both topologies, or
  should independent PRs be handled as separate `workflows:work` invocations?

- **Interaction with `/smart-submit`** -- Currently `workflows:work` delegates
  to `/smart-submit` for the final submission. In stack mode, each stack item
  would need its own submit. Should each item get the full `/smart-submit`
  audit treatment (3 parallel agents), or should intermediate items get a
  lighter-weight check to avoid audit fatigue?

## Dialogue Log

### Q1: Tag pushes vs branch pushes

**Question:** Should tag pushes (category 1: `git push origin v1.2.3` in
release docs, CI scripts) be treated as acceptable, or should they also be
routed through a Graphite-aware wrapper?

**Answer:** Tag pushes stay as raw `git push`. Graphite does not manage tags.
The codebase already documents this convention. Wrapping adds complexity with
zero benefit. Focus exclusively on branch-push references (category 2).

### Q2: Where does the stack-awareness live?

**Question:** The change is primarily in `workflows:work` becoming stack-aware,
with `workflows:plan` documenting the stack breakdown. Does that match your
mental model, or do you see the plan command itself changing behavior?

**Answer:** Confirmed. The plan documents the decomposition; the work command
executes it. `workflows:plan` needs no behavioral changes.

### Q3: What happens to `gt-stack-plan`?

**Question:** Three options -- (A) repurpose as plan-only, (B) keep as
alternative path, (C) deprecate entirely.

**Answer:** Option A -- repurpose as plan-only. Remove branch creation, keep
decomposition logic. Preserves valuable analysis without creating competing
workflow paths.

### Q4: Documentation sweep scope

**Question:** Targeted (actionable docs only), comprehensive (everything), or
hybrid (actionable docs + callout boxes on reference docs)?

**Answer:** Comprehensive with best-judgment exceptions. Exceptions applied:
git-auth.md gets callout only, docs/solutions/ left as historical, CI tag
scripts confirmed legitimate.
