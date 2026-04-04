# Brainstorm: Branch Cleanup and Divergence Reconciliation

**Date:** 2026-03-16
**Plugin:** gt-workflow
**Command:** `/gt-cleanup`
**Approach:** Detect-and-Report with Category Actions

## What We're Building

A new `/gt-cleanup` command in the gt-workflow plugin that performs two jobs:

1. **Stale branch cleanup** -- identify and delete local branches that are no
   longer needed (orphaned with no remote tracking, associated with closed PRs,
   or aged out beyond a staleness threshold).

2. **Bidirectional divergence reconciliation** -- detect branches where local
   and remote have diverged, treating Graphite as the source of truth. Branches
   behind remote get synced via `gt get`. Branches ahead of remote get flagged
   with a pointer to `/smart-submit` (warn only, no push).

The command produces a categorized report of all branches, then walks through
each non-empty category with an AskUserQuestion confirmation offering cleanup,
skip, or per-branch review.

### Branch Categories

| Category | Detection Method | Action |
|---|---|---|
| Orphaned (no remote) | `git for-each-ref` with no upstream | `gt delete` |
| Closed PR | `gh pr list --search "head:BRANCH" --json state` | `gt delete` |
| Stale by age | Last commit older than threshold (e.g., 30 days) | `gt delete` |
| Behind remote | `git rev-list --count HEAD..@{u}` > 0 | `gt get` |
| Ahead of remote | `git rev-list --count @{u}..HEAD` > 0 | Warn only + pointer to `/smart-submit` |

### Relationship to `/gt-sync`

This command is standalone with no overlap. `/gt-sync` owns merged branch
cleanup via `gt repo sync`. `/gt-cleanup` owns stale, orphaned, and diverged
branches. They are complementary -- a typical maintenance session might run
`/gt-sync` first (to clean merged branches and restack), then `/gt-cleanup`
(to handle everything else).

## Why This Approach

**Detect-and-Report with Category Actions** was chosen over two alternatives:

- **Pure Audit Report** (rejected): Produces a report but requires manual
  follow-up with 5-10 separate commands. Adds a step instead of removing one.
  The command's value is reducing friction, not just providing information.

- **Full Bidirectional Auto-Fix** (rejected): Would also push ahead-of-remote
  branches via `gt submit`, but this blurs the line between cleanup and
  development. Pushing code is a forward workflow action that should go through
  `/smart-submit` (which runs code audit agents) or manual `gt submit`. A
  cleanup command that also pushes unreviewed code is a safety risk.

The chosen approach provides actionable cleanup for safe categories (delete
stale, sync behind-remote) while respecting separation of concerns for unsafe
categories (ahead-of-remote = warn only). This keeps the command's identity
clear: it is a hygiene tool, not a submission tool.

**Behind-remote sync is safe** because it pulls from the source of truth
(Graphite/remote). The user's intent in running a cleanup command is to align
local state with reality.

**Ahead-of-remote warning is valuable** even without auto-fix because it
surfaces forgotten WIP branches ("you have 3 branches with unpushed work")
that the user may not realize exist.

## Key Decisions

### 1. Category-based confirmation over per-branch or single-confirm

Each non-empty category gets its own AskUserQuestion with options:

- "Clean up N branches" (batch action)
- "Review individually" (per-branch confirmation)
- "Skip this category"

This balances safety with efficiency. Orphaned branches with no remote are
almost always safe to delete in batch. Diverged branches may need individual
review.

### 2. Warn-only for ahead-of-remote branches

Pushing code belongs in `/smart-submit` or `gt submit`. The cleanup command
flags these branches as a reminder but does not offer to push. This avoids:

- Bypassing the audit agents in `/smart-submit`
- Accidentally pushing WIP, debug code, or experiments
- Overlapping with `/smart-submit`'s submission responsibility

### 3. Standalone command, not an extension of `/gt-sync`

`/gt-sync` and `/gt-cleanup` have different purposes:

- `/gt-sync` = sync trunk + restack + clean merged (routine, frequent)
- `/gt-cleanup` = audit all branches + delete stale + reconcile diverged (periodic, thorough)

Keeping them separate avoids making `/gt-sync` more complex and lets each
command have a clear mental model.

### 4. `gt delete` over `git branch -D`

Using `gt delete` ensures Graphite metadata is cleaned up alongside the Git
branch. It also restacks any children onto the parent branch, which is important
for maintaining stack integrity.

### 5. `gt get` for behind-remote reconciliation

`gt get` is Graphite's native command for syncing from remote. It handles
conflict resolution interactively and respects the stack structure. Using raw
`git fetch`/`git reset` would bypass Graphite's metadata tracking.

### 6. `gh` API for PR status, not Graphite API

PR status (open/closed/merged) is checked via `gh pr list --search "head:BRANCH"`
which is the established pattern across yellow-review, yellow-devin, and
yellow-linear plugins. This avoids introducing a new API dependency.

### 7. Tools required

- `Bash` -- git/gt/gh commands for branch inspection and cleanup
- `AskUserQuestion` -- category-based confirmation flow
- `Read` -- not needed (no file reading)
- No `Task` or agents -- this is a single-command flow, not a multi-agent operation

## Open Questions

1. **Staleness threshold**: What age cutoff for "stale by age"? 30 days is a
   reasonable default. Should this be configurable via a flag (e.g.,
   `--stale-days 60`) or hardcoded for the first iteration?

2. **Remote pruning**: Should the command also run `git remote prune origin`
   to clean up local references to deleted remote branches? This is a
   lightweight, safe operation that complements the local cleanup.

3. **Protected branches**: Should trunk and any currently checked-out branch
   be automatically excluded from all categories? (Almost certainly yes, but
   worth confirming during planning.)

4. **Fetch before scan**: Should the command run `git fetch --prune` at the
   start to ensure the local view of remote branches is current? Without this,
   the behind/ahead detection could be based on stale remote-tracking refs.

5. **Graphite-tracked vs untracked branches**: Should the command handle
   branches that are not tracked by Graphite (e.g., branches created with raw
   `git checkout -b`)? If so, should it offer to `gt track` them or just
   flag them?

6. **Interaction with `/gt-sync`**: Should the command suggest running
   `/gt-sync` first if it detects merged branches, or silently skip them?
   A brief note ("2 merged branches detected -- run `/gt-sync` to clean those")
   would be helpful without adding scope.
