# Feature: PR #260 Follow-Up — Validator/Schema Hardening + Doc Sync

## Problem Statement

PR #260 (`docs/subagent-conventions`) introduces the Agent Archetypes table,
the Subagent Failure Convention, the canonical `security-fencing` skill, and
significantly expands `schemas/plugin.schema.json` (8 new top-level fields,
3 new `$defs`) plus `scripts/validate-plugin.js`. A 12-reviewer multi-agent
review of the PR surfaced **21 findings** (4 P1 + 15 P2 + 2 P3) that span
five logically distinct areas. The current PR has been hardened against
in-scope corrections; the remaining findings need a stacked-PR follow-up
because they cross 8 files and include one explicit design decision plus
two non-trivial refactors.

The cost of NOT addressing them: a real validator bypass (array-form
`hooks` skip path/shebang/`set -e` checks), a credential-exposure typo
hazard (`userConfig.additionalProperties: true` accepts `sensitiv: true`
and treats it as an unknown field), no test coverage for the validator,
stale documentation pointers, and one orchestrator command (`work.md`)
with a shell-variable isolation bug that probabilistically passes
`$RUN_DIR` literal to spawned agents.

## Current State

- **PR #260** has been review-hardened with four in-scope corrections
  (codex-reviewer 2-segment fix at line 375, Archetypes-table `model`
  Yes→Opt, template `model: claude-opus-4-6` → `inherit`, Categories
  list realigned, `security-fencing/SKILL.md` restructured with three
  required headings).
- **`scripts/validate-plugin.js`** is a standalone 629-line Node script
  with **no test harness** (no fixtures, no `*.test.js` siblings).
- **`tests/integration/validate-agent-authoring-review-rule.test.ts`** is
  the canonical Vitest fixture pattern (inline string fixtures →
  `mkdtempSync` → `execFileSync` with env override → assert on exit code
  and stderr). New validator tests mirror this verbatim.
- **`schemas/plugin.schema.json`** uses `oneOf` exclusively today — zero
  `if/then/else` constructs. AJV/JSON Schema docs explicitly recommend
  nested `if/then/else` for type-conditional `default` enforcement
  (`oneOf` has the documented "default breaks oneOf" hazard).
- **`schemas/plugin.schema.json`** declares 8 new top-level fields; **0
  of 8 are used** by any of the 16 in-repo `plugin.json` files. Decision
  taken: keep the schema fields, tighten their constraints.
- **`plugins/yellow-core/commands/workflows/work.md`** Phase 3 wires the
  RUN_DIR/result-file convention; **`plugins/yellow-review/commands/review/review-pr.md`**
  Step 5 uses TaskOutput-only collection (compact-return JSON schema).
  Decision taken: review-pr.md keeps TaskOutput; convention scope
  clarified in SKILL.md and an in-file comment.
- **`plugins/yellow-core/skills/security-fencing/SKILL.md`** consumer
  list claims 25; actual `rg -l 'CRITICAL SECURITY RULES' plugins/`
  count is **36**.
- **No in-repo plugin** uses `hooks` array form, but the validator
  bypass affects external/downstream plugins that may use it.

## Proposed Solution

Five stacked PRs on top of `docs/subagent-conventions`, each addressing
one logical cluster with a per-PR changeset. Stacking order is dictated
by hard dependencies:

1. **PR-A: Validator hardening + fixture test harness** — adds the
   missing test infrastructure first so subsequent PRs have a
   regression net.
2. **PR-B: Schema tightening (constraints + semver)** — must include
   the example-file update because tightening rejects the current
   example shape (Constraint A from spec-flow analysis).
3. **PR-C: `work.md` RUN_DIR hardening** — independent of the above;
   no shared files.
4. **PR-D: Doc sync (security-fencing count + quick-reference fix +
   SKILL.md scope clarification + review-pr.md comment)** —
   documentation-only; can land last.
5. **PR-E (optional, deferred):** if best-practices research surfaces a
   need for a separate AJV custom-keyword module (semver), it lands
   inside PR-B as a new file under `packages/infrastructure/`.

Each PR carries its own `.changeset/<slug>.md` per repo convention.
Sequencing rationale: PR-A unblocks regression testing for PR-B and
PR-C; PR-B and PR-C are independent siblings off PR-A; PR-D depends
on PR-C only because it edits `review-pr.md` after the convention
scope is clarified in the SKILL.md.

