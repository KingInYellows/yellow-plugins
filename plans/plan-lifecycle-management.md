# Feature: Plan Lifecycle Management

**Source brainstorm:** `docs/brainstorms/2026-05-08-plan-lifecycle-management-brainstorm.md`
**Detail level:** STANDARD+ (validator + 2 commands + 1 agent + migration)
**Status:** Ready for `/workflows:work`

## Problem Statement

Plans live as markdown in `plans/` (open) and `plans/complete/` (archived). Six manual `git mv` archival commits in two days (`6f883f7c`, `f056390c`, `3e9baf4d`, `0538866b`, peers) confirm this is real friction. The plugin system has no authoritative way to know which plans are open, which are complete, or whether the work a plan describes actually shipped.

We need: a status surface, an explicit archival command with completion validation, and a CI gate that catches premature archival — without changing the underlying filesystem convention.

## Current State

- 2 open plans in `plans/`, 44 archived in `plans/complete/`
- No frontmatter convention — plans are plain markdown starting with `# Feature: …`
- 36% of archived plans (16/44) contain stray `- [ ]` lines from prose checklists, future-work sections, or quoted code — meaning a naive checkbox validator would block CI immediately
- `/workflows:plan` writes plans but no stable per-plan identifier survives renames
- Archival is `git mv` + commit; no machine-readable signal of completion

## Proposed Solution

A small frontmatter convention plus two commands plus one CI validator, all in yellow-core. Three user-facing decisions already made (recorded here so future readers can skip the rationale):

1. **Frontmatter escape hatch** — Gate A respects `ci-skip-checkbox-check: true` on legacy plans rather than scoping to specific headings (avoids ambiguous structural rules).
2. **`slug:` frontmatter** — `/workflows:plan` writes a stable slug at creation; Gate C reads it. Survives file renames.
3. **Work-PR evidence** — Gate C confirms ≥1 PR referencing the slug merged to main (multi-PR plans like `everyinc-merge` work naturally).

### Surface

```
plugins/yellow-core/
  commands/plan/
    status.md            → /plan:status         (read-only dashboard)
    complete.md          → /plan:complete <plan> (two-gate archival)
  agents/plan/
    plan-verifier.md     (Gate C verification agent)

scripts/
  validate-plans.js      (CI validator, runs in pnpm release:check)
  backfill-plan-slugs.js (one-shot migration helper, deleted after use)
```

### Plan frontmatter (new)

```yaml
---
slug: plan-lifecycle-management
created: 2026-05-08
ci-skip-checkbox-check: false   # optional; defaults to false
---
```

`slug` is required for any plan that wants to use `/plan:complete` Gate C. `ci-skip-checkbox-check` is the legacy escape hatch — set to `true` only for already-archived plans whose stray `- [ ]` lines are not tasks.

## Implementation Plan

### Phase 1: Foundation — frontmatter parsing utility

<!-- deepen-plan: codebase -->
> **Codebase:** `scripts/validate-agent-authoring.js` lines 62-105 already implements
> `extractFrontmatter(text)`, `parseScalar(frontmatter, key)`, and `parseList(frontmatter, key)`
> as module-private helpers. `scripts/lint-plugins.sh:74` has a bash-side `frontmatter()`
> function. `scripts/backfill-solution-frontmatter.js` contains another independent parser.
> Do **not** invent a fourth implementation — extract those three functions into the new
> shared `scripts/lib/plan-frontmatter.js` and have `validate-agent-authoring.js` import from
> it (or accept the duplication and copy verbatim if cross-script imports add complexity).
<!-- /deepen-plan -->

- [ ] 1.1: Add `parsePlanFrontmatter(filePath)` helper to `scripts/lib/plan-frontmatter.js` — reads first `---` block, returns `{slug, created, ciSkipCheckboxCheck}` plus a `_raw` field for the body. Pure regex (no js-yaml dep) — frontmatter is simple key:value only. Mirror the parser pattern in `scripts/validate-agent-authoring.js` lines 62-90.
- [ ] 1.2: Unit-test the helper in `tests/integration/plan-frontmatter.test.ts` against fixtures: missing frontmatter, malformed YAML, present-but-empty, all-fields-present.
- [ ] 1.3: Document the schema in `docs/CLAUDE.md` (versioning section already exists) and `plugins/yellow-core/CLAUDE.md`.

### Phase 2: `/workflows:plan` augmentation

