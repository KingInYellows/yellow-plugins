---
spec: plans/specs/yellow-jules-integration.md
spec-r-ids: [R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13, R14, R15, R16, R17, R18, R19, R20, R21, R22, R23, R24, R25, R26, R27, R28, R29, R30, R31, R32, R33, R34, R35, R36, R37, R38, R39, R40, R41, R42, R43, R44, R45, R46, R47, R48, R49, R50, R51, R52, R53, R54, R55, R56, R57, R58, R59, R60, R61, R62]
depends_on: [yellow-jules-integration-01-contract-and-sdk-investigation]
---

# Plan: Runtime, Provider Registration, and Complete Claude Routing (PR2)

## Context

This shell ships the plugin as one atomic release boundary: the typed runtime
behind the adapter chosen by shell 01, the seven v0 commands with interactive
confirmation, the provider-local journal, artifact staging, and every consumer
that must recognize a third remote-agent provider (catalog, provider router,
setup coverage, Linear delegate route, root script filters, CI drift gates,
fixtures, changesets). The spec forbids shipping `READY_JULES` while any
consumer lacks handling for it, so this work lands and reverts as one PR even
though it will take more than one session; plan for continuity on a single
branch.

It also produces the human-authorized smoke procedure that must run after this
PR merges and before supervision work starts. The smoke itself is a manual,
owner-approved activity, not CI.

## Produces

- `yellow-jules` plugin package: CLI entry, runtime, SDK (or REST) adapter,
  SDK resolver with consented data-dir install, config and data-dir
  resolution, input validation, journal state store, error codes, redaction,
  committed compiled output
- v0 command wrappers: setup, delegate, list, status, reply, approve, collect
- Provider-local journal with operation, artifact, and deviation records,
  reservation-first atomic writes, directory lock, corrupt-journal block
- Artifact staging directory layout under the data dir
- Catalog entry for the plugin with Claude enabled and Codex disabled
- Provider-router extension: third provider row, READY_JULES state, tooling
  probe flag, corrected diagnostics and docstring
- Setup-all coverage for Jules at every enumerated site
- Linear delegate route accepting the third provider with a third tooling
  argv slot and preserved conflict semantics
- Provider-groups validator fixtures for a three-member group, corrected header
- Root typecheck and unit-test filters, main-workflow dist drift step,
  fork-mirror matrix arm
- Fake adapter, loopback fake HTTP server, packed-SDK transport test suite,
  offline coverage suite
- Refreshed characterization snapshots, plugin-count doc updates, changesets
  for yellow-jules, yellow-core, yellow-linear, README and CLAUDE.md for the
  plugin
- Human smoke procedure checklist and result-record template

## Consumes

- Provider-CLI contract v1, capability matrix, transport verdict, module
  strategy verdict, fake-server harness notes — from Shell
  yellow-jules-integration-01-contract-and-sdk-investigation
- yellow-cursor plugin architecture, remote-agent provider-state module,
  validate-provider-groups script, setup-all command, Linear delegate command,
  both CI workflows, characterization tests — from existing codebase

## Covers Spec Requirements

- R1
- R2
- R3 (partial: adapter-implementation)
- R4
- R5
- R6 (partial: build-configuration)
- R7
- R8 (partial: v0-commands)
- R9
- R10
- R11
- R12
- R13
- R14
- R15
- R16
- R17
- R18
- R19
- R20
- R21
- R22
- R23
- R24
- R25
- R26
- R27
- R28 (partial: pr2-changesets-counts-docs)
- R29
- R35
- R36
- R37
- R40
- R42
- R49 (partial: test-layers)
- R50
- R51
- R52
- R53 (partial: procedure-and-checklist)

## Implementation Steps (High-Level)

1. **Scaffold the plugin package** — package manifest with exact SDK pin and
   node engine range, build configuration per the module-strategy verdict,
   source layout mirroring yellow-cursor, committed compiled output.
2. **Implement config, data dir, and journal** — data-dir precedence, state
   file layout, operation/artifact/deviation records, reservation-first
   atomic writes, lock, corrupt-journal refusal, request-id dedup.
3. **Implement the adapter and resolver** — chosen transport behind the
   adapter interface, explicit create flags with serialized-request
   assertion, retries disabled, isolated storage, consented data-dir install,
   post-acceptance failure classification to unknown-outcome.
4. **Implement runtime operations** — setup probe, source discovery, session
   create, fresh status with activity paging and dedup, reply, approve with
   plan re-fetch, collect with base recording and artifact kinds, policy
   deviation on unexpected vendor PR, unsupported-capability errors.
5. **Implement the CLI and v0 command wrappers** — JSON envelope, exit codes,
   redaction on every path, seven thin Bash wrappers with confirmation gates.
6. **Register the provider and update every consumer** — catalog entry and
   order, provider-router row and state, its own test suite and six
   fixtures for a seventh state, setup-all sites including the Step 2.5
   acceptable-state enumeration, Linear delegate sites including the tooling
   argv slot, provider-groups validator fixtures, stale-comment fixes.
7. **Wire root scripts and CI** — typecheck and unit-test filters, main build
   drift step, fork-mirror matrix arm, snapshot refresh, plugin-count docs.
8. **Write the three test layers' first two** — fake-adapter suite covering
   the offline list, packed-SDK transport suite with call-count assertions
   and loopback-only guard, trap real tools on PATH.
9. **Document and release** — plugin README and CLAUDE.md, changesets for all
   three plugins, smoke checklist and result template, full validator run
   including `validate:agents` and `lint:plugins` for the new command
   Markdown, stack-provider-routed submission.

## Open Questions

- Session-overload: this shell exceeds one session; expansion should define
  checkpoints on one branch rather than splitting the release boundary.
- If shell 01's verdict is REST, the packed-SDK layer becomes a
  REST-transport layer against the same fake server; fixture names stay.
- Smoke execution (R53) is a human gate after merge; this shell produces
  only the procedure and result template. Shell 03 claims the outcome-gate
  slice and must not start until the record exists.
