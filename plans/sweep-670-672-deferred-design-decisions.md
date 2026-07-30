# Feature: Sweep-All Close-Out — Deferred Design Decisions

> **Status: point-in-time record — all tasks complete.** Implemented by:
> Phase 1 → PR #677, Phase 2 → PR #678, Phase 3 → PR #679, Phase 4 → PR
> #680 (committed root `.codacy.yml` — the deepen-plan research below
> prevailed over the originally-planned manual dashboard route). All four
> PRs were still OPEN (not merged) as of 2026-07-30; archive this plan
> via `/plan:complete` only after they merge. Line numbers throughout are
> authoring-time snapshots — re-locate by content, not line number.

Source brainstorm:
`docs/brainstorms/2026-07-29-sweep-all-close-out-deferred-design-deci-brainstorm.md`

## Problem Statement

Four decisions were deliberately deferred out of the #670–#672 sweep-all
close-out and resolved in the brainstorm above: the devin-orchestrator's
cap-safety behavior, generate-manifests' failure-scoping granularity, a
polish batch, and the recurring Codacy MD041 false positive. This plan
turns those decisions into three small PRs plus one out-of-repo action.

**Post-brainstorm refinements** (from research + spec-flow analysis, and
one user decision made during planning):

- **Item 2 is REPORTING-ONLY scoping** (user decision, 2026-07-29): apply
  mode stays all-or-nothing atomic — no partial writes. The per-plugin
  granularity lands in the result object and error output only. This
  supersedes the brainstorm's ambiguous "unaffected plugins regenerate
  normally" phrasing.
- Item 3's generate-manifests wording fix moves INTO item 2's PR (same
  call sites; a separate polish pass would be immediately rewritten).
- The `<int>` placeholder count is **8 files** (7 reviewer agents +
  `review-pr.md:497`, per task 3.1's codebase note), not the brainstorm's
  6 or this refinement's original 7.
- Item 3's PR needs its own changeset (yellow-review, patch) — the CI
  changeset gate has no comment-only exemption.

## Current State

- `devin-orchestrator.md:66-80` ends its cap flow with "omit and
  disclose" for BOTH the non-interactive path (gated on an undetectable
  "no user is available to ask") and the interactive invalid-twice path;
  lines 146 and 162 render the identical, interactive-path-inaccurate
  string `none (max_acu_limit omitted — no user available)`.
- `scripts/generate-manifests.js` accumulates all errors in one shared
  array gated twice (`errors.length > 0` at ~302 and ~594); every error
  string is already plugin-prefixed but the result object has no
  per-plugin field. Some CLI-arg error prints lack the `ERROR:` tag that
  data errors carry.

<!-- deepen-plan: codebase -->
> **Codebase:** There are actually THREE `errors.length > 0` occurrences
> (lines 302, 594, 659) — the third is the final status-aggregation check
> before `return result` at 662 (no early return), functionally distinct
> from the two abort gates. Also `main()` starts at line 665, not ~692
> (692 is mid-function inside the GENERATE_MANIFESTS_ROOT block);
> correct range ~665-730. Task 2.1's "both gates keep abort semantics"
> should also leave the line-659 aggregation check untouched.
> *[Post-review correction: this note's own numbers were offset ~13 —
> against the file as it stood at authoring, the third gate was at 646,
> `main()` at 652, GENERATE_MANIFESTS_ROOT at 674. The structural claims
> (three occurrences, aggregation-vs-abort distinction) are correct;
> re-locate by content.]*
<!-- /deepen-plan -->
- 8 files (7 reviewer agents + `review-pr.md`) contain a `"line": <int>,`
  placeholder inside a strict JSON example fence; `emit-codex.js` duplicates its
  symlink-rejection block (skillDir ~357-367 vs refDir ~406-428, the
  latter with two indirection flags); `validate-codex.js:253` compiles a
  RegExp inside a per-sibling loop that itself runs once per exposed
  file.
- The memory doc `codacy-md041-changeset-false-positive.md` still claims
  the `.codacy/codacy.yaml` exclude suffices; the failing check is the
  Codacy Cloud GitHub App, which reads dashboard config only.

## Proposed Solution

Three PRs (1 → independent; 2 before 3 would also be fine — they no
longer share files after the wording-fix move) plus a manual action:

- **PR A — devin-orchestrator cap-safety** (changeset: yellow-devin,
  patch)
- **PR B — generate-manifests per-plugin reporting + wording
  consistency** (scripts + tests only; no changeset)
