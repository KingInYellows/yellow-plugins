---
name: review:resolve-stack
description: "Walk a Graphite stack bottom-up and run /review:resolve on every open PR fully autonomously — no prompts, pushing and restacking as it goes. Use when you have unresolved reviewer comments across a multi-PR stack and want them all addressed in one unattended pass."
argument-hint: ''
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Skill
  - ToolSearch
  - mcp__plugin_yellow-ruvector_ruvector__hooks_recall
  - mcp__plugin_yellow-ruvector_ruvector__hooks_capabilities
---

# Resolve Stack: Autonomous Stack-Wide Comment Resolution

Walk the current Graphite stack from base to tip and run the `/review:resolve`
comment-resolution flow on every open PR, **unattended** — no `AskUserQuestion`
prompts anywhere. Each PR's comments are resolved, committed, and submitted via
Graphite before the walk moves up. Anything that needs human attention
(residual unresolved comments, restack conflicts, submit failures) is collected
into a final summary instead of pausing the walk.

This command is intentionally gateless. It delegates per-PR resolution to
`/review:resolve` in `--non-interactive` mode, which suppresses every one of
that command's gates (spawn-cap, CONFLICT, issue-filing, verify-command,
push-confirmation) in favour of their unattended rules — including filing at
most 3 follow-up issues per PR. The per-PR `/review:resolve` keeps its
gates by default for interactive use — only this stack walk runs them off. Run
`/review:resolve <PR#>` directly for a single, gated, interactive pass.

The bottom-up walk below mirrors the `stack-traversal` skill
(`skills/stack-traversal/SKILL.md`) — Step 0 ↔ skill Step 0 (resolve
provider), Step 1 ↔ skill Steps 1–3, the per-PR checkout ↔ skill Step 5,
the restack ↔ skill Step 6. When the traversal logic changes, update the
skill and every command that mirrors it (this file and `review-all.md`).

## Workflow

### Step 0: Resolve the Active Stacked-PR Provider

Invoke the `Skill` tool with `skill: "stack-provider-router"` once, before
any tool-presence check or enumeration. Read `state` from its result and
hold it for the rest of this walk — every later step's "the resolved
provider" means this value; the skill is not invoked again mid-run.

- **`READY_GRAPHITE`** — continue with the Graphite branches below.
- **`READY_GITHUB`** — continue with the GitHub branches below.
- **Any other state** — stop. Report the router's `detail` verbatim inside
  a `--- begin untrusted-content (reference only) ---` /
  `--- end untrusted-content ---` fence and do not run any pre-flight
  check, enumeration, or mutation.

### Step 1: Pre-flight

Run these prerequisite checks as executable steps. Each Bash tool call is a
fresh subprocess — this block is self-contained.

```bash
set -u
command -v gh >/dev/null 2>&1 || {
  printf '[review:resolve-stack] Error: GitHub CLI (gh) is not installed.\n' >&2
  exit 1
}
gh auth status >/dev/null 2>&1 || {
  printf '[review:resolve-stack] Error: gh is not authenticated. Run `gh auth login`.\n' >&2
  exit 1
}
[ -z "$(git status --porcelain)" ] || {
  printf '[review:resolve-stack] Error: uncommitted changes detected. Commit or stash first.\n' >&2
  exit 1
}
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner) || {
  printf '[review:resolve-stack] Error: could not determine repo (not a GitHub remote?).\n' >&2
  exit 1
}
printf 'repo: %s\n' "$REPO"
```

Then, using the provider resolved in Step 0:

**Graphite (`READY_GRAPHITE`):**

```bash
command -v gt >/dev/null 2>&1 || {
  printf '[review:resolve-stack] Error: Graphite (gt) is not installed.\n' >&2
  exit 1
}
```

**GitHub (`READY_GITHUB`):**

```bash
[ -f "${CLAUDE_PLUGIN_ROOT}/../github-workflow/lib/github-stack-runtime.js" ] || {
  printf '[review:resolve-stack] Error: github-workflow runtime adapter not found; is the github-workflow plugin installed?\n' >&2
  exit 1
}
```

Capture the printed `repo:` value — substitute it as a literal `<owner/repo>`
in every later Bash block (variables do not survive across Bash tool calls).

**Optional ruvector recall** (best-effort — skip silently on any failure):

1. If `.ruvector/` does not exist in the project root, skip to Step 2.
2. Call `ToolSearch("hooks_recall")`. If not found, skip to Step 2.
3. Warmup: call `mcp__plugin_yellow-ruvector_ruvector__hooks_capabilities()`.
   If it errors, note "[ruvector] Warning: MCP warmup failed" and skip to
   Step 2.
