# Feature: PR #507 Residual Review Follow-ups

**Status:** Implemented in PR #507 (commit `650f3fc3`, 2026-05-11).
Retrospective document; task checkboxes preserve original phase structure.
"Current state" claims and acceptance criteria below describe the
pre-implementation state — read in past tense.

## Problem Statement

PR #507 (`docs(skills): trim non-load-bearing content from 7 skill descriptions`)
landed a 1 P1 fix + 2 reviewer-comment resolutions during sweep, but 11 P2/P3
advisories were deferred to Residual Actionable. They cluster into three
buckets: (1) cross-reviewer-agreement findings worth fixing on this branch
before merge, (2) coverage gaps and remaining trim opportunities surfaced by
the audit itself, and (3) documentation hygiene around the plan + brainstorm
artifacts.

Closing these eliminates a perception conflict in the new CONTRIBUTING.md
policy (4-reviewer agreement on the user-invokable:false carve-out wording),
fixes a description-vs-body mismatch in `agent-native-audit`, and reduces the
documentation rot surface of the audit artifacts post-merge.

## Current State

Branch `agent/chore/skill-description-audit` is up to date on remote with
`2b8881c3` (resolver fixes). Two PR review threads on PR #507 are marked
resolved; verification re-fetch returned `[]`. Working tree is clean.

Findings deferred from `/review:sweep` (see PR #507 review report dated
2026-05-11):

| Priority | Reviewers | Item                                           | File                                                    |
| -------- | --------- | ---------------------------------------------- | ------------------------------------------------------- |
| P2       | 4 (CS, AD, CA, CR) | user-invokable:false carve-out vs PR rationale | CONTRIBUTING.md:415-419                               |
| P2       | 2 (CA, CR) | agent-native-audit WHEN clause mismatch       | plugins/yellow-core/skills/agent-native-audit/SKILL.md:3 |
| P2       | 1 (MT)    | deepen-plan dead annotation blocks             | plans/skill-description-audit.md                       |
| P2       | 1 (MT)    | External issue rot risk (no captured-at date)  | CONTRIBUTING.md:408 + plan/brainstorm                  |
| P3       | 2         | Plan not in plans/complete/                    | plans/skill-description-audit.md                       |
| P3       | 2         | agent-native-architecture 314 chars untrimmed  | plugins/yellow-core/skills/agent-native-architecture/SKILL.md |
| P3       | 1         | Coverage gaps (security-fencing, local-config, semgrep-conventions) | three SKILL.md files                                   |
| P3       | 1         | debugging description at ~260 chars            | plugins/yellow-core/skills/debugging/SKILL.md          |
| P3       | 1         | Changeset count drift 1-4 chars                | .changeset/skill-description-audit.md                  |
| P3       | 1         | when_to_use field gap in budget guidance       | CONTRIBUTING.md:385                                    |
| P3       | 1         | Revert atomicity note (single combined changeset) | PR body / changeset                                  |

Reviewer codes: CS=code-simplicity, AD=adversarial, CA=comment-analyzer,
CR=correctness, MT=maintainability.

## Proposed Solution

A single follow-up commit on the same branch addresses the items in three
phases. **No new plugin code changes** — every fix is markdown / frontmatter.
Phase 1 (P2) closes the highest-signal items; Phase 2 (P3 surface) closes
trim/coverage items; Phase 3 (P3 hygiene) handles the artifacts.

**Out of scope for this follow-up:**

- `when_to_use:` field adoption (deferred per original plan)
- Automated description-length validator (no consensus in review that this
  is worth the validator surface)
- Routing-regression smoke test (no tractable mechanism without a fixed
  query corpus)

## Implementation Plan

### Phase 1: P2 Cross-Reviewer Findings

