# Feature: Model Selection & Effort Frontmatter Rollout

## Overview

Add explicit `model:` and `effort:` frontmatter to ~30 yellow-plugins agents,
delivered as a 5-PR Graphite stack, plus 4 lint rules (V1–V4) in
`scripts/validate-agent-authoring.js` to prevent the inheritance trap from
silently reappearing. No schema changes required — all fields are already in
the canonical subagent frontmatter catalog.

**Source brainstorm:**
`docs/brainstorms/2026-05-08-research-integration-model-selection-context-optimization-brainstorm.md`

**Source research:**
`docs/research/model-selection-token-context-optimization.md`

## Problem Statement

71 of 79 agents (90%) use `model: inherit`. When a user runs `/review:pr` from
an Opus session, all dispatched reviewers inherit Opus at ~5–8× the cost of
an equivalent Sonnet invocation — for pattern-matching tasks that have no
quality ceiling above Sonnet. The yellow-docs plugin already demonstrates the
correct pattern (explicit haiku/sonnet tiering across 6 of 7 reviewers); the
rest of the system should converge on it. Without a validator gate, future
agents revert to silent inheritance.

## Proposed Solution

Five Graphite-stackable PRs, ordered by risk and coordination cost:

1. **PR 1 (Phase 1):** No-risk frontmatter additions across 6 plugins (8 agents).
2. **PR 2 (Phase 2):** yellow-debt scanners + `debt-fixer` + 2 yellow-core
   workflow agents (8 files, 2 plugins).
3. **PR 3 (Phase 3a):** yellow-review reviewer-tier downgrades (13 agents).
4. **PR 4 (Phase 3b):** yellow-core review/research/workflow personas + 2
   yellow-docs reviewers (10 files).
5. **PR 5 (Phase 4):** Validator V1–V4 rules + tests (tooling-only, no plugin
   files, no changeset).

Code quality is preserved because:
- Architectural reasoning, adversarial code analysis, and primary security
  discovery agents stay on Opus.
- Synthesizers and orchestrators get `effort: high` (added behavior, not
  reduced).
- The validator's V1/V2 enum checks are hard errors; V3/V4 advisory rules are
  warnings with exit code 0 to avoid blocking external contributors.

## Implementation Plan

### Phase 1 — PR 1: No-Risk Frontmatter Additions

Branch: `agent/feat/model-explicit-phase-1`

- [ ] 1.1: `gt branch create agent/feat/model-explicit-phase-1`
- [ ] 1.2: Edit `plugins/yellow-docs/agents/review/product-lens-reviewer.md` —
  add `model: sonnet` (insert between `description:` and `background:`)
- [ ] 1.3: Edit `plugins/yellow-council/agents/review/gemini-reviewer.md` —
  add `model: haiku` and `effort: low`
- [ ] 1.4: Edit `plugins/yellow-council/agents/review/opencode-reviewer.md` —
  add `model: haiku` and `effort: low`
- [ ] 1.5: Edit `plugins/yellow-core/agents/research/learnings-researcher.md` —
  add `model: haiku` and `effort: low`
- [ ] 1.6: Edit `plugins/yellow-ci/agents/ci/runner-assignment.md` — add
  `model: haiku` and `effort: low`
- [ ] 1.7: Edit `plugins/yellow-debt/agents/synthesis/audit-synthesizer.md` —
  add `effort: high` (model already `opus`)
- [ ] 1.8: Edit
  `plugins/yellow-research/agents/research/research-conductor.md` — add
  `effort: high` (model already `opus`)
- [ ] 1.9: Edit
  `plugins/yellow-core/agents/workflow/brainstorm-orchestrator.md` — add
  `model: sonnet` and `effort: high`
- [ ] 1.10: Run `pnpm validate:agents && pnpm validate:plugins`
- [ ] 1.11: WSL2 normalize: `for f in <edited files>; do sed -i 's/\r$//' "$f"; done`
- [ ] 1.12: `pnpm changeset` — single file, `patch` bumps for `yellow-docs`,
  `yellow-council`, `yellow-core`, `yellow-ci`, `yellow-debt`, `yellow-research`
