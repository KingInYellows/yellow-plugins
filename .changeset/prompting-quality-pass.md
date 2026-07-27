---
'gt-workflow': patch
'yellow-ci': patch
'yellow-codex': patch
'yellow-core': patch
'yellow-council': patch
'yellow-debt': patch
'yellow-devin': patch
'yellow-docs': patch
'yellow-linear': patch
'yellow-mempalace': patch
'yellow-research': patch
'yellow-review': patch
'yellow-ruvector': patch
'yellow-semgrep': patch
---

Prompt-quality correctness pass across instructional markdown, driven by the
updated prompting-guidance research (docs/research/best-practices/
gpt-claude-latest-model-prompting-guidance.md and its 2026-07-27 addendum).

Fixes fall into four classes: (1) dangling or stale references — archived
plan paths, a nonexistent MCP tool name, "MEMORY.md" citations that do not
resolve for installed users, undefined jargon like "(M3)" and "the keystone";
(2) contradictions between paired files — dedup-threshold drift (0.85 vs the
canonical 0.82), revert/retry option mismatches, doc claims the referenced
code disproves; (3) ambiguous or unactionable instructions — AskUserQuestion
free-text options not labeled `Other`, undefined shell variables in
illustrative bash, branches with no specified check; (4) Codex-exposed
gt-workflow skills assuming Claude-only primitives (AskUserQuestion, the
Skill tool) with no host branch — each now carries an "On Codex" fallback,
with generated codex/ artifacts regenerated. No command interfaces changed.
