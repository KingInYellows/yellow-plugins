---
spec: plans/specs/claude-code-codex-plugin-pilot.md
spec-r-ids: [R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13, R14, R15, R16, R17, R18, R19, R20, R21, R22, R23, R24, R25, R26, R27, R28, R29, R30, R31, R32, R33, R34, R35, R36, R37, R38, R39, R40, R41, R42, R43, R44, R45]
depends_on: [claude-code-codex-plugin-pilot-01-neutral-generation, claude-code-codex-plugin-pilot-02-codex-tooling]
---

# Plan: gt-workflow Complete Codex Pilot

## Context

gt-workflow is the full-surface pilot: all seven workflows become canonical
skills consumable on both hosts, the gt MCP server is declared once and shared
via a file reference, and the plugin's two bash hooks are rewritten as the
first cross-host Node hook runtime — establishing the normalized envelope,
snake_case adapter, and parity-fixture harness that the yellow-ci shell
reuses. Claude-side behavior is preserved through compatibility wrappers and
characterization gates.

## Produces

- Seven canonical skills (gt-setup, gt-nav, gt-stack-plan, gt-sync,
  smart-submit, gt-amend, gt-cleanup) with Claude commands retained as
  compatibility wrappers preserving names and allowed tools
- Machine-checkable wrapper-to-canonical-skill drift check
- Shared gt MCP declaration: one emitted MCP config file referenced by both
  manifests (Claude file-reference verified per spike; inline fallback mode if
  rejected), with CLI-first degradation when MCP startup or auth fails
- gt hook Node runtime: pure policy modules plus Claude and Codex entrypoints
  implementing the normalized envelope with snake_case-to-camelCase transform,
  correct PreToolUse deny shape, and Windows command variants
- Hook parity fixture harness (bash-vs-Node replay) — the reusable pattern for
  the yellow-ci shell
- Host-specific audit-prompt skill references (Claude Task dispatch, Codex
  built-in worker/explorer delegation) replacing output-style contracts
- Fake-executable behavioral tests for staging, dry-run, confirmations, and
  conflict stops
- Manual Codex-app acceptance evidence including hook review/trust

## Consumes

- Catalog sources, generator, spike findings (argument passing, mcpServers
  file-reference verdict, hook-path override) — from Shell
  claude-code-codex-plugin-pilot-01-neutral-generation
- Codex emitters, schemas, exposure lint, install-verification CI — from
  Shell claude-code-codex-plugin-pilot-02-codex-tooling
- Existing gt-workflow commands, bash hooks, output styles, and the
  repo-root Graphite convention file read path — from existing codebase

## Covers Spec Requirements

- R21
- R24
- R25
- R26
- R27
- R28
- R19 (partial: gt-workflow-surfaces)
- R34 (partial: gt-workflow)
- R35 (partial: gt-workflow)
- R36 (partial: gt-workflow)
- R37 (partial: gt-workflow)
- R39 (partial: pr4-delivery)
- R42 (partial: gt-workflow-acceptance)
- R43 (partial: gt-workflow-fake-exec)

## Implementation Steps (High-Level)

1. **Canonical skills** — convert the seven workflows to skills preserving
   staging, dry-run, confirmation, and conflict-stop semantics; apply the
   spike's argument-passing pattern for Codex.
2. **Compatibility wrappers + drift check** — thin Claude command wrappers
   plus the CI check tying each wrapper to its canonical skill.
3. **MCP packaging** — emit the shared MCP config, wire both manifests per
   the spike verdict, characterize Claude MCP tool availability.
4. **Node hook runtime** — policy modules, dual entrypoints, envelope
   adapter, deny shape, Windows command variants, Codex hook config.
5. **Parity harness** — replay identical stdin fixtures through old bash and
   new Node hooks; diff outputs; port hardening assertions.
6. **Audit-prompt skill references** — host-specific delegation replacing
   output styles.
7. **Fake-executable tests** — git/gt stubs verifying workflow semantics
   without external writes.
8. **Delivery** — stacked PR four with a minor gt-workflow changeset and
   manual hook-trust acceptance.

## Open Questions

- None
