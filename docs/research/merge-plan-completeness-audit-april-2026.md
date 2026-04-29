# Impact Analysis: Completeness Audit Gaps + April 2026 Currency on the everyinc-merge Implementation Plan

**Date:** 2026-04-28
**Sources:** Perplexity Sonar Deep Research, Tavily Research (pro), EXA Deep Researcher Pro, Tavily targeted searches
**Inputs:** `plans/everyinc-merge.md` (1670 lines), `docs/brainstorms/2026-04-28-everyinc-merge-completeness-audit-brainstorm.md` (381 lines)

---

## Executive Summary

April 2026 developments materially change the plan in one concrete area and surface two advisory refinements. The most consequential finding is that CE shipped a **hard breaking change** in version 3.0.0 (April 22, 2026): all skills and agents were renamed to the `ce-` prefix via PR #503, making the plan's adoption of source names like `ce-api-contract-reviewer` correct in target form but requiring that any reference to legacy names (e.g., `/ce:work`, `/plugin/workflow:plan`) be explicitly treated as deprecated in the merge. The `ce-learnings-researcher` schema-path bug (GAP-2's concern) was already patched upstream in v3.0.0 (#630), which substantially changes the GAP-2 remediation calculus. Everything else — Codex CLI session format, Devin search API, Cursor/Copilot storage, and the plan's security and evaluation annotations — is confirmed stable or incrementally reinforced by April 2026 research. No plan elements need to be rolled back; several need to be updated forward.

---

## Impact per Audit Gap

### GAP-1: `plugin-contract-reviewer` (Wave 3 PR #18, adopted from `ce-api-contract-reviewer`)

**April 2026 finding:** The upstream source skill `ce-api-contract-reviewer` remains present in the v3.3.1 README skill catalog with the description "Detect breaking API contract changes." It survived the v3.0.0 rename consolidation and was not deprecated. Its position in the reviewer persona set is stable.

**Marketplace backward-compatibility context:** Research confirms no unified cross-marketplace standard exists as of April 2026. VS Code uses the `engines` field + `capabilities` contract (introduced in v1.97); JetBrains uses `since-build`/`until-build` ranges with a Gradle compatibility verifier; GitHub Apps began integrating Manifest Lint in CI PRs (GitHub Engineering blog, April 2026). None of these map directly to Claude Code's `plugin.json` structure. This confirms GAP-1's framing: the plan correctly identified that `plugin-contract-reviewer` fills a gap in the Claude Code plugin ecosystem that no upstream marketplace tooling covers.

**Verdict:** GAP-1 framing confirmed. The skill is stable upstream. The Wave 3 PR #18 plan to adopt it as `plugin-contract-reviewer` (renamed from `ce-api-contract-reviewer`) remains sound. No change required, though the plan should note that the skill's upstream name is now canonically `ce-api-contract-reviewer` (post-v3.0.0 rename) rather than any legacy alias.

### GAP-2: `learnings-researcher` (W2.1) tools list omission

**April 2026 finding:** This is the most significant gap-specific finding. CE v3.0.0 shipped bug fix commit `05ea109` with message **"ce-learnings-researcher: drop unreadable schema path reference (#630)"**. This patch was in the CE changelog retrieved by both Tavily and Perplexity. The fix removed the unreadable schema path reference from the upstream agent — meaning the upstream version of the agent that the plan is adopting has already been patched to remove the problematic reference.

**Implication for the plan:** The deepen-plan annotation directing `learnings-researcher` to call ruvector `hooks_recall` over `docs/solutions/` is a yellow-plugins-local addition, not present in upstream CE. The GAP-2 concern about the tools list not including `ToolSearch` + ruvector MCP tools therefore applies to the **yellow-plugins-local adaptation**, not to CE upstream. Since the plan adds this ruvector capability on top of the adopted skill, the gap is real and must still be remediated in the plan — but the upstream fix to the schema path is a data point that EveryInc's own maintainers identified this exact area as fragile and addressed it. The plan's local adaptation needs explicit tools-list coverage for `ToolSearch` and the ruvector MCP tools regardless.

