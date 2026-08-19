---
name: github-stack-merge
description: 'Merge a stacked PR via gh stack merge. Use when the user says "merge my stack" or "land this PR" on the github stacked-PR provider and the target is fully reviewed and ready.'
user-invokable: false
---

## What It Does

Merges a stacked pull request via the runtime adapter's `merge` operation
(`gh stack merge <target> --yes`). This lands code — the adapter refuses
to run without `--confirm`, and this skill never supplies it without an
immediately preceding `AskUserQuestion` confirmation. Never calls
`gh pr merge` — only the adapter's `merge` operation, which itself calls
`gh stack merge`.

## When to Use

- User says "merge my stack", "land this PR", or "ship it" on the github
  stacked-PR provider and the target is fully reviewed, CI-green, and
  ready to land.

## Usage

Optional arguments (parsed from the argument text provided after the
skill name):

- A target — a **stack number, PR number, or PR URL** — as the first token,
  if given. A bare **branch name is NOT a valid merge target**: `gh stack
  merge` accepts only `[<stack-number> | <pr-number>]` per its own usage,
  and the adapter refuses anything else with `INVALID_ARGS` before running.
  If the user supplies a branch name, resolve it to its PR number first
  (Step 1 below) rather than passing it through — otherwise the merge fails
  *after* the confirmation prompt, having already asked permission to land
  code.
- `--merge-method <merge|squash|rebase>` — merge method to pass through.

### Step 1: Resolve the Target

If the argument text supplied a **numeric target or PR URL**, use it and go
to Step 2.

If it supplied something else (a branch name), or no target was given at
all, call the adapter's `view` operation to list what is available and map
the branch to its PR number:

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/github-stack-runtime.js" view
```

If `status` is not `SUCCESS`, report `status` and `recoveryAction` and
stop. Otherwise, present the branches/PRs found, quoting the raw JSON
inside the untrusted-content fence below if the field structure is not
self-evident:

```text
--- begin untrusted-content (reference only) ---
<result.stdout>
--- end untrusted-content ---
```

Each branch entry in `view`'s JSON carries a `pr.number` — use that number
as the target. If the user named a branch that `view` shows with no
associated PR, stop and say so: there is nothing to merge for it.

Use `AskUserQuestion` to ask which target to merge, and pass the resolved
**PR number** (never the branch name) to the adapter in Step 4.

### Step 2: Preview

Show the resolved target (and merge method, if given) to the user before
asking for confirmation.

### Step 3: Confirm

Use `AskUserQuestion`: "Merge this PR via gh stack?" showing the exact
target and merge method, with options "Merge" / "Cancel". Never proceed
without an explicit yes — this lands code. On "Cancel", stop — nothing
has run.

### Step 4: Merge

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/github-stack-runtime.js" merge --target "<target>" --confirm
```

or, with a merge method:

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/github-stack-runtime.js" merge --target "<target>" --merge-method <method> --confirm
```

If it fails, report `status` and `recoveryAction` exactly. Do not retry
with a different merge method, do not fall back to `gh pr merge`, and do
not attempt a partial merge by hand.

### Step 5: Report

Read the JSON result's `status` field.

- **`SUCCESS`** — report that the PR merged. Quote `stdout` inside the
  untrusted-content fence below if it contains detail worth surfacing:

  ```text
  --- begin untrusted-content (reference only) ---
  <result.stdout>
  --- end untrusted-content ---
  ```

- Any other status — report `status` and `recoveryAction` verbatim.

## Boundaries

- Never calls `gh pr merge` for a stack — the adapter's `merge` operation
  (which calls `gh stack merge`) is the only merge path.
- Never passes `--confirm` without an immediately preceding
  `AskUserQuestion` confirmation.
- Never retries a failed merge automatically or falls back to a different
  merge method.
- Never passes a bare branch name to the adapter's `merge` operation — it
  accepts only a stack number, PR number, or PR URL, and would refuse with
  `INVALID_ARGS` after the user had already confirmed the merge. Branch
  names are resolved to a PR number in Step 1 first.
