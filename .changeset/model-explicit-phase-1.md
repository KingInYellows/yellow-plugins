---
"yellow-docs": patch
"yellow-council": patch
"yellow-core": patch
"yellow-ci": patch
"yellow-debt": patch
"yellow-research": patch
---

Add explicit `model:` and `effort:` frontmatter to 8 phase-1 agents to escape
the inheritance trap on narrow-role agents and add chain-of-thought depth to
synthesizers/orchestrators.

- `product-lens-reviewer` (yellow-docs): `model: sonnet` (matches sibling
  reviewers' explicit tiering)
- `gemini-reviewer`, `opencode-reviewer` (yellow-council): `model: haiku` +
  `effort: low` — CLI relay agents that do no reasoning
- `learnings-researcher` (yellow-core): `model: haiku` + `effort: low` — BM25
  retrieval, no synthesis; called on every `/review:pr` and `/workflows:plan`
- `runner-assignment` (yellow-ci): `model: haiku` + `effort: low` —
  deterministic label-matching against fixed runner taxonomy
- `audit-synthesizer` (yellow-debt): `effort: high` (model already `opus`) —
  cross-scanner deduplication and confidence gating benefit from extended CoT
- `research-conductor` (yellow-research): `effort: high` (model already
  `opus`) — multi-source fan-out routing involves ambiguous decomposition
- `brainstorm-orchestrator` (yellow-core): `model: sonnet` + `effort: high` —
  iterative dialogue with research integration; Sonnet is the structured-
  orchestration ceiling