## Implementation Plan

### Phase 1: PR-A — Validator hardening + fixture test harness

**Files:** `scripts/validate-plugin.js`, new
`tests/integration/validate-plugin.test.ts`,
`.changeset/pr260-validator-hardening.md`.

- [ ] 1.1: Mirror `validate-agent-authoring-review-rule.test.ts`
      structure. Create `tests/integration/validate-plugin.test.ts`
      with `mkdtempSync` per test, `execFileSync` of
      `node scripts/validate-plugin.js` against the temp dir, and
      assertions on exit code + stderr.
- [ ] 1.2: Add fixture coverage for **current** behavior before
      changing anything (regression net): valid manifest passes,
      invalid name fails, missing version fails, hooks-string
      anti-pattern logs warning, hooks-inline-object passes.
- [ ] 1.3: Extract `hasInlineHooks(manifest)` predicate at module
      scope (lines 226, 329, 449 currently duplicated). Replace
      three call sites.
- [ ] 1.4: Extract `addError(errors, msg)` helper. Canonical message
      form is the longer one (RULE 1 currently has push: short,
      log: longer; the longer form wins). Replace pervasive
      `errors.push(msg); logError(msg);` pairs.
- [ ] 1.5: Convert `VALID_HOOK_EVENTS` from array to module-scope
      `Set<string>`. Replace `.includes()` with `.has()`.
- [ ] 1.6: Add `'SessionStart'` to `DECISION_PROTOCOL_EVENTS` Set
      (line 454). Cross-check against MEMORY.md PR #72 documented
      requirement.
- [ ] 1.7: Extract `validateHookScriptPath(scriptPath, pluginDir,
      errors)` per-script-path helper. Centralizes existence,
      `resolvePluginPath` containment, shebang, and `set -e` checks.
- [ ] 1.8: Refactor RULE 6 inline-object branch to call the new
      helper.
- [ ] 1.9: **Array-form hooks fix.** When `hooks` is an array,
      iterate elements: string elements receive
      `validateHookScriptPath` checks; object elements pass
      through (same as inline-object form). Emit a one-time
      INFO-level note: "array-form `hooks` is supported but
      undocumented — prefer inline-object form".
- [ ] 1.10: Apply `resolvePluginPath` in the string-form `hooks`
      branch (line 313). Currently only checks the known
      anti-pattern; should also catch path escape and missing files.
- [ ] 1.11: **outputStyles directory-vs-file decision.** Tighten
      RULE 5b to enforce directory-only (matches current
      validator) and update schema description in PR-B accordingly.
      Reject `.md` file paths with a clear error.
- [ ] 1.12: Add fixture tests for each new behavior: array-form
      hooks-script-paths checked, string-form hooks
      path-existence checked, outputStyles file-vs-dir error,
      addError drift fix verified by inspecting captured stderr.
- [ ] 1.13: `pnpm test:integration && pnpm validate:schemas`
      green; commit; `gt submit --no-interactive`.

**Acceptance:** `pnpm test:integration` adds ≥10 new test cases.
Existing CI baseline (`pnpm validate:schemas && pnpm test:unit &&
pnpm lint && pnpm typecheck`) green.

### Phase 2: PR-B — Schema tightening + example update

**Files:** `schemas/plugin.schema.json`,
`examples/plugin-extended.example.json`,
`packages/infrastructure/src/validation/keywords/semverRange.ts`
(new), `packages/infrastructure/src/validation/ajvFactory.ts`,
`.changeset/pr260-schema-tightening.md`.

- [ ] 2.1: **`pathPathsOrInline` array-item tightening.** Replace
      bare `{ "type": "object" }` in array items with a constraint
      requiring at minimum the inline-hooks shape (event-keyed
      object) — accepts the same shapes the inline-object branch
      accepts, no looser. Same change applies to the array form.
- [ ] 2.2: **`userConfig` per-entry tightening.** Set
      `additionalProperties: false` on the entry schema. Enumerate
      allowed keys (`type`, `label`, `description`, `default`,
      `required`, `sensitive`).
