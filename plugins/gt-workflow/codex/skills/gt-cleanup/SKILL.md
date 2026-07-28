---
name: gt-cleanup
description: Scan local branches for staleness and divergence, then delete or reconcile them with safeguards. Use when user says "clean up my branches" or "which branches are stale". For deleting branches whose PRs merged — and for pulling trunk or restacking — use the gt-sync skill.
---

## What It Does

Scans all local branches, classifies them by state (orphaned, closed PR,
stale, diverged, behind remote, ahead of remote), and offers category-based
cleanup actions. Complements the `gt-sync` skill, which handles merged
branches.

## When to Use

- User says "clean up my branches" or "which branches are stale".
- For deleting branches whose PRs merged — and for pulling trunk or
  restacking — use the `gt-sync` skill instead.

## Usage

Optional arguments:

- `--stale-days N` — Override the default 30-day staleness threshold
- `--dry-run` — Show the audit report without executing any cleanup actions

The argument text provided after the skill name (if any) is available as
context for this invocation.

### Phase 1: Prerequisites

Run all checks **before** any AskUserQuestion. Exit early with actionable
messages if any fail.

#### 1. Parse Flags

```bash
DRY_RUN=false
STALE_DAYS=30

# Populate args_copy by splitting the argument text provided after the
# skill name on whitespace (e.g., args_copy=(--dry-run --stale-days 14)).
args_copy=(...)
i=0
while [ $i -lt ${#args_copy[@]} ]; do
  arg="${args_copy[$i]}"
  case "$arg" in
    --dry-run)
      DRY_RUN=true
      i=$((i + 1))
      ;;
    --stale-days)
      i=$((i + 1))
      # Guard: next arg must exist and not be another flag
      if [ $i -lt ${#args_copy[@]} ] && ! [[ "${args_copy[$i]}" =~ ^-- ]]; then
        STALE_DAYS="${args_copy[$i]}"
        i=$((i + 1))
      else
        echo "ERROR: --stale-days requires a value (e.g., --stale-days 60)"
        exit 1
      fi
      ;;
    --stale-days=*)
      STALE_DAYS="${arg#*=}"
      i=$((i + 1))
      ;;
    *)
      i=$((i + 1))
      ;;
  esac
done

# Validate --stale-days is a positive integer (>= 1)
if ! [[ "$STALE_DAYS" =~ ^[1-9][0-9]*$ ]]; then
  echo "ERROR: --stale-days requires a positive integer (>= 1), got '$STALE_DAYS'"
  exit 1
fi
```

#### 2. Validate Tools

```bash
command -v gt >/dev/null 2>&1 || { echo "ERROR: gt CLI not found. Install from https://graphite.dev/docs/graphite-cli"; exit 1; }
command -v gh >/dev/null 2>&1 || { echo "ERROR: gh CLI not found. Install from https://cli.github.com"; exit 1; }
command -v git >/dev/null 2>&1 || { echo "ERROR: git not found"; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "ERROR: jq not found. Install from https://jqlang.github.io/jq/"; exit 1; }
```

#### 3. Validate Git Repo

```bash
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "ERROR: Not inside a git repository"; exit 1; }
```

#### 4. Validate GitHub Auth

```bash
gh auth status >/dev/null 2>&1 || { echo "ERROR: gh is not authenticated. Run 'gh auth login' first"; exit 1; }
```

#### 5. Identify Trunk and Current Branch

```bash
TRUNK=$(gt trunk 2>/dev/null)
if [ -z "$TRUNK" ]; then
  echo "ERROR: Could not determine trunk branch. Ensure this is a Graphite-managed repository (run 'gt init')."
  exit 1
fi
CURRENT=$(git branch --show-current 2>/dev/null || echo "")
```

If `CURRENT` is empty (detached HEAD), warn the user: "You are in detached HEAD
state. The cleanup will proceed but cannot exclude a current branch." Set
`CURRENT` to an empty string for exclusion logic.

### Phase 2: Fetch and Scan

#### 1. Fetch Latest Remote State

```bash
echo "Fetching latest remote state..."
git fetch --prune
```

#### 2. Enumerate Local Branches

