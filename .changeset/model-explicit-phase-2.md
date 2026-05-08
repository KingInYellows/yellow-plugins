---
"yellow-debt": patch
"yellow-core": patch
---

Tier yellow-debt scanners and yellow-core workflow agents to explicit
sonnet/effort frontmatter (Phase 2 of M-A-01).

**yellow-debt scanners + remediation** — taxonomy-driven single-pass analysis;
Sonnet is the quality ceiling. `effort: low` for the parallel scanner tier.

- `ai-pattern-scanner`, `complexity-scanner`, `duplication-scanner`,
  `architecture-scanner`, `security-debt-scanner`: `model: sonnet` +
  `effort: low`
- `debt-fixer`: `model: sonnet` (no `effort:` change). Spot-check passed —
  `isolation: worktree` is model-agnostic and tools list contains no
  Opus-tier-only entries.

**yellow-core workflow** — sophisticated retrieval/orchestration without
Opus-level synthesis (sub-agents handle the actual writing):

- `knowledge-compounder`: `model: sonnet` — orchestrates dispatch and
  novelty detection; sub-agents do the synthesis.
- `session-historian`: `model: sonnet` — BM25 + cosine + RRF retrieval
  with secret redaction. Ranking-and-returning is a Sonnet-ceiling task.

Distinguished from `security-sentinel` (Opus, active vulnerability audit)
which stays unchanged.
