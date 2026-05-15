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
`/review:resolve` in `--non-interactive` mode, which suppresses that command's
spawn-cap and push-confirmation gates. The per-PR `/review:resolve` keeps its
gates by default for interactive use — only this stack walk runs them off. Run
`/review:resolve <PR#>` directly for a single, gated, interactive pass.

The bottom-up Graphite walk below mirrors the `stack-traversal` skill
(`skills/stack-traversal/SKILL.md`) — Step 1 ↔ skill Steps 1–3, the per-PR
checkout ↔ skill Step 5, the restack ↔ skill Step 6. When the traversal logic
changes, update the skill and every command that mirrors it (this file and
`review-all.md`).

## Workflow

### Step 1: Pre-flight

Run these prerequisite checks as executable steps. Each Bash tool call is a
fresh subprocess — this block is self-contained.

```bash
set -u
command -v gt >/dev/null 2>&1 || {
  printf '[review:resolve-stack] Error: Graphite (gt) is not installed.\n' >&2
  exit 1
}
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
`stack-traversal` skill Steps 1–3). The `--stack` flag is required — without
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

If no open non-draft PRs remain, report
`[review:resolve-stack] No open PRs found in current Graphite stack.` and exit
successfully — there is nothing to walk.

### Step 3: Walk the stack

For each PR in the base-to-tip list, in order, do the following. **No pauses
anywhere in this loop** — log failures and continue.

1. **Checkout** — `gt checkout <branch>`. If it fails (branch missing locally,
   stack in a bad state): log
   `[review:resolve-stack] checkout failed for <branch>; skipping` and continue
   to the next PR.

2. **Resolve** — invoke the `Skill` tool with `skill: "review:resolve"` and
   `args: "<PR#> --non-interactive"`. The skill name is `review:resolve` (the
   `name:` frontmatter value of `resolve-pr.md`) — NOT the filename
   `resolve-pr`, which would silently fail to invoke. The `--non-interactive`
   flag suppresses that command's spawn-cap, CONFLICT, and push-confirmation
   gates so it resolves, commits, and `gt submit`s without prompting.

3. **Self-verify** — the `Skill` tool returns no machine-readable exit status,
   so re-fetch the PR's unresolved-comment count independently. Capture the
   script output to a temp file and check its exit code *before* parsing —
   piping straight into `jq` would mask a non-zero exit from `get-pr-comments`
   (an auth / 429 / network failure that emits empty output would otherwise
   look like "0 unresolved = fully resolved"). This block is self-contained:

   ```bash
   PC_OUT=$(mktemp)
   "${CLAUDE_PLUGIN_ROOT}/skills/pr-review-workflow/scripts/get-pr-comments" "<owner/repo>" "<PR#>" >"$PC_OUT" 2>"$PC_OUT.err"
   PC_EC=$?
   if [ "$PC_EC" -ne 0 ]; then
     printf '[review:resolve-stack] PR #<PR#>: self-verify inconclusive (get-pr-comments exit %s)\n' "$PC_EC" >&2
     cat "$PC_OUT.err" >&2
   else
     jq 'length' "$PC_OUT"
   fi
   rm -f "$PC_OUT" "$PC_OUT.err"
   ```

   On exit 0: `0` → the PR is fully resolved; `>0` → that many threads remain,
   record the count and flag the PR for the "Needs manual attention" section.
   On non-zero exit: record the PR's verification as `inconclusive` with the
   stderr output and flag it for "Needs manual attention".

4. **Restack** — `gt upstack restack`. If it reports a conflict: do not pause —
   run `gt abort` to clear the conflicted restack (without this, the repo stays
   mid-rebase and the next iteration's `gt checkout` fails), record the
   conflict for the final summary, and continue to the next PR.
   Downstream PRs may then rest on an unrestacked base; the summary surfaces
   this so the user can restack manually.

5. **Record a summary row** for this PR: PR number, comments found (from the
   `/review:resolve` output if available), remaining unresolved (from step 3),
   push status, restack status.

### Step 4: Final aggregate summary

Print a table with one row per PR walked:

```text
PR#  | comments found | remaining unresolved | push status | restack status
```

Then totals: PRs walked, PRs fully resolved (remaining == 0), PRs with
residual comments, PRs skipped (no open PR / draft / checkout failure).

Finally, a **Needs manual attention** section listing every PR with: residual
unresolved comments (`>0` from step 3), a restack conflict, a `gt submit`
failure, an inconclusive self-verify, or a `skipped (cluster cap)` note
surfaced by `/review:resolve`. If that section is empty, print
`[review:resolve-stack] All open PRs in the stack are fully resolved.`

**Exit code contract.** Exit `0` only when every walked PR is fully resolved —
the "Needs manual attention" section is empty. Exit `1` when that section is
non-empty, so a parent agent or CI step can distinguish a clean stack from one
that needs follow-up without parsing the prose table. Pre-flight failures
(Step 1) exit non-zero; "no open PRs found" (Step 2) exits `0` — nothing to do
is not a failure.

## Error Handling

- **`gt` / `gh` not installed, `gh` not authenticated, dirty working tree** —
  Step 1 pre-flight fails fast with a named error before the walk begins.
- **Not in a Graphite stack / empty stack** — Step 2 reports "No open PRs
  found in current Graphite stack." and exits 0.
- **`gt checkout` failure mid-walk** — log and skip that PR, continue.
- **A mid-walk PR's resolve leaves the working tree dirty** — `/review:resolve`
  hard-stops on a dirty tree at its Step 2. If a prior PR's resolve failed
  partway (e.g. `gt modify` failed, or a resolver left an untracked file), the
  next PR's `/review:resolve` invocation stops itself before doing any work.
  Record that PR as skipped (its self-verify count still reflects its pre-walk
  state, so flag it `inconclusive`) and continue. Surface it in the "Needs
  manual attention" section.
- **PR merged or closed between stack-build and the walk reaching it** —
  `/review:resolve` detects the non-open state and reports; record the PR as
  skipped and continue.
- **Restack conflict** — run `gt abort` to clear the conflicted restack,
  continue to the next PR, surface in the summary. The walk never pauses.
- **`gt submit` failure inside `/review:resolve`** — surfaced in that command's
  output and re-checked by the self-verify count; record in the summary,
  continue.
- **ruvector MCP unavailable** — the Step 1 recall is best-effort and skipped
  silently.
- **Re-run safety** — running `/review:resolve-stack` again is safe: PRs with
  no unresolved comments are silent no-ops in `/review:resolve`, so a second
  pass over a resolved stack just re-verifies and exits.

See the `pr-review-workflow` and `stack-traversal` skills for the shared
conventions this command builds on.
