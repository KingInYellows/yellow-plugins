---
spec: plans/specs/yellow-council-v2-four-cli.md
spec-r-ids: [R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13, R14, R15, R16, R17, R18, R19, R20, R21, R22, R23, R24, R25, R26, R27, R28, R29, R30]
depends_on: [yellow-council-v2-four-cli-01-codex-contract-normalization]
---

# Plan: Claude Reviewer + Four-Slot Fan-Out

## Context

The foundation of V2: add an in-process `claude-reviewer` as the 4th council
slot and extend the orchestrator's fan-out, parsing, and report assembly from
3 hardcoded reviewers to 4 (claude / codex / gemini / opencode — no registry
abstraction, per the brainstorm's locked decision). The claude-reviewer is
the architecture's deliberate asymmetry: pure reasoning, no CLI subprocess,
with contrarian framing to decorrelate it from the synthesizer it shares a
model family with. Requires a validator allowlist exception because the agent
needs `Write` to materialize the contract's fenced-output temp file.

The R0 decision rule (spec Design section) is fixed and not re-litigated
here: if the Phase G spike shows `agy` requires API-key billing, the Google
slot routes through OpenCode/OpenRouter `google/gemini-*` slugs — the 4-slot
shape this shell builds is unaffected either way.

## Produces

- `claude-reviewer` agent (in-process, tools Read/Grep/Glob/Write, contrarian
  prompt, 6-key output contract)
- 4-way fan-out in the council orchestrator: spawn, parse, headline counts,
  synthesis input, and raw-output report assembly all covering 4 reviewers
- Review-agent allowlist entry legitimizing claude-reviewer's `Write`
  exception
- Updated component docs (agent counts, reviewer list, lineage map)

## Consumes

- Uniform 6-key reviewer contract across all existing reviewers (from Shell
  yellow-council-v2-four-cli-01-codex-contract-normalization)
- gemini-reviewer as the structural template for the new agent (from existing
  codebase)
- `REVIEW_AGENT_DENIED_TOOLS` / `REVIEW_AGENT_ALLOWLIST` mechanism in the
  agent-authoring validator (from existing codebase)

## Covers Spec Requirements

- R4
- R5
- R6
- R7
- R8

## Implementation Steps (High-Level)

1. **Create the claude-reviewer agent** — gemini-reviewer's shape minus the
   CLI subprocess; frontmatter (model inherit, council-patterns skill,
   Read/Grep/Glob/Write); 6-key output contract with the shared verdict enum.
2. **Bake in the contrarian prompt** — competitive-grading framing, no
   self-identification, `<file>:<line>` citations, edge-case/error-path/
   security bias, defensible-REVISE-over-reflex-APPROVE; note the symmetric
   ±25% REVISE-rate guardrail in the agent's docs.
3. **Add the validator allowlist entry** — document the Write exception
   (prompt-constrained to the fenced-output temp file only). Note in the
   allowlist entry that this is a review-time gate, not a runtime path
   restriction — Claude Code has no mechanism to enforce a no-repo-mutation
   boundary automatically; confirm `validate:agents` passes.
4. **Extend the fan-out to 4** — add the Task spawn and audit every
   per-reviewer loop (parse, verdict indexing, headline counts, agreement/
   disagreement inputs, raw-output appendix) so Claude's output appears
   everywhere the other three do.
5. **Sync docs and ship** — component counts (including the pre-existing
   command-count drift fix), README lineage map, minor changeset, CI baseline
   gate.

## Open Questions

- None
