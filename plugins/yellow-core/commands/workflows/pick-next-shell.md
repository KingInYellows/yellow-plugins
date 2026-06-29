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
  exit 0
fi
if ! ls plans/shells/*.md >/dev/null 2>&1; then
  printf 'All shells have been expanded and shipped — the spec is complete.\n'
  printf 'Run /plan:status to verify the shell-derived plans are in plans/complete/.\n'
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
satisfied. Pick the lowest `NN` filename prefix. On a tie, choose via
AskUserQuestion.

## Step 3: Deadlock / Unsatisfiable Detection

If there are no candidates but unexpanded shells remain, do NOT return silently.
First, set those split-state shells aside: a shell with a corresponding
`plans/<shell-slug>.md` already present was expanded but its file was not
cleaned up — report each one separately ("Shell `<slug>` is expanded but its
shell file remains; delete `plans/shells/<file>` to clean up") and EXCLUDE it
from the deadlock graph, so it cannot cause a false cycle/unsatisfiable report.
Then, over the remaining non-split shells, build the dependency graph from their
`depends_on` and run a topological pass (Kahn's algorithm — process
in-degree-zero nodes; any node with nonzero in-degree at the end is part of a
cycle):

- **Cycle:** report it explicitly, e.g. "Deadlock — `<a>` depends on `<b>`,
  `<b>` depends on `<a>`. No order satisfies both; edit a `depends_on` to break
  the cycle." Then stop.
- **Unsatisfiable dependency:** a `depends_on` slug present in neither
  `plans/shells/` nor `plans/complete/`. Report each by name and offer recovery
  via AskUserQuestion: treat-as-satisfied (unblock dependents) / re-run
  `/workflows:decompose` / edit the dependent shell's frontmatter. Then stop.

## Step 4: Expand the Picked Shell

Invoke the Skill tool with `skill: "workflows:expand-shell"` and `args` set to
the picked shell path. This writes `plans/<shell-slug>.md` and deletes the shell
after your approval. Then check your task list and proceed to Step 5.

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

- Never edit plans or shells directly; never modify the spec.
- Never auto-implement the plan — halt for a fresh `/workflows:work` session.
- Never return silently when shells remain but none are pickable — always report
  the deadlock or unsatisfiable dependency (Step 3).
