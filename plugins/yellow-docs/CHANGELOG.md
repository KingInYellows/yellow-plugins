# Changelog

## 1.2.0

### Minor Changes

- [#290](https://github.com/KingInYellows/yellow-plugins/pull/290)
  [`65e2938`](https://github.com/KingInYellows/yellow-plugins/commit/65e29382c2df760ef62efca337c1fc6160193245)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Fix
  `subagent_type` 2-segment → 3-segment format across the `review:pr` keystone
  and other command files. Claude Code's Task registry resolves agents by the
  literal `plugin:directory:agent-name` triple from frontmatter — the 2-segment
  `plugin:agent-name` form silently mismatches and causes the
  graceful-degradation guard to skip every cross-plugin persona spawn.

  Also updates `scripts/validate-agent-authoring.js` to register both 2-segment
  and 3-segment forms (transitional — the 2-segment form remains accepted by the
  validator so non-keystone callers fail loudly only on the runtime mismatch,
  not on CI). New code should always emit the 3-segment form.

  `yellow-review` (MINOR — keystone behavior fix, no API change):
  - `commands/review/review-pr.md` — Step 3d `learnings-researcher` dispatch
    (`yellow-core:research:learnings-researcher`), the entire always-on /
    conditional / supplementary persona dispatch table (17 entries: 4 always-on
    plus 12 conditional plus 1 supplementary — `yellow-review:review:*` for the
    10 in-plugin personas, `yellow-core:review:*` for the 6 security / perf /
    architecture / pattern / simplicity / polyglot personas,
    `yellow-codex:review:codex-reviewer` for the optional supplementary), Step 8
    `yellow-review:review:code-simplifier`, and Step 9a
    `yellow-core:workflow:knowledge-compounder` all corrected to the
    three-segment registry form.
  - `commands/review/review-all.md` — `learnings-researcher` Task example in the
    inlined per-PR pipeline corrected to
    `yellow-core:research:learnings-researcher`.
  - `skills/pr-review-workflow/SKILL.md` — Cross-Plugin Agent References
    examples corrected to `yellow-core:review:security-sentinel` and
    `yellow-codex:review:codex-reviewer`; pattern hint expanded from
    `yellow-core:<agent-name>` to `yellow-core:<dir>:<agent-name>` so future
    authors copy the right form.
  - `agents/review/code-reviewer.md` — Deprecation stub frontmatter and body
    migration prose updated to spell out the three-segment form
    (`yellow-review:review:code-reviewer` →
    `yellow-review:review:project-compliance-reviewer`); the stub's
    residual_risks JSON also corrected so any caller still landing on the stub
    gets a copy-pasteable replacement string.
  - `CLAUDE.md` Cross-Plugin Agent References — Both intro paragraphs updated to
    specify the three-segment form with a concrete example.

  `yellow-core` (MINOR — self-reference fix on Wave 2 keystone agent and core
  workflow commands):
  - `agents/research/learnings-researcher.md` Integration section — Standalone
    invocation example corrected to `yellow-core:research:learnings-researcher`.
  - `commands/workflows/compound.md` — `knowledge-compounder` dispatch corrected
    to `yellow-core:workflow:knowledge-compounder`.
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

### Patch Changes

- [#288](https://github.com/KingInYellows/yellow-plugins/pull/288)
  [`6ca3de4`](https://github.com/KingInYellows/yellow-plugins/commit/6ca3de44a1ee1d8dc428222e0976c51567e332a7)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Fix
  subagent_type format to 3-segment (plugin:directory:agent) across keystone
  orchestrator and command files.

  The Wave 2 keystone (`/review:pr`) Step 4 dispatch table, Step 3d learnings
  pre-pass, Step 7 code-simplifier pass, and Step 9a knowledge-compounding step
  all referenced agents using the 2-segment form (e.g.
  `yellow-review:correctness-reviewer`). The Claude Code agent registry requires
  the 3-segment form (`yellow-review:review:correctness-reviewer`, where the
  middle segment is the agent's subdirectory under `plugins/<name>/agents/`).
  The 2-segment form fails dispatch with "Agent type not found" — meaning every
  persona spawn from the new keystone would error even after the cache picks up
  the new agents.

  This is purely a documentation / orchestration-prose fix; no agent behaviour
  changes. Affected files:
  - `plugins/yellow-review/commands/review/review-pr.md` — 17 dispatch table
    entries + 3 inline `subagent_type:` references
  - `plugins/yellow-review/commands/review/review-all.md` — 1 inline reference
    (parity with review-pr.md Step 3d)
  - `plugins/yellow-review/skills/pr-review-workflow/SKILL.md` — 2 cross-plugin
    Task examples (security-sentinel, codex-reviewer); pattern hint expanded to
    clarify the 3-segment shape
  - `plugins/yellow-review/agents/review/code-reviewer.md` — deprecation-stub
    migration guidance (was pointing users to the wrong format)
  - `plugins/yellow-core/commands/workflows/compound.md` — knowledge-compounder
    dispatch
  - `plugins/yellow-core/commands/workflows/work.md` — codex-executor rescue
    dispatch
  - `plugins/yellow-core/agents/research/learnings-researcher.md` — usage-doc
    invocation example
  - `plugins/yellow-docs/commands/docs/audit.md`, `diagram.md`, `generate.md`,
    `refresh.md` — 5 doc-auditor / diagram-architect / doc-generator dispatches

  Discovered while running a manual /review:pr trial against PR #287 (Wave 3
  trial branch). Every Wave 2 persona dispatch errored with "Agent type not
  found" until the 3-segment form was used. This blocks the keystone from
  running end-to-end even after a plugin cache refresh.

## 1.1.0

### Minor Changes

- [`e3ef6ff`](https://github.com/KingInYellows/yellow-plugins/commit/e3ef6ffbd175c44756d1c6ac7511b1040d2e9720)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add yellow-docs
  documentation plugin with 5 commands (setup, audit, generate, diagram,
  refresh), 3 agents, and 1 shared skill. Register in marketplace and setup:all.

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## 1.0.0

### Added

- Initial release
- `/docs:setup` — validate prerequisites and detect project structure
- `/docs:audit` — scan repo for documentation gaps, staleness, and coverage
- `/docs:generate` — AI-assisted documentation generation with human review
- `/docs:diagram` — context-aware Mermaid diagram generation
- `/docs:refresh` — update stale docs based on code changes
