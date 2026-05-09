# Feature: Plan Lifecycle Management

**Source brainstorm:** `docs/brainstorms/2026-05-08-plan-lifecycle-management-brainstorm.md`
**Detail level:** STANDARD (validator + 2 commands; no frontmatter, no agent, no migration)
**Status:** Ready for `/workflows:work`

> **Revision history:** First-pass plan introduced a `slug:`/`created:` frontmatter
> convention, a 47-file backfill migration, a 3-check `plan-verifier` agent (with
> an 8-row PR/commit/file truth table), and a 5-PR stack. PR #484 review (issues
> #494, #496) collapsed all four. Frontmatter is dropped (slug derived at runtime
> from filename), Gate C is a single `gh` call (no LLM in the loop), the validator
> scopes to PR-touched files (no escape hatch needed), and the stack is two PRs.
> The brainstorm references several artifacts that no longer exist in this plan;
> treat the brainstorm as historical context only.

## Problem Statement

Plans live as markdown in `plans/` (open) and `plans/complete/` (archived). Six
manual `git mv` archival commits in two days (`6f883f7c`, `f056390c`,
`3e9baf4d`, `0538866b`, peers) confirm this is real friction. The plugin
system has no authoritative way to know which plans are open, which are
complete, or whether the work a plan describes actually shipped.

We need: a status surface, an explicit archival command with completion
validation, and a CI gate that catches premature archival — without changing
the underlying filesystem convention and without inventing a new metadata
layer.

## Current State

- 3 open plans in `plans/`, 44 archived in `plans/complete/` (counts as of
  this PR's snapshot; the validator scopes to PR-touched files so absolute
  counts are informational only and naturally drift as new PRs land)
- No frontmatter convention — plans are plain markdown starting with
  `# Feature: …`
- 36% of archived plans (16/44) contain stray `- [ ]` lines from prose
  checklists, future-work sections, or quoted code — meaning a naive
  whole-corpus checkbox validator would block CI immediately. The
  PR-touched-files scoping (Phase 1.1) sidesteps this entirely.
- `/workflows:plan` writes plans named `plans/<slug>.md`; the filename slug
  (with optional `YYYY-MM-DD-` prefix stripped) survives renames as long as
  the file is renamed deliberately
- Archival is `git mv` + commit; no machine-readable signal of completion

## Proposed Solution

Two commands plus one CI validator, all in yellow-core. No new file format,
no migration, no LLM agent. Three user-facing decisions already made
(recorded so future readers can skip the rationale):

1. **No frontmatter convention** — Slug is derived at runtime from the
   filename: `basename "$PLAN" .md | sed 's/^[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}-//'`.
   Plans/ vs plans/complete/ directory split is the single source of truth
   for state.
2. **Validator scopes to PR-touched files** — Legacy stray-checkbox files
   are never re-touched, so the validator never sees them. No escape-hatch
   flag needed. Only files added or modified in the current PR are checked.
3. **Gate C is one `gh` query, no agent** — Run
   `gh pr list --search "in:title <slug>" --state merged` and post-filter
   on `headRefName` for word-boundary safety. PASS when at least one match
   exists; otherwise prompt the user via `AskUserQuestion`. No three-check
   verifier, no plan-body file-existence parsing, no token spend.

### Surface

```
plugins/yellow-core/
  commands/plan/
    status.md            → /plan:status         (read-only dashboard)
    complete.md          → /plan:complete <plan> (two-gate archival)

scripts/
  validate-plans.js      (CI validator, PR-diff-scoped)
```

No new shared library, no agent, no backfill script.

### Namespace split (deliberate)

Plan creation lives under `/workflows:plan` (it is a workflow that produces
plans alongside brainstorms, research, etc.). Archive and dashboard live
under `/plan:complete` and `/plan:status` (they are plan-specific lifecycle
operations, not general-purpose workflows). Future authors who want to add
plan-related commands should put them under `/plan:*`. This split is
documented in `plugins/yellow-core/CLAUDE.md` per Phase 5.2 below.

## Implementation Plan

### Phase 1: CI validator (`scripts/validate-plans.js`)

<!-- deepen-plan: codebase -->
> **Codebase:** `scripts/validate-marketplace.js` and `scripts/validate-plugin.js`
> use the `logError`/`logWarning`/`logInfo`/`logSuccess` pattern with `process.exit(0|1)`.
> Match that style. No `js-yaml` dependency is needed because the validator
> only reads body content (`grep ^\\s*- \\[ \\]`), not frontmatter.
<!-- /deepen-plan -->