- [ ] 2.3: **Type-conditional `default` enforcement** via nested
      `if/then/else` (NOT `oneOf` — see best-practices research).
      `if type === "string"` → `default: { type: "string" }`;
      else `if type === "number"` → `default: { type: "number" }`;
      else `default: { type: "boolean" }`.
- [ ] 2.4: **`monitors` `additionalProperties: false` → `true`** on
      the inline-array-element shape. Required fields stay
      required. Forward-compat with whatever Claude Code adds.
- [ ] 2.5: Add `dependencies[].version` validation. Two-layer:
      lightweight regex pattern in JSON Schema (`^[~^>=<*xX0-9]`
      gatekeep) + new AJV custom keyword
      `semverRange` calling `semver.validRange()` for full
      semantic check. Add `semver` dependency to root
      `package.json` if not already present.
- [ ] 2.6: Tighten `outputStyles` schema description to "directories
      containing .md files" (matches RULE 5b after PR-A).
- [ ] 2.7: **Update `examples/plugin-extended.example.json`.**
      Replace `"hooks": "./hooks/hooks.json"` (string anti-pattern
      that RULE 6 warns against) with inline-object form. Update
      `userConfig` block to satisfy the tightened schema (boolean
      defaults must be boolean, etc.). Add a `_comment`-style
      header noting the file is a schema-coverage fixture.
- [ ] 2.8: Add CI hook reference. Either: (a) add a comment in
      `validate-schemas.yml` explicitly globbing the example, OR
      (b) add a Vitest test in `tests/integration/` that
      AJV-validates every file under `examples/` against
      `plugin.schema.json`. (b) is preferred — turns it from a
      silent orphan into a tested fixture.
- [ ] 2.9: Run `pnpm validate:schemas`; example must pass.
- [ ] 2.10: Commit; `gt submit --no-interactive`.

**Acceptance:** `examples/plugin-extended.example.json` passes
tightened schema. New AJV custom keyword exercised by at least
one positive and one negative fixture. `pnpm test:integration`
includes a test that AJV-validates every file under `examples/`.

### Phase 3: PR-C — `work.md` RUN_DIR hardening

**Files:** `plugins/yellow-core/commands/workflows/work.md`,
`.changeset/pr260-rundir-hardening.md`.

- [ ] 3.1: **Shell-variable isolation fix.** Restructure Phase 3
      step 3a so `RUN_DIR=$(mktemp -d -t run-XXXXXXXX)` is
      derived in the same prose-step as the Task spawn, OR the
      orchestrator is instructed to capture stdout and substitute
      the literal path inline. Reference MEMORY.md
      `bash-block-subshell-isolation-in-command-files.md`
      anti-pattern.
- [ ] 3.2: **Empty-RUN_DIR error path.** After mktemp, prose
      instruction: "If `$RUN_DIR` is empty (mktemp failed),
      report the error to the user and stop — do not spawn
      reviewer agents without a valid run directory."
- [ ] 3.3: **Atomic write convention.** Update SKILL.md
      Subagent Failure Convention to specify
      `agent-result-<name>.tmp` → `mv` to `.json` rename
      (POSIX rename atomicity). Orchestrator globs `*.json`
      only, never `*.tmp`. Best-practices research validated
      this pattern in the barkain orchestration plugin.
- [ ] 3.4: **Cleanup step.** Add prose instruction at the end
      of Phase 3: "After findings are aggregated, remove
      `$RUN_DIR` (`rm -rf "$RUN_DIR"`). Result files may
      contain diff excerpts with secrets — retention in /tmp
      is a data-residue risk."
- [ ] 3.5: `pnpm validate:schemas` green; commit; submit.

**Acceptance:** `work.md` Phase 3 reads cleanly when followed by
an LLM with no prior context. Reviewers can verify by reading
Phase 3 top-to-bottom and confirming `$RUN_DIR` is created,
errored-on-empty, used, and cleaned up — all in unambiguous
prose-instruction form.

### Phase 4: PR-D — Doc sync (security-fencing count + quick-reference + scope clarification)

**Files:** `plugins/yellow-core/skills/security-fencing/SKILL.md`,
`plugins/yellow-core/skills/create-agent-skills/SKILL.md`,
`plugins/yellow-core/skills/create-agent-skills/references/quick-reference.md`,
`plugins/yellow-review/commands/review/review-pr.md`,
`.changeset/pr260-doc-sync.md`.

