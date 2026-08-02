# yellow-council V2 Rescope Brainstorm

**Date:** 2026-08-01
**Input:** `docs/research/yellow-council-v2-revalidation-2026-08-01.md` (fully codebase- and research-validated as of today; 0 of the original 27 tasks landed, yellow-council still at 0.2.9 with 2 reviewer agents)
**Feeds:** `/workflows:spec` → `/workflows:decompose` (shells pipeline). This document is NOT a plan and should not be handed to `/workflows:plan`.
**Excluded from this brainstorm:** Phase G (Gemini → Antigravity CLI migration) ships as an urgent standalone bugfix regardless of the decisions below. It is referenced here only where its outcome (Risk R0) constrains other V2 decisions.

---

## What We're Building

A re-scoped V2 for `yellow-council`'s four-CLI review architecture, decided against the 2026-08-01 revalidation record rather than the original (partially stale) plan. V2 consists of:

- **Phase 0** — codex-reviewer contract normalization (cross-plugin: touches `plugins/yellow-codex/`, not `plugins/yellow-council/`). Confirmed in scope: it's a hard prerequisite for uniform 4-way verdict parsing in `council.md`, and the decompose step needs to know this PR crosses a plugin boundary.
- **Phase 1** — Add `claude-reviewer` as the 4th slot, hardcoded (not a registry). Fan-out is 4 named reviewers: claude / codex / gemini(-via-agy) / opencode.
- **Phase 2** — Bias mitigation: double-blind lineage labels, 2-pass order-swap with flip-as-tie semantics, self-participant instruction, structured rubric decomposition (Task 2.4), **plus two new style-bias countermeasures** (see Key Decisions).
- **Phase 3, slimmed** — Quota handling reduced to per-reviewer error-string detection only (`verdict=QUOTA_EXHAUSTED` with parsed reset ETA). No `quota.json` state file, no pre-flight headroom check, no `COUNCIL_MIN_REVIEWERS` quorum gate, no `COUNCIL_QUOTA_RESET` handler.
- **Phase 4** — OpenCode routed to a non-Big-3 lineage (DeepSeek V4 Pro default via OpenRouter), exact slug/recipe resolved by Task 4.0's spike.
- **Phase 5, full** — Tier 1-2 evidence verification (exact match + `rapidfuzz` fuzzy match ≥85), five-bucket synthesis output. Kept in V2, not split into a follow-on spec.
- **Phase 6** — Final cross-cutting validation + e2e tests, scoped to whatever the above phases actually ship.

Line numbers and specific edit surfaces are NOT reproduced here — the record itself notes that PR-G (migrating `gemini-reviewer.md` first) shifts every downstream line reference. Treat all locators in the revalidation record as **pre-PR-G** and re-verify at spec/decompose time.

---

## Why This Approach

Four scope questions were open going into this brainstorm; all four were resolved by treating "what does the record already lock/tolerate" as the default and asking only about the genuinely undecided residue:

1. **Reviewer fan-out** — the architecture (per Task 3.2/3.3 in the record) already tolerates fewer than 4 active reviewers at runtime via `UNAVAILABLE`/`QUOTA_EXHAUSTED` verdicts and a lineage-collision warning. Generalizing to a count-agnostic registry now would be solving a problem the runtime already handles; hardcoding 4 named slots is the simpler approach and matches the record as written. Risk R0 (Antigravity subscription-auth continuity) doesn't change this — it changes what "the gemini slot" resolves to, not whether the fan-out mechanism needs to be dynamic.
2. **Quota tracking** — Risk R2's own mitigation already makes the tracker advisory-by-default (`cap: null` unless the user opts in). Building the full numeric scaffolding (state file, dual-window tracking, pre-flight warnings, quorum gate, reset handler) around a mechanism that ships disabled by default is speculative complexity for V2; the shared, load-bearing piece — `QUOTA_EXHAUSTED` propagating cleanly through the verdict enum — is retained regardless.
3. **Bias mitigation cut line** — most of Phase 2 (double-blind, order-swap, self-participant, flip-as-tie) is already locked and prompt-only, so there was nothing to decide there. The one open item, Task 2.4 (rubric decomposition), earns its place given the 2026 self-preference research it's based on. The learnings pre-pass surfaced that style bias (formatting/verbosity) now dominates position bias in judge pipelines (coefficient 0.76–0.92 vs. <0.04) — a bigger empirical problem than either self-preference or position bias — and its fix (formatting normalization + CoT in the synthesizer prompt) is equally prompt-only. Folding it in costs nothing beyond what's already being built.
4. **Evidence verification (Phase 5)** — this decision was coupled to #3: once Task 2.4's rubric ships with a "correctness of cited evidence" dimension, that dimension needs real verification behind it or it's decorative. Keeping Phase 5 in V2 is what makes the rubric decomposition honest rather than a self-assessed claim.

