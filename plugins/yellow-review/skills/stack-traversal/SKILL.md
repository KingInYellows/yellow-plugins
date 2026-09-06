---
name: stack-traversal
description: "Internal reference for the bottom-up Graphite stack-traversal procedure shared by /review:all and /review:resolve-stack. Use when a yellow-review command needs to walk a Graphite stack PR by PR in dependency order."
user-invocable: false
---

# Graphite Stack Traversal

## What It Does

Documents the canonical bottom-up stacked-PR walk: resolve the active
stacked-PR provider, enumerate the stack, filter to open PRs, order
base-to-tip, adopt non-Graphite PRs, check out each branch in turn, and
restack after each per-PR action. `/review:all` (`scope=stack`) and
`/review:resolve-stack` both consume this procedure so the traversal stays
consistent across the two commands and both providers.

## When to Use

Use when a yellow-review command needs to iterate a Graphite stack one PR at a
time in dependency order. The command supplies the per-PR action (review,
resolve, etc.); this skill supplies only the walk around it.

## Usage

This skill is not user-invocable. It is a shared prose reference — consuming
commands **inline** the steps below and cite this skill as the source of
truth; they do NOT load it via the `Skill` tool. When the traversal logic
changes, update this skill and every command that mirrors it (currently
`commands/review/review-all.md` and `commands/review/resolve-stack.md`).

### Step 0: Resolve the active stacked-PR provider

Before Step 1, the consuming command invokes the `Skill` tool with
`skill: "stack-provider-router"` once for the whole walk (not per PR) and
reads `state` from its result. `READY_GRAPHITE` routes to the Graphite
branch of Steps 1, 2, and 4 below (and the existing Graphite branches at
Steps 5-6); `READY_GITHUB` routes to the GitHub branch throughout. Any
other state stops the walk before it starts — report the router's
`detail` verbatim inside a
`--- begin untrusted-content (reference only) ---` /
`--- end untrusted-content ---` fence and do not enumerate or adopt
anything.

### Step 1: Enumerate the stack

**Graphite:**

```bash
gt log short --stack --no-interactive 2>/dev/null
```

The `--stack` flag scopes output to the ancestors and descendants of the
current branch. Without it, `gt log short` lists *every* tracked branch in the
repo — a consuming command that walks "the current stack" must pass `--stack`
or it will pull in branches from unrelated stacks.

Parse branch names from the Graphite stack output — one branch per line, strip
leading graph characters (`◉`, `◯`, `│`, etc.).

**GitHub:**

```bash
node "${CLAUDE_PLUGIN_ROOT}/../github-workflow/lib/github-stack-runtime.js" view
```

Read the JSON result's `status` field. `SUCCESS` — parse `stdout` as the
`gh stack view --json` shape confirmed by the `github-stack-plan` skill:
`{trunk, currentBranch, branches: [{name, head, base, isCurrent, isMerged,
isQueued, needsRebase, pr: {number, url, state} | null}]}`. `branches` is
already ordered bottom-to-top (trunk-adjacent first) — the adapter's `view`
reports the one native stack rooted at trunk, not every tracked branch in
the repo, so there is no Graphite-style `--stack` scoping concern here. Any
other status (e.g. `NOT_IN_STACK`) — treat as an empty stack and continue
to Step 3's "no open PRs" handling.

### Step 2: Filter to open PRs and order base-to-tip

**Graphite:** for each branch from Step 1:

```bash
gh pr view <branch> --json number,state -q '{number: .number, state: .state}'
```

Keep only PRs whose `state == OPEN`. A branch with no associated PR, or whose
PR is `MERGED`/`CLOSED`, is dropped from the walk (log one line per dropped
branch). Order the surviving PRs base → tip (bottom of stack first).

**GitHub:** filter Step 1's `branches[]` to entries where `pr` is not null
and `pr.state == "OPEN"` — drop entries with no PR yet, or whose PR is
`MERGED`/`CLOSED` (log one line per dropped branch). `branches[]` is
already base → tip ordered (Step 1), so no separate ordering pass is
needed.