- [ ] **1.1: Reconcile CONTRIBUTING.md user-invokable:false carve-out with
      this audit's actual trims.** Current text says budget pressure is not
      a valid trim reason for `user-invokable: false` skills, while the PR
      changeset cites the ~250-char threshold (budget framing) as rationale
      for trimming `agent-native-audit` and `council-patterns` (both
      `user-invokable: false`). The trims are defensible as
      documentation-bloat removal. Pick one of:
      - **Option A (preferred):** Soften the carve-out to acknowledge that
        the documentation-bloat exception covers selection-clarity trims
        when the content is body-content repetition. One added sentence,
        cites the two trimmed skills as examples.
      - **Option B:** Annotate the changeset with a "documentation-bloat
        removal, not budget pressure" rationale for the two
        `user-invokable: false` trims.
      - Verify the chosen wording does NOT re-introduce a contradiction
        with the "Do not cut content that aids selection accuracy" bullet.
      - Files: `CONTRIBUTING.md:415-419` (Option A) or
        `.changeset/skill-description-audit.md` (Option B).

- [ ] **1.2: Fix `agent-native-audit` description WHEN clause.** Current
      description ends with "Use when auditing for agent-native readiness
      or deciding whether to extract orchestration logic from a workflow
      tool." The second clause maps to body Step 4 content (`Usage` →
      `Workflow-tool detection`), not to any `## When to Use` bullet.
      Pick one of:
      - **Option A:** Add a `## When to Use` bullet at line ~26 of
        `agent-native-audit/SKILL.md`: "Deciding whether to extract
        orchestration logic from a workflow tool — see Step 4 below for
        the detection rubric."
      - **Option B (preferred):** Replace the clause in the description
        with one tied to an existing bullet: "Use when auditing for
        agent-native readiness, before adding a new agent capability, or
        when triaging agent-behavior regressions."
      - Re-check char count stays under ~270 to honor the audit's intent.
      - Files: `plugins/yellow-core/skills/agent-native-audit/SKILL.md`.

### Phase 2: P3 Surface Cleanups

- [ ] **2.1: Trim `agent-native-architecture` description from 314 → ~270
      chars.** This is the repo's longest post-audit description, flagged
      by both `project-compliance-reviewer` and `adversarial-reviewer`.
      Plan Phase 3.2 deliberately exempted it as "five-principle
      enumeration is load-bearing", and the principle list IS load-bearing
      (consumed by `agent-native-reviewer`). Drop the trailing 35-char
      explanatory phrase "or evaluating whether a feature treats agents as
      first-class citizens or bolt-on additions" — that interpretive frame
      belongs in the body, not the description.
      - Files: `plugins/yellow-core/skills/agent-native-architecture/SKILL.md:3`.
      - Verify char count after trim.

- [ ] **2.2: Trim `debugging` description from ~260 → ~230 chars.** Still
      above the ~250 positional threshold targeted by this audit. Drop
      "then optionally implement a test-first fix" — it blurs debugging
      into the fix-it surface and is recoverable from the body.
      - Files: `plugins/yellow-core/skills/debugging/SKILL.md:3`.

- [ ] **2.3: Document the "inspected, no trim" decisions for coverage
      gaps.** Three `user-invokable: false` skills sit above the 200-char
      inspection threshold but were not enumerated in plan Phase 3/4:
      `security-fencing` (241), `local-config` (231),
      `semgrep-conventions` (239). After inspection, none have clearly
      cuttable content. Add a one-line note to the PR description (NOT to
      the plan, which is moving to complete) acknowledging these were
      inspected and cleared.
      - Files: PR description only (no file changes).

- [ ] **2.4: Sync changeset before/after counts to actual HEAD values.**
      `ideation` (claimed 202 / actual 204), `optimize` (claimed 234 /
      actual 238), `session-history` (claimed 242 / actual 243) drift by
      1-4 chars. Update the changeset table for accuracy.
      - Files: `.changeset/skill-description-audit.md`.

### Phase 3: P3 Hygiene

