---
title:
  'Moving a Capability Across a Release-Phase Boundary Orphans Its Triggers,
  Owners, and Derived Artifacts — Term-Grep Propagation Misses Most of Them'
date: '2026-09-11'
category: 'code-quality'
track: 'knowledge'
problem:
  'One late planning decision that moved three mutating subcommands from PR2 to
  PR3 left seven sites across four documents still encoding the old boundary — a
  legend asserting when live evidence first arrives, a flag whose only trigger
  had moved away, a requirement demanding a dispatch branch in the earlier PR, a
  CI validator enforcing that demand, a test split encoded by positional prefix
  rather than by name, an escape path no shell owned any more, and a build list
  that compiles a mutating runtime one phase before its authority gate ships —
  even though a dedicated propagation commit had already swept the shell files
  for the moved terms'
tags:
  - spec-authoring
  - phase-split
  - stacked-prs
  - decision-propagation
  - orphaned-trigger
  - derived-artifacts
  - authority-gate
components:
  - docs/yellow-jules/contract-v1.md
  - docs/yellow-jules/capability-matrix.md
  - plans/specs/yellow-jules-integration.md
  - plans/shells/yellow-jules-integration-02-runtime-provider-and-claude-routing.md
---

# Moving a Capability Across a Release-Phase Boundary Orphans Its Triggers, Owners, and Derived Artifacts

## Context

PR #793 froze a provider-CLI contract set for a new remote-agent plugin across
four documents: a spec with numbered requirements, an 800-line contract, a
capability matrix, and a set of dependency-ordered shell files. Midway through
review, Open Question 6 was decided: the three mutating subcommands (`delegate`,
`reply`, `approve`) would move from PR2 to PR3 so they ship together with
`authorize`, the command that writes the authority grant they consume. The
decision was recorded, and a follow-up commit
(`docs(yellow-jules): propagate the Open Question 6 decision to shells 02-04`)
swept the shell files for it.

The next review pass found seven sites still on the old boundary. None of them
were missed because the sweeper was careless; they were missed because a sweep
keyed on the moved names (`delegate`, `reply`, `approve`) cannot see most of
them.

## The Seven Sites, Grouped by Why a Name-Grep Misses Them

| Site                                                | What it encoded                                                                        | Why the name sweep missed it                                                                                               |
| --------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Capability-matrix evidence legend                   | "the first live evidence is the R53 smoke after PR2"                                   | Names the phase, never the moved capability                                                                                |
| `status --reconcile` row in the subcommand table    | Flag documented as shipping in PR2                                                     | Its only reachable trigger — a reserved record created by `delegate` — moved out; the row itself never mentions `delegate` |
| Spec R24 (`/linear:delegate` jules dispatch branch) | Required the dispatch branch in PR2                                                    | Names a _different_ product's command that happens to dispatch the moved one                                               |
| The CI validator R25 demands                        | Enforced R24's now-wrong requirement                                                   | A validator is code, not prose; it is not in any doc sweep's file list                                                     |
| Spec R52 per-PR test split                          | Assigned mutating-surface scenarios to PR2 by **positional prefix** in an ordered list | The boundary was encoded by ordering, with no phase token to grep for at all                                               |
| The confirmation-gated abandon path                 | Only exit from `ambiguous-reconcile` / `not-reached`                                   | Ownership moved with `delegate`; no shell picked it up, and nothing names an unowned path                                  |
| Shell 02 build list                                 | Compiles the mutating runtime in PR2 while its authority gate ships in PR3             | The shell names modules, not subcommands                                                                                   |

## Guidance

When a capability moves across a release-phase, milestone, or PR boundary,
enumerate the affected sites by **dependency relation**, not by name. Five
relations each produce sites a name-grep will not return:

1. **Triggers.** What creates the state the remaining surface consumes? A flag,
   endpoint, or reconcile path whose only producer moved is now unreachable in
   the earlier phase. Either move the consumer with it or state, in the same
   table, why an unreachable surface is intentionally exposed early.
2. **Phase assertions.** Grep for the _phase identifiers_ (`PR2`, `M3`, `v0.4`),
   not the capability names. Legends, evidence labels, milestone tables, and
   "first available in" notes all pin a phase without ever naming what moved.
3. **Ordering-encoded assignments.** Any list that assigns work by position
   ("the first four scenarios belong to PR2") silently re-assigns itself when
   the underlying set is reordered or split. Rewrite these as explicit
   enumerations the moment a boundary shifts — they carry no token to search
   for, so they can only be found by re-reading every ordered list in the
   document set.
4. **Ownership.** Every failure branch, escape hatch, and recovery path the
   moved capability owned needs a new named owner in the same commit. An
   orphaned path reads as complete in both phases: the earlier one no longer
   implements it, the later one was never told it inherited it.
5. **Enforcement artifacts.** CI validators, acceptance-criteria checklists,
   test splits, and generated manifests derive from the spec but do not live in
   the doc tree. A doc sweep's file list never includes them. This is the same
   blind spot as the `ci-runs-matrix-targets-not-validate-schemas` auto-memory
   note — the derived artifact enforces the old contract long after the prose
   changed.

## The Control/Controlled Window Is a Security Consequence, Not Just Drift

The shell-02 finding deserves separate weight. The OQ6 decision was made _for_ a
safety reason — ship the mutating commands with the grant mechanism that gates
them. The propagation missed that the build list still compiles the mutating
runtime into the PR2 artifact. The result inverts the decision's intent: a phase
ships the controlled thing with its control one phase away.

Whenever a move is motivated by "ship X together with its gate Y," add an
explicit negative test to the earlier phase's acceptance criteria — for this
contract, _a fake server observes zero mutating POSTs across every subcommand
the earlier phase ships_. A negative test is the only artifact that fails when
the runtime is present but the gate is not; every prose statement about the
split will pass review while the binary still contains the path.

## When to Apply

- Any decision that moves requirements, commands, or capabilities between
  stacked PRs, milestones, or releases — before writing the propagation commit,
  list the five relations above and derive the site set from each.
- Reviewing a "propagate decision D" commit: the diff's file list is a lower
  bound on scope, never evidence of completeness. Ask which relation each
  touched file represents, and which relations produced no touched file at all.
- See the `sweep-incomplete-application-orphaned-jargon` auto-memory note for
  the simpler sibling (same defect class, next file over, enumerable by grepping
  the defect signature) and
  [`layered-contract-fixes-cross-cutting-collision.md`](./layered-contract-fixes-cross-cutting-collision.md)
  for what happens when the individually-correct fixes collide.