- [ ] 1.13: `gt commit create -m "feat: add explicit model/effort to 8 phase-1 agents"`
- [ ] 1.14: `gt stack submit`

**Acceptance criteria for PR 1:**
- 8 agent files modified; 0 other plugin files touched.
- `pnpm validate:agents` passes.
- `pnpm validate:plugins` passes.
- Changeset declares 6 plugin patches in one file.
- `grep -L 'model:' <edited files>` returns empty (every edited file has
  `model:`).

### Phase 2 — PR 2: Scanners + debt-fixer + yellow-core workflow

Branch: `agent/feat/model-explicit-phase-2` (stacked on PR 1)

- [ ] 2.1: `gt branch create agent/feat/model-explicit-phase-2`
- [ ] 2.2: Edit 5 `plugins/yellow-debt/agents/scanners/{ai-pattern,complexity,duplication,architecture,security-debt}-scanner.md` —
  add `model: sonnet` and `effort: low` to each
- [ ] 2.3: Edit `plugins/yellow-debt/agents/remediation/debt-fixer.md` —
  add `model: sonnet`. Spot-check first: confirm frontmatter has no
  `isolation:` or `permissionMode:` value that would interact with the
  downgrade. (No effort field added.)
- [ ] 2.4: Edit `plugins/yellow-core/agents/workflow/knowledge-compounder.md` —
  add `model: sonnet`
- [ ] 2.5: Edit `plugins/yellow-core/agents/workflow/session-historian.md` —
  add `model: sonnet`
- [ ] 2.6: Run `pnpm validate:agents && pnpm validate:plugins`
- [ ] 2.7: WSL2 normalize edited files
- [ ] 2.8: `pnpm changeset` — **one file**, `patch` bumps for **both**
  `yellow-debt` AND `yellow-core` (mirrors PR A-01 precedent from 2026-05-07)
- [ ] 2.9: `gt commit create -m "feat: tier yellow-debt scanners and yellow-core workflow agents"`
- [ ] 2.10: `gt stack submit`

**Acceptance criteria for PR 2:**
- 8 files modified across 2 plugins.
- Changeset declares both `yellow-debt: patch` and `yellow-core: patch`.
- `validate-versions.js` passes (would fail if either changeset entry
  missing).
- `debt-fixer` frontmatter spot-check: tools list is `[Read, Edit, Write,
  Bash, AskUserQuestion]`-compatible; no Opus-tier-only tools present.

### Phase 3 — PR 3 (Phase 3a): yellow-review reviewer tier

Branch: `agent/feat/model-explicit-phase-3a` (stacked on PR 2)

- [ ] 3.1: `gt branch create agent/feat/model-explicit-phase-3a`
- [ ] 3.2: Edit 13 yellow-review agents — add `model: sonnet`:
  - `correctness-reviewer.md`
  - `maintainability-reviewer.md`
  - `project-standards-reviewer.md`
  - `project-compliance-reviewer.md`
  - `reliability-reviewer.md`
  - `silent-failure-hunter.md`
  - `pr-test-analyzer.md`
  - `comment-analyzer.md`
  - `type-design-analyzer.md`
  - `code-simplifier.md`
  - `plugin-contract-reviewer.md`
  - `cli-readiness-reviewer.md`
  - `agents/workflow/pr-comment-resolver.md`
- [ ] 3.3: Run `pnpm validate:agents && pnpm validate:plugins`
- [ ] 3.4: WSL2 normalize edited files
- [ ] 3.5: `pnpm changeset` — single `patch` bump for `yellow-review`
- [ ] 3.6: `gt commit create -m "feat(yellow-review): tier 13 reviewer agents to sonnet"`
- [ ] 3.7: `gt stack submit`

**Acceptance criteria for PR 3:**
- 13 files modified, all in `plugins/yellow-review/agents/`.
- Changeset declares `yellow-review: patch` only.
- Verification: `grep -c 'model: sonnet' plugins/yellow-review/agents/review/*.md`
  returns 12; `grep -c 'model: sonnet' plugins/yellow-review/agents/workflow/*.md`
  returns 1 (pr-comment-resolver).

### Phase 4 — PR 4 (Phase 3b): yellow-core personas + yellow-docs reviewers