- [ ] **3.1: Move the plan to `plans/complete/`.** Every other completed
      plan lives under `plans/complete/`. The skill-description-audit plan
      is now done. Two-reviewer agreement (code-simplicity, comment-analyzer)
      flagged the placement inconsistency.
      - `git mv plans/skill-description-audit.md plans/complete/skill-description-audit.md`
      - Update any references in `docs/brainstorms/...` if present.

- [ ] **3.2: Strip `<!-- deepen-plan: ... -->` annotation blocks from the
      plan.** Six blocks of inline research scaffolding (~130 lines)
      served the implementation agent and are inert post-merge. Strip
      them after the move in step 3.1. Do not promote them to plan body
      prose — the conclusions are already absorbed into CONTRIBUTING.md
      and the changeset.
      - Files: `plans/complete/skill-description-audit.md` (post-move).
      - Verify a quick `grep '<!-- deepen-plan' plans/complete/skill-description-audit.md` returns empty.

- [ ] **3.3: Annotate external-issue references with a captured-at date.**
      The plan, brainstorm, and CONTRIBUTING.md cite `claude-code#44780`
      and related issues. If those issues are closed/dismissed by
      Anthropic, the references become stale and misleading. Add an
      "(observed 2026-05-09)" annotation next to each #44780 citation
      in CONTRIBUTING.md and the brainstorm. The plan is now in
      `plans/complete/` — no edit needed there.
      - Files: `CONTRIBUTING.md:408`, `docs/brainstorms/2026-05-09-claude-code-skill-bloat-brainstorm.md`.

- [ ] **3.4: Close brainstorm open questions OR mark brainstorm as
      closed.** Brainstorm has three open questions whose answers are not
      recorded in the plan or PR body. Either append a `## Decisions Made`
      section that closes each one in a sentence, or add a `Status:
      Implemented in PR #507 (2026-05-11)` header so future readers know
      the document is no longer active.
      - Files: `docs/brainstorms/2026-05-09-claude-code-skill-bloat-brainstorm.md`.

- [ ] **3.5: Scope the budget-section preamble to `description:` only.**
      CONTRIBUTING.md line 385 currently says "Each individual skill's
      combined `description` + `when_to_use` is officially capped at
      **1,536 characters**", but the surrounding guidance discusses only
      `description:`. Append one sentence after line 386: "None of the
      yellow-plugins SKILL.md files currently use `when_to_use:`; the
      guidance below covers `description:` only. If `when_to_use:` is
      adopted in a future PR, revisit the budget arithmetic."
      - Files: `CONTRIBUTING.md:385-386`.

- [ ] **3.6: Document the revert-atomicity caveat in the PR description
      OR in CONTRIBUTING.md.** PR body says trim is "reversible via
      single-file revert + new patch changeset", but the combined
      changeset makes per-file revert require cherry-pick + new patch
      changeset, not a simple `git revert`. One-line note either in PR
      description or as a small bullet under the budget guidance.
      - Files: PR description (no file change) OR `CONTRIBUTING.md` under
        the budget section.

### Phase 4: Validation & Submit

- [ ] **4.1: `pnpm validate:schemas` — must pass with zero new violations.**

- [ ] **4.2: `grep -E '^description:' plugins/*/skills/*/SKILL.md | awk '{ print length($0), $0 }' | sort -n` — verify
      no description regressed above 270 chars after edits.**

- [ ] **4.3: Format guard.** Re-run the audit greps:
      ```bash
      grep -rE '^description: [>|][-+]?$' plugins/*/agents/*.md plugins/*/skills/*/*.md  # must return empty
      grep -L 'Use when' plugins/yellow-core/skills/{agent-native-audit,debugging}/SKILL.md  # must return empty
      ```