- [ ] 1.1: Implement `scripts/validate-plans.js`. Behaviour:
  - Compute the PR-touched file set:
    `git diff --no-renames --name-only --diff-filter=AM "$BASE_REF...HEAD"`
    where `BASE_REF` defaults to `origin/main` and is overridable via the
    `PLAN_VALIDATOR_BASE_REF` env var. `--no-renames` is mandatory: without
    it, `git mv plans/foo.md plans/complete/foo.md` is reported as `R`
    (rename), which the `AM` filter drops — silently bypassing the gate
    on any machine where rename detection is enabled (`diff.renames=true`,
    a common global default).
  - Filter to paths matching `^plans/complete/.*\.md$`.
  - For each, count `^\s*- \[ \]` lines. If non-zero, log error and set
    failure flag.
  - Exit 1 if any failures, exit 0 otherwise.
  - **No-op cases (exit 0):**
    - PR touches no files under `plans/complete/`.
    - `BASE_REF` is unreachable (e.g., shallow clone) — emit a warning to
      stderr and exit 0; CI is responsible for fetching the base. Document
      the recipe in the validator's header comment.
- [ ] 1.2: Add `"validate:plans": "node scripts/validate-plans.js"` to
  `package.json` scripts. **Do NOT add to the `validate:schemas` chain.**
  `validate:schemas` is the plugin schema gate (marketplace + plugin +
  setup-all + agent-authoring); plan-lifecycle rules are a different concern
  per `CLAUDE.md`. Wire `validate:plans` as a separate top-level step in
  `.github/workflows/validate-schemas.yml` (or its sibling workflow) so it
  runs alongside, not inside, `validate:schemas`.
- [ ] 1.3: Vitest integration test in
  `tests/integration/validate-plans.test.ts`. Match the temp-dir pattern in
  `tests/integration/validate-plugin.test.ts`:
  `mkdtempSync(join(tmpdir(), 'yellow-validate-plans-'))` per test, init a
  bare git repo inside, commit fixtures, exercise the validator via
  `spawnSync('node', [VALIDATOR], { cwd: tmpRoot, env: {...,
  PLAN_VALIDATOR_BASE_REF: '<base-sha>'} })`, clean up via
  `rmSync(tmpRoot, { recursive: true, force: true })` in `afterEach`.
  Cases: PR adds clean file (PASS), PR adds dirty file with stray `- [ ]`
  (FAIL), PR modifies file in `plans/complete/` to add stray boxes (FAIL),
  PR touches files outside `plans/complete/` only (PASS), repository has
  pre-existing dirty files in `plans/complete/` but PR doesn't touch them
  (PASS — the core YAGNI behaviour).

### Phase 2: `/plan:status` command

- [ ] 2.1: Create `plugins/yellow-core/commands/plan/status.md` with
  frontmatter `name: plan:status`, single-line description with "Use when…"
  trigger clause, `argument-hint: ''`, `allowed-tools: [Bash]`.
- [ ] 2.2: Body: bash blocks that walk `plans/*.md` and
  `plans/complete/*.md`, count `- [ ]` and `- [x]` per file, format as
  plain-text table. Append `-- ready to complete` annotation when 100%
  checked AND file is in `plans/` (not `plans/complete/`).
- [ ] 2.3: Handle edge cases: zero-task plans render as `[ 0/0 ]` with no
  annotation; missing `plans/complete/` reports `(0)`.
- [ ] 2.4: Re-derive variables in each Bash block (every block is a fresh
  subprocess — see `MEMORY.md` "$VAR in bash code blocks").

### Phase 3: `/plan:complete` command

- [ ] 3.1: Create `plugins/yellow-core/commands/plan/complete.md` with
  `allowed-tools: [Bash, Read, AskUserQuestion]`, `argument-hint: '<plan-filename>'`.
  Note: no `Task` tool — Gate C is a bash call, not an agent dispatch.
- [ ] 3.2: Step 0 — idempotency guard: if `plans/complete/<arg>` already
  exists, exit with explanatory message.
- [ ] 3.3: Step 1 — filename validation:
  ```bash
  CLEAN_ARG="${ARG#plans/}"
  printf '%s' "$CLEAN_ARG" | grep -qE '^[a-z0-9_][a-z0-9_.-]*\.md$'
  ```
  (strip `plans/` prefix to support tab-completion; reject `..`, `/`,
  leading `-`, and uppercase letters). Lowercase-only is intentional:
  the post-derivation regex in step 3.4 enforces lowercase, so accepting
  mixed-case filenames here would create a parity gap (filename
  validation passes, slug validation fails). Use `$CLEAN_ARG` in all
  subsequent steps.