Branch: `agent/feat/model-explicit-phase-3b` (stacked on PR 3)

**Actual file-touch count: 10 files** (8 yellow-core + 2 yellow-docs). The
brainstorm's Phase 3 table additionally lists 3 yellow-core "stays on opus"
rows and 3 yellow-docs already-correct siblings — those are documentation
confirmations, not edits.

- [ ] 4.1: `gt branch create agent/feat/model-explicit-phase-3b`
- [ ] 4.2: Edit 8 yellow-core agents — add `model: sonnet`:
  - `agents/review/code-simplicity-reviewer.md`
  - `agents/review/pattern-recognition-specialist.md`
  - `agents/review/test-coverage-analyst.md`
  - `agents/review/polyglot-reviewer.md`
  - `agents/review/security-lens.md`
  - `agents/review/security-reviewer.md`
  - `agents/review/performance-reviewer.md`
  - `agents/workflow/spec-flow-analyzer.md`
- [ ] 4.3: Edit `plugins/yellow-docs/agents/review/feasibility-reviewer.md` —
  add `model: sonnet`
- [ ] 4.4: Edit
  `plugins/yellow-docs/agents/review/adversarial-document-reviewer.md` — add
  `model: sonnet` and `effort: high`
- [ ] 4.5: Run `pnpm validate:agents && pnpm validate:plugins`
- [ ] 4.6: WSL2 normalize edited files
- [ ] 4.7: `pnpm changeset` — one file, `patch` bumps for `yellow-core` AND
  `yellow-docs`
- [ ] 4.8: PR description must include "Already-correct (no edit) siblings:
  `design-lens-reviewer`, `scope-guardian-reviewer`, `security-lens-reviewer`
  in `plugins/yellow-docs/agents/review/`" — closes the documentation gap
  surfaced in spec-flow analysis.
- [ ] 4.9: `gt commit create -m "feat: tier yellow-core personas and yellow-docs reviewers"`
- [ ] 4.10: `gt stack submit`

**Acceptance criteria for PR 4:**
- 10 files modified across 2 plugins.
- Changeset declares both `yellow-core: patch` and `yellow-docs: patch`.
- PR description acknowledges 3 yellow-docs siblings as already-correct.

### Phase 5 — PR 5: Validator V1–V4 + tests

Branch: `agent/feat/model-effort-validator-rules` (stacked on PR 4)

**No changeset required** — modifies only `scripts/` and
`tests/integration/`, not under `plugins/[^/]+/`.

- [ ] 5.1: `gt branch create agent/feat/model-effort-validator-rules`

#### 5a: Warnings infrastructure scaffold

- [ ] 5.2: Edit `scripts/validate-agent-authoring.js`:
  - Add `yellow: '\x1b[33m'` to the `colors` object (currently lines 40–45)
  - Add `logWarning(msg)` helper paralleling `logError`/`logInfo` — yellow
    color + `⚠ WARN:` prefix
  - Add `const warnings = [];` parallel to `const errors = [];`
  - Final reporting block: print `warnings.length` warnings (yellow) before
    `errors.length` check; exit code stays 0 if `warnings.length > 0` and
    `errors.length === 0`

#### 5b: V1 effort enum (hard error)

- [ ] 5.3: Add inside the main per-file loop:
  ```js
  const effortVal = parseScalar(frontmatter, 'effort');
  if (effortVal !== null && !['low','medium','high','xhigh','max'].includes(effortVal)) {
    errors.push(`${relPath}: invalid effort: '${effortVal}' (must be one of low|medium|high|xhigh|max)`);
  }
  ```
  **Note:** `xhigh` is included (per the canonical subagent frontmatter
  catalog, `docs/solutions/code-quality/subagent-frontmatter-field-catalog.md`
  line 46) — omitting it creates a false-error trap for any agent legitimately
  using `xhigh`.

#### 5c: V2 model enum (hard error)

