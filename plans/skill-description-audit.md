# Feature: Skill Description Audit (yellow-core focus)

## Problem Statement

Claude Code v2.1.137 reports the skill listing is truncated: 179 of ~200
descriptions are dropped at the default 1% context budget, costing ~11k tokens
to display in full. The brainstorm at
`docs/brainstorms/2026-05-09-claude-code-skill-bloat-brainstorm.md`
diagnoses the cause: `description:` frontmatter fields in this repo were
written as documentation rather than selection metadata, so they enumerate
synonymous trigger phrases, repeat body content, and inline methodology
details — content that is irrelevant at listing time.

**yellow-core is 61% of the total description budget** (5,921 chars across 17
skills, average 348/skill). The other 16 plugins average ~178 chars per skill
and are mostly already in good shape. This PR concentrates remediation on the
five verbose yellow-core skills that drive the bloat, with light spot-checks
on borderline-length skills elsewhere.

The trim is **quality-driven**, not budget-driven: the goal is to remove
genuinely non-load-bearing content (trigger phrase enumerations, body-content
repetition, methodology bleed) while preserving the WHAT + WHEN structure
that drives skill auto-invocation accuracy.

<!-- deepen-plan: external -->
> **Research:** Community-documented evidence reverses the assumed risk
> direction. GitHub issue `anthropics/claude-code#44780` and the skill-creator
> tool's own warning logic both name **~250 chars** as the practical
> auto-invocation threshold — content past that point is functionally invisible
> to Claude's selection logic. Our 5 verbose descriptions (500-690 chars) are
> already in a degradation zone where the trailing trigger-phrase lists never
> get read. Trimming to 200-250 chars moves them INTO the reliable
> auto-invocation window, not out of it. See:
> https://github.com/anthropics/claude-code/issues/44780 and
> https://github.com/backnotprop/plannotator/issues/412 (455-char description
> truncated, losing trigger phrases) and
> https://github.com/anthropics/claude-code/issues/9716 (skills unselectable
> after description growth past threshold).
<!-- /deepen-plan -->

## Linear Issues

None — this is internal repo cleanup, not tracked in Linear.

## Current State

- 37 SKILL.md files across 18 plugins (`plugins/*/skills/*/SKILL.md`)
- yellow-core: 17 skills, 5,921 chars, 5 verbose (>500 chars), 5 borderline
  (200-400 chars), 7 already tight (<200 chars)
- Other plugins: yellow-ruvector (3 skills, avg 188), yellow-mempalace (2,
  avg 230), yellow-council (1, 285), yellow-ci (2, avg 198), yellow-browser-test
  (2, avg 196). Remaining 11 plugins all under 200 char average.
- No description-specific validator rule exists. `validate-agent-authoring.js`
  does not scan SKILL.md frontmatter (only agents/commands).
- Hard cap per skill is 1,536 chars (Anthropic spec). Even our worst
  (`compound-lifecycle` at 686) is well under.
- `CONTRIBUTING.md:388` currently states: *"Authors should not artificially
  trim descriptions to fit the budget — that hurts auto-invocation accuracy."*
  This was added by PR #459 and predates this work; the trim PR's premise
  must be reconciled with that policy.

<!-- deepen-plan: codebase -->
> **Codebase:** Exact location confirmed. `## Skill Description Budget`
> section opens at `CONTRIBUTING.md:380` (not 388). The policy sentence to
> rewrite spans lines 388-393. The next section `## Questions?` begins at
> line 395 — clean boundary, nothing between the policy block and the next
> heading to preserve. Env var name on line 393 is
> `CLAUDE_SLASH_COMMAND_TOOL_CHAR_BUDGET` (with the `CLAUDE_` prefix), not
> `SLASH_COMMAND_TOOL_CHAR_BUDGET` as some external research sources state.
> The plan's Phase 1.3 should reference the prefixed name when the rewrite
> mentions the user-side workaround.
<!-- /deepen-plan -->

