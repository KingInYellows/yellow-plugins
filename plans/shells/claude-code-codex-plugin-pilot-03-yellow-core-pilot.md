---
spec: plans/specs/claude-code-codex-plugin-pilot.md
spec-r-ids: [R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13, R14, R15, R16, R17, R18, R19, R20, R21, R22, R23, R24, R25, R26, R27, R28, R29, R30, R31, R32, R33, R34, R35, R36, R37, R38, R39, R40, R41, R42, R43, R44, R45]
depends_on: [claude-code-codex-plugin-pilot-01-neutral-generation, claude-code-codex-plugin-pilot-02-codex-tooling]
---

# Plan: yellow-core Skills-Only Codex Pilot

## Context

yellow-core is the smallest, lowest-risk first Codex enablement: exactly three
read-only skills, no hooks, no MCP, no agents. It exercises the entire
generation-validation-install pipeline end to end for the first time (first
non-empty Codex marketplace state) while the only Claude-side change is
converting the plan-status command into a thin wrapper over a new canonical
skill — with a parity gate proving identical behavior.

## Produces

- New canonical plan-status skill inside yellow-core
- Claude plan-status command converted to a thin wrapper over the skill, with
  a behavior parity gate against current output
- yellow-core Codex enablement in its catalog source: three-skill allowlist
  (agent-native-architecture, agent-native-audit, plan-status) and a
  Codex-facing description stating the three-skill read-only subset
- Generated yellow-core Codex manifest and skill tree; first single-entry
  Codex marketplace state
- Manual Codex-app acceptance evidence for the install (skills visible,
  nothing else exposed)

## Consumes

- Catalog sources and generator — from Shell
  claude-code-codex-plugin-pilot-01-neutral-generation
- Codex spike findings (argument passing, plugin-list surface) — from Shell
  claude-code-codex-plugin-pilot-01-neutral-generation
- Codex emitters, exposure lint, install-verification CI — from Shell
  claude-code-codex-plugin-pilot-02-codex-tooling
- Existing yellow-core skills (agent-native-architecture, agent-native-audit)
  and the plan-status command — from existing codebase

## Covers Spec Requirements

- R22
- R23
- R19 (partial: yellow-core-surfaces)
- R39 (partial: pr3-delivery)
- R42 (partial: yellow-core-acceptance)

## Implementation Steps (High-Level)

1. **Canonical plan-status skill** — extract the command's dashboard logic
   into a skill following the repo's skill-authoring rules.
2. **Wrapper conversion + parity gate** — make the Claude command a thin
   wrapper; characterize before/after output equivalence.
3. **Catalog enablement** — flip yellow-core's Codex enablement with the
   exact three-skill allowlist and the subset description.
4. **Regenerate + validate** — regenerate artifacts; all Codex gates green;
   exposure lint proves excluded components stay excluded.
5. **Install verification** — CI CODEX_HOME jobs pass for the single-plugin
   marketplace; manual Codex-app acceptance for the install.
6. **Delivery** — stacked PR three with a minor yellow-core changeset.

## Open Questions

- None
