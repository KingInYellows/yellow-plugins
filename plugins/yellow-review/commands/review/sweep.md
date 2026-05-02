---
name: review:sweep
description: 'Run /review:pr then /review:resolve on the same PR in one invocation. Use when you want both an AI review pass and cleanup of any open bot or human reviewer comment threads without manually re-invoking on the same PR number.'
argument-hint: '[PR# | URL | branch]'
allowed-tools:
  - Bash
  - Skill
  - AskUserQuestion
---

# Sweep: Review + Resolve in One Pass

Run a full review-and-cleanup pass on a single PR: invoke `/review:pr`
for adaptive multi-agent code review with autonomous fix application,
then `/review:resolve` for parallel resolution of all open reviewer
comment threads. Both skills run against the same PR, with a
user-confirmed boundary gate between them (the `Skill` tool surfaces no
machine-readable exit status, so user confirmation is the failure
signal).

Use when you want both an AI review pass and cleanup of any open bot or
human comment threads in a single invocation. Use `/review:pr` directly
to skip the resolve step, or `/review:resolve` directly to skip the
review. For multi-PR or stack-wide sweeps, use `/review:all` —
`/review:all scope=<PR#>` covers similar ground on a single PR but also
invokes a post-review compounding step, while `/review:sweep` is the
lighter alternative for review-then-resolve without compounding.

## Workflow

### Step 1: Resolve PR

Determine the target PR from `$ARGUMENTS`:

1. **If matches `^[0-9]+$`** (positive integer; no sign, decimal, or
   exponent): Use directly as PR number.
2. **If URL** (contains `github.com` and `/pull/`): Extract PR number
   with regex `/pull/([0-9]+)(?:[/?#]|$)`, capturing group 1. The
   trailing `(?:[/?#]|$)` anchor requires a delimiter (slash, query,
   fragment, or end-of-string) after the digits — otherwise a malformed
   URL like `…/pull/12abc` would silently extract the partial `12` and
   review the wrong PR. If the pattern does not match, treat as
   extraction failure and fall through to the validation guard below.
3. **If branch name**: First validate the value matches
   `^[A-Za-z0-9_][A-Za-z0-9/_.-]*$` to reject flag-injection attempts —
   the first character must be alphanumeric or `_`, which excludes a
   leading `-` even though `-` is allowed mid-string for branch names
   like `feat-x`. On match, run
   `gh pr view -- "$ARGUMENTS" --json number -q .number` (the `--`
   end-of-options marker is a defense-in-depth guard so `gh` cannot
   reinterpret the argument as a flag even if validation is later
   relaxed). On mismatch, treat as input error and stop.
4. **If empty**: Detect from current branch:
   `gh pr view --json number -q .number`

Validate the resolved value is numeric and non-empty. If not, sanitize
`$ARGUMENTS` for display (strip every byte outside `[A-Za-z0-9#/:._-]` —
this prevents terminal escape injection from a malformed input) and
report:

```text
[review:sweep] Error: could not resolve PR number from input <sanitized $ARGUMENTS>.
```

Then stop.

Confirm the working directory is clean (both `/review:pr` and
`/review:resolve` will refuse to run on a dirty tree, and `/review:pr`
running via the `Skill` tool surfaces no exit status — so a wrapper-level
check eliminates the ambiguity at the Step 3 gate before it appears):

```bash
set -eu
[ -z "$(git status --porcelain)" ] || {
  printf '[review:sweep] Error: uncommitted changes detected. Commit or stash first.\n' >&2
  exit 1
}
```

Confirm the PR is open:

```bash
set -eu
gh pr view <PR#> --json state -q .state
```

If the command fails or the state is not `OPEN`, report
`[review:sweep] Error: PR #<PR#> is not open or could not be fetched.` and
stop.

### Step 2: Run /review:pr

Invoke the `Skill` tool with `skill: "review:pr"` and `args: "<PR#>"`.
Wait for it to complete.

`/review:pr` runs its full pipeline: adaptive agent selection, parallel
multi-agent review, autonomous P0/P1 fix application, the
push-confirmation gate, and the final report.

### Step 3: Confirm clean completion (failure-boundary gate)

The `Skill` tool returns no machine-readable exit status, so the wrapper
cannot programmatically detect whether `/review:pr` errored, the user
declined the push at its push-confirmation gate, or the review completed
cleanly. The user is the authoritative signal at this boundary.

Use the `AskUserQuestion` tool with:

- Question: ``/review:pr` finished. Did it complete cleanly (review
  succeeded; fixes were pushed or none were needed)? Proceed to resolve
  open comment threads on PR #<PR#>?``
- Options:
  - **Proceed** — continue to Step 4
  - **Stop** — skip the resolve step

If the user selects **Stop** — OR the prompt is dismissed, times out, or
cannot be shown (non-interactive environment, Escape, no response) — do
NOT invoke `/review:resolve`. Treat any non-`Proceed` outcome as Stop.
Print:

```text
[review:sweep] Resolve step skipped. Re-run /review:resolve <PR#>
manually when ready.
```

Then stop. Do not proceed to Step 4 or Step 5.

### Step 4: Run /review:resolve

If the user selected **Proceed** in Step 3, invoke the `Skill` tool with
`skill: "review:resolve"` and `args: "<PR#>"`. The skill name is
`review:resolve` (the value of the `name:` frontmatter field in
`resolve-pr.md`) — do NOT use `review:resolve-pr`, which is the
filename, not the slash-command name, and would silently fail to invoke
the skill.

`/review:resolve` fetches all unresolved review threads on the PR via
GraphQL (no author-type filter — both bot and human threads are
addressed) and routes each thread through a `pr-comment-resolver` agent
that either submits a fix or posts a false-positive response and marks
the thread resolved.

### Step 5: Final summary

Reached only when the user selected **Proceed** at Step 3 and Step 4 ran.
Print a summary line for the run:

```text
[review:sweep] PR #<PR#>
  Review:  completed (per user confirmation)
  Resolve: <one-line summary from /review:resolve, e.g., "5 threads
            resolved, 2 fixes applied" or "no open threads found">
```

If `/review:resolve`'s output cannot be reduced to a one-line summary,
report `Resolve: completed (output unavailable — see above)` rather
than synthesizing a plausible-looking summary.

## Error Handling

- **Argument unresolvable** (input is not numeric, a recognizable
  GitHub PR URL, a valid branch name, and the current branch has no PR):
  `[review:sweep] Error: could not resolve PR number from input
  <sanitized $ARGUMENTS>.` and stop.
- **PR not open / not found**: `[review:sweep] Error: PR #<PR#> is not
  open or could not be fetched.` and stop.
- **Dirty working directory** at Step 1: `[review:sweep] Error:
  uncommitted changes detected. Commit or stash first.` and stop.
  Both downstream skills enforce this independently; the wrapper-level
  check eliminates the ambiguity at the Step 3 gate before it appears
  (see Step 1 rationale).
- **`/review:pr` failed or push declined**: surfaced via the
  user-confirmed Step 3 gate. On any non-`Proceed` outcome the resolve
  step is skipped; re-run `/review:resolve <PR#>` manually when ready.
- **`/review:resolve` returns no extractable summary**: report
  `Resolve: completed (output unavailable — see above)` rather than
  synthesizing one.
- **Zero unresolved threads** is a clean outcome — `/review:resolve`
  reports that as success and `/review:sweep` does the same.
