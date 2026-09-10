---
spec: plans/specs/yellow-jules-integration.md
spec-r-ids: [R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13, R14, R15, R16, R17, R18, R19, R20, R21, R22, R23, R24, R25, R26, R27, R28, R29, R30, R31, R32, R33, R34, R35, R36, R37, R38, R39, R40, R41, R42, R43, R44, R45, R46, R47, R48, R49, R50, R51, R52, R53, R54, R55, R56, R57, R58, R59, R60, R61, R62]
depends_on: [yellow-jules-integration-02-runtime-provider-and-claude-routing, yellow-jules-integration-03-authority-supervision-and-codex]
---

# Plan: Integrate Command and Verification Handoff (PR4)

## Context

Collected patches still have no sanctioned path into a branch. This shell adds
the one command that applies a staged artifact inside a dedicated integration
worktree, verifies its actual base, runs the task's verification contract with
whatever review and CI tooling is available, and hands off branch and PR
creation to the enabled stacked-PR provider. It closes the loop the supervision
pass relies on for completion evidence and completes end-to-end fake scenarios
across restart, deadline, and base-mismatch cases.

## Produces

- `integrate` command: base verification, worktree creation through the
  yellow-core git-worktree skill, patch apply, verification run,
  stack-provider handoff via the provider guard, with explicit refusal of raw
  push, direct PR creation, or merge paths
- Verification result recording with honest unavailability when CI cannot run
- End-to-end fake scenarios: crash recovery, deadline with remote work active,
  artifact base mismatch, no merge fallback
- Plugin docs, changeset, updated command catalog

## Consumes

- Journal, artifact records, collect staging layout, CLI contract — from Shell
  yellow-jules-integration-02-runtime-provider-and-claude-routing
- Grant model and supervision completion step that consumes verification
  results — from Shell yellow-jules-integration-03-authority-supervision-and-codex
- git-worktree skill, stack-provider guard and router, review and CI
  plugins — from existing codebase

## Covers Spec Requirements

- R8 (partial: integrate-command)
- R33 (partial: completion-verification)
- R41
- R43
- R52 (partial: integrate-scenarios)

## Implementation Steps (High-Level)

1. **Implement base verification and worktree apply** — compare artifact base
   to intended branch, fail on mismatch, refuse artifacts whose session has an
   unreconciled policy deviation, scan the patch against R41's path deny-list
   and fail on a match, present the staged diff and require the user's
   acknowledgement, then create the worktree via the skill with `.env*`
   copying disabled and apply the patch there only; no command runs inside
   the worktree before the acknowledgement.
2. **Run the verification contract** — resolve and pin the contract from the
   pre-apply trusted checkout, invoke available review and CI tooling against
   the applied patch with lifecycle scripts disabled and no ambient
   credentials, record unavailability or error rather than a pass.
3. **Hand off through the stack provider** — resolve provider state, route
   branch and PR creation only through the ready provider, refuse all raw
   fallbacks and any merge.
4. **Complete end-to-end fake scenarios and release** — restart, deadline,
   mismatch, no-fallback cases; docs, changeset, validators including
   `validate:agents` and `lint:plugins`, submission.

## Open Questions

- None