<!-- deepen-plan: codebase -->
> **Codebase:** Confirmed `plugins/yellow-core/commands/workflows/plan.md` Phase 4 Step 2
> currently writes plain markdown starting with `# Feature: [Title]` — zero YAML frontmatter
> in any of the three templates (MINIMAL/STANDARD/COMPREHENSIVE, lines 164-360). Phase 2.1
> below is a real net-new addition, not a tweak. The `# Feature:` header line stays; the
> frontmatter block prepends above it.
<!-- /deepen-plan -->

- [ ] 2.1: Modify `plugins/yellow-core/commands/workflows/plan.md` Phase 4 Step 2: when writing plan file, prepend a YAML frontmatter block with `slug` (kebab-case from the plan title) and `created` (today's date in `YYYY-MM-DD`).
- [ ] 2.2: Update plan templates (MINIMAL/STANDARD/COMPREHENSIVE) in the same file to show frontmatter as the first block.
- [ ] 2.3: Verify that downstream commands (`/workflows:work`, `/gt-stack-plan`) ignore the frontmatter cleanly — no parser changes needed since they read body content.

### Phase 3: Backfill migration

- [ ] 3.1: Write `scripts/backfill-plan-slugs.js` — walks `plans/` and `plans/complete/`, prepends frontmatter to any file lacking it. Slug derived from filename minus `.md` minus optional `YYYY-MM-DD-` prefix. `ci-skip-checkbox-check: true` is set on archived plans that have unchecked boxes.
- [ ] 3.2: Run the migration locally; verify diff is reasonable (47 file changes — 44 archived + 3 open, frontmatter only).
- [ ] 3.3: Commit migration as a separate logical commit ("chore(plans): backfill slug + ci-skip frontmatter") so the validator change can be reviewed independently.
- [ ] 3.4: Delete `scripts/backfill-plan-slugs.js` after migration commits land — one-shot tool.

### Phase 4: CI validator

- [ ] 4.1: Implement `scripts/validate-plans.js` matching the pattern in `validate-marketplace.js` (logError/logWarning/logInfo/logSuccess; exit 0/1). Rule: every `.md` in `plans/complete/` either (a) contains zero `^\s*- \[ \]` lines OR (b) has `ci-skip-checkbox-check: true` in frontmatter. Use `parsePlanFrontmatter` from Phase 1.
- [ ] 4.2: Guard `plans/complete/` non-existence — `fs.existsSync` check returns success with no files validated.
- [ ] 4.3: Add `"validate:plans": "node scripts/validate-plans.js"` to `package.json` scripts (the script entry only — do NOT append to `release:check` separately; see task 4.4).
- [ ] 4.4: Add `&& node scripts/validate-plans.js` to the `validate:schemas` chain in `package.json` (CI baseline gate — blocks all PRs). Because `release:check` already calls `validate:schemas`, this single insertion covers both gates; no separate edit to `release:check` is needed.

<!-- deepen-plan: codebase -->
> **Codebase:** `package.json:20` chains `validate:schemas` as `marketplace → plugin → setup-all → agent-authoring`. The chain is `&&`-joined fail-fast; ordering is by scope (broadest to narrowest), not data-flow. Appending `&& node scripts/validate-plans.js` at the end is safe with no ordering constraint. `release:check` (`package.json:30`) already invokes `validate:schemas`, so adding `validate:plans` to the `validate:schemas` chain is sufficient — no duplicate entry in `release:check` is required.
<!-- /deepen-plan -->

- [ ] 4.5: Vitest integration test in `tests/integration/validate-plans.test.ts`: temp-dir fixtures for pass/fail/escape-hatch/no-frontmatter/missing-dir cases.

<!-- deepen-plan: codebase -->
> **Codebase:** Match the pattern in `tests/integration/validate-plugin.test.ts` —
> `mkdtempSync(join(tmpdir(), 'yellow-validate-plans-'))` in `beforeEach`, fixture files via
> inline write helpers, validator invoked via `spawnSync('node', [VALIDATOR, tmpRoot])`,
> cleanup via `rmSync(tmpRoot, { recursive: true, force: true })` in `afterEach`. The
> "plugin directory basename must equal manifest name" constraint (RULE 2) does **not**
> apply since plan files have no name field — temp dir basename is unconstrained.
<!-- /deepen-plan -->


### Phase 5: `/plan:status` command

- [ ] 5.1: Create `plugins/yellow-core/commands/plan/status.md` with frontmatter `name: plan:status`, single-line description, `argument-hint: ''`, `allowed-tools: [Bash]`.
- [ ] 5.2: Body: bash blocks that walk `plans/*.md` and `plans/complete/*.md`, count `- [ ]` and `- [x]` per file, format as plain-text table. Append `-- ready to complete` annotation when 100% checked AND file is in `plans/` (not `plans/complete/`).
- [ ] 5.3: Handle edge cases: zero-task plans render as `[ 0/0 ]` with no annotation; missing `plans/complete/` reports `(0)`.
- [ ] 5.4: Re-derive variables in each Bash block (every block is a fresh subprocess — see MEMORY.md).

### Phase 6: `/plan:complete` command + plan-verifier agent

- [ ] 6.1: Create `plugins/yellow-core/agents/plan/plan-verifier.md` modeled on `repo-research-analyst` (frontmatter: `name: plan-verifier`, `model: inherit`, `background: true`, `memory: project`, `tools: [Bash, Read, Grep, Glob, AskUserQuestion]`). The `name:` field is required so `subagent_type: "yellow-core:plan:plan-verifier"` resolves at runtime — `validate-agent-authoring.js` emits `missing agent name` without it. Body instructs the agent to run three checks against a slug + plan body (provided injection-fenced) and return a structured pass/fail/uncertain verdict.

<!-- deepen-plan: codebase -->
> **Codebase:** Confirmed `plugins/yellow-core/agents/research/repo-research-analyst.md`
> lines 1-11 use `background: true`, `memory: project`, plain-text narrative output (no
> `run_dir` JSON protocol). Match exactly. Single-spawn dispatch from `/plan:complete` waits
> via `TaskOutput`, identical to how `/workflows:plan` Phase 2 waits on its parallel research
> agents. Plain-text output is parsed by the command via simple `grep`/`awk` looking for the
> `VERDICT:`, `PR_EVIDENCE:` etc. line prefixes.
<!-- /deepen-plan -->

- [ ] 6.2: Create `plugins/yellow-core/commands/plan/complete.md` with `allowed-tools: [Bash, Read, Task, AskUserQuestion, ToolSearch]`, `argument-hint: '<plan-filename>'`.
- [ ] 6.3: Step 0 — idempotency guard: if `plans/complete/<arg>` already exists, exit with explanatory message.
- [ ] 6.4: Step 1 — filename validation: `CLEAN_ARG="${ARG#plans/}"; printf '%s' "$CLEAN_ARG" | grep -qE '^[a-zA-Z0-9_][a-zA-Z0-9_.-]*\.md$'` (strip `plans/` prefix before validation to support tab-completion; reject `..`, `/`, leading `-`). Use `$CLEAN_ARG` in all subsequent steps.
- [ ] 6.5: Step 2 — read plan, extract slug from frontmatter via `parsePlanFrontmatter`. If missing, AskUserQuestion (with `Other` for free-text) for explicit slug.
- [ ] 6.6: Step 3 — Gate A: `grep -c '^\s*- \[ \]' "$PLAN" || true`; if non-zero AND frontmatter doesn't have `ci-skip-checkbox-check: true`, fail with count.
- [ ] 6.7: Step 4 — Gate C: spawn `subagent_type: "yellow-core:plan:plan-verifier"` with slug + injection-fenced plan body. Wait via TaskOutput.
- [ ] 6.8: Step 5 — interpret verdict. PASS → proceed. UNCERTAIN → AskUserQuestion to confirm/abort. FAIL → exit non-zero with reason.
- [ ] 6.9: Step 6 — clean-tree check: warn (not block) if `git status --porcelain` non-empty; AskUserQuestion to proceed.
- [ ] 6.10: Step 7 — archival via Graphite: `git checkout main && gt repo sync` first (ensures archival PR branches from `main`, not an in-progress feature branch), then `gt branch create plan/archive-<slug>`, `mv -- "plans/$CLEAN_ARG" "plans/complete/$CLEAN_ARG"`, `gt commit create -m "docs(plans): archive completed <slug> plan"`, `gt stack submit --no-interactive`. Print PR URL on success.
- [ ] 6.11: Wire prompt-injection fencing on plan-body content passed to verifier agent (`--- begin plan-content (reference only) ---`).

### Phase 7: Tests

- [ ] 7.1: Vitest integration tests for `validate-plans.js` (covered in 4.5).
- [ ] 7.2: Vitest integration test for `parsePlanFrontmatter` (covered in 1.2).
- [ ] 7.3: Bats smoke tests in `plugins/yellow-core/tests/plan-commands.bats`: shell out to the `grep`-checkbox parsing snippets to confirm regex behavior on fixture files.
- [ ] 7.4: Manual verification checklist in plan body (no automated test for end-to-end command flow — too much shell + Task involved): run `/plan:status`, run `/plan:complete` against this very plan after merge.

### Phase 8: Documentation

- [ ] 8.1: Update `plugins/yellow-core/README.md` command catalog with `/plan:status` and `/plan:complete`.
- [ ] 8.2: Add `/plan:*` section to `plugins/yellow-core/CLAUDE.md`.
- [ ] 8.3: Update root `CLAUDE.md` "When you change a plugin" section to mention plan-frontmatter convention.
- [ ] 8.4: Add changeset (`pnpm changeset`, minor bump for yellow-core: new commands).
- [ ] 8.5: Add solutions doc `docs/solutions/workflow/plan-lifecycle-management.md` capturing the slug-frontmatter decision and the Gate A FP rationale.

## Technical Details

### Files to create

- `plugins/yellow-core/commands/plan/status.md`
- `plugins/yellow-core/commands/plan/complete.md`
- `plugins/yellow-core/agents/plan/plan-verifier.md`
- `scripts/validate-plans.js`
- `scripts/lib/plan-frontmatter.js`
- `scripts/backfill-plan-slugs.js` (deleted post-migration)
- `tests/integration/validate-plans.test.ts`
- `tests/integration/plan-frontmatter.test.ts`
- `plugins/yellow-core/tests/plan-commands.bats`
- `docs/solutions/workflow/plan-lifecycle-management.md`

### Files to modify

- `plugins/yellow-core/commands/workflows/plan.md` (add slug to written frontmatter)
- `plugins/yellow-core/README.md` (command catalog)
- `plugins/yellow-core/CLAUDE.md` (plan section)
- `package.json` (add `validate:plans` script + chain into `validate:schemas` and `release:check`)
- `plans/*.md` and `plans/complete/*.md` (62 files, frontmatter prepend via migration script)

### Dependencies

No new packages. Frontmatter parsing is pure regex; `gh` and `git` and `gt` are already required by the repo.

### Verification agent contract

`plan-verifier` receives a slug and an injection-fenced plan body, returns:

```
VERDICT: PASS|FAIL|UNCERTAIN
PR_EVIDENCE: <list of merged PRs found referencing slug, with branches and merge SHAs>
COMMIT_EVIDENCE: <git log main --grep=slug count>
FILE_EVIDENCE: <count of files mentioned in plan body that exist on disk>
RATIONALE: <one short paragraph>
```

Three checks:
1. `gh pr list --search "in:title <slug>" --state merged --limit 10 --json number,title,mergedAt,headRefName` then filter `mergedAt != null` AND `headRefName` contains the slug (post-filter in jq: `.[] | select(.mergedAt != null) | select(.headRefName | contains("<slug>"))`). Note merge-queue ambiguity (MEMORY.md): a closed-not-merged PR has `mergedAt: null` — must check this field, not just state. Bare-prose body matches are rejected — only title and branch-name matches count, to avoid false positives from generic slugs (e.g., `refactor`) matching unrelated PRs.
2. `git log main --oneline --grep="$SLUG"` — at least one commit.
3. Read plan body; for each `path/to/file.ts`-style reference under "Files to create" or "Files to modify" sections, check file exists. Report fraction.

UNCERTAIN if PR check has zero results but commit check has results (unusual — usually means slug mismatch). PASS if all three have evidence. FAIL if all three are empty.

## Acceptance Criteria

1. Running `/workflows:plan` writes a plan with `slug:` and `created:` frontmatter.
2. Running `/plan:status` produces a plain-text table listing 3 open + 44 archived plans (current corpus) with checkbox progress; 100%-complete open plans annotated `-- ready to complete`.
3. Running `/plan:complete <plan>` against a plan whose work has merged passes Gate A and Gate C, runs the Graphite archival flow, and reports the PR URL.
4. Running `/plan:complete <plan>` twice in a row: second invocation exits with "already archived" message.
5. `pnpm validate:plans` passes against the current `plans/complete/` corpus after migration commit.
6. `pnpm validate:plans` fails when a new file with unchecked boxes (and no `ci-skip-checkbox-check: true`) is introduced into `plans/complete/`.
7. `pnpm release:check` and `pnpm validate:schemas` both include `validate:plans` in their chain.

## Edge Cases

- **Plan with no frontmatter:** `/plan:complete` prompts for slug via AskUserQuestion. `validate-plans.js` treats absence of frontmatter as `ci-skip-checkbox-check: false` (default), so legacy archived plans without frontmatter and with stray `- [ ]` lines fail until backfilled.
- **Slug collision:** Multiple plans with the same slug in different states. Migration script must detect and warn; humans resolve. Out of scope for the runtime command.
- **Dirty working tree at /plan:complete:** Warn, ask, proceed if confirmed. Don't block — the user may have unrelated WIP they want to keep.
- **`gh pr list` returns nothing but commits exist:** Verifier returns UNCERTAIN; user confirms via AskUserQuestion. (Common for old plans archived before this workflow existed.)
- **Plan with zero `- [ ]` and zero `- [x]`:** Status renders `[ 0/0 ]`, no annotation. `/plan:complete` Gate A trivially passes.
- **`plans/complete/` doesn't exist on first run:** `/plan:complete` runs `mkdir -p plans/complete/` before mv. Validator no-ops gracefully.
- **Filename with traversal characters:** Step 1 regex rejects.

## Stack Decomposition

<!-- stack-topology: linear -->
<!-- stack-trunk: main -->

### 1. agent/feat/plan-frontmatter-parser
- **Type:** feat
- **Description:** Add scripts/lib/plan-frontmatter.js parser plus integration tests
- **Scope:** scripts/lib/plan-frontmatter.js, tests/integration/plan-frontmatter.test.ts
- **Tasks:** 1.1, 1.2, 1.3
- **Depends on:** (none)

### 2. agent/feat/workflows-plan-writes-slug
- **Type:** feat
- **Description:** /workflows:plan writes slug + created frontmatter on every new plan
- **Scope:** plugins/yellow-core/commands/workflows/plan.md
- **Tasks:** 2.1, 2.2, 2.3
- **Depends on:** #1

### 3. agent/feat/validate-plans-and-backfill
- **Type:** feat
- **Description:** validate-plans.js CI gate + one-shot backfill of 62 existing plan files
- **Scope:** scripts/validate-plans.js, scripts/backfill-plan-slugs.js, package.json, plans/*.md, plans/complete/*.md, tests/integration/validate-plans.test.ts
- **Tasks:** 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4, 4.5
- **Depends on:** #2

### 4. agent/feat/plan-status-command
- **Type:** feat
- **Description:** /plan:status read-only dashboard with checkbox progress + ready-to-complete annotation
- **Scope:** plugins/yellow-core/commands/plan/status.md, plugins/yellow-core/tests/plan-commands.bats
- **Tasks:** 5.1, 5.2, 5.3, 5.4, 7.3
- **Depends on:** #3

### 5. agent/feat/plan-complete-command
- **Type:** feat
- **Description:** /plan:complete two-gate archival + plan-verifier agent + docs + changeset
- **Scope:** plugins/yellow-core/commands/plan/complete.md, plugins/yellow-core/agents/plan/plan-verifier.md, plugins/yellow-core/README.md, plugins/yellow-core/CLAUDE.md, CLAUDE.md, .changeset/*.md, docs/solutions/workflow/plan-lifecycle-management.md
- **Tasks:** 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 7.4, 8.1, 8.2, 8.3, 8.4, 8.5
- **Depends on:** #4

## References

- Brainstorm: `docs/brainstorms/2026-05-08-plan-lifecycle-management-brainstorm.md`
- Validator pattern: `scripts/validate-marketplace.js`, `scripts/validate-plugin.js`
- Verification agent precedent: `plugins/yellow-core/agents/research/repo-research-analyst.md`
- Reference command: `plugins/yellow-core/commands/worktree/cleanup.md` (uses `gh pr list --head`)
- Merge-queue gotcha: `docs/solutions/integration-issues/merge-queue-closed-pr-null-mergedat-detection.md`
- Bash hardening: `MEMORY.md` "Bash Hook & Validation Patterns" section
- Command anti-patterns: `docs/solutions/code-quality/claude-code-command-authoring-anti-patterns.md`
