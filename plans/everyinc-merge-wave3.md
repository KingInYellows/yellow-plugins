# Feature: EveryInc/Compound-Engineering Selective Merge — Wave 3 (Parallel)

**Date:** 2026-04-28 (decomposition split 2026-04-29; reconciled 2026-04-30)
**Source plan:** `plans/everyinc-merge.md` (backbone — must merge to `main` before this plan runs)
**Status:** Backbone merged (PRs #273–#275, #280–#283 + follow-ups #287/#288/#290/#294/#295). Item #4 shipped via PR #287; item #12 shipped via PR #293; phase-0 snapshots + plan reconciliation shipped via PR #300. **10 parallel branches remain** (items #4 and #12 are both done; the runway is fully unblocked).

## Reconciliation 2026-04-30

After the backbone merged, two of the 12 stack items already changed state:

- **Item #4 (`fix/git-worktree-and-local-config-expansion`, W3.4 + W3.6) — DONE.** Shipped via PR #287 as a Wave 3 trial (`bb5855e` on `main`). Not on the parallel-runway anymore.
- **Item #12 (`feat/plugin-contract-reviewer`, W3.15) — DONE.** Shipped via PR #293 (squash-merged 2026-04-30 as `f3985d8` on `main`). Adds `plugins/yellow-review/agents/review/plugin-contract-reviewer.md` (~241 lines), wires the dispatch table in `review-pr.md` and `review-all.md`, and ships its own changeset. Item #5 (`feat/agent-native-reviewers`) — when it lands — should add its three new personas alongside the now-merged plugin-contract-reviewer in the dispatch table.

**Effective parallel branch count for this wave:** **10 branches.** Items #4 and #12 are accounted for outside the parallel-runway.

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

**Original count:** 12 parallel branches from `main`. **As of 2026-04-30 reconciliation:** item #4 is DONE (PR #287); item #12 is IN FLIGHT (PR #293). Active runway is **10 branches**. Each remaining branch is independent (no cross-branch file overlap) and can be developed, reviewed, and merged in any order. Branch creation is just-in-time per `/workflows:work` Phase 1b parallel topology.

### 1. feat/ce-debug-skill
- **Type:** feat
- **Description:** ce-debug analog skill — test-first systematic debugging, causal chain tracing
- **Scope:** NEW plugins/yellow-core/skills/debugging/SKILL.md
- **Tasks:** W3.1
- **Depends on:** (backbone merged)

### 2. feat/yellow-docs-doc-review
- **Type:** feat
- **Description:** ce-doc-review in yellow-docs — 6 personas + adversarial-document-reviewer + new /docs:review command
- **Scope:** NEW plugins/yellow-docs/agents/review/{coherence,design-lens,feasibility,product-lens,scope-guardian,security-lens,adversarial-document}-reviewer.md, NEW plugins/yellow-docs/commands/docs/review.md
- **Tasks:** W3.2
- **Depends on:** (backbone merged)

### 3. feat/resolve-pr-cluster-and-actionability
- **Type:** feat
- **Description:** resolve-pr cross-invocation cluster analysis + actionability filter (CE PRs #480, #461)
- **Scope:** plugins/yellow-review/commands/review/resolve-pr.md
- **Tasks:** W3.3
- **Depends on:** (backbone merged)

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

### 6. feat/compound-lifecycle-skill
- **Type:** feat
- **Description:** compound-lifecycle skill — staleness detection, overlap detection, archive-don't-delete consolidation
- **Scope:** NEW plugins/yellow-core/skills/compound-lifecycle/SKILL.md, NEW docs/solutions/archived/
- **Tasks:** W3.10
- **Depends on:** (backbone merged)

### 7. feat/yellow-debt-confidence-calibration
- **Type:** feat
- **Description:** yellow-debt scanner schema v2.0 — failure_scenario field + field renames; audit-synthesizer dual-read v1.0/v2.0
- **Scope:** plugins/yellow-debt/agents/scanners/{ai-pattern,architecture,complexity,duplication,security-debt}-scanner.md, plugins/yellow-debt/agents/synthesis/audit-synthesizer.md, plugins/yellow-debt/skills/debt-conventions/SKILL.md (schema_version bump)
- **Tasks:** W3.13b
- **Depends on:** (backbone merged)
- **Notes:** Breaking schema change (v1.0 → v2.0). Synthesizer must dual-read during transition.

### 8. feat/ideation-skill
- **Type:** feat
- **Description:** ideation skill with Toulmin warrant contract + MIDAS three-phase model; routes selected approach to brainstorm-orchestrator via Task
- **Scope:** NEW plugins/yellow-core/skills/ideation/SKILL.md
- **Tasks:** W3.11
- **Depends on:** (backbone merged)

### 9. feat/cross-vendor-session-history
- **Type:** feat
- **Description:** cross-vendor session-historian (Claude Code + Devin + Codex backends) with hybrid query (BM25 + cosine + RRF) + secret redaction
- **Scope:** NEW plugins/yellow-core/skills/session-history/SKILL.md, NEW plugins/yellow-core/agents/workflow/session-historian.md
- **Tasks:** W3.12
- **Depends on:** (backbone merged)

### 10. feat/optimize-skill
- **Type:** feat
- **Description:** ce-optimize analog — LLM-as-judge with parallel experiments, schema.yaml, two-run order-swap, judge_telemetry schema
- **Scope:** NEW plugins/yellow-core/skills/optimize/SKILL.md, NEW plugins/yellow-core/skills/optimize/schema.yaml
- **Tasks:** W3.14
- **Depends on:** (backbone merged)

### 11. docs/yellow-codex-and-composio-research
- **Type:** docs
- **Description:** yellow-codex + yellow-composio expansion research reports (no implementation, research-level deliverable only)
- **Scope:** NEW docs/research/yellow-codex-expansion.md, NEW docs/research/yellow-composio-expansion.md
- **Tasks:** W3.7, W3.8
- **Depends on:** (backbone merged)

### 12. feat/plugin-contract-reviewer — **DONE (PR #293, merged 2026-04-30 as `f3985d8`)**
- **Type:** feat
- **Description:** plugin-contract-reviewer agent — detect breaking changes to plugin public surface (subagent_type, command/skill/MCP tool names, manifest fields, hook contracts); auto-invoked when diff touches plugins/* manifests or component frontmatter
- **Scope:** NEW plugins/yellow-review/agents/review/plugin-contract-reviewer.md, plugins/yellow-review/commands/review/review-pr.md (dispatch-table wiring with auto-detection on plugin file paths)
- **Tasks:** W3.15
- **Depends on:** (backbone merged)
- **Notes:** Renamed from CE `ce-api-contract-reviewer`; adapted from REST-API focus to Claude Code plugin-contract focus. Output schema extends Wave 2 reviewer schema with `breaking_change_class` and `migration_path` fields.
- **Status:** Shipped. Upstream snapshot `agents/ce-api-contract-reviewer.agent.md` is on `main` (added by PR #293, also fetched in PR #300 for posterity but deduplicated during rebase). Item #5 (`feat/agent-native-reviewers`), when authored, must register its three new personas in the same dispatch table.

## Migration & Rollback

Per-component reverts: each Wave 3 PR is independent; reverting one does not affect others. Backbone (`plans/everyinc-merge.md`) must remain merged.
