# Feature: Plan Lifecycle Management

**Source brainstorm:** `docs/brainstorms/2026-05-08-plan-lifecycle-management-brainstorm.md`
**Detail level:** STANDARD (validator + 2 commands; no frontmatter, no agent, no migration)
**Status:** Ready for `/workflows:work` (PR #1 first)

> **Revision history:** First-pass plan introduced a `slug:`/`created:` frontmatter
> convention, a 47-file backfill migration, a 3-check `plan-verifier` agent (with
> an 8-row PR/commit/file truth table), and a 5-PR stack. PR #484 review (issues
> #494, #496) collapsed all four. Frontmatter is dropped (slug derived at runtime
> from filename), Gate C is a single `gh` call (no LLM in the loop), the validator
> scopes to PR-touched files (no escape hatch needed), and the stack is two PRs.
>
> **2026-05-28 refresh** (pre-execution drift check): (a) plan corpus now 8 open
> + 71 archived (was 3 + 44); 54% of archived plans (38/71) contain stray
> `- [ ]` boxes — PR-scoping is even more load-bearing than the original
> justification implied. (b) Phase 1 template pointer switched from
> `validate-marketplace.js` / `validate-plugin.js` (the latter was decomposed
> into `scripts/lib/` in #531) to `scripts/validate-solutions.js`, which is the
> canonical PR-diff-scoped validator template. (c) Added Phase 1.0 to register
> the error code in `packages/domain/src/validation/errorCatalog.ts` — required
> by `scripts/lint-error-codes.js` (now in the `validate:schemas` chain).
> (d) CI wiring rewritten as a matrix-target addition (sixth target alongside
> marketplace/plugins/contracts/examples/solutions) rather than a separate
> top-level step; this is the shape `validate-schemas.yml` settled into.
> (e) Test ergonomics upgrade: use `PLAN_VALIDATOR_DIFF` synthetic-injection
> env (mirroring `VALIDATE_SOLUTIONS_DIFF`) instead of `mkdtempSync`+bare-git-init.
> (f) Rename handling switched from `--no-renames` to parsing `R<score>` records
> from `--name-status -z` (matching `validate-solutions.js`) for consistency.
>
> **2026-05-28 PR #1 follow-up corrections** (apply to PR #2 task drafts before
> writing the command bodies): (g) Task 3.10's recommended commit invocation
> `gt commit create -m "<subject>" -m "<body>"` is broken — empirically the
> two `-m` values get concatenated with a literal comma (`"subject,Adds..."`).
> `gt commit create` does not support `-F`. Use plain
> `git commit -m "$SUBJECT" -m "$BODY"` instead (standard git docs: multiple
> `-m` are joined as separate paragraphs with a blank line, exactly what we
> want). Follow with `gt submit --no-interactive` to push. (h) Task 3.6's
> AskUserQuestion no-evidence prompt currently labels the override option
> `Confirm with PR number` — that won't open a free-text input. Per MEMORY.md
> "AskUserQuestion 'Other' is the ONLY free-text button". Re-label to `Other`
> (Claude Code's UI surfaces "Other" as the free-text affordance).
>
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

- 8 open plans in `plans/`, 71 archived in `plans/complete/` (counts as of
  2026-05-28; the validator scopes to PR-touched files so absolute
  counts are informational only and naturally drift as new PRs land)
- No frontmatter convention — plans are plain markdown starting with
  `# Feature: …`
- 54% of archived plans (38/71) contain stray `- [ ]` lines from prose
  checklists, future-work sections, or quoted code — meaning a naive
  whole-corpus checkbox validator would block CI immediately. The
  PR-touched-files scoping (Phase 1.1) sidesteps this entirely. (The
  ratio worsened from 36% (16/44) over the 2026-05-09 → 2026-05-28
  archival wave, which strengthens the original argument: any future
  whole-corpus gate would be progressively harder to enable.)
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
> **Codebase:** Findings from the deepen-plan codebase agent (2026-05-28).
> Confirmed: `scripts/validate-solutions.js` (modified 2026-05-27) is the
> newest and correct template. `parseNulSeparatedDiff` lives at
> `scripts/validate-solutions.js:128-161` (real-git path); the synthetic
> tab-separated injection helper lives at `scripts/validate-solutions.js:163-180`.
> The step-level `env:` block at `.github/workflows/validate-schemas.yml:87-88`
> applies to all matrix targets and is inherited by a 6th `plans` target
> automatically; the `timeout-minutes: 2` job-level ceiling and the fork-PR
> gate at line 43 are likewise inherited.
>
> **Corrections from the agent's verification (folded into task text below):**
>
> 1. `validate-solutions.js` does NOT use `scripts/lib/logging.js`. It
>    defines inline `emitError` / `emitNotice` helpers that emit
>    `::error file=...` and `::notice::` GHA annotations when `IS_CI=true`.
>    Mirror that inline pattern in `validate-plans.js` — do NOT import from
>    `scripts/lib/logging.js`. (`scripts/lib/logging.js` exports
>    `{ colors, logError, logWarning, logInfo, logSuccess, addError }` and
>    is the older `validate-marketplace.js` / `validate-plugin.js` family's
>    convention.)
> 2. The error-code catalog change is a TWO-FILE change: `errorCatalog.ts`
>    (new entry + `getErrorCodesByCategory()` mapping) AND
>    `packages/domain/src/validation/types.ts` (new `ErrorCategory.PLAN_LIFECYCLE`
>    enum entry, ~line 19). Without the enum entry, the
>    `getErrorCodesByCategory()` map key has no symbol to reference.
> 3. `lint-error-codes.js` uses `CODE_PATTERN = /ERROR-[A-Z]+-\d+/g` on
>    literal source text. The plan's string-concatenation trick
>    (`'ERROR-PLAN-' + '001'`) genuinely bypasses detection — the lint has
>    NOT been hardened against split-string assembly.
>    `validate-solutions.js:85-87` uses exactly this idiom for SOL codes.
> 4. The `paths:` trigger `packages/**/*.ts` already covers
>    `packages/domain/src/validation/errorCatalog.ts` — no explicit catalog
>    path entry needed. Adding `plans/**` is the only `paths:` extension
>    required.
> 5. CONTRIBUTING.md lines 155-163 confirm: changeset gate scope is
>    `^plugins/[^/]+/` only. Changes to `packages/`, `scripts/`,
>    `tests/integration/`, `.github/workflows/`, and `plans/` are exempt.
>    PR #1 needs no changeset.
> 6. `vitest.config.ts` has no explicit include glob (only
>    `passWithNoTests: true`). Default `**/*.{test,spec}.{ts,mts,cts}` will
>    auto-discover `tests/integration/validate-plans.test.ts`. No config
>    change needed.
<!-- /deepen-plan -->

- [ ] 1.0: Register the error code across TWO files in
  `packages/domain/src/validation/`:
  - **`types.ts`** (~line 19): add `PLAN_LIFECYCLE = 'PLAN_LIFECYCLE'` to
    the `ErrorCategory` enum. Without this, the catalog's category-mapping
    key has no symbol to reference.
  - **`errorCatalog.ts`**: add a new section `// Plan Lifecycle Errors (PLAN)`
    after the SOL block (~line 89) containing
    `PLAN_STRAY_CHECKBOX: 'ERROR-PLAN-001'`, plus a corresponding
    `[ErrorCategory.PLAN_LIFECYCLE]: [ERROR_CODES.PLAN_STRAY_CHECKBOX, ...]`
    entry in `getErrorCodesByCategory()` (~line 254/299-302 region,
    matching the SOL pattern).

  Then in `scripts/validate-plans.js`, assemble the code via string
  concatenation (e.g., `const PLAN = 'ERROR-' + 'PLAN'; const PLAN_001 = PLAN + '-001';`)
  so `scripts/lint-error-codes.js` does NOT flag the validator as
  re-implementing the catalog. The pattern is documented in
  `validate-solutions.js:85-87` ("Error codes are assembled via string
  concatenation so `scripts/lint-error-codes.js` does not flag this file
  as re-implementing them"). Required because `lint-error-codes.js` now
  runs inside the `validate:schemas` chain and will fail CI on any
  `scripts/*.js` that hard-codes an `ERROR-<CAT>-NNN` catalog string.
- [ ] 1.1: Implement `scripts/validate-plans.js`. Behaviour:
  - Compute the PR-touched file set via
    `git diff --name-status -z "$BASE_REF...HEAD" -- 'plans/complete/'`
    where `BASE_REF` defaults to `origin/main` and is overridable via the
    `PLAN_VALIDATOR_BASE_REF` env var.
  - Parse `A` / `M` / `R<score>` records from the NUL-separated stream
    (matching `scripts/validate-solutions.js` lines 128–164). For each
    record:
    - `A <path>` or `M <path>` → use `<path>` as-is.
    - `R<score> <old> <new>` → use `<new>` (the destination path). This
      catches `git mv plans/foo.md plans/complete/foo.md` whether or not
      rename detection fires; we do not need `--no-renames`.
    - Skip `D` (deletions) — the archived file no longer exists.
  - Filter to paths matching `^plans/complete/.*\.md$`.
  - For each surviving path, count `^\s*- \[ \]` lines in the file at HEAD.
    If non-zero, emit `ERROR-PLAN-001` via inline `emitError(file, line, code, msg)`
    and `emitNotice(msg)` helpers defined at the top of the validator
    (mirroring `validate-solutions.js` — do NOT import from
    `scripts/lib/logging.js`; the diff-scoped pattern uses inline emitters
    that switch on `IS_CI = process.env.GITHUB_ACTIONS === 'true'` to
    produce `::error file=PATH,line=N::CODE: MSG` annotations on CI or
    plain `[validate-plans] error: ...` stderr lines locally). Set the
    failure flag.
  - **Fence-blind grep is intentional (YAGNI):** The grep is a simple
    `^\s*- \[ \]` line scan, NOT a markdown AST parse. It will count
    `- [ ]` lines that appear inside ``` ``` ``` fenced code blocks as
    real findings. Survey of the current corpus (2026-05-28): 0 of 71
    archived plans contain stray `- [ ]` inside code fences — all 38
    stray-box files have them in prose. No need for a fence-aware state
    machine. If a future plan needs to include a literal `- [ ]` inside
    a code block, the author should either escape it (`- \[ \]`) or use
    `- [x]` as a placeholder. Document this in the validator header
    comment; revisit if false positives ever materialize.
  - Exit 1 if any failures, exit 0 otherwise.
  - **Synthetic-diff override:** Honour `PLAN_VALIDATOR_DIFF` env var —
    a newline-separated list of `A\t<path>` / `M\t<path>` / `R<score>\t<old>\t<new>`
    records (mirroring `git diff --name-status` output, no `-z` for
    test-author ergonomics). When set, bypass `git diff` entirely. Used by
    integration tests (see 1.3).
  - **No-op cases (exit 0):**
    - PR touches no files under `plans/complete/`.
    - `BASE_REF` is unreachable (e.g., shallow clone) — emit a warning to
      stderr (`[validate-plans] warn: cannot reach <ref> — fetch-depth: 0?`)
      and exit 0; CI is responsible for fetching the base. Document the
      recipe in the validator's header comment.
  - **Path-traversal guard:** Refuse to operate when `PLANS_DIR` resolves
    outside the project root, with a temp-dir exception for vitest
    fixtures. Use the same pattern as `validate-solutions.js` lines 60–73.
- [ ] 1.2: Add `"validate:plans": "node scripts/validate-plans.js"` to
  `package.json` scripts. **Do NOT add to the `validate:schemas` chain.**
  `validate:schemas` is the plugin schema gate (marketplace + plugin +
  setup-all + agent-authoring + error-codes + snippets + solutions);
  plan-lifecycle rules are a different concern per `CLAUDE.md`.
  Wire as a **sixth matrix target** in
  `.github/workflows/validate-schemas.yml` alongside the existing five
  (`marketplace`, `plugins`, `contracts`, `examples`, `solutions`). Concretely:
  - Add `- plans` to the `strategy.matrix.target` list.
  - Add a `case "${{ matrix.target }}" in` branch that runs
    `node scripts/validate-plans.js`, wrapped in an `::group::` block
    matching the surrounding pattern.
  - Pass through `PLAN_VALIDATOR_BASE_REF: ${{ github.base_ref != '' &&
    format('origin/{0}', github.base_ref) || 'origin/main' }}` on the
    step's `env:` block (the existing `VALIDATE_SOLUTIONS_BASE_REF` line
    is the template).
  - Update the `paths:` triggers to add `plans/**` so PRs that only touch
    plan files still run the gate. (No explicit `errorCatalog.ts` entry
    needed — the existing `packages/**/*.ts` trigger already covers it.
    Confirmed against `.github/workflows/validate-schemas.yml` lines 6-15.)
  Matrix-target wiring inherits the existing < 2-minute timeout, fork-PR
  gating, and per-target log artifact for free.
- [ ] 1.3: Vitest integration test in
  `tests/integration/validate-plans.test.ts`. Use the
  `PLAN_VALIDATOR_DIFF`-injection pattern (no `mkdtempSync`/bare-git-init),
  mirroring the style of `tests/integration/validate-solutions.test.ts`:
  ```ts
  const result = spawnSync('node', [VALIDATOR], {
    env: {
      ...process.env,
      PLAN_VALIDATOR_DIFF: 'A\tplans/complete/clean.md',
      PLANS_DIR: fixtureDir,
    },
    encoding: 'utf8',
  });
  ```
  **Never mutate `process.env` directly** (e.g.,
  `process.env.PLAN_VALIDATOR_DIFF = '...'` followed by `spawnSync`). Within
  one Vitest worker, tests share `process.env`; direct mutation creates
  order-dependent cross-test races. Always pass env as a per-spawn override
  via the spread above. Reference test pattern uses the `runScript(opts)`
  helper at `tests/integration/validate-solutions.test.ts:51` — copy that
  helper shape if useful.
  Cases: PR adds clean file (PASS), PR adds dirty file with stray `- [ ]`
  (FAIL with `ERROR-PLAN-001`), PR modifies file in `plans/complete/` to
  add stray boxes (FAIL), PR touches files outside `plans/complete/` only
  (PASS — no-op), repository has pre-existing dirty files in
  `plans/complete/` but PR doesn't touch them (PASS — the core YAGNI
  behaviour), PR archives a plan via rename (FAIL when the destination
  has stray boxes, PASS when clean — exercises the `R<score>` parse
  branch), `BASE_REF` unreachable (PASS with stderr warning), path
  traversal in synthetic-diff record (e.g.,
  `A\tplans/complete/../../../etc/sneaky.md` → exit 0 with
  `rejecting suspicious diff path` on stderr; mirrors
  `validate-solutions.test.ts` rejection cases), empty diff (PASS with
  `no plans/complete/ changes in diff`).

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
    Options: `Other` (opens free-text — user types the PR number),
    `Cancel`. **The label MUST be the literal string `Other`** —
    per MEMORY.md "AskUserQuestion 'Other' is the ONLY free-text
    button", any other label (e.g., `Confirm with PR number`) shows
    as a regular click-only option and does NOT open a text input.
    On confirmed PR-number override, capture the user's response and
    store as `OVERRIDE_PR_NUM` for the commit trailer in step 3.10.

  Word-boundary protection: the `--jq` post-filter requires `$SLUG` to be
  separated from surrounding characters by `^`, `$`, `/`, `_`, or `-`. This
  prevents short or generic slugs (`refactor`, `fix`) from matching
  unrelated PRs whose branch names contain the slug as a substring inside
  another word.

<!-- deepen-plan: external -->
> **Research:** GitHub's `in:title` qualifier is token-based, hyphens act
> as token separators, and the search is case-insensitive. A query
> `in:title "foo-bar"` tokenizes to `[foo, bar]` and will match a PR titled
> "foo bar" (and likely "foo_bar"). Quoted strings enforce token-sequence
> order, NOT raw-string equality — there is no character-exact mode for
> issue/PR title search (GitHub Community Discussion #17956, #58606). For
> our purposes this means `gh pr list --search 'in:title "<slug>"'` is a
> COARSE pre-filter; the authoritative match comes from the post-filter
> regex on `headRefName` (which IS exact substring + word-boundary). The
> existing design is correct as-is — this annotation just clarifies why
> the title search alone is not authoritative.
<!-- /deepen-plan -->

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
  `git commit -m "$SUBJECT" -m "$BODY"`. **Do NOT use
  `gt commit create -m "$SUBJECT" -m "$BODY"`** — it concatenates the
  two `-m` values with a literal comma (`"subject,body line 1..."`)
  instead of producing the standard subject + blank-line + body shape.
  Standard `git commit` correctly handles multiple `-m` as separate
  paragraphs (git docs: "their values are concatenated as separate
  paragraphs"). Graphite picks up the commit on the current branch via
  `gt submit` in step 3.11.

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

- `packages/domain/src/validation/types.ts` (add
  `PLAN_LIFECYCLE = 'PLAN_LIFECYCLE'` to the `ErrorCategory` enum, ~line 19;
  required so `errorCatalog.ts` has the symbol to reference)
- `packages/domain/src/validation/errorCatalog.ts` (add `PLAN_STRAY_CHECKBOX`
  entry + `getErrorCodesByCategory()` mapping; required for
  `lint-error-codes.js` compliance — see Task 1.0 for line refs)
- `plugins/yellow-core/README.md` (command catalog)
- `plugins/yellow-core/CLAUDE.md` (`/plan:*` section)
- `package.json` (add `validate:plans` script entry — NOT in
  `validate:schemas` chain)
- `.github/workflows/validate-schemas.yml` (add `plans` as sixth matrix
  target alongside the existing `marketplace`/`plugins`/`contracts`/
  `examples`/`solutions`; pass `PLAN_VALIDATOR_BASE_REF`; extend `paths:`
  triggers to add `plans/**` — `packages/**/*.ts` already covers the
  catalog file)

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
- **Description:** Add scripts/validate-plans.js (PR-diff-scoped, no frontmatter) plus error-code catalog entry, integration tests, and CI wiring as a sixth matrix target in validate-schemas.yml
- **Scope:** packages/domain/src/validation/types.ts, packages/domain/src/validation/errorCatalog.ts, scripts/validate-plans.js, package.json, tests/integration/validate-plans.test.ts, .github/workflows/validate-schemas.yml
- **Tasks:** 1.0, 1.1, 1.2, 1.3
- **Depends on:** (none)
- **Changeset:** none required (no `plugins/*` files touched)

### 2. agent/feat/plan-commands
- **Type:** feat
- **Description:** /plan:status read-only dashboard + /plan:complete two-gate archival (runtime slug, single-gh-call Gate C, override trailer) + docs + changeset
- **Scope:** plugins/yellow-core/commands/plan/status.md, plugins/yellow-core/commands/plan/complete.md, plugins/yellow-core/README.md, plugins/yellow-core/CLAUDE.md, plugins/yellow-core/tests/plan-commands.bats, docs/solutions/workflow/plan-lifecycle-management.md, .changeset/*.md
- **Tasks:** 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 4.2, 4.3, 5.1, 5.2, 5.3, 5.4
- **Depends on:** #1
- **Changeset:** required (yellow-core, minor — new commands)

## Stack Progress

<!-- Updated by workflows:work. Do not edit manually. -->
- [x] 1. agent/feat/validate-plans-pr-scoped (submitted 2026-05-28 — PR #556 https://github.com/KingInYellows/yellow-plugins/pull/556)
- [ ] 2. agent/feat/plan-commands

## References

<!-- deepen-plan: external -->
> **Research:** External knowledge folded in from the deepen-plan run
> (2026-05-28). Four lessons that confirm or supplement the design:
>
> 1. **`actions/checkout@v4` `fetch-depth: 0` remains correct.** No 2025
>    changes to fetch semantics; v6 only relocated credential storage. For
>    PR-diff-scoped validators in light repos, `fetch-depth: 0` is the
>    right default. (`actions/checkout#266`,
>    https://github.com/actions/checkout/issues/266; `pre-commit#1554`)
> 2. **New matrix targets inherit concurrency-group semantics.** Adding
>    `plans` as a 6th target does NOT change cancellation behavior for
>    existing targets; the job-level concurrency group at the workflow
>    head applies to all matrix shards uniformly. (GitHub Actions docs —
>    "control the concurrency of workflows and jobs"; Community Discussion
>    #26774.) Workflow-level `paths:` filters cannot be per-target — they
>    gate the entire workflow. For our case this is fine: `plans/**` added
>    to the existing `paths:` list triggers the workflow as a whole, and
>    the `plans` target runs unconditionally inside it (no per-target
>    filtering needed).
> 3. **Vitest `process.env` is shared within a worker.** Direct mutation
>    creates order-dependent races between tests in the same file
>    (`jest#9264` generalizes). Always pass env as a per-spawn override
>    (see Task 1.3). Reserve `execa` only if you need streaming — for our
>    case `spawnSync` is simpler and sufficient.
> 4. **No established prior art for "no stray checkboxes in archived
>    plans" gates.** markdownlint (`DavidAnson/markdownlint`) has no
>    semantic-state rules; vale.sh is prose-only. The `grep`-on-diff
>    approach IS the established pattern for bespoke line-level gates in
>    monorepo CI. Lesson from markdownlint plugin authors: scope the
>    rule at the CI invocation level (which we do via PR-diff-scoping),
>    not inside the rule body. (Microsoft Engineering Fundamentals
>    Playbook — "Automating markdown checks".)
<!-- /deepen-plan -->

- Brainstorm (superseded for several decisions): `docs/brainstorms/2026-05-08-plan-lifecycle-management-brainstorm.md`
- **Canonical PR-diff-scoped validator template:** `scripts/validate-solutions.js`
  (preferred reference for Phase 1; mirror its `BASE_REF` env var, `*_DIFF`
  synthetic-injection env, GitHub Actions annotation emit, and path-traversal
  guard with temp-dir exception)
- Older validator patterns (acceptable but less complete): `scripts/validate-marketplace.js`
- Error-code catalog: `packages/domain/src/validation/errorCatalog.ts`;
  catalog-drift lint: `scripts/lint-error-codes.js`
- Shared logging helpers: `scripts/lib/logging.js`
- Reference command: `plugins/yellow-core/commands/worktree/cleanup.md` (uses `gh pr list --head`)
- Reference test pattern (PR-diff-scoped validator integration test):
  `tests/integration/validate-solutions.test.ts`
- Merge-queue / `mergedAt` gotcha: `docs/solutions/integration-issues/merge-queue-closed-pr-null-mergedat-detection.md`
- Bash hardening: `MEMORY.md` "Bash Hook & Validation Patterns" section
- Command anti-patterns: `docs/solutions/code-quality/claude-code-command-authoring-anti-patterns.md`
- PR #484 review issues driving the first revision: `#494` (P0/P1 design), `#496` (YAGNI scope reductions)
