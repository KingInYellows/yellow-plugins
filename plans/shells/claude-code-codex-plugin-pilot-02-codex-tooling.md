---
spec: plans/specs/claude-code-codex-plugin-pilot.md
spec-r-ids: [R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13, R14, R15, R16, R17, R18, R19, R20, R21, R22, R23, R24, R25, R26, R27, R28, R29, R30, R31, R32, R33, R34, R35, R36, R37, R38, R39, R40, R41, R42, R43, R44, R45]
depends_on: [claude-code-codex-plugin-pilot-01-neutral-generation]
---

# Plan: Codex Tooling, Validators, and CI

## Context

With the neutral catalog proven byte-identical for Claude, this shell adds the
entire Codex-target toolchain while the Codex marketplace stays empty: the
Codex emitters, repository-pinned schemas, the exposure lint, target-aware
version validation, the ERROR-DIST JSON registry that finally bridges the
ESM/CJS error-code wall, Ubuntu+Windows install-verification CI, and
retirement of the legacy TypeScript marketplace validation path. Landing all
gates before any plugin enables Codex means the first enablement (yellow-core)
is validated by machinery that already exists.

## Produces

- Codex emitters in the generator: Codex marketplace (canonical-order filter
  of enabled plugins, version-less entries, policy defaults), per-plugin Codex
  manifest, normalized allowlisted skill trees, and Codex hook config emission
- Committed empty-state Codex marketplace artifact
- Repository-pinned schemas for catalog sources and Codex
  manifest/marketplace/hooks/MCP shapes, labeled as repo-derived from the July
  2026 contract
- `validate:generated` (drift) and `validate:codex` (artifact + exposure)
  scripts wired into `validate:schemas` and `release:check`
- Target-aware version validation (Claude three-way, Codex two-way, Codex
  marketplace membership/name/order/path checks)
- ERROR-DIST-001..008 in a plain-JSON registry consumed by both TypeScript and
  CommonJS stacks, with a prefix-uniqueness/collision lint (DIST vs DISC)
- Codex-exposure lint: registry-gated, raw-content scanning for Claude-only
  constructs in Codex-exposed files
- Generator hook-authority rule: inline Claude plugin.json is authoritative;
  reference-only hook mirrors are never generation targets; Codex hook config
  is Codex-only
- CI matrix additions: Ubuntu and Windows temp-CODEX_HOME jobs installing the
  latest Codex CLI at run time and verifying marketplace/install/allowlists,
  including exotic path forms
- Removal of the legacy TS marketplace validation path (validateMarketplace,
  its CLI caller, the nested-shape schema, affected tests)

## Consumes

- Catalog sources and generator engine — from Shell
  claude-code-codex-plugin-pilot-01-neutral-generation
- Codex spike findings document — from Shell
  claude-code-codex-plugin-pilot-01-neutral-generation
- Existing CI schema-validation matrix, error catalog, error-code lint, and
  AJV example-fixture test patterns — from existing codebase

## Covers Spec Requirements

- R5
- R6
- R7
- R10
- R11
- R12
- R14
- R15
- R16
- R20
- R45
- R39 (partial: pr2-delivery)
- R43 (partial: codex-generator-tests)

## Implementation Steps (High-Level)

1. **Codex emitters** — marketplace filter/order logic, manifest emission,
   skill-tree normalization, hook-config emission with the inline-authority
   rule.
2. **Pinned Codex schemas** — five repo-derived schemas with provenance
   comments, plus example fixtures.
3. **ERROR-DIST registry** — plain-JSON registry, typed re-export on the TS
   side, direct reads on the CJS side, collision lint.
4. **Validators** — validate:generated drift gate, validate:codex exposure
   lint (registry-gated, raw scan), target-aware version validation.
5. **CI wiring** — new matrix entries plus Ubuntu/Windows CODEX_HOME
   install-verification jobs on latest CLI.
6. **Legacy retirement** — remove the TS marketplace validation path and its
   schema; update tests.
7. **Codex-side generator tests** — enablement filtering, four-way version
   drift, empty-state marketplace, Windows-path cases.
8. **Delivery** — stacked PR two via Graphite.

## Open Questions

- None