## Proposed Solution

Single PR scoped to yellow-core's 17 skills + targeted spot-checks on plugins
with descriptions over 200 chars. Each description is judged on its own
merits using a quality checklist (no hard char cap). The PR also updates
CONTRIBUTING.md to clarify the policy distinction between "trim for budget"
(discouraged) and "trim non-load-bearing content for selection accuracy"
(this work).

Rationale for single PR vs staged: 17 description edits is reviewable when
the diff is bounded to one frontmatter field per file. Splitting introduces
coordination overhead with no review-quality benefit. Borderline skills
outside yellow-core are inspected but only edited if they clearly have
cuttable patterns — out-of-scope skills get a one-line "inspected, no
changes" note in the PR description.

Bump type: `patch` per all touched plugins. Per CONTRIBUTING.md's own
classification, frontmatter-only edits are documentation-only changes.
The skill bodies and runtime behavior are unchanged.

<!-- deepen-plan: external -->
> **Research:** Anthropic's own reference skills (github.com/anthropics/skills)
> set the implicit target for "good description length." Sample of 5
> Anthropic-authored skills:
> - `claude-api`: ~140 chars
> - `webapp-testing`: ~210 chars
> - `docx`: ~210 chars (with explicit trigger phrases)
> - `skill-creator`: ~225 chars
> - `pptx`: ~370 chars (outlier — exhaustive enumeration of file ops)
>
> Three of five are under 225 chars; even the deliberate-overflow case stays
> under 400. Every one leads with a concrete action verb cluster
> ("Build, debug, and optimize"; "Toolkit for"; "Use this skill whenever").
> None use folded YAML scalars or multi-line forms. These set a credible
> trim target band for the 5 verbose yellow-core descriptions: aim for
> 150-300 chars depending on differentiation needs. Source:
> https://github.com/anthropics/skills
<!-- /deepen-plan -->

## Implementation Plan

### Phase 1: Setup and CONTRIBUTING.md policy update

- [ ] 1.1: Create branch `agent/chore/skill-description-audit` (off latest main)
- [ ] 1.2: Read each verbose skill's SKILL.md body to confirm what's
      "body-content repetition" before any cutting (the description should
      not paraphrase content that already appears in `## What It Does`)
- [ ] 1.3: Edit `CONTRIBUTING.md` lines ~388-393. Replace the absolutist
      "Authors should not artificially trim descriptions to fit the budget"
      with a policy that distinguishes:
      - DO NOT cut content that aids selection accuracy (the WHAT clause,
        the WHEN trigger, the differentiating clause vs adjacent skills,
        scope-narrowing clauses that prevent misfire)
      - DO cut enumerated trigger phrase lists, repetition of skill-body
        content, methodology/algorithm/scoring-rubric bleed
      - The selection-accuracy concern is the load-bearing principle;
        budget pressure is a secondary signal that may motivate a quality
        review but is not itself a justification to trim