**Draft PRs** are a consumer-specific concern — this shared procedure filters
only on `state`. A consuming command MAY additionally drop draft PRs (e.g.
`/review:resolve-stack` skips drafts; `/review:all scope=stack` does not). When
it does, it logs one line per dropped draft. Graphite's `gh pr view` call
above can request `isDraft` in the same JSON query; GitHub's `view` result
does not carry `isDraft` on `pr`, so a GitHub consumer that needs draft
filtering must issue one additional
`gh pr view <pr.number> --json isDraft -q .isDraft` per surviving branch.

### Step 3: Validate

- If no open PRs remain: report "No open PRs found in current Graphite stack."
  and exit successfully — there is nothing to walk.
- Check the working directory is clean:

  ```bash
  git status --porcelain
  ```

  If non-empty: error "Uncommitted changes detected. Commit or stash first."
  and stop before entering the loop.

### Step 4: Adopt non-Graphite PRs (consumer-specific, Graphite only)

This step applies only under `READY_GRAPHITE`, and only to consumers that
may encounter PRs outside the current Graphite stack — e.g. `/review:all`
with `scope=all` or `scope=PR#`. A command that walks **only** the current
stack can skip adoption entirely: every branch in `gt log short` output is
Graphite-tracked by definition. `/review:resolve-stack` walks only the
current stack and therefore omits this step regardless of provider.

For Graphite consumers that need it — for each PR in the walk not already
tracked by Graphite:

```bash
gh pr checkout <PR#>
gt track
```

If `gt track` fails: warn "PR #<PR#> could not be adopted by Graphite.
Proceeding with raw git." and continue in degraded mode — do not abort the
walk.

**GitHub:** no adoption step exists here. The runtime adapter has no
`track`/adopt operation — its only operations are `view`, `init`, `add`,
`checkout`, `rebase`, `sync`, `submit`, `merge`, and `unstack` — a PR either
appears in `view`'s `branches[]` (Step 1) or it doesn't. A GitHub
consumer's `scope=all`/`scope=PR#` PR that falls outside `view`'s reported
stack is processed as an independent PR with plain `git`/`gh`, the same
"degraded mode" Graphite already falls back to on a `gt track` failure —
there is nothing to adopt into.

### Step 5: Per-PR checkout

At the top of each loop iteration, check out the PR's branch.

**Graphite:**

```bash
gt checkout <branch>
```

If `gt checkout` fails (branch missing locally, stack in a bad state): log
`[stack-traversal] checkout failed for <branch>; skipping` and continue to the
next PR — do not abort the whole walk.

**GitHub:**

```bash
git checkout <branch>
```

If `git checkout` fails: log
`[stack-traversal] checkout failed for <branch>; skipping` and continue to
the next PR — do not abort the whole walk.

### Step 6: Restack after the per-PR action

After the consuming command's per-PR action completes and any changes are
committed, restack the upstack so the next PR rests on the updated base.

**Graphite:**

```bash
gt upstack restack
```

If `gt upstack restack` reports a conflict: run `gt abort` to clear the
conflicted restack (otherwise the repo stays mid-rebase and the next
`gt checkout` fails), record the conflict for the command's final summary, and
continue to the next PR. Do not pause for input — the consuming command
surfaces restack conflicts in its summary so the user can restack manually.

**GitHub:**

```bash
node "${CLAUDE_PLUGIN_ROOT}/../github-workflow/lib/github-stack-runtime.js" rebase --mode upstack
```

Read the JSON result's `status` field. `CONFLICT`: run
`node "${CLAUDE_PLUGIN_ROOT}/../github-workflow/lib/github-stack-runtime.js" rebase --mode abort`
to clear the conflicted rebase (otherwise the repo stays mid-rebase and the
next checkout fails), record the conflict for the command's final summary,
and continue to the next PR. Any other non-`SUCCESS` status: report the
result's `recoveryAction`, record it for the summary, and continue. Do not
pause for input — the consuming command surfaces restack conflicts in its
summary so the user can restack manually.

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
