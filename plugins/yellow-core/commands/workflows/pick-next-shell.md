---
name: workflows:pick-next-shell
description: Pick the lowest-numbered shell whose dependencies are archived in plans/complete/, expand it via /workflows:expand-shell, capture learnings, and halt for a fresh /workflows:work session. Reports deadlocks and the terminal state explicitly.
argument-hint: ''
allowed-tools:
  - Bash
  - Read
  - Glob
  - Skill
  - AskUserQuestion
---

# /workflows:pick-next-shell

Orchestrate the next unit of work in a spec→shells project: find the next
unblocked shell, expand it into a plan, capture planning learnings, then halt so
a fresh session implements it. Run this repeatedly — each archived plan unblocks
the next shell.

## Step 1: Scan + Terminal / Missing-Dir Guards

```bash
if [ ! -d plans/shells ]; then
  printf 'No shells directory found. Run /workflows:decompose first.\n' >&2
  exit 1
fi
# Distinguish an unreadable dir from an empty one, so a permission error is not
# misreported below as "all shells expanded".
[ -r plans/shells ] || {
  printf '[pick-next-shell] Error: plans/shells/ is not readable.\n' >&2
  exit 1
}
if ! ls plans/shells/*.md >/dev/null 2>&1; then
  printf 'All shells have been expanded — no shell files remain in plans/shells/.\n'
  printf 'Run /plan:status to confirm the shell-derived plans are archived in plans/complete/.\n'
  exit 0
fi
```

Glob `plans/shells/*.md` and read each shell's frontmatter (`depends_on`).

## Step 2: Compute Candidates (exact-match oracle)

A `depends_on` entry `<dep-slug>` is **satisfied** when a file exists in
`plans/complete/` whose basename matches
`^([0-9]{4}-[0-9]{2}-[0-9]{2}-)?<dep-slug>\.md$` (exact slug after stripping an
optional `YYYY-MM-DD-` archival prefix) — exact match, never substring
containment.

**Split-state skip:** if both `plans/<shell-slug>.md` and the shell file exist,
the shell was expanded but its file was not cleaned up — skip it (do not
re-expand).

Candidates = shells (not in a split state) whose every `depends_on` entry is
satisfied. Pick the candidate with the numerically lowest `NN` — the numeric
segment after the `<spec-slug>-` prefix, NOT the leading characters of the
filename (a full-filename sort ranks by spec slug first when `plans/shells/`
holds shells from more than one spec). On a tie, choose via AskUserQuestion.

## Step 3: Deadlock / Unsatisfiable Detection

If there are no candidates but unexpanded shells remain, do NOT return silently.
Run the checks below **in this order** — each classifies a distinct failure
mode and prunes its edges before the next runs, so the same shell never produces
two contradictory diagnoses (e.g. an unsatisfiable dep being miscounted as a
cycle participant):

1. **Split-state shells.** A shell with a corresponding `plans/<shell-slug>.md`
   already present was expanded but its file was not cleaned up — report each
   ("Shell `<slug>` is expanded but its shell file remains; delete
   `plans/shells/<file>` to clean up") and EXCLUDE it from the deadlock graph.
2. **Blocked on a split-state shell.** If a remaining non-split shell's
   `depends_on` names a split-state shell's slug (present in `plans/shells/` but
   not yet in `plans/complete/`), report it as "blocked on split-state shell
   `<slug>` — clean that shell up first" and stop. Without this check such a
   shell is neither a candidate, a cycle, nor unsatisfiable, and execution would
   fall through to Step 4 with no shell picked.
3. **In-progress or unsatisfiable dependency.** A `depends_on` slug present in
   neither `plans/shells/` nor `plans/complete/` — split into two sub-cases so
   an in-progress dep is not misreported as missing:
   - **In progress:** `plans/<dep-slug>.md` exists (the dep's shell was expanded
     and deleted, but the resulting plan has not been archived yet). Report
     "blocked on in-progress plan `plans/<dep-slug>.md` — implement it and run
     `/plan:complete`, then re-run `/workflows:pick-next-shell`." and stop. Do
     NOT treat it as unsatisfiable (a dep is satisfied only once archived in
     `plans/complete/`, but an open plan means work-in-flight, not a missing
     requirement).
   - **Unsatisfiable:** no plan exists anywhere for the slug. Report each by
     name, REMOVE its edges from the graph (so it is not later miscounted as a
     cycle node), then offer recovery via AskUserQuestion: re-run
     `/workflows:decompose` / edit the dependent shell's frontmatter yourself /
     Cancel (stop and reconcile manually). Then stop. (Do not offer a "treat as
     satisfied" option — acting on it would require editing a shell, which the
     Rules forbid.)
4. **Cycle.** Over the remaining non-split shells, with split-state and
   unsatisfiable edges already pruned, build the dependency graph and run a
   topological pass (Kahn's algorithm — process in-degree-zero nodes; any node
   with nonzero in-degree at the end is part of a true cycle). Report it
   explicitly, e.g. "Deadlock — `<a>` depends on `<b>`, `<b>` depends on `<a>`.
   No order satisfies both; edit a `depends_on` to break the cycle." Then stop.

## Step 4: Expand the Picked Shell

Invoke the Skill tool with `skill: "workflows:expand-shell"` and `args` set to
the picked shell path. This writes `plans/<shell-slug>.md` and deletes the shell
after your approval.

The Skill tool returns no reliable exit status, so verify the expansion actually
produced a plan before continuing — `/workflows:expand-shell` may stop early
(spec-drift Stop, an unreconciled `Consumes` failure, a Revise choice, or a
Skill error). Substitute the actual `<shell-slug>` inline:

```bash
[ -f "plans/<shell-slug>.md" ] || {
  printf '[pick-next-shell] expand-shell did not produce plans/<shell-slug>.md — it stopped early or failed. Resolve the issue and re-run; not proceeding to learnings capture.\n' >&2
  exit 1
}
```

Only if the plan exists, check your task list and proceed to Step 5.

## Step 5: Capture Learnings (and optional enrich)

- If yellow-research is installed, optionally invoke the Skill tool with
  `skill: "workflows:deepen-plan"` and `args` set to the new plan path to enrich
  it. Skippable.
- Invoke the Skill tool with `skill: "workflows:compound"` to capture planning
  learnings (this is the yellow analogue of Turbo's self-improve step).

## Step 6: Halt

Print and stop — do not auto-implement:

> Plan ready at `plans/<shell-slug>.md`. Context is likely full — run `/clear`,
> then `/workflows:work plans/<shell-slug>.md`. Ship it, run `/plan:complete`,
> then `/workflows:pick-next-shell` for the next shell.

## Rules

- Never edit plans or shells directly; never modify the spec. (The
  `/workflows:expand-shell` you invoke in Step 4 may update a shell during its
  own spec-drift reconciliation — that is expand-shell's responsibility and is
  not a violation of this rule.)
- Never auto-implement the plan — halt for a fresh `/workflows:work` session.
- Never return silently when shells remain but none are pickable — always report
  the deadlock or unsatisfiable dependency (Step 3).
