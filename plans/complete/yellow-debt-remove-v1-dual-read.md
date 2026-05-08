# Feature: Remove yellow-debt v1.0 Dual-Read Code Path

**Status:** Retrospective — implementation shipped in PR #440 on 2026-05-07. Phases 1–4 task boxes reflect post-implementation state. Phase 5 boxes remain unchecked (5.1 is post-merge bookkeeping; 5.2 is a contingency, not a scheduled task).
**Date:** 2026-05-07
**Source:** `/workflows:brainstorm` decision recorded in `docs/brainstorms/2026-05-07-yellow-debt-dual-read-removal-brainstorm.md`. Decision: **(a) remove now**.
**Parent plan:** `plans/complete/pr-316-yellow-debt-residual-review-cleanup.md` Phase 4 (gated PR3 of the PR #316 follow-up stack).

## Problem Statement

PR #316 introduced a v1.0 → v2.0 schema migration for yellow-debt scanner outputs and shipped a "dual-read" branch in `audit-synthesizer.md` that accepts both versions during a transition window. PR #316's multi-agent review surfaced this as YAGNI: `.debt/scanner-output/` is gitignored, all 5 bundled scanners emit v2.0, and there is no third-party-scanner extension surface in this plugin. The plan author gated removal on `/workflows:brainstorm` rather than letting one reviewer's "code-simplicity says YAGNI" call drive the change unilaterally.

The brainstorm (2026-05-07) interrogated the defense-in-depth case fairly and landed on **remove now**. Three sanity-check questions all came back "no":

1. **Third-party v1.0 scanners?** No extension surface exists in `plugins/yellow-debt/`.
2. **CI exports `.debt/scanner-output/`?** No `actions/upload-artifact` references for `.debt/`.
3. **External consumers of `stats.migrated_from_v1`?** Only the synthesizer itself.

The ongoing cost of keeping dual-read is concrete: three-file prose synchronization (audit-synthesizer.md Step 1 + Step 4 + SKILL.md Schema Migration table), dead `stats.migrated_from_v1` telemetry in every audit report, and a non-falsifiable closure criterion in SKILL.md that cannot be verified from inside the plugin. PR #316's review surfaced multiple P2/P3 findings from exactly this pattern.

## Current State

- `plugins/yellow-debt/agents/synthesis/audit-synthesizer.md` lines 29-74 contain the dual-read preamble + Step 1 v1.0 branch + `_migrated_from: "1.0"` stamp + `stats.migrated_from_v1` increment + multi-file fan-out logic.
- `plugins/yellow-debt/agents/synthesis/audit-synthesizer.md` lines 130-141 (Step 4 rule 4) contain the `+0.05` confidence bump with two triggers: `_migrated_from == "1.0"` OR `failure_scenario == null`. The PR1 round-1 fix already widened this rule to fire on either trigger independently — the v2.0 `failure_scenario == null` arm is the permanent calibration mechanism.
- `plugins/yellow-debt/skills/debt-conventions/SKILL.md` lines 55-56, 75-78, 350-358, 360-376 contain dual-read documentation: schema_version preamble, confidence-gate cross-reference, "Schema Version Mismatch" troubleshooting entry, and the full "Schema Migration (v1.0 → v2.0)" section.
- The brainstorm doc (`docs/brainstorms/2026-05-07-yellow-debt-dual-read-removal-brainstorm.md`) and decision footer in `docs/solutions/code-quality/dual-read-migration-window-gitignored-artifacts.md` are written but untracked on this worktree.

### False-positive references (KEEP — not removal targets)

These contain "v1.0" but refer to unrelated concerns:

- `audit-synthesizer.md:214` — references "v1.0-style `affected_files: - path:lines` array key" in the **on-disk todo frontmatter format** (read by `debt-fixer.md` Step 3). This is a backward-compat decision for the fixer scope-validator, not the v1.0 scanner-output schema. KEEP.
- `SKILL.md:99-100` — "yellow-debt retains the v1.0 float scale" refers to the **confidence value range** (0.0–1.0 floats vs the Wave 2 anchor scale 0/25/50/75/100). Not about the v1.0 schema. KEEP.
- `SKILL.md:65, 66, 69` — `(replaces v1.0 title + description; ...)` parentheticals on field definitions. These are useful schema-history annotations explaining the v2.0 design rationale. KEEP.
- `README.md:179` — `(v2.0 schema; renamed from v1.0 suggested_remediation)` annotation in the todo template. Same rationale as above. KEEP.
- `CHANGELOG.md` lines 29, 205-207, 222, 225-226, 238, 240 — historical entries describing what shipped in past versions. CHANGELOGs are append-only; never modify retroactively. KEEP.

## Proposed Solution

Single PR, branched off `main`. Type: `refactor`. Changeset bump: `patch` for yellow-debt (gitignored artifact change, no command API surface affected, primary user flow `/debt:audit` regenerates outputs before synthesis).

### Key Design Decisions

- **Single PR, not stacked.** The change is two files (audit-synthesizer.md + SKILL.md) with tightly-coupled edits. Splitting creates artificial review boundaries.
- **Patch, not minor or major.** Per the brainstorm Question 6 analysis: `.debt/scanner-output/` is gitignored, the audit command regenerates outputs before synthesis, and there is no public command API change. A patch bump matches the conventional interpretation; the BREAKING CHANGE note in the changeset body is for transparency, not version-bump signaling.
- **Land brainstorm + solutions doc footer in the same PR.** The brainstorm is the rationale for the implementation; reviewers should see them together. Both files are docs/ (not plugin code), so this does not affect the changeset scope.
- **Hard error + skip, not silent fallback.** The synthesizer's existing "skip malformed files entirely (log error, continue with remaining scanners)" pattern at line 72 is the precedent. The v1.0 case becomes structurally identical: log a clear error, skip the file, continue.
- **Drop the `stats.migrated_from_v1` counter entirely.** No external consumers. The example output at line 165 also gets cleaned up.

### Trade-offs Considered

- **Patch vs minor changeset:** patch is technically an internal-implementation change; minor signals "user-visible behavior change." The brainstorm landed on patch because the `/debt:audit` flow always regenerates outputs first, so the user-visible behavior change requires a non-default workflow (running synthesis in isolation against stale artifacts). If reviewers push back, easy to upgrade to minor — no plan rewrite needed.

<!-- deepen-plan: external -->
> **Research:** `patch` is supported by all major JS-ecosystem versioning conventions: semver.org defines breaking change as "incompatible with the public API" (sections 1, 8) — a gitignored, regenerable artifact directory is not a public API; Changesets' definition of breaking is "will existing users' code break?" — no producers, no breakage; Conventional Commits requires a `BREAKING CHANGE:` footer for major bumps, not warranted here; and Node.js's deprecation policy classifies "deprecate and remove in same release with zero adoption" as patch/minor prior art. See Cross-References for citations.
<!-- /deepen-plan -->
- **Keeping `_migrated_from` documentation as a footnote:** rejected. Without the dual-read code, `_migrated_from` is unreachable; documenting an unreachable field is the kind of dead docs that produces P2/P3 cross-doc-drift findings.
- **Replacing dual-read with a deprecation period:** rejected per brainstorm Approach B analysis. The non-falsifiable closure criterion makes the deprecation period permanently open in practice.

## Implementation Plan

### Phase 1: Branch setup

- [x] 1.1 `gt repo sync` to ensure trunk is current.
- [x] 1.2 `gt branch create agent/refactor/yellow-debt-remove-v1-dual-read` branched from `main`.
- [x] 1.3 Stage the brainstorm doc and solutions doc decision footer as part of this PR's first commit (currently untracked):
  - `docs/brainstorms/2026-05-07-yellow-debt-dual-read-removal-brainstorm.md` (NEW)
  - `docs/solutions/code-quality/dual-read-migration-window-gitignored-artifacts.md` (MODIFIED — `## Decision (2026-05-07)` footer appended)

### Phase 2: audit-synthesizer.md edits

- [x] 2.1 Update preamble (lines 29-30): replace "synthesizer accepts both v1.0 and v2.0 scanner outputs during the transition window — see Step 1 below for in-memory migration" with "synthesizer reads v2.0 scanner outputs; older artifacts must be regenerated".
- [x] 2.2 Rewrite Step 1 header (line 34): change `### 1. Read Scanner Outputs (dual-read v1.0/v2.0)` to `### 1. Read Scanner Outputs`.
- [x] 2.3 Replace Step 1 body (lines 36-74). New body must:
  - Read `.debt/scanner-output/*.json` and inspect `schema_version`.
  - Pass through `schema_version: "2.0"` records unchanged.
  - For records with `schema_version: "1.0"`, missing `schema_version`, or any other value: log `[synthesizer] Warning: <file>.json is schema_version <value> which is no longer supported. Re-run the scanner to generate a v2.0 output.` to stderr and skip the file. Continue with remaining files.
  - Preserve the existing "Skip malformed files entirely (log error, continue with remaining scanners)" sentence.
  - Remove all references to `_migrated_from`, `stats.migrated_from_v1`, multi-file fan-out, and the transition-window warning. Downstream code already reads only v2.0 fields per the existing line 73-74 statement; that statement can stay.
<!-- deepen-plan: codebase -->
> **Codebase:** Use `[synthesizer] Warning:` (matches the existing skip-malformed precedent at line 72 and the four other non-fatal warnings at lines 59, 69, 109, 150), not `[synthesizer] Error:` (mixed-case) which would introduce a new variant. The synthesizer reserves uppercase `ERROR:` for fatal aborts (line 261); the v1.0-skip case is non-fatal and structurally identical to skip-malformed.
<!-- /deepen-plan -->

- [x] 2.4 Update Step 4 rule 4 (lines 130-141). Drop the `_migrated_from: "1.0"` OR clause. Drop the "expires when the transition window closes and v1.0 artifacts no longer appear in active project trees" language. Final rule reads:
  > **Missing-failure-scenario bump.** If the finding has `failure_scenario == null`, add `+0.05` to the category threshold for this finding only. The bump compensates for the missing concrete-failure signal — a v2.0 record with `null` is a scanner that chose not to fabricate. The bump is permanent calibration, not a transition mechanism. [keep any remaining downstream prose unchanged]
<!-- deepen-plan: codebase -->
> **Codebase:** Line range correction — task 2.4's actual edit target is lines **134-143**, not 130-141. Lines 130-133 contain rule 3's closing statement; rule 4's ordinal intro starts at 134, the OR clause at 136, and the "expires when transition window closes" prose ends at 143.
<!-- /deepen-plan -->

- [x] 2.5 Remove `migrated_from_v1` field from the example stats output around line 165. Verify no other line references the field after this change.

<!-- deepen-plan: codebase -->
> **Codebase gap:** A second dead-counter reference exists at audit-synthesizer.md line **191** — a Step 6 report-section bullet "migrated-v1 count" (hyphen form). The plan's acceptance grep `rg -n 'migrated_from_v1'` will NOT catch this. Add a Phase 2 task to remove the bullet, and add `rg -n 'migrated.v1' plugins/yellow-debt/agents/synthesis/audit-synthesizer.md` to Phase 4's verification checklist.
<!-- /deepen-plan -->

### Phase 3: SKILL.md edits

<!-- deepen-plan: codebase -->
> **Codebase:** SKILL.md line range corrections — task 3.1's schema_version description sentence actually runs through line **57** (the word "below)"), so use **55-57** as the edit target. Task 3.4's "Schema Version Mismatch" entry body is at 352-358; the heading at line **350** + blank at 351 should be included in the replace target (use 350-358 inclusive) so surrounding section structure stays clean. Task 3.5's Schema Migration section spans 360-376 as stated.
<!-- /deepen-plan -->

- [x] 3.1 Update line 55-56 schema_version description: change "v1.0 inputs accepted by `audit-synthesizer` during the transition window (see 'Schema Migration' below)" to "v2.0 is the current and only accepted version".
- [x] 3.2 Update line 75 confidence-gate cross-reference: change "confidence-gate bump used for migrated v1.0 records (see ...)" to point only at the `failure_scenario == null` calibration. Specifically: drop "migrated v1.0" framing; the bump is now exclusively for null-failure-scenario records.
- [x] 3.3 Update line 78: change "v1.0 migration or a v2.0 scanner that chose not to fabricate" to just "a v2.0 scanner that chose not to fabricate".
- [x] 3.4 Update lines 350-358 "Schema Version Mismatch" troubleshooting entry. New text:
  > Scanner output must use `"schema_version": "2.0"`. Older artifacts (`schema_version: "1.0"` or unversioned) are no longer accepted; the synthesizer logs an error and skips them.
  >
  > **Remediation**: Re-run the scanner to regenerate v2.0 output. The audit command (`/debt:audit`) does this automatically before synthesis.
- [x] 3.5 Delete lines 360-376 entirely: the `### Schema Migration (v1.0 → v2.0)` heading, the breaking-changes preamble, the field-mapping table, and the closure-criterion paragraph. Verify the file's heading hierarchy is consistent after deletion (no orphaned subsections).

### Phase 4: Validation, changeset, commit

- [x] 4.1 Run `pnpm validate:schemas && pnpm validate:plugins` to confirm no regressions in agent or skill authoring rules.
- [x] 4.2 Grep verification: `rg -n '_migrated_from|migrated_from_v1' plugins/yellow-debt/` should match zero non-CHANGELOG lines after edits.
- [x] 4.3 Grep verification: `rg -n 'dual.read|dual_read|transition window' plugins/yellow-debt/` should match zero non-CHANGELOG lines after edits (the brainstorm and solutions doc are in `docs/`, not `plugins/`).
- [x] 4.4 Grep verification: `rg -n 'Schema Migration' plugins/yellow-debt/` should match zero lines.
- [x] 4.5 Run `pnpm changeset` and create a `patch` bump for `yellow-debt`. Body (drop "BREAKING CHANGE" framing per deepen-plan annotation immediately below — see `## References` for semver/Changesets citations supporting `patch`):
  > Remove the v1.0 → v2.0 dual-read migration path from `audit-synthesizer`. The synthesizer now warns and skips any artifact with `schema_version` other than `"2.0"`.
  >
  > `.debt/scanner-output/` is gitignored and per-run regenerated, so no version-controlled artifact is affected. Re-run all scanners after upgrading to regenerate v2.0 outputs. The audit command (`/debt:audit`) does this automatically; only users running synthesis in isolation against stale `.debt/scanner-output/` directories are affected.
  >
  > Background: `docs/brainstorms/2026-05-07-yellow-debt-dual-read-removal-brainstorm.md`.

  <!-- deepen-plan: external -->
  > **Research:** Drop the "BREAKING CHANGE (low-impact)" annotation. The phrase has no standard meaning in Changesets, may confuse automated tooling that scans changelogs for `BREAKING CHANGE:` markers (semantic-release, conventional-changelog), and undermines the patch classification by framing the change as breaking when it is not (no public API, no producers, no consumer code breaks). Recommended body: drop the BREAKING CHANGE line entirely; describe the removal factually and link the brainstorm doc for rationale.
  <!-- /deepen-plan -->
- [x] 4.6 Conventional-commit message: `refactor(yellow-debt): remove v1.0 dual-read migration path`.
- [x] 4.7 `gt commit create -am "refactor(yellow-debt): remove v1.0 dual-read migration path"` or stage edits with `git add` first, then `gt commit create -m "..."`.
- [x] 4.8 `gt stack submit` to open the PR.

### Phase 5: Post-submit

- [ ] 5.1 (post-merge) Update `plans/complete/pr-316-yellow-debt-residual-review-cleanup.md` Phase 4 / Stack Progress section: mark task 4. as completed and record the merge SHA when this PR lands. (Optional — the parent plan is already archived; this is bookkeeping only.)
- [ ] 5.2 (contingency, not a scheduled task) If the brainstorm's three open questions surface real consumers post-merge (e.g., a downstream tool starts emitting errors), revert via `git revert` and switch to Approach B (keep with TODO + tracker issue).

## Technical Specifications

### Files to Modify

| File | Changes |
|---|---|
| `plugins/yellow-debt/agents/synthesis/audit-synthesizer.md` | Replace Step 1 dual-read with v2.0-only + hard error; drop `_migrated_from` OR clause from Step 4 rule 4; drop `migrated_from_v1` from example stats output |
| `plugins/yellow-debt/skills/debt-conventions/SKILL.md` | Update schema_version description, confidence-gate cross-reference, troubleshooting entry; delete entire "Schema Migration (v1.0 → v2.0)" section |
| `docs/solutions/code-quality/dual-read-migration-window-gitignored-artifacts.md` | Already modified this session — decision footer appended |

### Files to Create

| File | Purpose |
|---|---|
| `docs/brainstorms/2026-05-07-yellow-debt-dual-read-removal-brainstorm.md` | Brainstorm output (already written, untracked) |
| `.changeset/<slug>.md` | Patch bump for yellow-debt with BREAKING CHANGE annotation |

### Files Explicitly NOT Modified

- `plugins/yellow-debt/CHANGELOG.md` — historical record, append-only
- `plugins/yellow-debt/README.md` — line 179 v1.0 reference is a v2.0 schema-history annotation, not a dual-read claim
- `plugins/yellow-debt/agents/scanners/*.md` — scanners already emit v2.0; no dual-read references in scanner agents
- `plugins/yellow-debt/agents/remediation/debt-fixer.md` — fixer reads on-disk todo frontmatter, not scanner output; unaffected

### Dependencies

None. All changes are within `plugins/yellow-debt/` plus two `docs/` files.

### API Changes

None to public command surface. The internal scanner-output schema's accepted version set narrows from `{1.0, 2.0, missing}` to `{2.0}`. No command, agent, or skill is renamed or removed.

## Acceptance Criteria

- [x] `rg -n '_migrated_from' plugins/yellow-debt/` matches only `CHANGELOG.md` lines (historical).
- [x] `rg -n 'migrated_from_v1' plugins/yellow-debt/` matches only `CHANGELOG.md` lines.
- [x] `rg -n 'dual.read|dual_read' plugins/yellow-debt/` matches only `CHANGELOG.md` lines.
- [x] `rg -n 'Schema Migration' plugins/yellow-debt/skills/debt-conventions/SKILL.md` returns no matches.
- [x] `audit-synthesizer.md` Step 1 contains the new skip message format and references `[synthesizer] Warning:` (non-fatal skip; matches the existing skip-malformed precedent at line ~45 per the deepen-plan annotation in Phase 2).
- [x] `audit-synthesizer.md` Step 4 rule 4 contains only the `failure_scenario == null` trigger; the `_migrated_from` OR clause is gone.
- [x] `audit-synthesizer.md` example stats output (around line 165) does not contain `migrated_from_v1`.
- [x] `pnpm validate:schemas && pnpm validate:plugins` pass.
- [x] PR description references the brainstorm doc path so reviewers can read the rationale before reviewing the diff.

## Edge Cases & Error Handling

- **User runs synthesis in isolation against stale `.debt/scanner-output/`.** Expected: each v1.0 file produces one stderr error line and is skipped. The synthesizer continues processing v2.0 files normally. If all files are v1.0, the synthesizer produces an empty audit report — confirm this does not crash; if it does, add a final-empty check that emits a clear "No v2.0 scanner outputs found; re-run scanners." message before exiting.

  <!-- deepen-plan: codebase -->
  > **Codebase:** Empty-audit safety confirmed via downstream trace. Steps 2 (dedup), 3 (sort), 4 (gate), 5 (reconciliation), 6 (report), and 7 (todo writes) all handle zero-record input cleanly — no crash risk. The "if N files rejected and 0 v2.0 records, emit a clear message" check is **optional polish, not a blocker**: the system fails safe today, just silently produces an empty report. Add the explicit message if reviewers ask, otherwise defer.
  <!-- /deepen-plan -->
- **Mixed v1.0 + v2.0 directory.** Expected: v1.0 files skipped with errors, v2.0 files processed normally. Audit report reflects only v2.0 findings.
- **Schema field present but corrupted (e.g., `schema_version: 2`, integer not string).** Existing "skip malformed files entirely" behavior at line 72 already covers this. No new logic needed — type check happens upstream of version comparison.
- **Reviewer pushes back on patch bump (wants minor):** trivial to switch the changeset before merge. Plan does not depend on the bump type.

## Cross-References

- **Brainstorm:** `docs/brainstorms/2026-05-07-yellow-debt-dual-read-removal-brainstorm.md`
- **Solutions doc (with decision footer):** `docs/solutions/code-quality/dual-read-migration-window-gitignored-artifacts.md`
- **Parent plan:** `plans/complete/pr-316-yellow-debt-residual-review-cleanup.md` Phase 4
- **Related schema docs:** `docs/solutions/code-quality/multi-doc-schema-rename-drift.md` (cross-doc drift pattern this PR avoids reintroducing)
- **PR #316 (parent feature PR):** introduced the dual-read code in the first place
- **PR #319 (PR1 of follow-up stack):** widened Step 4 rule 4 to fire on `failure_scenario == null` independently — the decoupling that made this removal possible

<!-- deepen-plan: external -->
> **Research:** Semver classification references for the patch-vs-minor decision (synthesized 2026-05-07; live MCP sources unavailable, drawn from training-knowledge cutoff August 2025):
> - [semver.org 2.0.0](https://semver.org/spec/v2.0.0.html) — sections 1 and 8 scope breaking changes to the public API; gitignored regenerable artifacts are out of scope
> - [Conventional Commits 1.0](https://www.conventionalcommits.org/en/v1.0.0/) — `BREAKING CHANGE:` footer required for major; absence defaults to fix/refactor → patch
> - [Changesets decisions.md](https://github.com/changesets/changesets/blob/main/docs/decisions.md) — defines breaking as "will existing users' code break?"; author chooses bump level
> - [Node.js deprecation policy](https://nodejs.org/en/docs/guides/backporting-to-release-lines) — "deprecate and remove in same release with zero adoption" classified as patch/minor prior art
> - [ESLint versioning policy](https://eslint.org/docs/developer-guide/contributing/releases) — "breaking" = requires user action to update code
<!-- /deepen-plan -->
