---
'yellow-review': minor
'yellow-core': patch
---

Add `thermonuclear-reviewer`, an opt-in structural-quality review persona,
and its preloaded `yellow-thermonuclear-review` skill. The rubric is adapted
from Cursor's MIT-licensed `thermo-nuclear-code-quality-review`
(`cursor/plugins@6e3d2ea`, snapshotted under `RESEARCH/upstream-snapshots/`),
with the MIT notice reproduced inline in the skill body.

It asks whether a change leaves the codebase with fewer moving parts:
code-judo restructurings, spaghetti-condition growth, weak type and module
boundaries, misplaced ownership, non-atomic orchestration, and file-size
threshold crossings. It is deliberately more aggressive than the always-on
`maintainability-reviewer`, whose calibration as the low-false-positive
everyday lane is unchanged.

`/review:pr` never selects it. It appears in neither dispatch table; a
repository opts in by naming it in `reviewer_set.include` in
`yellow-plugins.local.md`. It runs opus/xhigh with depth calibration so
trivial diffs get a cheap pass, is read-only (`Read`/`Grep`/`Glob`), emits
`advisory`/`human` findings capped at P1, and is unreachable under
`review_pipeline: legacy` by design — that path has a fixed persona list and
never reads `reviewer_set`.

The file-size rule is a crossing rule, not an absolute ceiling, and it is
evidence-gated: it consumes a `<file-line-counts>` block supplied by the
orchestrator and suppresses all size findings when that block is missing
rather than estimating base counts from a diff.

yellow-core changes are documentation only: `local-config` names the opt-in
reviewer as the sole way to reach it, and the `security-fencing` consumer
inventory is refreshed to the 16 `yellow-review/agents/review/` agents that
carry the `## CRITICAL SECURITY RULES` block (the inventory's grep-based
definition; it claimed 12 and omitted four). Three of the sixteen
(`agent-cli-readiness-reviewer`, `agent-native-reviewer`,
`cli-readiness-reviewer`) state the untrusted-input rule in prose without the
`--- begin ... (reference only) ---` delimiter template.
