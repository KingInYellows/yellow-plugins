---
spec: plans/specs/yellow-jules-integration.md
spec-r-ids: [R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13, R14, R15, R16, R17, R18, R19, R20, R21, R22, R23, R24, R25, R26, R27, R28, R29, R30, R31, R32, R33, R34, R35, R36, R37, R38, R39, R40, R41, R42, R43, R44, R45, R46, R47, R48, R49, R50, R51, R52, R53, R54, R55, R56, R57, R58, R59, R60, R61, R62]
depends_on: [yellow-jules-integration-02-runtime-provider-and-claude-routing, yellow-jules-integration-04-integrate-and-verification-handoff]
---

# Plan: Durable Unattended Goals via the yellow-goal Engine

## Context

This is the milestone the whole integration exists for: the yellow-goal engine
gains real-provider execution, persistent waiting, and asynchronous outcomes,
and invokes the released yellow-jules CLI through a versioned process
boundary. It spans two repositories. The engine change lands first in
yellow-goal, ships as a new verified release, and only then does this
repository's yellow-goal plugin bump its pin and compatibility tests. The
consumer's provider-protocol guards are the observable v1 contract today; the
protocol spec file they cite must be recovered or re-derived before design.
Starting this shell requires explicit owner approval after PR4 ships.

## Produces

- Provider Protocol revision in yellow-goal: jules executor capability,
  real-provider permission profiles, persistent waiting and resume,
  asynchronous outcome events, ground-truth artifact verification, with
  planner determinism, compiler read-only boundary, and stub guarantees intact
- Engine executor that spawns the released yellow-jules CLI via an explicitly
  configured absolute path, argv array, closed stdin, bounded output, one
  deadline, signal escalation, and stores only provider job and grant
  references
- Versioned `engine` mode in the yellow-jules CLI (capabilities handshake,
  JSON Lines run events) under a new contract version; v0's single-object
  contract is unchanged
- New engine release artifact with SHA-256
- yellow-goal plugin pin bump, release verification script update, and
  compatibility tests, keeping the engine-compat CI job zero-spend
- Coordination record between the two repositories

## Consumes

- Released yellow-jules CLI contract and journal reference shapes — from
  Shell yellow-jules-integration-02-runtime-provider-and-claude-routing
- Verified integrate and verification results as engine outcome inputs — from
  Shell yellow-jules-integration-04-integrate-and-verification-handoff
- yellow-goal repository, its consumer plugin (pin, provider-process
  transport, provider-protocol guards), engine-compat CI job — from existing
  codebase

## Covers Spec Requirements

- R58
- R59
- R60
- R61
- R62

## Implementation Steps (High-Level)

1. **Recover the protocol baseline** — locate or re-derive the Provider
   Protocol v1 spec from the consumer guards and engine source.
2. **Design and implement the protocol revision in yellow-goal** — executor
   capability, permissions, persistence, async outcomes, verification, with
   existing invariants preserved.
3. **Implement the engine's Jules executor** — process interface mirroring the
   consumer transport, explicit path configuration, reference-only storage.
4. **Release the engine** — publish and verify the new artifact.
5. **Bump the plugin pin in this repository** — pin, verification script,
   compatibility tests, CI job kept zero-spend, changeset, submission.

## Open Questions

- The gate to start: owner approval after PR4 (R62); record the approval
  reference at expansion.
- Whether the protocol revision is a v2 or an additive v1 capability set is a
  yellow-goal design decision made at expansion.