**Verdict:** GAP-2 concern remains valid for the local adaptation. Upstream patch `05ea109` reduces the risk of inheriting a broken schema reference from CE, but the yellow-plugins-local extension (ruvector `hooks_recall`) still requires explicit `tools:` entries. The open question from the audit — "add ToolSearch + ruvector tools, or handle ruvector optionality differently?" — is now slightly easier to answer: because the upstream agent already had the schema path pruned, the local adaptation should adopt an **optionality approach** (ToolSearch probe first, ruvector call only if tools resolve) to match the defensive posture CE itself took.

### GAP-3: `test-coverage-analyst` Wave 1 parity miss

**April 2026 finding:** No CE releases in April 2026 touched `ce-test-coverage-analyst` or any equivalent skill. The reviewer catalog (v3.3.1 README) lists `ce-testing-reviewer` as the review persona, with `ce-test-coverage-analyst` as a separate agent. Neither was deprecated, and neither received changes that would expand or contract the Wave 1 scope.

**Verdict:** GAP-3 framing stands unaffected by April 2026 research. The question of whether W1.3 (drifted-agent repairs) should touch `test-coverage-analyst` is a plan-internal consistency question with no new external evidence either way. The absence of upstream changes to this skill means the parity check is purely an internal audit task.

---

## Plan Refinements Warranted by April 2026 Developments

### P1 — CE v3.0.0 Breaking Rename Must Be Reflected in All Plan References

CE v3.0.0 (April 22, 2026) introduced a **breaking rename** of all skills and agents to the `ce-` prefix via PR #503. Specifically:
- `ce-review` became `ce-code-review`
- `ce-document-review` became `ce-doc-review`
- All legacy `/plugin/workflow:*` command aliases are deprecated (still functional with warnings, but not canonical)

The plan references source skill names extensively in Wave 3 adoption PRs and in the `subagent_type` registration table. Any plan prose that uses legacy names (pre-v3.0.0 form) must be updated to `ce-code-review`, `ce-doc-review`, etc. Any reference to `ce:work`, `ce:plan`, `ce:review` in command invocation examples should use the post-v3.0.0 form.

**Action:** Audit the plan's skill adoption table and Wave 3 PR descriptions for legacy command names. Apply `s/ce:review/ce-code-review/`, `s/ce:document-review/ce-doc-review/` as applicable.

### P1 — ce-code-review Rubric Changed in 3.2.0: LFG Rubric Removed

CE v3.2.0 (April 26, 2026, commit `ad9577e`) replaced the LFG (Let it F*cking Go) auto-resolve rubric with **best-judgment auto-resolve** and tightened `autofix_class` thresholds. The plan's description of the ce-code-review confidence rubric — if it references the LFG rubric specifically — is now stale. The new rubric is judgment-based rather than named-heuristic-based.

Additionally, v3.2.0 moved ce-code-review run artifacts from `.context/` to `/tmp`. Any plan element that discusses artifact storage location for the review pipeline must reflect this.

**Action:** Update the plan's annotation on ce-code-review confidence calibration to note that the LFG rubric was replaced by best-judgment auto-resolve in v3.2.0. If the plan's W3 PR for adopting `ce-code-review` describes artifact paths, update to `/tmp`.

### P2 — Reviewer Queuing Bug Fix (3.3.1) Is Relevant to Multi-Persona Pipeline Design

