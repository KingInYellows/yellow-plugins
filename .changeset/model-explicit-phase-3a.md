---
"yellow-review": patch
---

Tier 13 yellow-review reviewer-tier agents to `model: sonnet` (Phase 3a of
M-A-01).

These agents apply a defined review lens (single axis) with no cross-domain
synthesis — Sonnet is the quality ceiling for structured code review with
well-defined evaluation criteria.

Agents downgraded from `inherit` to `sonnet`:
- Always-on personas: correctness-reviewer, maintainability-reviewer,
  project-standards-reviewer, project-compliance-reviewer
- Conditional personas: reliability-reviewer, silent-failure-hunter,
  pr-test-analyzer, comment-analyzer, type-design-analyzer, code-simplifier,
  plugin-contract-reviewer, cli-readiness-reviewer
- Workflow: pr-comment-resolver (in-context fix reconciliation)

Agents that stay on `opus` (no change in this PR): adversarial-reviewer,
agent-cli-readiness-reviewer, agent-native-reviewer — these construct novel
failure scenarios or do compound multi-axis architectural judgment.

Per docs/research/model-selection-token-context-optimization.md.
