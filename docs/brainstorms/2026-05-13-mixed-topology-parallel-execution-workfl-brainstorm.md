# Brainstorm: Mixed-Topology Parallel Execution in `/workflows:work`

**Date:** 2026-05-13
**Topic:** Enabling `/workflows:work` to execute mixed/parallel stack topologies produced by `/gt-stack-plan`, parallelizing independent branches where safe and efficient.

---

## What We're Building

Right now `/workflows:work` has three broken states for non-linear stacks:

1. **`mixed` topology** — hard stops with "not yet supported" (Phase 1b, step 1, line 204 of `work.md`)
2. **`parallel` topology** — executes branches sequentially in a for-loop despite the topology label; no actual concurrency
3. **`linear` topology** — works correctly; each branch stacks on the previous

The goal: replace the topology-specific switch with a unified DAG scheduler that reads the `Depends on` field on every stack item, builds a dependency graph, computes execution tiers (topological sort), and runs all items in the same tier in parallel while respecting sequential ordering across tiers. This makes `mixed` the general case — `linear` and `parallel` become degenerate instances of the same model.

---

## Why This Approach

### Recommendation: Approach C — Tier-Based DAG Scheduling with Opt-In Worktree Parallelism

This is the right answer because it solves the stated problem (mixed topology fails) without incurring the full complexity cost of unconditional true parallelism upfront. The design is a two-layer model:

**Layer 1 (always-on):** Topological tier scheduling. Parse the `Depends on` graph, compute tiers, execute tiers sequentially. Within each tier, all items have their dependencies satisfied. This alone removes the `mixed` hard stop and correctly orders all topologies.

**Layer 2 (opt-in per tier):** Within-tier parallel execution via background `Task` subagents + git worktrees. When a tier has more than one item, offer the user a choice: "Execute these N items sequentially or in parallel?" Parallel execution uses the existing `run_in_background: true` + atomic result file pattern already proven in Phase 3 (review agents). Each branch gets its own `git worktree` via the existing `git-worktree` skill, providing index isolation so concurrent `gt create`/`gt modify` calls do not race.

**Why not Approach A (unconditional true parallelism)?** Parallel worktree agents race on the `## Stack Progress` section of the plan file — two agents completing at the same time both try to update the same markdown file. The file-ownership grouping doctrine from `parallel-todo-resolution-file-based-grouping.md` makes this explicit: one agent per file, never two. The plan file is not a per-branch file; it is shared. Solving this requires a lock or a merge step, adding complexity that is not needed for the default path.

**Why not Approach B (pure tier scheduling, always sequential within tiers)?** This correctly handles `mixed` topology and removes the hard stop, but it misses the user's stated goal: "parallelize when possible and efficient." A tier with 4 independent branches executes 4x slower than needed. Since the parallel infrastructure already exists in this codebase, not offering it as an opt-in is leaving performance on the table.

**Why Approach C is better than a hybrid that always parallels:** Opt-in per tier preserves user control. Some tiers contain large branches that each take significant implementation time — the user may want to supervise one at a time. Others contain small, mechanical branches (docs, lint, test fixtures) where parallel execution is clearly safe. The checkpoint already exists in Phase 1b step 7; the opt-in question slots in there naturally.

---

## Key Decisions

### 1. DAG representation and parsing

The `Depends on` field currently supports single-parent refs (`(none)` or `#N`). The format spec in `stack-decomposition.md` must be extended to allow comma-separated multi-parent refs (`#1, #3`) to support true DAG fan-in. The parser in `work.md` Phase 1b must:

