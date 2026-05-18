---
name: review:sweep-all
description: 'Run /review:sweep on every open non-draft PR authored by the current user, sequentially, with one upfront confirmation. Use when you want to clear review + resolve backlog across all your open PRs in one batch.'
argument-hint: ''
allowed-tools:
  - Bash
  - AskUserQuestion
  - Skill
---

# Sweep All: Batch /review:sweep Across Your Open PRs

Enumerate every open non-draft PR you authored, then run `/review:sweep` on
each one sequentially with no per-PR prompts. A single upfront
`AskUserQuestion` confirms the PR list before any work begins; the loop
runs unattended after that. Failures on individual PRs are logged and
skipped — the loop never pauses, never aborts. After all PRs are
processed, one `/workflows:compound` pass captures learnings from the
batch (skipped if zero PRs were swept).

Use when you want to clear review + resolve backlog across all your open
PRs in one batch. Each per-PR sweep runs `/review:pr --non-interactive`
then `/review:resolve --non-interactive` — fully unattended end-to-end
once you confirm the upfront list. For a single PR, use `/review:sweep`
directly. For multi-PR pipelines with deeper compounding per PR, use
`/review:all scope=all`.

## Workflow

### Step 1: Pre-flight

Run these prerequisite checks. Each Bash tool call is a fresh subprocess —
this block is self-contained.

```bash
set -u
command -v gh >/dev/null 2>&1 || {
  printf '[review:sweep-all] Error: GitHub CLI (gh) is not installed.\n' >&2
  exit 1
}
gh auth status >/dev/null 2>&1 || {
  printf '[review:sweep-all] Error: gh is not authenticated. Run `gh auth login`.\n' >&2
  exit 1
}
command -v jq >/dev/null 2>&1 || {
  printf '[review:sweep-all] Error: jq is not installed (required for PR filtering).\n' >&2
  exit 1
}
[ -z "$(git status --porcelain)" ] || {
  printf '[review:sweep-all] Error: uncommitted changes detected. Commit or stash first.\n' >&2
  exit 1
}
```

`gt` is not checked here — each per-PR sweep invocation runs its own
pre-flight and will surface a `gt` failure inline.

### Step 2: Enumerate open non-draft PRs

Query GitHub for the current user's open non-draft PRs, sorted by PR
number ascending:

```bash
set -u
gh pr list --author @me --state open \
  --json number,headRefName,isDraft,title \
  --jq '[.[] | select(.isDraft == false)] | sort_by(.number)'
```

Capture the JSON array result. Each element has `number`, `headRefName`,
`isDraft` (always `false` after filtering), and `title`. Substitute the
actual PR numbers and titles as literals in every later block (variables
do not survive across Bash tool calls).

**Empty-list early exit.** If the resulting array is empty (`[]` or
length 0), print:

```text
[review:sweep-all] No open non-draft PRs found. Nothing to sweep.
```

Then stop. Do NOT show the Step 3 confirmation gate (confirming zero
PRs is confusing). Exit 0 — nothing to do is not a failure.

### Step 3: Upfront confirmation gate

Use the `AskUserQuestion` tool with:

- **Question**: ``Found <N> open non-draft PRs authored by you. Run
  /review:sweep on each sequentially?``

  Followed by a body listing every PR:
  ```
  PRs to sweep:
    #<num1> — <title1>
    #<num2> — <title2>
    ...
    #<numN> — <titleN>
  ```
- **Options**:
  - **Proceed — sweep all N PRs** — continue to Step 4
  - **Cancel** — stop without running any sweep

If the user selects **Cancel** — OR the prompt is dismissed, times out,
or cannot be shown (non-interactive environment, Escape, no response) —
print:

```text
[review:sweep-all] Cancelled. No sweeps run.
```

Then stop and exit 0 (Cancel is a clean stop, not an error). Do NOT
proceed to Step 4 or any later step.

This is the only human prompt in the entire command. After Proceed,
sweep-all runs unattended until the summary is printed.

### Step 4: Sequential sweep loop

For each PR in the sorted list, in order from lowest PR number to
highest, do the following. **No pauses anywhere in this loop** — log
failures and continue.

For each iteration:

1. **Announce** — print
   `[review:sweep-all] Sweeping PR #<PR#> (<i>/<N>): <title>`
   where `<i>` is the 1-indexed position and `<N>` is the total count.