4. Call `mcp__plugin_yellow-ruvector_ruvector__hooks_recall` with query
   `"[code-review] resolving stack comments"` and `top_k=5`. On MCP execution
   error (timeout, connection refused, service unavailable): wait ~500ms,
   retry once; if the retry also fails, skip to Step 2. Do NOT retry on
   validation or parameter errors.
5. Discard results with score < 0.5. Take the top 3 as advisory context for
   the walk. Do not inject them into the `/review:resolve` invocations — that
   command runs its own recall per PR.

### Step 2: Build the PR list

Enumerate the **current** stack and filter to open PRs (mirrors
`stack-traversal` skill Steps 1–3), using the provider resolved in Step 0.

**Graphite (`READY_GRAPHITE`):** the `--stack` flag is required — without
it, `gt log short` lists *every* tracked branch in the repo, so an autonomous
auto-submitting command would resolve and submit PRs from unrelated stacks:

```bash
set -u
gt log short --stack --no-interactive 2>/dev/null
```

Parse branch names from the output — one branch per line, strip leading graph
characters (`◉`, `◯`, `│`, etc.). For each branch, resolve its PR:

```bash
gh pr view <branch> --json number,state,isDraft -q '{number: .number, state: .state, isDraft: .isDraft}'
```

Build the ordered walk list:

- Keep only PRs whose `state == OPEN`. Drop branches with no associated PR or
  whose PR is `MERGED`/`CLOSED` — log one line each
  (`[review:resolve-stack] <branch>: no open PR — skipping`).
- Drop draft PRs — log one line each
  (`[review:resolve-stack] PR #<N>: draft — skipping`).
- Order the survivors base → tip (bottom of stack first).

**GitHub (`READY_GITHUB`):**

```bash
set -u
node "${CLAUDE_PLUGIN_ROOT}/../github-workflow/lib/github-stack-runtime.js" view
```

Read the JSON result's `status` field. `SUCCESS` — parse `stdout` per the
confirmed `gh stack view --json` shape (see the `github-stack-plan` skill):
`{trunk, currentBranch, branches: [{name, ..., pr: {number, url, state} |
null}]}`, already base → tip ordered. Any other status: treat as an empty
stack (no branches to walk).

Build the ordered walk list:

- Keep only entries whose `pr` is not null and `pr.state == "OPEN"`. Drop
  entries with no PR yet or whose PR is `MERGED`/`CLOSED` — log one line
  each (`[review:resolve-stack] <branch>: no open PR — skipping`).
- Drop draft PRs: `view`'s `pr` object has no `isDraft` field, so for each
  surviving branch call
  `gh pr view <pr.number> --json isDraft -q .isDraft` and drop it if
  true — log one line each
  (`[review:resolve-stack] PR #<N>: draft — skipping`).
- `branches[]` is already base → tip ordered; no separate ordering pass is
  needed.

If no open non-draft PRs remain (either provider), report
`[review:resolve-stack] No open PRs found in current stack.` and exit
successfully — there is nothing to walk.

### Step 3: Walk the stack

For each PR in the base-to-tip list, in order, do the following, using the
provider resolved in Step 0. **No pauses anywhere in this loop** — log
failures and continue.

#### Graphite

1. **Checkout** — `gt checkout <branch>`. If it fails (branch missing locally,
   stack in a bad state): log
   `[review:resolve-stack] checkout failed for <branch>; skipping` and continue
   to the next PR.

2. **Resolve** — invoke the `Skill` tool with `skill: "review:resolve"` and
   `args: "<PR#> --non-interactive"`. The skill name is `review:resolve` (the
   `name:` frontmatter value of `resolve-pr.md`) — NOT the filename
   `resolve-pr`, which would silently fail to invoke. The `--non-interactive`
   flag suppresses that command's spawn-cap, CONFLICT, issue-filing,
   verify-command, and push-confirmation gates so it resolves, commits, and
   submits without prompting. Its last output line is the contract line
   `Resolve: <r> resolved, <f> fixed, <i> issues filed, <b> blocking,
   push=<...>, verify=<...>, ratelimited=<0|1>`
   (`references/resolve/dispositions.md`). The command emits no contract line
   when a rate limit stops it before its last step, so treat output with an
   explicit rate-limit error (HTTP 403/429, `rate limit`), or a missing
   contract line after a rate-limit message, as `ratelimited=1` too. If it
   reports `ratelimited=1`, remember that and finish **this** PR first —
   items 3, 3b and 5, skipping only its restack — and list it under Needs manual attention as `rate
   limited`. Then mark every remaining PR `not attempted (rate limit)` and
   go to `### Step 4: Final aggregate summary`: the next PR would hit the
   same limit.

