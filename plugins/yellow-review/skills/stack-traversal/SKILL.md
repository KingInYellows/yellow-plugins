---
name: stack-traversal
description: "Internal reference for the bottom-up Graphite stack-traversal procedure shared by /review:all and /review:resolve-stack. Use when a yellow-review command needs to walk a Graphite stack PR by PR in dependency order."
user-invokable: false
---

# Graphite Stack Traversal

## What It Does

Documents the canonical bottom-up Graphite stack walk: enumerate the stack,
filter to open PRs, order base-to-tip, adopt non-Graphite PRs, check out each
branch in turn, and restack after each per-PR action. `/review:all`
(`scope=stack`) and `/review:resolve-stack` both consume this procedure so the
traversal stays consistent across the two commands.

## When to Use

Use when a yellow-review command needs to iterate a Graphite stack one PR at a
time in dependency order. The command supplies the per-PR action (review,
resolve, etc.); this skill supplies only the walk around it.

## Usage

This skill is not user-invokable. It is a shared prose reference — consuming
commands **inline** the steps below and cite this skill as the source of
truth; they do NOT load it via the `Skill` tool. When the traversal logic
changes, update this skill and every command that mirrors it (currently
`commands/review/review-all.md` and `commands/review/resolve-stack.md`).

### Step 1: Enumerate the stack

```bash
gt log short --stack --no-interactive 2>/dev/null
```

The `--stack` flag scopes output to the ancestors and descendants of the
current branch. Without it, `gt log short` lists *every* tracked branch in the
repo — a consuming command that walks "the current stack" must pass `--stack`
or it will pull in branches from unrelated stacks.

Parse branch names from the Graphite stack output — one branch per line, strip
leading graph characters (`◉`, `◯`, `│`, etc.).

### Step 2: Filter to open PRs and order base-to-tip

For each branch from Step 1:

```bash
gh pr view <branch> --json number,state -q '{number: .number, state: .state}'
```

Keep only PRs whose `state == OPEN`. A branch with no associated PR, or whose
PR is `MERGED`/`CLOSED`, is dropped from the walk (log one line per dropped
branch). Order the surviving PRs base → tip (bottom of stack first).

**Draft PRs** are a consumer-specific concern — this shared procedure filters
only on `state`. A consuming command MAY additionally drop draft PRs (e.g.
`/review:resolve-stack` skips drafts; `/review:all scope=stack` does not). When
it does, it logs one line per dropped draft.

### Step 3: Validate

- If no open PRs remain: report "No open PRs found in current Graphite stack."
  and exit successfully — there is nothing to walk.
- Check the working directory is clean:

  ```bash
  git status --porcelain
  ```

  If non-empty: error "Uncommitted changes detected. Commit or stash first."
  and stop before entering the loop.

### Step 4: Adopt non-Graphite PRs (consumer-specific)

This step applies only to consumers that may encounter PRs outside the current
Graphite stack — e.g. `/review:all` with `scope=all` or `scope=PR#`. A command
that walks **only** the current stack can skip adoption entirely: every branch
in `gt log short` output is Graphite-tracked by definition.
`/review:resolve-stack` walks only the current stack and therefore omits this
step.

For consumers that need it — for each PR in the walk not already tracked by
Graphite:

```bash
gh pr checkout <PR#>
gt track
```

If `gt track` fails: warn "PR #<PR#> could not be adopted by Graphite.
Proceeding with raw git." and continue in degraded mode — do not abort the
walk.

### Step 5: Per-PR checkout

At the top of each loop iteration, check out the PR's branch:

```bash
gt checkout <branch>
```

If `gt checkout` fails (branch missing locally, stack in a bad state): log
`[stack-traversal] checkout failed for <branch>; skipping` and continue to the
next PR — do not abort the whole walk.

### Step 6: Restack after the per-PR action

After the consuming command's per-PR action completes and any changes are
committed, restack the upstack so the next PR rests on the updated base:

```bash
gt upstack restack
```

If `gt upstack restack` reports a conflict: run `gt abort` to clear the
conflicted restack (otherwise the repo stays mid-rebase and the next
`gt checkout` fails), record the conflict for the command's final summary, and
continue to the next PR. Do not pause for input — the consuming command
surfaces restack conflicts in its summary so the user can restack manually.

### What belongs to the consuming command

This skill covers only the walk. The consuming command owns:

- The **per-PR action** — what to DO on each PR once checked out (`/review:all`
  runs the Wave 2 review pipeline; `/review:resolve-stack` runs the resolve
  flow).
- Any **non-stack scopes** — `/review:all`'s `scope=all` (all open PRs by
  author) and `scope=PR#` (single-PR alias) are review-all-specific and are
  NOT part of this shared traversal.
- The **final aggregate summary** — per-PR rows, totals, and any
  "needs manual attention" section.