The net effect: V2 keeps everything that's cheap (prompt-only bias mitigations) or load-bearing (Phase 0 normalization, Phase 5 verification backing Task 2.4), and cuts the one piece of scaffolding (full Phase 3) that the record's own design already makes optional.

---

## Key Decisions

- **Fan-out stays hardcoded at 4 named slots** (claude / codex / gemini / opencode) — no reviewer registry in V2. **R0 decision rule** (not a scope decision to revisit later): if Task G.1's spike shows `agy` requires an API key or per-token billing, do NOT remove the Google slot or add a registry — route the Google lineage through OpenCode/OpenRouter's `google/gemini-*` slugs instead, keeping the 4-slot shape intact. This rule belongs in the spec so `/workflows:decompose` doesn't need to re-litigate it if R0 resolves unfavorably.
- **Quota tracking is Task 3.3 only.** Per-reviewer error-string detection returns `verdict=QUOTA_EXHAUSTED` with a parsed reset ETA. The shared prerequisite — adding `QUOTA_EXHAUSTED` to the verdict enum in all four reviewer agent files plus `council.md`'s parser — ships regardless (otherwise it silently normalizes to `UNKNOWN`, per the record's locked decision). Tasks 3.1, 3.2, 3.4, 3.5 (state file, pre-flight headroom, `COUNCIL_MIN_REVIEWERS` quorum gate, `COUNCIL_QUOTA_RESET`) are cut from V2 entirely, not deferred to a specific later version — revisit only if slim tracking proves insufficient in practice.
- **Task 2.4 (rubric decomposition) ships in V2**, plus two style-bias countermeasures folded into Tasks 2.1/2.4: (a) strip/normalize markdown formatting from each reviewer's findings before they enter the synthesis prompt, (b) require chain-of-thought in the synthesizer ("list findings, then compare") before it renders a verdict. Source: `docs/solutions/code-quality/llm-as-judge-style-bias-dominance.md` (surfaced by the Phase 0b learnings pre-pass, not in the original revalidation record — this is new information the spec should cite).
- **Phase 5 (Tier 1-2 evidence verification) stays in V2**, specifically because of the Task 2.4 coupling: the rubric's "correctness of cited evidence" dimension is only real if Phase 5 exists to check citations. Shipping Task 2.4 without Phase 5 would mean that dimension is self-assessed by the synthesizer with nothing verifying it — flagged during the brainstorm dialogue and resolved by keeping both in V2 together, not as independently-sized phases.
- **Phase 0 (codex-reviewer normalization) is confirmed in V2 scope** and is explicitly cross-plugin — it touches `plugins/yellow-codex/`, not `plugins/yellow-council/`, and needs its own changeset. `/workflows:decompose` should treat it as a separate unit of work from the yellow-council-scoped phases that follow it in the PR stack.
- **Don't carry forward exact line numbers from the revalidation record into the spec.** PR-G edits `gemini-reviewer.md` before the rest of the stack lands, and the record itself notes this shifts referenced line numbers for every later PR. Point the spec at the record's annotated sections by name/task ID, and have `/workflows:decompose` re-verify locators against the actual pre-PR-G codebase state.

---

## Open Questions

Carried forward from the revalidation record, still unresolved and out of this brainstorm's scope to answer (they resolve empirically, not by user preference):

- **R0 — Antigravity subscription-auth continuity.** Task G.1's spike (part of the independent Phase G bugfix) determines whether `agy` preserves subscription auth without an API key. This brainstorm has already fixed the *response* to either outcome (see Key Decisions), so the spec doesn't need to branch on it — but the spec should still state the decision rule explicitly so it's not re-derived at decompose time.
- **OpenCode → OpenRouter routing recipe.** Task 4.0's spike (`opencode models | grep -i deepseek`) determines the actual slug format; the record's revision-1 `defaultProvider` mechanism is confirmed wrong/undocumented. Not user-decidable — resolves from spike output.
- **Synthesis as inline orchestrator logic vs. a dedicated Task subagent.** The record defers this to V3 unless empirical bias measurements after V2 ships show inline synthesis leaking lineage labels. No action needed now.
- **Diff-lines-only vs. full-file evidence verification scope in Phase 5.** The record's working answer (diff lines for `review` mode, full file for `plan`/`debug`/`question` modes) should be confirmed at spec time, not reopened here — it wasn't one of the four scope questions this brainstorm addressed.