```bash
git for-each-ref \
  --format='%(refname:short)|%(upstream)|%(upstream:track)|%(committerdate:unix)' \
  refs/heads/
```

Parse each line into fields: `branch_name`, `upstream_ref`, `track_status`,
`committer_date_unix`. Committer date is used (not author date) because
Graphite workflows involve frequent restacking which updates the committer date
but preserves the author date. Using author date would falsely flag recently
restacked branches as stale.

**Exclude** trunk (`$TRUNK`) and current branch (`$CURRENT`) from all
processing. These are never candidates for cleanup.

#### 3. Initial Classification

For each branch (after excluding trunk and current), classify based on git
state:

1. **No upstream** (`upstream_ref` is empty): candidate for **Orphaned**
   category.
2. **Track status contains `[gone]`**: the remote branch was deleted. This is
   likely a merged branch — count it separately for the `gt-sync` skill hint
   but do NOT add to any cleanup category (merged branches are the `gt-sync`
   skill's responsibility).
3. **Track status contains `ahead` AND `behind`** (e.g., `[ahead 2, behind 3]`):
   **Diverged** category.
4. **Track status contains only `behind`** (e.g., `[behind 5]`): **Behind
   remote** category.
5. **Track status contains only `ahead`** (e.g., `[ahead 3]`): candidate for
   **Ahead of remote** category.
6. **Track status is empty** (up to date with upstream): candidate for
   **Stale by age** check (if old enough) or **Clean**.

#### 4. PR Status Lookups

For branches that have an upstream **and** whose track status does NOT
contain `[gone]`, PR status determines **Closed PR** membership and
excludes open-PR branches from **Stale**. Read the file
`references/pr-status-lookups.md` located in this skill's directory
(sibling to this SKILL.md) for the full lookup procedure — the `[gone]`
skip rationale, repo capture, the `gh pr list` + jq pipeline, rate-limit
handling, and the `HAS_OPEN` / `ALL_TERMINAL` / `CLOSED_NOT_MERGED`
classification rules — before classifying any branch that needs PR data.

#### 5. Staleness Check

For branches not already classified in a higher-priority category, check
committer date:

```bash
NOW=$(date +%s)
AGE_DAYS=$(( (NOW - COMMITTER_DATE_UNIX) / 86400 ))
```

If `AGE_DAYS > STALE_DAYS` AND the branch has no open PR: classify as **Stale
by age**.

#### 6. Unique Commit Check (All Deletion Categories)

For each branch in a deletion-eligible category (orphaned, closed PR, stale),
count unique commits not on trunk:

```bash
git log --oneline "$TRUNK..$BRANCH_NAME" 2>/dev/null | wc -l
```

Store the count per branch. It is used for:
- Data-loss warnings in the "Delete all" batch prompt
- Per-branch detail in the "Review individually" flow

#### 7. Category Dedup

A branch may initially match multiple categories from the steps above (e.g., a
branch with no upstream could also be stale by age). The dedup resolves this by
assigning each branch to its highest-priority match only.

Process in priority order:

1. Orphaned (no remote)
2. Closed PR
3. Stale by age
4. Diverged (ahead + behind)
5. Behind remote
6. Ahead of remote

Once a branch is assigned to a category, skip it for all subsequent categories.
Branches that match none of these are **Clean**.

### Phase 3: Report

#### 1. Display Audit Report

```
Branch Audit
────────────
Orphaned (no remote):     N branches
Closed PR:                N branches
Stale (>N days):          N branches
Diverged (ahead+behind):  N branches (warn only)
Behind remote:            N branches
Ahead of remote:          N branches (warn only)
Merged ([gone]):          N branches (use gt-sync)
Clean:                    N branches
────────────────────────────
Total:                    N branches (excl. trunk + current)
```

The "Merged ([gone])" line counts branches whose remote was deleted. These are
included in the total for reconciliation but are not actionable by this command —
they are the `gt-sync` skill's responsibility.

#### 2. Merged Branch Hint

If any branches had `[gone]` track status (remote deleted, likely merged), print:

```
Note: N merged branches detected. Run gt-sync to clean those.
```

#### 3. Dry Run Exit

If `--dry-run` was passed, print "Dry run — no actions taken." Then proceed
directly to Phase 6 (Worktree Cleanup Offer; mechanics in
`references/worktree-cleanup-offer.md`) — Phase 6 reads `$DRY_RUN` itself
and prints a preview note instead of invoking the worktree:cleanup skill
(it is not passed as an argument to anything).

#### 4. Nothing to Clean

If all actionable categories (orphaned, closed PR, stale, behind remote) are
empty, print "Nothing to clean up." For warn-only categories that have entries,
still display the warnings. Then proceed to Phase 6 (Worktree Cleanup Offer;
mechanics in `references/worktree-cleanup-offer.md`) before exiting — users
may have stale worktrees even without stale branches.

### Phase 4: Category Actions

Walk through each non-empty category. **Actionable categories** (1, 2, 3, 5)
get AskUserQuestion confirmation. **Warn-only categories** (4, 6) are displayed
without prompting.

**Host note:** `AskUserQuestion` and the `Skill` tool are Claude Code
primitives. On Codex, wherever this skill says AskUserQuestion, present the
same options as a numbered list in your reply and wait for the user's answer
before acting; and in Phase 6, the `worktree:cleanup` skill is not
Codex-exposed — report its unavailability using the Codex-specific text in
the graceful-degradation message in `references/worktree-cleanup-offer.md`
instead of attempting the invocation.

#### Actionable Categories (Orphaned, Closed PR, Stale, Behind Remote)

Confirmation and execution mechanics for the four actionable categories —
the category-level AskUserQuestion prompt, the `closed_not_merged` display
rules, the data-loss warning, `gt delete` / `gt get` error handling, and
the 15-branch review cap with per-branch content fencing — are specified
in a reference file. Read the file `references/actionable-categories.md`
located in this skill's directory (sibling to this SKILL.md) before acting
on any actionable category.

#### Warn-Only Categories (Diverged, Ahead of Remote)

Display without AskUserQuestion:

**Diverged (ahead + behind):**

```
Diverged (N branches — both local and remote have unique commits):
  <branch> (N ahead, M behind) — investigate manually
    WARNING: gt get would discard N local commits and reset to remote state
```

**Ahead of remote:**

```
Ahead of remote (N branches — use smart-submit to push):
  <branch> (N commits ahead)
```

### Phase 5: Summary

Output the final report:

```
Cleanup Complete
────────────────
Deleted:      N branches (breakdown by category)
Synced:       N branches (behind remote)
Warnings:     N branches (diverged + ahead)
Skipped:      N branches (user choice)
Failed:       N

Details:
  Deleted:  <comma-separated list>
  Synced:   <comma-separated list>
  Ahead:    <branch> (N commits) → run smart-submit
  Diverged: <branch> (N ahead, M behind) → investigate manually
  Failed:   <branch> — <error reason>
```

For failed branches, include only the first line of the error message in the
summary. The full error was already printed during execution.

Then proceed to Phase 6 (Worktree Cleanup Offer; mechanics in
`references/worktree-cleanup-offer.md`).

### Phase 6: Worktree Cleanup Offer (Optional)

After the branch cleanup summary, offer optional worktree cleanup. Read the
file `references/worktree-cleanup-offer.md` located in this skill's
directory (sibling to this SKILL.md) for the worktree count check, the
`$DRY_RUN` preview behavior, the AskUserQuestion offer, and the host-aware
graceful-degradation message when yellow-core is not installed.

### Success Criteria

- All local branches scanned and classified into 6 categories
- Trunk and current branch auto-excluded
- `--dry-run` shows report without any actions
- `--stale-days N` overrides the 30-day default
- Category-based confirmation with batch/individual/skip options
- `gt delete` used for deletions (fallback to `git branch -D` for untracked)
- `gt get` used for behind-remote sync with conflict handling
- Ahead-of-remote and diverged branches get warn-only treatment
- Summary report matches gt-workflow format conventions
- Prerequisite validation runs before any interactive prompts
- Stale branches with open PRs are excluded from deletion
- Orphaned branches show unique commit counts as data-loss warning
- Phase 6 offers worktree cleanup when worktrees exist (> 1), per
  `references/worktree-cleanup-offer.md`
- Graceful degradation when yellow-core is not installed
- `--dry-run` mode remains non-interactive in Phase 6