- [ ] 3.4: Step 2 — derive slug from filename:
  ```bash
  SLUG=$(basename "$CLEAN_ARG" .md | sed 's/^[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}-//')
  printf '%s' "$SLUG" | grep -qE '^[a-z0-9]+(-[a-z0-9]+)*$' \
    || { printf 'Slug %s contains invalid characters\n' "$SLUG" >&2; exit 1; }
  ```
  The post-derivation regex enforces lowercase alphanumeric + single
  hyphens (no leading/trailing/consecutive hyphens). This guards
  prompt-injection of any subsequent shell context — the slug is never
  embedded in an LLM prompt, but it IS interpolated into `gh` and
  `git` commands.
- [ ] 3.5: Step 3 — Gate A:
  ```bash
  UNCHECKED=$(grep -c '^[[:space:]]*- \[ \]' "plans/$CLEAN_ARG" || true)
  if [ "$UNCHECKED" -gt 0 ]; then
    printf 'Gate A FAIL: %d unchecked boxes in plans/%s\n' "$UNCHECKED" "$CLEAN_ARG" >&2
    exit 1
  fi
  ```
  No frontmatter escape hatch — the validator's PR-scoped behaviour means
  legacy stray-checkbox files never reach this gate (they were archived
  before the gate existed, and the validator only inspects PR-touched
  files going forward).
- [ ] 3.6: Step 4 — Gate C: single `gh` call.

  ```bash
  MERGED=$(gh pr list \
    --search "in:title \"$SLUG\"" \
    --state merged \
    --limit 100 \
    --json number,title,headRefName,url \
    --jq '[.[] | select(.headRefName | test("(^|[/_-])'"$SLUG"'($|[/_-])"))]')
  COUNT=$(printf '%s' "$MERGED" | jq 'length')
  ```

  **Verdict logic:**
  - **PASS** if `COUNT >= 1`. Squash-merged PRs are detected because the
    PR title (kept by GitHub regardless of squash strategy) is searched
    by `gh pr list`, not the synthesized commit message.
  - **No-evidence** if `COUNT == 0`: `AskUserQuestion`
    "No merged PR found whose title and branch contain the slug
    `$SLUG`. Provide a PR number to confirm, or cancel."
    Options: `Confirm with PR number` (Other → free-text), `Cancel`.
    On confirmed PR-number override, store `OVERRIDE_PR_NUM` for the
    commit trailer in step 3.10.

  Word-boundary protection: the `--jq` post-filter requires `$SLUG` to be
  separated from surrounding characters by `^`, `$`, `/`, `_`, or `-`. This
  prevents short or generic slugs (`refactor`, `fix`) from matching
  unrelated PRs whose branch names contain the slug as a substring inside
  another word.

  **Server-side `--state merged`** is preferred over reading `mergedAt`:
  per `docs/solutions/integration-issues/merge-queue-closed-pr-null-mergedat-detection.md`,
  `mergedAt` can be null for recently MQ-merged PRs during propagation
  lag. `--state merged` filters on PR state, which is authoritative
  once the upstream API has caught up; users archiving plans rarely race
  with same-second merges, so propagation lag is not a practical concern.
- [ ] 3.7: Step 5 — clean-tree check: warn (not block) if
  `git status --porcelain` non-empty; AskUserQuestion to proceed.
- [ ] 3.8: Step 6 — checkout trunk + sync before branch creation:
  ```bash
  git checkout main && gt repo sync
  ```
  Ensures the archival branch forks from `main`, not an in-progress
  feature branch.
- [ ] 3.9: Step 7 — archival branch + staged move:
  ```bash
  gt branch create "plan/archive-$SLUG"
  mkdir -p plans/complete
  git mv -- "plans/$CLEAN_ARG" "plans/complete/$CLEAN_ARG"
  ```
  `git mv` is required (not bare `mv`): a plain `mv` leaves the rename
  unstaged, so the `gt commit create` in step 3.10 would either fail or
  produce an empty commit. `git mv` records the rename in the index
  immediately, ready to commit.
