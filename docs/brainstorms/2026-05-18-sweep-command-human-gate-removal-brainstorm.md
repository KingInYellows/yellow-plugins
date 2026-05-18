---
status: Superseded by plans/sweep-no-gate-and-sweep-all.md (scope expanded during /workflows:plan)
date: 2026-05-18
topic: sweep command human-gate removal + sweep-all new command
---

## Post-SpecFlow Scope Additions (2026-05-18)

During `/workflows:plan` SpecFlow analysis, two scope expansions were
confirmed by the user via AskUserQuestion:

1. **`sweep` passes `--non-interactive` to `/review:resolve`** — resolve's own
   spawn-cap, CONFLICT, and push gates would otherwise still fire inside the
   sweep wrapper, defeating the unattended intent. The brainstorm specified
   only the between-step gate removal; this adds suppression of resolve's
   internal gates as well.
2. **New `--non-interactive` flag added to `/review:pr`** — `/review:pr`'s
   Step 9 push gate and Step 9b "save learnings" prompt would still pause
   the loop per PR. Adding the flag (and forwarding it from sweep) achieves
   true fire-and-forget. This expands the scope to a third file
   modification beyond the two originally in the brainstorm.

Authoritative spec for implementation is `plans/sweep-no-gate-and-sweep-all.md`.

## What We're Building

Two related changes to the `yellow-review` plugin:

1. **Remove the human gate from `/review:sweep`** — the `AskUserQuestion`
   confirmation at Step 3 ("Did /review:pr complete cleanly? Proceed or Stop?")
   is replaced with unconditional auto-proceed. `sweep` becomes a
   fire-and-forget command: run `/review:pr`, then always run `/review:resolve`
   on the same PR, no gate in between.

2. **Add `/review:sweep-all`** — a new command that discovers all of the user's
   open, non-draft PRs (same scope as `review:all scope=all`) and runs
   `/review:sweep` on each sequentially, with a single upfront M3 confirmation
   (PR count + titles) before the loop starts and a skip-and-continue failure
   policy with an end-of-loop summary.

## Why This Approach

The gate in `sweep` exists because the `Skill` tool returns no programmatic
success signal — the command cannot tell whether `/review:pr` failed, the user
declined its push-confirmation gate, or it succeeded. In practice this
limitation means the human must watch and manually confirm. The user has decided
this protection is outweighed by the friction cost: the whole point of `sweep`
is unattended automation. Any post-hoc cleanup after a resolve-on-broken-review
is acceptable.

`sweep-all` needs to exist as a separate command (rather than a `scope=all`
flag on `sweep`) because it introduces a qualitatively different contract:
multi-PR enumeration, an upfront batch confirmation, and a loop with failure
handling. Conflating that with the single-PR `sweep` contract would add
complexity to a command that is intentionally simple.

## Key Decisions

1. **sweep: unconditional auto-proceed, no gate, no --gate flag** — the gate is
   removed entirely. Adding an opt-in `--gate` flag would complicate the command
   and split the mental model; the simpler contract (always proceed) is
   sufficient.

2. **sweep-all: scope mirrors `review:all scope=all`** — own open non-draft PRs
   (`gh pr list --author @me --state open`, filter `isDraft == false`), ordered
   by PR number ascending. "Every open PR" scope was rejected (see below).

3. **Upfront M3 gate (count + titles) before sweep-all loop starts** — a single
   `AskUserQuestion` showing PR count and title list before any sweep runs. This
   is the only human confirmation in the entire loop. Accepted that this can
   push commits to N branches on a single "Yes".

4. **Mid-loop failures: skip + continue + end-of-loop summary** — if sweep
   fails or errors on a given PR, that PR is skipped, the loop continues to the
   next PR, and a summary table (succeeded / skipped / reason) is printed after
   the final iteration. The user accepted post-hoc cleanup over stopping the
   loop.

