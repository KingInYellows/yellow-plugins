# Concepts

Shared domain vocabulary for this project — entities, named processes, and
status concepts with project-specific meaning. It accretes as
`/workflows:compound` processes learnings; direct edits are fine. Glossary
only, not a spec or catch-all.

## shell

A structured markdown stub, one per future work session, that
`/workflows:decompose` produces to claim a disjoint subset of a spec's
requirement IDs together with its produces/consumes/depends-on wiring,
without yet committing to concrete file paths. It is not executable itself:
`/workflows:pick-next-shell` expands a shell into a concrete checkbox plan
and deletes the stub, and a coverage gate blocks writing any shell until
every requirement ID across all shells is claimed exactly once.

## spec-tier

The escalation path `/workflows:plan` takes for a feature too
multi-subsystem to fit in one plan file or one work session, redirecting to
`/workflows:spec` → `/workflows:decompose` → `/workflows:pick-next-shell`
instead of drafting a plan directly. Note: the escalation check is
qualitative (no numeric threshold) and can also fire in Phase 5, after a
plan draft already exists.
