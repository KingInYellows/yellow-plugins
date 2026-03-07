# Plugin Integration Pipeline

## What We're Building

A set of pipeline connectors that link Linear issue management, core workflows
(brainstorm/plan/work), Graphite stack submission, and Devin delegation into a
cohesive issue-to-shipped-PR flow. The plan file remains the central intermediary
artifact: Linear issues feed into it, Graphite stacks come out of it.

### Core Problem

Today, each plugin works well in isolation but the handoffs between them are
manual and disconnected:

- `/linear:plan-cycle` ends with issues assigned to a cycle but no suggestion of
  what to do next.
- `/linear:triage` assigns and prioritizes issues but does not route them toward
  planning or delegation.
- `/workflows:plan` does not know how to pull context from a Linear issue
  automatically.
- `/gt-stack-plan` does not understand Linear issue IDs or maintain issue-to-PR
  mappings.
- `/workflows:work` and `/smart-submit` do not update Linear statuses after
  Graphite submission.
- Devin delegation (`/linear:delegate`) is available but never surfaced during
  triage or cycle planning, forcing users to remember it exists.

### Target Flow

```
linear:triage / linear:plan-cycle
        |
        +---> [Delegate to Devin]  (manual, early decision)
        |
        +---> linear:work <issue-id>
                    |
                    +---> workflows:plan  (single issue, produces plan doc)
                    |           |
                    |           +---> workflows:work  (single PR)
                    |           +---> gt-stack-plan   (stacked PRs)
                    |                       |
                    |                       +---> workflows:work per branch
                    |
                    +---> gt-stack-plan     (multiple issues, direct to stack)
                                |
                                +---> workflows:work per branch
                                            |
                                            +---> smart-submit
                                                      |
                                                      +---> Auto: Linear -> "In Review"
                                                      +---> Confirm: Linear -> "Done"
```

## Why This Approach

**Selected: Approach A -- Pipeline Connectors**

This approach adds explicit "next step" connectors at the end of each command,
plus a new `/linear:work` entry point. Each command knows what comes after it and
offers the transition with context pre-loaded.

We chose this over two alternatives:

- **Unified Orchestrator** (rejected): A single `/linear:pipeline` command that
  drives the entire lifecycle. Rejected because it creates tight coupling between
  plugins, violates plugin independence, and produces a large complex command
  that is hard to maintain. Individual commands lose their standalone utility.

- **Event-Driven Hooks** (rejected): Commands emit lifecycle events and others
  listen. Rejected as over-engineered for the current plugin count. Adds
  infrastructure complexity (event system, routing logic) and makes connections
  implicit and harder to debug. Worth revisiting if the plugin ecosystem grows
  significantly.

Pipeline Connectors win because:

1. Each plugin stays independent -- connectors are suggestions, not hard
   dependencies.
2. Incremental to build -- each connector is a small, testable change.
3. Preserves composability -- every command still works on its own.
4. The plan file as intermediary is already established; we just need to feed
   Linear context into it and map Graphite output back.

## Key Decisions

### 1. Devin delegation is always manual, always early

Devin delegation is a human decision made during triage or cycle planning, never
automated. The system surfaces the option at the right moment but never
auto-delegates.

- `/linear:triage` Step 5 gains an action: "Delegate to Devin" alongside assign,
  prioritize, and label.
- `/linear:plan-cycle` Step 5 gains an option per issue: "Delegate to Devin"
  which invokes `/linear:delegate` with the issue ID.
- No other point in the pipeline offers Devin delegation. If you are already
  planning or working, you do the work yourself.

### 2. One PR per Linear issue is the default mapping

When `/gt-stack-plan` decomposes a plan into a Graphite stack, the default is one
branch (and therefore one PR) per Linear issue. Many-to-one is acceptable when
issues are tightly coupled, but the system should default to 1:1 and require
explicit user confirmation to deviate.

This keeps Linear status tracking clean: each PR merge triggers a single issue
status transition without ambiguity.

### 3. Linear status updates: automatic for safe transitions, confirm for terminal

| Event                    | Linear Transition    | Behavior     |
|--------------------------|----------------------|--------------|
| PR submitted via Graphite| -> In Review         | Auto-apply   |
| PR approved              | (no change)          | No action    |
| PR merged                | -> Done              | Ask to confirm |
| PR closed without merge  | -> Backlog / Cancelled | Ask to confirm |

"Safe" transitions (In Review) are non-destructive and reversible. Terminal
transitions (Done, Cancelled) require explicit user confirmation because they
signal completion or abandonment.

### 4. The plan file is always the intermediary artifact

Linear issues feed context into plan files. Graphite stacks are decomposed from
plan files. The plan is the contract between "what to build" and "how to ship
it."

- Single small issue: `/workflows:plan` -> single plan doc -> `/workflows:work`
  -> single PR.
- Single large issue: `/workflows:plan` -> plan doc -> `/gt-stack-plan` ->
  stacked PRs -> `/workflows:work` per branch.
- Multiple related issues: enhanced `/linear:work` bundles selected issues into
  one plan with cross-references -> `/gt-stack-plan` -> stack where each PR maps
  back to its Linear issue(s).

### 5. A new `/linear:work` command bridges Linear to workflows

This is the missing connector. It takes one or more Linear issue IDs, pulls full
context (title, description, acceptance criteria, priority, comments), and routes
the user into the appropriate workflow:

- **Single issue, small scope**: directly into `/workflows:plan`
- **Single issue, large scope**: into `/workflows:plan` then suggest
  `/gt-stack-plan`
- **Multiple issues**: into `/gt-stack-plan` with issue contexts bundled

The command pre-populates the plan template with Linear context so the user does
not have to copy-paste issue descriptions manually.

### 6. Post-triage and post-cycle-plan "What Next?" step

Both `/linear:triage` and `/linear:plan-cycle` gain a final step that presents
actionable next steps:

```
Cycle planned: 8 issues assigned to Sprint 24

What would you like to do next?
1. Start working on an issue        (/linear:work <issue-id>)
2. Delegate an issue to Devin       (/linear:delegate <issue-id>)
3. Plan the full cycle as a stack   (/linear:work <issue-1> <issue-2> ...)
4. Done for now
```

This closes the gap where triage/planning ends in a dead-end with no suggested
next action.

## Open Questions

1. **Should `/linear:work` accept issue IDs or cycle names?** If it accepts a
   cycle name, it could pull all issues from that cycle and let the user select
   which to plan. If it only accepts issue IDs, the user needs to remember or
   copy them from the previous command's output.

2. **How should `/gt-stack-plan` store the Linear issue mapping?** Options
   include a metadata section in the plan file, a separate mapping file, or
   embedding issue IDs in branch names (e.g., `feat/eng-123-add-auth`). Branch
   naming is the simplest but limits flexibility for many-to-one mappings.

3. **Should `/linear:sync` be enhanced or replaced?** Currently it handles
   one-off PR-to-issue linking. With automatic status transitions built into the
   submit flow, `/linear:sync` might become redundant for the common case. It
   could remain useful for manual corrections or initial linking of existing
   branches.

4. **What happens when a stacked PR is revised after review?** If Graphite
   restacks and force-pushes, should the system re-notify Linear? The current
   proposal only triggers Linear updates on initial submit and final merge, but
   review cycles may warrant intermediate status updates.

5. **Cross-plugin dependency management.** The connectors assume yellow-linear,
   yellow-core (workflows), and yellow-gt-workflow are all installed. What is the
   graceful degradation story when one is missing? Each connector should check
   for the target command's availability and suggest installation if absent,
   rather than failing silently.