- [ ] 1.4: Verify the `create-agent-skills` SKILL.md examples (lines ~160-170)
      still reflect the updated guidance. The current examples already match
      ("good: tight WHAT + WHEN" / "bad: missing WHEN, vague WHAT, or
      verbose without WHEN"), so this is a check, not an edit. Confirm in
      the PR description that the meta-skill was checked.

### Phase 2: yellow-core verbose tier (5 skills)

These are the highest-impact edits. Each follows the same workflow: read
current description, identify cuttable patterns, draft a trimmed version
that preserves WHAT + WHEN + differentiating clause, verify against the
adjacent-skill collision check.

- [ ] 2.1: `compound-lifecycle` (currently 686 chars)
      Cut: three operations enumerated inline, "phrases like" trigger list
      Keep: `docs/solutions/` rotting prevention (WHAT), the
      `knowledge-compounder` cross-reference (non-obvious applicability)

<!-- deepen-plan: codebase -->
> **Codebase:** Body-content repetition CONFIRMED at high density. The three
> operations ("staleness detection (composite-scored, not pure age)",
> "overlap detection (BM25 + ruvector cosine)", "consolidation hand-off
> (AskUserQuestion-gated...archives to docs/solutions/archived/)") all appear
> verbatim or near-verbatim in body Steps 1-3 and §5a/5b. The trigger phrase
> list ("refresh learnings", "audit solutions", "clean up stale docs",
> "consolidate overlapping entries") duplicates the `## When to Use` bullets
> verbatim. All four cuttable elements have direct body counterparts —
> aggressive trim is safe.
<!-- /deepen-plan -->
- [ ] 2.2: `ideation` (664 chars)
      Cut: Toulmin/MIDAS methodology names (belong in body), enumerated
      trigger phrase list
      Keep: "soft problem" framing, "/workflows:brainstorm too narrow"
      differentiator vs `brainstorming` skill (note: `brainstorming` is
      `user-invokable: false`, so collision is asymmetric — `ideation` is
      the user-facing one and bears the WHAT-clause weight)

<!-- deepen-plan: codebase -->
> **Codebase:** Body-content repetition CONFIRMED. The Toulmin/MIDAS sentence
> compresses `## What It Does` lines 36-40 ("Drives a six-phase flow built
> around the MIDAS three-phase core...The Toulmin warrant contract is the
> quality mechanism"). The vague-problem examples ("better error handling",
> "reduce flaky tests", "improve onboarding") are near-verbatim restatements
> of `## When to Use` lines 55-58 examples. The brainstorm hand-off duplicates
> Phase 5 heading. The trigger-phrase list duplicates `## When to Use` line 63.
> All cuttable elements have body counterparts — high cut depth is safe.
<!-- /deepen-plan -->
- [ ] 2.3: `optimize` (613 chars)
      Cut: judge-implementation details ("two judge runs with order-swap",
      "per-criterion scoring (1-5)"), enumerated trigger phrases
      Keep: "metric-driven optimization pass", measurable-goal framing

<!-- deepen-plan: codebase -->
> **Codebase:** Body-content repetition CONFIRMED. All three methodology
> claims appear in the Notes section at lines 434-450: "Two-run order-swap
> is the cost-effective minimum to recover most of the variance",
> "Per-criterion rubrics produce more reliable inter-rater agreement than
> holistic scoring", "The self-check is a low-cost flag...". The use-case
> list ("prompt variants, agent system prompt revisions, command flow
> changes, config tunings") restates `## When to Use` lines 50-54. The
> trigger-phrase list duplicates line 55. All cuttable content is mirrored
> in the body — high cut depth is safe.
<!-- /deepen-plan -->
- [ ] 2.4: `debugging` (518 chars)
      Cut: enumerated trigger phrase list ("debug this", "why is this
      failing", etc.), capability listing of issue tracker types
      Keep: root-cause-before-fix differentiator vs `session-history`,
      hypothesis-with-predictions detail (non-obvious applicability)

<!-- deepen-plan: codebase -->
> **Codebase:** Body-content repetition is moderate-high but NOT total. The
> opening clause and use-case list (issue tracker types, stack traces,
> failed-fix-attempts) all restate body intro lines 10-11 and `## When to
> Use` lines 35-42. HOWEVER: the closing trigger-phrase list ("debug this",
> "why is this failing", "trace this error", "fix this bug") has NO
> verbatim body counterpart — it's genuine description-only content. This
> means cut depth here is slightly less aggressive than the other 4 — keep
> ONE phrasing of the trigger-phrase pattern in the trimmed description as
> the "WHEN" clause anchor.
<!-- /deepen-plan -->
- [ ] 2.5: `session-history` (516 chars)
      Cut: detailed trigger phrase examples in parens, "with secret-redacted
      excerpts" implementation detail
      Keep: cross-vendor framing (Claude Code, Devin, Codex), "after
      compaction or session boundary" non-obvious applicability

<!-- deepen-plan: codebase -->
> **Codebase:** Body-content repetition CONFIRMED at total density. Every
> clause in the description has a direct body counterpart: three-vendor
> framing (body intro lines 10-12), result format (Phase 3 lines 122-130 +
> §Secret Redaction), all three trigger scenarios (`## When to Use` lines
> 46-53), multi-session decision-trail framing (line 50), compaction/session
> boundary clause (line 52). High cut depth is safe.
<!-- /deepen-plan -->

### Phase 3: yellow-core borderline tier (5 skills, light pass)

Read each. Trim only if there's a clearly cuttable pattern. Most of these
will get small or no edits.

- [ ] 3.1: `agent-native-audit` (377 chars) — inspect for inventory detail
      that could move to body; preserve "auditing existing codebase"
      differentiator vs `agent-native-architecture`
- [ ] 3.2: `agent-native-architecture` (314 chars) — five-principle
      enumeration is load-bearing; likely no trim
- [ ] 3.3: `morph-discovery-pattern` (278 chars) — borderline; cut behavior
      detail only if it duplicates the body
- [ ] 3.4: `mcp-health-probe` (269 chars) — `OFFLINE/DEGRADED/HEALTHY`
      classifications are load-bearing differentiators; likely no trim
- [ ] 3.5: `memory-remember-pattern` (250 chars) — already tight; verify
      temporal differentiator ("After-Act") vs `memory-recall-pattern`
      ("Before-Act") survives any edit. Likely no trim.

### Phase 4: Spot-checks on non-yellow-core plugins

Time-boxed pass. Read descriptions, edit only if a cuttable pattern is
obvious. Plugins to inspect (in priority order by description length):

- [ ] 4.1: `yellow-council/skills/council-patterns` (285 chars)
- [ ] 4.2: `yellow-mempalace/skills/palace-protocol` and
      `yellow-mempalace/skills/mempalace-conventions` (~230 avg)
- [ ] 4.3: `yellow-ci/skills/ci-conventions` and
      `yellow-ci/skills/diagnose-ci` (~198 avg)
- [ ] 4.4: `yellow-browser-test/skills/agent-browser-patterns` and
      `test-conventions` (~196 avg)
- [ ] 4.5: `yellow-ruvector/skills/agent-learning` and `memory-query` and
      `ruvector-conventions` (~188 avg) — note: `memory-recall-pattern`
      and `memory-remember-pattern` collision is here too
- [ ] 4.6: For each plugin where a SKILL.md is edited, add the plugin to
      the changeset entry list

Plugins NOT touched in this PR (descriptions already tight, no inspection
needed): yellow-chatprd, yellow-codex, yellow-composio, yellow-debt,
yellow-devin, yellow-docs, yellow-linear, yellow-research, yellow-review,
yellow-semgrep.

### Phase 5: Validation, format check, changeset

- [ ] 5.1: Run the format-check grep to ensure no description was converted
      to a multi-line scalar:
      `grep -rEn '^description: [>|][-+]?$' plugins/*/skills/*/SKILL.md`
      (must return empty)
- [ ] 5.2: Run the WHAT-clause-survival sanity check on every modified file:
      `grep -L "Use when" plugins/*/skills/*/SKILL.md` should not list any
      file where description was edited (cheap mechanical catch for the
      most dangerous over-trim failure)
- [ ] 5.3: Run `pnpm validate:schemas` (must pass — no SKILL.md-specific
      rules, but catches anything else broken)
- [ ] 5.4: Run `pnpm test:unit` and `pnpm typecheck` (full CI baseline)
- [ ] 5.5: Adjacent-pair distinguishability check (manual): for each pair
      below, read the two trimmed descriptions side-by-side and confirm a
      reader can tell which skill applies to which scenario:
      - `ideation` (user-invokable) vs `brainstorming` (internal)
      - `agent-native-architecture` vs `agent-native-audit`
      - `memory-recall-pattern` vs `memory-remember-pattern`
      - `debugging` vs `session-history` (both troubleshoot the past)
      - `compound-lifecycle` (skill) vs `knowledge-compounder` (agent — name
        cross-reference must survive in description)

<!-- deepen-plan: codebase -->
> **Codebase:** All five adjacent-pair "neighbor" skills are
> `user-invokable: false` (`brainstorming`, `agent-native-architecture`,
> `agent-native-audit`, `memory-recall-pattern`, `memory-remember-pattern`).
> This means user-facing collision risk is zero — these skills are not
> presented to the user at selection time, only loaded by other agents that
> declare them in `skills:` frontmatter. The "distinguishability" check
> therefore matters for INTERNAL routing within agents that preload multiple
> related skills (e.g., an agent that declares both `memory-recall-pattern`
> and `memory-remember-pattern`). The check is still required, but the
> failure mode is "agent picks the wrong preloaded skill" not "user sees
> two indistinguishable skills" — the latter never happens for this set.
<!-- /deepen-plan -->
- [ ] 5.6: Run `pnpm changeset` and produce a single multi-plugin changeset
      file. Format example (adjust to plugins actually touched):
      ```
      ---
      'yellow-core': patch
      'yellow-council': patch
      'yellow-mempalace': patch
      ---
      docs(skill-descriptions): trim non-load-bearing content while
      preserving WHAT + WHEN selection signal. See
      docs/brainstorms/2026-05-09-claude-code-skill-bloat-brainstorm.md.
      ```
- [ ] 5.7: Strip CRLF: `sed -i 's/\r$//' CONTRIBUTING.md` and any modified
      SKILL.md files (WSL2 cross-platform requirement per repo convention)

### Phase 6: PR description and submit

- [ ] 6.1: Build the before/after snapshot table for the PR description.
      For each modified skill, include: name, old char count, new char count,
      old description (verbatim), new description (verbatim), the
      cuttable patterns identified, the differentiating clause preserved.
      This is in the PR description, NOT a committed artifact file.
- [ ] 6.2: Note in the PR description that PR review is the verification
      gate for skill-routing accuracy (no automated test exists). Include
      explicit invitation: "If you observe Claude routing differently after
      merge, comment on this PR or open an issue — the trim is reversible
      via revert + new patch."
- [ ] 6.3: `gt commit create -m "..."` and `gt stack submit`

## Technical Details

### Files to Modify

**Always:**
- `CONTRIBUTING.md` — replace "Authors should not artificially trim..."
  policy block (~lines 388-393) with the nuanced version

**Phase 2 (always — verbose tier):**
- `plugins/yellow-core/skills/compound-lifecycle/SKILL.md`
- `plugins/yellow-core/skills/ideation/SKILL.md`
- `plugins/yellow-core/skills/optimize/SKILL.md`
- `plugins/yellow-core/skills/debugging/SKILL.md`
- `plugins/yellow-core/skills/session-history/SKILL.md`

**Phase 3 (likely — borderline tier):**
- `plugins/yellow-core/skills/agent-native-audit/SKILL.md`
- `plugins/yellow-core/skills/morph-discovery-pattern/SKILL.md`
- (others as identified during pass)

**Phase 4 (conditional — only if cuttable patterns found):**
- `plugins/yellow-council/skills/council-patterns/SKILL.md`
- `plugins/yellow-mempalace/skills/*/SKILL.md`
- (others by inspection)

### Files to Create

- `.changeset/skill-description-audit.md` (single multi-plugin changeset)

### Per-skill Audit Checklist

For each modified SKILL.md, verify:

1. **Format:** `description:` is single-line. No `>`, `>-`, `|`, `|-`, no
   bare multi-line continuation, no multi-line single-quoted strings.
2. **Length signals (not caps):** >200 chars: inspect for redundancy. >300:
   read carefully for body-content bleed. >400: trim is expected unless
   every char carries selection signal.
3. **WHAT clause:** capability statement is specific. Not "manages X,"
   "helps with X," or a generic capability list. Identifies what makes this
   skill distinct.
4. **WHEN clause:** "Use when..." trigger present. One precise semantic
   clause. NOT a list of synonymous phrasings.
5. **No phrase enumeration:** no `phrases like "X", "Y", "Z"` content. Cut
   to the semantic category.
6. **No methodology bleed:** no algorithm names, scoring rubric details,
   step-by-step procedures. Those belong in the body.
7. **Differentiating clause survives:** for skills with adjacent neighbors,
   the description still distinguishes them after trim.
8. **`user-invokable` flag unchanged:** present, value preserved (this PR
   only edits descriptions; flag changes are out of scope).

## Acceptance Criteria

1. Five Phase 2 skill descriptions are reduced (each by at least 30%)
   without losing the WHAT clause, WHEN trigger, or differentiating clause.
2. CONTRIBUTING.md policy block (lines ~388-393) is updated to reconcile
   "don't trim for budget" with this PR's "trim non-load-bearing content"
   premise. The new text distinguishes the two principles explicitly.
3. `pnpm validate:schemas`, `pnpm test:unit`, `pnpm typecheck`, `pnpm lint`
   all pass.
4. `grep -rEn '^description: [>|][-+]?$' plugins/*/skills/*/SKILL.md`
   returns empty (no broken multi-line description format introduced).
5. `grep -L "Use when" plugins/*/skills/*/SKILL.md` does not list any
   modified file (no skill lost its WHEN trigger).
6. Adjacent-skill-pair distinguishability is verified by reading each pair
   side-by-side after trim.
7. A single multi-plugin changeset file lists `patch` for every plugin
   whose SKILL.md was modified.
8. PR description includes the before/after table for every modified skill.

## Edge Cases & Error Handling

- **Adjacent-skill collapse after trim.** Mitigation: Phase 5.5 manual
  side-by-side check. Recovery: restore the differentiating clause to one
  description; re-verify.
- **A SKILL.md description becomes a multi-line YAML scalar by accident**
  (e.g., editor introduces a line break, or escaped-quote handling fails).
  Mitigation: Phase 5.1 grep. Recovery: rewrite as single-line.
- **Format change (quoted ↔ bare) introduced unintentionally** during
  text editing. Note: not a bug per se (both forms parse), but the PR
  should not change format for files where only content is being edited.
  Mitigation: review the diff for `description:` line format changes.
- **Reviewer challenges the trim premise** by pointing to CONTRIBUTING.md:388.
  Mitigation: Phase 1.3 updates that exact line first, in the same PR. The
  diff order in the PR description should put CONTRIBUTING.md before the
  SKILL.md edits to make the policy update visible up front.
- **Post-merge routing regression** (Claude stops invoking a skill, or
  routes to the wrong adjacent skill). No automated test exists.
  Mitigation: PR description invites observation reports. Recovery: revert
  the specific SKILL.md edit (single-file revert), file a follow-up PR with
  a more conservative trim, new patch changeset. Time horizon: any report
  within 14 days of merge gets prompt revert; later reports get a normal
  patch fix.

<!-- deepen-plan: external -->
> **Research:** The empirical risk asymmetry strongly favors trimming. All
> documented routing failures in the Claude Code community concern
> descriptions that are TOO LONG (truncated past the ~250-char auto-invocation
> threshold), not too short. There are no community-documented cases of a
> conservative trim causing a skill to become unselectable. Concrete cases:
> `anthropics/claude-code#9716` (skills unrecognized after description
> growth), `anthropics/claude-code#56710` (122 descriptions dropped due to
> bulk over-budget), `backnotprop/plannotator#412` (trigger phrases lost in
> 455-char description). Practitioner account: "All 200 characters of it —
> used up on a detailed explanation of *what* the skill does, with zero
> space left for the 'Use when…' clause" (medium.com/system-design-mastery).
> The plan's risk framing is accurate but the rollback urgency may be
> over-specified — empirical risk is low.
<!-- /deepen-plan -->
- **`when_to_use` field adoption is out of scope.** Some skills could be
  cleanly split (capability in `description:`, triggers in `when_to_use:`),
  but adopting that field is a separate refactor — the per-file edit shape
  is different and the combined 1,536-char cap interaction needs a
  policy decision. Document as a follow-up in the PR description.

## Migration & Rollback

- **No migration required.** Frontmatter-only edits; skill bodies and
  behavior unchanged. Consumers update via normal `/plugin marketplace
  update` flow.
- **Rollback:** `git revert <commit>` produces a clean reverse diff. New
  patch changeset documents the rollback. No data migration concerns.

## Out of Scope

- Adding a description-length validator rule to `validate-agent-authoring.js`
  (user explicitly declined during brainstorm).
- Adopting the `when_to_use:` frontmatter field (separate refactor).
- Editing third-party plugins (firecrawl, pr-review-toolkit, etc. — not in
  this repo).
- Changing skill body content. This PR only touches `description:` and one
  CONTRIBUTING.md policy block.
- Lowering `skillListingBudgetFraction` after the trim. The user-side
  config knob remains at the user's discretion; the README guidance from
  PR #459 already covers it.
- Renaming or restructuring the SKILL.md files themselves.

## References

- `docs/brainstorms/2026-05-09-claude-code-skill-bloat-brainstorm.md` — design doc
- `plugins/yellow-core/skills/create-agent-skills/SKILL.md` — meta-skill
  with WHAT + WHEN format and good/bad example descriptions
- `docs/solutions/code-quality/skill-frontmatter-attribute-and-format-requirements.md`
  — single-line format requirement, broken multi-line variants
- `CONTRIBUTING.md:383-393` — current skill listing budget guidance (to be
  updated)
- `CLAUDE.md:90-91` — single-line description requirement and
  `user-invokable` spelling
- `code.claude.com/docs/en/skills` — Anthropic official spec (1,536-char
  per-skill hard cap, dynamic 1% listing budget,
  `SLASH_COMMAND_TOOL_CHAR_BUDGET` env var)
- PR #459 (commit `6d86b1d6`) — added the current "don't trim for budget"
  policy line

<!-- deepen-plan: external -->
> **Research — Anthropic-published reference SKILL.md descriptions** (target
> shape for trim outcomes):
> - https://github.com/anthropics/skills — official reference repo
> - https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md (~225 chars)
> - https://github.com/anthropics/skills/blob/main/skills/claude-api/SKILL.md (~140 chars)
> - https://github.com/anthropics/skills/blob/main/skills/webapp-testing/SKILL.md (~210 chars)
> - https://github.com/anthropics/skills/blob/main/skills/docx/SKILL.md (~210 chars, with explicit triggers)
> - https://github.com/anthropics/skills/blob/main/skills/pptx/SKILL.md (~370 chars, deliberate enumeration outlier)
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research — Auto-invocation threshold and routing-failure evidence:**
> - https://github.com/anthropics/claude-code/issues/44780 — 250-char
>   practical threshold (skill-creator's own warning logic)
> - https://github.com/anthropics/claude-code/issues/56710 — bulk
>   description-dropped warning in production
> - https://github.com/anthropics/claude-code/issues/9716 — skills
>   unselectable after description grew past threshold
> - https://github.com/backnotprop/plannotator/issues/412 — 455-char
>   description truncated, losing trigger phrases
> - https://claudefa.st/blog/guide/mechanics/skill-listing-budget — budget
>   math, token-cost-per-skill estimation
> - https://leehanchung.github.io/blogs/2025/10/26/claude-skills-deep-dive/
>   — `when_to_use` undocumented status (justifies deferral)
> - https://resources.anthropic.com/hubfs/The-Complete-Guide-to-Building-Skill-for-Claude.pdf
>   — Anthropic guide stating description "MUST include BOTH WHAT and WHEN,
>   under 1024 characters"
<!-- /deepen-plan -->
