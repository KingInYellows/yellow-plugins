---
"yellow-review": minor
"yellow-core": minor
"yellow-docs": minor
"yellow-research": minor
---

Fix `subagent_type` 2-segment → 3-segment format across the `review:pr`
keystone and other command files. Claude Code's Task registry resolves
agents by the literal `plugin:directory:agent-name` triple from
frontmatter — the 2-segment `plugin:agent-name` form silently mismatches
and causes the graceful-degradation guard to skip every cross-plugin
persona spawn.

Also updates `scripts/validate-agent-authoring.js` to register both
2-segment and 3-segment forms (transitional — the 2-segment form remains
accepted by the validator so non-keystone callers fail loudly only on
the runtime mismatch, not on CI). New code should always emit the
3-segment form.

`yellow-review` (MINOR — keystone behavior fix, no API change):

- `commands/review/review-pr.md` — Step 3d `learnings-researcher` dispatch
  (`yellow-core:research:learnings-researcher`), the entire always-on /
  conditional / supplementary persona dispatch table (17 entries: 4
  always-on plus 12 conditional plus 1 supplementary —
  `yellow-review:review:*` for the 10 in-plugin personas,
  `yellow-core:review:*` for the 6 security / perf / architecture /
  pattern / simplicity / polyglot personas,
  `yellow-codex:review:codex-reviewer` for the optional supplementary),
  Step 8 `yellow-review:review:code-simplifier`, and Step 9a
  `yellow-core:workflow:knowledge-compounder` all corrected to the
  three-segment registry form.
- `commands/review/review-all.md` — `learnings-researcher` Task example
  in the inlined per-PR pipeline corrected to
  `yellow-core:research:learnings-researcher`.
- `skills/pr-review-workflow/SKILL.md` — Cross-Plugin Agent References
  examples corrected to `yellow-core:review:security-sentinel` and
  `yellow-codex:review:codex-reviewer`; pattern hint expanded from
  `yellow-core:<agent-name>` to `yellow-core:<dir>:<agent-name>` so
  future authors copy the right form.
- `agents/review/code-reviewer.md` — Deprecation stub frontmatter and
  body migration prose updated to spell out the three-segment form
  (`yellow-review:review:code-reviewer` →
  `yellow-review:review:project-compliance-reviewer`); the stub's
  residual_risks JSON also corrected so any caller still landing on the
  stub gets a copy-pasteable replacement string.
- `CLAUDE.md` Cross-Plugin Agent References — Both intro paragraphs
  updated to specify the three-segment form with a concrete example.

`yellow-core` (MINOR — self-reference fix on Wave 2 keystone agent and
core workflow commands):

- `agents/research/learnings-researcher.md` Integration section —
  Standalone invocation example corrected to
  `yellow-core:research:learnings-researcher`.
- `commands/workflows/compound.md` — `knowledge-compounder` dispatch
  corrected to `yellow-core:workflow:knowledge-compounder`.
- `commands/workflows/work.md` — Codex rescue dispatch corrected to
  `yellow-codex:workflow:codex-executor`.

`yellow-docs` (MINOR — every cross-agent dispatch was 2-segment):

- `commands/docs/audit.md` — `doc-auditor` →
  `yellow-docs:analysis:doc-auditor`.
- `commands/docs/diagram.md` — `diagram-architect` →
  `yellow-docs:generation:diagram-architect`.
- `commands/docs/generate.md` — `doc-generator` →
  `yellow-docs:generation:doc-generator`.
- `commands/docs/refresh.md` — both `doc-auditor` and `doc-generator`
  references updated as above.

`yellow-research` (MINOR — deepen-plan dispatch was 2-segment):

- `commands/workflows/deepen-plan.md` — `repo-research-analyst` →
  `yellow-core:research:repo-research-analyst`; `research-conductor` →
  `yellow-research:research:research-conductor`.

Triggers a marketplace release so consumers' plugin caches refresh; the
keystone is otherwise dispatch-blocked end-to-end.
