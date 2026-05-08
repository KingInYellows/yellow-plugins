---
"yellow-core": patch
"yellow-docs": patch
---

Tier yellow-core review/workflow personas + 2 yellow-docs reviewers
to explicit `model:` frontmatter (Phase 3b of M-A-01).

**yellow-core (8 files)** — single-axis review and structured analysis;
Sonnet is the quality ceiling:
- Review personas: code-simplicity-reviewer, pattern-recognition-specialist,
  test-coverage-analyst, polyglot-reviewer, security-lens, security-reviewer,
  performance-reviewer
- Workflow: spec-flow-analyzer (UX flow analysis with defined axes)

`security-sentinel`, `performance-oracle`, and `architecture-strategist`
stay on `opus` (no change) — primary discovery agents and architectural
judgment.

**yellow-docs (2 files)**:
- `feasibility-reviewer`: `model: sonnet` — structured feasibility assessment
  matching the sibling pattern (design-lens, scope-guardian,
  security-lens-reviewer, coherence-reviewer are all already explicitly
  tiered)
- `adversarial-document-reviewer`: `model: sonnet` + `effort: high` — applies
  a structured challenge protocol; the adversarial angle benefits from
  extended chain-of-thought, but the protocol is structured enough that Sonnet
  is the appropriate ceiling

**Already-correct (no edit) yellow-docs siblings** confirmed via grep:
`design-lens-reviewer`, `scope-guardian-reviewer`, `security-lens-reviewer`
all carry `model: sonnet` already — closes the documentation gap surfaced
during planning.

Per docs/research/model-selection-token-context-optimization.md.