5. **Per-PR gate from `review:all` Step 11 is stripped** — `review:all` has its
   own per-PR push-confirmation gate at Step 11. `sweep-all` does not inherit
   it; the upfront M3 gate replaces all per-PR confirmation. Keeping Step 11
   would re-introduce the per-PR friction that motivated removing the gate from
   `sweep` in the first place.

6. **End-of-loop `/workflows:compound` after sweep-all only** — after the final
   PR in the `sweep-all` loop and after the summary table is printed, invoke
   `/workflows:compound` once with the aggregated per-PR findings as input.
   Single-PR `sweep` does NOT auto-compound (the user can run
   `/workflows:compound` manually when warranted). Rationale: unattended batch
   runs would otherwise lose hot-context learnings; one consolidated pass
   minimizes MEMORY.md churn vs. N per-PR passes.

## Approaches Considered and Rejected

### Fail-closed success-marker detection (instead of unconditional proceed)

Instead of removing the gate, instrument `/review:pr` to write a success marker
file that `sweep` could read to detect clean completion without asking the user.

**Rejected because:** this requires modifying a separate command's internals
(`review:pr` / `review-pr.md`) and the marker file approach is fragile across
worktrees. The user explicitly wants the simpler contract — just proceed.

### `--gate` flag opt-in (instead of always-auto)

Keep the `AskUserQuestion` as the default but add `--gate` or `--no-gate` to
let the user choose at invocation time.

**Rejected because:** adds surface area and flags-based branching to a command
that should have one clear contract. If the user wants a gate, they run
`/review:pr` and `/review:resolve` separately.

### "Every open PR" scope for sweep-all (instead of `@me` + drafts excluded)

Make `sweep-all` operate on all open PRs in the repo, not just the author's.

**Rejected because:** reviewing and resolving threads on other authors' PRs is
out of scope for a personal automation command and risks unintended commits to
branches the user does not own.

### CI-green-only filter for sweep-all

Before sweeping a PR, check CI status and skip red PRs automatically.

**Rejected because:** this adds a prerequisite API call per PR and changes the
semantics of the command from "run sweep on my open PRs" to "run sweep on my
CI-green open PRs." The user can filter manually from the upfront title list.
YAGNI.

### Per-PR gate inside sweep-all loop

After printing the upfront list, prompt before each individual PR: "Proceed
with sweep on PR #N?"

**Rejected because:** this recreates the same friction that motivated removing
the gate from `sweep`. One upfront confirmation is the correct boundary.

### Per-PR `/workflows:compound` after each sweep (instead of end-of-loop)

Run `/workflows:compound` after every PR's sweep — including the single-PR
`sweep` command — to capture learnings while context is hot per-PR.

**Rejected because:** `/workflows:compound` is heavy (subagent spawn + writes
to MEMORY.md and `docs/solutions/`). Running it N times in an unattended loop
multiplies runtime and produces churn against the same MEMORY.md across
iterations. Most sweeps on clean PRs yield zero compoundable learnings, so
per-PR compound is high-noise. One consolidated end-of-loop pass over the
aggregated per-PR findings is the right granularity.

### No compound at all (manual only)

Leave sweep and sweep-all alone; the user runs `/workflows:compound` manually
when they want to capture learnings.

**Rejected because:** unattended `sweep-all` runs are exactly where learnings
would otherwise evaporate — the user is not watching, context is gone by the
time they look at the result. Auto-running compound once at the end of
`sweep-all` is the minimum intervention that closes the loop without bloating
either command.

## Affected Files