- [ ] 5.4: Add inside the main per-file loop:
  ```js
  const modelVal = parseScalar(frontmatter, 'model');
  if (modelVal !== null && !/^(haiku|sonnet|opus|inherit)(-\d+(-\d+)?)?$/.test(modelVal)) {
    errors.push(`${relPath}: invalid model: '${modelVal}' (must match ^(haiku|sonnet|opus|inherit)(-\\d+(-\\d+)?)?$)`);
  }
  ```
  Versioned IDs like `sonnet-4-5`, `opus-4-7`, `haiku-4-5` are valid;
  arbitrary suffixes like `sonnet-invalid` are rejected.

#### 5d: V3 inheritance advisory (warning) — with shared allowlist

- [ ] 5.5: Add a `MODEL_RULE_ALLOWLIST` constant near the top of the file:
  ```js
  // Files exempt from V3/V4 advisory warnings — intentional inheritance.
  const MODEL_RULE_ALLOWLIST = new Set([
    'plugins/yellow-ci/agents/ci/failure-analyst.md',
    'plugins/yellow-ci/agents/ci/workflow-optimizer.md',
    'plugins/yellow-core/agents/workflow/devin-orchestrator.md',
  ]);
  ```
- [ ] 5.6: Inside the main per-file loop, after V2:
  ```js
  if (modelVal === 'inherit' && !MODEL_RULE_ALLOWLIST.has(relPath)) {
    const isScannerOrCi = relSegments.includes('scanners') ||
                          (relSegments.includes('agents') &&
                           relSegments[relSegments.indexOf('agents') + 1] === 'ci');
    if (isScannerOrCi) {
      warnings.push(`[V3 advisory] ${relPath}: model: inherit on a scanner/CI agent — consider explicit model: sonnet or model: haiku based on task complexity.`);
    }
  }
  ```

#### 5e: V4 effort:high advisory (warning) — name-field match + shared allowlist

- [ ] 5.7: Inside the main per-file loop, after V3:
  ```js
  const nameVal = parseScalar(frontmatter, 'name') || '';
  const effortHigh = effortVal === 'high' || effortVal === 'max' || effortVal === 'xhigh';
  const synthesizerName = /(synthesizer|orchestrator|conductor|aggregator|compounder)/i.test(nameVal);
  if (synthesizerName && !effortHigh && !MODEL_RULE_ALLOWLIST.has(relPath)) {
    warnings.push(`[V4 advisory] ${relPath}: synthesizer/orchestrator agent without effort: high — consider extended chain-of-thought.`);
  }
  ```
  Matches `name:` field instead of `description:` to reduce false positives
  on integration agents that mention "synthesize" or "merge" in passing.

#### 5f: Tests

- [ ] 5.8: Create `tests/integration/validate-agent-authoring-model-effort-rules.test.ts`
  with one `describe` block per rule. Pattern mirrors
  `tests/integration/validate-agent-authoring-review-rule.test.ts` —
  `VALIDATE_PLUGINS_DIR` env var, temp fixture trees, child-process
  invocation via `execFileSync`, asserts on `status` and `stdout`/`stderr`.
  Test matrix:
  - **V1:** `effort: low` passes (status 0). `effort: hight` errors (status
    nonzero, stderr contains `invalid effort`). Missing `effort:` passes.
  - **V2:** `model: sonnet` passes. `model: sonnet-4-5` passes. `model: gpt-4`
    errors. `model: sonnet-invalid` errors. Missing `model:` passes.
  - **V3:** Scanner agent with `model: inherit` → status 0, stdout contains
    `[V3 advisory]`. Scanner agent with `model: sonnet` → no V3 warning.
    `agents/ci/foo.md` with `model: inherit` → V3 warning. Allowlisted file
    (`failure-analyst.md` fixture in `agents/ci/`) → no V3 warning.
  - **V4:** Agent named `*-synthesizer` without `effort: high` → V4 warning.
    Same agent with `effort: high` → no warning. Agent with synthesizer-y
    description but plain name → no warning. Allowlisted name →
    no warning.
  - **Exit-code semantics:** Fixture with V1 error AND V3 warning → status
    nonzero (errors win), both messages appear in output.

