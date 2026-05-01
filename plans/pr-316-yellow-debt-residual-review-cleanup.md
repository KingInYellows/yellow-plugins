# Feature: PR #316 Residual Review Cleanup — yellow-debt v2.0 Schema

**Date:** 2026-05-01
**Source:** Multi-agent review of PR #316 (`feat(yellow-debt): scanner output schema v2.0 with confidence-rubric calibration (W3.13b)`). 5 P1 findings already shipped as commit `90a00da` on `agent/feat/yellow-debt-confidence-calibration`. This plan covers the remaining ~13 P2 + ~8 P3 findings.
**Parent PR:** [#316](https://app.graphite.com/github/pr/KingInYellows/yellow-plugins/316) (Wave 3 item #7 of `plans/everyinc-merge-wave3.md`).

## Problem Statement

PR #316 introduced a breaking schema migration (v1.0 → v2.0) for yellow-debt scanner outputs and a confidence-rubric gate in `audit-synthesizer.md`. The 10-reviewer pipeline surfaced 21 non-P1 findings clustered into six themes:

1. **Cross-doc consistency drift** — synthesizer mapping table, SKILL.md schema, README todo template, and 5 scanner agents reference the same fields with different prose. The P1 round already fixed the worst case (`## Suggested Remediation` ≠ `## Fix`); P2/P3s are smaller drift-prevention items.
2. **Documentation gaps** — `_migrated_from` stamp, `suppressed[]` schema, `+0.05` bump rationale, Diffray attribution caveat, and transition-window removal-trigger TODO are all undocumented in SKILL.md (the stated "single source of truth").
3. **Bash hardening** — `audit-synthesizer.md` Step 7 slug-derivation block lacks jq exit-code guard and references `$id`/`$severity`/`$content_hash` without deriving them in the same subshell (per the MEMORY.md "bash-block-subshell-isolation" pattern).
4. **DRY** — 5 scanner agents have a verbatim `failure_scenario` boilerplate sentence that belongs in `debt-conventions/SKILL.md`.
5. **Changeset metadata** — bump-type is `minor` but the body says "This is a breaking change to the on-disk JSON contract" — should be `major`.
6. **YAGNI design call** — code-simplicity reviewer argued the dual-read v1.0 path is dead-on-arrival because `.debt/scanner-output/` is gitignored and all 5 scanners now emit v2.0. Removing the dual-read collapses Step 4 from 5 sub-steps to 4 and removes the `_migrated_from` stamp entirely. **This is a design judgment, not a bug fix** — flag for `/workflows:brainstorm` before implementation.

## Current State

- PR #316 is open at `a2486f1` base on `main`, branch `agent/feat/yellow-debt-confidence-calibration` at HEAD `90a00da` (post-P1 fixes).
- Three new docs/solutions entries from this session's compound work codify the patterns this plan enforces:
  - `docs/solutions/code-quality/multi-doc-schema-rename-drift.md` — canonical-source pattern for cross-doc field renames.
  - `docs/solutions/code-quality/dual-read-migration-window-gitignored-artifacts.md` — YAGNI decision rule for dual-read transitions.
  - `docs/solutions/code-quality/claude-code-command-authoring-anti-patterns.md` (Update — 2026-05-01 section) — null-check ordering bug; companion to step ordering rules.
- These three docs are currently untracked on the merge-queue worktree and need their own commit/PR before the plan's PR1 can cite them in code review.

## Proposed Solution

Stack-of-two follow-up PRs, plus one optional design-decision PR gated on brainstorm:

- **PR1 (stack base, type: `chore`):** Cross-doc consistency + DRY + documentation gaps + changeset metadata. Pure prose changes; no behavior change. ~9 P2 + ~6 P3 findings.
- **PR2 (stack tip, type: `fix`):** Bash hardening in `audit-synthesizer.md` Step 7. Real correctness improvement (jq guard) plus pre-existing macOS portability fix. 1 P2 + 1 P3 (pre-existing).
- **PR3 (optional, type: `refactor`):** YAGNI removal of dual-read v1.0 path, `_migrated_from` stamp, and `suppressed[]` array. **Gated on `/workflows:brainstorm` to validate the design decision** — the P1 round already widened the bump rule to fire on `failure_scenario == null` for v2.0 records, so removing the v1.0 path is now decoupled from the v2.0 calibration.

The new docs/solutions entries from compound should land before PR1 so the code review can cite them by stable path. Ship them as a separate `docs:` PR — call this **PR0**.

### Key Design Decisions

- **PR0 first (separate from this stack):** The 3 new docs/solutions entries must merge to `main` before PR1 lands so PR1's review can cross-reference stable paths. PR0 is doc-only; no plugin code touched. Single commit, no changeset.
- **PR1 as `chore` not `fix`:** No behavior change — prose drift cleanup. Conventional-commit type matches; changeset is `patch` for yellow-debt (or none if the changes are entirely doc-string-only). Confirm against existing `chore` precedents on `main` (PR #275 `chore: strip Bash from 13 reviewer agents` is the parallel — same scope: prose changes across multiple agents/skills, no runtime behavior change).
- **PR2 as `fix`:** Real correctness improvement (jq exit-code guard, undocumented `$id` etc.). Changeset `patch` for yellow-debt.
- **PR3 deferred and gated:** Dual-read removal is a non-trivial design call. The PR author chose defense-in-depth deliberately. Removing requires brainstorm + buy-in, not a unilateral "code-simplicity says YAGNI" call.

### Trade-offs Considered

- **Single mega-PR vs stack-of-two:** Mega-PR would conflate `chore` (prose) with `fix` (bash hardening) under one commit. Reviewers can't separate "are the prose changes correct?" from "is the bash code correct?". Stack-of-two keeps reviews tight.
- **Roll PR3 into PR1/PR2 vs separate PR:** Rolling in lets the YAGNI critique drive the change. Separate PR forces an explicit design discussion, which is the right outcome for a non-trivial removal.
- **Absorb compound docs into PR1 vs separate PR0:** Separate PR0 is cleaner — `docs/solutions/` entries are institutional knowledge that doesn't depend on PR #316 landing. Decoupling means PR0 can merge whether or not PR #316 itself merges.

## Implementation Plan

### Phase 0: Preconditions

- [ ] 0.1 PR #316's P1 round (`90a00da`) lands on `main`. PR1 of this plan rebases onto that merge SHA.
- [ ] 0.2 PR0 (compound docs) merges to `main`. The 3 untracked files on the merge-queue worktree (`docs/solutions/code-quality/multi-doc-schema-rename-drift.md`, `dual-read-migration-window-gitignored-artifacts.md`, the amended `claude-code-command-authoring-anti-patterns.md`) plus the MEMORY.md additions ship as one commit.
- [ ] 0.3 Verify the failed pre-existing validation in `plugins/yellow-core/agents/workflow/session-historian.md` (refers to skill "mcp-integration-patterns" without `skills:` preload) is being addressed by another PR — out-of-scope for this plan.

### Phase 1: PR0 — Compound knowledge docs (separate commit on a new branch)

- [ ] 1.1 Branch `docs/pr-316-review-learnings` from `main`.
- [ ] 1.2 Stage and commit:
  - NEW `docs/solutions/code-quality/multi-doc-schema-rename-drift.md` (already written, untracked)
  - NEW `docs/solutions/code-quality/dual-read-migration-window-gitignored-artifacts.md` (already written, untracked)
  - MODIFIED `docs/solutions/code-quality/claude-code-command-authoring-anti-patterns.md` (already amended)
  - MODIFIED `MEMORY.md` (cluster heading + 3 pointer lines, already added)
- [ ] 1.3 Conventional-commit message: `docs(solutions): capture PR #316 review learnings — schema-rename drift, dual-read YAGNI, null-check ordering`
- [ ] 1.4 No changeset (docs-only, marketplace plugins untouched).
- [ ] 1.5 `gt submit --no-interactive`.

### Phase 2: PR1 — Cross-doc consistency + DRY + documentation gaps + changeset metadata

Branch from `main` (post-PR0 + post-PR316). Type: `chore`.

#### Cross-doc consistency

- [ ] 2.1 (P2 #10) `plugins/yellow-debt/README.md`: update `/debt:audit` output bullet from `todos/debt/NNN-pending-SEVERITY-slug.md` to `todos/debt/NNN-pending-SEVERITY-slug-HASH.md` to match the synthesizer Step 7 format string.
- [ ] 2.2 (P3 #28) `plugins/yellow-debt/README.md:187`: change bare `audit-synthesizer.md` reference to `agents/synthesis/audit-synthesizer.md` to match the relative-path style used elsewhere.
- [ ] 2.3 (P3 #25) `plugins/yellow-debt/README.md:185-188`: expand the one-sentence forward-reference to inline a name-mapping summary (`in-memory: file.path / file.lines → on-disk: affected_files[0] as path:lines`).

#### DRY

- [ ] 2.4 (P2 #12) Add a "Category-Specific Failure Scenario Framing" subsection to `plugins/yellow-debt/skills/debt-conventions/SKILL.md` containing the canonical examples (currently duplicated as ~9 lines in each of 5 scanner agents). Each scanner's "Output Requirements" block keeps the one-sentence framing instruction (which is genuinely category-specific) and replaces the "When no concrete scenario can be constructed, emit `null`..." boilerplate with a single-line cross-reference: `See debt-conventions § Category-Specific Failure Scenario Framing for null-emit rules.`

#### Documentation gaps in SKILL.md (the stated single-source-of-truth)

- [ ] 2.5 (P2 #6) Document the `_migrated_from` stamp in SKILL.md "Schema Migration" section: it's an internal in-memory sentinel, not part of the v2.0 schema, used only by the synthesizer's Step 4 missing-failure-scenario bump rule. Add reciprocal comment in audit-synthesizer.md Step 1 stamp site referencing the SKILL.md doc.
- [ ] 2.6 (P2 #7) Add a footnote or sub-row to the SKILL.md "Confidence Rubric — Category Thresholds" table documenting the +0.05 missing-failure-scenario bump (now triggered for v1.0-stamped OR v2.0 null records, per P1 #5 fix). The threshold table must be self-documenting — readers should not have to open audit-synthesizer.md Step 4 to discover the bump rule.
- [ ] 2.7 (P2 #14, P3 #30) Add a "Synthesizer Report Stats Schema" subsection to SKILL.md after the scanner output schema. Document `suppressed_by_confidence_gate`, `survived_severity_exception`, `migrated_from_v1`, AND the per-finding `suppressed[]` array shape (entry shape: finding identifier, category, confidence, gate_threshold, reason).
- [ ] 2.8 (P2 #8, P3 #31) `SKILL.md:93-94`: add a one-line caveat to the Diffray citation noting that the upstream `confidence-rubric.md` Comparable benchmarks section explicitly disclaims those values as adoption authority and warns about LLM overconfidence. Per-row rationale on `architecture: 0.80` should note the divergence from Diffray's logic/correctness 0.70.
- [ ] 2.9 (P2 #13) Add an explicit removal-trigger TODO above the SKILL.md Schema Migration section pointing to the dual-read removal task (Phase 4 / PR3): `<!-- TODO(PR3): Remove dual-read and _migrated_from bump path once /workflows:brainstorm validates that gitignored-artifact dual-read is YAGNI. See docs/solutions/code-quality/dual-read-migration-window-gitignored-artifacts.md -->`. Mirror the TODO at audit-synthesizer.md Step 1.
- [ ] 2.10 (P3 #44) Add a one-line rationale to audit-synthesizer.md Step 4 rule 4 explaining the +0.05 magnitude (single-standard-deviation-equivalent noise margin; revisit when pipeline has labelled data).
- [ ] 2.11 (P3 #41) `SKILL.md:55-56`: append back-reference to the schema_version constraint for the transition window definition (`(transition window definition: see 'Schema Migration' below)`).

#### Cross-scanner uniformity

- [ ] 2.12 (P2 #15) Either remove the supplemental credential-value-exclusion paragraph at `security-debt-scanner.md:57-59` (rely on `## Security and Fencing Rules` boilerplate) OR add a note to SKILL.md "Scanner Agent Structure Template" acknowledging that `security-debt-scanner` intentionally extends the Security section. Recommendation: keep the paragraph, document the intent in SKILL.md.
- [ ] 2.13 (P3 #38) `complexity-scanner.md:60`: remove the lone `IMPORTANT: Always invoke the debt-conventions skill...` line that no other scanner has. The `## Security and Fencing Rules` section already says "Follow all security and fencing rules from the `debt-conventions` skill."
- [ ] 2.14 (P3 #37) `security-debt-scanner.md:88-90`: align the null-emit sentence with the other 4 scanners — remove the extra `rather than fabricating speculation` clause (already implied by the broader anti-fabrication framing).
- [ ] 2.15 (P3 #34) `ai-pattern-scanner.md:46`: add the `failure_scenario` framing bullet to the `debt-conventions` skill reference list to match the other 4 scanners.

#### Multi-file v1.0 fan-out cosmetics

- [ ] 2.16 (P2 #16) Update audit-synthesizer.md Step 1 v1.0 fan-out clause to add a `group_id` (or `source_finding_hash`) field on emitted records when N>1, so the audit report can cross-link split findings. Document in the SKILL.md migration table.

#### Changeset metadata

- [ ] 2.17 (P2 #9) `.changeset/yellow-debt-v2-confidence-calibration.md:2`: change `"yellow-debt": minor` to `"yellow-debt": major` to match the body's "breaking change to the on-disk JSON contract" declaration. Confirm yellow-debt's current pre-1.0 version policy first — if pre-1.0 the convention may differ.

### Phase 3: PR2 — Bash hardening in audit-synthesizer.md Step 7

Branch on top of PR1 (or independently from `main` if PR1 not yet merged — these don't conflict). Type: `fix`. Changeset: `patch`.

- [ ] 3.1 (P2 #19) `audit-synthesizer.md:204` Step 7 slug-derivation: add jq exit-code guard. Pattern from MEMORY.md "GitHub GraphQL Shell Patterns": `finding=$(printf '%s' "$record" | jq -r '.finding') || { printf '[synthesizer] ERROR: jq failed to parse record; skipping slug derivation\n' >&2; continue; }`
- [ ] 3.2 (P2 #19, sub) Either derive `$id`, `$severity`, and `$content_hash` in the same Bash block via consolidated jq `@sh` parsing, or replace the variable references with explicit prose: "the orchestrator must substitute the actual values inline." Recommend: consolidated `eval "$(printf '%s' "$record" | jq -r '"id=\(.id|@sh) severity=\(.severity|@sh) content_hash=\(.content_hash|@sh) finding=\(.finding|@sh)"')"` per the MEMORY.md jq @sh consolidation pattern. Note: each value must be escaped individually with `|@sh` inside the interpolation — applying `@sh` to the entire string produces a single quoted token that `eval` treats as a command name, not assignments.
- [ ] 3.3 (P3 #45, pre-existing) Replace `sha256sum` with portable form: `printf '%s' "$finding" | (command -v sha256sum >/dev/null 2>&1 && sha256sum || shasum -a 256) | cut -d' ' -f1 | cut -c1-16`. Note in commit message that this is pre-existing; the PR is fixing on touch.
- [ ] 3.4 Re-run `pnpm validate:plugins` and `pnpm validate:schemas` to confirm no regressions.

### Phase 4: PR3 (OPTIONAL, GATED) — Dual-read removal

**Do NOT implement without first running `/workflows:brainstorm` to validate the design call.**

- [ ] 4.1 Run `/workflows:brainstorm` with topic "Should yellow-debt remove the v1.0 dual-read code path now that all scanners on `main` emit v2.0 and `.debt/scanner-output/` is gitignored?" The brainstorm should:
  - Reference `docs/solutions/code-quality/dual-read-migration-window-gitignored-artifacts.md` (this session's compound output).
  - Surface the PR author's defense-in-depth reasoning vs the YAGNI critique.
  - Decide: (a) remove now; (b) keep with explicit removal-trigger TODO and tracker issue; (c) keep permanently as defense-in-depth — and document the decision in the new docs/solutions entry as a "decision: <chosen>" footer.
- [ ] 4.2 If brainstorm decides "remove":
  - Remove Step 1 v1.0 branch (~14 lines from audit-synthesizer.md).
  - Remove Step 4 rule 4 `_migrated_from` arm (keep the v2.0 `failure_scenario == null` arm — that's permanent calibration).
  - Remove SKILL.md "Schema Migration" section.
  - Remove `_migrated_from` documentation added in Phase 2.
  - Type: `refactor`. Changeset: `patch`. Bumps yellow-debt minor or major depending on whether v1.0 artifacts in the wild are a real concern.
- [ ] 4.3 If brainstorm decides "keep with TODO": no code changes; close PR3 task as a documentation-only outcome (the TODO was already added in Phase 2 task 2.9).
- [ ] 4.4 If brainstorm decides "keep permanently": revise SKILL.md Schema Migration section to reframe as "Permanent v1.0 Compatibility Path" and remove the closure-criterion language entirely.

### Phase 5: Quality gates (every PR)

- [ ] 5.1 Each PR runs `pnpm validate:schemas && pnpm validate:plugins` before submit.
- [ ] 5.2 Each PR's commit message follows conventional-commit format (`chore:`/`fix:`/`refactor:`/`docs:`).
- [ ] 5.3 Each PR includes a changeset entry (or `docs:` skip if marketplace plugins untouched).
- [ ] 5.4 PR1 and PR2 must pass `/yellow-review:review:review-pr <PR#>` with zero P0/P1 findings before merge.

## Technical Specifications

### Files to Modify

| File | PR | Change |
|---|---|---|
| `plugins/yellow-debt/README.md` | PR1 | HASH suffix; agents/ path prefix; expand cross-ref note |
| `plugins/yellow-debt/skills/debt-conventions/SKILL.md` | PR1 | Failure-scenario framing subsection; +0.05 bump in threshold table; stats subsection; suppressed[] schema; Diffray caveat; transition-window TODO; back-references |
| `plugins/yellow-debt/agents/synthesis/audit-synthesizer.md` | PR1 | Reciprocal `_migrated_from` comment; group_id fan-out; +0.05 magnitude rationale; transition-window TODO mirror |
| `plugins/yellow-debt/agents/synthesis/audit-synthesizer.md` | PR2 | jq exit-code guard; consolidated `@sh` parsing for $id/$severity/$content_hash; portable sha256 |
| `plugins/yellow-debt/agents/scanners/{ai-pattern,architecture,complexity,duplication,security-debt}-scanner.md` | PR1 | Replace null-emit boilerplate with cross-ref; ai-pattern adds skill-ref bullet; complexity removes IMPORTANT line; security-debt aligns null-emit phrase |
| `.changeset/yellow-debt-v2-confidence-calibration.md` | PR1 (or PR #316 if not yet merged) | minor → major |

### Files to Create

| File | PR | Purpose |
|---|---|---|
| `.changeset/<slug>.md` | PR1 | Patch bump or doc-skip |
| `.changeset/<slug>.md` | PR2 | Patch bump |

### Files to Reference (cross-link, no changes)

- `docs/solutions/code-quality/multi-doc-schema-rename-drift.md` (cited by PR1 review)
- `docs/solutions/code-quality/dual-read-migration-window-gitignored-artifacts.md` (cited by PR3 brainstorm)
- `docs/solutions/code-quality/claude-code-command-authoring-anti-patterns.md` Update — 2026-05-01 (cited by PR2 review)

### Dependencies

None. All changes are prose + bash hardening within existing plugin files.

### API Changes

None. PR1 is purely documentation. PR2 is internal bash robustness. PR3 (if it lands) is a breaking removal of the v1.0 read path; depending on brainstorm outcome it may bump yellow-debt to a new major.

## Acceptance Criteria

### PR0 (compound docs)

- [ ] Two new files exist at `docs/solutions/code-quality/{multi-doc-schema-rename-drift,dual-read-migration-window-gitignored-artifacts}.md` with `track: knowledge` frontmatter.
- [ ] `claude-code-command-authoring-anti-patterns.md` has a new `## Update — 2026-05-01` section covering null-check ordering.
- [ ] `MEMORY.md` has a new cluster heading "Schema Migration & Cross-Doc Consistency Patterns (from PR #316)" with 3 pointer lines, each ≤150 chars.

### PR1 (cross-doc cleanup)

- [ ] Grep across `plugins/yellow-debt/` for `## Suggested Remediation` returns zero hits in non-archived files.
- [ ] Grep across `plugins/yellow-debt/` for `audit-synthesizer.md` (bare filename) outside the relative-path form returns zero hits.
- [ ] SKILL.md confidence-rubric threshold table contains a row or footnote documenting the +0.05 missing-failure-scenario bump.
- [ ] SKILL.md has a "Synthesizer Report Stats Schema" subsection documenting the 3 stats keys and the `suppressed[]` array shape.
- [ ] All 5 scanner agents have an identical-modulo-category-example null-emit line (no extra clauses, no missing ones).
- [ ] `pnpm validate:schemas && pnpm validate:plugins` pass.

### PR2 (bash hardening)

- [ ] `audit-synthesizer.md` Step 7 bash block: jq call has `||` exit-code guard; `$id`/`$severity`/`$content_hash` derived in the same block (or prose substitution noted).
- [ ] `sha256sum` replaced with portable form supporting macOS.
- [ ] `pnpm validate:schemas && pnpm validate:plugins` pass.

### PR3 (gated)

- [ ] `/workflows:brainstorm` produces a `docs/brainstorms/<date>-yellow-debt-dual-read-removal-brainstorm.md` artifact with an explicit decision footer.
- [ ] If "remove": all `_migrated_from` references gone; Step 1 v1.0 branch gone; Step 4 simplified to 4 rules.
- [ ] If "keep+TODO": Phase 2 TODO is the only artifact; no code change.
- [ ] If "keep permanently": SKILL.md Schema Migration section reframed; transition-window language removed.

## Edge Cases & Error Handling

- **PR0 conflicts with concurrent merges to MEMORY.md:** MEMORY.md is high-traffic. Rebase and re-resolve if conflicts; the new cluster heading is independent of other clusters so conflicts should be trivial.
- **PR1 task 2.16 (group_id fan-out)** introduces a new field on the in-memory record. Verify it doesn't collide with any v2.0 reserved field name. Add to SKILL.md schema example.
- **PR2 task 3.2 consolidated jq @sh:** verify the variant of yq/jq installed on CI runners and dev machines. Per MEMORY.md, the `kislyuk/yq` vs `mikefarah/yq` variant check applies to yq; for jq the tool is uniform but `@sh` filter requires jq 1.6+. Run `jq --version` on the CI runner.
- **PR2 task 3.3 portable sha256:** `command -v sha256sum` must be evaluated in a subshell that doesn't pollute the outer shell. The pipeline form `(command -v ... && sha256sum || shasum -a 256)` works in bash and zsh. Verify on macOS with no GNU coreutils installed.
- **PR3 brainstorm reaches "remove":** the v1.0 path's commit history must be preserved as a `git log` reference for any project that re-introduces the dual-read pattern. Don't squash PR3 into PR2.

## Cross-References

- **Parent PR:** [#316](https://app.graphite.com/github/pr/KingInYellows/yellow-plugins/316)
- **Source plans:** `plans/everyinc-merge.md` (Wave 3 / W3.13b), `plans/everyinc-merge-wave3.md` item #7
- **Session review docs (untracked, on `main` worktree):**
  - `docs/reviews/2026-05-01-everyinc-merge-session-review.md`
  - `docs/reviews/2026-05-01-everyinc-merge-wave3-session-review.md`
- **Compound output (untracked, on `main` worktree):**
  - `docs/solutions/code-quality/multi-doc-schema-rename-drift.md`
  - `docs/solutions/code-quality/dual-read-migration-window-gitignored-artifacts.md`
  - `docs/solutions/code-quality/claude-code-command-authoring-anti-patterns.md` (Update — 2026-05-01)
- **Project memory:** `MEMORY.md` cluster "Schema Migration & Cross-Doc Consistency Patterns (from PR #316)"
- **Similar precedent:** PR #275 `chore: strip Bash from 13 reviewer agents` (same scope: prose changes across multiple agents/skills, no runtime behavior change)

## Stack Decomposition

<!-- stack-topology: linear -->
<!-- stack-trunk: main -->

The work is structured as **3 PRs** (PR0 prerequisite + PR1 + PR2) with PR3 as an optional gated follow-up. PR0 must merge before PR1 starts so cross-references resolve. PR1 and PR2 form a linear stack — PR2 builds on PR1's prose changes (the bash block in PR2 lives in a file PR1 will have edited).

### 1. docs/pr-316-review-learnings (PR0)

- **Type:** docs
- **Description:** Land the 3 compound knowledge docs + MEMORY.md cluster from this session's compound work.
- **Scope:** docs/solutions/code-quality/multi-doc-schema-rename-drift.md (NEW), docs/solutions/code-quality/dual-read-migration-window-gitignored-artifacts.md (NEW), docs/solutions/code-quality/claude-code-command-authoring-anti-patterns.md (MODIFIED), MEMORY.md (MODIFIED)
- **Tasks:** 1.1–1.5
- **Depends on:** (none)
- **Notes:** No changeset (docs-only).

### 2. chore/pr-316-cross-doc-cleanup (PR1)

- **Type:** chore
- **Description:** Cross-doc consistency cleanup, DRY of failure_scenario boilerplate, documentation gaps in SKILL.md, changeset metadata fix.
- **Scope:** plugins/yellow-debt/README.md, plugins/yellow-debt/skills/debt-conventions/SKILL.md, plugins/yellow-debt/agents/synthesis/audit-synthesizer.md (prose only), plugins/yellow-debt/agents/scanners/{ai-pattern,architecture,complexity,duplication,security-debt}-scanner.md, .changeset/yellow-debt-v2-confidence-calibration.md
- **Tasks:** 2.1–2.17
- **Depends on:** PR0 (cross-references), PR #316 (parent)
- **Notes:** Patch changeset for yellow-debt OR none if entirely doc-string-only.

### 3. fix/pr-316-bash-hardening (PR2)

- **Type:** fix
- **Description:** jq exit-code guard, consolidated `@sh` parsing for slug-derivation variables, portable sha256 fallback.
- **Scope:** plugins/yellow-debt/agents/synthesis/audit-synthesizer.md (Step 7 bash block only)
- **Tasks:** 3.1–3.4
- **Depends on:** PR1
- **Notes:** Patch changeset for yellow-debt.

### 4. (OPTIONAL, GATED) refactor/pr-316-dual-read-removal (PR3)

- **Type:** refactor
- **Description:** Remove v1.0 dual-read path if `/workflows:brainstorm` validates the YAGNI critique.
- **Scope:** plugins/yellow-debt/agents/synthesis/audit-synthesizer.md (Step 1 + Step 4), plugins/yellow-debt/skills/debt-conventions/SKILL.md (Schema Migration section)
- **Tasks:** 4.1–4.4
- **Depends on:** PR1 (the transition-window TODO is added there), PR2 (the bash block is hardened there first), `/workflows:brainstorm` outcome
- **Notes:** Bumps yellow-debt minor or major depending on brainstorm outcome and v1.0-in-the-wild assessment.

## Stack Progress

<!-- Updated by workflows:work. Do not edit manually. -->

- [x] 1. docs/pr-316-review-learnings (PR0) — completed 2026-05-01 via PR #318 (`268a12a` on `agent/docs/pr-316-review-learnings`)
- [x] 2. chore/pr-316-cross-doc-cleanup (PR1) — completed 2026-05-01 via PR #319 (`29db942` on `agent/chore/pr-316-cross-doc-cleanup`); 16 of 17 tasks done (skipped 2.15 — false-premise finding)
- [x] 3. fix/pr-316-bash-hardening (PR2) — completed 2026-05-01 via PR #320 (`b40371e` on `agent/fix/pr-316-bash-hardening`)
- [ ] 4. (gated) refactor/pr-316-dual-read-removal (PR3) — deferred; requires `/workflows:brainstorm` per plan Phase 4
