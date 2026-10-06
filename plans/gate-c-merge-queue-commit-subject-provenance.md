# Feature: Gate C commit-subject provenance for Graphite merge-queue PRs

## Problem Statement

`/plan:complete` Gate C cannot verify plans delivered through Graphite's merge
queue. Those PRs stay `closed`, `merged: false`, `merged_at: null` permanently,
and their `merge_commit_sha` is a temporary merge-group commit that never
reaches the repo. All three tiers miss them: `commits/{sha}/pulls` returns `[]`,
and strict/loose use `gh pr list --state merged`. About 38 of the last 300
`origin/main` commits are plan archives, so every archive pays a manual
override.

<!-- deepen-plan: external -->
> **Research:** Graphite documents this outcome as intended: "When an enqueued
> PR merges, it will be marked as closed in GitHub instead of merged", because
> the queue fast-forwards trunk to the head commit of a temporary
> `[Graphite MQ] Draft PR` (`gtmq_` branch) it built itself. Graphite documents
> no PR-to-commit mapping and advises integrations to "monitor merged commits
> rather than PR status", which is what this plan does. The exact field values
> (`merged: false`, `merged_at: null`, temporary `merge_commit_sha`) are
> inferred from "closed instead of merged" and from our own observations, not
> stated in the docs. See: https://graphite.com/docs/merge-queue-optimizations
<!-- /deepen-plan -->

Brainstorm: `docs/brainstorms/2026-10-06-gate-c-merge-queue-closed-prs-brainstorm.md`.

## Current State

- Provenance block: `plugins/yellow-core/commands/plan/complete.md` Phase 4,
  lines ~169-245. `FILE_SHA` is `git log -1 origin/$TRUNK -- plans/$CLEAN_ARG`.
  The commits API result sets `PCOUNT`; only `PCOUNT == 1` writes
  `$GIT_TMP/plan-complete.provenance`.
- Phase 7 (lines ~541-595) already turns the provenance file into the
  `Plan-Verifier-FileProvenance:` trailer. Priority: override > provenance >
  loose > count.
- `plugins/yellow-core/tests/plan-commands.bats` re-declares helpers rather than
  running `complete.md`. `flow/plan.md` already sources a tier-4 lib, so a
  command-sourced lib is established precedent.
- Nothing in the repo parses the trailer.

<!-- deepen-plan: codebase -->
> **Codebase:** Corrected extents: the Phase 4 provenance bash block is lines
> 169-233 and the prose after it is 235-247 (not ~245). The commits-API failure
> path only warns and sets `PULLS='[]'` (lines 216-219), so `COMMITS_API_OK` is
> genuinely needed to tell "API failed" from "0 PRs". Lines 3 and 22-37 describe
> file provenance, then strict, then loose, but never say "three tiers".
<!-- /deepen-plan -->

## Proposed Solution

Add a commit-subject fallback inside the provenance tier (still three tiers).
It runs only when the commits API call **succeeded** with an empty result and
`FILE_SHA` exists. Logic lives in a dual-shell tier-4 lib sourced by
`complete.md`.

Pass requires all of:

1. `FILE_SHA` is 40 hex and `git cat-file -e "$FILE_SHA:plans/$CLEAN_ARG"`
   succeeds (plan still exists on trunk at that commit).
2. Subject yields N: last trailing ` (#N)`, validated with the existing
   `^[1-9][0-9]{0,9}$` rule; `Revert "`, `Reapply "` and `Merge ` subjects
   rejected.
3. `gh api repos/$OWNERREPO/pulls/N` reports `state == "closed"`. `merged` is
   not consulted (permanently false here). `base` is recorded, not gated:
   stacked PRs have their parent branch as `base`.
4. Paginated `pulls/N/files` (`per_page=100`, written to a file, evaluated with
   `jq -s`) has an entry with `.filename == plans/$CLEAN_ARG`,
   `.status != "removed"`, and its blob `sha` equals
   `git rev-parse "$FILE_SHA:plans/$CLEAN_ARG"`.
5. The same file list has at least one `.filename` outside `plans/`, so plan-only
   PRs (creation, checkbox rewrites) fall through to the override.