- [ ] 5.9: Run `pnpm test:integration -- validate-agent-authoring-model-effort-rules`
- [ ] 5.10: Run full CI baseline: `pnpm validate:schemas && pnpm test:unit && pnpm lint && pnpm typecheck`
- [ ] 5.11: WSL2 normalize: `sed -i 's/\r$//' scripts/validate-agent-authoring.js tests/integration/validate-agent-authoring-model-effort-rules.test.ts`
- [ ] 5.12: `gt commit create -m "feat(validator): add V1-V4 model/effort lint rules"`
- [ ] 5.13: `gt stack submit`

**Acceptance criteria for PR 5:**
- No changeset file (validator-only PR).
- All 5 test groups pass (V1, V2, V3, V4, exit-code semantics).
- `pnpm validate:agents` against the live `plugins/` tree exits 0 with
  warnings printed but no errors (Phases 1–4 already landed correct values).
- Allowlist documents the 4 intentional exemptions (failure-analyst,
  workflow-optimizer, devin-orchestrator, knowledge-compounder).

## Technical Specifications

### Files to Modify

**Phase 1 (8 files):**
- `plugins/yellow-docs/agents/review/product-lens-reviewer.md`
- `plugins/yellow-council/agents/review/gemini-reviewer.md`
- `plugins/yellow-council/agents/review/opencode-reviewer.md`
- `plugins/yellow-core/agents/research/learnings-researcher.md`
- `plugins/yellow-ci/agents/ci/runner-assignment.md`
- `plugins/yellow-debt/agents/synthesis/audit-synthesizer.md`
- `plugins/yellow-research/agents/research/research-conductor.md`
- `plugins/yellow-core/agents/workflow/brainstorm-orchestrator.md`

**Phase 2 (8 files):**
- `plugins/yellow-debt/agents/scanners/ai-pattern-scanner.md`
- `plugins/yellow-debt/agents/scanners/complexity-scanner.md`
- `plugins/yellow-debt/agents/scanners/duplication-scanner.md`
- `plugins/yellow-debt/agents/scanners/architecture-scanner.md`
- `plugins/yellow-debt/agents/scanners/security-debt-scanner.md`
- `plugins/yellow-debt/agents/remediation/debt-fixer.md`
- `plugins/yellow-core/agents/workflow/knowledge-compounder.md`
- `plugins/yellow-core/agents/workflow/session-historian.md`

**Phase 3 (13 files):** All in `plugins/yellow-review/agents/`.
**Phase 4 (10 files):** 8 in `plugins/yellow-core/agents/`, 2 in
`plugins/yellow-docs/agents/review/`.

**Phase 5:**
- `scripts/validate-agent-authoring.js` (extend, ~50 added lines)
- `tests/integration/validate-agent-authoring-model-effort-rules.test.ts` (new)

### Frontmatter Insertion Convention

Per yellow-docs precedent
(`plugins/yellow-docs/agents/review/design-lens-reviewer.md` etc.), the field
order is:

```
---
name: <agent-name>
description: <single-line>
model: <haiku|sonnet|opus|inherit>
effort: <low|medium|high|xhigh|max>     # optional, only when set
background: <true|false>                # optional
tools: [...]
---
```

`model:` goes immediately after `description:`. `effort:` goes immediately
after `model:` (before `background:` or `tools:`).

### Dependencies

None added.

### Changeset Format

Single multi-plugin changeset per phase that touches plugin files:

```
---
"yellow-debt": patch
"yellow-core": patch
---

Tier yellow-debt scanners and yellow-core workflow agents to explicit
sonnet/effort frontmatter.
```

PR 5 (validator-only) requires NO changeset.

## Acceptance Criteria

1. Each PR's per-phase acceptance criteria (above) met.
2. After PR 5 lands, `pnpm validate:agents` against the live plugin tree
   exits 0 with optional V3/V4 warnings only on allowlisted files (none
   expected since allowlist excludes those).
3. After all 5 PRs land, `grep -rn '^model:' plugins/*/agents/ | wc -l`
   shows the expected count of explicit assignments (~30 + the 8 already
   on opus/sonnet pre-rollout = ~38).
4. No agent in the brainstorm's "no change recommended" list has been
   inadvertently modified.

## Edge Cases & Resolutions Already Decided

1. **`xhigh` effort value.** Included in V1's enum (per subagent frontmatter
   catalog). Without this, agents legitimately using `xhigh` would trigger a
   false hard-error.