2. **Invoke sweep** — invoke the `Skill` tool with `skill: "review:sweep"`
   and `args: "<PR#>"`. The skill name is `review:sweep` (the value of
   the `name:` frontmatter field in `sweep.md`) — do NOT use
   `review:sweep-all` (the name of this command, which would silently
   fail to invoke) or any directory-based path.
3. **Record outcome** for the summary table:
   - If the Skill call returned and no exception was raised in the
     surrounding Bash blocks: outcome is `swept`. (The Skill tool returns
     no machine-readable exit status, so any errors inside the sweep
     bubble up only via stderr — they do not raise an exception at the
     sweep-all level. A "completed" outcome here means the wrapper ran,
     not that every internal step succeeded.)
   - If a pre-Skill or post-Skill check in the surrounding Bash raised an
     error (e.g., the PR was closed/merged between enumeration and
     invocation, the working tree became dirty mid-loop): outcome is
     `skipped — <one-line reason>`.
4. **Continue** to the next PR. Do not pause, do not prompt, do not
   abort the loop on per-PR failures.

The PR number and title for each iteration must be substituted as
literal values in the announce print and the Skill invocation. Bash
variables do not survive across separate Bash tool calls.

### Step 5: End-of-loop summary table

Print a pipe-delimited markdown summary table:

```text
[review:sweep-all] Summary

| PR# | Title                           | Outcome | Skip Reason |
|-----|---------------------------------|---------|-------------|
| 123 | feat(yellow-debt): add scanner  | swept   |             |
| 124 | fix(yellow-ci): lint regression | swept   |             |
| 125 | refactor(yellow-core): split lib | skipped | PR closed before sweep |
| 126 | docs: update CLAUDE.md          | swept   |             |

Totals: Swept 3 | Skipped 1 | Total 4
```

Truncate long titles at ~30 characters with `…` if needed for table
readability. Both the table and the totals line are required.

### Step 6: Knowledge compounding (conditional)

**Skip guard (first line of this step):** If `swept_count == 0` — every
PR in the loop ended in `skipped` outcome, or the upfront list had only
errors — skip this step entirely. Do NOT invoke `/workflows:compound`.
Print:

```text
[review:sweep-all] Skipping /workflows:compound — no PRs swept.
```

Then stop.

Otherwise, with `swept_count >= 1`:

1. Invoke the `Skill` tool with `skill: "workflows:compound"` and
   `args: "sweep-all: swept PRs <comma-separated swept PR numbers>"`
   (e.g., `"sweep-all: swept PRs #123, #124, #126"`). The args string is
   a free-text hint; `/workflows:compound` reads the conversation
   context (last 25 turns) for the actual learning extraction.
2. If `/workflows:compound` exits non-zero (e.g., `docs/solutions/`
   directory missing — compound's own pre-flight check fails fast in
   that case), print:
   ```text
   [review:sweep-all] Warning: /workflows:compound failed; learnings not captured. (Run /workflows:compound manually if desired.)
   ```
   Then continue — do NOT fail the command. sweep-all succeeded; only
   the optional compounding step failed.

## Error Handling

- **Pre-flight failure** (gh missing, gh not authenticated, jq missing,
  dirty tree): exit non-zero with a named `[review:sweep-all] Error:`
  message. No enumeration or M3 gate is shown.
- **Empty PR list after filtering**: exit 0 with the
  `No open non-draft PRs found.` message. No M3 gate is shown.
- **User cancels at the M3 gate**: exit 0 with the `Cancelled.` message.
  No sweeps run.
- **Per-PR sweep failure mid-loop**: marked `skipped` in the summary
  with a short reason. Loop continues. The user can re-run `/review:sweep
  <PR#>` manually to inspect.
- **All PRs end up skipped**: summary table is still printed; compound
  is skipped (per Step 6's guard); exit 0. sweep-all itself succeeded —
  it correctly attempted every PR.
- **`/workflows:compound` failure**: warning is printed; sweep-all still
  exits 0. Compounding is best-effort, not load-bearing.
- **Concurrent invocations**: there is no explicit lock. The dirty-tree
  guard inside each per-PR sweep provides natural serialization — a
  second simultaneous `sweep-all` will hit a dirty tree if the first is
  mid-operation and mark every PR `skipped`. Avoid running two
  `sweep-all` instances at once.
