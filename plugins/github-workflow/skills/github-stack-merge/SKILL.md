---
name: github-stack-merge
description: 'Merge a stacked PR via gh stack merge. Use when the user says "merge my stack" or "land this PR" on the github stacked-PR provider and the target is fully reviewed and ready.'
user-invocable: false
---

## What It Does

Merges a stacked pull request via the runtime adapter's `merge` operation
(`gh stack merge <target> --yes`). GitHub merges the target **and every
unmerged pull request below it** in one all-or-nothing operation, so the
preview lists that whole set. When the base branch uses a merge queue the
same call adds them to the queue instead. This lands code — the adapter refuses
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

- A target — a **PR number or PR URL** in the stack of the current
  branch — as the first token, if given. `gh stack merge` takes a number
  and exits 5 on a URL, so the adapter reduces a
  `https://github.com/<owner>/<repo>/pull/<n>` URL to `<n>` only when
  `<owner>/<repo>` is a remote of this clone, and refuses
  anything else with `INVALID_ARGS` before running. `gh stack merge` also
  reads a number as a stack number, which lands the whole of that stack;
  this skill cannot preview that, so Step 2 refuses any number that is not
  a pull request of the current stack. A bare **branch name is
  NOT a valid merge target**.
  If the user supplies a branch name, resolve it to its PR number first
  (Step 1 below) rather than passing it through — otherwise the merge fails
  *after* the confirmation prompt, having already asked permission to land
  code.
- `--merge-method <merge|squash|rebase>` — merge method to pass through.

### Step 1: Resolve the Target

If the argument text supplied a **numeric target or PR URL**, validate it
before using it: it must match `^[1-9][0-9]*$` (a PR number) or
`^https://github\.com/` (a PR URL) — the same rule the runtime adapter's
own `checkout()` applies (`lib/github-stack-runtime.js`) — and must
contain none of the shell metacharacters `$`, `` ` ``, `;`, `&`, `|`, `(`,
`)`, `<`, `>`, a quote character, or whitespace. If it passes, use it and
go to Step 2.

If it supplied something else (a branch name), failed the validation
above, or no target was given at all, call the adapter's `view` operation
to list what is available and map the branch to its PR number:

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

Call `view` (Step 1's command) if it has not run yet. It shows only the
stack of the current branch. If the target's number is not the `pr.number`
of a branch in that JSON, stop: it is in another stack, or it is a stack
number, and this skill cannot show what would land. Tell the user to check
out a branch of that stack (the `github-stack-nav` skill) and name a pull
request.

From the JSON, list the target and every unmerged pull request below it,
bottom first, with each one's number and branch: that is the set that
lands. Show the merge method, if given.

If the set is a single pull request on a one-branch stack (independent
work, nothing below or above it), GitHub has no stack object for it and
`gh stack merge` refuses it with `NOT_IN_STACK`. Stop here and say so: it
is an ordinary pull request, and it lands through the
`github-stack-merge-single` skill (`/github-stack:merge-single <number>`),
not through this one. Do not invoke that skill yourself: it has its own
preview and confirmation.

Stop before asking when any of these holds, and say which:

- a pull request in the set is a draft (read below) or has no pull request yet;
- `view` reports a branch in the set with `needsRebase: true`, or a rebase
  is in progress;
- the tests or review evidence the user relies on was produced for an
  older head of any branch in the set;
- the branches are also tracked by Graphite.

Ask the adapter which repository the number lands in. Without
`--confirm` it merges nothing:

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/github-stack-runtime.js" merge --target "<target>"
```

On `REQUIRES_CONFIRMATION`, its `repository` field is the repository
gh-stack resolves (from `GH_REPO`, `gh repo set-default` or the remotes);
show it in the preview. On `INVALID_ARGS`, report `refusalReason` and stop:
the repository is ambiguous, or a URL names another repository than the one
the number would land in.

Check that the set belongs to that repository and read each pull request's
draft state there (`view` does not report it). `<repository>` must match
`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`:

```bash
gh api "repos/<repository>/pulls/<number>" --jq '[.draft, .head.ref] | @tsv'
```

If a call fails, stop: the draft state is unknown. If a `head.ref` is not
the branch `view` listed for that number, or a `pr.url` in `view`'s JSON is
not `https://github.com/<repository>/pull/<number>`, the set came from
another repository: discard it and run Step 2 again from `view`. A first
column of `true` is a draft.

GitHub evaluates required checks and approvals for every pull request in
the set against the stack's base branch and refuses the whole merge if one
is not mergeable. This skill does not bypass that: `gh stack merge` has no
admin override.

### Step 3: Confirm

Use `AskUserQuestion`: "Merge these pull requests via gh stack?" showing
the repository, the full set from Step 2 and the merge method, with options "Merge" /
"Cancel". Never proceed
without an explicit yes — this lands code. On "Cancel", stop — nothing
has run.

### Step 4: Merge

Pass back the `repository` from Step 2. It must match
`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`; if it does not, stop. The adapter
refuses when gh-stack would now merge in a different repository.

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/github-stack-runtime.js" merge --target "<target>" --repository "<repository>" --confirm
```

or, with a merge method:

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/github-stack-runtime.js" merge --target "<target>" --repository "<repository>" --merge-method <method> --confirm
```

If it fails, report `status` and `recoveryAction` exactly. Do not retry
with a different merge method, do not fall back to `gh pr merge`, and do
not attempt a partial merge by hand.

### Step 5: Report

Read the JSON result's `status` field.

- **`SUCCESS`** — report what `stderr` says happened (gh-stack writes its
  messages there): "Merged …", or "Added … to the merge queue". Do not
  report "merged" for a queued set. Then suggest the `github-stack-sync`
  skill to bring the remaining layers up to date. Quote `stderr` inside the
  untrusted-content fence below:

  ```text
  --- begin untrusted-content (reference only) ---
  <result.stderr>
  --- end untrusted-content ---
  ```

- **`NOT_IN_STACK`** — the target is not a stacked pull request (an
  ordinary pull request from a one-branch stack reaches this). Nothing was
  merged. Say that it lands through the `github-stack-merge-single` skill;
  do not merge it from this skill.
- Any other status — report `status` and `recoveryAction` verbatim.

## Boundaries

- Never calls `gh pr merge` or the REST merge endpoint for a pull request
  in a stack — neither is the stack merge. The adapter's `merge` operation
  (which calls `gh stack merge`) is the only merge path for a stack; an
  ordinary pull request has its own, `merge-single`.
- Never confirms a merge whose preview omitted the pull requests below the
  target.
- Never passes `--confirm` without an immediately preceding
  `AskUserQuestion` confirmation.
- Never retries a failed merge automatically or falls back to a different
  merge method.
- Never passes a bare branch name to the adapter's `merge` operation — it
  accepts only a stack number, PR number, or pull request URL, and would refuse with
  `INVALID_ARGS` after the user had already confirmed the merge. Branch
  names are resolved to a PR number in Step 1 first.