2. **V2 versioned model IDs.** Validated via the regex
   `^(haiku|sonnet|opus|inherit)(-\d+(-\d+)?)?$` — accepts `sonnet-4-5`,
   `opus-4-7`, `haiku-4-5`; rejects `sonnet-invalid`, `gpt-4`, etc.
3. **V3 false positives on `failure-analyst` and `workflow-optimizer`.**
   Resolved via shared `MODEL_RULE_ALLOWLIST` — both files exempted.
4. **V4 false positives on intentional-inherit synthesizer-named agents.**
   Resolved by matching `name:` field instead of `description:`, plus
   `MODEL_RULE_ALLOWLIST` for `devin-orchestrator` (the lone post-name-narrowing
   false positive).
5. **PR ordering.** PRs 1–4 land before PR 5. Graphite stacking enforces this
   implicitly. If PR 5 were to land first, V1/V2 (hard errors) would still
   pass because pre-existing `model: inherit` and absent `effort:` are valid;
   V3/V4 (warnings) would fire on more files but exit 0 — not a CI blocker.
6. **Tool-capability risk for downgraded agents.** `debt-fixer` spot-check
   in PR 2 verifies no Opus-tier-only tool dependency. Other downgrades
   (Phase 3, Phase 4) are reviewer agents with read-only tool surfaces —
   no capability risk.
7. **Sub-agent dispatch model inheritance.** When a downgraded agent (e.g.,
   `correctness-reviewer` at sonnet) dispatches sub-agents, those sub-agents
   inherit from the dispatching agent's session, not the original parent.
   This is per-design — sub-agent assignments in this rollout are
   intentional and not affected.

## Testing Strategy

- **Per-PR:** `pnpm validate:agents && pnpm validate:plugins` after each
  edit batch.
- **PR 5:** `pnpm test:integration -- validate-agent-authoring-model-effort-rules`
  covers all 5 test groups (V1, V2, V3, V4, exit-code semantics).
- **Post-merge spot-check:** After each plugin-touching PR merges, run
  `grep -c 'model:' plugins/<plugin>/agents/**/*.md` against expected count.

**No golden-set behavioral testing.** Per brainstorm decision, model
assignments are evidence-based from the research doc. Empirical validation
of model behavior is out of scope.

## Documentation Updates

- Each plugin's `CLAUDE.md` "Known Limitations" section: NO updates required
  (model tiering is a positive default, not a limitation).
- `docs/research/model-selection-token-context-optimization.md`:
  cross-reference unchanged — already exists as the source-of-truth research
  doc.
- The 3 yellow-docs siblings (`design-lens-reviewer`,
  `scope-guardian-reviewer`, `security-lens-reviewer`) are explicitly
  acknowledged as already-correct in PR 4's description (Step 4.8) — no
  code change needed.

## Migration & Rollback

- **Migration:** None required for end users. Plugin updates flow through
  the marketplace install/update path; changes are frontmatter-only and
  take effect on next agent dispatch.
- **Rollback:** Each PR is independently revertable via `gt downstack edit` +
  delete branch, or `git revert <commit>` for landed commits. Rolling back
  any one PR restores `model: inherit` for that PR's files; no data
  migration needed.

## References

- Brainstorm:
  `docs/brainstorms/2026-05-08-research-integration-model-selection-context-optimization-brainstorm.md`
- Research:
  `docs/research/model-selection-token-context-optimization.md`
- Subagent frontmatter catalog:
  `docs/solutions/code-quality/subagent-frontmatter-field-catalog.md`
- yellow-docs tiering precedent:
  `plugins/yellow-docs/agents/review/{design-lens,scope-guardian,security-lens}-reviewer.md`
- Validator current state:
  `scripts/validate-agent-authoring.js` (parseScalar at lines 67–71;
  errors-only at line 163; exit gate at line 325)
- Test pattern:
  `tests/integration/validate-agent-authoring-review-rule.test.ts`
- Multi-plugin changeset precedent (PR A-01, 2026-05-07): see
  `plugins/yellow-review/CHANGELOG.md` lines 1–27 and
  `plugins/yellow-core/CHANGELOG.md` lines 1–20
