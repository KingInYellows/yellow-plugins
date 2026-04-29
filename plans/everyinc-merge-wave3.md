# Feature: EveryInc/Compound-Engineering Selective Merge — Wave 3 (Parallel)

**Date:** 2026-04-28 (decomposition split 2026-04-29)
**Source plan:** `plans/everyinc-merge.md` (backbone — must merge to `main` before this plan runs)
**Status:** Deferred. Run after the backbone (PRs #1–#7 in the source plan) merges to `main`.

---

## Overview

This plan decomposes Wave 3 of the EveryInc merge into **12 parallel feature branches**, each rooted at `main` after the Wave 2 keystone (`plans/everyinc-merge.md` PR #7) has merged. Branches are independent of each other (different files, no cross-dependencies) and can be developed and reviewed in parallel.

All implementation task definitions (W3.1, W3.2, W3.3, W3.4, W3.5, W3.6, W3.7, W3.8, W3.9, W3.10, W3.11, W3.12, W3.13b, W3.14, W3.15) live in `plans/everyinc-merge.md` under the "Wave 3" section. This file only specifies the parallel stack decomposition; do not duplicate task content here.

> **Note on W3.9:** W3.9 (Wave 3 changesets) is intentionally distributed — each parallel branch runs its own `pnpm changeset` as part of its pre-PR checklist. There is no standalone W3.9 branch in the stack decomposition below.

## Implementation Plan

### Phase 0: Pre-Wave Preparation (Wave 3)

Before starting the parallel stack:

- [ ] 0.1 Re-fetch the latest `EveryInc/compound-engineering-plugin` `main` SHA. If it has advanced beyond the backbone's locked SHA (`e5b397c9d1883354f03e338dd00f98be3da39f9f` / `compound-engineering-v3.3.2`), check `gh api repos/EveryInc/compound-engineering-plugin/releases?per_page=10` for new releases and review their changes for impact on Wave 3 tasks. Lock a new SHA for this wave.
- [ ] 0.2 Fetch upstream snapshots for Wave 3 tasks not already snapshotted in the backbone. Required additions (committed in PR #1 below):
  - `skills/ce-debug/` (W3.1)
  - `skills/ce-doc-review/SKILL.md` + agents `ce-coherence-reviewer`, `ce-design-lens-reviewer`, `ce-feasibility-reviewer`, `ce-product-lens-reviewer`, `ce-scope-guardian-reviewer`, `ce-adversarial-document-reviewer` (W3.2)
  - Agents `ce-cli-readiness-reviewer`, `ce-cli-agent-readiness-reviewer`, `ce-agent-native-reviewer`; skills `ce-agent-native-architecture/`, `ce-agent-native-audit/` (W3.5)
  - `skills/ce-compound-refresh/` (W3.10)
  - `skills/ce-ideate/` (W3.11)
  - `agents/ce-session-historian.agent.md` (W3.12)
  - `skills/ce-optimize/` incl. `schema.yaml` and `README.md` (W3.14)
  - `agents/ce-api-contract-reviewer.agent.md` (W3.15 — adapted to plugin-contract focus)
  - `skills/ce-worktree/` (W3.4 reference)
- [ ] 0.3 Validate snapshot bodies are reasonable; flag any > 500 lines for extract-only treatment (per user feedback 2026-04-29: file size is content-driven, not capped — 500 is a soft outer bound).
- [ ] 0.4 Run `pnpm validate:schemas && pnpm test:unit` baseline on `main` after backbone merges. Record green baseline.
- [ ] 0.5 Read the source plan's "Wave 3" section in full so the implementation context is loaded.

For full task content, see `plans/everyinc-merge.md` "Wave 3: P1 Adoptions (reviewed by Wave 2 pipeline)" section.

## Acceptance Criteria

Per-component acceptance is enumerated inside each task in the source plan. The Wave 3 effort is "done" when all 12 parallel PRs below merge to `main`. Each PR is reviewed by the Wave 2 pipeline (the keystone shipped in backbone PR #7). No Wave 3 PR introduces new `Bash` in any reviewer agent (Wave 1 rule applies, enforced by `scripts/validate-agent-authoring.js` Rule X added in backbone PR #5).

## Stack Decomposition

<!-- stack-topology: parallel -->
<!-- stack-trunk: main -->

12 parallel branches from `main`. Each is independent (no cross-branch file overlap) and can be developed, reviewed, and merged in any order. Branch creation is just-in-time per `/workflows:work` Phase 1b parallel topology.

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

### 4. fix/git-worktree-and-local-config-expansion
- **Type:** fix
- **Description:** git-worktree mise/direnv auto-trust + .git is-a-file detection; yellow-plugins.local.md schema expansion (full keys)
- **Scope:** plugins/yellow-core/skills/git-worktree/SKILL.md, plugins/yellow-core/skills/local-config/SKILL.md (extends from backbone PR #7)
- **Tasks:** W3.4, W3.6
- **Depends on:** (backbone merged)

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

### 12. feat/plugin-contract-reviewer
- **Type:** feat
- **Description:** plugin-contract-reviewer agent — detect breaking changes to plugin public surface (subagent_type, command/skill/MCP tool names, manifest fields, hook contracts); auto-invoked when diff touches plugins/* manifests or component frontmatter
- **Scope:** NEW plugins/yellow-review/agents/review/plugin-contract-reviewer.md, plugins/yellow-review/commands/review/review-pr.md (dispatch-table wiring with auto-detection on plugin file paths)
- **Tasks:** W3.15
- **Depends on:** (backbone merged)
- **Notes:** Renamed from CE `ce-api-contract-reviewer`; adapted from REST-API focus to Claude Code plugin-contract focus. Output schema extends Wave 2 reviewer schema with `breaking_change_class` and `migration_path` fields.

## Migration & Rollback

Per-component reverts: each Wave 3 PR is independent; reverting one does not affect others. Backbone (`plans/everyinc-merge.md`) must remain merged.
