# Plan: EveryInc Merge — Remaining Work

**Source brainstorm:** `docs/brainstorms/2026-05-06-everyinc-merge-remaining-work-brainstorm.md`
**Source plans:** `plans/everyinc-merge.md` (backbone), `plans/everyinc-merge-wave3.md`
**Status:** Wave 1 + Wave 2 shipped. Wave 3: 9 of 12 items done. 3 W3 items + 2 backbone loose threads + 1 closure gate remain.

---

## Overview

Close out the EveryInc merge effort by landing the three remaining Wave 3 items, sweeping two backbone loose threads, and running the documented remote-install smoke test. The merge effort is "done" when all five PRs below land on `main` and the smoke test passes on a fresh Claude Code install.

The plan is structured as five PRs, sequenced for minimum cross-PR conflict and merge surface area:

1. **PR1 — Backbone loose threads** (BT-1 frontmatter backfill + BT-2 stub removal). Smallest scope; ships first.
2. **PR2 — W3 #7 yellow-debt scanner verification.** Most of the schema/synthesizer work already landed in main; this PR is a targeted scanner-agent audit + emission fix.
3. **PR3 — W3 #5 agent-native-reviewers + skills.** 3 new reviewers in yellow-review, 2 new skills in yellow-core, dispatch wiring.
4. **PR4 — W3 #2 yellow-docs doc-review.** 7 new review agents + 1 new command in yellow-docs.
5. **PR5 — Final closure gate.** Functional e2e smoke-test checklist + execute the install smoke test.

---

## Problem Statement

The backbone plan's checkboxes are unchecked while Waves 1 and 2 are substantially complete in code. Wave 3 has three remaining items, two of which (the largest two) require careful cross-plugin sequencing because they touch the `review-pr.md`/`review-all.md` dispatch surface that BT-2 (stub deletion) also touches. Without a sequenced plan, the three streams will conflict at the `review-*.md` files.

The closure gate — the post-Wave-3 install smoke test — has no documented functional e2e procedure today. The existing `docs/operations/release-checklist.md` Section 3 covers CLI install mechanics only. The plan adds a written functional checklist so the gate is reproducible.

---

## Proposed Solution

### Sequencing rationale

