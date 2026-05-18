---
name: review:sweep
description: 'Run /review:pr then /review:resolve on the same PR in one unattended pass — no gates, no per-step prompts. Use when you want both an AI review pass and cleanup of any open bot or human reviewer comment threads without manually re-invoking on the same PR number.'
argument-hint: '[PR# | URL | branch]'
allowed-tools:
  - Bash
  - Skill
---

# Sweep: Review + Resolve in One Unattended Pass

Run a full review-and-cleanup pass on a single PR: invoke `/review:pr
--non-interactive` for adaptive multi-agent code review with autonomous fix
application AND autonomous push, then `/review:resolve --non-interactive`
for parallel resolution of all open reviewer comment threads with no
spawn-cap, CONFLICT-surfacing, or push gates. Both skills run against the
same PR with no human gates anywhere — sweep is fire-and-forget by design.

Use when you want both an AI review pass and cleanup of any open bot or
human comment threads in a single unattended invocation. Use `/review:pr`
directly (without the flag) to keep its push-confirmation gate, or
`/review:resolve` directly to keep its spawn-cap and push gates. For
batch sweeping every open PR you authored, use `/review:sweep-all`. For
multi-PR or stack-wide pipelines with compounding, use `/review:all`.

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
pre-flight check fails fast before any unattended Skill invocation):

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

### Step 2: Run /review:pr --non-interactive

Invoke the `Skill` tool with `skill: "review:pr"` and `args: "<PR#>
--non-interactive"`. Wait for it to complete.

The `--non-interactive` flag suppresses `/review:pr`'s Step 9
push-confirmation prompt and its Step 9b "save learnings to memory"
prompt — so the review runs unattended end-to-end. `/review:pr` still
runs its full pipeline (adaptive agent selection, parallel multi-agent
review, autonomous P0/P1 fix application, auto-push via `gt submit`,
final report); only the human prompts are suppressed.

### Step 3: Run /review:resolve --non-interactive

Invoke the `Skill` tool with `skill: "review:resolve"` and `args:
"<PR#> --non-interactive"`. The skill name is `review:resolve` (the
value of the `name:` frontmatter field in `resolve-pr.md`) — do NOT
use `review:resolve-pr`, which is the filename, not the slash-command
name, and would silently fail to invoke the skill.

The `--non-interactive` flag suppresses `/review:resolve`'s Step 4
spawn-cap gate, Step 5 CONFLICT-surfacing gate, and Step 6
push-confirmation gate. The Skill tool returns no machine-readable exit
status, so the wrapper cannot programmatically detect whether
`/review:pr` errored or its fixes weren't pushed — sweep proceeds
unconditionally; if `/review:pr` left no fixes to resolve against,
`/review:resolve` will simply find fewer threads to address. Post-hoc
cleanup is the user's responsibility (this risk is documented in the
plan that authored the gate removal).

`/review:resolve` fetches all unresolved review threads on the PR via
GraphQL (no author-type filter — both bot and human threads are
addressed) and routes each thread through a `pr-comment-resolver` agent
that either submits a fix or posts a false-positive response and marks
the thread resolved.

### Step 4: Final summary

Reached after Step 2 (`/review:pr`) and Step 3 (`/review:resolve`) have
run. Print a summary line for the run:

```text
[review:sweep] PR #<PR#>
  Review:  completed (unattended; see /review:pr output above)
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
  pre-flight check fails fast before any unattended Skill invocation.
- **`/review:pr` failed silently**: with the human gate removed, sweep
  proceeds to `/review:resolve` unconditionally. If `/review:pr`'s push
  failed or fixes weren't applied, `/review:resolve` may find unexpected
  state — inspect its output and re-run components manually if needed.
- **`/review:resolve` returns no extractable summary**: report
  `Resolve: completed (output unavailable — see above)` rather than
  synthesizing one.
- **Zero unresolved threads** is a clean outcome — `/review:resolve`
  reports that as success and `/review:sweep` does the same.