CE v3.3.1 (April 28, 2026, today) fixed **reviewer queuing when subagent slots filled** (#716). This is directly relevant to the plan's Wave 3 persona pipeline, which spawns multiple reviewer sub-agents. The bug fix indicates that in prior versions, reviewers could be silently dropped when the subagent slot limit was reached.

**Action:** The plan's Wave 3 PR for the persona pipeline should explicitly target CE v3.3.1 or later as the baseline and note that v3.2.0 and earlier have the queuing bug. Add a deepen-plan annotation: "Verify the reviewer-queuing fix (#716) is present before deploying the multi-persona pipeline."

### P2 — ce-learnings-researcher Schema Path Fix Changes the Adoption Baseline

The upstream bug fix (#630, commit `05ea109`) removes a "drop unreadable schema path reference" from `ce-learnings-researcher`. The plan's W2.1 adoption of this agent should be based on the post-#630 version. If the plan's snapshot of the agent predates v3.0.0, the adopted version contains the broken schema path reference.

**Action:** Confirm the plan's W2.1 source snapshot is at or after CE v3.0.0 (April 22, 2026). If not, re-snapshot from the current main branch.

### P2 — Prompt Injection Defenses: AgentVisor Is Now the Leading Reference

The plan's Security Considerations annotation cites ROLP, structured outputs, and PromptArmor. April 2026 produced a significant new result: **AgentVisor** (arxiv 2604.24118, April 2026), which achieves 0.65% attack success rate with only 1.45% utility loss using an OS-virtualization-inspired STI (Suitability, Taint, Integrity) protocol. This is the strongest published result to date for agentic prompt injection defense.

Additionally, the extended model-reliant defense evaluation (arxiv 2604.23887) showed that even the sandwich defense degrades from 0.4% to 3.8% leak rate under 277-round sustained attack, and that application-layer output filtering is the only defense achieving zero leaks across 15,000 attacks. This is directly relevant to the plan's multi-agent pipeline design.

**Action (P2):** Add AgentVisor (arxiv 2604.24118) to the plan's Security Considerations annotation. Add the finding that model-reliant defenses degrade under sustained attack — the plan's security posture should emphasize application-layer controls (output filtering, structured output schemas) over model-level instruction fencing.

### P3 — LLM-as-Judge: Style Bias Now Established as the Dominant Bias

The plan's W3.14 LLM-as-judge annotations cite length-bias and position-bias studies. April 2026 research (arxiv 2604.23178) across 9 debiasing strategies and 5 judge models establishes that **style bias (0.76–0.92) dominates**, with position bias now negligible (<0.04) due to improved instruction tuning. The practical implication: the plan's reviewer pipeline should normalize markdown formatting across all reviewer outputs before any aggregation step, and chain-of-thought prompting provides the largest single style-bias reduction (-0.14).

**Action (P3):** Add a deepen-plan annotation to W3.14 noting style bias as the dominant concern (replacing the prior position-bias focus) and recommend CoT + rubric-based combined debiasing as the current best practice.

### P3 — Devin Session Search: New Response Fields Available

The Devin API (2026 release notes) added `child_session_ids`, `parent_session_id`, and `is_advanced` to session response objects. The plan's W3.12 (cross-vendor session history) reads Devin sessions. These new fields enable the cross-vendor history feature to detect parent-child session chains, which improves session continuity reconstruction.

**Action (P3):** The plan's W3.12 implementation for Devin session ingestion should be updated to consume `child_session_ids` and `parent_session_id` for session lineage tracking.

---

## Confirmed-Still-Current

The following plan elements are validated as accurate by April 2026 research:

- **Codex CLI `~/.codex/sessions/` JSONL format:** Stable. Codex CLI 0.125.0 added TUI/app-server features (Unix socket transport, pagination-friendly resume/fork) but made no schema changes to the sessions directory layout or JSONL format.
- **Cursor workspaceStorage SQLite format (`state.vscdb`):** Stable. Cursor 3.1/3.2 changelogs list no storage format changes. WAL mode was recently enabled but this is an internal SQLite optimization, not a format change.
- **GitHub Copilot CLI `session-store.db` SQLite format:** Stable. No format migration documented in March–April 2026.
- **Devin `devin_session_search` core schema (query, start_time, end_time):** Stable in April 2026. No breaking changes or new required parameters.
- **Persona reviewer pipeline pattern (multi-agent aggregation improves F1 scores):** Confirmed by SWR-Bench (FSE 2026) showing up to 43.67% F1 improvement from multi-review aggregation on realistic PR datasets.
- **Premasundera adaptive threshold approach:** The thesis uses `θ_adaptive = θ! − 0.1 × s` (severity-aware adaptive formula), not a fixed 0.7. The plan should reflect this nuance — it is an adaptive formula, not a flat threshold. No April 2026 update supersedes this.
- **PromptArmor (GPT-4o, <1% FPR/FNR on AgentDojo):** Still the reference for model-based detection in short-horizon evaluations. Now contextualized by the finding that model-reliant defenses degrade under sustained multi-round attack.
- **ce-api-contract-reviewer skill presence in CE:** Still in the catalog. Not deprecated.
- **ce-swift-ios-reviewer as a new persona:** Confirmed added in v3.0.0/3.1.0 (#638). This is a net addition the plan should include if it catalogs the reviewer set.

---

## Sources

### EveryInc / Compound Engineering
- [CE v3.0.0 release (NewReleases.io)](https://newreleases.io/project/github/EveryInc/compound-engineering-plugin/release/compound-engineering-v3.0.0) — BREAKING: ce- prefix rename (#503); ce-learnings-researcher schema fix (#630)
- [CE v3.1.0 release (NewReleases.io)](https://newreleases.io/project/github/EveryInc/compound-engineering-plugin/release/compound-engineering-v3.1.0) — Swift/iOS persona (#638), ce-ideate, ce-brainstorm additions
- [CE v3.2.0 / v3.3.1 (EXA report, GitHub commits)](https://github.com/EveryInc/compound-engineering-plugin) — LFG rubric replaced; artifact path /tmp; reviewer queuing fix (#716)
- [CE README v3.3.1 skill catalog](https://github.com/EveryInc/compound-engineering-plugin/blob/main/plugins/compound-engineering/README.md) — confirmed ce-api-contract-reviewer present
- [Compound Engineering V3 (LinkedIn/Trevin Chow)](https://www.linkedin.com/pulse/compound-engineering-v3-trevin-chow-zyvzc) — v3 naming rationale

### OpenAI Codex CLI
- [OpenAI Codex CLI features / session docs](https://developers.openai.com/codex/cli/features) — session schema stable, JSONL format unchanged

### Devin API
- [Devin API release notes 2026](https://docs.devin.ai/api-reference/release-notes) — child_session_ids, parent_session_id, is_advanced added; insights endpoints
- [Devin session search MCP docs](https://docs.devin.ai/work-with-devin/devin-mcp) — schema stable in April 2026

### Cursor / GitHub Copilot
- [Cursor forum thread — state.vscdb stability](https://forum.cursor.com/t/cursor-state-vscdb-growing-at-1-gb-in-a-day/151747) — SQLite continues as format
- [GitHub Copilot CLI config dir reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference) — session-store.db SQLite confirmed

### Prompt Injection Defenses
- [AgentVisor (arxiv 2604.24118, April 2026)](https://arxiv.org/html/2604.24118v1) — STI protocol, 0.65% attack success rate
- [Extended model-reliant defense evaluation (arxiv 2604.23887)](https://arxiv.org/html/2604.23887v1) — sandwich defense degradation, output filtering as only zero-leak defense
- [ToolHijacker (NDSS 2026)](https://www.ndss-symposium.org/wp-content/uploads/2026-s675-paper.pdf) — tool-selection-phase attack, 99.6% success vs StruQ
- [PromptArmor (OpenReview)](https://openreview.net/forum?id=IeNXtofK6T) — <1% FPR/FNR on AgentDojo with GPT-4o

### LLM-as-Judge
- [Style/verbosity/position bias study across 5 judge models (arxiv 2604.23178)](https://arxiv.org/html/2604.23178v1) — style bias 0.76–0.92 dominates; position bias <0.04
- [Self-preference bias / perplexity alignment (OpenReview)](https://openreview.net/forum?id=Ns8zGZ0lmM) — GPT-4 self-preference via perplexity mechanism
- [BiasScope automated bias discovery (arxiv 2602.09383)](https://arxiv.org/abs/2602.09383)

### Persona Reviewer Pipelines
- [SWR-Bench FSE 2026](https://conf.researchr.org/details/fse-2026/fse-2026-research-papers/78/SWR-Bench-Assessing-LLM-Performance-in-Real-World-Code-Review-Comment-Generation) — 43.67% F1 improvement from multi-review aggregation
- [Premasundera MSc thesis (adaptive threshold formula)](https://trepo.tuni.fi/bitstream/10024/232334/2/PremasunderaSavidya.pdf)

### Plugin Marketplace Patterns
- [JetBrains build number ranges / compatibility docs](https://plugins.jetbrains.com/docs/intellij/build-number-ranges.html) — since-build/until-build range pattern
- [VS Code February 2026 (v1.110) — agent plugins](https://code.visualstudio.com/updates/v1_110)
