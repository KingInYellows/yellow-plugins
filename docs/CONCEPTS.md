# Concepts

Shared domain vocabulary for this project — entities, named processes, and
status concepts with project-specific meaning. It accretes as
`/workflows:compound` processes learnings; direct edits are fine. Glossary
only, not a spec or catch-all.

## shell

A structured markdown stub, one per future work session, that
`/workflows:decompose` produces to record a spec's requirement coverage
together with its produces/consumes/depends-on wiring, without yet
committing to concrete file paths. It is not executable itself:
`/workflows:pick-next-shell` expands a shell into a concrete checkbox plan
and deletes the stub, and a coverage gate blocks writing any shell until
every requirement ID is covered either by one bare claim or complete,
non-overlapping partial claims across all shells.

## exposure lint

A CI check (`pnpm validate:codex`) that rejects Claude-only constructs —
Claude-only tool/env-var references, slash-command syntax, hard-coded
cross-plugin identifiers — found anywhere in a plugin's Codex-exposed
content, so a Codex session never encounters an instruction or reference
it cannot resolve. Its scope is narrower than "everything Codex might
read": it scans only the generated Codex plugin manifest and skill tree
(or a plugin's configured skill-path override), never the
hook/lib/command-wrapper layer behind those skills — code in that layer
may reference Claude-only paths freely since Codex never executes it
directly.

## spec-tier

The escalation path `/workflows:plan` takes for a feature too
multi-subsystem to fit in one plan file or one work session, redirecting to
`/workflows:spec` → `/workflows:decompose` → `/workflows:pick-next-shell`
instead of drafting a plan directly. Note: the escalation check is
qualitative (no numeric threshold) and can also fire in Phase 5, after a
plan draft already exists.
