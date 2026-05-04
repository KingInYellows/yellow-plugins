# Feature: `/gt-cleanup` — Branch Cleanup and Divergence Reconciliation

> **Status: Implemented** — This plan has been implemented. Retained for historical context.

## Problem Statement

Over time, local git branches accumulate: orphaned branches with no remote,
branches tied to closed/abandoned PRs, stale work older than 30 days, and
branches that have diverged from remote (behind or ahead). Today there is no
single command that audits all local branches, categorizes their state, and
offers batch cleanup. `/gt-sync` only handles merged branches via
`gt repo sync`. Everything else requires manual `git branch -vv` inspection and
per-branch cleanup.

**Who benefits:** Any developer using Graphite-based workflows who accumulates
branches over time.

**Source brainstorm:**
`docs/brainstorms/2026-03-16-branch-cleanup-and-divergence-reconcilia-brainstorm.md`

## Current State

- `/gt-sync` calls `gt repo sync` — cleans merged branches, restacks, syncs trunk
- No command handles stale, orphaned, or diverged branches
- Neither `gt delete` nor `gt get` are used in any existing gt-workflow command
- PR status checking via `gh pr list --search "head:BRANCH" --json state` is
  well-established across yellow-review, yellow-devin, yellow-linear

## Proposed Solution

A new `/gt-cleanup` command in the gt-workflow plugin that:

1. Fetches latest remote state (`git fetch --prune`)
2. Scans all local branches and classifies them into 6 categories
3. Presents a categorized report
4. Walks through each non-empty category with AskUserQuestion confirmation
5. Executes cleanup actions (delete, sync, or warn)
6. Outputs a summary report

### Branch Categories (priority order for dedup)

| # | Category | Detection | Action |
|---|----------|-----------|--------|
| 1 | Orphaned (no remote) | `%(upstream)` empty in `git for-each-ref` | `gt delete` |
| 2 | Closed/abandoned PR | `gh pr list --search "head:BRANCH" --json state` all closed/merged | `gt delete` |
| 3 | Stale by age | Author date > 30 days AND no open PR | `gt delete` |
| 4 | Diverged (ahead AND behind) | Both ahead and behind counts > 0 | Warn only |
| 5 | Behind remote | Behind count > 0, ahead = 0 | `gt get` |
| 6 | Ahead of remote | Ahead count > 0, behind = 0 | Warn only → `/smart-submit` |

**Category dedup rule:** Process in priority order. Once a branch is claimed by a
category (acted upon or skipped), remove it from subsequent categories.

### Key Design Decisions

- **Warn-only for ahead-of-remote and diverged**: Pushing is a development
  action, not cleanup. Belongs in `/smart-submit`.
- **`gt delete` over `git branch -D`**: Preserves Graphite metadata, restacks
  children.
- **`gt get` for behind-remote**: Respects Graphite stack structure.
- **Author date for staleness**: Reflects when work was done, not last rebase.
- **Stale excludes open PRs**: A 45-day-old branch with an active PR review is
  not stale.

## Implementation Plan

### Phase 1: Command File

- [x] 1.1: Create `plugins/gt-workflow/commands/gt-cleanup.md`
- [x] 1.2: Frontmatter:
  ```yaml
  ---
  name: gt-cleanup
  description: 'Scan local branches for staleness and divergence, then clean up or reconcile'
  argument-hint: '[--stale-days N | --dry-run]'
  allowed-tools:
    - Bash
    - AskUserQuestion
  ---
  ```
- [x] 1.3: Document optional flags with explicit bash parsing:
  - `--stale-days N` — override 30-day default (bash `case` block, not prose)
  - `--dry-run` — scan and report only, no actions

### Phase 2: Prerequisites (command body)

- [x] 2.1: Phase 0 in the command: validate `gt`, `gh`, `git` available
- [x] 2.2: Confirm `gh auth status` succeeds (needed for PR status lookups)
- [x] 2.3: Confirm inside a git work tree (`git rev-parse --is-inside-work-tree`)
- [x] 2.4: Identify trunk branch (`gt trunk`) and current branch (`git branch --show-current`)
- [x] 2.5: All prerequisite checks BEFORE any AskUserQuestion (per defensive
  authoring pattern: validation before interaction)