- [ ] 3.10: Step 8 — commit with override audit trail. After building
  the message body from one of the templates below, invoke
  `gt commit create -m "<subject>" -m "<body>"` (the `-m` body flag
  receives the multi-line body verbatim — heredoc-in-`$()` substitution
  is a known footgun, see MEMORY.md "gt modify multi-line commit").

  Default commit (Gate C PASS, no override):
  ```
  docs(plans): archive completed <slug> plan

  Verified by /plan:complete: <COUNT> merged PR(s) found.
  ```

  Override commit (Gate C found 0 PRs, user confirmed):
  ```
  docs(plans): archive completed <slug> plan

  Verified by /plan:complete: user-confirmed override.

  Plan-Verifier-Override: user-confirmed-no-pr-evidence (pr=#<OVERRIDE_PR_NUM>)
  ```

  The `Plan-Verifier-Override:` trailer is grep-discoverable via
  `git log --grep='Plan-Verifier-Override'` for future audit. Document
  the trailer in `docs/solutions/workflow/plan-lifecycle-management.md`
  per Phase 5.3.
- [ ] 3.11: Step 9 — submit:
  ```bash
  gt stack submit --no-interactive
  ```
  Print the resulting PR URL on success (parse `gt submit` output or
  follow with `gh pr view --json url -q .url`).

### Phase 4: Tests

- [ ] 4.1: Vitest integration tests for `validate-plans.js` (covered in 1.3).
- [ ] 4.2: Bats smoke tests in `plugins/yellow-core/tests/plan-commands.bats`:
  exercise the slug derivation regex and the Gate A `grep -c` regex on
  fixture files (smoke; not a full command-flow test). Mark with
  `@test "skip on non-Linux"` guard if needed for cross-platform CI.
- [ ] 4.3: Manual verification checklist in plan body (no automated test
  for end-to-end command flow — too much shell + AskUserQuestion involved):
  run `/plan:status`, run `/plan:complete` against this plan after merge.

### Phase 5: Documentation

- [ ] 5.1: Update `plugins/yellow-core/README.md` command catalog with
  `/plan:status` and `/plan:complete`.
- [ ] 5.2: Add `/plan:*` section to `plugins/yellow-core/CLAUDE.md`
  documenting the namespace split (`/workflows:plan` creates plans;
  `/plan:complete`/`/plan:status` are lifecycle ops on existing plans).
  Justification: the `/workflows:*` namespace is reserved for end-to-end
  workflows that produce artifacts; lifecycle ops on those artifacts get
  their own namespace.
- [ ] 5.3: Add solutions doc `docs/solutions/workflow/plan-lifecycle-management.md`
  capturing:
  - The runtime-slug-from-filename decision and why frontmatter was
    rejected.
  - Gate C verdict logic (PASS / no-evidence + override).
  - The `Plan-Verifier-Override:` commit trailer convention.
  - Word-boundary regex rationale (slug collision protection).
  - PR-touched-files validator scope rationale (no whole-corpus scan).
- [ ] 5.4: Add changeset (`pnpm changeset`, minor bump for yellow-core:
  new commands).

## Technical Details

### Files to create

- `plugins/yellow-core/commands/plan/status.md`
- `plugins/yellow-core/commands/plan/complete.md`
- `scripts/validate-plans.js`
- `tests/integration/validate-plans.test.ts`
- `plugins/yellow-core/tests/plan-commands.bats`
- `docs/solutions/workflow/plan-lifecycle-management.md`

### Files to modify

- `plugins/yellow-core/README.md` (command catalog)
- `plugins/yellow-core/CLAUDE.md` (`/plan:*` section)
- `package.json` (add `validate:plans` script entry — NOT in
  `validate:schemas` chain)
- `.github/workflows/validate-schemas.yml` or sibling (add separate
  `validate:plans` step alongside `validate:schemas`)

### Files NOT changed (deliberately, vs. the first-pass plan)

- `plugins/yellow-core/commands/workflows/plan.md` — `/workflows:plan` does
  not need to write frontmatter, since slug is derived at runtime from
  filename.
- All 47 plan files under `plans/` (3) and `plans/complete/` (44) — no backfill.
- `scripts/lib/plan-frontmatter.js` — not created (no frontmatter to parse).
- `scripts/backfill-plan-slugs.js` — not created (no migration needed).
- `plugins/yellow-core/agents/plan/plan-verifier.md` — not created (Gate C
  is a bash call).

### Dependencies

No new packages. `gh`, `git`, and `gt` are already required by the repo.

## Acceptance Criteria

1. Running `/plan:status` produces a plain-text table listing the current
   `plans/*.md` (open) and `plans/complete/*.md` (archived) corpus with
   per-file checkbox progress; 100%-complete open plans annotated
   `-- ready to complete`.