<!-- deepen-plan: external -->
> **Research:** The files endpoint caps at 3000 files (`per_page` max 100, so
> 30 pages) and `status` is one of `added`, `removed`, `modified`, `renamed`,
> `copied`, `changed`, `unchanged`. `sha`, `blob_url` and `raw_url` can be
> `null` (submodules and other undocumented cases; see
> github/rest-api-description#1945): treat a null `sha` as "cannot verify" and
> fall through, never as a match or a hard failure. The docs never define `sha`
> in prose; it is the head-side blob SHA by field name and example. The blob
> comparison in condition 4 fails, as designed, when the queue rebased onto a
> trunk that also changed the file or when `.gitattributes` normalises line
> endings. See: https://docs.github.com/en/rest/pulls/pulls
<!-- /deepen-plan -->

On pass, write `pr=#N sha=<FILE_SHA> via=commit-subject` to the provenance file
and print a sentinel line the prose keys on. Trailer text is built only from the
validated N, `FILE_SHA` and the literal `via=commit-subject`. Any failure,
truncation, rate limit or auth error prints a one-line control-stripped reason
and falls through to strict, loose and override. Rejected: candidate-confirm
prompt (keeps the friction), widening strict/loose to `--state closed` (false
positives).

## Implementation Plan

### Phase 1: Library and tests first

- [x] 1.1: Confirm the tier-4 mechanics: `scripts/shell-compat-config.json`
      `tier4Libraries`, `tests/shell-compat/drivers/<plugin>--<basename>`,
      `tests/shell-compat/tier4-libraries.bats`, and the `gh` mock in
      `plugins/yellow-review/tests/mocks/gh`.
- [x] 1.2: Create `plugins/yellow-core/lib/plan-gate-provenance.sh` with
      `pr_num_is_valid` (shared with the override validator), `pr_from_subject`,
      and `plan_delivered_by_pr` (state, files, blob, non-plans checks). Use
      `_`-prefixed names, `case` and parameter expansion, no `[[ =~ ]]`.
- [x] 1.3: Register the lib in `scripts/shell-compat-config.json` and add its
      driver; run the extractor table under bash, zsh and zsh+noclobber.
- [x] 1.4: Write the table-driven extractor tests and the predicate tests with a
      stubbed `gh` (matrix below) before touching `complete.md`.

<!-- deepen-plan: codebase -->
> **Codebase:** Confirmed: `tier4Libraries` in `scripts/shell-compat-config.json`
> is a flat array of repo-relative paths; the driver is
> `tests/shell-compat/drivers/yellow-core--plan-gate-provenance.sh` (basename
> keeps `.sh`). `tier4-libraries.bats` runs each driver under every shell
> profile with only `REPO_ROOT` and `TMPD` set and requires exit 0, empty
> stderr, non-empty stdout, and byte-identical stdout across profiles. The
> template is `lib/repo-profile.sh` with `drivers/yellow-core--repo-profile.sh`,
> sourced by `flow/plan.md:199` as
> `source "${CLAUDE_PLUGIN_ROOT}/lib/repo-profile.sh"`.
<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->
> **Codebase:** Correction to the stubbed-`gh` assumption: the mock at
> `plugins/yellow-review/tests/mocks/gh` has no `repos/.../pulls/N` or
> `commits/*/pulls` arm, its files fixtures carry no blob `sha`, and it ignores
> `--paginate`; reusing it would also be a cross-plugin test dependency.
> `plugins/yellow-core/tests/mocks/gh` is a forbidden-command shim that exits
> 97. Write a small scenario stub into `$TMPD/bin` inside the driver or bats
> test instead, with stdout identical across shell profiles.
<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->
> **Codebase:** Lib rules from `scripts/validate-shell-compat.js`: SHC-008 fails
> if a command sources a lib that is in neither tier list (registration fixes
> it); a new `.sh` needs a shebang or the `# shell-compat: library` marker
> (SHC-101); no `mapfile`, `BASH_REMATCH`, `${!x}`, 0-based array indexing, and
> use `>|` onto files that may exist. Follow `repo-profile.sh`: a
> `_..._LOADED` idempotency guard and no top-level `set -e` in the lib.
<!-- /deepen-plan -->

### Phase 2: Wire into `complete.md`

- [x] 2.1: At the top of the first Phase 4 block, `rm -f` all five
      `$GIT_TMP/plan-complete.*` files so an aborted run cannot leak a stale
      provenance into the next plan's commit.

<!-- deepen-plan: codebase -->
> **Codebase:** Only four temp files exist today (`count`, `override`, `loose`,
> `provenance`), and Phase 0 (lines 62-66) already clears them, with a second
> cleanup at line 590. Task 2.1 therefore only adds protection if Phase 4 itself
> can be re-entered after an abort or if a fifth file is introduced. Say "all
> four" in the task, keep the Phase 4 `rm -f` as defence in depth, and add a test
> that proves a stale `.provenance` is not committed.
<!-- /deepen-plan -->
- [x] 2.2: Set `COMMITS_API_OK=1` only when the commits API call succeeds. Run
      the new path only when `COMMITS_API_OK=1`, `PCOUNT == 0`, `FILE_SHA` and
      `OWNERREPO` are non-empty. `PCOUNT >= 2` still falls through.
- [x] 2.3: Source the lib and call it; guard every git/gh call with
      `|| VAR=''` (the block runs under `set -euo pipefail`); wrap `gh` in
      `timeout`; use `>|` for files that may exist. Do not fake `PCOUNT=1`.

<!-- deepen-plan: codebase -->
> **Codebase:** No yellow-core lib has a `gh` or `timeout` helper.
> `plugins/yellow-review/lib/resolve-gh.sh` has `rg_gh` (a `timeout`/`gtimeout`
> wrapper) and `rg_is_rate_limited` / `rg_is_auth_failure`, but it is in neither
> tier list (sourcing it trips SHC-008) and yellow-core has no dependency on
> yellow-review. Re-implement a minimal classifier in the new lib: a
> `timeout`/`gtimeout` probe plus three greps (`rate limit|abuse|HTTP 429`,
> `HTTP 401|Bad credentials`, `HTTP 403|Resource not accessible`), testing rate
> limit before 403, and cite `resolve-gh.sh` as the source. The paginated files
> list needs an `mktemp` file written with `>|` and removed in the same Bash
> call; a trap does not survive across tool calls.
<!-- /deepen-plan -->
- [x] 2.4: Add the `git cat-file -e` guard to the whole provenance tier (also
      protects the existing `PCOUNT == 1` path against a stale local checkout).
- [x] 2.5: Print a sentinel on pass and per-class failure messages (not found,
      auth, rate limit, timeout, bad JSON, truncated list, open PR "retry
      shortly"). Print `OWNERREPO` in the new path's output.
- [x] 2.6: Rewrite the Phase 4 prose (lines ~235-245, comment at ~203-214) to
      key on the sentinel and provenance file. Branch the Phase 7 body on
      `*' via=commit-subject'` so it no longer claims a "merged PR".

<!-- deepen-plan: codebase -->
> **Codebase:** The "merged PR" claim appears in more places than the Phase 7
> provenance body (line 571): the Phase 4 comments at lines 211 and 223, the
> `printf` at line 223 ("%d merged PR(s) associated"), and the Phase 7 default
> `else` body at line 580 ("N merged PR(s) found via gh pr list --state
> merged"). Reach all of them, and do not reuse the `PCOUNT >= 1` print loop
> (lines 224-229) for the new path.
<!-- /deepen-plan -->

### Phase 3: Docs

- [x] 3.1: `docs/solutions/workflow/squash-commit-ancestry-verification-in-merge-queue.md`:
      replace "`/plan:complete` Gate C does not run it". Gate C still runs no
      `--is-ancestor`; `FILE_SHA` comes from `git log origin/$TRUNK`.
- [x] 3.2: `docs/solutions/workflow/plan-lifecycle-management.md`: add
      `## Update - 2026-10-06` (null `merged_at` is permanent for
      Graphite-landed PRs; commit-subject path handles it). Supersede the
      "use `Plan-Verifier-Override`" guidance and the "`merged` is
      authoritative" wording by update note, not by rewriting history.
- [x] 3.3: `docs/solutions/integration-issues/merge-queue-closed-pr-null-mergedat-detection.md`:
      qualify the `merged=false, mergedAt=null, no queue-ejected` decision-table
      row (also Graphite-landed when the subject-referenced commit is on trunk).
- [x] 3.4: Sweep "three tiers" wording to one phrasing ("the provenance tier
      gains a commit-subject fallback"): `plugins/yellow-core/CLAUDE.md`
      (`/plan:complete` bullet), `plugins/yellow-core/README.md:33`,
      `docs/CONCEPTS.md:87-95`, `complete.md` lines 3 and 22-37. Note that the
      absence of `via=` means the commits API.

<!-- deepen-plan: codebase -->
> **Codebase:** The literal "three tiers" appears only in
> `plugins/yellow-core/README.md:33`, `plugins/yellow-core/CLAUDE.md:122` and
> `docs/CONCEPTS.md:87-95`. Lines 3 and 22-37 of `complete.md` need the
> new-path wording added, not a "three tiers" fix. The root README has no hit.
<!-- /deepen-plan -->
- [x] 3.5: Grep `docs/solutions` for stale "currently/only" claims before
      saving; keep frontmatter valid (`ERROR-SOL-001/002`).

### Phase 4: Verify and ship

- [x] 4.1: `pnpm changeset` (`'yellow-core': patch`: friction fix to an existing
      gate).
- [x] 4.2: Run `pnpm validate:schemas`, `pnpm validate:agents`,
      `pnpm lint:plugins`, `pnpm validate:shell-compat`,
      `pnpm check:shell-parse`, `pnpm test:shell-compat`, and
      `bats tests/` in `plugins/yellow-core` (plus the required nested suite
      where applicable).
- [x] 4.3: Live check: run the new path against a real Graphite-landed archive
      (PR #808's plan) expecting a pass, and a plan-creation-only PR expecting a
      prompt. If it cannot be run, say so in the PR body instead of ticking it.

<!-- deepen-plan: codebase -->
> **Codebase:** The PR #808 plan is already archived (PR #812, which merged
> normally), so `/plan:complete` would stop at the Phase 2 idempotency guard,
> and `git log -1 origin/main -- plans/<file>` now returns the archive commit
> (`22cfd85b4`), which fails the `cat-file` guard. Call the lib function
> directly with `FILE_SHA=80f125ddf` and PR 808, or pick a still-open
> Graphite-landed plan. Verified: `commits/80f125ddf/pulls` returns `[]`, the
> `pulls/808/files` entry has `status: added` and blob `2c95f8cd7...`, equal to
> `git rev-parse 80f125ddf:plans/<file>`, and the PR touches 23 files, so the
> outside-`plans/` rule passes. #812's file entry is `status=renamed` with
> `previous_filename=plans/<file>`, so an archive PR never matches
> `.filename == plans/$CLEAN_ARG`, as intended.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** Whether the files list of a closed, never-merged PR stays tied
> to the last head pushed (including any Graphite rebase push) is undocumented.
> The #808 check above is one data point; also check one stacked queue-merged PR
> before relying on the blob match.
<!-- /deepen-plan -->
- [ ] 4.4: Submit through the provider reported by `/stack:status`.

## Technical Details

**Files to modify:** `plugins/yellow-core/commands/plan/complete.md`,
`plugins/yellow-core/CLAUDE.md`, `plugins/yellow-core/README.md`,
`docs/CONCEPTS.md`, the three `docs/solutions/` files above,
`scripts/shell-compat-config.json`.

**Files to create:** `plugins/yellow-core/lib/plan-gate-provenance.sh`, its
`tests/shell-compat/drivers/` entry, new bats cases, one `.changeset/*.md`.

**Constraints:**
- `scripts/provider-neutral-commands-allowlist.json:6` caps `complete.md` at 7
  provider literals; add no `gt`, `gh stack` or `gt submit` literals.
- `complete.md` is already 629 lines (RULE 21 is advisory); moving logic into
  the lib shrinks it.
- Treat subjects, titles and file names as untrusted: strip control characters
  before printing; never interpolate them into the trailer or a jq filter
  (`--arg`).
- `gh api --paginate --jq` runs per page and `--slurp` cannot combine with
  `--jq`: redirect to a file, then `jq -s`.
- LF line endings; write new `.sh` files with a heredoc, not the Write tool.

<!-- deepen-plan: codebase -->
> **Codebase:** The provider-neutral cap is real: the validator counts only
> mutating `gt <verb>` and `gh stack <verb>` literals, and `complete.md` has
> exactly 7 today (lines 41, 501-503, 544, 548, 605). `gh api` is not counted,
> but new prose such as "gt sync" or "gt commit" would break the cap.
> `plan-commands.bats` mirrors `pr_num_is_valid` (lines 32-36) and the inline
> override regex sits at `complete.md` line 415. Make the test source the lib
> (or delete the mirror), and decide whether the override path also calls the
> lib, so the test does not prove a copy production no longer runs.
<!-- /deepen-plan -->

## Acceptance Criteria

1. Empty commits-API result + valid subject `(#N)` + all five pass conditions:
   archive proceeds with no prompt and the commit carries exactly
   `Plan-Verifier-FileProvenance: pr=#N sha=<40-hex> via=commit-subject`.
2. `PCOUNT == 1` behaviour is unchanged; `PCOUNT >= 2` and a failed commits API
   never reach the new path.
3. Every failure falls through to strict, loose and override with a one-line
   reason, and none aborts the block under `set -euo pipefail`.
4. A stale `plan-complete.provenance` from an aborted run is never committed.
5. Phase 7 body wording is accurate for `via=commit-subject`; no PR title or
   subject text reaches the trailer.
6. Docs and READMEs use one consistent tier description.
7. All validators and suites in 4.2 pass; changeset present.

## Edge Cases

- Rebase-merge, merge-commit or direct-push subjects (145 of the last 4000
  `origin/main` subjects have no trailing `(#N)`): fall through.
- Multiple `(#N)` in a subject: last wins (GitHub appends its own number last).
- Stacked PR (`base != main`): passes.
- Archive or deletion commit as `FILE_SHA` (stale local checkout): falls through
  via `cat-file`.
- Archive PR file shape (`status=renamed`, `previous_filename=plans/X.md`): match
  on `.filename` only, never `previous_filename`.
- Plan only in page 2-3 of the files list: pass (file-based jq, no SIGPIPE miss).
- 3000-file cap with no match: no-evidence.
- Filename containing a newline cannot forge a match.
- PR still `open`: "retry shortly" message, fall through.
- Blob mismatch (concurrent PR edited the plan): fall through.
- Fork or `gh repo set-default` pointing at a different repo than `origin`: print
  `OWNERREPO`; a 404 falls through.
- Local plan file edited after `FILE_SHA`: warn only (follow-up for the existing
  tier).
- Shallow clone with a grafted root commit: the files check protects; add a test.

<!-- deepen-plan: external -->
> **Research:** Treat `(#N)` as a strong hint, not a guarantee. GitHub documents
> "title and number on the first line" only for its PR-title squash formats; a
> single-commit PR under the default setting documents commit title and message
> with no number, an API merge's `commit_title` can be anything, and Graphite
> does not document its squash subject. Further failure modes: issue and PR
> numbers share one sequence (a 404 from `pulls/N` means "not a PR"), a
> cherry-pick or backport carries the original `(#N)`, and a revert followed by
> a re-land can leave two commits claiming the same N (the blob and files checks
> disambiguate). Rebase merges keep original subjects and never add a number, so
> all of these fall through to the override.
> See: https://github.blog/changelog/2022-08-23-new-options-for-controlling-the-default-commit-message-when-merging-a-pull-request
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** A suggestion to also require `PR base == main` was considered
> and not adopted. Stacked queue-merged PRs have their parent branch as `base`
> (verified on #952, #955 and #1033), so the gate would reject routine stacks.
> Record `base` informationally only; ancestry on trunk already comes from
> `FILE_SHA` being read from `git log origin/$TRUNK`.
<!-- /deepen-plan -->

## Testing Strategy

**Extractor table (bash, zsh, zsh+noclobber):** `feat: x (#808)` -> 808;
`x (#494) (#556)` -> 556; `x (#12) y`, `(#0)`, `(#012)`, 11 digits, `(#12a)`,
`(# 12)`, `docs: x (REVERTED)`, empty and control-character subjects -> none;
trailing whitespace -> N; `Revert "x (#9)" (#10)`, `Reapply "..."`,
`Merge pull request #333 ...` -> none; `$(...)` and backticks inert.

**Predicate (stub `gh`):** added/modified/renamed-in pass; `removed`, rename-out
(`previous_filename` only) fail; multi-page match; truncated list; newline
filename; `open`, 404, 403 rate limit, auth failure, timeout, malformed JSON each
fall through with a distinct message; stacked PR passes; plan-only PR falls
through; blob mismatch falls through.

**Git-fixture repo with a bare `origin`:** squash history passes; revert as the
last commit falls through; archive commit as `FILE_SHA` falls through;
no-`(#N)` subject falls through; shallow clone falls through; `git fetch`
failure skips the tier.

**State:** stale `.provenance` not committed after cleanup; two plans in
sequence leak nothing; override still beats provenance.

Bats rules: `run grep` plus `$status`, never mid-test `! grep`; no empty `{ }`
bodies (bats 1.11.0).

## Risks

- Worst failure: a wrongly auto-passed archive of an unimplemented plan. Bounded
  by Gate A, the non-plans-file rule, the blob match, and the auditable trailer.
- Most likely failure: unnecessary override prompts if the squash `(#N)`
  convention changes; the path stops matching and fails safe.
- Known residual (found in the 4.3 live check): the non-plans-file rule only
  rejects plans-only PRs. A PR that adds the plan together with non-plan docs,
  such as #1042 (a plan plus brainstorms), still passes. Gate A's unchecked-box
  scan is the guard there; tightening the rule (for example also excluding
  `docs/`) would force an override for legitimate docs-only plans, so it was
  left as designed.

## Follow-ups (out of scope)

- Phase 6 stale-main-clone: `gt repo sync` stderr is discarded, so a collision
  only surfaces at Phase 8 `gt submit`.
- Local-vs-trunk blob warning for the existing `PCOUNT == 1` path.
- After this ships, delete the obsolete `gate-c-verify-on-main` user memory and
  the `[[gate-c-verify-on-main]]` links in two sibling memories.

## References

- `docs/brainstorms/2026-10-06-gate-c-merge-queue-closed-prs-brainstorm.md`
- `plugins/yellow-core/commands/plan/complete.md`
- `plugins/yellow-core/tests/plan-commands.bats`
- `docs/solutions/workflow/plan-lifecycle-management.md`
- `docs/solutions/workflow/squash-commit-ancestry-verification-in-merge-queue.md`
- `docs/solutions/integration-issues/merge-queue-closed-pr-null-mergedat-detection.md`
- `docs/solutions/integration-issues/gh-wrapper-scripts-collapse-error-classes.md`
- `plugins/yellow-review/lib/resolve-gh.sh`, `tests/shell-compat/`,
  `CONTRIBUTING.md` "Shell Scripts"

<!-- deepen-plan: external -->
> **Research:** External sources:
> - Graphite, merge queue optimizations (closed instead of merged, `gtmq_`
>   draft PRs): https://graphite.com/docs/merge-queue-optimizations
> - Graphite, merge queue (rebase and squash strategies):
>   https://graphite.com/docs/graphite-merge-queue
> - Graphite blog, batching (`main` fast-forwarded to the draft PR head):
>   https://graphite.com/blog/merge-queue-batching
> - GitHub REST, pull requests (files endpoint, 3000-file cap):
>   https://docs.github.com/en/rest/pulls/pulls
> - Null `sha`, `blob_url`, `raw_url` in the files schema:
>   https://github.com/github/rest-api-description/issues/1945
> - GitHub changelog, squash default commit messages:
>   https://github.blog/changelog/2022-08-23-new-options-for-controlling-the-default-commit-message-when-merging-a-pull-request
<!-- /deepen-plan -->
