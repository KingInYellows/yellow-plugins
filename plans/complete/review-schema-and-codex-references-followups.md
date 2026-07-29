# Feature: Review-schema definitions, Codex reference-sidecar support, and gt-cleanup split

## Problem Statement

Three follow-ups deferred from the prompt-quality pass (PR #666):

1. The `residual_risks`/`testing_gaps` reviewer-output fields appear as bare
   `[]` in 12 agent files and the canonical schema example, with no prose
   definition anywhere except the aggregator logic buried in
   `review-pr.md` Step 7 — a low-context author has no way to know the
   fields are aggregator-populated demotion buckets.
2. `plugins/gt-workflow/skills/gt-cleanup/SKILL.md` is 561 lines against the
   500-line RULE 15a advisory ceiling (warning fires twice: source + generated
   codex copy). The standard references/-split fix is currently impossible:
   `emit-codex.js` hard-errors on sidecar files in Codex-allowlisted skill
   dirs, and `validate-codex.js` bans `${CLAUDE_PLUGIN_ROOT}` in Codex-exposed
   content, killing the plugin-root workaround. **User decision (2026-07-27):
   extend the generator** so Codex-exposed skills can carry `references/`.
3. **Candidate P1 found during planning:** `yellow-core`'s
   `performance-reviewer.md` and `security-reviewer.md` emit findings with
   only 7 of the 10 per-finding fields `review-pr.md` Step 6.1 requires
   (`title`, `autofix_class`, `owner`, `requires_verification`,
   `pre_existing` missing). Step 6.1 states required-field violations "drop
   the WHOLE return," and no special-case normalizer exists for these two
   agents — so both personas (gated on auth/crypto/DB-touching diffs) likely
   contribute zero findings to every review that selects them, silently.
   **User decision (2026-07-27): in scope for this plan.**

## Current State

- Field semantics exist only in `plugins/yellow-review/commands/review/review-pr.md`
  Step 7 ("mode-aware demotion": severity P2/P3 AND `autofix_class: advisory`
  AND all contributing reviewers testing/maintainability → `testing_gaps` if
  any contributing reviewer is testing-flavored, else `residual_risks`).
  `review-all.md` Step 8.8 mirrors it by cross-reference. Reviewer agents
  never populate the fields; only the orchestrator does.
- `scripts/lib/generate/emit-codex.js` `buildCodexSkillTree()` (~lines
  372-388) copies ONLY `SKILL.md` per allowlisted skill and hard-errors on
  any other entry. `scripts/validate-codex.js` `claude-env-var-reference`
  (~lines 194-202) bans Claude-only env vars in Codex-exposed content.
  gt-cleanup is Codex-allowlisted (`catalog/plugins/gt-workflow.json:72`).
- gt-cleanup body is byte-identical between source and codex copy;
  frontmatter intentionally diverges (codex copy drops `user-invokable`,
  unquotes `description`) — say "body byte-identical," not "byte-identical."
- `plugins/gt-workflow/tests/gt-cleanup.bats` has 9 "Phase N / Step N"
  comment anchors (6 blocks: lines ~3-5, 33, 72, 112, 122, 134, 231) naming
  SKILL.md sections — resilient to line churn, not to section moves.

## Proposed Solution

Three phases, ordered so the generator feature unblocks the split. Phases 1-2
are independent of Phase 3+4 and could be stacked as separate PRs
(`/gt-stack-plan` can decompose this file if desired).

<!-- deepen-plan: external -->
> **Research:** The Phase 3/4 load-bearing assumption — that a Codex session
> can follow a "Read references/x.md" stub — is NOT guaranteed. Sibling-file
> resolution from skills is a confirmed, still-open Codex CLI bug
> (openai/codex#9226; OpenAI engineer reproduced 2026-01-16; users still
> reporting recurrence 2026-06-25, with reliability varying by reasoning
> effort). Claude Code has the same class of bug
> (anthropics/claude-code#11011). The documented workaround — explicit
> phrasing "Read the file `references/x.md` located in this skill's
> directory" — measurably helps but is best-effort. A deterministic
> alternative: have the Codex emitter INLINE reference content into the
> generated SKILL.md instead of copying files (keeps runtime reliability,
> gives up the line-count win on the generated copy). Decide at Phase 3
> implementation time; either way the live smoke test annotated under
> Phase 5 is mandatory. No community prior art exists for cross-host
> skill+references distribution — this is first-of-its-kind.
<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->
> **Codebase:** Precedent for verifying exactly this class of assumption:
> PR #661 did a live `codex plugin add` install/inspect/uninstall round-trip
> on codex-cli 0.144.6 (per `plugins/gt-workflow/CLAUDE.md` "Codex
> Distribution") to verify MCP discovery. This plan's gates need the
> equivalent for sibling-file reads.
<!-- /deepen-plan -->

## Implementation Plan

### Phase 1: Canonical field definitions (docs-only, yellow-review + yellow-core)

- [x] 1.1: Add prose definition to
      `plugins/yellow-review/skills/pr-review-workflow/SKILL.md` under
      `## Finding Output Format` (fields at ~lines 162-163): the two arrays
      are aggregator-populated demotion buckets per `review-pr.md` Step 7;
      reviewer agents ALWAYS emit them as empty arrays; include the
      qualifying conditions (P2/P3 + advisory + testing/maintainability
      contributors; testing wins on mixed sets).
- [x] 1.2: Add a one-line comment to the JSON example in the 10 yellow-review
      persona files carrying the fields (adversarial, agent-cli-readiness,
      agent-native, cli-readiness, correctness, maintainability,
      plugin-contract, project-compliance, project-standards, reliability
      reviewers), e.g. `// aggregator-populated demotion buckets — always
      emit [] (see pr-review-workflow "Finding Output Format")`.

<!-- deepen-plan: codebase -->
> **Codebase:** File count verified: `grep -rl '"residual_risks"'` over
> `plugins/*/agents/` returns exactly 12 — the 10 yellow-review personas
> plus yellow-core's performance-reviewer.md and security-reviewer.md.
<!-- /deepen-plan -->
- [x] 1.3: Inline-replicate the same one-line comment (verbatim) into
      `plugins/yellow-core/agents/review/performance-reviewer.md` and
      `security-reviewer.md` — cross-plugin, so no live skill reference
      (`skills:` frontmatter cannot cross plugins). Coordinate with Phase 2
      edits to the same JSON blocks.
- [x] 1.4: Do NOT edit `review-pr.md` / `review-all.md` (consume-only — they
      already embody the definition) and do NOT touch the 5 prose-format
      yellow-review agents (pr-test-analyzer, comment-analyzer,
      code-simplifier, type-design-analyzer, silent-failure-hunter) — their
      migration is explicitly deferred by the SKILL.md itself.

Decisions recorded: no RULE-16-style sentinel lint (that mechanism is for
load-bearing runtime constants; a one-line doc pointer does not warrant
byte-identity tooling). Report-template rendering of bucket CONTENTS stays
out of scope (count-only display is the intentional advisory-tier pattern).

### Phase 2: Fix yellow-core reviewer output schema (behavior fix)

- [x] 2.1: Verify the silent-drop claim before changing anything: trace
      `review-pr.md` Step 6.1's required-field list (~line 589) against the
      JSON emitted by `performance-reviewer.md` (~lines 109-125) and
      `security-reviewer.md` (~line 142); confirm no normalizer path exists
      for their 7-field shape. Record the verification in the PR body.

<!-- deepen-plan: codebase -->
> **Codebase:** Validation sharpened the bug: review-pr.md does not merely
> lack a normalizer — it ROSTERS these two agents as legacy-prose emitters
> in TWO places (Step 5 legacy-format list, lines ~531-537, and Step 6
> sub-step 0 normalizer roster, lines ~567-570), which is false: both agents
> emit structured JSON (severity, category, file, line, finding, fix,
> confidence — no bracket/`Finding:`/`Fix:` prose for the parser to match).
> Their output falls between the two documented branches and dies at Step
> 6.1's whole-return drop (lines ~613-615; the only carve-out is
> plugin-contract-reviewer's optional extensions). The fix must update BOTH
> rosters in review-pr.md in addition to the agent files. Field mapping
> confirmed: compact-return names are `title` and `suggested_fix`
> (review-pr.md:493,503).
<!-- /deepen-plan -->
- [x] 2.2: Align both agents' output format to the 10-field compact-return
      contract (`title, severity, category, file, line, confidence,
      autofix_class, owner, requires_verification, pre_existing` per
      finding), keeping their existing `finding`/`fix` prose content as
      `title`/`suggested_fix` per the compact-return schema.
- [x] 2.3: Update the stale rosters that currently claim these two agents
      use the legacy prose format — both live in `review-pr.md` (Step 5
      list ~529-537 AND Step 6 sub-step 0 roster ~560-570).

<!-- deepen-plan: codebase -->
> **Codebase:** Correction to the original task: `pr-review-workflow/SKILL.md`
> ~lines 178-183 is NOT stale — it is generic mechanism prose naming no
> agents (the only mention of these two agents in that file, lines ~82-99,
> is selection criteria with no output-format claim). The misleading text
> lives entirely in review-pr.md's two rosters; the SKILL.md target was
> dropped from 2.3 accordingly.
<!-- /deepen-plan -->
- [x] 2.4: Verification: run a real `/review:pr` (or a dry harness) against a
      diff that selects at least one of the two personas and confirm its
      findings survive Step 6.1 (non-zero surviving findings, no drop-count
      increment attributable to these agents).

### Phase 3: Generator support for Codex reference sidecars (scripts/, no changeset)

- [x] 3.1: `scripts/lib/generate/emit-codex.js` — extend
      `buildCodexSkillTree()` to copy `references/*.md` (the `references/`
      subdir only; keep the hard error for any OTHER sidecar entry so the
      fail-closed posture is preserved) into
      `codex/skills/<skill>/references/`, preserving relative layout so
      skill-relative "sibling" Read stubs resolve identically in both
      locations.

<!-- deepen-plan: codebase -->
> **Codebase:** Add symlink defense to 3.1: `buildCodexSkillTree` applies
> `lstat` + `realpathSync` containment to the skill dir itself
> (emit-codex.js:329-370) but has zero symlink handling for sidecar entries
> (it never descends into them today). Copied `references/*.md` need the
> same rejection of symlinks and path escapes.
<!-- /deepen-plan -->
- [x] 3.2: Extend the stale-artifact sweep so removed/renamed reference
      files are deleted from `codex/skills/<skill>/references/` on
      regeneration.

<!-- deepen-plan: codebase -->
> **Codebase:** Confirmed required, not optional: the sweep
> (`scripts/generate-manifests.js:364-548`) enumerates only one level —
> per skill dir it pushes only `<skill>/SKILL.md` as a stale candidate
> (line ~498) and never recurses. Without 3.2, a removed reference file
> persists on disk forever.
<!-- /deepen-plan -->
- [x] 3.3: `scripts/validate-codex.js` — scan copied reference files with the
      SAME exposure-lint rules as SKILL.md bodies (including
      `claude-env-var-reference` and capability lint); update whatever rule
      currently asserts SKILL.md-only dirs.

<!-- deepen-plan: codebase -->
> **Codebase:** Single choke point confirmed: `collectCodexExposedFiles`
> (`scripts/validate-codex.js:366-435`) hardcodes
> `join(skillsDir, entry.name, 'SKILL.md')` at line ~419 as the sole file
> collected per skill, feeding all 6 DIRECT_CHECKS + 3 registry-gated
> checks. Extending that one collection function is sufficient — no
> per-rule duplication needed. Also note validate-agent-authoring.js: its
> `skillFiles` walk filters `basename === 'SKILL.md'`, so copied reference
> files are exempt from RULE 15; its `markdownFiles` walk does pick them
> up for subagent-reference/sentinel checks, identical to how source
> references/ files are treated today (no new risk).
<!-- /deepen-plan -->
- [x] 3.4: Tests: extend the `generate-manifests` integration tests
      (`tests/integration/`) with fixtures covering: skill with references/
      (copied), reference removal (swept), non-references sidecar (still
      hard-errors), and `${CLAUDE_PLUGIN_ROOT}` inside a reference file
      (validate-codex fails). Prove each test fails pre-fix where
      applicable.

<!-- deepen-plan: codebase -->
> **Codebase:** These fixtures are net-new coverage: `grep -rn sidecar
> tests/` returns nothing — no test exercises even the existing sidecar
> hard-error path today.
<!-- /deepen-plan -->
- [x] 3.5: `pnpm validate:generated` byte-identity gate must pass with the
      new targets; `pnpm test:unit` + `pnpm test:integration` green.

### Phase 4: Split gt-cleanup SKILL.md (gt-workflow)

- [x] 4.1: Move the three "conditional or late-sequence" blocks into
      `plugins/gt-workflow/skills/gt-cleanup/references/` behind imperative
      skill-relative Read stubs ("(sibling to this SKILL.md)" idiom, NO
      `${CLAUDE_PLUGIN_ROOT}`): Phase 2 #4 PR Status Lookups (~82 lines),
      Phase 4 Actionable Categories mechanics (~112 lines), Phase 6 Worktree
      Cleanup Offer (~42 lines). Target core file ≈300 lines (ceiling 500).

<!-- deepen-plan: codebase -->
> **Codebase:** Line ranges verified exact: PR Status Lookups = 162-243
> (82 lines), Actionable Categories = 346-457 (112 lines), Worktree
> Cleanup Offer = 503-544 (42 lines). ALSO: four retained sections
> forward-reference "Phase 6 (Worktree Cleanup Offer)" by name from
> outside the moved blocks — lines ~322 (Dry Run Exit), ~330 (Nothing to
> Clean), ~342-344 (Phase 4 intro), ~559/561 (Success Criteria) — and must
> be repointed at the reference file as part of 4.1.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** Word the Read stubs using the bug-thread-recommended
> phrasing — "Read the file `references/<name>.md` located in this skill's
> directory" — rather than a bare relative path; per
> anthropics/claude-code#11011 this measurably reduces resolution failures
> on both hosts. Treat stub-following on Codex as best-effort (see the
> Proposed Solution annotation) pending the live smoke test.
<!-- /deepen-plan -->
- [x] 4.2: Keep the host note added in PR #666 (Codex AskUserQuestion
      fallback) in the core file, and ensure moved content stays
      Codex-clean (no Claude-only env vars — it becomes Codex-exposed via
      Phase 3).
- [x] 4.3: Update the 9 "Phase N / Step N" comment anchors in
      `plugins/gt-workflow/tests/gt-cleanup.bats` to the restructured
      section names; verify each anchor against the actual new location
      (read the section, don't just grep). Run `bats tests/` in
      `plugins/gt-workflow/`.

<!-- deepen-plan: codebase -->
> **Codebase:** Exact anchor lines in `tests/gt-cleanup.bats`: 3, 4, 5, 33,
> 72, 112, 122, 134, 231 (line 3 has two mentions). THREE are mislabeled
> TODAY, before any move: lines 4, 72, and 231 say "Phase 3" for content
> that actually lives under `### Phase 2: Fetch and Scan` (Initial
> Classification is Phase 2 #3; Staleness Check is Phase 2 #5) — fix these
> pre-existing mislabelings in the same pass. Churn concentration: 4
> anchors point into Actionable Categories (highest-risk relocation);
> PR Status Lookups and Worktree Cleanup Offer have ZERO anchors.
<!-- /deepen-plan -->
- [x] 4.4: `pnpm generate:manifests` — regenerate codex artifacts; confirm
      RULE 15a warning is gone for both copies in `pnpm validate:agents`.

### Phase 5: Ship

- [x] 5.1: New changeset (the existing `prompting-quality-pass` changeset may
      be consumed before this lands): `yellow-review` patch (doc
      definitions), `yellow-core` patch (doc + behavior fix — call the
      schema fix out as a distinct bullet), `gt-workflow` patch (content
      restructure, no interface change). `scripts/` changes need no
      changeset.
- [x] 5.2: Gates: `pnpm validate:schemas`, `pnpm validate:agents`,
      `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`,
      `pnpm test:integration`, gt-workflow bats suite. LF endings on all new
      files (`sed -i 's/\r$//'` on WSL2-created files).
- [x] 5.3: Submit via `gt` as a DRAFT PR (or stacked drafts if Phases 1-2 /
      3-4 are split); do not merge without human review.
- [x] 5.4: Live Codex smoke test (required — CI cannot catch this): install
      the regenerated gt-workflow plugin into a real Codex CLI session
      (`codex plugin add` round-trip, as PR #661 did for MCP discovery) and
      confirm the gt-cleanup skill actually follows a reference stub into
      `references/*.md`. If it cannot, fall back to the inline-on-generate
      alternative from the Proposed Solution annotation before shipping.

## Acceptance Criteria

- `pr-review-workflow` SKILL.md defines both fields in prose; all 12
  field-carrying agent files carry the clarifying comment; no edits to the 5
  deferred prose-format agents or the two consumer commands.
- performance-reviewer and security-reviewer findings demonstrably survive
  `review-pr.md` Step 6.1 (verified per 2.4).
- A Codex-allowlisted skill with `references/*.md` generates and validates
  cleanly; any other sidecar still hard-errors; removed references are swept.
- gt-cleanup source and codex SKILL.md are both under 500 lines; RULE 15a
  warning no longer fires; bats suite passes with updated anchors.
- All Phase 5 gates green; changeset present.

## Edge Cases

- Prettier `proseWrap: always` would reflow added long lines — never run
  `pnpm format` over `plugins/` (standing repo rule).
- Nested subdirs inside `references/` — Phase 3 scope is flat `*.md` only;
  reject nested dirs with the existing hard error (document in the code
  comment).
- A reference file that itself exceeds authoring lint expectations — RULE 15
  applies to SKILL.md only; references are unconstrained, but keep them
  focused.
- Double RULE 15a firing (source + codex copy) is a known validator quirk —
  resolved here by getting under the ceiling, not by changing the validator.

## References

- Prior PR: #666 (prompt-quality pass; origin of these follow-ups)
- `plugins/yellow-review/commands/review/review-pr.md` Step 6.1 (~589), Step 7
  (~644-656), migration list (~530-538)
- `plugins/yellow-review/skills/pr-review-workflow/SKILL.md` (~135-183)
- `scripts/lib/generate/emit-codex.js` (~372-388), `scripts/validate-codex.js`
  (~194-202), `catalog/plugins/gt-workflow.json` (skillAllowlist)
- `plugins/gt-workflow/tests/gt-cleanup.bats` (9 phase/step anchors)
- `docs/solutions/code-quality/cross-plugin-shared-skill-pattern.md`;
  `docs/solutions/integration-issues/codex-skill-exposure-validator-blind-spots.md`

<!-- deepen-plan: external -->
> **Research:** Sibling-file resolution evidence:
> [openai/codex#9226](https://github.com/openai/codex/issues/9226) (open
> bug, OpenAI-engineer-confirmed repro, recurring as of 2026-06-25),
> [anthropics/claude-code#11011](https://github.com/anthropics/claude-code/issues/11011)
> (same class on Claude Code; source of the "located in this skill's
> directory" workaround phrasing),
> [Agent Skills spec](https://agentskills.io/specification) (prescribes
> relative paths, silent on host resolution mechanics),
> [Codex skills docs](https://developers.openai.com/codex/skills). No
> community prior art found for cross-host skill+references distribution.
<!-- /deepen-plan -->
