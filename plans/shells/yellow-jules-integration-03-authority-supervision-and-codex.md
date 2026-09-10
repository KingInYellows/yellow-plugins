---
spec: plans/specs/yellow-jules-integration.md
spec-r-ids: [R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13, R14, R15, R16, R17, R18, R19, R20, R21, R22, R23, R24, R25, R26, R27, R28, R29, R30, R31, R32, R33, R34, R35, R36, R37, R38, R39, R40, R41, R42, R43, R44, R45, R46, R47, R48, R49, R50, R51, R52, R53, R54, R55, R56, R57, R58, R59, R60, R61, R62]
depends_on: [yellow-jules-integration-02-runtime-provider-and-claude-routing]
---

# Plan: Bounded Authority, Supervision, and Codex Surface (PR3)

## Context

With the runtime and routing live and the human smoke resolved, this shell adds
what lets a supervisor act without asking on every step while staying inside
owner-set limits: a grant object created by a dedicated command, a runtime
authority check on every mutation, a bounded one-pass supervision loop, and
pause-on-outside-activity behavior. It also makes Codex a first-class host by
exposing two host-neutral skills through the generator and documenting the
single-controller handoff procedure.

## Produces

- Grant record type and `authorize` command with confirmation, listing, and
  revocation
- Runtime authority check on every mutating operation, with expiry and limit
  exhaustion handling and deadline-versus-remote-state reporting
- `supervise` command implementing one bounded decision pass and returning
  the next required check
- Outside-activity and plan-change pause with reconciliation requirement
- Correction handling within grant limits: feedback to the active session or
  a new bounded repair task
- Host-neutral skills for delegation and supervision that pass the exposure
  lint, with Claude-only details kept in wrappers
- Codex enablement in the catalog with interface block and skill allowlist,
  generated Codex skill tree, baseline of the Codex manifest test taken
  before the flip
- Codex host-tool availability reporting in supervision
- Documented manual controller handoff procedure in the plugin CLAUDE.md
- Codex distribution doc update, changesets, updated smoke evidence pointer

## Consumes

- Runtime, journal, CLI contract, v0 commands, fake adapter and transport
  suites, smoke result record — from Shell
  yellow-jules-integration-02-runtime-provider-and-claude-routing
- Codex generator, exposure lint, codex manifest tests, Codex distribution
  doc — from existing codebase

## Covers Spec Requirements

- R8 (partial: authorize-and-supervise-commands)
- R28 (partial: codex-distribution-doc)
- R30
- R31
- R32
- R33
- R34
- R38
- R39
- R44
- R45
- R46
- R47
- R48
- R53 (partial: smoke-outcome-gate)

## Implementation Steps (High-Level)

1. **Confirm the smoke gate** — locate the completed human smoke result
   record from shell 02's template; if absent or if it reports an unexpected
   vendor PR, stop and surface the delivery-policy decision before any
   further step.
2. **Add the grant model and authorize command** — record fields, trial
   defaults with ceiling, listing and revocation, confirmation gate.
3. **Enforce authority in the runtime** — check before every write, expiry and
   exhaustion outcomes, deadline expiry reporting that never claims remote
   termination.
4. **Implement the supervision pass** — the six-step loop as one invocation,
   re-fetch before approval, concise answers with references, correction
   limits, pause on outside activity.
5. **Author host-neutral skills** — delegation and supervision bodies that pass
   the exposure lint and avoid AskUserQuestion reliance on Codex.
6. **Enable Codex** — baseline the codex manifest test, flip the catalog target
   with interface and allowlist, regenerate, run focused tests and a manual
   Codex host smoke, record unavailable-tool reporting.
7. **Document handoff and release** — controller handoff procedure, Codex
   distribution doc, changesets, validators including `validate:agents` and
   `lint:plugins`, stack-provider submission.

## Open Questions

- Which research and review capabilities the installed Codex CLI actually
  exposes to supervision is discovered here (spec Open Question 2).
- Whether the R53 smoke surfaced a vendor PR despite the flags; if so, the
  delivery-policy decision precedes this shell.