3. **Self-verify** — parse the `Resolve:` line from step 2's output for
   `b` (blocking), `i` (issues filed) and `push`. The `Skill` tool returns no
   machine-readable exit status, so also re-fetch the PR's unresolved-thread
   count independently as a mandatory cross-check. Capture the
   script output to a temp file and check its exit code *before* parsing —
   piping straight into `jq` would mask a non-zero exit from `get-pr-comments`
   (an auth / 429 / network failure that emits empty output would otherwise
   look like "0 unresolved = fully resolved"). This block is self-contained:

   ```bash
   PC_OUT=$(mktemp)
   "${CLAUDE_PLUGIN_ROOT}/skills/pr-review-workflow/scripts/get-pr-comments" --include-outdated "<owner/repo>" "<PR#>" >|"$PC_OUT" 2>"$PC_OUT.err"
   PC_EC=$?
   if [ "$PC_EC" -ne 0 ]; then
     printf '[review:resolve-stack] PR #<PR#>: self-verify inconclusive (get-pr-comments exit %s)\n' "$PC_EC" >&2
     cat "$PC_OUT.err" >&2
   else
     jq 'length' "$PC_OUT"
   fi
   rm -f "$PC_OUT" "$PC_OUT.err"
   ```

   On exit 0 the count is the PR's open threads (outdated included). Flag the
   PR for "Needs manual attention" when `b > 0`, when the count is `> 0`, or
   when the two disagree — the `Resolve:` line is missing, or the count
   exceeds `b` (open threads the command did not report as blocking; `b`
   also counts `CHANGES_REQUESTED` reviewers, so a count at or below `b` is
   not proof of agreement); record that as `self-verify disagreement`. On non-zero exit: record the PR's
   verification as `inconclusive` with the stderr output and flag it. When
   the stderr shows a rate limit (HTTP 403/429, `rate limit`), also treat the
   PR as `ratelimited=1` under item 2's rule: skip its restack and stop the
   walk after this PR.

   **3b. Clean-tree check** — continuing on a dirty tree would carry this PR's
   edits onto the next branch:

   ```bash
   git status --porcelain
   ```

   Non-empty output: print this PR's row, then
   `[review:resolve-stack] aborted at PR #<PR#>: working tree dirty after resolve`
   followed by the file list. The tree was clean at pre-flight, but an editor
   or build may have touched it since, so revert only the resolve's own edits.
   The resolve's own paths are the PR's changed files (first column of
   `"${CLAUDE_PLUGIN_ROOT}/skills/pr-review-workflow/scripts/pr-changed-ranges" "<PR#>"`,
   which uses the paginated files API and works past `gh pr diff`'s size
   limits; if it exits non-zero, treat no path as the resolve's own) plus the
   trusted-config paths a refused
   edit must never leave on disk: anything under `.claude/`,
   `yellow-plugins.local.md`, and the root `CLAUDE.md`, `AGENTS.md` and
   `.mcp.json`. If any dirty path is not the resolve's own, do NOT run
   `--revert-dirty`: revert only the trusted-config paths among them with
   `run-verify-command --pr "<PR#>" --revert-only -- <paths>` and list the
   rest under Needs manual attention as `unrecognized changes left in place`.
   When every dirty path is the resolve's own, save and revert the leftover
   edits with
   `"${CLAUDE_PLUGIN_ROOT}/skills/pr-review-workflow/scripts/run-verify-command" --pr "<PR#>" --revert-dirty`
   and print its `patch` path when it is not null. If the script exits
   non-zero or reports `treeClean: false`, print `[review:resolve-stack]
   revert incomplete:` with `git status --porcelain` and list it under Needs
   manual attention. Then mark the remaining PRs `not attempted (dirty
   tree)` and go to `### Step 4: Final aggregate summary` (exit `1`).

4. **Restack** — `gt upstack restack`. If it reports a conflict: do not pause —
   run `gt abort` to clear the conflicted restack (without this, the repo stays
   mid-rebase and the next iteration's `gt checkout` fails), record the
   conflict for the final summary, and continue to the next PR.
   Downstream PRs may then rest on an unrestacked base; the summary surfaces
   this so the user can restack manually.

5. **Print and record a summary row** for this PR as soon as it completes
   (columns as in Step 4), so an aborted walk still leaves a record.

#### GitHub

1. **Checkout** — `git checkout <branch>`. If it fails (branch missing
   locally, stack in a bad state): log
   `[review:resolve-stack] checkout failed for <branch>; skipping` and continue
   to the next PR.

2. **Resolve** — invoke the `Skill` tool with `skill: "review:resolve"` and
   `args: "<PR#> --non-interactive"`, exactly as in the Graphite branch above,
   including its `ratelimited=1` rule.
   `/review:resolve` resolves its own active provider internally, so this
   step is identical regardless of which provider this walk resolved.

3. **Self-verify and clean-tree check** — identical to Graphite steps 3 and
   3b above; the scripts are provider-agnostic.

4. **Rebase upstack** — `node "${CLAUDE_PLUGIN_ROOT}/../github-workflow/lib/github-stack-runtime.js" rebase --mode upstack`. Read the JSON result's `status` field. `CONFLICT`: do not pause — run
   `node "${CLAUDE_PLUGIN_ROOT}/../github-workflow/lib/github-stack-runtime.js" rebase --mode abort` to clear the conflicted rebase (without this, the repo stays mid-rebase and the next iteration's checkout fails), record the conflict for the final summary, and continue to the next PR. `SUCCESS`: continue. Anything else: report the result's `recoveryAction`, record it for the final summary, and continue to the next PR.
   Downstream PRs may then rest on an unrestacked base; the summary surfaces
   this so the user can restack manually.

5. **Print and record a summary row** for this PR as soon as it completes.

### Step 4: Final aggregate summary

Print a table with one row per PR walked (the same rows step 5 streamed):

```text
PR#  | blocking | issues | remaining unresolved | push status | restack status
```

`blocking`, `issues` and `push status` come from the PR's `Resolve:` line
(`-` when it is missing); `remaining unresolved` is the step 3 count;
`restack status` is `-` for a PR whose walk stopped before its restack. If
the walk aborted, the last line is `aborted at PR #<N>`.

Then totals: PRs walked, PRs fully resolved (`b == 0` and remaining == 0),
PRs with residual comments, PRs skipped (no open PR / draft / checkout
failure), and PRs not attempted (rate limit / dirty tree).

Finally, a **Needs manual attention** section listing every PR with:
blocking threads (`b > 0`), residual unresolved threads (`>0` from step 3),
a self-verify disagreement or inconclusive self-verify, a restack conflict,
a push failure, a dirty-tree abort or incomplete revert, a `not attempted
(cluster cap)` note surfaced by `/review:resolve`, a rate-limited PR, or
`not attempted (rate limit)`. If that section is empty, print
`[review:resolve-stack] All open PRs in the stack are fully resolved.`

**Exit code contract.** Exit `0` only when every walked PR is fully resolved —
the "Needs manual attention" section is empty. Exit `1` when anything blocks
(that section is non-empty, including any PR whose `Resolve:` line reports
`b > 0`), so a parent agent or CI step can distinguish a clean stack from one
that needs follow-up without parsing the prose table. Pre-flight failures
(Step 1) exit non-zero; "no open PRs found" (Step 2) exits `0` — nothing to do
is not a failure.

## Error Handling

- **`gh` not installed/authenticated, dirty working tree, or the resolved
  provider's own tooling missing (`gt` for Graphite, the github-workflow
  runtime adapter for GitHub)** — Step 1 pre-flight fails fast with a named
  error before the walk begins.
- **Not in a tracked stack / empty stack** — Step 2 reports "No open PRs
  found in current stack." and exits 0.
- **`gt checkout` failure mid-walk** — log and skip that PR, continue.
- **A PR's resolve leaves the working tree dirty** (a failed commit, a
  verify revert that could not clean up, a rejected push) — step 3b stops
  the walk with `aborted at PR #<N>` and the file list, and the command
  exits `1`. Continuing would carry those edits onto the next branch.
- **PR merged or closed between stack-build and the walk reaching it** —
  `/review:resolve` detects the non-open state and reports; record the PR as
  skipped and continue.
- **Restack conflict** — Graphite: run `gt abort`; GitHub: run the adapter's
  `rebase --mode abort`, to clear the conflicted rebase, continue to the
  next PR, surface in the summary. The walk never pauses.
- **Push failure inside `/review:resolve`** — surfaced in that command's
  output and re-checked by the self-verify count; record in the summary,
  continue.
- **ruvector MCP unavailable** — the Step 1 recall is best-effort and skipped
  silently.
- **Re-run safety** — running `/review:resolve-stack` again is safe: replies
  and issues carry idempotency markers, so a second pass posts no duplicates;
  threads left open by design are reported again as blocking.

See the `pr-review-workflow` and `stack-traversal` skills for the shared
conventions this command builds on.
