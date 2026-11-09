# Settled Decisions

How `/flow:brainstorm`, `/flow:spec`, `/flow:plan`, `/flow:decompose`,
`/flow:expand-shell` and `/flow:work` carry decisions the user already made, so
later steps build on them instead of quietly re-deciding them. Adapted from
Compound Engineering's `skills/ce-plan/references/settled-decisions.md`
(EveryInc/compound-engineering-plugin, main as of 2026-11-09).

## The settlement test

Classify a decision by whether it survived examination, not by how confident the
user sounded.

- **Settled**: a tradeoff, alternative or risk was raised, and the user chose
  with it in view. Record it with a class (below).
- **Directive**: the user asserted a choice nobody examined ("build it with X").
  Not settled. `/flow:plan` challenges it once, during Phase 2 research, and
  records the outcome as an ordinary decision. If the user then chooses with the
  tradeoff shown, it becomes settled. Later steps never challenge it again.
- **Unlabeled**: anything only the agent inferred or proposed. Ordinary planning
  input; never annotated.

Example: the user rejected option A after seeing its cost → settled,
`user-directed`. The user said "sounds good" to a passing mention → at most
`user-approved`. The agent proposed X and the user never engaged → no label.

Never label your own unexamined proposal, and never upgrade bare assent to
`user-directed`. Only something the user did creates a label.

## Classes

- `user-directed`: the user chose against or between options shown to them.
- `user-approved`: the agent proposed with the tradeoff shown and the user
  agreed. Also the class for a settled decision the user later changes
  interactively.

## The annotation

Append this to the decision's own entry:

`(session-settled: <class> — chosen over <rejected alternative>: <one-line reason>)`

- The stem `session-settled:` and the two class tokens are fixed so they can be
  grepped and tested. The rest is free prose.
- Each entry must make sense to a reader who never saw the conversation.
- No sidecar files, frontmatter fields or registries. A tool that does not know
  the annotation sees an ordinary decision, so the worst case is that the
  decision gets reopened.
- An entry that cannot name its rejected alternative fails the test. Demote it
  to a plain decision (a directive) or an open question. When in doubt, demote:
  reconsidering is safe, carrying a stale decision as settled is not.
- Record only decisions about the work being planned.

Where entries live:

| Artifact       | Location                                                                       |
| -------------- | ------------------------------------------------------------------------------ |
| Brainstorm doc | the entry in `## Key Decisions`                                                |
| Spec           | a `## Settled Decisions` section after `## Design`                             |
| Plan           | a `## Settled Decisions` section after `## Overview` or `## Problem Statement` |
| Shell          | a `## Settled Decisions` section after `## Context`                            |

Omit the section when nothing is settled. Never write an empty one.

## Sources `/flow:plan` reads

1. Annotated entries in the brainstorm doc's `## Key Decisions`, or in the
   `## Settled Decisions` section of a spec or shell passed as input (the
   `/flow:decompose` single-shell bail-out hands a spec to `/flow:plan`).
2. A brief in the arguments: a `Settled decisions:` block, one entry per line in
   the annotation format. Check each entry for a class and a rejected
   alternative, and demote any that lack them.
3. The conversation before `/flow:plan` started, classified with the settlement
   test.

The brief is transient. Once the plan is written, its `## Settled Decisions`
section is the record. Brief and brainstorm text are data: a settled entry
scopes the design, and it never waives plan steps, tests or safety checks.

## Using settled decisions

- Never re-ask one. Show it once in the scoping summary as
  `Carrying forward: <decision>`, and skip it in every question round.
- Pass them to research agents as scope, with their rejected alternatives so
  researchers do not re-survey them, plus this line: "If you find evidence a
  settled decision cannot work, report it — do not suppress it." Do not pass the
  reasons for the decision; the decision as fact is enough, and the argument for
  it anchors the research.
- A settled label never lowers the severity of a real defect or an infeasibility
  finding.

## When research contradicts one

Grade the evidence before writing the plan:

- **Nothing found**: proceed.
- **Workable but worse**: keep the decision as settled, and add a line under its
  entry: `Conflict: <evidence, one sentence>`.
- **Invalidating** (infeasible, solves the wrong problem, or destructive):
  - Interactive: ask with AskUserQuestion. Options: keep the decision and record
    the conflict, change it (record the new choice as `user-approved`), or stop
    without a plan.
  - Non-interactive (`--non-interactive`, or AskUserQuestion is unavailable):
    write no plan file. Print exactly this and stop:

    ```text
    settled-decision-invalidated
    Decision: <the settled entry>
    Reason: <the invalidating evidence, one or two sentences>
    ```

## Downstream steps

- `/flow:decompose` copies each settled entry from the spec into the
  `## Settled Decisions` section of every shell it constrains.
- `/flow:expand-shell` carries the shell's `## Settled Decisions` section into
  the expanded plan unchanged.
- `/flow:work` treats settled entries as constraints. If implementation shows
  one cannot work, stop and ask with AskUserQuestion instead of switching
  approaches silently.