- [ ] 4.1: **Refresh security-fencing consumer count.** Update the
      "currently inlined in 25 agents" claim to reflect actual
      count (36 confirmed by `rg -l 'CRITICAL SECURITY RULES'
      plugins/`). Re-enumerate consumers from the live grep,
      excluding the canonical SKILL.md itself and the
      `yellow-core/CLAUDE.md` reference.
- [ ] 4.2: **Add machine-verifiable count one-liner** alongside
      the prose: ``rg -l 'CRITICAL SECURITY RULES' plugins/ |
      grep -v 'security-fencing/SKILL.md' | grep -v
      'CLAUDE.md' | wc -l`` so future drift is self-correcting.
- [ ] 4.3: **Add the 7 Wave-2 yellow-review personas** to the
      consumer list (`correctness-reviewer`,
      `maintainability-reviewer`, `project-compliance-reviewer`,
      `project-standards-reviewer`, `reliability-reviewer`,
      `adversarial-reviewer`, `plugin-contract-reviewer`).
      Annotate the deprecated `code-reviewer` stub as such.
- [ ] 4.4: **Fix `quick-reference.md:79`** yellow-browser-test
      reference. Verified: `yellow-browser-test` does not use
      the `.claude/<plugin>.local.md` pattern; it uses
      `.claude/browser-test-auth.json`. Replace with a working
      reference (yellow-plugins.local.md schema in `local-config`
      skill) OR remove the specific plugin reference and link
      to the `local-config` skill generically.
- [ ] 4.5: **Add Subagent Failure Convention scope clarification**
      to `create-agent-skills/SKILL.md`. New paragraph in the
      §Subagent Failure Convention section:

      > **When the convention applies.** Orchestrators that spawn
      > agents emitting unstructured prose (e.g., `work.md`
      > Phase 3 reviewers). Orchestrators whose spawned agents
      > return structured JSON per a compact-return schema
      > (e.g., `review-pr.md` Step 5) can rely on schema
      > validation to detect partial failures; the file-based
      > RUN_DIR pattern is unnecessary there and would only
      > duplicate the signal.

- [ ] 4.6: **Add comment block to `review-pr.md` Step 5**
      explaining the architectural choice:

      > Step 5 collects findings via TaskOutput because each
      > reviewer emits compact-return JSON per the schema in
      > this file. The Subagent Failure Convention's
      > file-based RUN_DIR pattern (see `create-agent-skills`
      > SKILL.md §Subagent Failure Convention) is reserved for
      > prose-emitting orchestrators like `work.md` Phase 3.

- [ ] 4.7: Update `create-agent-skills/SKILL.md` Subagent Failure
      Convention to use the atomic-write `.tmp` → `mv`
      convention (forward-link to PR-C item 3.3).
- [ ] 4.8: Categories list at SKILL.md:204 was already corrected
      on PR #260 by the in-scope fix; verify still correct, no
      action needed.
- [ ] 4.9: `pnpm validate:agents && pnpm validate:plugins` green;
      commit; submit.

**Acceptance:** `rg -l 'CRITICAL SECURITY RULES' plugins/ |
grep -v 'SKILL.md' | grep -v 'CLAUDE.md' | wc -l` matches the
number stated in security-fencing/SKILL.md. The
quick-reference.md `yellow-browser-test` reference is either
verified accurate or replaced. SKILL.md scope clarification
read top-to-bottom makes review-pr.md's design choice
unambiguous.

## Technical Specifications

### Files to Modify

- `scripts/validate-plugin.js` — extract helpers, add array-form
  hooks loop, add SessionStart, fix string-form hooks (PR-A)
- `schemas/plugin.schema.json` — tighten `pathPathsOrInline`,
  `userConfig`, `monitors`; add semver pattern (PR-B)
- `examples/plugin-extended.example.json` — replace anti-pattern
  hooks form, satisfy tightened userConfig (PR-B)
- `packages/infrastructure/src/validation/ajvFactory.ts` — register
  `semverRange` custom keyword (PR-B)
- `plugins/yellow-core/commands/workflows/work.md` — RUN_DIR
  isolation fix, empty-check, atomic-write reference, cleanup
  step (PR-C)
- `plugins/yellow-core/skills/security-fencing/SKILL.md` — refresh
  consumer count and list, add machine-verification one-liner
  (PR-D)
