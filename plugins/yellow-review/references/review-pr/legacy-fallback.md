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
- Cross-plugin via the Agent tool: `security-sentinel` (yellow-core),
  `architecture-strategist`, `performance-oracle`,
  `pattern-recognition-specialist`, `code-simplicity-reviewer`
- Optional supplementary: `codex-reviewer` (yellow-codex) — when yellow-codex
  is installed AND diff > 100 lines. Spawn via
  `Agent(subagent_type="yellow-codex:review:codex-reviewer", run_in_background=true)`.
  If the agent is not found (yellow-codex not installed), skip silently.
  `codex-reviewer` returns the structured 6-key council contract
  (`verdict=`/`confidence=`/`summary=`/`fenced_output_path=`/
  `findings_block_begin`...`findings_block_end`) — its P1/P2/P3
  `Finding:` findings (no `Fix:` line — Codex's schema has no fix field)
  are nested inside the findings block, not returned as bare prose.

**`reviewer_set` is not consulted on this path.** The membership above is
fixed. `reviewer_set.include` / `.exclude` in `yellow-plugins.local.md`
have no effect under `review_pipeline: legacy`, which means the opt-in
`thermonuclear-reviewer` is unreachable here by design — it is reachable
only through `include` on the persona path. This is deliberate: legacy is a
rollback escape hatch whose whole value is that its reviewer set is
pinned, so a config key that could grow it would defeat the point. A user
who sets both `review_pipeline: legacy` and
`reviewer_set.include: [thermonuclear-reviewer]` gets the legacy set with
no thermonuclear lane and no error.

Same graceful-degradation guard applies. The legacy path is a rollback
escape hatch only — it skips the dedup / cross-reviewer-promotion /
confidence-gate sub-steps of Step 6 (sub-steps 2, 3, 8 below), not Step 6
in its entirety: sub-step 0 (legacy-prose normalization, including the
`codex-reviewer` findings-block extraction) and sub-step 1 (validation)
still run unconditionally, since every legacy-mode reviewer's raw prose
must pass through them before it's usable at all. Step 5 item 3 skips the
learnings-researcher injection when
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
