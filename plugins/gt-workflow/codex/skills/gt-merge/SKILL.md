---
name: gt-merge
description: Merge the current stack's pull requests, from trunk up to the current branch, via Graphite. Use when the user says "merge my stack" or "land these PRs" and the stack is fully reviewed and ready.
---

## What It Does

Merges the pull requests associated with every branch from trunk up to the
current branch, in one Graphite operation (`gt merge`). Graphite's own
merge queue processes the merge; this skill previews what would merge,
gets explicit confirmation, then runs it.

## When to Use

- User says "merge my stack", "land these PRs", or "ship the whole stack".
- The stack is fully reviewed, CI-green, and ready to land — this is a
  landing operation, not a submit or a sync.

## Usage

### Step 1: Preview

```bash
gt log short
gt merge --dry-run
```

`--dry-run` reports which PRs would merge and makes no changes. If it
reports nothing to merge (no PRs in the chain are mergeable yet — not
approved, CI not green, or already merged), report that and stop.

### Step 2: Confirm

Show the exact PR list from Step 1's dry run. Use `AskUserQuestion`:
"Merge these PRs via Graphite?" with options "Merge" and "Cancel". Never
proceed without an explicit yes — this lands code.

On "Cancel", stop. Nothing has run.

### Step 3: Merge

```bash
gt merge -c
```

`-c`/`--confirm` asks for confirmation itself if local branches differ from
remote — treat any such in-terminal prompt this produces as a second,
independent safety check, not a redundant one to suppress.

If it fails, report the exact error output and stop. Do not retry with a
different merge method, do not fall back to `gh pr merge`, and do not
attempt a partial merge by hand.

### Step 4: Report

```bash
gt log short
```

Report the resulting stack state: which PRs merged, which (if any) remain
open above the merge point, and the current branch's status. If Graphite's
merge queue can only land the stack in consecutive groups rather than
atomically (visible as PRs still open above the merged point after the
operation completes), report that plainly — do not claim the whole stack
landed if part of it is still queued.

## Boundaries

- Never calls `gh pr merge` for a stack — Graphite owns the merge.
- Never merges without the Step 2 confirmation.
- Never retries a failed merge automatically.