- `plugins/yellow-core/skills/create-agent-skills/SKILL.md` —
  Subagent Failure Convention scope clarification + atomic-write
  pattern (PR-D, also touches PR-C contract)
- `plugins/yellow-core/skills/create-agent-skills/references/quick-reference.md` —
  fix yellow-browser-test reference (PR-D)
- `plugins/yellow-review/commands/review/review-pr.md` — add
  Step 5 comment block referencing SKILL.md scope (PR-D)

### Files to Create

- `tests/integration/validate-plugin.test.ts` — PR-A fixture suite
- `tests/integration/example-files-schema.test.ts` — PR-B
  AJV-validate every example file
- `packages/infrastructure/src/validation/keywords/semverRange.ts` —
  PR-B AJV custom keyword for `semver.validRange()`

### Dependencies

- `semver@^7` — for `validRange()` runtime check (PR-B); already
  a transitive dep via Vitest, but should be declared explicitly
  in root `package.json` since `validate-plugin.js` imports it.

### API / Contract Changes

- **Validator behavior change for external consumers:** Plugins
  that ship array-form `hooks` with raw script paths will
  previously have passed validation silently (no path checks).
  After PR-A, those plugins receive script-path-existence,
  containment, shebang, and `set -e` checks. **No in-repo
  plugin uses array-form hooks** (verified by repo research),
  so blast radius inside this monorepo is zero. Downstream
  consumers of the schema/validator may see new errors on
  manifests that previously passed. Document this in the PR-A
  release note.
- **Schema tightening for `userConfig`:** `additionalProperties:
  false` rejects unknown keys at the entry level. Type-conditional
  default rejects mismatched type/default pairs. **No in-repo
  plugin uses `userConfig` in `plugin.json`** (verified — all
  cross-plugin userConfig usage is in command/skill `.md` files,
  not in manifests). Blast radius zero in-repo.

## Testing Strategy

- **Unit (validate-plugin.js):** Each new helper
  (`hasInlineHooks`, `addError`, `validateHookScriptPath`)
  testable independently if extracted to a small utility module.
  Optional: introduce `scripts/validate-plugin/lib.js` with
  exported helpers, tested via `*.test.js` siblings. Decision:
  defer this refactor; current extraction is in-place. Tests
  in PR-A go through the integration path.
- **Integration (PR-A):** Mirror
  `validate-agent-authoring-review-rule.test.ts`. Inline string
  fixtures, `mkdtempSync` + `writeFileSync` per test,
  `execFileSync` of validator script with `VALIDATE_PLUGINS_DIR`
  env override, assert exit code + stderr substring matches.
- **Integration (PR-B):** New `example-files-schema.test.ts`
  AJV-compiles `plugin.schema.json` once, then
  `describe.each([...readdirSync('examples/'), ...])` validates
  each fixture. Both happy-path and adversarial cases (typo
  fixture for userConfig).
- **Manual verification:** After each PR, run the relevant
  validator on every plugin in the monorepo (`pnpm
  validate:plugins`) — every existing plugin must still pass.

## Acceptance Criteria

1. `pnpm test:integration` adds ≥12 fixture cases across PR-A
   and PR-B, all green.
2. `pnpm validate:schemas && pnpm test:unit && pnpm lint &&
   pnpm typecheck` green on each stacked PR.
3. Every existing `plugins/*/.claude-plugin/plugin.json`
   validates after PR-B (no in-repo regression).
4. `examples/plugin-extended.example.json` validates against the
   tightened schema in PR-B and is referenced from a CI test in
   `tests/integration/`.
5. `work.md` Phase 3 prose explicitly creates RUN_DIR, errors on
   empty, uses atomic `.tmp` → `mv` writes, and cleans up after
   collection.
6. `security-fencing/SKILL.md` consumer count matches `rg -l`
   output at the moment of PR-D landing; the embedded one-liner
   makes future drift self-correcting.
7. `review-pr.md` Step 5 comment block makes the
   TaskOutput-vs-RUN_DIR architectural choice unambiguous.

## Edge Cases & Error Handling

- **Array-form hooks with mixed string/object items.** Each item
  is validated independently: strings get path-script checks,
  objects get the inline-event-keyed-object check.
