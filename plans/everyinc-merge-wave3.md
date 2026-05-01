# Feature: EveryInc/Compound-Engineering Selective Merge — Wave 3 (Parallel)

**Date:** 2026-04-28 (decomposition split 2026-04-29; reconciled 2026-04-30; second sweep 2026-05-01)
**Source plan:** `plans/everyinc-merge.md` (backbone — must merge to `main` before this plan runs)
**Status:** Backbone merged (PRs #273–#275, #280–#283 + follow-ups #287/#288/#290/#294/#295). Item #4 shipped via PR #287; item #6 shipped via PR #296; item #12 shipped via PR #293; phase-0 snapshots + plan reconciliation shipped via PR #300. **Sweep 2026-04-30 evening:** items #1, #3, #11 shipped via PRs #306 (`cc3d1f9`), #307 (`39e5d7a`), #308 (`9826330`). **Sweep 2026-05-01 small-skill batch:** items #8, #9, #10 shipped via PRs #310 (`d7f36fa`), #312 (`a2486f1`), #311 (`9cb0f32`). **3 parallel branches remain** (items #2, #5, and #7).

## Reconciliation 2026-05-01

Nine of 12 stack items have shipped:

- **Item #1 (`feat/ce-debug-skill`, W3.1) — DONE.** Shipped via PR #306 (squash-merged 2026-04-30 as `cc3d1f9` on `main`). Adds `plugins/yellow-core/skills/debugging/SKILL.md` (5-phase root-cause workflow with causal-chain gate).
- **Item #3 (`feat/resolve-pr-cluster-and-actionability`, W3.3) — DONE.** Shipped via PR #307 (squash-merged 2026-04-30 as `39e5d7a` on `main`). Adds Step 3c (actionability filter) + Step 3d (file+region clustering with transitive merge) to `/yellow-review:resolve`; updates `pr-comment-resolver` agent input contract; adds `resolve_pr.cluster_line_distance` to local-config schema.
- **Item #4 (`fix/git-worktree-and-local-config-expansion`, W3.4 + W3.6) — DONE.** Shipped via PR #287 as a Wave 3 trial (`bb5855e` on `main`).
- **Item #6 (`feat/compound-lifecycle-skill`, W3.10) — DONE.** Shipped via PR #296 (merged 2026-04-30 as `ce3a5d7` on `main`). Adds `plugins/yellow-core/skills/compound-lifecycle/SKILL.md`.
- **Item #8 (`feat/ideation-skill`, W3.11) — DONE.** Shipped via PR #310 (squash-merged 2026-05-01 as `d7f36fa` on `main`). Adds `plugins/yellow-core/skills/ideation/SKILL.md` — Toulmin warrant contract + MIDAS three-phase generation routed into `brainstorm-orchestrator` via Task. Strict-warrant mode auto-engages on `auth`, `api token`, `oauth`, etc. (NOT bare `token` after PR feedback).
- **Item #9 (`feat/cross-vendor-session-history`, W3.12) — DONE.** Shipped via PR #312 (squash-merged 2026-05-01 as `a2486f1` on `main`). Adds `plugins/yellow-core/skills/session-history/SKILL.md` and `plugins/yellow-core/agents/workflow/session-historian.md` — searches Claude Code (local JSONL) + Devin (MCP) + Codex (local) backends with BM25+optional-cosine RRF fusion + post-RRF recency multiplier; mandatory secret redaction (AWS/GH/GL/Slack/OpenAI/Google + JWT + PEM patterns).
- **Item #10 (`feat/optimize-skill`, W3.14) — DONE.** Shipped via PR #311 (squash-merged 2026-05-01 as `9cb0f32` on `main`). Adds `plugins/yellow-core/skills/optimize/SKILL.md` + `schema.yaml` — LLM-as-judge with parallel candidate variants, two-run order-swap (Run-3 silently downgrades when `parallel_count == 2`), per-criterion analytic rubric, `style_bias_check` self-flag, paginated 4-option Phase 4 selection (top-2 + Cancel + Other-with-pagination).
- **Item #11 (`docs/yellow-codex-and-composio-research`, W3.7 + W3.8) — DONE.** Shipped via PR #308 (squash-merged 2026-04-30 as `9826330` on `main`). Adds `docs/research/yellow-codex-expansion.md` (YES on codex-reviewer learnings integration; YES Option-B on adversarial codex command) and `docs/research/yellow-composio-expansion.md` (NO-GO direct expansion; YES-GO opt-in W3.14 adapter). Research-only — implementation deferred.
- **Item #12 (`feat/plugin-contract-reviewer`, W3.15) — DONE.** Shipped via PR #293 (squash-merged 2026-04-30 as `f3985d8` on `main`). Adds `plugins/yellow-review/agents/review/plugin-contract-reviewer.md` (~241 lines), wires the dispatch table in `review-pr.md` and `review-all.md`. Item #5 (`feat/agent-native-reviewers`) — when authored — should add its three new personas alongside the now-merged plugin-contract-reviewer in the dispatch table.

**Effective parallel branch count for this wave:** **3 branches remain** — items #2 (`feat/yellow-docs-doc-review`), #5 (`feat/agent-native-reviewers`), and #7 (`feat/yellow-debt-confidence-calibration`).

**CE upstream SHA:** unchanged (`e5b397c9d1883354f03e338dd00f98be3da39f9f` / `compound-engineering-v3.3.2`). No new releases to incorporate.

**Wave 3 upstream snapshots:** Fetched 2026-04-30 into `RESEARCH/upstream-snapshots/e5b397c9d1883354f03e338dd00f98be3da39f9f/plugins/compound-engineering/` (62 files: agents/ce-{coherence,design-lens,feasibility,product-lens,scope-guardian,adversarial-document,cli-readiness,cli-agent-readiness,agent-native,session-historian,api-contract}-reviewer.agent.md and skills/{ce-debug,ce-doc-review,ce-agent-native-architecture,ce-agent-native-audit,ce-compound-refresh,ce-ideate,ce-optimize,ce-worktree}/). MANIFEST.md updated with task map + cap policy for the 6 newly-fetched files >500 lines.

---

## Overview

This plan decomposes Wave 3 of the EveryInc merge into **12 parallel feature branches**, each rooted at `main` after the Wave 2 keystone (`plans/everyinc-merge.md` PR #7) has merged. Branches are independent of each other (different files, no cross-dependencies) and can be developed and reviewed in parallel.

All implementation task definitions (W3.1, W3.2, W3.3, W3.4, W3.5, W3.6, W3.7, W3.8, W3.9, W3.10, W3.11, W3.12, W3.13b, W3.14, W3.15) live in `plans/everyinc-merge.md` under the "Wave 3" section. This file only specifies the parallel stack decomposition; do not duplicate task content here.

> **Note on W3.9:** W3.9 (Wave 3 changesets) is intentionally distributed — each parallel branch runs its own `pnpm changeset` as part of its pre-PR checklist. There is no standalone W3.9 branch in the stack decomposition below.

## Implementation Plan

### Phase 0: Pre-Wave Preparation (Wave 3)

Before starting the parallel stack:

- [x] 0.1 Re-fetch the latest `EveryInc/compound-engineering-plugin` `main` SHA. **2026-04-30:** Unchanged at `e5b397c9d1883354f03e338dd00f98be3da39f9f` / `compound-engineering-v3.3.2`. No new releases to incorporate.
- [x] 0.2 Fetch upstream snapshots for Wave 3 tasks not already snapshotted in the backbone. **2026-04-30:** Done — 62 files fetched into `RESEARCH/upstream-snapshots/e5b397c9d1883354f03e338dd00f98be3da39f9f/plugins/compound-engineering/`. See `MANIFEST.md` for the full snapshot→task map. Shipped via PR #300 (merged 2026-04-30 as `7782dbf`).
- [x] 0.3 Validate snapshot bodies are reasonable; flag any > 500 lines for extract-only treatment. **2026-04-30:** 6 newly-fetched files exceed 500 lines (`ce-compound-refresh/SKILL.md` 703, `ce-optimize/SKILL.md` 659, and 4 `ce-agent-native-architecture/references/` files at 506–871). All flagged in MANIFEST.md cap-policy table with extract-only treatment.
- [x] 0.4 Run `pnpm validate:schemas && pnpm test:unit` baseline on `main` after backbone merges. **2026-04-30:** Green on fresh `origin/main` checkout — `All plugins passed validation` (64 agents, 240 markdown files); `Test Files 1 passed (1) / Tests 3 passed (3)`.
- [ ] 0.5 Read the source plan's "Wave 3" section in full so the implementation context is loaded.
- [x] 0.6 ~~Watch PR #293 (item #12)~~ — **2026-04-30:** PR #293 merged as `f3985d8`. Item #5 (`feat/agent-native-reviewers`), when authored, must add its three new personas to the dispatch table that now also contains `plugin-contract-reviewer`.

For full task content, see `plans/everyinc-merge.md` "Wave 3: P1 Adoptions (reviewed by Wave 2 pipeline)" section.

## Acceptance Criteria

Per-component acceptance is enumerated inside each task in the source plan. The Wave 3 effort is "done" when all 12 parallel PRs below merge to `main`. Each PR is reviewed by the Wave 2 pipeline (the keystone shipped in backbone PR #7). No Wave 3 PR introduces new `Bash` in any reviewer agent (Wave 1 rule applies, enforced by `scripts/validate-agent-authoring.js` Rule X added in backbone PR #5).

## Stack Decomposition

<!-- stack-topology: parallel -->
<!-- stack-trunk: main -->

**Original count:** 12 parallel branches from `main`. **As of 2026-05-01:** items #1, #3, #4, #6, #8, #9, #10, #11, #12 are DONE (PRs #306, #307, #287, #296, #310, #312, #311, #308, #293). Active runway is **3 branches** — items #2, #5, #7. Each remaining branch is independent (no cross-branch file overlap) and can be developed, reviewed, and merged in any order. Branch creation is just-in-time per `/workflows:work` Phase 1b parallel topology.

**Known merge-conflict pattern:** every Wave 3 PR that adds a new skill or agent under `plugins/yellow-core/` updates the agent or skill count in `plugins/yellow-core/CLAUDE.md` and the skill table in `plugins/yellow-core/README.md`. Parallel branches off main therefore conflict on those two files at merge time. The pattern is well-understood and quick to resolve: bump the count to the new total, alphabetize the row in the README skill table, drop both conflict markers. The 2026-05-01 small-skill sweep confirmed this is the only structural conflict — branches do not collide on actual skill or agent file content.

### 1. feat/ce-debug-skill — **DONE (PR #306, merged 2026-04-30 as `cc3d1f9`)**
- **Type:** feat
- **Description:** ce-debug analog skill — test-first systematic debugging, causal chain tracing
- **Scope:** NEW plugins/yellow-core/skills/debugging/SKILL.md
- **Tasks:** W3.1
- **Depends on:** (backbone merged)
- **Status:** Shipped. Skill file present at `plugins/yellow-core/skills/debugging/SKILL.md` on `main`. Adapted from upstream EveryInc/compound-engineering ce-debug at locked SHA `e5b397c9`. 5-phase workflow with causal-chain gate, prediction-for-uncertain-links, smart escalation, and conditional defense-in-depth/post-mortem.

### 2. feat/yellow-docs-doc-review
- **Type:** feat
- **Description:** ce-doc-review in yellow-docs — 6 personas + adversarial-document-reviewer + new /docs:review command
- **Scope:** NEW plugins/yellow-docs/agents/review/{coherence,design-lens,feasibility,product-lens,scope-guardian,security-lens,adversarial-document}-reviewer.md, NEW plugins/yellow-docs/commands/docs/review.md
- **Tasks:** W3.2
- **Depends on:** (backbone merged)

### 3. feat/resolve-pr-cluster-and-actionability — **DONE (PR #307, merged 2026-04-30 as `39e5d7a`)**
- **Type:** feat
- **Description:** resolve-pr cross-invocation cluster analysis + actionability filter (CE PRs #480, #461)
- **Scope:** plugins/yellow-review/commands/review/resolve-pr.md, plugins/yellow-review/agents/workflow/pr-comment-resolver.md (input contract), plugins/yellow-core/skills/local-config/SKILL.md (`resolve_pr.cluster_line_distance` schema key)
- **Tasks:** W3.3
- **Depends on:** (backbone merged)
- **Status:** Shipped. Step 3c (actionability filter — drops bare LGTM/thanks/+1/looks-good/nice/nit threads via case-insensitive single-line regex) and Step 3d (file+region clustering with transitive ≤10-line merge OR range overlap, tunable via local-config) are live. Step 4 dispatches one resolver per cluster with literal `subagent_type: "yellow-review:workflow:pr-comment-resolver"` and an M3 spawn-cap AskUserQuestion gate. Resolver agent input contract updated to cluster envelope; `CONFLICT:` sentinel added for contradiction reporting reconciled in Step 5.

### 4. fix/git-worktree-and-local-config-expansion — **DONE (PR #287, merged 2026-04-30)**
- **Type:** fix
- **Description:** git-worktree mise/direnv auto-trust + .git is-a-file detection; yellow-plugins.local.md schema expansion (full keys)
- **Scope:** plugins/yellow-core/skills/git-worktree/SKILL.md, plugins/yellow-core/skills/local-config/SKILL.md (extends from backbone PR #7)
- **Tasks:** W3.4, W3.6
- **Depends on:** (backbone merged)
- **Status:** Shipped as Wave 3 trial via PR #287 (commit `bb5855e`). Not on the parallel-runway. Task tracker entries #579–#582 confirm completion + review pass.

### 5. feat/agent-native-reviewers
- **Type:** feat
- **Description:** cli-readiness, agent-cli-readiness, agent-native reviewers + agent-native-architecture/audit skills
- **Scope:** NEW plugins/yellow-review/agents/review/{cli-readiness,agent-cli-readiness,agent-native}-reviewer.md, NEW plugins/plugin-dev/skills/{agent-native-architecture,agent-native-audit}/SKILL.md (or under plugins/yellow-core/skills/ if plugin-dev creation is out of scope)
- **Tasks:** W3.5
- **Depends on:** (backbone merged)
- **Notes:** plugin-dev plugin does not currently exist (16 plugins present). Decide at execution time: create plugin-dev OR adopt skills under yellow-core. The decision affects changeset (plugin-dev minor initial release vs yellow-core minor).

### 6. feat/compound-lifecycle-skill — **DONE (PR #296, merged 2026-04-30 as `ce3a5d7`)**
- **Type:** feat
- **Description:** compound-lifecycle skill — staleness detection, overlap detection, archive-don't-delete consolidation
- **Scope:** NEW plugins/yellow-core/skills/compound-lifecycle/SKILL.md, NEW docs/solutions/archived/
- **Tasks:** W3.10
- **Depends on:** (backbone merged)
- **Status:** Shipped. Skill file present at `plugins/yellow-core/skills/compound-lifecycle/SKILL.md` on `main`.

### 7. feat/yellow-debt-confidence-calibration
- **Type:** feat
- **Description:** yellow-debt scanner schema v2.0 — failure_scenario field + field renames; audit-synthesizer dual-read v1.0/v2.0
- **Scope:** plugins/yellow-debt/agents/scanners/{ai-pattern,architecture,complexity,duplication,security-debt}-scanner.md, plugins/yellow-debt/agents/synthesis/audit-synthesizer.md, plugins/yellow-debt/skills/debt-conventions/SKILL.md (schema_version bump)
- **Tasks:** W3.13b
- **Depends on:** (backbone merged)
- **Notes:** Breaking schema change (v1.0 → v2.0). Synthesizer must dual-read during transition.

### 8. feat/ideation-skill — **DONE (PR #310, merged 2026-05-01 as `d7f36fa`)**
- **Type:** feat
- **Description:** ideation skill with Toulmin warrant contract + MIDAS three-phase model; routes selected approach to brainstorm-orchestrator via Task
- **Scope:** NEW plugins/yellow-core/skills/ideation/SKILL.md
- **Tasks:** W3.11
- **Depends on:** (backbone merged)
- **Status:** Shipped. Skill file present at `plugins/yellow-core/skills/ideation/SKILL.md` on `main` (~320 lines after review fixes). Six-phase flow (subject gate → free generation → warrant filter → extension → ranked selection → hand-off) with `[EVIDENCE]`/`[WARRANT]`/`[IDEA]` Toulmin slots. Strict-warrant mode auto-engages on multi-word security patterns (`api token`, `auth token`, `bearer token`, `oauth`, `jwt`, etc.) — NOT bare `token` after PR feedback. Phase 4 uses paginated `AskUserQuestion` (top-2 + Cancel + Other; third candidate via Other follow-up) to stay under the 4-option cap.

### 9. feat/cross-vendor-session-history — **DONE (PR #312, merged 2026-05-01 as `a2486f1`)**
- **Type:** feat
- **Description:** cross-vendor session-historian (Claude Code + Devin + Codex backends) with hybrid query (BM25 + cosine + RRF) + secret redaction
- **Scope:** NEW plugins/yellow-core/skills/session-history/SKILL.md, NEW plugins/yellow-core/agents/workflow/session-historian.md
- **Tasks:** W3.12
- **Depends on:** (backbone merged)
- **Status:** Shipped. CWD encoding correctly produces leading-hyphen form (`-home-user-projects-foo`) — `sed 's|/|-|g'`, NOT `s|^/||; s|/|-|g`. Codex `find -mindepth 4 -maxdepth 4` enumerates `YYYY/MM/DD/<session-uuid>/` leaves. Hybrid query: BM25 + optional cosine via ruvector, fused via RRF (k=60), then post-RRF recency multiplier — recency is applied exactly once. Empty `$CURRENT_SESSION_ID` no longer drains results (conditional grep -v). Secret redaction covers AWS (AKIA/ASIA), GitHub, GitLab, Slack, OpenAI (sk-/sk-ant-/sk-proj-), Google, JWT, PEM. Devin V3 lineage capped at 10 children with `children_truncated`/`children_total` metadata.

### 10. feat/optimize-skill — **DONE (PR #311, merged 2026-05-01 as `9cb0f32`)**
- **Type:** feat
- **Description:** ce-optimize analog — LLM-as-judge with parallel experiments, schema.yaml, two-run order-swap, judge_telemetry schema
- **Scope:** NEW plugins/yellow-core/skills/optimize/SKILL.md, NEW plugins/yellow-core/skills/optimize/schema.yaml
- **Tasks:** W3.14
- **Depends on:** (backbone merged)
- **Status:** Shipped. Schema correctly classifies only `optimization_target` and `measurement_criteria` as required (others have defaults). Phase 0 enforces `sum(weights) > 0` (no division by zero). Judge runs branch by `judge_runs` value (1/2/3) with explicit handling for `parallel_count == 2 + judge_runs == 3` (silent downgrade — only two distinct permutations exist). Phase 4 uses paginated 4-option layout (top-2 + Cancel + Other; lower-ranked candidates surfaced via Other follow-up varying by `parallel_count`). `style_bias_check` self-flag in `judge_telemetry` warns when 50%+ records flag style influence. Score-spread floor (< 0.3) catches near-identical-candidate degenerate diversity.

### 11. docs/yellow-codex-and-composio-research — **DONE (PR #308, merged 2026-04-30 as `9826330`)**
- **Type:** docs
- **Description:** yellow-codex + yellow-composio expansion research reports (no implementation, research-level deliverable only)
- **Scope:** NEW docs/research/yellow-codex-expansion.md, NEW docs/research/yellow-composio-expansion.md
- **Tasks:** W3.7, W3.8
- **Depends on:** (backbone merged)
- **Status:** Shipped. Two reports landed on `main`. Recommendations: (a) **YES** integrate `learnings-researcher` advisory into `codex-reviewer` via optional `--advisory` flag; (b) **YES (Option B)** ship `/codex:adversarial-investigate` as a separate command rather than a flag on `/codex:rescue`; (c) **NO-GO** for direct yellow-composio expansion; (d) **YES-GO** for opt-in W3.14 ce-optimize adapter behind `execution.environment: composio-workbench`. 4 additional codex expansion opportunities deferred for future planning. Implementation deferred to post-Wave-3 follow-up PRs.

### 12. feat/plugin-contract-reviewer — **DONE (PR #293, merged 2026-04-30 as `f3985d8`)**
- **Type:** feat
- **Description:** plugin-contract-reviewer agent — detect breaking changes to plugin public surface (subagent_type, command/skill/MCP tool names, manifest fields, hook contracts); auto-invoked when diff touches plugins/* manifests or component frontmatter
- **Scope:** NEW plugins/yellow-review/agents/review/plugin-contract-reviewer.md, plugins/yellow-review/commands/review/review-pr.md (dispatch-table wiring with auto-detection on plugin file paths)
- **Tasks:** W3.15
- **Depends on:** (backbone merged)
- **Notes:** Renamed from CE `ce-api-contract-reviewer`; adapted from REST-API focus to Claude Code plugin-contract focus. Output schema extends Wave 2 reviewer schema with `breaking_change_class` and `migration_path` fields.
- **Status:** Shipped. Upstream snapshot `agents/ce-api-contract-reviewer.agent.md` is on `main` (added by PR #293, also fetched in PR #300 for posterity but deduplicated during rebase). Item #5 (`feat/agent-native-reviewers`), when authored, must register its three new personas in the same dispatch table.

## Next Session Pickup

When resuming with `/workflows:work plans/everyinc-merge-wave3.md`, the parser will detect `## Stack Decomposition` with `<!-- stack-topology: parallel -->` and the existing `## Stack Progress` block (3 unchecked items: #2, #5, #7). For each remaining item, Phase 1b creates a fresh branch from `main` (parallel topology — no stacking).

**Suggested order** by complexity:

1. **Item #7 (`feat/yellow-debt-confidence-calibration`, W3.13b)** — touches existing files (5 scanners + synthesizer + `debt-conventions/SKILL.md`). Schema v1.0 → v2.0 breaking change with dual-read fallback during transition. Most contained scope of the three (single plugin, no new files except potentially a v2.0 example fixture). Good warm-up after the W3.11/W3.12/W3.14 sweep.
2. **Item #5 (`feat/agent-native-reviewers`, W3.5)** — adopts 3 new reviewers into `plugins/yellow-review/agents/review/` and 2 new skills. Decision point: create a new `plugin-dev` plugin OR adopt skills under `yellow-core`. Must register the 3 personas in the `review:pr` and `review-all` dispatch tables alongside the merged `plugin-contract-reviewer` (item #12). Will conflict on `yellow-core` or `yellow-review` CLAUDE.md/README counts at merge — same pattern as the small-skill sweep.
3. **Item #2 (`feat/yellow-docs-doc-review`, W3.2)** — largest scope: 7 new agent files (6 personas + adversarial-document-reviewer) + 1 new command in `yellow-docs`. Re-uses Wave 2 `review:pr` orchestration pattern (learnings pre-pass, confidence rubric, compact return, graceful degradation). Will need to add the `agents/review/` directory to `yellow-docs` (does not currently exist).

**Pre-execution baseline:** the small-skill sweep validated `pnpm validate:plugins` (16 plugins pass) and the squash-merge → conflict-resolution flow on yellow-core CLAUDE.md/README. Counts on `main` after this session: yellow-core has **18 agents** and **10 skills**.

**Reviewer findings to apply forward:** the 3 PRs from this session surfaced repeating bot patterns worth pre-empting in items #2 and #5: (a) `AskUserQuestion` 4-option hard cap means N≥3 candidates need pagination via `Other`; (b) closing-tag escape on XML fences (use `--- begin/end ---` style or add a "closing tag is character data" note); (c) every Cancel/No branch needs explicit "Stop — do not proceed" prose; (d) `Other` is the ONLY literal label that opens free-text input; (e) yellow-core skills don't put `allowed-tools` in frontmatter (no precedent across debugging/compound-lifecycle/git-worktree/ideation/optimize/session-history); (f) `subagent_type` literals must be 3-segment `plugin:dir:name` matching the agent's `name:` frontmatter exactly; (g) merge-conflict on yellow-core CLAUDE.md count + README skill table is mandatory and quick to resolve.

## Migration & Rollback

Per-component reverts: each Wave 3 PR is independent; reverting one does not affect others. Backbone (`plans/everyinc-merge.md`) must remain merged.

## Stack Progress
<!-- Updated by workflows:work. Do not edit manually. -->
- [x] 1. feat/ce-debug-skill (completed 2026-04-30 via PR #306)
- [ ] 2. feat/yellow-docs-doc-review
- [x] 3. feat/resolve-pr-cluster-and-actionability (completed 2026-04-30 via PR #307)
- [x] 4. fix/git-worktree-and-local-config-expansion (completed 2026-04-30 via PR #287)
- [ ] 5. feat/agent-native-reviewers
- [x] 6. feat/compound-lifecycle-skill (completed 2026-04-30 via PR #296)
- [ ] 7. feat/yellow-debt-confidence-calibration
- [x] 8. feat/ideation-skill (completed 2026-04-30 via PR #310)
- [x] 9. feat/cross-vendor-session-history (completed 2026-04-30 via PR #312)
- [x] 10. feat/optimize-skill (completed 2026-04-30 via PR #311)
- [x] 11. docs/yellow-codex-and-composio-research (completed 2026-04-30 via PR #308)
- [x] 12. feat/plugin-contract-reviewer (completed 2026-04-30 via PR #293)
