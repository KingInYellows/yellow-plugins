---
spec: plans/specs/yellow-jules-integration.md
spec-r-ids: [R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13, R14, R15, R16, R17, R18, R19, R20, R21, R22, R23, R24, R25, R26, R27, R28, R29, R30, R31, R32, R33, R34, R35, R36, R37, R38, R39, R40, R41, R42, R43, R44, R45, R46, R47, R48, R49, R50, R51, R52, R53, R54, R55, R56, R57, R58, R59, R60, R61, R62]
depends_on: [yellow-jules-integration-02-runtime-provider-and-claude-routing]
---

# Plan: Bounded Authority, Supervision, and Codex Surface (PR3)

## Context

With the runtime and routing live, this shell ships the three mutating commands (`delegate`, `reply`, `approve`, moved here from shell 02 (Open Question 6 decision, 2026-09-10)) and adds what lets a supervisor act without asking on every step while staying inside
owner-set limits: a grant object created by a dedicated command, a runtime
authority check on every mutation, a bounded one-pass supervision loop, and
pause-on-outside-activity behavior. It also makes Codex a first-class host by
exposing two host-neutral skills through the generator and documenting the
single-controller handoff procedure.

## Produces

- `delegate`, `reply`, and `approve` command wrappers with the R29 confirmation mechanism decided here (spec Open Question 6), together with their runtime operations (session create, reply, approve with plan re-fetch — moved from shell 02, amended 2026-09-11), the live `jules` dispatch branch replacing shell 02's fail-closed stub in the Linear delegate route (R24), and the confirmation-gated `abandon` path for a reservation that `status --reconcile` cannot resolve
- Grant record type and `authorize` command with confirmation, listing, and revocation
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
- Codex distribution doc update, changesets
- Human smoke procedure checklist and the `docs/yellow-jules/smoke-result.md` record template (R53); the smoke runs after this PR merges and before shell 04

## Consumes

- Runtime, journal, CLI contract, read-only v0 commands, fake adapter and transport suites — from Shell
  yellow-jules-integration-02-runtime-provider-and-claude-routing
- Codex generator, exposure lint, codex manifest tests, Codex distribution
  doc — from existing codebase

## Covers Spec Requirements

- R8 (partial: mutating-authorize-and-supervise-commands)
- R24 (partial: live-jules-dispatch-branch)
- R29
- R28 (partial: codex-distribution-doc)
- R30
- R31
- R32
- R33 (partial: supervision-loop)
- R34
- R38
- R39
- R44
- R45
- R46
- R47
- R48
- R52 (partial: mutating-surface-grant-and-lock-scenarios)
- R53 (partial: procedure-and-checklist)

## Implementation Steps (High-Level)

1. **Decide the R29 confirmation mechanism** — settle spec Open Question 6's
   authentication question (host-issued capability, runtime-owned prompt, or
   grants only) before any non-grant mutation ships; the confirmation's format
   must survive `redactDeep` unchanged in a dry-run envelope (contract-v1.md
   "Confirmation token").
2. **Add the grant model and authorize command** — record fields, trial
   defaults with ceiling, listing and revocation, confirmation gate.
3. **Build the `delegate`, `reply`, and `approve` runtime operations and
   command wrappers** — the three mutating commands and their runtime
   operations moved here from shell 02 (R8); each write is authorized by
   either a valid grant from Step 2 (R30) or a successful Step 1
   confirmation (R29), never by requiring both (R31). A missing, expired, or
   limit-exhausted grant falls through to confirmation on hosts that can
   mint the R29 event; on Codex it rejects with a recoverable action naming
   `authorize`, because Codex cannot mint the token and R48 requires a
   Claude-created grant. Reject likewise when confirmation is unavailable
   (the engine interface, R59) or the owner declines. Replace the Linear
   delegate route's fail-closed `jules` stub with the live call (R24), and
   add the confirmation-gated `abandon` path that marks a reservation
   `status --reconcile` left `ambiguous-reconcile` or `not-reached` as
   terminal `failed` (contract-v1.md `delegate`).
4. **Enforce authority in the runtime** — check before every write, expiry and
   exhaustion outcomes, deadline expiry reporting that never claims remote
   termination.
5. **Implement the supervision pass** — the six-step loop as one invocation,
   re-fetch before approval, concise answers with references, correction
   limits, pause on outside activity.
6. **Author host-neutral skills** — delegation and supervision bodies that pass
   the exposure lint and avoid AskUserQuestion reliance on Codex.
7. **Enable Codex** — baseline the codex manifest test, flip the catalog target
   with interface and allowlist, regenerate, run focused tests and a manual
   Codex host smoke, record unavailable-tool reporting.
8. **Document handoff and release** — controller handoff procedure, Codex
   distribution doc, changesets, validators including `validate:agents` and
   `lint:plugins`, stack-provider submission.

## Open Questions

- Which research and review capabilities the installed Codex CLI actually
  exposes to supervision is discovered here (spec Open Question 2).
- `authorize` stays Claude-only until a host-neutral owner-confirmation
  primitive exists (spec Open Question 4); decide here whether grants need a
  key-bound MAC beyond permissions and a separate store (spec Open Question 5).
- Whether the R53 smoke surfaces a vendor PR despite the flags; the smoke now runs after this shell (Open Question 6 decision, 2026-09-10), so that decision precedes shell 04.
- How the R29 confirmation event is authenticated per host (spec Open
  Question 6): settle before any non-grant mutation ships. Decided 2026-09-10, option (b): the three mutating commands ship here; the mechanism itself is fixed at this shell's expansion.
