---
spec: plans/specs/yellow-council-v2-four-cli.md
spec-r-ids: [R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13, R14, R15, R16, R17, R18, R19, R20, R21, R22, R23, R24, R25, R26, R27, R28, R29, R30]
depends_on: []
---

# Plan: Codex Reviewer Contract Normalization

## Context

yellow-codex's `codex-reviewer` agent returns free-form P1/P2/P3 prose while
yellow-council's gemini-reviewer and opencode-reviewer emit a structured 6-key
block (`verdict=` / `confidence=` / `summary=` / `fenced_output_path=` /
`findings_block_begin` / `findings_block_end`). Adding a 4th reviewer (next
shell) on the structured contract would leave the council parser with a
codex-only special case. Normalizing codex first makes the 4-way fan-out
parser uniform. This shell is **cross-plugin**: it edits
`plugins/yellow-codex/` (patch changeset for yellow-codex), plus a
council-side cleanup in `plugins/yellow-council/` if any codex special-case
exists in the parser. Every plugin this shell actually edits gets its own
changeset — yellow-codex patch always, plus a yellow-council patch too if
step 3 touches `council.md` — per spec R30.

## Produces

- codex-reviewer emitting the canonical 6-key return block with verdict
  case-statement validation (content/finding format unchanged inside the
  delimiters)
- A uniform reviewer-return parser in the council orchestrator (no
  codex-specific branch)

## Consumes

- gemini-reviewer's 6-key output contract and verdict case-statement (from
  existing codebase — the reference template)
- codex-reviewer's existing Step 7 output construction (from existing codebase)

## Covers Spec Requirements

- R1
- R2
- R3

## Implementation Steps (High-Level)

1. **Audit the gap** — compare codex-reviewer's output construction against
   the gemini/opencode 6-key shape; document what's missing for the PR
   description.
2. **Rewrite the return envelope** — emit the 6-key block with the shared
   verdict enum and case-statement normalization to `UNKNOWN`; preserve
   P1/P2/P3 content inside the findings delimiters. Carry over
   gemini-reviewer's sentinel-escaping so untrusted codex output can't
   truncate the block early: escape any literal `^findings_block_begin$` /
   `^findings_block_end$` lines inside the findings text before emission,
   mirroring the reference implementation.
3. **Remove any codex special-case from the council parser** — grep the
   orchestrator for codex-specific parse branches; make parsing uniform.
4. **Validate and ship** — schema/agent validators, a changeset for every
   plugin this shell actually touched (yellow-codex patch always, plus a
   yellow-council patch if step 3 changed `council.md`), verify a
   `/council review` run shows codex findings with verdict/confidence/summary
   lines. Confirm no other marketplace consumer depends on the old free-form
   output.

## Open Questions

- None