- Read all `Depends on` values across all items
- Build an adjacency list: `item_number → [dependency_numbers]`
- Topological sort (Kahn's algorithm or DFS) to produce ordered tiers
- Validate: detect cycles (invalid plan) and report to user

This parsing is purely in the LLM's working memory — no new files or scripts needed.

### 2. Tier execution loop

Replace the current linear for-loop in Phase 1b with a tier loop:

```
For each tier (in topological order):
  If tier has 1 item: execute it (existing Phase 1b logic, no change)
  If tier has N > 1 items:
    Ask user: "Tier T has N independent items: [names]. Execute sequentially or in parallel?"
    Sequential: execute items one by one (existing logic)
    Parallel: spawn N background Task subagents, each running the single-item implementation loop
```

The checkpoint in Phase 1b step 7 fires after each tier (not after each item in parallel mode), with "all N items in tier T complete" as the message.

### 3. Progress tracking for parallel tiers

The `## Stack Progress` racing problem is solved by deferring all progress writes until the tier completes. The orchestrator (not the subagents) writes progress after all `TaskOutput` calls return for that tier. Subagents must not write to the plan file — they write only to their worktree files and git. This requires the subagent prompt to explicitly exclude plan file writes.

### 4. Worktree lifecycle

Each parallel branch in a tier:
1. Creates a worktree via `worktree-manager.sh create <branch-name>` from trunk (for parallel-from-trunk items) or from the parent branch (for items in a DAG with a shared ancestor)
2. Runs implementation entirely within that worktree directory
3. Commits and submits (`gt modify` + `gt submit`) from within the worktree
4. The orchestrator tears down the worktree after `TaskOutput` returns, whether the agent succeeded or failed

Teardown must be in a finally-equivalent path: if the orchestrator proceeds to Phase 2+ or the user stops at a checkpoint, all worktrees from the completed tier must be cleaned up. This prevents `/tmp`-style residue in `.worktrees/`.

### 5. Format extension: `Depends on` multi-parent

Current: `- **Depends on:** (none)` or `- **Depends on:** #2`
Extended: `- **Depends on:** (none)` or `- **Depends on:** #1` or `- **Depends on:** #1, #3`

`gt-stack-plan` must emit multi-parent refs when the design requires fan-in. The visual stack plan display (Phase 2, step 2 in `gt-stack-plan.md`) must also show multi-parent dependency lines.

### 6. Backward compatibility

Plans with no `## Stack Decomposition` section: zero change (existing single-branch path).
Plans with `linear` topology: tier sort produces one item per tier — zero behavioral change.
Plans with `parallel` topology (all `Depends on: (none)`): single tier with N items — offers sequential or parallel choice. Previously this was sequential anyway; the opt-in gives users parallelism for the first time.
Plans with `mixed` topology: removes the hard stop; computes tiers correctly.

### 7. The `stack-decomposition.md` format contract update

Both `gt-stack-plan` (producer) and `workflows:work` (consumer) share this contract. Any change to `Depends on` syntax requires updating both sides. The `topology` comment (`<!-- stack-topology: ... -->`) becomes advisory-only once the DAG scheduler is in place — the scheduler derives topology from the graph, not the comment. The comment remains for human readability.

---

## Research Justifications

**GitHub Actions `needs:` model (canonical reference):** The `needs:` field in GitHub Actions workflows is the direct analog of `Depends on`. Mixed topologies (some jobs parallel, some sequential) are the default case in Actions, not the exception. Jobs with no `needs:` start simultaneously; jobs with `needs:` wait for their dependencies. This is exactly what the tier scheduler produces. The model is battle-tested at massive scale and widely understood by developers.

**This codebase's parallel-agent doctrine:** `parallel-multi-agent-review-orchestration.md` and `parallel-todo-resolution-file-based-grouping.md` establish the file-ownership-grouping pattern as the proven safe approach. The key insight: agents can run in parallel if and only if they do not share output files. Git worktrees provide index isolation (each worktree has its own `.git` index lock) but the plan file is shared. Deferring plan file writes to the orchestrator resolves this.

**Phase 3 reviewer parallelism as the pattern template:** The existing `run_in_background: true` + `mktemp -d` run dir + atomic `.tmp`→`.json` rename + `TaskOutput` pattern in Phase 3 is already working parallel-agent coordination in this codebase. The stack branch executor pattern is the same shape: N background agents, each writing to disjoint paths (their own worktrees), orchestrator waits for all before proceeding.

**Build system topology (Make/Ninja):** The topological-sort-then-run-available model from build systems is the gold standard for dependency-aware parallelism. Targets with no unsatisfied dependencies run immediately; others wait. This is what the tier loop implements. The `-j N` analogy is the opt-in parallelism question — the user sets their own "job count" by choosing sequential vs parallel per tier.

**LangGraph/CrewAI parallel task groups:** Both frameworks use explicit fork/join semantics for parallel branches — you declare parallel task groups and they join before the next sequential step. The tier model is equivalent: each tier is a join point. This confirms the tier approach is the current best practice in agentic workflow frameworks as of mid-2026.

**git worktree index isolation:** Each worktree has its own `.git/index` file, preventing the `index.lock` races that would occur if two agents tried to stage changes in the same working tree simultaneously. This is the technical reason worktrees are the right isolation primitive for parallel branch implementation.

---

## Open Questions

1. **Should `gt-stack-plan` auto-detect parallelizable items and suggest a mixed topology?** Currently it mostly produces linear stacks. The DAG model is only useful if the producer emits non-trivial dependency graphs. This may be a producer-side change that should happen first.

2. **What is the max safe parallelism for a tier?** Four parallel review agents is proven. Six parallel agents (from `parallel-todo-resolution-file-based-grouping.md`) is also proven. For stack branch execution, each agent runs a full implementation loop (potentially minutes of context). Context window pressure across N simultaneous sessions may become a constraint at N > 4–6. The opt-in question should surface this: "Execute in parallel (up to N branches simultaneously)?"

3. **Should the new `stack-branch-executor` be a named subagent in yellow-core?** The parallel path requires a subagent that runs a single-branch implementation loop. Currently no such agent exists — the logic lives inline in `work.md`. Extracting it as `yellow-core:workflow:stack-branch-executor` would make the command cleaner but adds a new agent file to maintain. YAGNI says no for v1; inline first, extract later if the command file grows unwieldy.

4. **Worktree cleanup on user cancel at a tier checkpoint:** If the user selects "Stop here" at a tier checkpoint while parallel agents are still running (or just completed), the orchestrator must tear down all worktrees for that tier. The current checkpoint question fires after all agents complete — but if an agent hangs, the orchestrator is blocked. Should there be a timeout on `TaskOutput`?

5. **`Depends on` multi-parent format change: is this a breaking change?** Plans already written with single-parent `Depends on` fields remain valid. The parser can support both formats. But `gt-stack-plan` would need to start emitting multi-parent refs for real DAGs — this is a producer-side change that requires a version bump per the Changesets flow.

---

## Approach Comparison (for reference)

### Approach A: Unconditional Worktree Parallelism
Every tier with N > 1 items always runs N agents in parallel via worktrees. No opt-in question.

**Pros:** Maximum parallelism, simplest decision flow.
**Cons:** Racing `## Stack Progress` writes unless orchestrator defers all writes (still needed). No user control over parallelism level. Context window pressure scales with tier width. Worktree teardown on failure is mandatory, not optional.
**Best when:** All stack items are small, mechanical, and well-scoped; user has explicitly opted into full automation.

### Approach B: Pure Tier Scheduling, Sequential Within Tiers
Topological sort only. Tiers execute in order; within each tier, items execute sequentially. No worktrees, no background tasks.

**Pros:** Removes the `mixed` hard stop. Zero new infrastructure. Progress tracking is trivially correct. Fully resumable.
**Cons:** Misses the "parallelize when possible" goal. A tier with 4 independent branches takes 4x longer than needed.
**Best when:** First-pass fix to unblock `mixed` topology before the parallel path is ready. Could ship as v1 while Approach C is built.

### Approach C: Tier Scheduling + Opt-In Worktree Parallelism (Recommended)
Tier scheduler is always-on. Within multi-item tiers, user chooses sequential or parallel. Parallel uses `run_in_background: true` + worktrees.

**Pros:** Solves `mixed` hard stop. Parallelizes when the user wants it. Reuses proven infrastructure (Phase 3 pattern, git-worktree skill). User controls parallelism level.
**Cons:** More implementation surface than Approach B. Worktree lifecycle management (create + teardown) must be bulletproof.
**Best when:** This is the right default for a production workflow command. Build Approach B first as a stepping stone if schedule pressure exists.