- **`mktemp` failure on disk-full systems.** Prose instruction
  in `work.md` errors-and-stops; never proceeds with empty
  RUN_DIR.
- **Schema tightening + example file in different PRs.** PR-B
  bundles both to avoid the intermediate CI-broken state. Spec-flow
  analysis confirmed this constraint.
- **Multiple semver dependency syntaxes.** `semver.validRange`
  accepts `^1.0.0`, `~2.0.0`, `>=3 <4`, `1.x`, `*`,
  `1.2.3 - 2.0.0`, and `||` composites. Pre-filter regex is
  permissive; semantic check via `validRange` is authoritative.
- **Down-stream consumers of array-form `hooks`.** Document
  validator behavior change in PR-A release notes (changeset
  bump message). External plugins that previously passed
  silently may newly fail; this is intentional hardening, not a
  regression.

## Linear Issues

None — this follow-up is internal review-driven hardening, not a
Linear-tracked feature.

## References

- PR #260 review report (in this session, contains all 21 findings
  with reviewer attribution and confidence)
- `docs/solutions/code-quality/brainstorm-orchestrator-agent-authoring-patterns.md`
  — orchestrator authoring patterns
- `docs/solutions/code-quality/skill-frontmatter-attribute-and-format-requirements.md`
  — frontmatter rules
- `docs/solutions/build-errors/ci-schema-drift-hooks-inline-vs-string.md`
  — schema drift between local and Claude Code remote validator
- `tests/integration/validate-agent-authoring-review-rule.test.ts`
  — canonical Vitest fixture pattern to mirror
- `plugins/yellow-core/skills/create-agent-skills/SKILL.md`
  §Subagent Failure Convention (lines 240–340) — convention
  introduced in PR #260
- `plugins/yellow-core/commands/workflows/work.md` Phase 3 (lines
  447–491) — reference implementation of the convention
- AJV [conditionals reference](https://ajv.js.org/json-schema.html)
  — type-conditional defaults via `if/then/else`
- npm semver — `validRange()` for two-layer dependency
  validation
- Upstream issues anthropics/claude-code#24181 and
  anthropics/claude-code#25818 — Task return value reliability
  context for the convention scope

## Stack Decomposition

<!-- stack-topology: linear -->
<!-- stack-trunk: main -->

Stack built on top of `docs/subagent-conventions` (PR #260). Each PR
stacks on the previous via Graphite (`gt`); the entire stack ultimately
merges into `main` once PR #260 lands.

### 1. agent/fix/pr260-validator-hardening
- **Type:** fix
- **Description:** array-form hooks bypass + helper extraction + fixture test harness
- **Scope:** scripts/validate-plugin.js, tests/integration/validate-plugin.test.ts, .changeset/pr260-validator-hardening.md
- **Tasks:** 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.13
- **Depends on:** (none — base of stack; parent branch: docs/subagent-conventions)

### 2. agent/feat/pr260-schema-tightening
- **Type:** feat
- **Description:** tighten userConfig/pathPathsOrInline, add semver custom keyword, fix example
- **Scope:** schemas/plugin.schema.json, examples/plugin-extended.example.json, packages/infrastructure/src/validation/keywords/semverRange.ts, packages/infrastructure/src/validation/ajvFactory.ts, tests/integration/example-files-schema.test.ts, .changeset/pr260-schema-tightening.md
- **Tasks:** 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10
- **Depends on:** #1

### 3. agent/fix/pr260-work-rundir-hardening
- **Type:** fix
- **Description:** RUN_DIR shell-variable isolation + atomic .tmp→mv writes + cleanup
- **Scope:** plugins/yellow-core/commands/workflows/work.md, .changeset/pr260-rundir-hardening.md
- **Tasks:** 3.1, 3.2, 3.3, 3.4, 3.5
- **Depends on:** #2

### 4. agent/docs/pr260-doc-sync
- **Type:** docs
- **Description:** refresh security-fencing count, scope clarification, quick-ref fix
- **Scope:** plugins/yellow-core/skills/security-fencing/SKILL.md, plugins/yellow-core/skills/create-agent-skills/SKILL.md, plugins/yellow-core/skills/create-agent-skills/references/quick-reference.md, plugins/yellow-review/commands/review/review-pr.md, .changeset/pr260-doc-sync.md
- **Tasks:** 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9
- **Depends on:** #3