- **PR C — polish batch** (changeset: yellow-review, patch; emit-codex/
  validate-codex are scripts, no extra changeset entry needed)
- **Manual — Codacy dashboard + memory update** (no repo PR)

## Implementation Plan

### Phase 1: PR A — devin-orchestrator cap-safety rework

- [x] 1.1: Rewrite the `max_acu_limit` block (Step 2, ~lines 66-80) as
      two explicit branches replacing (not alongside — delete the old
      terminal "omit ... instead of blocking" clause) the current single
      flow:
      - **Interactive:** unchanged up through the existing `Other` +
        `^[0-9]+$` + re-prompt-once flow. NEW: after the second invalid
        input, a THIRD AskUserQuestion: "The cap was invalid twice.
        Launch without a cost cap, or pick a preset?" with options
        `Launch uncapped` (explicit, first) and 1-2 concrete preset caps
        (reuse the same presets offered in the first question). Only an
        active `Launch uncapped` selection may produce an uncapped
        session on this path; choosing a preset uses it; the built-in
        `Other` escape re-enters `^[0-9]+$` validation once more (if
        that is again invalid, repeat this third question — the loop
        exits only via a preset or `Launch uncapped`). Preserve the
        canonical "only the literal `Other` label opens free-text input"
        phrasing.
      - **Non-interactive:** honored ONLY when the spawn prompt
        explicitly declares non-interactive mode (define the contract in
        this file's own body — e.g. "the spawn prompt states it is
        non-interactive / no user is available"; the declaration is a
        documented input, not a runtime inference — delete the "no user
        is available to ask" wording). Declared + no cap → omit
        `max_acu_limit` as the documented default. Declared + cap
        present but failing `^[0-9]+$` → do NOT create the session;
        report the invalid cap in the failure report (a caller that
        tried to set a cap must not be silently launched uncapped).

<!-- deepen-plan: codebase -->
> **Codebase:** No existing agent .md implements a "loop exits only via
> explicit choices" re-ask pattern — the closest is devin-orchestrator's
> own current single re-prompt. The third-question wording in 1.1 is new
> phrasing written from scratch, not adapted from a known-good template;
> budget review attention accordingly.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** The design matches four established confirm-gate norms:
> fail closed on invalid input (never default into the expensive path);
> default-to-no for costly choices (the uncapped option must be an
> affirmative selection, never the implicit default); non-interactive
> callers pre-declare intent (the `--yes`-flag idiom); and the prompt
> text must state the concrete cost implication, not a bare "are you
> sure?" — e.g. "Launch without a cost cap? Auto-retry loops will not
> stop on spend." Use distinct wording from the capped path's prompt.
> See: https://www.lucasfcosta.com/blog/ux-patterns-cli-tools,
> https://learn.microsoft.com/en-us/windows/win32/uxguide/mess-confirm
<!-- /deepen-plan -->
- [x] 1.2: Diverge the two `Cap:` render sites (~146 success, ~162
      failure) with branch-accurate strings; proposed:
      - `none (uncapped — non-interactive default, no cap in spawn prompt)`
      - `none (uncapped — user chose "Launch uncapped" after invalid input)`
      Both sites must carry both variants (the template shows which
      string to substitute per branch); never reuse one string across
      branches. Grep the whole file afterward for the retired
      `no user available` phrasing (multi-place render-site drift
      pattern).
- [x] 1.3: Changeset (`yellow-devin`, patch) + run
      `pnpm validate:agents` and full `pnpm validate:schemas`.
- [x] 1.4: Note in the PR body that this item has no automated gate
      (validate-agent-authoring has no AskUserQuestion-flow rules) —
      review is the verification.

### Phase 2: PR B — generate-manifests per-plugin result reporting

- [x] 2.1: Add a `results` field to the return object:
      `results: { [pluginName]: 'ok' | 'error' }`, populated for every
      plugin in `catalog.pluginOrder`. Attribution: when a validation /
      package.json / stale-sweep error is pushed for plugin `name`, set
      `results[name] = 'error'`. Catalog-WIDE errors (catalog.json
      shape, pluginOrder, duplicates, cross-checks) do not attribute to
      a plugin; they keep the existing global behavior and leave
      `results` entries as computed. Both `errors.length > 0` gates KEEP
      their abort semantics (reporting-only decision) — `status` stays
      the aggregate, and `--check` exit codes are unchanged.
      **Non-success state, resolved:** "as computed" is documented
      empty-map semantics, not an omission. `results` starts as `{}`
      and the per-plugin pre-populate loop (`results[name] = 'ok'` for
      every `pluginOrder` entry) runs only *after* `loadCatalog()`
      succeeds — every catalog-wide abort path (missing catalog,
      invalid shape, duplicate `pluginOrder`) returns before that loop,
      so `results` stays `{}` on those paths. A caller therefore reads
      `{}` as "catalog-wide abort, no plugin was evaluated" and never
      mistakes it for per-plugin success; this is asserted directly
      (duplicate `pluginOrder` case: `expect(result.results).toEqual({})`)
      in PR #678's `tests/integration/generate-manifests.test.ts`. No
      separate `skipped`/`unknown` state was needed — shipped as-is.

<!-- deepen-plan: codebase -->
> **Codebase:** Adding `results` is confirmed additive-safe: the only
> external consumer, `scripts/sync-manifests.js:182-184`, reads just
> `.status`/`.errors`; no test does whole-object equality on the return
> value; `packages/` has zero references. Note there is NO per-item
> result-map precedent anywhere in `scripts/` (validate-plugin.js keeps
> only a boolean `hasErrors`) — say so in the PR body rather than
> implying an existing pattern is being extended.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** The additive-sibling-field shape matches ESLint's model
> (per-file `LintResult[]` detail alongside a CLI-derived aggregate) and
> the general non-breaking-API consensus: add an optional field old
> consumers ignore; never fold per-item detail into the existing
> `errors[]` or repurpose `status`. Populate `results` even on abort so
> callers can inspect per-plugin state from a failed run.
> See: https://eslint.org/docs/latest/integrate/nodejs-api,
> https://prettier.io/docs/cli
<!-- /deepen-plan -->

- [x] 2.2: Per-plugin loud logging in `main()`: on error status, print
      one line per errored plugin
      (`[generate-manifests] ERROR: plugin <name>: <n> error(s)`) before
      the detailed error list, and add GitHub Actions annotations
      (`::error file=catalog/plugins/<name>.json::…`) gated on
      `process.env.GITHUB_ACTIONS === 'true'`, matching
      validate-plans.js / validate-solutions.js conventions.
      Constraint: do NOT embed literal `ERROR-[A-Z]+-\d+` catalog codes
      in this script — `lint-error-codes.js` fails CI on duplication.

<!-- deepen-plan: codebase -->
> **Codebase:** Annotation precedent verified exactly: both siblings
> gate on `const IS_CI = process.env.GITHUB_ACTIONS === 'true'`
> (validate-plans.js:78, validate-solutions.js:80) and emit
> `console.log(`::error file=${file}...::${code}: ${msg}`)`
> (validate-plans.js:99-103, 211-215, 276-280;
> validate-solutions.js:113-117). Mirror that shape.
<!-- /deepen-plan -->
- [x] 2.3: Wording consistency (absorbed from the polish batch): give
      the CLI-argument error prints (~670-676) the same
      `[generate-manifests] ERROR:` tag as data errors; normalize the
      `Note:` line. No change to `errors[]` string formats (tests match
      substrings).
- [x] 2.4: Tests: extend (not rewrite) the mutation suites — in
      `generate-manifests.test.ts`'s value-shape block and a
      representative subset of `generate-manifests-codex.test.ts`'s
      per-plugin error tests, add assertions that
      `result.results['<mutated-plugin>'] === 'error'` and at least one
      untouched plugin reports `'ok'`. Add one test asserting a
      catalog-wide error (e.g. duplicate pluginOrder entry) still
      returns global `status: 'error'`. The byte-identity
      characterization suite must pass unchanged.
- [x] 2.5: Audit while in the file (fold in only if trivial; otherwise
      record as follow-up in the PR body): the unguarded
      `assertWithinRoot` call sites (~315, 336, 343, 355, 590) throw
      past the `{status, errors}` contract on path escape — wrap to push
      into `errors` with plugin attribution.

<!-- deepen-plan: codebase -->
> **Codebase:** The five-site list (315, 336, 343, 355, 590) is verified
> precise — it correctly excludes line 269, which is already wrapped in
> try/catch (268-273) and pushes to `errors`. No outer try wraps the
> function body, so the five really do escape the contract as claimed.
<!-- /deepen-plan -->

- [x] 2.6: No changeset (scripts/tests only). Gate:
      `pnpm validate:generated && pnpm test:integration && pnpm lint &&
      pnpm typecheck`.

### Phase 3: PR C — polish batch

- [x] 3.1: Replace `"line": <int>,` in the 8 files — `review-pr.md:497`
      (the canonical schema) plus the 7 reviewer mirrors
      (reliability-, project-compliance-, project-standards-,
      plugin-contract-, adversarial-, maintainability-,
      correctness-reviewer.md under their respective plugins) — with a
      valid-JSON example value plus prose stating the type constraint
      outside the fence (anti-pattern #30 treatment).

<!-- deepen-plan: codebase -->
> **Codebase:** The count is EIGHT files, not seven —
> `plugins/yellow-review/commands/review/review-pr.md:497` has the same
> `"line": <int>,` in the same JSON fence, and its surrounding prose
> (lines 485-486) calls it "the canonical source" for the schema the
> 7 reviewer agents mirror. Fix it FIRST, then the 7 mirrors, or the
> canonical/mirror pair drifts. All 7 reviewer-file line numbers
> verified: reliability:112, project-compliance:141,
> project-standards:168, plugin-contract:198, adversarial:196,
> maintainability:111, correctness:106.
<!-- /deepen-plan -->
- [x] 3.2: emit-codex.js symlink-check dedup: extract the shared
      lstat → isSymbolicLink → realpath-compare shape into one helper;
      PRESERVE the two distinct error messages (skills/<name> vs
      …/references) — do not collapse into a generic string. Inline the
      `refDirBad`/`refDirNotDir` flags into direct error-push +
      `continue` while there.
- [x] 3.3: validate-codex.js sibling-regex precompile: hoist the
      per-sibling RegExp construction out of the per-file loop (build a
      `Map<sibling, RegExp>` once per run).
- [x] 3.4: Changeset (`yellow-review`, patch). Run the CI baseline
      (`pnpm validate:schemas && pnpm test:unit && pnpm lint &&
      pnpm typecheck`) plus `pnpm test:integration` (emit-codex/
      validate-codex are covered by integration suites).
- [x] 3.5: Record in the PR body: the "opencode rationale-comment
      dedup" item is EXCLUDED as unconfirmed (plausible referent:
      opencode-reviewer.md:41 — needs a manual read before it can be
      scoped).

### Phase 4: Codacy MD041 (shipped as PR #680 — committed root `.codacy.yml`)

> **Execution note (2026-07-30):** the deepen-plan research below
> prevailed over task 4.1's original manual-dashboard framing — the fix
> shipped as a committed root `.codacy.yml` (PR #680), with the
> dashboard route retained only as fallback. 4.1's text is preserved
> below as the pre-research plan of record.

- [x] 4.1: USER MANUAL ACTION: Codacy dashboard → repo settings →
      ignored paths → add `.changeset/**`. Outside repo tooling; only
      someone with dashboard access can do it. *(Superseded in
      execution — see the note above; the remaining manual step is the
      pre-merge dashboard-subset check tracked in PR #680's body.)*

<!-- deepen-plan: external -->
> **Research:** A committed-file fix IS possible after all — the prior
> attempt used the wrong file. Codacy Cloud reads a ROOT-level
> `.codacy.yml`/`.codacy.yaml` (`exclude_paths:` globally or per-engine
> under `engines: markdownlint:`); the repo's existing
> `.codacy/codacy.yaml` SUBDIRECTORY file is CLI-v2-only (runtime/tool
> pins for local runs) and is never read by the cloud analysis. So the
> preferred fix is committing a root `.codacy.yml` with
> `exclude_paths: [".changeset/**"]` — with three caveats: (1) once the
> root file exists it fully OVERRIDES the dashboard "Ignored files" UI
> (not merged — the UI setting goes inert); (2) it is authoritative once
> merged to the DEFAULT branch — land it on main, don't trust
> feature-branch behavior; (3) tool enablement (turning markdownlint
> on/off) remains dashboard-only, but exclude_paths applies to an
> already-enabled markdownlint. The dashboard route in 4.1 remains a
> valid fallback if the root file misbehaves. Update 4.2's memory note
> to record the three-file distinction (root `.codacy.yml` = cloud;
> `.codacy/codacy.yaml` = local CLI; `.markdownlintignore` = local lint).
> See: https://docs.codacy.com/repositories-configure/codacy-configuration-file/
> and https://docs.codacy.com/repositories-configure/ignoring-files/
<!-- /deepen-plan -->
- [x] 4.2: Update the EXISTING memory file
      `~/.claude/projects/<slug>/memory/codacy-md041-changeset-false-positive.md`
      (`<slug>` is the machine-derived encoding of the repo path, e.g.
      `-home-kinginyellow-projects-yellow-plugins` on this clone; it is
      user/machine-specific — do not create a sibling): the repo-file
      exclude is necessary-but-insufficient — `markdownlint` is not in
      `.codacy/codacy.yaml`'s `tools:` list and no workflow invokes
      `.codacy/cli.sh`; the gating check is the Codacy Cloud GitHub App
      reading dashboard config. Recommend against a third repo-file
      attempt. No CI/changeset implications (outside the repo).

## Technical Details

Key files:

- `plugins/yellow-devin/agents/workflow/devin-orchestrator.md` (~66-80,
  146, 162)
- `scripts/generate-manifests.js` (gates ~302/~594/~646, `main()` ~652,
  CLI-arg prints ~657-662 — authoring-time numbers; re-locate by content)
- `tests/integration/generate-manifests.test.ts` (~235-363),
  `tests/integration/generate-manifests-codex.test.ts` (representative
  subset), `generate-manifests-characterization.test.ts` (must pass
  unchanged)
- 8 files: `review-pr.md` + the 7 reviewer agents (paths in 3.1),
  `scripts/lib/generate/emit-codex.js` (~357-367, ~406-428),
  `scripts/validate-codex.js` (~237-289)

## Acceptance Criteria

1. devin-orchestrator.md contains no "no user is available to ask"
   inference; the non-interactive branch is triggered only by an
   explicit spawn-prompt declaration documented in the file's own body;
   an uncapped interactive launch is reachable only via an explicit
   `Launch uncapped` selection; the two Cap: sites render
   branch-accurate strings. (Prose review — no automated gate.)
2. `generateManifests()` returns a `results` map naming every plugin's
   ok/error status; apply/check abort semantics and exit codes are
   byte-for-byte unchanged (characterization suite green, existing
   status assertions untouched); errored plugins produce per-plugin log
   lines and CI annotations.
3. `rg '"line": <int>,' plugins/` returns nothing (scoped form — see the
   codebase note below; the broad `rg '<int>' plugins/` originally
   written here false-positives on legitimate prose uses); emit-codex
   retains both distinct symlink error messages; validate-codex compiles
   each sibling regex once per run. All three PRs pass the CI baseline.

<!-- deepen-plan: codebase -->
> **Codebase:** This grep is over-broad and would fail on out-of-scope
> matches: `plugins/yellow-core/agents/research/learnings-researcher.md:174`
> and 5 plain-prose bullets in
> `plugins/yellow-core/skills/compound-lifecycle/references/report-template.md`
> (lines 11,16,17,20,21) legitimately use `<int>` outside JSON fences.
> Use the scoped check instead: `rg '"line": <int>,' plugins/` returns
> nothing (8 files fixed — the 7 reviewer agents + review-pr.md:497).
<!-- /deepen-plan -->
4. The Codacy memory file records the local-vs-cloud split (done —
   including the root-file `---` requirement); the exclusion ships as a
   committed root `.codacy.yml` (PR #680), with the dashboard route as
   fallback only; the pre-merge dashboard-subset check is tracked in PR
   #680's body; the next changeset PR after #680 merges shows no MD041
   failure.

## Edge Cases

- Non-interactive + malformed cap → refuse session creation (decided in
  1.1; a caller that tried to cap must not launch uncapped).
- Third-prompt `Other` re-entry loops back to the third prompt on
  repeat invalid input — cannot fall through to uncapped.
- Catalog-wide vs per-plugin error attribution (2.1): catalog.json
  shape errors never attribute to a single plugin.
- A plugin absent from `pkgs` (failed package.json read) must still get
  `results[name] = 'error'`, not be silently missing from the map
  (silent-drop hazard — `manifest-generator-value-shape-validation.md`).

## References

- Brainstorm: `docs/brainstorms/2026-07-29-sweep-all-close-out-deferred-design-deci-brainstorm.md`
- `docs/solutions/workflow/compounder-m3-gate-non-interactive.md` — the
  declared-mode contract must live in the target agent's own file
- `docs/solutions/logic-errors/manifest-generator-value-shape-validation.md`
  — silent-drop prior incident; audit unconditionally-dereferenced
  fields
- `docs/solutions/code-quality/claude-code-command-authoring-anti-patterns.md`
  #30 — JSON placeholder in strict example fences
- MEMORY.md: `plugin-diagnostic-multi-place-state-patterns` (Cap: string
  render-site drift), `codacy-md041-changeset-false-positive`
