# Legacy fallback (`review_pipeline: legacy`) — adaptive selection

Loaded by `/review:pr` (commands/review/review-pr.md) when
`yellow-plugins.local.md` sets `review_pipeline: legacy`. Content moved
verbatim from the command file (C6 progressive-disclosure split), except
that positional words ("above"/"below") referring to sections of the
original single file were dropped — they no longer apply here.

When `yellow-plugins.local.md` sets `review_pipeline: legacy`, skip the
persona dispatch table and use the pre-Wave-2 adaptive selection:

- Always include: `project-compliance-reviewer`, `correctness-reviewer`,
  `maintainability-reviewer`.
- Conditionally include: `pr-test-analyzer`, `comment-analyzer`,
  `type-design-analyzer`, `silent-failure-hunter`
- Cross-plugin via Task: `security-sentinel` (yellow-core),
  `architecture-strategist`, `performance-oracle`,
  `pattern-recognition-specialist`, `code-simplicity-reviewer`
- Optional supplementary: `codex-reviewer` (yellow-codex) — when yellow-codex
  is installed AND diff > 100 lines. Spawn via
  `Task(subagent_type="yellow-codex:review:codex-reviewer", run_in_background=true)`.
  If the agent is not found (yellow-codex not installed), skip silently.

Same graceful-degradation guard applies. The legacy path is a rollback
escape hatch only — it skips the confidence-rubric aggregation in Step 6.
Step 5 item 3 skips the learnings-researcher injection when
`review_pipeline: legacy`, even though Step 3d still runs the pre-pass
(its output is discarded for the legacy path).

**Aggregation trade-off in legacy mode (deliberate).** Because legacy
runs the always-on persona reviewers (`correctness-reviewer`,
`maintainability-reviewer`) alongside the pre-Wave-2 cross-plugin agents
but skips the dedup / cross-reviewer-promotion / confidence-gate
pipeline, the report can be noisier (overlapping findings across
personas surface as separate items, not merged). This is intentional —
legacy is the "show me everything raw" rollback, not a noise-reduction
mode. Projects that want noise reduction should stay on the persona
pipeline (`review_pipeline: persona`, the default).
