# Brainstorm: EveryInc Merge — Remaining Work

**Date:** 2026-05-06
**Source plans:** `plans/everyinc-merge.md` (backbone), `plans/everyinc-merge-wave3.md`
**Status snapshot:** Waves 1 and 2 shipped (PRs #273–#283 + follow-ups). Wave 3: 9 of 12 items done. 3 items remain open.

---

## What We're Building

A complete accounting of what is still undone across both everyinc-merge plan files, organized so the next work session can pick up without re-reading 1,500 lines of plan. The merge effort as a whole closes when all three Wave 3 items land, two backbone loose threads are resolved, and the remote install smoke test passes. This document captures exactly that scope — no more, no less.

---

## Why This Approach

Waves 1 and 2 are substantially complete in code but the backbone plan's checkboxes were never updated, making it hard to read the plan and know what is genuinely open. This brainstorm synthesizes the verified repo state (file existence, git log, backfill script output) against the plan's intent to produce a single actionable list. The goal is a clean handoff into `/workflows:plan` or `/workflows:work` without re-litigating decisions already made.

---

## Key Decisions

**Wave 3 execution order:** #7 (yellow-debt confidence calibration) → #5 (agent-native reviewers) → #2 (yellow-docs doc-review). Smallest scope first to build momentum and validate approach before the largest item. This order comes from the wave3 plan's own "Suggested order" section and was confirmed.

**Item #5 skills landing:** The plan originally framed the `agent-native-architecture` and `agent-native-audit` skills as "create plugin-dev OR adopt under yellow-core." `plugin-dev` does not exist in this repo. Decision: land both skills under `yellow-core`. Rationale: yellow-core already hosts authoring-adjacent skills (`create-agent-skills`, `mcp-integration-patterns`, `morph-discovery-pattern`); new-plugin overhead is non-trivial (plugin.json, marketplace.json, CLAUDE.md/README, setup:all coverage, validate-versions sync, changeset flow, install UX); extraction into a dedicated plugin is a cheap mechanical refactor if the scope grows later.

**Backbone loose threads:** Two incomplete items from Waves 1/2 are included in this doc under a dedicated section. They are not Wave 3 items and should not be sequenced with them — they can be batched as a single small PR at any point.

**Post-wave work:** POST-1 and POST-2 are explicitly gated on Wave 3 landing and get a brief mention only — no expanded scoping here.

**Final closure gate:** The smoke test is listed as a named explicit step, not implied by Wave 3 landing. Local validators have repeatedly diverged from Claude Code's remote validator; "CI green" is not the same as "install works."

---

## Open Questions

None. All decision points from the plan are resolved above or in the items below.

---

## Remaining Work

### Backbone Plan Loose Threads

These are incomplete items from Waves 1 and 2. Neither is a Wave 3 item. Both are small enough to batch in a single PR.

**BT-1 — W2.0a backfill completion**

The `scripts/backfill-solution-frontmatter.js` script exists and has been run. Current state (verified 2026-05-06):
- 69 of 76 `docs/solutions/` files are complete.
- 5 files need `track` and/or `problem` frontmatter added (dry-run output confirms: `frontmatter-sweep-and-canonical-skill-drift.md`, `plugin-install-mcp-subcommand-smoke-test.md`, `shell-tool-detection-helper-pair-pattern.md`, `json-schema-typeof-array-bypass.md`, `printf-percent-b-terminal-escape-injection.md`).
- 2 files have missing YAML frontmatter entirely and must be fixed manually before the script can process them: `docs/solutions/archived/README.md` and `docs/solutions/security-issues/docs-snippet-path-traversal-and-lex-sort.md`.

Done-state: `node scripts/backfill-solution-frontmatter.js --check` exits 0 with no errors.

**BT-2 — code-reviewer deprecation stub removal**

The stub at `plugins/yellow-review/agents/review/code-reviewer.md` was placed by Wave 2 with the note "removed in the next minor version." That minor version has shipped. The stub is still present.

Done-state: `code-reviewer.md` is deleted; `pnpm validate:schemas` green; no surviving `subagent_type` references to `yellow-review:review:code-reviewer` anywhere in the repo (grep confirms clean).

---

### Wave 3 — Remaining Items (ordered)

#### W3 Item #7 — feat/yellow-debt-confidence-calibration

**Source task:** W3.13b in `plans/everyinc-merge.md`

**Scope:** 5 scanner agents + audit-synthesizer + debt-conventions skill schema bump.

Files to update:
- `plugins/yellow-debt/agents/scanners/ai-pattern-scanner.md`
- `plugins/yellow-debt/agents/scanners/architecture-scanner.md`
- `plugins/yellow-debt/agents/scanners/complexity-scanner.md`
- `plugins/yellow-debt/agents/scanners/duplication-scanner.md`
- `plugins/yellow-debt/agents/scanners/security-debt-scanner.md`
- `plugins/yellow-debt/agents/synthesis/audit-synthesizer.md`
- `plugins/yellow-debt/skills/debt-conventions/SKILL.md`

Key implementation notes from the plan's codebase annotation:
- `confidence` already exists in the v1.0 schema — the work is rubric-based threshold application, not adding the field.
- Real schema gaps requiring breaking changes: rename `affected_files[]` → flat `file`; merge `title` + `description` → flat `finding`; rename `suggested_remediation` → `fix`; add new `failure_scenario` field. This is a v1.0 → v2.0 schema change.
- `audit-synthesizer` must dual-read v1.0 and v2.0 during transition so existing `.debt/scanner-output/*.json` files don't break on re-encounter.
- Scanners may retain `Bash` (they are analysis agents, not PR reviewers; Wave 1 read-only rule does not apply).
- Confidence thresholds from Wave 2: security/performance ≥ 0.8, correctness ≥ 0.7, style ≥ 0.6.

Done-state: synthetic codebase produces structured + calibrated + deduplicated output identical in shape to Wave 2 `review:pr` (modulo `failure_scenario` field); `pnpm validate:schemas` green; changeset for `yellow-debt` minor bump created.

**Merge-conflict pattern:** touches only `yellow-debt` — no conflict with items #5 or #2.

---

#### W3 Item #5 — feat/agent-native-reviewers

**Source task:** W3.5 in `plans/everyinc-merge.md`

**Scope:** 3 new reviewer agents in `yellow-review` + 2 new skills in `yellow-core`.

Files to create:
- `plugins/yellow-review/agents/review/cli-readiness-reviewer.md`
- `plugins/yellow-review/agents/review/agent-cli-readiness-reviewer.md`
- `plugins/yellow-review/agents/review/agent-native-reviewer.md`
- `plugins/yellow-core/skills/agent-native-architecture/SKILL.md`
- `plugins/yellow-core/skills/agent-native-audit/SKILL.md`

Files to update:
- `plugins/yellow-review/commands/review/review-pr.md` — wire the 3 new reviewers into the dispatch table with auto-detection (auto-invoke when diff touches `plugins/*/agents/`, `plugins/*/skills/`, or `plugins/*/commands/`).
- `plugins/yellow-review/commands/review/review-all.md` — same auto-detection wiring (the inline block must mirror `review-pr.md`).
- `plugins/yellow-core/CLAUDE.md` and `README.md` — bump skill count, add rows to skill table.
- `plugins/yellow-review/CLAUDE.md` and `README.md` — bump reviewer agent count.

Key implementation notes:
- All 3 reviewers: `tools: [Read, Grep, Glob]` (read-only; Wave 1 rule applies).
- `subagent_type` literals must be 3-segment matching agent `name:` frontmatter exactly (e.g., `yellow-review:review:cli-readiness-reviewer`).
- Item #12 (`plugin-contract-reviewer`) is already in the dispatch table — the 3 new personas join it there.
- `AskUserQuestion` 4-option hard cap applies; paginate via `Other` if needed.
- Every Cancel/No branch needs explicit "Stop — do not proceed" prose.
- Upstream snapshots for `ce-cli-readiness-reviewer`, `ce-cli-agent-readiness-reviewer`, `ce-agent-native-reviewer` are at `RESEARCH/upstream-snapshots/e5b397c9d1883354f03e338dd00f98be3da39f9f/plugins/compound-engineering/`.

Done-state: synthetic plugin-authoring PR (diff touching `plugins/<x>/agents/`) triggers all three reviewers automatically; `pnpm validate:schemas` green; changesets for `yellow-review` minor and `yellow-core` minor created.

**Merge-conflict pattern:** touches `yellow-core` CLAUDE.md/README (count + skill table row) and `yellow-review` CLAUDE.md/README — same quick-resolve pattern as the small-skill sweep (bump count, alphabetize README row, drop conflict markers).

---

#### W3 Item #2 — feat/yellow-docs-doc-review

**Source task:** W3.2 in `plans/everyinc-merge.md`

**Scope:** 7 new review agents + 1 new command in `yellow-docs`. Largest remaining item.

Files to create (directory `plugins/yellow-docs/agents/review/` does not currently exist — create it):
- `plugins/yellow-docs/agents/review/coherence-reviewer.md`
- `plugins/yellow-docs/agents/review/design-lens-reviewer.md`
- `plugins/yellow-docs/agents/review/feasibility-reviewer.md`
- `plugins/yellow-docs/agents/review/product-lens-reviewer.md`
- `plugins/yellow-docs/agents/review/scope-guardian-reviewer.md`
- `plugins/yellow-docs/agents/review/security-lens-reviewer.md`
- `plugins/yellow-docs/agents/review/adversarial-document-reviewer.md`
- `plugins/yellow-docs/commands/docs/review.md`

Files to update:
- `plugins/yellow-docs/CLAUDE.md` and `README.md` — add agent count, new agents directory, new command.
- `plugins/yellow-docs/.claude-plugin/plugin.json` — register new agents/command if required by discovery rules.

Key implementation notes:
- All 7 reviewer agents: `tools: [Read, Grep, Glob]` (read-only).
- The `/docs:review` command re-uses the Wave 2 orchestration pattern: learnings pre-pass + confidence rubric + compact return + graceful degradation. Same shape as `review-pr.md`, different targets.
- Upstream snapshots for the 6 CE personas are in the fetched snapshot directory.
- `adversarial-document-reviewer` adapted from CE `agents/ce-adversarial-document-reviewer.agent.md` at the locked SHA.
- Done-state: `/yellow-docs:docs:review docs/brainstorms/<sample>.md` returns persona findings in standard schema with at least one finding per invoked persona on a synthetic test doc.

**Merge-conflict pattern:** touches `yellow-docs` CLAUDE.md/README — same quick-resolve. Also touches `plugins/yellow-docs/.claude-plugin/plugin.json`; run `jq empty` after any property changes to guard against trailing commas.

---

### Final Closure Gate

**Smoke test — remote install end-to-end**

This is the plan's literal "done" condition for the entire merge effort. Local CI green does not satisfy it — Claude Code's remote validator has diverged from local schemas before (userConfig `type`/`title`, hooks format, `changelog` key rejection).

Acceptance criterion: fresh Claude Code instance + `/plugin marketplace add KingInYellows/yellow-plugins` + `/review:pr <PR#>` runs end-to-end without errors.

Run after all Wave 3 PRs and the backbone loose threads have merged to main.

---

### Unlocked Once Wave 3 Lands

These are not Wave 3 items. They are explicitly deferred in the plan and belong to separate future planning sessions.

- **POST-1 — Graphite-native stacked-PR seeds:** review agents emit structured branch/title/description seed tuples; gt-workflow consumes them via a new command to auto-create the stack. Yellow-plugins differentiator — no CE analog.
- **POST-2 — Autonomous workflow chain (`/lfg` analog):** `/workflows:ideate` → brainstorm → plan → work → review:pr → resolve-pr → gt submit, pulling session context from W3.12 and delegating to yellow-devin/yellow-codex where appropriate.