- [ ] **4.4: Add a `patch` changeset entry.** `.changeset/<slug>.md`
      should cover both yellow-core and yellow-council (matching the
      existing changeset's scope) with a one-line summary referencing
      this follow-up. Decision: include in the existing
      `skill-description-audit.md` changeset (append a line) rather than
      creating a sibling changeset, to keep the audit work as one
      versioned unit.

- [ ] **4.5: `gt modify -m "fix(docs): apply PR #507 review followups (carve-out, description trims, plan move)"`** then
      `gt submit --no-interactive --force` (branch will need force due
      to prior amend lineage).

- [ ] **4.6: Final `gh pr view 507 --json reviewDecision` sanity check.**
      Confirm no new automated review threads were generated by gemini /
      copilot / codeant after the push.

## Technical Specifications

### Files to Modify (in order)

1. `CONTRIBUTING.md` — Phase 1.1 (carve-out), 3.3 (date annotation), 3.5 (when_to_use scope), 3.6 (optional revert note)
2. `plugins/yellow-core/skills/agent-native-audit/SKILL.md` — Phase 1.2 (WHEN clause)
3. `plugins/yellow-core/skills/agent-native-architecture/SKILL.md` — Phase 2.1 (trim 314 → ~270)
4. `plugins/yellow-core/skills/debugging/SKILL.md` — Phase 2.2 (trim 260 → ~230)
5. `docs/brainstorms/2026-05-09-claude-code-skill-bloat-brainstorm.md` — Phase 3.3 (date annotation), 3.4 (closure)
6. `.changeset/skill-description-audit.md` — Phase 2.4 (count sync), 4.4 (followup note)

### Files to Move

1. `plans/skill-description-audit.md` → `plans/complete/skill-description-audit.md` (Phase 3.1)

### Files to Create

None.

## Acceptance Criteria

1. The CONTRIBUTING.md carve-out paragraph reads coherently with the audit's
   actual trims (no perception conflict on re-read).
2. `agent-native-audit/SKILL.md` description WHEN clause maps to an explicit
   `## When to Use` bullet in the same file (verified by grep).
3. `agent-native-architecture` and `debugging` descriptions each ≤ 270 chars.
4. `plans/skill-description-audit.md` no longer exists; `plans/complete/
   skill-description-audit.md` exists and is free of `<!-- deepen-plan` blocks.
5. CONTRIBUTING.md and brainstorm contain a captured-at date next to the
   `#44780` reference.
6. Brainstorm has either a `## Decisions Made` section or a `Status:` header.
7. `pnpm validate:schemas` passes.
8. PR #507 has no new automated review threads from gemini / copilot.

## Edge Cases

- **Phase 1.1 wording risk.** If the chosen rewording of the carve-out
  contradicts another bullet ("Do not cut content that aids selection
  accuracy"), the cure becomes worse than the disease. Verification: re-read
  the entire Skill Description Budget section after each edit.
- **Phase 2.1 trim risk.** The agent-native-architecture description carries
  the five-principle enumeration that's consumed by `agent-native-reviewer`.
  Dropping the trailing explanatory phrase preserves the enumeration; do NOT
  cut into the five names.
- **Phase 3.1 plan move risk.** Any reference to `plans/skill-description-audit.md`
  in CONTRIBUTING.md, README, or brainstorm becomes a broken link.
  Verification: `grep -rn 'plans/skill-description-audit' --include='*.md'`
  before the move; update any matches in the same commit.
- **Phase 4.4 changeset risk.** Appending to an already-applied changeset is
  fine as long as the changeset hasn't been consumed by `changeset version`
  yet. Verify the file is still present in `.changeset/` (not moved to
  `CHANGELOG.md`).

## References

- Review report: PR #507 sweep summary in conversation (2026-05-11)
- Plan being closed: `plans/skill-description-audit.md` (current location;
  will move to `plans/complete/` per task 3.1)
- Brainstorm: `docs/brainstorms/2026-05-09-claude-code-skill-bloat-brainstorm.md`
- Original PR body: `gh pr view 507 --json body`
- CONTRIBUTING.md budget section: lines 380-424
- Past learnings injected at review time:
  - `docs/solutions/code-quality/skill-frontmatter-attribute-and-format-requirements.md`
  - `docs/solutions/code-quality/frontmatter-sweep-and-canonical-skill-drift.md`
