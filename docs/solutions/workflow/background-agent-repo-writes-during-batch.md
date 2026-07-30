---
title: 'Background agents writing repo files during a long multi-branch batch need path-pinning, not just a "don''t delete" line'
date: 2026-07-30
category: workflow
track: knowledge
problem: >-
  Across a single /review:sweep-all batch spanning 6 PRs, a background
  knowledge-compounder wrote a docs/solutions/ file into the shared worktree
  after the session had already switched to a different PR's branch, and a
  second compounder died mid-write on a monthly spend limit, leaving a
  broken-YAML doc on disk — both were caught by a human, not by any gate
tags:
  - background-agents
  - shared-worktree
  - batch-pipeline
  - review-sweep
  - knowledge-compounding
  - branch-scope
components:
  - yellow-review
  - yellow-core
  - docs/solutions
related:
  - docs/solutions/code-quality/parallel-multi-agent-review-orchestration.md
  - docs/solutions/workflow/worktree-batch-pipeline-branch-held-elsewhere.md
---

# Background agents writing repo files during a long multi-branch batch need path-pinning, not just a "don't delete" line

## Problem

A `/review:sweep-all` run walked 6 PRs (#676–#681) sequentially in the same
session, switching the working tree's checked-out branch once per PR. Each
PR spawned its own `knowledge-compounder` background agent to write a
`docs/solutions/<category>/<slug>.md` file once that PR's review/resolve
work landed. Two independent failures surfaced from the same root cause —
a background agent holding a write intent against a checkout that keeps
moving underneath it:

1. **Wrong-branch scope pollution (#679).** A compounder spawned for an
   earlier PR finished writing its doc file *after* the session had already
   checked out a different PR's branch. A later `git add docs/solutions/`
   (adding by directory, not by exact path) swept the stray file into the
   wrong PR's commit. It had to be removed from that commit and re-landed
   on the correct branch.
2. **Broken-YAML landmine (#678).** A compounder hit a monthly spend limit
   mid-write, partway through emitting frontmatter. The half-written file
   was left on disk with invalid YAML. It was salvaged and hand-repaired in
   a later session rather than being caught by any automated check.

Neither failure is really about *this specific* compounder implementation —
both are the general shape of "a background agent has a pending filesystem
write, and the checkout it's writing into changes state (branch, or existence
of the process itself) before that write completes and is committed."

## Why this is a distinct risk from the scratchpad-deletion guard

MEMORY.md's `parallel-reviewer-shared-scratchpad-deletion-guard` entry (the
companion memory to
`docs/solutions/code-quality/parallel-multi-agent-review-orchestration.md`)
covers a sibling agent *deleting* shared context files mid-run, corrupting
other readers. This is the inverse hazard: a background
agent *writing* a new file, where the danger isn't a collision with a
sibling, but with the orchestrating session's own branch switch or an
interrupted process. `git add docs/solutions/` — a normal, low-risk-looking
convenience for solution docs specifically — is exactly the mechanism that
turns a stray file from a no-op into cross-PR scope pollution.

## Prevention

1. **Stage by exact path, never by directory, when a background writer may
   still be in flight.** `git add docs/solutions/<category>/<exact-file>.md`,
   not `git add docs/solutions/` or `git add -A`. This is already the
   general committing convention (see the global git-safety rules), but it
   is easy to forget specifically for `docs/solutions/` because adding "the
   solutions directory" reads as safe — it's append-only content, not
   application code. The #679 incident shows it isn't safe when another
   branch's background writer shares the same working tree.
2. **Before committing on any branch during a multi-branch batch, check
   `git status` for untracked/modified files under `docs/solutions/` that
   don't belong to the current PR's diff.** A file present that the current
   session didn't intentionally create is a signal a background writer from
   an earlier step landed after the branch switch — verify before adding.
3. **Parse the new file's frontmatter directly against the worktree copy
   before treating a compounder's write as done — don't rely on
   `pnpm validate:solutions` for this.** That script diff-scopes against
   committed content (`git diff <base>...HEAD` in
   `scripts/validate-solutions.js`), so a file that's still untracked or
   unstaged — exactly the state right after a background agent reports
   completion — is invisible to it; it will report "0 files checked"
   instead of catching a malformed write. Parse the frontmatter in place
   instead, e.g.
   `node -e "require('yaml').parse(require('fs').readFileSync(process.argv[1],'utf8').match(/^---\n([\s\S]*?)\n---/)[1])" docs/solutions/<category>/<slug>.md`.
   A spend-limit death mid-write produces a file that looks complete at a
   glance (has a title, a body) but fails to parse — the kind of defect a
   human skimming the diff will miss and a mechanical check catches
   immediately. `pnpm validate:solutions` diffs `<base>...HEAD`, so
   staging alone still doesn't make the file visible to it — only a
   **commit** does. To run the full schema gate against worktree content
   before committing, inject the path directly:
   `VALIDATE_SOLUTIONS_DIFF=$'A\t<path>' pnpm validate:solutions`.
4. **Prefer deferring repo-file writes to the foreground/orchestrating
   session when a batch spans multiple branches**, rather than trusting a
   background agent to land them autonomously. Both compounders in this
   batch wrote their `docs/solutions/` file directly from the background
   process — #679's compounder finished its write after the session had
   already switched branches, and #678's compounder died mid-write on a
   spend limit. Neither failure could occur if the background agent
   instead handed its content back to the foreground session (e.g. via a
   scratchpad file) and let the orchestrator commit it once the checkout
   was known to be stable.

## Generalizes to

Any orchestration pattern that spawns a background agent to write into the
same git checkout the foreground session keeps mutating — not just
knowledge-compounders, not just `docs/solutions/`. The two concrete guards
that transfer directly: stage by exact path during multi-branch batches, and
validate structurally (schema/YAML parse) before trusting a background
write, rather than eyeballing it.