| File | Change |
|---|---|
| `plugins/yellow-review/commands/review/sweep.md` | Modify: remove Step 3 `AskUserQuestion` gate and its error-handling prose |
| `plugins/yellow-review/commands/review/sweep-all.md` | New file |
| `plugins/yellow-review/CLAUDE.md` | Update Component Catalog table to add `sweep-all` row |
| `plugins/yellow-review/README.md` | Add `sweep-all` to command list |
| `plugins/yellow-review/.claude-plugin/plugin.json` | No change — yellow-review uses auto-discovery; no `commands` array exists. Version bump applied via Changesets flow only. |
| `plugins/yellow-review/package.json` | Minor version bump (coordinated with plugin.json) |
| `.claude-plugin/marketplace.json` | Version bump for yellow-review |
| `plugins/yellow-core/commands/setup/all.md` | Likely no change — `sweep-all` is yellow-review internal, not a new plugin |
| `.changeset/<hash>.md` | New changeset required — validate-plugins gate blocks PR without it |

## Pointers

- **Gate location in sweep.md:** Lines ~100-130, section `### Step 3: Confirm
  clean completion (failure-boundary gate)`. The `AskUserQuestion` call is at
  approximately line 107. The gate's prose rationale starts at line 100.
- **PR-enumeration in review-all.md:** Lines ~57-63, section `scope=all` under
  `### Step 1: Resolve PR List`. The `gh pr list --author @me --state open
  --json number,headRefName,isDraft` command is at approximately line 60;
  the `isDraft == false` jq filter is at line 63.

## Risks the User Accepted

These were surfaced and explicitly accepted — `/workflows:plan` should not
re-open them:

- **Resolve can run on a broken /review:pr result.** If `/review:pr` fails
  silently or the user's push-confirmation gate inside it was declined, `sweep`
  will still invoke `/review:resolve` on the same PR. The user accepts that this
  may produce a no-op resolve or resolve threads against a stale review state,
  requiring post-hoc cleanup.

- **sweep-all can push commits to N branches with only one upfront
  confirmation.** The single M3 gate before the loop does not re-prompt per PR.
  If the user confirms a list of 8 PRs, all 8 will have review fixes committed
  and pushed without further interaction.

## Open Questions

None that block implementation. One edge case worth noting for the implementation
author:

- **sweep-all empty-list handling:** if `gh pr list` returns zero PRs after
  filtering, the command should exit cleanly with a "No open PRs found." message
  and NOT show the M3 confirmation (confirming zero PRs is confusing). This is
  consistent with `review:all` behavior at line 70 of review-all.md.

## Acceptance Criteria

1. `sweep.md` no longer contains the `AskUserQuestion` call at Step 3. The
   command proceeds from Step 2 (`/review:pr`) directly to Step 4
   (`/review:resolve`) unconditionally. Step 3 is removed entirely (including
   its error-handling branches for Stop / dismiss / timeout outcomes).

2. `sweep-all.md` exists and satisfies all of the following:
   - Enumerates PRs using the same `gh pr list --author @me --state open
     --json number,headRefName,isDraft` call and `isDraft == false` jq filter as
     `review:all scope=all`
   - Runs `/review:sweep` (not `/review:pr` + `/review:resolve` individually)
     on each PR sequentially
   - Has an upfront `AskUserQuestion` M3 confirmation showing PR count and
     title list before the loop starts; exits cleanly if user cancels
   - Handles mid-loop failures with skip + continue (no loop abort)
   - Prints an end-of-loop summary table (PR number, outcome, skip reason if
     applicable)
   - Exits cleanly with a "No open PRs found." message when the filtered list is
     empty, without showing the M3 confirmation

3. `pnpm validate:plugins` passes.

4. `pnpm validate:agents` passes (frontmatter fields, description single-line,
   tools list includes every tool referenced in the body).

5. A changeset file is present under `.changeset/` for a minor version bump on
   `yellow-review`.

6. `plugins/yellow-review/CLAUDE.md` Component Catalog table includes a row for
   `sweep-all`.

7. `sweep-all.md` invokes `/workflows:compound` exactly once after the
   end-of-loop summary table is printed, passing the aggregated per-PR
   findings as input. The single-PR `sweep` command does NOT invoke compound.
   Compound is skipped (not invoked) when zero PRs were swept (empty-list
   exit) or when all PRs were skipped due to errors.