### Phase 3: Branch Scan Logic

- [x] 3.1: Run `git fetch --prune` to ensure remote-tracking refs are current
- [x] 3.2: Enumerate all local branches excluding trunk and current branch:
  ```bash
  git for-each-ref --format='%(refname:short) %(upstream) %(upstream:track) %(authordate:unix)' refs/heads/
  ```
- [x] 3.3: Parse into data structure with: branch name, upstream ref, track
  status (`[gone]`, `[ahead N]`, `[behind N]`, `[ahead N, behind M]`), author
  date unix timestamp
- [x] 3.4: Classify into categories using priority order (1-6). Once classified,
  a branch does not appear in subsequent categories.
- [x] 3.5: For category 2 (closed PR), batch PR status lookups:
  - For each branch with a remote upstream, check
    `gh pr list --search "head:BRANCH" --json state --limit 10`
  - If ANY PR is `OPEN`, exclude from closed-PR category entirely
  - Add progress indicator if > 20 branches ("Checking PR status 12/47...")
  - Do NOT suppress stderr on `gh pr list` (anti-pattern #13)
- [x] 3.6: For category 3 (stale), cross-reference PR state: exclude branches
  with any open PR
- [x] 3.7: For category 1 (orphaned), check for unique commits:
  `git log --oneline $(gt trunk)..BRANCH | wc -l` — if > 0, flag as
  "has N unique commits" for the review-individually flow

### Phase 4: Report and Category Actions

- [x] 4.1: Display the full categorized report before any actions:
  ```
  Branch Audit
  ────────────
  Orphaned (no remote):     3 branches
  Closed PR:                2 branches
  Stale (>30 days):         1 branch
  Diverged (ahead+behind):  1 branch (warn only)
  Behind remote:            2 branches
  Ahead of remote:          3 branches (warn only)
  Clean:                    5 branches
  ────────────────────────────
  Total:                    17 branches (excl. trunk + current)
  ```
- [x] 4.2: If `--dry-run`, stop here. Print "Dry run — no actions taken."
- [x] 4.3: If all categories empty, print "Nothing to clean up." and exit.
- [x] 4.4: If merged branches detected during scan (upstream `[gone]` + merged
  into trunk), print: "Note: N merged branches detected. Run `/gt-sync` to
  clean those."
- [x] 4.5: Walk through each non-empty actionable category (1, 2, 3, 5) with
  AskUserQuestion:
  ```
  Category: Orphaned (no remote) — 3 branches
    fix/old-experiment (12 unique commits)
    chore/temp-debug (0 unique commits)
    test/spike-auth (3 unique commits)

  Options:
  1. Delete all 3 branches (gt delete)
  2. Review individually
  3. Skip this category
  ```
- [x] 4.6: For "Review individually", apply batch cap of 15 branches. If count
  exceeds 15, offer "Process all / First 15 only / Cancel". Show per branch:
  name, last commit date, last commit message (one line), unique commit count,
  PR status if applicable.
- [x] 4.7: For warn-only categories (4, 6), display without AskUserQuestion:
  ```
  Ahead of remote (3 branches — no action, use /smart-submit to push):
    feat/wip-auth (3 commits ahead)
    feat/experiment (1 commit ahead)
    fix/local-only (2 commits ahead)
  ```
- [x] 4.8: For behind-remote (category 5) actions via `gt get`:
  - If current branch has uncommitted changes (`git status --porcelain`), skip
    sync for current branch with note "skipped (uncommitted changes)"
  - Wrap each `gt get BRANCH` in error handling
  - If `gt get` fails (conflicts or other), log error, skip branch, continue

### Phase 5: Error Handling

- [x] 5.1: `gt delete` failure: log branch name + error, skip, continue with
  remaining branches. Include in summary as "failed".
- [x] 5.2: `gt delete` on non-Graphite branch: if error contains "not tracked",
  fall back to `git branch -d BRANCH` (lowercase -d, safe delete that refuses
  if unmerged). If that also fails, skip and report.
- [x] 5.3: `gt get` conflict: check exit code, report "sync failed — conflicts"
  for that branch, skip and continue with remaining categories.
- [x] 5.4: `gh pr list` failure mid-scan: report error, skip PR-status-dependent
  categories (2 and 3 may be incomplete), warn user.
- [x] 5.5: All branch names must be properly quoted in all bash invocations
  (handle spaces, special chars).

### Phase 6: Summary Report

- [x] 6.1: Output final summary:
  ```
  Cleanup Complete
  ────────────────
  Deleted:      3 branches (2 orphaned, 1 closed PR)
  Synced:       1 branch (behind remote)
  Warnings:     4 branches (1 diverged, 3 ahead of remote)
  Skipped:      2 branches (user choice)
  Failed:       0

  Deleted:  fix/old-experiment, chore/temp-debug, feat/abandoned-pr
  Synced:   feat/active-feature
  Ahead:    feat/wip-auth (3 commits) → run /smart-submit
  Diverged: feat/rebased-remote (2 ahead, 5 behind) → investigate manually
  ```

### Phase 7: Registration

- [x] 7.1: Update `plugins/gt-workflow/CLAUDE.md` — add `/gt-cleanup` to
  commands list
- [x] 7.2: Update `plugins/gt-workflow/README.md` — add command documentation
- [x] 7.3: Run `pnpm changeset` — minor bump for gt-workflow (new command)
- [x] 7.4: Run `pnpm validate:schemas` to verify

## Technical Details

### Files to Create

- `plugins/gt-workflow/commands/gt-cleanup.md` — the command file

### Files to Modify

- `plugins/gt-workflow/CLAUDE.md` — add command to list
- `plugins/gt-workflow/README.md` — add command documentation

### Dependencies

- `gt` CLI (already a plugin dependency)
- `gh` CLI (already used across the ecosystem)
- No new dependencies

## Edge Cases

| Edge Case | Handling |
|-----------|----------|
| Branch in multiple categories | Priority-order dedup: first category claims it |
| Diverged (ahead AND behind) | Separate category #4, warn-only |
| Stale branch with open PR | Excluded from stale category |
| Orphaned with unique commits | Flagged in report, shown in review-individually |
| `gt delete` on non-Graphite branch | Fallback to `git branch -d` |
| `gt get` hits merge conflict | Skip branch, report, continue |
| Current branch qualifies for deletion | Auto-excluded, noted in summary |
| Detached HEAD state | Use `git rev-parse HEAD` for exclusion, warn user |
| 100+ branches (scale) | Progress indicator for PR lookups, batch cap for review |
| Branch name with special chars | All names quoted in bash invocations |
| Multiple PRs for same branch | If ANY is OPEN, exclude from closed-PR category |
| No network (gh fails) | Report error, skip PR-dependent categories, warn |

## Acceptance Criteria

1. `/gt-cleanup` scans all local branches and classifies into 6 categories
2. Trunk and current branch are auto-excluded from all categories
3. `--dry-run` shows report without executing any actions
4. `--stale-days N` overrides the 30-day default
5. Category-based AskUserQuestion with batch/individual/skip options
6. `gt delete` used for deletions (falls back to `git branch -d` for untracked)
7. `gt get` used for behind-remote sync with conflict handling
8. Ahead-of-remote and diverged branches get warn-only treatment
9. Summary report matches the established gt-workflow format
10. `pnpm validate:schemas` passes
11. Prerequisite validation runs before any interactive prompts

## References

- Brainstorm: `docs/brainstorms/2026-03-16-branch-cleanup-and-divergence-reconcilia-brainstorm.md`
- Pattern source: `plugins/gt-workflow/commands/gt-sync.md` (summary format, error handling)
- Pattern source: `plugins/gt-workflow/commands/gt-nav.md` (AskUserQuestion flow)
- PR status pattern: `plugins/yellow-linear/commands/linear/sync-all.md` line 79
- Anti-patterns: `docs/solutions/code-quality/claude-code-command-authoring-anti-patterns.md`
- Defensive patterns: `docs/solutions/code-quality/plugin-review-defensive-authoring-patterns.md`
- Plugin CLAUDE.md: `plugins/gt-workflow/CLAUDE.md`
