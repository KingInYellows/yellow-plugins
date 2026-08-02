---
spec: plans/specs/yellow-council-v2-four-cli.md
spec-r-ids: [R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13, R14, R15, R16, R17, R18, R19, R20, R21, R22, R23, R24, R25, R26, R27, R28, R29, R30]
depends_on: [yellow-council-v2-four-cli-03-synthesis-bias-mitigation, yellow-council-v2-four-cli-04-quota-and-opencode-routing]
---

# Plan: Evidence Verification + V2 Finalization

## Context

The riskiest and final shell. Tier 1-2 evidence verification makes the
council's citations mechanically checked instead of self-asserted: Tier 1
mode-dependent exact match (committed line for review mode, working tree
with fallback for plan/debug/question modes), Tier 2 fuzzy similarity ≥85
via an optional `rapidfuzz` dependency. Verification classifies findings
into the five-bucket synthesis structure (never gates or discards), rewires
the rubric's "correctness of cited evidence" dimension from self-assessed to
verification-backed (completing the R15 partial started in the synthesis
shell), and is bounded (top-50 per reviewer, concurrent with prompt
construction). The shell closes V2 with the cross-cutting finalization
sweep: skill/doc lockstep, both configuration tables, component counts,
manual e2e scenarios, and the final validation pass across everything the
earlier shells shipped.

## Produces

- `verify_finding()` helper implementing the Tier 1/Tier 2 cascade with
  `verified` / `fuzzy-verified` / `unverified` results
- Optional-dependency handling for the fuzzy matcher (pre-flight import
  check, soft-skip with install hint, doc note)
- Five-bucket synthesis output with the deterministic bucket-assignment
  precedence rule; unverified findings surfaced, never dropped
- Verification-backed rubric correctness dimension (completes R15)
- Bounded verification execution (per-reviewer cap, concurrency with
  synthesis prompt construction)
- Fully synchronized docs: skill synthesis/verification contract, both
  configuration tables, component counts, README/CHANGELOG
- Expanded manual e2e checklist covering all V2 scenarios
- Final cross-cutting validation pass over the assembled V2

## Consumes

- Synthesis pipeline with rubric scoring and bucket structure to reorganize
  (from Shell yellow-council-v2-four-cli-03-synthesis-bias-mitigation)
- QUOTA_EXHAUSTED handling and OpenCode routing, needed for the e2e
  checklist and final doc sweep (from Shell
  yellow-council-v2-four-cli-04-quota-and-opencode-routing)
- Council mode dispatch (review / plan / debug / question) that Tier 1
  keys its lookup target on (from existing codebase)

## Covers Spec Requirements

- R15 (partial: correctness-dimension-verification-wiring)
- R22
- R23
- R24
- R25
- R26
- R27
- R28
- R29
- R30

## Implementation Steps (High-Level)

1. **Verification helper** — Tier 1 mode-dependent exact match with the
   skip-to-Tier-2 rule for unknown/non-checkout contexts; Tier 2 fuzzy
   ratio ≥85; three-state result.
2. **Optional dependency handling** — import probe, soft-skip with warning,
   documented as optional.
3. **Five-bucket synthesis reorganization** — apply the deterministic
   precedence rule (single-reviewer split by verification; verdict-split
   beats agreement; agreement split by verification); surface unverified
   claims visibly.
4. **Rewire the rubric correctness dimension** — consume verification
   results instead of self-assessment, completing the coupling that kept
   this phase in V2.
5. **Bound the cost** — per-reviewer verification cap and concurrency with
   synthesis prompt construction.
6. **Finalization sweep** — skill contract, both configuration tables,
   component counts and README/CHANGELOG, manual e2e scenarios (quota ETA,
   lineage warning, tie presentation, single-pass bypass, rubric output,
   verification hit/miss paths), verify every shipped PR carried its
   changeset, and run the full validation suite end-to-end.

## Open Questions

- None
