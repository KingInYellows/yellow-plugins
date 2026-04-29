---
"yellow-review": major
"yellow-core": minor
---

Wave 2 keystone — review:pr persona pipeline + learnings pre-pass + confidence rubric

`yellow-review` (MAJOR — `code-reviewer` rename):

- **BREAKING:** Rename `code-reviewer` → `project-compliance-reviewer`. The
  responsibility is narrowed to `CLAUDE.md`/`AGENTS.md` compliance, naming
  patterns, and project-pattern adherence. General correctness is now
  handled by the new `correctness-reviewer`; frontmatter / portability /
  cross-platform tool selection by the new `project-standards-reviewer`.
- **Migration:** Callers passing `subagent_type:
  "yellow-review:code-reviewer"` should update to
  `"yellow-review:project-compliance-reviewer"`. A deprecation stub is
  left at the old path for one minor version — third-party installs that
  reference the old name continue to function (with a deprecation log
  line) until the stub is removed.
- **New persona reviewers** (all read-only, `tools: [Read, Grep, Glob]`):
  `correctness-reviewer`, `maintainability-reviewer`,
  `reliability-reviewer`, `project-standards-reviewer`,
  `adversarial-reviewer`. Each returns the structured compact-return JSON
  schema with severity, category, file, line, confidence, autofix_class,
  owner, requires_verification, pre_existing, and optional suggested_fix.
- **`review:pr` rewritten** (`commands/review/review-pr.md`): adds Step
  3a always-fetch base branch (CE PR #544 hardening), Step 3d learnings
  pre-pass (dispatches `learnings-researcher`; `NO_PRIOR_LEARNINGS` →
  skip injection; otherwise inject fenced advisory block into every
  reviewer's Task prompt), Step 4 tiered persona dispatch table with
  `yellow-plugins.local.md` config integration and a graceful-degradation
  guard, Step 5 compact-return enforcement, Step 6 confidence-rubric
  aggregation (validate → dedup → cross-reviewer promotion → mode-aware
  demotion → confidence gate at anchor 75 with P0 ≥ 50 exception →
  partition → sort) plus quality gates for line accuracy, protected-
  artifact filtering, and skim-FP detection.
- **`review:all` parity update** (`commands/review/review-all.md`): the
  inlined per-PR pipeline now mirrors the new `review:pr` Steps 3a / 3d
  / 4 / 5 / 6. Pipeline-mirror comment added so future drift is caught.
- **`pr-review-workflow` skill update**: documents the new always-on
  persona set, the conditional `reliability-reviewer` and
  `adversarial-reviewer` triggers, the compact-return JSON schema, and
  the Wave 2 P0–P3 severity scale + 5-anchor confidence anchors.

`yellow-core` (MINOR — net additive):

- **`learnings-researcher` agent** (`agents/research/learnings-researcher.md`):
  always-on pre-pass that searches `docs/solutions/` for past learnings
  relevant to a PR diff or planning context. Reads the
  `track`/`tags`/`problem` frontmatter schema added in Wave 2 prep
  (`feat/knowledge-compounder-track-schema`). Returns a fenced advisory
  block on hit, the literal `NO_PRIOR_LEARNINGS` token on miss.
- **`local-config` skill** (`skills/local-config/SKILL.md`): documents
  the `yellow-plugins.local.md` per-project config file with minimum keys
  `review_pipeline` (escape hatch for Wave 2 rollback), `review_depth`,
  `focus_areas`, `reviewer_set.{include,exclude}`. Wave 3 expansion keys
  (`stack`, `agent_native_focus`, `confidence_threshold`) are documented
  for forward visibility.
- **Self-referential solutions doc**
  (`docs/solutions/code-quality/learnings-researcher-pre-pass-pattern.md`):
  documents the pre-pass pattern, empty-result protocol, fencing
  requirement, and how to extend it for new orchestrators.

Cross-plugin reference updates (no version bump): `yellow-core`,
`yellow-devin`, `yellow-ruvector` doc references to `code-reviewer`
migrated to the new persona names.

Reference: `RESEARCH/upstream-snapshots/e5b397c9d1883354f03e338dd00f98be3da39f9f/confidence-rubric.md`
extracted from upstream `compound-engineering@v3.3.2` ce-code-review/SKILL.md.
