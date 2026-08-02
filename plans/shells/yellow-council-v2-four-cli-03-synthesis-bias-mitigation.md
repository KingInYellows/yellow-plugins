---
spec: plans/specs/yellow-council-v2-four-cli.md
spec-r-ids: [R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13, R14, R15, R16, R17, R18, R19, R20, R21, R22, R23, R24, R25, R26, R27, R28, R29, R30]
depends_on: [yellow-council-v2-four-cli-02-claude-reviewer-fanout]
---

# Plan: Synthesis Bias Mitigation

## Context

With Claude both reviewing and synthesizing, synthesizer bias is V2's #1
quality risk. This shell rebuilds the orchestrator's synthesis step as a
layered, prompt-only mitigation pipeline: style normalization (2026 research:
style bias now dominates position bias), double-blind randomized labels,
chain-of-thought-first synthesis with a self-participant instruction, 2-pass
order-swap where verdict flips become ties (never silently resolved), and
per-finding rubric decomposition. All mitigations compose; none require new
infrastructure. The rubric's "correctness of cited evidence" dimension is
self-assessed in this shell and gets rewired to real verification by the
final shell (that split is the R15 partial boundary).

**Verification handoff contract:** correctness maps directly to
`verify_finding()`'s three-state result once wired — `verified` and
`fuzzy-verified` both hold correctness (fuzzy surfaces a qualifier in the
report), `unverified` fails correctness and the finding cannot be
"well-supported" (R15's AND rule). Bucket ties and verdict-splits follow
R24's precedence exactly: single-reviewer findings split by verification;
verdict-split beats agreement; agreement splits by verification. A Pass B
verdict flip is a `low-confidence-synthesis` tie
annotation only, never a bucket reassignment — flip flag and bucket are
orthogonal. Verification (R25) runs concurrent with prompt construction, but
correctness scoring and bucket assignment must await `verify_finding()`'s
return for that finding; this shell's self-assessed placeholder must already
honor that ordering and return a three-state-compatible result so the final
shell can swap the input source without touching the combination rule.

## Produces

- Pre-synthesis normalization stage (markdown/styling stripped from reviewer
  findings)
- Double-blind anonymization with per-invocation randomized labels and
  report-time de-anonymization
- Synthesis prompt with required chain-of-thought (list findings, then
  compare) and the self-participant instruction
- 2-pass order-swap machinery: flip detection, tie presentation,
  low-confidence headline reporting, global/per-invocation disable toggles,
  Pass-B quota-fallback (ship Pass A annotated, no retry)
- Per-finding rubric scoring (correctness [self-assessed for now],
  completeness, severity calibration, constraint adherence) with mechanical
  combination
- Synthesis contract documentation in the plugin skill

## Consumes

- 4-way fan-out and uniform parsed reviewer returns (from Shell
  yellow-council-v2-four-cli-02-claude-reviewer-fanout)
- Style-bias countermeasure guidance (from existing codebase:
  `docs/solutions/code-quality/llm-as-judge-style-bias-dominance.md`)

## Covers Spec Requirements

- R9
- R10
- R11
- R12
- R13
- R14
- R15 (partial: rubric-scoring)

## Implementation Steps (High-Level)

1. **Normalization stage** — flatten markdown/styling in each reviewer's
   findings before they enter any synthesis prompt, so formatting cannot
   signal identity or inflate weight.
2. **Double-blind labels** — randomized R1–R4 mapping per invocation;
   restore attribution only in the final report sections.
3. **Synthesis prompt rework** — CoT-first structure plus the
   self-participant / evidence-over-confidence instruction.
4. **2-pass order-swap** — reversed-order Pass B (default ON), flip/
   confidence-tier-change detection, tie presentation with both readings,
   headline low-confidence count and percentage, `--single-pass` and env-var
   disable paths, quota-fallback annotation for a mid-run Pass-B wall.
5. **Rubric decomposition** — per-finding independent dimension scores with
   the all-dimensions combination rule (well-supported requires correctness
   AND completeness); correctness is self-assessed until the verification
   shell wires it.
6. **Document and ship** — synthesis contract (blind labels, tie semantics,
   rubric, normalization) in the skill; new env var in both configuration
   tables; minor changeset; CI baseline gate.

## Open Questions

- None
