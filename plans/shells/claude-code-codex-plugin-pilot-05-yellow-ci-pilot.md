---
spec: plans/specs/claude-code-codex-plugin-pilot.md
spec-r-ids: [R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13, R14, R15, R16, R17, R18, R19, R20, R21, R22, R23, R24, R25, R26, R27, R28, R29, R30, R31, R32, R33, R34, R35, R36, R37, R38, R39, R40, R41, R42, R43, R44, R45]
depends_on: [claude-code-codex-plugin-pilot-01-neutral-generation, claude-code-codex-plugin-pilot-02-codex-tooling, claude-code-codex-plugin-pilot-03-yellow-core-pilot, claude-code-codex-plugin-pilot-04-gt-workflow-pilot]
---

# Plan: yellow-ci Read-Mostly Codex Pilot and Close-Out

## Context

yellow-ci is the read-mostly pilot and the close-out shell: eight skills
exposed (six operational plus two existing reference skills marked
non-implicit), agent instructions folded into skill references with built-in
Codex delegation, the SessionStart hook ported onto the Node runtime pattern
established by the gt-workflow shell, cache writes relocated under the plugin
data directories, and the pilot's documentation finalized — including the
canonical distribution doc, the cross-host hook-envelope solution write-up,
and the explicit non-advertising of repo-wide Codex support.

## Produces

- yellow-ci Codex enablement: skills ci-setup, ci-setup-runner-targets,
  ci-status, ci-diagnose, ci-lint-workflows, ci-runner-health plus existing
  ci-conventions and diagnose-ci; the two reference skills' non-implicit
  marking via `agents/openai.yaml` is deferred pending upstream Codex
  support (the R17(c) spike found the file is not parsed by plugins on
  codex-cli 0.144.1), with SKILL.md description phrasing as the interim
  lever to discourage implicit invocation
- Skill references folding failure-analyst and relevant runner-diagnostics
  instructions into built-in Codex delegation (agents stay Claude-only)
- Preview-and-confirm gates before SSH/config writes and workflow lint fixes;
  non-Linux runner probes skipped with a clear message
- yellow-ci SessionStart hook on the Node runtime (envelope, guaranteed JSON,
  cache contracts, safe degradation without gh or network)
- Cache writes relocated under plugin data locations with read-only legacy
  fallback
- Final three-plugin Codex marketplace in canonical order (gt-workflow,
  yellow-core, yellow-ci)
- Documentation close-out: one canonical neutral-catalog/distribution doc with
  cross-references, root/plugin docs, AGENTS.md and security guidance updates,
  the cross-host hook-envelope solution write-up, and no repo-wide Codex
  compatibility claims
- Fake-executable and redaction tests for diagnosis, rate limits, malformed
  responses, runner-target validation, and non-Linux probe rejection
- Manual Codex-app acceptance evidence including hook review/trust

## Consumes

- Catalog sources, generator, spike findings (openai.yaml field) — from Shell
  claude-code-codex-plugin-pilot-01-neutral-generation
- Codex emitters, schemas, exposure lint, install-verification CI — from
  Shell claude-code-codex-plugin-pilot-02-codex-tooling
- Hook envelope pattern, Node runtime layout, and parity fixture harness —
  from Shell claude-code-codex-plugin-pilot-04-gt-workflow-pilot
- Existing yellow-ci commands, skills, agents, SessionStart hook, runner
  configuration paths, and bats suites — from existing codebase

## Covers Spec Requirements

- R29
- R30
- R31
- R32
- R33
- R38
- R40
- R41
- R19 (partial: yellow-ci-surfaces)
- R34 (partial: yellow-ci)
- R35 (partial: yellow-ci)
- R36 (partial: yellow-ci)
- R37 (partial: yellow-ci)
- R39 (partial: pr5-delivery)
- R42 (partial: yellow-ci-acceptance)
- R43 (partial: yellow-ci-fake-exec)

## Implementation Steps (High-Level)

1. **Operational skills** — author/port the six operational skills with
   preview-and-confirm gates and non-Linux probe messaging; expose the two
   existing reference skills non-implicitly.
2. **Agent folding** — skill references carrying failure-analyst and
   runner-diagnostics instructions for built-in Codex delegation.
3. **SessionStart on Node runtime** — port using the gt-workflow envelope
   pattern; parity fixtures for JSON, cache contracts, degradation.
4. **Cache relocation** — plugin-data writes with read-only legacy fallback.
5. **Catalog enablement + regenerate** — final three-plugin marketplace in
   canonical order; all gates green.
6. **Fake-executable tests** — gh/ssh stubs for diagnosis, redaction, rate
   limits, runner-target validation, probe rejection.
7. **Documentation close-out** — canonical distribution doc, AGENTS.md and
   security guidance, solution write-up, no-advertising sweep.
8. **Delivery** — stacked PR five with a minor yellow-ci changeset and manual
   hook-trust acceptance.

## Open Questions

- None