2. Running `/plan:complete <plan>` against a plan whose work has merged
   under a same-named PR title runs Gate A and Gate C cleanly, archives
   via `gt`, and reports the resulting PR URL.
3. Running `/plan:complete <plan>` against a plan with no matching merged
   PR prompts via `AskUserQuestion` for confirmation and, on override,
   appends `Plan-Verifier-Override: user-confirmed-no-pr-evidence` to
   the archival commit.
4. Running `/plan:complete <plan>` twice in a row: second invocation exits
   with "already archived" message.
5. `pnpm validate:plans` passes when no PR-touched files violate the
   no-stray-checkbox rule, regardless of how many legacy
   `plans/complete/*.md` files have stray boxes.
6. `pnpm validate:plans` fails when a PR adds or modifies a file in
   `plans/complete/` that contains `- [ ]` lines.

## Edge Cases

- **Slug collision at archival time:** Two plans with the same derived slug.
  Detection: the directory split prevents two open plans from sharing a
  slug at the same time; archival of a slug whose archived peer already
  exists trips Step 0's idempotency guard.
- **Slug too generic:** `refactor`, `fix`, `wip`. The word-boundary
  post-filter on `headRefName` mitigates most false matches; if the
  override path triggers anyway, the user resolves via the PR-number
  prompt and the commit trailer captures the decision.
- **Dirty working tree at /plan:complete:** Warn, ask, proceed if confirmed.
  Don't block — the user may have unrelated WIP they want to keep.
- **`gh pr list` returns nothing but the PR is in merge queue:** PR is not
  yet in `--state merged`. User confirms via override path. (Edge case
  for users who run `/plan:complete` before their own PR has merged out
  of the queue.)
- **Plan with zero `- [ ]` and zero `- [x]`:** Status renders `[ 0/0 ]`,
  no annotation. `/plan:complete` Gate A trivially passes.
- **`plans/complete/` doesn't exist on first run:** `/plan:complete` runs
  `mkdir -p plans/complete/` before mv. Validator no-ops gracefully.
- **Filename with traversal characters:** Step 1 regex rejects.
- **Shallow clone in CI:** Validator emits a warning to stderr and exits 0
  when `BASE_REF` is unreachable; CI workflow is responsible for
  `actions/checkout@v4` `fetch-depth: 0` (or fetching the base ref
  explicitly). Documented in the validator header comment.

## Stack Decomposition

<!-- stack-topology: linear -->
<!-- stack-trunk: main -->

### 1. agent/feat/validate-plans-pr-scoped
- **Type:** feat
- **Description:** Add scripts/validate-plans.js (PR-diff-scoped, no frontmatter) plus integration tests and CI wiring as a separate top-level step
- **Scope:** scripts/validate-plans.js, package.json, tests/integration/validate-plans.test.ts, .github/workflows/*.yml
- **Tasks:** 1.1, 1.2, 1.3
- **Depends on:** (none)
- **Changeset:** none required (no `plugins/*` files touched)

### 2. agent/feat/plan-commands
- **Type:** feat
- **Description:** /plan:status read-only dashboard + /plan:complete two-gate archival (runtime slug, single-gh-call Gate C, override trailer) + docs + changeset
- **Scope:** plugins/yellow-core/commands/plan/status.md, plugins/yellow-core/commands/plan/complete.md, plugins/yellow-core/README.md, plugins/yellow-core/CLAUDE.md, plugins/yellow-core/tests/plan-commands.bats, docs/solutions/workflow/plan-lifecycle-management.md, .changeset/*.md
- **Tasks:** 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 4.2, 4.3, 5.1, 5.2, 5.3, 5.4
- **Depends on:** #1
- **Changeset:** required (yellow-core, minor — new commands)

## References

- Brainstorm (superseded for several decisions): `docs/brainstorms/2026-05-08-plan-lifecycle-management-brainstorm.md`
- Validator pattern: `scripts/validate-marketplace.js`, `scripts/validate-plugin.js`
- Reference command: `plugins/yellow-core/commands/worktree/cleanup.md` (uses `gh pr list --head`)
- Merge-queue / `mergedAt` gotcha: `docs/solutions/integration-issues/merge-queue-closed-pr-null-mergedat-detection.md`
- Bash hardening: `MEMORY.md` "Bash Hook & Validation Patterns" section
- Command anti-patterns: `docs/solutions/code-quality/claude-code-command-authoring-anti-patterns.md`
- PR #484 review issues driving this revision: `#494` (P0/P1 design), `#496` (YAGNI scope reductions)
