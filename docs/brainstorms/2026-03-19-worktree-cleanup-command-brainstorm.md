# Brainstorm: Worktree Cleanup Command

**Date:** 2026-03-19
**Status:** Complete -- ready for planning
**Chosen approach:** A -- `/worktree:cleanup` in yellow-core + Skill call from `/gt-cleanup`

---

## What We're Building

A `/worktree:cleanup` command in the `yellow-core` plugin that scans all git worktrees associated with the current repository, evaluates each worktree's staleness using local git state enriched with GitHub API data, and removes stale worktrees with appropriate safeguards. The `/gt-cleanup` command in `gt-workflow` gains a new Phase 6 that offers to trigger worktree cleanup via the `Skill` tool, keeping the two plugins loosely coupled.

### Scope

- **Scan target**: All git worktrees reported by `git worktree list`, not limited to a `.worktrees/` directory convention. This covers worktrees created by any tool (Devin, manual `git worktree add`, etc.).
- **Evaluation model**: Claude reads per-worktree state (branch name, uncommitted changes, unpushed commits, merge status on GitHub) and produces a per-worktree recommendation: remove, keep, or prompt user.
- **Removal behavior**: Auto-remove worktrees that are clearly stale (branch merged, no uncommitted changes, no unpushed commits). Prompt the user for ambiguous cases. Warn and require explicit confirmation for worktrees with uncommitted or unpushed changes.
- **Detection strategy**: Local git state first (`git status`, `git log @{u}..HEAD`), then enrich with GitHub API (`gh pr view`) only when needed to determine merge status. This avoids unnecessary API calls and works offline for obvious cases.

---

## Why This Approach

### Approach A (chosen): Thin command in yellow-core + Skill delegation from gt-cleanup

The worktree cleanup logic lives as a standalone `/worktree:cleanup` command in `yellow-core`, making it usable independently of any Graphite workflow. The existing `/gt-cleanup` command in `gt-workflow` adds a Phase 6 at the end of its branch-cleanup flow that offers to invoke `/worktree:cleanup` via the `Skill` tool. This keeps the two plugins decoupled -- `gt-cleanup` works fine if `yellow-core` is not installed (it simply does not offer Phase 6), and `/worktree:cleanup` works fine without Graphite.

**Pros:**
- Single responsibility: worktree logic is self-contained in one command
- Reusable outside the Graphite workflow (any user can run `/worktree:cleanup` directly)
- Follows the established cross-plugin composition pattern via `Skill` tool (see MEMORY.md)
- Graceful degradation in both directions: neither plugin hard-depends on the other

**Cons:**
- Two files to maintain instead of one monolithic command
- Skill call adds a small amount of indirection

**Best when:** The feature has value as a standalone tool and the source plugin already has a natural integration point (which `/gt-cleanup` does).

### Approach B (rejected): Inline worktree cleanup directly in /gt-cleanup

All worktree logic added directly to the gt-cleanup command file as a new phase.

**Pros:**
- Single file, no cross-plugin coordination
- Simpler implementation

**Cons:**
- Ties worktree cleanup to Graphite -- unusable without gt-workflow
- Bloats an already complex command (5 existing phases)
- Violates plugin boundary: worktree management is not Graphite-specific

### Approach C (rejected): Standalone plugin for worktree management

A new `yellow-worktree` plugin dedicated to worktree lifecycle management.

**Pros:**
- Clean separation, room to grow

**Cons:**
- Excessive for a single command -- YAGNI
- New plugin overhead (plugin.json, marketplace entry, release pipeline)
- Can always extract later if scope grows

---

## Key Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Scan ALL git worktrees (`git worktree list`), not just `.worktrees/` | Worktrees can be created anywhere by any tool; convention-based scanning misses manually created ones |
| 2 | Claude evaluates each worktree and makes per-worktree recommendations | Heuristic rules alone cannot cover all edge cases (e.g., worktree for a long-running experiment); LLM judgment fills the gap |
| 3 | `/worktree:cleanup` lives in yellow-core | Worktree management is a general git concern, not Graphite-specific; yellow-core is the natural home |
| 4 | `/gt-cleanup` adds Phase 6 via Skill tool | Follows cross-plugin composition convention; keeps plugins decoupled with graceful degradation |
| 5 | Auto-remove for clear cases, prompt for ambiguous | Clear = branch merged + no uncommitted + no unpushed. Ambiguous = unmerged branch but stale, or merged but has local-only changes |
| 6 | Warn and confirm for worktrees with uncommitted/unpushed changes | Destructive action on work-in-progress requires explicit user consent; never silently discard uncommitted work |
| 7 | Local git state first, GitHub API enrichment second | Minimizes API calls; `git log @{u}..HEAD` and `git status` are instant and sufficient for many decisions |
| 8 | Approach A selected over B and C | Best balance of reusability, simplicity, and plugin architecture conventions |

---

## Open Questions

1. **Worktree path display**: Should the command show absolute paths or paths relative to the main worktree? Absolute is unambiguous but verbose.
2. **Batch removal UX**: When multiple worktrees are flagged for removal, should the command offer "remove all safe ones at once" or require per-worktree confirmation? Likely batch with opt-out per the batch cap convention (MEMORY.md).
3. **Pruning `git worktree prune`**: After removing worktree directories, should the command also run `git worktree prune` to clean up stale admin entries, or leave that to the user?
4. **Devin-created worktrees**: Devin creates worktrees in `/tmp` or similar ephemeral paths that may already be gone. The command should handle "worktree directory does not exist" gracefully (offer to prune the stale reference).