- **PR1 (loose threads) before PR3 (W3 #5):** PR1's BT-2 deletes the `code-reviewer` stub from yellow-review. The stub is named in BOTH `review-pr.md` and `review-all.md` dispatch tables. By having BT-2 remove all references during deletion, PR3's W3 #5 reviewer wiring becomes purely additive and avoids the merge conflict that would otherwise arise.
- **PR2 (W3 #7) is independent:** touches only yellow-debt scanner agents. No conflict with PR1, PR3, or PR4.
- **PR3 (W3 #5) before PR4 (W3 #2):** the 7 yellow-docs personas may reference `agent-native-architecture` / `agent-native-audit` skills that PR3 introduces in yellow-core. Conditional dependency confirmed during agent porting (grep step in PR4).
- **PR5 (smoke test) after all four:** the functional checklist exercises every Wave 3 deliverable.

### Done state for the merge effort as a whole

All five PRs merged to `main`; per-plugin tags published; smoke test sign-off recorded in `docs/operations/release-checklist.md` Section 3 (or new functional addendum).

---

## Implementation Plan

### PR1 — Backbone Loose Threads (BT-1 + BT-2)

**Branch:** `chore/everyinc-merge-backbone-loose-threads`
**Plugins touched:** yellow-review (BT-2), root scripts/docs (BT-1)
**Changeset:** `yellow-review` **major** — BT-2 deletes a published agent. Deprecation-stub policy held it for one minor; that minor has shipped. External installs cannot be audited; use `major` per the project's bump-type guide.
**Branch off:** `main`

#### Tasks

- [ ] 1.1 Sync trunk: `gt repo sync`; create branch via `gt branch create chore/everyinc-merge-backbone-loose-threads`.
- [ ] 1.2 BT-1a: manually add YAML frontmatter to the two broken files so the backfill script can later process them:
  - `docs/solutions/archived/README.md` (currently starts with `# Archived Solution Entries` and no `---` block)
  - `docs/solutions/security-issues/docs-snippet-path-traversal-and-lex-sort.md` (currently starts with `# Documentation Snippet...` and no `---` block)
  - Use the same frontmatter shape as a sibling file in `docs/solutions/<category>/`. For the archived README, use a minimal stub (`title`, `category: archived`).
- [ ] 1.3 BT-1b: run the backfill script in non-check mode:
  - `node scripts/backfill-solution-frontmatter.js`
  - Confirm 5 target files now carry `track` and/or `problem` fields:
    - `frontmatter-sweep-and-canonical-skill-drift.md`
    - `plugin-install-mcp-subcommand-smoke-test.md`
    - `shell-tool-detection-helper-pair-pattern.md`
    - `json-schema-typeof-array-bypass.md`
    - `printf-percent-b-terminal-escape-injection.md`
- [ ] 1.4 BT-1c verify: `node scripts/backfill-solution-frontmatter.js --check` exits 0.
- [ ] 1.5 BT-2a: delete `plugins/yellow-review/agents/review/code-reviewer.md`.
- [ ] 1.6 BT-2b: excise stub references from `plugins/yellow-review/commands/review/review-pr.md`. There is NO dispatch-table row to remove — `code-reviewer` is referenced only in prose. Apply 4 textual edits:
  - **Line 362:** delete the parenthetical `(or its \`code-reviewer\` deprecation stub for older installs)`. Result: `- Always include: \`project-compliance-reviewer\`, \`correctness-reviewer\`, \`maintainability-reviewer\`.`
  - **Lines 365–368:** delete the entire 3-line explanatory sentence beginning "Without `correctness-reviewer`..." through "...`code-reviewer` is now a no-op deprecation stub so projects activating the escape hatch must retain that coverage from the persona reviewers directly." Preceding sentence about always-including the three personas is sufficient.
  - **Lines 527–529:** delete `, and the \`code-reviewer\` deprecation stub` from the trailing portion of the pre-Wave-2 prose-format list (`- yellow-review own: \`pr-test-analyzer\`, \`comment-analyzer\`, \`code-simplifier\`, \`type-design-analyzer\`, \`silent-failure-hunter\`...`).
  - **Line 566:** read the surrounding context first; the same deletion pattern applies if the list repeats here.
- [ ] 1.7 BT-2c: excise stub reference from `plugins/yellow-review/commands/review/review-all.md`. NO dispatch table exists in this file — the only reference is a single phrase in a prose list. Apply 1 textual edit:
  - **Line 157:** delete the phrase `the \`code-reviewer\` deprecation stub, and ` from the parenthetical pre-Wave-2 list at Step 7 (compact-return pass 1). Result: `Pre-Wave-2 agents (\`pr-test-analyzer\`, \`comment-analyzer\`, \`type-design-analyzer\`, \`silent-failure-hunter\`, the cross-plugin reviewers \`architecture-strategist\`, ...) return legacy prose format`.
- [ ] 1.8 BT-2d verify: `git grep 'code-reviewer' plugins/yellow-review/` returns zero hits in `commands/` and `agents/`; CHANGELOG references in CHANGELOG.md are acceptable historical prose. `git grep 'yellow-review:review:code-reviewer'` returns matches ONLY in CHANGELOG files.

<!-- deepen-plan: codebase -->
> **Codebase:** Second-pass research confirmed the stub is referenced only in prose, not table rows. `review-pr.md` lines 362, 365–368, 527–529, 566 hold the references; `review-all.md` line 157 holds a single phrase reference. The earlier plan-version's "remove the stub's row" instruction was incorrect — there is no row. The 5 textual edits above are exhaustive.
<!-- /deepen-plan -->
- [ ] 1.9 Run validation gates: `pnpm validate:schemas && pnpm test:unit && pnpm lint && pnpm typecheck`.
- [ ] 1.10 Run `pnpm validate:agents` to confirm no orphan `subagent_type` strings remain after deletion.
- [ ] 1.11 WSL2 normalize any modified text files: `find docs/solutions plugins/yellow-review -name '*.md' -newer .git/HEAD -exec sed -i 's/\r$//' {} +`.
- [ ] 1.12 `pnpm changeset` — create one changeset with `yellow-review: major` (BT-2 removal). BT-1 is repo-internal docs, no changeset needed.
- [ ] 1.13 `gt commit create -m "chore: complete W2 backbone loose threads (BT-1 backfill, BT-2 stub removal)"` then `gt stack submit`.

#### Done state

- Backfill script `--check` exits 0 with no errors.
- `code-reviewer.md` deleted; zero live `subagent_type: yellow-review:review:code-reviewer` references in repo (CHANGELOG mentions allowed as historical prose).
- All validation gates green.
- Changeset present marking yellow-review as major.

---

### PR2 — W3 #7 yellow-debt scanner v2.0 emission

**Branch:** `feat/yellow-debt-scanner-v2-emission` (off `main`, sibling to PR1)
**Plugins touched:** yellow-debt
**Changeset:** `yellow-debt` **minor** — schema change is backward-compat via dual-read in audit-synthesizer; existing `.debt/scanner-output/*.json` files do not break on re-encounter.
**Scope reduction from brainstorm:** repo-research confirmed the v2.0 schema is already documented in `plugins/yellow-debt/skills/debt-conventions/SKILL.md` (line 23 onward) and the audit-synthesizer dual-read logic is already in `plugins/yellow-debt/agents/synthesis/audit-synthesizer.md` (lines 34–167). The remaining work is verifying the 5 scanner agents emit the v2.0 fields. If any scanner already does, that file is no-op.

#### Tasks

- [ ] 2.1 `gt branch create feat/yellow-debt-scanner-v2-emission` off `main`.
- [ ] 2.2 Audit-only: read each scanner's "Output Requirements" section to confirm it cites `debt-conventions` v2.0 schema. Second-pass research confirmed all 5 already do. If any has drifted, update the cite to match the canonical phrasing: `"Write results to \`.debt/scanner-output/<scanner>.json\` per the v2.0 schema in \`debt-conventions\`."` Lines verified:
  - `ai-pattern-scanner.md` line 98–99 → v2.0 ✓
  - `architecture-scanner.md` line 104–106 → v2.0 ✓
  - `complexity-scanner.md` line 123–125 → v2.0 ✓
  - `duplication-scanner.md` line 122–124 → v2.0 ✓
  - `security-debt-scanner.md` line 105–107 → v2.0 ✓
- [ ] 2.3 Confirm `failure_scenario` field guidance is present in each scanner (each currently has a multi-sentence block specifying how to construct it). If any scanner is missing this guidance, add it.
- [ ] 2.4 Re-read `plugins/yellow-debt/skills/debt-conventions/SKILL.md` end-to-end. If the v2.0 schema definition or migration mapping has any gaps relative to the scanner output references, fix in this PR. Otherwise no edit.
- [ ] 2.5 Audit `audit-synthesizer.md` — no edits expected; it already dual-reads. Confirm by reading lines 34–167.

<!-- deepen-plan: codebase -->
> **Codebase:** `audit-synthesizer.md` line 39–48 confirms the dual-read uses an explicit `schema_version` field check (`"2.0"` pass-through; `"1.0"` or missing → migrate). Migration mappings: `finding` ← `description ? title + ": " + description : title` (line 42), `fix` ← `suggested_remediation` (line 43), `failure_scenario` ← `null` (line 44), `file` ← first entry of `affected_files[]` (line 57). No deprecation date or v1.0 removal trigger is documented; line 140 mentions "the bump for v1.0-stamped records expires when the transition window closes" without a date. PR2 scope (scanner-emission only, no synthesizer edits) is correct.
<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->
> **Codebase:** Second-pass research confirmed all 5 scanner agents already cite the v2.0 schema in `debt-conventions` and require `failure_scenario`. Per-file references: `ai-pattern-scanner.md` line 98–99, `architecture-scanner.md` line 104–106, `complexity-scanner.md` line 123–125, `duplication-scanner.md` line 122–124, `security-debt-scanner.md` line 105–107. PR2 may be a near-no-op — the realistic remaining work is potentially: (a) audit the SKILL.md itself for completeness, (b) a docs-only changeset, or (c) reduction of PR2 scope to confirmation-only and folding it into another PR. If audit confirms zero drift, PR2 may be marked done-on-arrival and skipped entirely.
<!-- /deepen-plan -->
- [ ] 2.6 If audit confirms zero scanner drift AND zero SKILL.md gaps, PR2 may be marked done-on-arrival and skipped. Document this in the PR description and proceed to PR3. No synthetic test fixture is in scope.
- [ ] 2.7 Run validation: `pnpm validate:schemas && pnpm test:unit && pnpm lint && pnpm typecheck && pnpm validate:agents`.
- [ ] 2.8 Run yellow-debt Bats: `cd plugins/yellow-debt && bats tests/`.
- [ ] 2.9 WSL2 normalize: `find plugins/yellow-debt -name '*.md' -newer .git/HEAD -exec sed -i 's/\r$//' {} +`.
- [ ] 2.10 `pnpm changeset` — `yellow-debt: minor`.
- [ ] 2.11 `gt commit create -m "feat(yellow-debt): scanner agents emit v2.0 schema fields"` then `gt stack submit`.

#### Done state

- All 5 scanner agents emit `finding`, `file`, `failure_scenario`, `confidence` per the v2.0 schema documented in `debt-conventions/SKILL.md`.
- `audit-synthesizer` already-dual-reads logic remains intact; no changes.
- Validation gates + Bats green.
- Changeset present.

---

### PR3 — W3 #5 agent-native-reviewers + skills

**Branch:** `feat/agent-native-reviewers` (off `main`, sibling to PR1/PR2 unless conflicts emerge)
**Plugins touched:** yellow-review, yellow-core
**Changesets:** TWO required (one per package). Run `pnpm changeset` interactively; select both `yellow-review` (minor — new agents) and `yellow-core` (minor — new skills) in the same invocation. Common mistake: a single-package changeset will fail validation.

#### Tasks

- [ ] 3.1 `gt branch create feat/agent-native-reviewers` off `main` (sibling unless PR1/PR2 conflict-flagged).
- [ ] 3.2 Port the 3 upstream CE reviewer agents into yellow-review:
  - Source: `RESEARCH/upstream-snapshots/e5b397c9d1883354f03e338dd00f98be3da39f9f/plugins/compound-engineering/agents/`
  - `ce-cli-readiness-reviewer.agent.md` (73 lines) → `plugins/yellow-review/agents/review/cli-readiness-reviewer.md`
  - `ce-cli-agent-readiness-reviewer.agent.md` (417 lines, largest) → `plugins/yellow-review/agents/review/agent-cli-readiness-reviewer.md`
  - `ce-agent-native-reviewer.agent.md` (181 lines) → `plugins/yellow-review/agents/review/agent-native-reviewer.md`
- [ ] 3.3 For each ported agent, conform to repo authoring rules:
  - Frontmatter: `tools: [Read, Grep, Glob]` (review-agents must be read-only — `Bash`/`Write`/`Edit` prohibited at `agents/review/*` per validate-agent-authoring.js).
  - `name:` exactly matches the file basename without `.md`.
  - `description:` single-line including a "Use when..." trigger clause.
  - Migrate any 2-segment `subagent_type` references found in the upstream body to 3-segment form.
  - Replace any `BASH_SOURCE` references with `${CLAUDE_PLUGIN_ROOT}` (validator hard-errors otherwise).
  - Wrap any untrusted-input handling in security fencing per AGENTS.md lines 219–226.

<!-- deepen-plan: codebase -->
> **Codebase:** All 3 upstream yellow-review CE agents (`ce-cli-readiness-reviewer.agent.md` line 5, `ce-cli-agent-readiness-reviewer.agent.md` line 5, `ce-agent-native-reviewer.agent.md` line 5) carry `tools: Read, Grep, Glob, Bash` in their frontmatter. Stripping `Bash` is a definite action on every file, not conditional — `agents/review/*` prohibits `Bash` per `scripts/validate-agent-authoring.js`. None of the 3 contains `subagent_type` references, `BASH_SOURCE` references, or folded-scalar descriptions — those conformance steps are no-ops for these specific files.
<!-- /deepen-plan -->
- [ ] 3.4 Create the 2 new yellow-core skills:
  - `plugins/yellow-core/skills/agent-native-architecture/SKILL.md`
  - `plugins/yellow-core/skills/agent-native-audit/SKILL.md`
  - Both must follow the canonical shape — read `plugins/yellow-core/skills/mcp-integration-patterns/SKILL.md` as the reference.
  - Three required headings: `## What It Does`, `## When to Use`, `## Usage`. Subsections inside `## Usage` use `###`.
  - Frontmatter: `user-invokable: false` (with `k`, not `c`); single-line `description`.
- [ ] 3.5 Wire the 3 new reviewers into `review-pr.md`'s dispatch table ONLY. `review-all.md` requires NO edit (the new reviewers are Wave 2 compact-return emitters, so they do not appear in `review-all.md`'s pre-Wave-2 prose list).
  - **`review-pr.md`:** add 3 rows to the conditional reviewer table at lines 319–334. Use IDENTICAL trigger globs to the existing `plugin-contract-reviewer` row at line 327: `Diff touches \`plugins/*/.claude-plugin/plugin.json\`, \`plugins/*/agents/**/*.md\`, \`plugins/*/commands/**/*.md\`, \`plugins/*/skills/**/SKILL.md\`, \`plugins/*/hooks/\``. Co-firing all 4 reviewers on plugin-authoring diffs is intentional — concerns are disjoint (contract-reviewer asks "does this rename break callers?"; the 3 new reviewers ask "is this new file correctly structured?").
  - **`review-all.md`:** no edit. The file delegates persona dispatch to `review-pr.md` by reference (line ~75 HTML comment + step 4 "mirrors review-pr.md Step 4" prose). The 3 new reviewers will be Wave 2 compact-return emitters, so they do NOT appear in line 157's pre-Wave-2 list.
  - Each row's `subagent_type` literal MUST be 3-segment matching the agent `name:`: `yellow-review:review:cli-readiness-reviewer`, `yellow-review:review:agent-cli-readiness-reviewer`, `yellow-review:review:agent-native-reviewer`.

<!-- deepen-plan: codebase -->
> **Codebase:** Second-pass research definitively settled the dispatch wiring: (a) `review-all.md` has NO inline dispatch table — it delegates by reference. The 3 new Wave 2 reviewers do not appear in any prose list there, so the file requires NO edit in PR3. (b) `plugin-contract-reviewer` and the 3 new reviewers share IDENTICAL trigger globs intentionally — their concerns are disjoint (renames-breaking-callers vs. structurally-correct-new-files). Co-firing 4 reviewers on the same diff is cheap and the dedup pipeline does not merge them by category. (c) `reviewer_set.exclude` config gives operators per-reviewer suppression if needed. Earlier plan draft's "add same rows to mirror table in review-all.md" was based on a misread; it would have introduced bogus content.
<!-- /deepen-plan -->
- [ ] 3.6 Update plugin docs (no plugin.json edits — auto-discovery handles new agents/skills):
  - `plugins/yellow-review/CLAUDE.md` and `plugins/yellow-review/README.md` — bump reviewer agent count, add 3 rows to the agent table.
  - `plugins/yellow-core/CLAUDE.md` and `plugins/yellow-core/README.md` — bump skill count (currently 16 → 18), add 2 rows to the skill table.
- [ ] 3.7 Run `pnpm validate:agents` and grep all new files for any 2-segment `subagent_type` patterns: `grep -rE '"[a-z-]+:[a-z-]+"' plugins/yellow-review/agents/review/ plugins/yellow-core/skills/agent-native-*/` — fix any matches before committing.
- [ ] 3.8 Run validation: `pnpm validate:schemas && pnpm test:unit && pnpm lint && pnpm typecheck && pnpm validate:agents`.
- [ ] 3.9 Run yellow-review Bats: `cd plugins/yellow-review && bats tests/`.
- [ ] 3.10 WSL2 normalize: `find plugins/yellow-review plugins/yellow-core -name '*.md' -newer .git/HEAD -exec sed -i 's/\r$//' {} +`.
- [ ] 3.11 `pnpm changeset` — interactive; select BOTH `yellow-review: minor` AND `yellow-core: minor` in the same changeset entry.
- [ ] 3.12 `gt commit create -m "feat: agent-native-reviewers + authoring skills"` then `gt stack submit`.

#### Done state

- 3 new reviewer agents in yellow-review, all read-only, all 3-segment subagent_type-compliant.
- 2 new skills in yellow-core, three-heading-compliant.
- Both `review-pr.md` and `review-all.md` dispatch tables list the new reviewers identically.
- Validation gates + Bats green.
- One changeset spanning yellow-review (minor) AND yellow-core (minor).

---

### PR4 — W3 #2 yellow-docs doc-review

**Branch:** `feat/yellow-docs-doc-review` (off `main`; if W3 #5 cross-references confirmed in step 4.3, branch off PR3 instead)
**Plugins touched:** yellow-docs (only)
**Changeset:** `yellow-docs: minor` — additive new agents and command.

#### Tasks

- [ ] 4.1 Branch off `main` directly. Second-pass research confirmed zero cross-references from the 7 upstream CE persona files to `agent-native-architecture` / `agent-native-audit`. PR4 has no dependency on PR3.

<!-- deepen-plan: codebase -->
> **Codebase:** Second-pass research ran `grep -lE 'agent-native-(architecture|audit)' RESEARCH/upstream-snapshots/.../ce-{coherence,design-lens,feasibility,product-lens,scope-guardian,security-lens,adversarial-document}-reviewer.agent.md` — zero matches. PR4 may proceed independently of PR3.
<!-- /deepen-plan -->
- [ ] 4.2 Create the new directory: `mkdir -p plugins/yellow-docs/agents/review`.
- [ ] 4.3 Port the 7 upstream CE persona agents:
  - Source: `RESEARCH/upstream-snapshots/e5b397c9d1883354f03e338dd00f98be3da39f9f/plugins/compound-engineering/agents/`
  - `ce-coherence-reviewer.agent.md` (57) → `plugins/yellow-docs/agents/review/coherence-reviewer.md`
  - `ce-design-lens-reviewer.agent.md` (48) → `design-lens-reviewer.md`
  - `ce-feasibility-reviewer.agent.md` (44) → `feasibility-reviewer.md`
  - `ce-product-lens-reviewer.agent.md` (72) → `product-lens-reviewer.md`
  - `ce-scope-guardian-reviewer.agent.md` (56) → `scope-guardian-reviewer.md`
  - `ce-security-lens-reviewer.agent.md` (40) → `security-lens-reviewer.md`
  - `ce-adversarial-document-reviewer.agent.md` (91) → `adversarial-document-reviewer.md`
- [ ] 4.4 Apply repo authoring conformance to each (same checklist as 3.3):
  - `tools: [Read, Grep, Glob]` only (read-only review agents).
  - `name:` matches basename; single-line `description:` with "Use when..." trigger.
  - 3-segment `subagent_type` literals where the agent is referenced: `yellow-docs:review:<name>`.
  - Migrate `BASH_SOURCE` → `${CLAUDE_PLUGIN_ROOT}`.
  - Security fencing for any untrusted-input handling.

<!-- deepen-plan: codebase -->
> **Codebase:** `ce-coherence-reviewer.agent.md` line 5 (representative of all 7 yellow-docs upstream agents) carries `tools: Read, Grep, Glob, Bash`. Stripping `Bash` is a definite action on every file, not conditional. The sample agent has no `subagent_type` references in its body (returns JSON, no Task spawn) and no `BASH_SOURCE` — those conformance steps are likely no-ops for the other 6 as well, but verify per file before committing.
<!-- /deepen-plan -->
- [ ] 4.5 Create the new `/docs:review` command at `plugins/yellow-docs/commands/docs/review.md`. Mirror the orchestration pattern from `plugins/yellow-review/commands/review/review-pr.md`:
  - Learnings pre-pass.
  - Confidence rubric — INTEGER anchors `{0, 25, 50, 75, 100}` matching `RESEARCH/upstream-snapshots/.../confidence-rubric.md` (NOT the yellow-debt decimal rubric).
  - Compact return format.
  - Graceful degradation (skip persona if subagent_type unresolved).
  - Dispatch all 7 personas via `Task` tool with `subagent_type` 3-segment literals.
  - `allowed-tools:` must include every tool used in the body, including `Task`.
- [ ] 4.6 Update yellow-docs documentation:
  - `plugins/yellow-docs/CLAUDE.md` — bump agent count (3 → 10), bump command count (5 → 6), add a "Review" subsection under Agents listing the 7 new agents, add a `/docs:review` row to the "When to Use" table.
  - `plugins/yellow-docs/README.md` — same pattern: counts + new agent table + new command row.
  - No plugin.json edit — auto-discovery handles new agents and command.
- [ ] 4.7 Run `pnpm validate:agents` and grep new files for any 2-segment `subagent_type`. Run `grep -rE '"[a-z-]+:[a-z-]+"' plugins/yellow-docs/agents/review/ plugins/yellow-docs/commands/docs/review.md` — fix any matches.
- [ ] 4.8 Synthetic acceptance: invoke `/yellow-docs:docs:review docs/brainstorms/<sample>.md` against any sample brainstorm doc — confirm at least one finding per persona returned in the standard schema.
- [ ] 4.9 Run validation: `pnpm validate:schemas && pnpm test:unit && pnpm lint && pnpm typecheck && pnpm validate:agents`.
- [ ] 4.10 WSL2 normalize: `find plugins/yellow-docs -name '*.md' -newer .git/HEAD -exec sed -i 's/\r$//' {} +`.
- [ ] 4.11 `pnpm changeset` — `yellow-docs: minor`.
- [ ] 4.12 `gt commit create -m "feat(yellow-docs): doc-review command + 7 reviewer personas"` then `gt stack submit`.

#### Done state

- `plugins/yellow-docs/agents/review/` directory exists with 7 read-only persona agents.
- `/docs:review` command dispatches all 7 with 3-segment subagent_type literals.
- yellow-docs CLAUDE.md/README updated (counts, Review subsection, When-to-Use table row).
- Validation gates green.
- Changeset present.

---

### PR5 — Final Closure Gate (functional smoke test)

**Branch:** `chore/everyinc-merge-closure-smoke-test` (off `main`, after PR1–PR4 all merged)
**Plugins touched:** docs-only (root `docs/operations/`)
**Changeset:** none required (docs-only, not in `plugins/*/`).

#### Tasks

- [ ] 5.1 Wait for PR1–PR4 to all merge to `main`. Run `gt repo sync` and create branch.
- [ ] 5.2 Author `docs/operations/post-w3-functional-smoke-test.md` (or extend `release-checklist.md` Section 3 with a new "Section 3.5 — Wave 3 functional acceptance" subsection). Document explicitly:
  - **Pre-requisites:** fresh Claude Code instance (uninstall existing `yellow-plugins` marketplace entries first).
  - **Install step:** `/plugin marketplace add KingInYellows/yellow-plugins`.
  - **Functional checks** (mirror Section 3's `### N.N` heading + `**Objective**:` line + checkbox-list-with-bash format):
    - `/yellow-review:review:pr <PR#>` runs end-to-end (no stack traces, returns persona findings, exits clean).
    - `/yellow-docs:docs:review <doc-path>` runs end-to-end on a sample brainstorm (returns persona findings).
    - `/yellow-debt:debt:audit` runs end-to-end on a synthetic small repo (returns scanner output with v2.0 schema fields).
    - The 3 new yellow-review reviewers (`cli-readiness-reviewer`, `agent-cli-readiness-reviewer`, `agent-native-reviewer`) auto-trigger on a PR diff that touches `plugins/<x>/agents/`.
  - **Sign-off template** (reuse verbatim from `release-checklist.md` Section 3 "Smoke Test Sign-Off"): `**Reviewer**: ___ **Date**: ___ **Platforms Tested**: ☐ macOS ☐ Linux ☐ WSL **Test Evidence Path**: ...`
  - **Test matrix table** (mirror Section 3.1 format): `| Platform | review:pr | docs:review | debt:audit | auto-trigger | Evidence Path | Notes |` with PASS/FAIL cells per platform row.

<!-- deepen-plan: codebase -->
> **Codebase:** `docs/operations/release-checklist.md` Section 3 already provides the canonical sign-off block format (`**Reviewer**: ___ **Date**: ___ **Platforms Tested**: ☐ macOS ☐ Linux ☐ WSL **Test Evidence Path**: ...`) and the test-matrix table format. Reuse verbatim — do not invent a new sign-off shape. No other functional e2e checklist exists in the repo (`docs/release/` does not exist, no `docs/manual-*.md` files). Bats tests exist but cover scripts, not plugin invocation. Section 3.5 inline addendum to release-checklist.md is the correct path; new top-level file is unnecessary.
<!-- /deepen-plan -->
- [ ] 5.3 Execute the smoke test on a clean Claude Code install. Record results in the sign-off block.
- [ ] 5.4 If any check fails, file a follow-up bug; the smoke-test PR remains open until the failure is resolved or formally deferred.
- [ ] 5.5 Run validation: `pnpm validate:schemas && pnpm lint && pnpm typecheck` (no plugin changes; minimal gates).
- [ ] 5.6 WSL2 normalize: `sed -i 's/\r$//' docs/operations/post-w3-functional-smoke-test.md` (or the modified release-checklist.md).
- [ ] 5.7 `gt commit create -m "docs(operations): post-W3 functional smoke test checklist + sign-off"` then `gt stack submit`.

#### Done state

- Functional smoke-test checklist written and committed.
- Smoke test executed; sign-off recorded; all checks green.
- The merge effort is closed.

---

## Technical Specifications

### Files to Create

| File | PR | Purpose |
|---|---|---|
| `plugins/yellow-review/agents/review/cli-readiness-reviewer.md` | 3 | New reviewer agent (CLI readiness) |
| `plugins/yellow-review/agents/review/agent-cli-readiness-reviewer.md` | 3 | New reviewer agent (agent-CLI bridge readiness) |
| `plugins/yellow-review/agents/review/agent-native-reviewer.md` | 3 | New reviewer agent (agent-native architecture) |
| `plugins/yellow-core/skills/agent-native-architecture/SKILL.md` | 3 | New skill (architecture patterns) |
| `plugins/yellow-core/skills/agent-native-audit/SKILL.md` | 3 | New skill (audit checklist) |
| `plugins/yellow-docs/agents/review/<7 files>.md` | 4 | 7 doc-review persona agents |
| `plugins/yellow-docs/commands/docs/review.md` | 4 | `/docs:review` orchestrator command |
| `docs/operations/post-w3-functional-smoke-test.md` | 5 | Functional smoke-test checklist (or addendum to release-checklist.md) |

### Files to Modify

| File | PR | Change |
|---|---|---|
| `docs/solutions/archived/README.md` | 1 | Add YAML frontmatter (manual) |
| `docs/solutions/security-issues/docs-snippet-path-traversal-and-lex-sort.md` | 1 | Add YAML frontmatter (manual) |
| `docs/solutions/<5 files>.md` | 1 | `track`/`problem` fields added by backfill script |
| `plugins/yellow-review/commands/review/review-pr.md` | 1, 3 | PR1: remove code-reviewer row; PR3: add 3 new rows |
| `plugins/yellow-review/commands/review/review-all.md` | 1, 3 | PR1: remove code-reviewer row; PR3: add 3 new rows (mirror) |
| `plugins/yellow-debt/agents/scanners/<5 scanner files>.md` | 2 | Verify/update v2.0 schema emission |
| `plugins/yellow-review/CLAUDE.md` and `README.md` | 3 | Bump agent count, add table rows |
| `plugins/yellow-core/CLAUDE.md` and `README.md` | 3 | Bump skill count (16 → 18), add table rows |
| `plugins/yellow-docs/CLAUDE.md` and `README.md` | 4 | Counts + Review subsection + /docs:review row |

### Files to Delete

| File | PR | Reason |
|---|---|---|
| `plugins/yellow-review/agents/review/code-reviewer.md` | 1 | BT-2: deprecation stub removal (gating minor version has shipped) |

### Plugin manifests

NO plugin.json edits required for any PR. yellow-review, yellow-core, yellow-docs all use directory-based auto-discovery for agents/skills/commands.

### Confidence rubrics — two distinct systems

These rubrics are deliberately separate; do not conflate.

| System | File | Format | Gate |
|---|---|---|---|
| yellow-debt scanners | `plugins/yellow-debt/agents/synthesis/audit-synthesizer.md` lines 94–99 | Decimal `[0.0, 1.0]` | Per-category: security/architecture 0.80, complexity/duplication 0.70, ai-pattern 0.60 |
| yellow-review / yellow-docs personas | `RESEARCH/upstream-snapshots/.../confidence-rubric.md` | Integer anchors `{0, 25, 50, 75, 100}` | Suppress `< 75` except P0 at `≥ 50` |

---

## Validation Strategy

Per-PR baseline: `pnpm validate:schemas && pnpm test:unit && pnpm lint && pnpm typecheck`.

Additional gates per PR:

- **PR1:** `pnpm validate:agents` (orphan subagent_type detection); `node scripts/backfill-solution-frontmatter.js --check` exits 0.
- **PR2:** `pnpm validate:agents`; `cd plugins/yellow-debt && bats tests/`.
- **PR3:** `pnpm validate:agents`; `cd plugins/yellow-review && bats tests/`; manual grep for 2-segment `subagent_type` strings.
- **PR4:** `pnpm validate:agents`; manual grep for 2-segment `subagent_type` strings; smoke-fire `/docs:review` against a sample doc.
- **PR5:** functional smoke test executed on a clean Claude Code install; sign-off block filled in.

---

## Edge Cases & Risks

- **BT-2 changeset type:** must be `major` (deletion of published agent), even though zero live dispatch references exist in this repo. External installs cannot be audited.
- **Stub-deletion sequencing:** PR1 must remove the stub from BOTH `review-pr.md` AND `review-all.md` before PR3's additive wiring runs, or PR3 will face a merge conflict + leave a dangling reference.
- **PR3 ↔ PR4 cross-skill reference:** if any of the 7 yellow-docs persona agents reference `agent-native-architecture` / `agent-native-audit` skills, PR4 must branch off PR3, not main. Step 4.1 includes the grep check.
- **Two-package changeset for PR3:** `pnpm changeset` must list BOTH yellow-review and yellow-core. Single-package changeset will fail downstream version-sync validation.
- **WSL2 CRLF:** every newly-created `.md` file must be normalized via `sed -i 's/\r$//'` before commit. Files survive `pnpm lint` with CRLF but break merge later.
- **2-segment subagent_type drift:** CE upstream snapshots may use 2-segment names. After porting any agent, grep the file for `subagent_type:` patterns matching `^[a-z-]+:[a-z-]+$` (no third colon-segment) and fix.
- **Smoke-test failure:** if any check in PR5 fails, do NOT merge PR5. File a follow-up; merge effort remains open until resolved.

---

## Acceptance Criteria

1. PR1 merged: backfill `--check` exits 0; `code-reviewer.md` deleted; zero live `subagent_type` references; yellow-review changeset is major.
2. PR2 merged: 5 yellow-debt scanner agents emit v2.0 schema fields; audit-synthesizer dual-read intact.
3. PR3 merged: 3 new yellow-review reviewers + 2 new yellow-core skills present; `review-pr.md` and `review-all.md` mirror each other; one changeset spans both plugins.
4. PR4 merged: `plugins/yellow-docs/agents/review/` directory + 7 personas + `/docs:review` command live; CLAUDE.md/README updated.
5. PR5 merged: functional smoke-test checklist authored; smoke test executed and signed off.

---

## References

- Brainstorm: `docs/brainstorms/2026-05-06-everyinc-merge-remaining-work-brainstorm.md`
- Backbone plan: `plans/everyinc-merge.md` (W2.0a, code-reviewer stub annotations)
- Wave 3 plan: `plans/everyinc-merge-wave3.md` (W3 #7, #5, #2 source tasks)
- Authoring rules: `AGENTS.md`, `scripts/validate-agent-authoring.js`
- Manifest rules: `scripts/validate-plugin.js` (userConfig, hooks)
- Versioning: `docs/CLAUDE.md` (bump-type guide)
- Smoke-test prior art: `docs/operations/release-checklist.md` Section 3
- Confidence rubrics:
  - yellow-debt: `plugins/yellow-debt/agents/synthesis/audit-synthesizer.md` lines 94–99
  - personas: `RESEARCH/upstream-snapshots/e5b397c9d1883354f03e338dd00f98be3da39f9f/confidence-rubric.md`
- Upstream snapshots: `RESEARCH/upstream-snapshots/e5b397c9d1883354f03e338dd00f98be3da39f9f/plugins/compound-engineering/agents/`

---

## Stack Decomposition

<!-- stack-topology: linear -->
<!-- stack-trunk: main -->

### 1. agent/chore/everyinc-merge-backbone-loose-threads
- **Type:** chore
- **Description:** complete W2 backbone loose threads (BT-1 backfill + BT-2 stub removal)
- **Scope:** docs/solutions/archived/README.md, docs/solutions/security-issues/docs-snippet-path-traversal-and-lex-sort.md, docs/solutions/<5 files>, plugins/yellow-review/agents/review/code-reviewer.md (delete), plugins/yellow-review/commands/review/review-pr.md, plugins/yellow-review/commands/review/review-all.md
- **Tasks:** 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.13
- **Depends on:** (none)

### 2. agent/feat/agent-native-reviewers
- **Type:** feat
- **Description:** agent-native-reviewers + authoring skills (yellow-review + yellow-core)
- **Scope:** plugins/yellow-review/agents/review/cli-readiness-reviewer.md (new), plugins/yellow-review/agents/review/agent-cli-readiness-reviewer.md (new), plugins/yellow-review/agents/review/agent-native-reviewer.md (new), plugins/yellow-core/skills/agent-native-architecture/SKILL.md (new), plugins/yellow-core/skills/agent-native-audit/SKILL.md (new), plugins/yellow-review/commands/review/review-pr.md, plugins/yellow-review/CLAUDE.md, plugins/yellow-review/README.md, plugins/yellow-core/CLAUDE.md, plugins/yellow-core/README.md
- **Tasks:** 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12
- **Depends on:** #1

### 3. agent/feat/yellow-debt-scanner-v2-emission
- **Type:** feat
- **Description:** yellow-debt scanner agents emit v2.0 schema fields (audit-only; potentially done-on-arrival)
- **Scope:** plugins/yellow-debt/agents/scanners/ai-pattern-scanner.md, plugins/yellow-debt/agents/scanners/architecture-scanner.md, plugins/yellow-debt/agents/scanners/complexity-scanner.md, plugins/yellow-debt/agents/scanners/duplication-scanner.md, plugins/yellow-debt/agents/scanners/security-debt-scanner.md, plugins/yellow-debt/skills/debt-conventions/SKILL.md
- **Tasks:** 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11
- **Depends on:** #2

### 4. agent/feat/yellow-docs-doc-review
- **Type:** feat
- **Description:** yellow-docs doc-review command + 7 reviewer personas
- **Scope:** plugins/yellow-docs/agents/review/ (new directory), plugins/yellow-docs/agents/review/coherence-reviewer.md (new), plugins/yellow-docs/agents/review/design-lens-reviewer.md (new), plugins/yellow-docs/agents/review/feasibility-reviewer.md (new), plugins/yellow-docs/agents/review/product-lens-reviewer.md (new), plugins/yellow-docs/agents/review/scope-guardian-reviewer.md (new), plugins/yellow-docs/agents/review/security-lens-reviewer.md (new), plugins/yellow-docs/agents/review/adversarial-document-reviewer.md (new), plugins/yellow-docs/commands/docs/review.md (new), plugins/yellow-docs/CLAUDE.md, plugins/yellow-docs/README.md
- **Tasks:** 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12
- **Depends on:** #3

### 5. agent/chore/everyinc-merge-closure-smoke-test
- **Type:** chore
- **Description:** post-W3 functional smoke test checklist + sign-off execution
- **Scope:** docs/operations/release-checklist.md (extend with Section 3.5)
- **Tasks:** 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
- **Depends on:** #4

> **Note on linearization:** The body's PR labels (PR1–PR5) are the original mixed-topology numbering. Stack item numbers above (1–5) are the linear execution order. The `Tasks:` field is the source-of-truth mapping from a stack item to body tasks. Items 3 (yellow-debt) and 4 (yellow-docs) don't structurally depend on items 2 and 3 respectively — they're stacked here purely so `/workflows:work` can execute the linear chain. Practical impact: zero (Graphite stacks merge bottom-up; once item 1 lands, items 2–5 rebase cleanly).
