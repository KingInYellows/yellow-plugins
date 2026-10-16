# Feature: Cycle 1 follow-up — pending ledger design cards and three loose ends

> **Plan-time snapshot (2026-10-08).** Line numbers come from
> `origin/agent/docs/anchor-only-reverify-note` (the stack top) and `main` at
> `192f76173`. They will drift after the restack in Phase 0. Re-find each
> target by its function or heading name.

## Overview

The Cycle 1 stack (#1075 → #1076 → #1077 → #1078 → #1079 → #1080 → #1081,
plan `plans/cycle-1-resolve-hardening-and-ci-split.md`) left some
review-ledger cards pending on purpose because they change behaviour. This
plan records the five design decisions made on 2026-10-08 and turns them into
fix commits on the owning PRs. It also covers three follow-ups found during
the resolve passes: a PATH-ordering gap in `commit-resolve-fixes`, a
council-roster validator false positive that only shows up locally, and the
stale `index.lock` recipe.

Card numbers from `"$RL" cards <PR>` renumber after every dismissal, so each
task below names its cards by `finding_id` prefix (memory:
`triage-card-index-shifts-after-dismiss`).

<!-- deepen-plan: codebase -->
> **Codebase:** The plan's premise has changed: the whole stack has landed on
> `main` as squash commits. #1076 → `1d68e0cc1`, #1077 → `721f4376c`,
> #1078 → `a1798c171`, #1079 → `2d877ca9a`, #1080 → `a6cd602ff`,
> #1081 → `728ea9c47`, #1100 → `f7e73c44c`, #1094 → `dfcba3943`,
> #1098 → `97913e4fa` and #1125 → `c49559a68`. `main` is at `8e64f621f`.
> There are no owning PRs left to amend, so each remaining task ships as a
> new branch, or a small stack, off `main`. The ledger cards still live
> locally in `.git/yellow-review/findings/1077–1080.jsonl`, with no `.closed`
> marker.
<!-- /deepen-plan -->

## Problem Statement

- **#1077 `--revert-denied`.**
  - It reverts and deletes unreported deny-listed paths without asking, even
    in interactive runs, so a user's concurrent `.env` or `Dockerfile` edit is
    lost.
  - It cannot see gitignored deny-listed files.
  - It aborts the whole call when it meets a nested `.git` directory.
  - A second, model-built revert list in `dirty-tree-cleanup.md` disagrees
    with `rp_denied`.
- **#1078 sweep Step 1b.** The ignore probe is about 30 lines of inline bash.
  It fetches `refs/pull/N/head` from a hardcoded remote, merges five failure
  kinds into one message, has no timeouts, and reads a `cat-file` failure as
  "absent". Its deliberate stops print no `Sweep:` line, so `/review:sweep-all`
  ends the batch as `no contract`.
- **#1079.** Two report-only cards: the oos→fixed upgrade leaves the follow-up
  issue open, and the `cs_redact_secrets` header comment is wrong.
- **#1080 `worktree-restack.sh --abort`.**
  - It treats an unreadable git-dir or head-name as "no rebase" (fails open).
  - It aborts rebases in worktrees the run never touched.
  - It calls `release_run_worktree` on every `--abort`.
  - Its errors name no worktree.
- **Follow-ups.**
  - `commit-resolve-fixes` runs `dirname`, `cat`, `mktemp`, `rm` and `awk`
    on the uncleaned PATH before `check_tools_outside_repo`, and
    `--check-ranges` never cleans PATH.
  - `validate-council-roster.js` walks the gitignored
    `.ruvector/intelligence.json`.

<!-- deepen-plan: codebase -->
> **Codebase:** Status of each bullet on `main`:
> - **#1077.** Mostly fixed by #1077 and #1100 (see the Decision 2 note).
>   One residual: the cleanup pass runs with `--no-ignored-guard` (card
>   `ea5d3fe439`).
> - **#1078.** Still open. Today the probe is about 90 lines, not 30
>   (`sweep.md:99–~290`).
> - **#1079.** Both cards are still open.
> - **#1080.** Every bullet is still open.
> - **`commit-resolve-fixes`.** Fixed except for one `dirname` in
>   `lib/resolve-paths.sh:11`, which runs at source time.
> - **Council roster.** Still open. `validate-council-roster.js` fails
>   locally right now.
<!-- /deepen-plan -->

## Proposed Solution

### Decisions (confirmed with the user, 2026-10-08)

1. **#1100 lands first.** It is based on `main` and edits `run-verify-command`,
   `commit-resolve-fixes`, `resolve-pr.md`, `dispositions.md` and
   `skill-content.bats`. After it merges, restack the whole stack onto
   `main` once, before amending anything. The stack is already behind
   `main`.
<!-- deepen-plan: codebase -->
> **Codebase:** Decision 1 is done. #1100 landed first (`f7e73c44c`), and the
> stack landed on top of it, so no restack is needed.
<!-- /deepen-plan -->

2. **`--revert-denied` asks when interactive.**
   - Interactive runs add deny-listed paths to the Revert/Leave question
     that Step 6 already asks. Unattended runs keep reverting without asking.
   - `.claude/agent-memory/` gets a revert-only exemption, and `rp_denied`
     itself stays strict.
   - Gitignored deny-listed changes are detected and sent to the
     ignored-file stop. They cannot be reverted because no pre-run copy
     exists.
   - A nested `.git` directory skips that one path instead of aborting the
     call.
<!-- deepen-plan: codebase -->
> **Codebase:** Most of Decision 2 has been overtaken by what landed:
> - `rp_trusted_config` (`lib/resolve-paths.sh:1581–1608`) is a strict
>   subset of `rp_denied` (`:1553–1578`), and it excludes
>   `.claude/agent-memory` (`:1592`). `--revert-denied` now reverts only that
>   subset. `.env*`, keys, CI files and Dockerfiles are no longer touched, and
>   `rp_denied` is unchanged.
> - A nested `.git` is left in place per path, with the reason "left a
>   nested git repository in place" (`run-verify-command:1256–1290`).
> - `--revert-denied --ignored-since` exits 2 when a gitignored
>   trusted-config file has changed (`:1193–1212`). `--check-ignored` runs on
>   refusal paths (`resolve-pr.md:458–464`).
> - Interactive Revert/Leave already exists for non-trusted dirty paths
>   (`resolve-pr.md:466–472`).
>
> Two things are still open:
> 1. Trusted-config paths are reverted without asking in both modes
>    (`resolve-pr.md:445–450`). Whether interactive runs should ask is the
>    one design question left.
> 2. Both `dirty-tree-cleanup.md` copies call
>    `--revert-denied --no-ignored-guard` (`:97`, residual noted at
>    `:115–118`), so a gitignored trusted-config edit stays on disk. That is
>    card `ea5d3fe439`, still `applied`.
<!-- /deepen-plan -->

3. **Restack `--abort` fails closed and aborts only recorded worktrees.**
   - If a git-dir exists but cannot be read, exit 31 (`X_KEPT`) and name the
     worktree.
   - A missing or prunable worktree counts as having no rebase.
   - Abort only rebases in worktrees this run recorded.
   - Call `release_run_worktree` only when the run worktree's own rebase was
     the one aborted.

<!-- deepen-plan: codebase -->
> **Codebase:** Decision 3 is still fully open on `main`. All line numbers are
> in `worktree-restack.sh`:
> - `worktree_in_chain_rebase` (`:1519–1531`) fails open. An unreadable
>   git-dir hits `|| return 1`, and an unreadable `head-name` hits
>   `|| continue`.
> - `abort_in_chain_rebases` (`:1582–1595`) walks every `WT_PATH`.
> - `cmd_abort` (`:1775`) calls `release_run_worktree` unconditionally
>   (`:1856`).
> - `S_CHAIN` holds branch names, so "recorded worktrees" means `S_RUN` plus
>   each `E_PATH`.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** How to detect a rebase in another worktree:
> - Run `git -C <wt> rev-parse --path-format=absolute --git-path
>   rebase-merge`, and the same for `rebase-apply`.
> - `--path-format` needs Git 2.31 or later. Older git echoes the flag back
>   as output, so accept only a single line that starts with `/`.
> - If `rebase-apply/applying` exists, the operation is `git am`, not a
>   rebase.
> - During a rebase, `worktree list --porcelain` shows the worktree as
>   `detached`. Map it to a branch through `rebase-merge/head-name`, not
>   through the porcelain `branch` line.
> - A locked worktree is never reported `prunable`, so a locked worktree
>   whose directory is missing needs its own `test -d`.
>
> Inference, not verified against the source: a deleted, unpruned
> worktree's rebase state lives in `<common-dir>/worktrees/<id>/`, which
> survives until prune. Git's `is_worktree_being_rebased` reads it there.
> Rather than assume "missing = no rebase", read that directory straight
> from the common dir. Also confirm that Decision 3's "prunable = no rebase"
> holds when a rebase was in progress at the moment the directory was
> deleted.
>
> See https://github.com/git/git/blob/master/Documentation/git-rev-parse.adoc,
> https://github.com/git/git/blob/master/worktree.c,
> https://github.com/git/git/blob/master/wt-status.c,
> https://github.com/Gentleman-Programming/gentle-ai/issues/1261
<!-- /deepen-plan -->

4. **The sweep probe judges the PR head through `gh api`.**
   - Read the head's `.gitignore` blobs at `headRefOid` through `gh api`,
     with a timeout. Refuse any mode-`120000` (symlink) blob.
   - Run `check-ignore` against the real git-dir, so `.git/info/exclude`
     and `core.excludesFile` still apply.
   - Move the probe into a lib subcommand with bats tests.
   - A PR-specific stop prints `Sweep: skipped (<reason>)` and the batch
     continues. A network or rate-limit failure still stops the batch.

<!-- deepen-plan: codebase -->
> **Codebase:** Today's Step 1b in `sweep.md` (`:99–~290`):
> - It fetches `refs/pull/<PR#>/head` from a guessed remote (`:152–161`).
> - Every failure goes to `head_fail`, which prints one message and no
>   `Sweep:` line.
> - It has no `timeout`.
> - It already runs attribute and case-alias checks. The `gh api` rewrite
>   must keep those.
>
> Helpers to reuse:
> - `lib/resolve-gh.sh`: `rg_gh` (timeout wrapper, `:31–38`) and
>   `rg_is_rate_limited`, which checks the rate limit before the 403.
> - `S/pr-changed-ranges:38`: the `rg_gh api` pattern.
> - `review-ledger.sh:2087` (`cmd_remote_head`): reads `headRefOid` and
>   handles shallow clones (`:2102`).
>
> Only the root `.gitignore` can decide the result for the root
> `yellow-plugins.local.md`.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** Gotchas when running `check-ignore` against a temp work-tree:
> - `core.ignoreCase` changes how patterns match (case-folded). Decide it on
>   purpose so it agrees with the existing case-alias checks.
> - `.gitattributes` has no effect on the result.
> - `--no-index` is safe and read-only. Without it, a path tracked in the
>   real index always comes back "not ignored".
> - With `-v`, a match on a negated `!` pattern still exits 0, so use the
>   non-verbose exit code.
> - A `dir/` pattern does not match a bare path that is missing from the
>   temp tree. Test a child path instead.
> - Accept only tree entries with mode `100644` or `100755`.
>
> A throwaway bare repo would isolate the check from local excludes, but
> Decision 4 wants the local `info/exclude` and `core.excludesFile` to apply,
> so keep the real git-dir.
>
> See https://github.com/git/git/blob/master/builtin/check-ignore.c,
> https://git.github.io/htmldocs/git-check-ignore.html,
> https://git.github.io/htmldocs/gitignore.html
<!-- /deepen-plan -->

5. **The github provider records the worktrees it rebases (2026-10-08).**
   This settles the open question under Decision 3.
   - "Recorded worktrees" means `S_RUN` plus every `E_PATH` entry, for both
     providers.
   - The github path writes an `entry <path> <ref> <sha>` line for each
     worktree whose branch the run rebases, and `validate_state` accepts
     those entries for github.
   - Without this, `--abort` under GitHub-native stacks could cancel only
     the run's own worktree, and a stuck gh-stack rebase in another
     worktree would stay stuck.
   - Not yet verified: whether the github path can tell which worktrees
     `gh stack` rebased. Task 5.0 checks this first.

<!-- deepen-plan: codebase -->
> **Codebase:** The facts that answer task 5.0:
> - `step_github upstack` (`worktree-restack.sh:1280`) runs `adapter_run
>   rebase --mode upstack` in `$RUN_WT`.
> - The adapter (`plugins/github-workflow/lib/github-stack-runtime.js:468–481`)
>   runs `gh stack rebase --upstack [--remote <r>]`.
> - Nothing records which worktrees were rebased, and `cmd_start` writes
>   `E_PATH` for graphite only (`:1425–1436`).
> - `validate_state` rejects github `entry` lines (`:591–594`).
> - `build_plan` already computes `SEL_PATH`/`SEL_BRANCH` for github before
>   the rebase (`:826–828`).
>
> Writing `SEL_PATH` as `entry` lines records a superset of what `gh stack`
> may touch. That is enough for a fail-closed "recorded only" policy.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** `gh stack rebase` runs a plain `git rebase` (no
> `--update-refs`) in each branch's owning worktree. Branches that are not
> checked out anywhere are rebased in the invoking worktree, and its
> checkout is restored afterwards.
> - A dirty, busy, missing or changed owner worktree blocks the whole
>   operation before anything is rewritten.
> - `--continue` and `--abort` work from any worktree, through an
>   undocumented journal at `<common-dir>/gh-stack-rebase-state`.
> - `rebase` prints no JSON. Its exit codes are 3 (conflict), 7 (a rebase is
>   already in progress) and 8 (lock held).
> - `gh stack view --json` (`head`, `needsRebase`) can be compared before and
>   after the rebase.
> - gh-stack's own `IsRebaseInProgress` checks only the current worktree.
>
> So `SEL_PATH` (the owning worktrees) is exactly the set `gh stack` can
> rebase in, plus the run worktree.
>
> See https://docs.github.com/en/pull-requests/reference/stacked-prs-cli-commands,
> https://github.com/github/gh-stack/blob/main/internal/git/gitops.go,
> https://github.com/github/gh-stack/blob/main/docs/src/content/docs/guides/workflows.md
<!-- /deepen-plan -->

### Defaults the plan takes (change only with a reason)

- **#1079 report-only cards.**
  - Fix the comment rot in place.
  - Keep "the filed issue stays open" for the oos upgrade, which
    `dispositions.md` already says. Make the upgrade reply link the issue
    number so a human can close it. No external-tracker side effects.
- **Council roster.**
  - Add `.ruvector` and `.worktrees` segments to `redactionExcluded`.
  - Moving the walk to `git ls-files` is a separate follow-up, because the
    integration fixtures are not git repos.
- **Stale `index.lock`.** No code. `docs/solutions/workflow/gt-sync-exit-128-stale-index-lock.md`
  and the stale-lock note already hold the recipe.
- **Changesets.**
  - Bump #1078's yellow-review changeset to `minor`, because it adds a new
    script and new skip-line reasons.
  - Bump #1080's yellow-core changeset to `minor`, because `--abort` changes
    meaning.
  - #1077 is already `minor`.
  - Reword #1076's `patch` entry to mention the new exit 3 from
    `--check-ranges`.

<!-- deepen-plan: codebase -->
> **Codebase:** The changeset defaults no longer apply. `d2ab958b7` (#1074,
> "chore: version packages") consumed every changeset they name, and the
> plugins are now at `yellow-review` 3.8.0 and `yellow-core` 2.9.0. Each
> follow-up branch needs a new changeset: `minor` for the sweep skip-line
> contract and for the `--abort` scope change, `patch` for the rest.
> `docs/solutions/workflow/gt-sync-exit-128-stale-index-lock.md` exists, so
> the index.lock default still holds.
<!-- /deepen-plan -->

### Order

Phase 0 (prerequisites and restack) → W5 on #1076 → W1 on #1077 → W2 on
#1078 → W3 on #1079 → W4 on #1080 → one restack → re-triage. W6 is
independent, on its own branch off `main`. W5 goes before W2 because the new
probe script reuses W5's PATH prelude.

<!-- deepen-plan: codebase -->
> **Codebase:** The order is obsolete. "W5 on #1076 → … → W4 on #1080 → one
> restack" assumed open PRs. W5's remaining work is one line, so W2 no longer
> depends on it. Every workstream (the W5 residual, the W1 residual, W2, W3,
> W4 and W6) can be its own branch off `main`. Stack them only where two
> branches touch the same file (for example, W1 and W2 both touch
> `skill-content.bats`).
<!-- /deepen-plan -->

## Stack Decomposition

<!-- stack-topology: parallel -->
<!-- stack-trunk: main -->

Decided 2026-10-14, after the stack landed: one branch per workstream, each off
`main`, each in its own worktree under `worktrees/yellow-plugins/<slug>/`.
Interactive runs ask before reverting trusted-config paths (Decision 2 stays
as it was). The github restack path records `SEL_PATH` as `entry` lines
(Decision 5 / task 5.0). W6 reuses the existing
`worktrees/yellow-plugins/council-roster-skip-ruvector` worktree.

### 1. agent/fix/resolve-paths-source-dirname

- **Type:** fix
- **Description:** W5 residual. Stop `lib/resolve-paths.sh` from running
  `dirname` while it is being sourced, before `yr_adopt_path`. Fix the stale
  "No tool has run" comment.
- **Scope:** `plugins/yellow-review/lib/resolve-paths.sh`,
  `skills/pr-review-workflow/scripts/commit-resolve-fixes`, its bats tests,
  and a changeset
- **Tasks:** 1.1, 1.2, 1.3, 1.4, 1.5, 1.6
- **Depends on:** none
- **Linear:** none

### 2. agent/fix/council-roster-skip-ruvector

- **Type:** fix
- **Description:** W6. `validate-council-roster.js` skips the gitignored
  `.ruvector/` directory.
- **Scope:** `scripts/validate-council-roster.js` and
  `tests/integration/validate-council-roster.test.ts`
- **Tasks:** 6.1, 6.2, 6.3, 6.4
- **Depends on:** none
- **Linear:** none

### 3. agent/fix/oos-upgrade-followup-and-redact-header

- **Type:** fix
- **Description:** W3. The oos→fixed upgrade reply names the follow-up issue,
  and the `cs_redact_secrets` header comment is corrected.
- **Scope:** `plugins/yellow-review/skills/pr-review-workflow/references/resolve/dispositions.md`
  and the scripts it orchestrates, `plugins/yellow-core/lib/compound-staging.sh`,
  and a changeset
- **Tasks:** 4.1, 4.2, 4.3
- **Depends on:** none
- **Linear:** none

### 4. agent/fix/revert-denied-interactive-ask

- **Type:** fix
- **Description:** W1 residual. Interactive `/review:resolve` asks before
  reverting trusted-config paths, and the stack and sweep-all cleanup no
  longer leaves a gitignored trusted-config edit on disk.
- **Scope:** `plugins/yellow-review` resolve docs and `run-verify-command`,
  `dirty-tree-cleanup.md` (both copies), bats tests, and a changeset
- **Tasks:** 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9
- **Depends on:** none
- **Linear:** none

### 5. agent/fix/restack-abort-recorded-worktrees

- **Type:** fix
- **Description:** W4. `worktree-restack.sh --abort` fails closed and aborts
  only recorded worktrees. The github path records `SEL_PATH`.
- **Scope:** `plugins/yellow-core/skills/git-worktree/` (the script, its
  tests and `SKILL.md`), `commands/worktree/restack.md`, and a changeset
- **Tasks:** 5.0, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
- **Depends on:** none
- **Linear:** none

### 6. agent/feat/sweep-head-ignore-probe

- **Type:** feat
- **Description:** W2. Move the sweep Step 1b probe into a
  `head-ignore-probe` script that reads the head's root `.gitignore` through
  `gh api`. PR-specific stops print `Sweep: skipped (<reason>)`.
- **Scope:** `plugins/yellow-review` sweep and sweep-all commands, the new
  script and its bats tests, `skill-content.bats`, and a changeset
- **Tasks:** 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8
- **Depends on:** none
- **Linear:** none

## Stack Progress
<!-- Updated by flow:work. Do not edit manually. -->
- [x] 1. agent/fix/resolve-paths-source-dirname (completed 2026-10-14, PR #1191)
- [x] 2. agent/fix/council-roster-skip-ruvector (completed 2026-10-14, PR #1185)
- [x] 3. agent/fix/oos-upgrade-followup-and-redact-header (completed 2026-10-14, PR #1187)
- [x] 4. agent/fix/revert-denied-interactive-ask (completed 2026-10-14, PR #1193)
- [x] 5. agent/fix/restack-abort-recorded-worktrees (completed 2026-10-14, PR #1197)
- [x] 6. agent/feat/sweep-head-ignore-probe (completed 2026-10-14, PR #1199)

## Implementation Plan

### Phase 0: Prerequisites

- [x] 0.1 Run `/stack:status`. Continue only on `READY_GRAPHITE`.
      (2026-10-14: `READY_GRAPHITE`.)
- [x] 0.2 Wait for #1100 to merge. Confirm it is on `origin/main` (memory:
      `gate-c-verify-on-main`). (Landed as `f7e73c44c`.)
- [x] 0.3 (Not applicable: the stack landed on `main`, so there was nothing
      to restack.) Sync and restack the stack onto `main` in one worktree under
      `worktrees/yellow-plugins/`. Resolve conflicts in `run-verify-command`,
      `commit-resolve-fixes`, `resolve-pr.md`, `dispositions.md` and
      `skill-content.bats` in favour of both sides. Then run
      `bats plugins/yellow-review/tests/` and confirm it passes.

- [x] 0.4 (2026-10-16: re-ran `"$RL" cards` for #1077–#1080, 76 pending
      cards in total, and checked each one against `main` at `e688e6c59`.
      Results are per card under task 7.3.) Re-run `"$RL" cards` for #1077–#1080. Use the restack recipe in
      memory `restack-flips-applied-findings-to-reopened` to sort out cards
      that went from `applied` to `reopened`. Match cards by `finding_id`
      prefix.
- [x] 0.5 (Landed as `dfcba3943`.) Check where #1094 stands. It also edits `rp_ignored_changed_since`
      in `lib/resolve-paths.sh`. If it lands first, keep its `.ruvector` and
      vitest exemptions.

<!-- deepen-plan: codebase -->
> **Codebase:** Phase 0 is obsolete, apart from 0.1 (`/stack:status`) and
> the card reconciliation in 0.4.
>
> Card status, folded read-only from the jsonl:
> - **Pending per PR.** #1077: 16 applied. #1078: 10 open, 1 reopened,
>   8 applied. #1079: 10 applied. #1080: 2 open, 5 applied.
> - **Plan prefixes, #1077.** `fbd86fd697` is dismissed. `b0f4b6a8d5` and
>   `f3141cd4b1` are fixed. `139bbd7beb` and `ea5d3fe439` are applied.
> - **Plan prefixes, #1078.** Ten are open. `677f20523a`, `e74691c6e7`,
>   `a1819ff8ff` and `6c913af5ea` are `report_only`.
> - **Plan prefixes, #1079.** `ab372eb399` and `365d7e213f` are
>   `report_only`.
> - **Plan prefixes, #1080.** `7cf25139a3` and `e4905122bc` are open; the
>   other eight are `report_only`.
>
> The file:line values on the cards are from before landing.
<!-- /deepen-plan -->

### Phase 1: W5 — PATH prelude in `commit-resolve-fixes` (on #1076)

- [x] 1.1 (Already on `main`: `yr_adopt_path` runs before argument parsing.) Move the empty-entry and relative-entry PATH strip, and its die
      when the result is empty, to the first executable statements of
      `commit-resolve-fixes`. Keep it inline, because `yr_worktree_root` is
      defined after the first `dirname`. Copy the inline pattern from
      `run-verify-command`.

- [x] 1.2 (Mostly on `main`; the remaining `dirname` in `lib/resolve-paths.sh` is fixed in #1191.) Replace each pre-check external command with a builtin:
      - `$(dirname "$0")` becomes `${0%/*}`, in the `check_lib_integrity`
        and sourcing lines and in `PLUGIN_ROOT`.
      - `cat -- "$2"` becomes `$(<"$2")`, in `--ranges-from`.
      - Move `mktemp`, `rm` and the `rt_text_clean` awk call after the
        tool check.

- [x] 1.3 (Already on `main`.) Make `--check-ranges` clean PATH before it runs `awk` or `jq`.
      Document the new exit 3 in the header.
- [x] 1.4 (#1191.) Correct the comment above `check_tools_outside_repo` ("No tool has
      run") so it matches the new order.

- [x] 1.5 (A planted-`dirname` test in both scripts' suites, covering both modes. Relative-only PATH exit 3 is already on `main`. #1191.) Bats tests in `tests/commit-resolve-fixes.bats`:
      - In both the normal mode and `--check-ranges`, plant `dirname`,
        `cat`, `mktemp`, `rm` and `awk` shims in an in-worktree PATH entry.
        Assert that none of them runs.
      - Assert that a PATH with only relative entries exits 3.
- [x] 1.6 (Not needed: those `dirname` calls run after `yr_adopt_path`.) Out of scope, filed as an issue: the same `dirname` at
      `run-verify-command` line ~166.

<!-- deepen-plan: codebase -->
> **Codebase:** Most of Phase 1 is already done on `main`:
> - `yr_adopt_path` runs before any argument is parsed
>   (`commit-resolve-fixes:666`), so `--check-ranges` (`:695`) is covered.
> - `CRF_DIR` uses `${0%/*}` (`:206–211`).
> - `cat` (`:700`), `mktemp` (`:820`), `rm` and `awk` all run after the
>   PATH screen.
>
> What remains:
> - `lib/resolve-paths.sh:11` runs `dirname` while it is being sourced. That
>   is before `yr_adopt_path` in `commit-resolve-fixes` (`:648` against
>   `:666`) and in `run-verify-command` (`:679` against `:694`).
> - The "No tool has run" comment at `commit-resolve-fixes:879` is stale.
>
> Task 1.6 is wrong: `run-verify-command`'s `dirname` calls are at `:796` and
> `:815`, after `yr_adopt_path`, so no issue is needed.
>
> Shrink Phase 1 to three things: the `resolve-paths.sh:11` fix, the comment,
> and one `dirname`-shim bats case per script.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** `${BASH_SOURCE[0]%/*}` returns the name unchanged when it
> contains no slash. Both callers here source the library through a path
> with a slash (`"$CRF_DIR/../../../lib/resolve-paths.sh"` and
> `"$PLUGIN_ROOT/lib/resolve-paths.sh"`), so the plain form works. The
> BashFAQ/028 guard costs nothing, though:
> `d=.; [[ ${BASH_SOURCE[0]} == */* ]] && { d=${BASH_SOURCE[0]%/*}; d=${d:-/}; }`.
>
> `resolve-paths.sh` is bash-only and is not in the shell-compat tier, so the
> unset `BASH_SOURCE` under zsh does not apply. See
> https://mywiki.wooledge.org/BashFAQ/028
<!-- /deepen-plan -->

### Phase 2: W1 — `--revert-denied` policy (on #1077)

Cards: `139bbd7beb` (ignored files), `fbd86fd697` and `b0f4b6a8d5` (unasked
revert), `f3141cd4b1` (nested `.git`), `ea5d3fe439` (two policies).

- [x] 2.1 (Superseded on `main` by `rp_trusted_config`, which excludes agent memory.) Add `rp_revert_exempt` in `lib/resolve-paths.sh`. It matches
      `.claude/agent-memory/` only. `--revert-denied` skips exempt paths and
      `rp_denied` is unchanged.
- [x] 2.2 (Superseded on `main` by `--revert-denied --ignored-since` and `--check-ignored`.) Add a `--denied-ignored-since <marker>` mode to `run-verify-command`.
      It runs `rp_ignored_changed_since` filtered by `rp_denied` and is
      read-only. It reports an `ignoredDenied` array, and the
      `deniedClean` meaning stays as it is. A missing marker exits 2.

- [x] 2.3 (Already on `main`.) Make a nested `.git` under a deny-listed untracked directory a
      per-path skip: add `skipped, nested repository: <path>`, set
      `deniedClean=false`, and keep reverting the other paths.
- [x] 2.4 (Already on `main`.) Add a `reverted` path array to the `--revert-denied` JSON (this
      also covers card 13's intent if a restack reopens it).

- [x] 2.5 (Interactive runs ask through `--revert-denied --dry-run`. #1193.) `resolve-pr.md` Step 6:
      - **Interactive.** List deny-listed dirty paths in the Revert/Leave
        question that Step 6 already asks. "Revert" runs `--revert-denied`.
        "Leave" names the paths under Blocking merge.
      - **Unattended.** Keep the unasked revert.
      - **Both modes.** Run `--denied-ignored-since` on every refusal path
        and every no-fixed path. A hit goes to the ignored-file stop, which
        tells the user to restore the file by hand.
- [x] 2.6 (Already on `main`; cards `ea5d3fe439` and `139bbd7beb` close at re-triage.) Replace the model-built trusted-config list in both
      `references/review-resolve-stack/dirty-tree-cleanup.md` and
      `references/review-sweep-all/dirty-tree-cleanup.md` with a
      `--revert-denied` call. Keep the two files byte-identical and update
      the `skill-content.bats` pin.
- [x] 2.7 (#1193.) Update `references/resolve/dispositions.md` and the script header
      to match the new modes.

- [x] 2.8 (The listed cases are already on `main`; #1193 adds `--dry-run` cases. Full suite: 297 passed.) Bats tests in `tests/run-verify-command.bats`:
      - A gitignored deny-listed fixture (`.mcp.json`) is caught by
        `--denied-ignored-since`.
      - A nested worktree under `.claude/` is skipped while a sibling
        `.env` is still reverted.
      - An `agent-memory` write survives.
      - The `reverted` array lists the right paths.
- [x] 2.9 (New `minor` changeset, #1193.) Edit the changeset (already `minor`): describe the interactive
      prompt and the new mode.

<!-- deepen-plan: codebase -->
> **Codebase:** Phase 2 status:
> - **2.1** is superseded by `rp_trusted_config`, which is stricter.
> - **2.2** is superseded by `--revert-denied --ignored-since` and
>   `--check-ignored`.
> - **2.3** is done (`run-verify-command:1256–1290`, bats `:599–622`).
> - **2.4** is done (header `:134–139`, bats `:440, 484, 543, 608`).
> - **2.6** is done. The copies are byte-identical, and the pin is at
>   `skill-content.bats:774–797`.
> - **2.7** is mostly done (`dispositions.md:516, 572, 616`).
> - **2.5** is partly done.
>
> Remaining scope:
> 1. Decide whether interactive runs ask before reverting trusted-config
>    paths (`resolve-pr.md:445–450`).
> 2. Close the `--no-ignored-guard` gap in `dirty-tree-cleanup.md` (card
>    `ea5d3fe439`).
> 3. Write a new changeset.
<!-- /deepen-plan -->

### Phase 3: W2 — sweep head probe (on #1078)

Cards: `9a9d05c66c`, `570be26ae8`, `6ffb97658e`, `677f20523a`, `e74691c6e7`,
`826d48217a`, `0f8946269e`, `5db73e203e`, `a273e74077`, `ea7f51eefa`,
`a45361a5f9`, `e3f9639703` and `a1819ff8ff`. Card `6c913af5ea` (sweep.md over
500 lines) closes as a side effect.

- [x] 3.1 (Built as `scripts/head-ignore-probe <PR#>`: a root tree call plus blob calls, keeping the alias and attribute checks. #1199.) Add a `head-ignore-probe <PR> <path>` subcommand to a lib script.
      Prefer a new `lib/sweep-probe.sh`, which keeps `review-ledger.sh`
      focused. It works as follows:
      - Source W5's PATH prelude.
      - Read `headRefOid` with `gh pr view` inside `timeout`.
      - List the `.gitignore` blobs along the path's ancestor directories
        with `gh api repos/{owner}/{repo}/git/trees/<sha>?recursive=1`, or
        per-directory `contents` calls, all inside `timeout`.
      - Refuse any blob with mode `120000`.
      - Write the blobs into a temp work-tree.
      - Run `git --git-dir=<real> --work-tree=<tmp> check-ignore -q
        --no-index` against them.

<!-- deepen-plan: codebase -->
> **Codebase:** Task 3.1 should use a script, not a lib subcommand. Put it at
> `skills/pr-review-workflow/scripts/head-ignore-probe`, next to
> `guard-local-config`, with its own `.bats`.
> - Use `rg_gh` and the classifiers in `lib/resolve-gh.sh` for gh errors.
> - Read only the root `.gitignore`: one non-recursive `git/trees/<headRefOid>`
>   call plus one `git/blobs/<sha>` call. That drops the recursive and
>   per-directory options.
> - Copy the attribute and case-alias checks from today's Step 1b.
<!-- /deepen-plan -->

- [x] 3.2 (Exit 3 is systemic, exit 4 is PR-specific. #1199.) Output is one line: `head=tracked|ignored|unignored`, or
      `error=<class>` with exit codes split by class:
      - `rate-limited` and `network`: systemic, so the batch stops.
      - `not-found` and `unreadable-blob`: PR-specific, so the PR is
        skipped.
      - Forward gh's stderr. Test the rate limit before the 403 check
        (`docs/solutions/integration-issues/gh-wrapper-scripts-collapse-error-classes.md`).
- [x] 3.3 (Dropped, as the note below explains: probing at `headRefOid` already judges the published head.) Before the snapshot, verify that the local checkout matches the
      probed head: `git rev-parse HEAD` must equal `headRefOid` after
      `/review:pr`'s checkout. If they differ, skip the PR with
      `head-mismatch` instead of trusting a stale local branch.

<!-- deepen-plan: codebase -->
> **Codebase:** Task 3.3 has the wrong timing. Step 1b runs before
> `/review:pr` checks out the head, and `/review:pr` Step 9 pushes, which
> moves the head again. Either put the check right after `/review:pr`'s
> checkout and before its first edit, or drop it, because probing at
> `headRefOid` already judges the published head.
<!-- /deepen-plan -->

- [x] 3.4 (`head-mismatch` dropped with 3.3; `untracked-here-ignored-on-head` added. #1199.) `sweep.md` Step 1b:
      - Replace the inline bash with one call to the subcommand.
      - Make every deliberate stop print `Sweep: skipped (<reason>)`. The
        reasons are `head-ignore-unreadable`, `tracked-here-ignored-on-head`
        and `head-mismatch`.
      - Add these reasons to the Skip line list and to Error Handling.
- [x] 3.5 (Already covered: the absent-state snapshot in Step 1b handles a config the review creates. The unsnapshotted Step 2b abort now says to inspect the file. #1199.) Step 2b abort: run `guard-local-config check` and then `clear` on a
      config the review created, so a rerun cannot trust it as the baseline.
      Print the recovery line.

<!-- deepen-plan: codebase -->
> **Codebase:** Task 3.5 can't work as written. `guard-local-config` has only
> `snapshot`, `check <dir> <digest>` and `clear <dir>` (`:187–270`). When
> the file is `ignored` on the head there is nothing to `check`. Add a
> `guard-local-config absent` subcommand with bats tests, or record an
> absent-state snapshot before `/review:pr`.
<!-- /deepen-plan -->

- [x] 3.6 (#1199.) `sweep-all.md`:
      - Extend the closed skip-reason regex, its tests and
        `resolve-contract.md`.

      - Item 1b: retry a transient `gh pr view` failure once with backoff.
      - A PR-specific 404 or access error skips that PR. A rate limit still
        ends the batch.
<!-- deepen-plan: codebase -->
> **Codebase:** The closed regex
> `^Sweep: skipped \((pr-not-open|branch-mismatch)\)$` is at
> `sweep-all.md:273` and is repeated at `sweep.md:546`. Its pins are at
> `skill-content.bats:650` (sweep) and `:652` (sweep-all), and `CLAUDE.md:107`
> mentions it, so change all four together.
>
> `resolve-contract.md` has no skip-reason text, so it needs no change.
>
> `sweep.md` is 613 lines and `sweep-all.md` is 455. Moving the probe out
> takes about 90 lines off `sweep.md`, toward the 500-line advisory
> (card `6c913af5ea`).
<!-- /deepen-plan -->

- [x] 3.7 (As `tests/head-ignore-probe.bats`, 22 cases. #1199.) Write `tests/sweep-probe.bats` with a stubbed `gh` and these cases:
      - tracked;
      - ignored through a nested `.gitignore`;
      - a negation that re-includes the path;
      - a symlink blob refused;
      - local `info/exclude` still honoured;
      - rate-limited → systemic;
      - 404 → PR-specific;
      - a `timeout` binary present and one missing.

<!-- deepen-plan: codebase -->
> **Codebase:** Edits to the 3.7 test cases:
> - Drop "ignored through a nested `.gitignore`", because only the root file
>   matters.
> - Add three cases from the research: a `-v`-free exit code on a negated
>   match, a `dir/` pattern tested through a child path, and a pinned
>   `core.ignoreCase`.
> - Name the bats file after the script (`head-ignore-probe.bats`).
>
> For the shallow-clone and fork case in Acceptance Criterion 5, reuse
> `cmd_remote_head`'s fixtures as the model.
<!-- /deepen-plan -->

- [x] 3.8 (New `minor` changeset, #1199.) Bump #1078's changeset to `minor` and describe the skip-line
      contract change.

<!-- deepen-plan: codebase -->
> **Codebase:** Task 3.8 can't bump an existing changeset, because the old
> one was consumed by #1074. Write a new `minor` changeset for
> `yellow-review`.
<!-- /deepen-plan -->

### Phase 4: W3 — report-only cards (on #1079)

Cards: `ab372eb399` (oos upgrade) and `365d7e213f` (redaction header).

- [x] 4.1 (Done in `dispositions.md` Reply hygiene, as the note below says, plus a skill-content pin. #1187.) `reply-pr-thread`: when the reply upgrades oos to fixed or
      addressed, add "Follow-up #<n> can be closed" to the reply. Get the
      issue number from `file-followup-issue --find`. Keep the body marker
      so Linear dedupe still finds it.

- [x] 4.2 (Done; the alignment issue is #1186. #1187.) Correct the `cs_redact_secrets` header in
      `plugins/yellow-core/lib/compound-staging.sh`:
      - it is a separate list, not a subset;
      - the yellow-ci path is `hooks/scripts/lib/redact.sh`;
      - the line-17 name is wrong.

      File an issue to bring the two pattern lists in line.
- [x] 4.3 (Already on `main`: `reply-pr-thread.bats:149`.) Add a bats test that a prior oos marker still blocks disagree and
      unclear replies, if card 12's test is not on the branch after the
      restack.

<!-- deepen-plan: codebase -->
> **Codebase:** Phase 4 status:
> - **4.1** is still open. `reply-pr-thread` takes no repo argument, and the
>   upgrade case is at `S/reply-pr-thread:218–221`. Do the
>   `file-followup-issue --find <owner/repo> <PRRT_id>` lookup in the
>   orchestration step described in `dispositions.md`, and update
>   `dispositions.md:718–721`, which says the script neither closes nor
>   links the issue.
> - **4.2** is still open at `plugins/yellow-core/lib/compound-staging.sh:110–120`.
>   The header says "Self-contained subset of yellow-ci's lib/redact.sh". The
>   real file is `plugins/yellow-ci/hooks/scripts/lib/redact.sh`, and line 17
>   says `redact_secrets` where the function is `cs_redact_secrets` (`:214`).
> - **4.3** is done (`tests/reply-pr-thread.bats:149–162`).
<!-- /deepen-plan -->

### Phase 5: W4 — restack `--abort` (on #1080)

Cards: `7cf25139a3` (unreadable git-dir), `e14910da8d` (foreign worktrees),
`213629705b` and `5be8911b63` (`release_run_worktree`), `e4905122bc`,
`639caade38` and `b4b98ec491` (error naming), and `34e32cd1a1`, `b57336a973`
and `f718b7ad61` (exit-31 scope, `--status`).

- [x] 5.0 (The run can't see which worktrees gh-stack rebased, so it records the owning worktrees, `SEL_PATH`. The user approved this on 2026-10-14.) Before any other Phase 5 work, check how the github provider's
      restack runs `gh stack` and whether it can tell which worktrees it
      rebased. One way is to snapshot the worktrees that hold chain branches
      before the call and confirm afterwards which ones started a rebase.
      If the run can't tell reliably, stop and bring the choice back to the
      user instead of guessing (Decision 5).
<!-- deepen-plan: codebase -->
> **Codebase:** Task 5.0 is answered (see the note under Decision 5). The
> github path cannot see which worktrees `gh stack` actually rebased, but
> before the call it knows the owning worktrees (`SEL_PATH`,
> `build_plan:826–828`). Record those as `entry` lines. That set is a
> superset, so the fail-closed policy holds without guessing. Confirm this
> with the user, because Decision 5 says to stop if the run can't tell.
<!-- /deepen-plan -->

- [x] 5.1 (#1197.) `worktree_in_chain_rebase`:
      - If the worktree directory is missing, or `git worktree list
        --porcelain` marks it prunable, return "no rebase".
      - If the directory exists but `rev-parse --git-dir` fails, return
        "unknown".
      - If `rebase-merge/` or `rebase-apply/` exists but `head-name` cannot
        be read, return "unknown".
      - Resolve paths with `rev-parse --path-format=absolute --git-path`.
<!-- deepen-plan: external -->
> **Research:** For 5.1, add three checks:
> - Exclude `git am` (`rebase-apply/applying`).
> - Validate that `--git-path` returns a single absolute line.
> - Give a locked worktree whose directory is missing its own `test -d`
>   branch.
>
> See the Decision 3 note for checking a prunable worktree's rebase state
> through the common dir.
<!-- /deepen-plan -->

- [x] 5.2 (#1197. Uses new `owner` lines, not `entry` lines: entries are detached, locked and restored, and github worktrees are none of those.) Record and limit (Decision 5):
      - Github path: write an `entry <path> <ref> <sha>` line for each
        worktree it rebases, and allow github entries in `validate_state`
        (`:499–501`). Keep the existing graphite entry format unchanged.
      - `abort_in_chain_rebases`: only touch `S_RUN` plus each entry's
        `E_PATH`, for both providers.
      - On "unknown", exit `X_KEPT` and name the worktree.
      - When a rebase cannot be aborted, keep going through the remaining
        worktrees, then exit `X_KEPT` with one line per worktree that names
        it and the git reason.

<!-- deepen-plan: codebase -->
> **Codebase:** Task 5.2 targets in `worktree-restack.sh`:
> - `validate_state` rejects github entries at `:591–594`.
> - `abort_in_chain_rebases` (`:1582–1595`) already keeps going after a
>   failure and prints one line per failed worktree. Only the final `die`
>   names just the first one.
> - `release_run_worktree` is defined at `:1551` and called unconditionally
>   at `:1856`.
<!-- /deepen-plan -->

- [x] 5.3 (Changed approach in #1197: gating broke the recovery after a hand abort. It now refuses while an operation runs there, and git's stderr is still not echoed.) Call `release_run_worktree` only when step 5.2 aborted a rebase in
      the run worktree. Keep its `git checkout` stderr and print it on
      failure.
- [x] 5.4 (#1197.) Make `--status` report a busy operation or in-chain rebase in
      non-run stack worktrees, which is what the exit-31 message tells the
      user to check.
- [x] 5.5 (#1197.) `restack.md` and `git-worktree/SKILL.md`:
      - Describe the recorded-only scope, and say that both providers now
        record each worktree they rebase.
      - Describe each exit-31 condition.
      - Give the fix command (`git -C <wt> rebase --abort` or `git
        worktree prune`).
- [x] 5.6 (Seven new tests. Suite: 127 passed. #1197.) Bats tests in `tests/worktree-restack.bats`:
      - An unreadable `head-name` gives 31 and names the worktree.
      - A deleted, unpruned worktree does not block.
      - A foreign worktree rebasing a chain branch outside the record is
        left alone.
      - Two stuck worktrees are both attempted and both named.
      - A plain `--abort` with nothing to abort does not touch the run
        worktree.
      - Github provider: a rebase stuck in another chain worktree that the
        run recorded is aborted. A worktree the run never recorded is left
        alone. State with github entries passes `validate_state`.

<!-- deepen-plan: codebase -->
> **Codebase:** The paths are
> `plugins/yellow-core/skills/git-worktree/tests/worktree-restack.bats` and
> `plugins/yellow-core/commands/worktree/restack.md`. `status` is a
> subcommand, not a `--status` flag. `cmd_status` (`:1897`) prints only
> `E_PATH` entries.
<!-- /deepen-plan -->

- [x] 5.7 (New `minor` changeset, #1197.) Bump #1080's yellow-core changeset to `minor`.

<!-- deepen-plan: codebase -->
> **Codebase:** Task 5.7 needs a new `minor` changeset for `yellow-core`.
> The old patch changeset was consumed by #1074.
<!-- /deepen-plan -->

### Phase 6: W6 — council-roster local false positive (new branch off `main`)

- [x] 6.1 (`.ruvector` only; no `.worktrees` directory exists here. #1185.) In `scripts/validate-council-roster.js` `redactionExcluded`, skip
      `.ruvector` and `.worktrees` segments next to `node_modules`. The
      ledger filters that same walk, so both rules are fixed.

<!-- deepen-plan: codebase -->
> **Codebase:** Confirmed: `scripts/validate-council-roster.js` fails locally
> right now with ".ruvector/intelligence.json restates the council roster but
> is not registered".
> - `redactionExcluded` (`:924–931`) skips only `.git` and `node_modules`.
> - `ledgerExcluded` (`:240–245`) is a filtered view of the same walk
>   (`:1068–1079`), so one exclusion fixes both.
> - `.ruvector/` is gitignored (`.gitignore:105`). `.worktrees` is not, so
>   add it only if a local directory actually trips the check.
<!-- /deepen-plan -->

- [x] 6.2 In `tests/integration/validate-council-roster.test.ts`, under
      "audit regressions", next to the nested `node_modules` case, add a
      test: write `.ruvector/intelligence.json` with a roster sentence and
      expect status 0.
- [x] 6.3 (Passes, including against the main clone's 5.1 MB store; no changeset needed.) Run `pnpm validate:schemas` locally and confirm it passes with the
      real `.ruvector/` present. Let `changeset-check` decide whether a
      changeset is needed. It probably is not, since only `scripts/` and
      `tests/` change.
- [x] 6.4 (Filed as #1184.) File an issue to move the walk to `git ls-files --cached --others
      --exclude-standard`, with an existence filter and a non-git fallback.
      `scripts/validate-flow-namespace.js` `gitIgnoredEntries()` is the
      model.

<!-- deepen-plan: codebase -->
> **Codebase:** For 6.4, the model is `scripts/validate-flow-namespace.js:401`
> (`gitIgnoredEntries`). Its fallback list already includes `.ruvector/`
> (`:398`).
<!-- /deepen-plan -->

### Phase 7: Land and re-triage

- [x] 7.1 (Ran per branch: validate:agents, lint:plugins, validate:shell-compat, check:shell-parse and the affected bats suites.) For each amended PR, bottom-up: run `pnpm validate:agents`,
      `pnpm lint:plugins`, `pnpm validate:shell-compat` and the plugin bats
      suite. Commit with `gt modify` from one worktree at a time.
- [x] 7.2 (Not applicable: six independent branches off `main`, each submitted on its own.) Restack once, then submit the stack.
- [x] 7.3 (2026-10-16: every card was checked against `main` at
      `e688e6c59`, as below. Each unfixed card is recorded in a Linear issue,
      so the ledgers for #1077–#1080, #1193 and #1197 were then pruned with
      `review-ledger.sh prune`. #1199 is still open and its ledger is kept.)
      Run `/review:triage` on #1077–#1080. Close each card listed above
      as fixed, or dismiss it with a reason. Re-check in the tree before
      choosing "Approve all".

<!-- card-reconciliation: 2026-10-16 -->
> **Card results (main `e688e6c59`).** Each entry is a `finding_id`
> prefix → the commit that fixed it, or the follow-up issue.
>
> **#1077: 16 of 16 fixed in `721f4376c` (#1077).** The cards are
> `139bbd7beb`, `f29e122a9a`, `8595911c84`, `14900ca631`, `7965f157b2`,
> `ea5d3fe439`, `c6d784ddb1`, `9ea8200ed9`, `c2bc7f2bc6`, `576abeb54c`,
> `d9d15c49ea`, `48e9bf1372`, `81babbd58e`, `5b40dece4c`, `31445f537b` and
> `b426b544bf`. #1193 (`546ed96a8`) added the interactive ask and
> `--dry-run` on top. The plan's residual on `ea5d3fe439` is still open:
> both `dirty-tree-cleanup.md` copies still pass `--no-ignored-guard`.
> That residual is CLAUDE-156.
>
> **#1078: 11 fixed in `a1798c171` (#1078), 14 open.**
> - Fixed: `5e93bdf43d`, `05b39b48c7`, `8c8766d305`, `ac06ee6b3c`,
>   `5db73e203e`, `ea7f51eefa`, `3bbf9cd9af`, `c7f2b3a5b8`, `6397fc959d`,
>   `d8eec5a3e1` and `92f28b52d3`.
> - Open, covered by the open #1199, tracked in CLAUDE-149: `6ffb97658e`,
>   `a1819ff8ff`, `677f20523a`, `e74691c6e7`, `826d48217a`, `0f8946269e`,
>   `f83a748072`, `a273e74077`, `e9ed1f6d61`, `a45361a5f9` and
>   `e3f9639703` (also CLAUDE-84).
> - Open, not covered by #1199: `570be26ae8` and `9a9d05c66c` → CLAUDE-150
>   (`9a9d05c66c` is also CLAUDE-84). `6c913af5ea` (sweep.md is 613 lines)
>   → CLAUDE-151.
>
> **#1079: 12 of 12 fixed.**
> - `2d877ca9a` (#1079): `2df975eeed`, `5912ee11a0`, `59f170dc5a`,
>   `50e43014ee`, `5d1053220e`, `348f03fbc8`, `d4855a42af`, `711aeebe82`,
>   `534b2aeb72`, and `d2c16a1a1e` (refined in #1187).
> - `84dadd949` (#1187): `ab372eb399` and `365d7e213f`. Aligning the redact
>   lists stays in #1186.
>
> **#1080: 13 fixed, 10 open.**
> - Fixed in `a6cd602ff` (#1080): `8a24e4099b`, `ba15cd1e29`,
>   `976cbf822b` and `1e828b98de`.
> - Fixed in `d8a000c68` (#1197): `16af6d43c4`, `e14910da8d`,
>   `213629705b`, `d34b6b9c79`, `b57336a973`, `f718b7ad61`, `4d409925f7`,
>   `7cf25139a3` and `e4905122bc`.
> - Open: `997aa5f2c1`, `5be8911b63`, `639caade38`, `b4b98ec491` and
>   `34e32cd1a1` → CLAUDE-152. `39702f1054` and `d1f6c880eb` → CLAUDE-153.
>   `f29826af7a` and `ff75036f69` → CLAUDE-154. `8836494d8b` → CLAUDE-155.
<!-- /card-reconciliation -->
- [x] 7.4 (Each PR body is its commit message, which states the decision it carries out.) Record the five decisions above in each PR body.

<!-- deepen-plan: codebase -->
> **Codebase:** Phase 7 changes now that the stack has landed:
> - **7.1 and 7.2.** Use `gt branch create` and `gt submit` for the new
>   branches off `main`. There are no landed PRs to `gt modify`.
> - **7.3.** Still applies, because the ledger is local. Re-check each card
>   against `main`, not against a PR head.
> - **7.4.** Record the decisions in the new PR bodies.
<!-- /deepen-plan -->

## Acceptance Criteria

1. In an interactive `/review:resolve`, the user is asked before an
   unreported deny-listed edit is reverted. `--non-interactive` reverts it
   and lists the paths in Step 9. Verify with bats and a skill-content pin.
2. A gitignored deny-listed change made during a resolve reaches the
   ignored-file stop in both modes. Verify with bats.
3. A nested `.git` under a deny-listed directory no longer stops the other
   reverts. Verify with bats.
4. `.claude/agent-memory/` writes survive every unattended cleanup, and
   `rp_denied` still refuses resolver edits there. Verify with bats.
5. The sweep probe returns the right ignore state for a fork-based PR and a
   shallow clone, and a PR-specific stop lets `/review:sweep-all` continue.
   Verify with `sweep-probe.bats` and the sweep-all regex tests.
6. `worktree-restack.sh --abort` never aborts a rebase in an unrecorded
   worktree, and exits 31 naming the worktree when a git-dir cannot be read.
   Under both providers it aborts a stuck rebase in any worktree the run
   recorded. Verify with bats for graphite and github.
7. No external command runs before `commit-resolve-fixes` sanitises PATH.
   Verify with the shim tests in both modes.
8. `pnpm validate:schemas` passes locally with `.ruvector/intelligence.json`
   present. Verify with the integration test and a manual run.
9. Every card ID listed in Phases 2–5 is `fixed` or dismissed with a reason
   in the ledger.

## Edge Cases

- **`.env.local` rewritten by a dev server during verify.** It trips the
  ignored-file stop, and in `/review:sweep-all` that becomes a batch-ending
  `verify=skipped`. Accept it and document it. A false stop is safer than
  committing past a changed secret file.

- **gh-stack rebases in whichever worktree holds the branch.** "Recorded"
  means `S_RUN` plus the `E_PATH` entries, not every worktree whose branch
  is in the chain. Under Decision 5 the github path adds an entry for each
  worktree it rebases, so its own stuck rebases stay abortable.

<!-- deepen-plan: external -->
> **Research:** `gh stack` refuses to run when an owning worktree is dirty,
> busy or missing, so a stuck rebase in a recorded worktree can also block
> the next `gh stack rebase` (exit 7). `--abort` must clear it, not only
> report it.
<!-- /deepen-plan -->

- **The gh api tree call is truncated** on very large repos
  (`truncated: true`). Fall back to per-directory `contents` calls along the
  path's ancestors.
<!-- deepen-plan: codebase -->
> **Codebase:** This edge case goes away once 3.1 uses a single
> non-recursive tree call for the root `.gitignore`. A non-recursive listing
> cannot be truncated.
<!-- /deepen-plan -->

- **zsh `noclobber` and word splitting** in any fenced block that changes.
  Run `pnpm validate:shell-compat` and `pnpm check:shell-parse`.

## Security Considerations

- The revert-only exemption must not widen `rp_denied`. Resolvers still
  cannot write agent memory, which would let them steer later agents.
- The probe never executes head-supplied content. It only writes `.gitignore`
  blobs as data, and it refuses symlink blobs.
- The PATH prelude runs before any external command in
  `commit-resolve-fixes`, including `--check-ranges`.

## References

- `plans/cycle-1-resolve-hardening-and-ci-split.md` is the parent plan,
  with the stack decomposition.
- Brainstorms: `docs/brainstorms/2026-10-05-CLAUDE-70…74-*.md`.
- `docs/solutions/security-issues/resolver-guards-trust-prompt-and-git-status-only.md`
- `docs/solutions/logic-errors/restack-script-lock-takeover-and-fail-open-checks.md`
- `docs/solutions/integration-issues/gh-wrapper-scripts-collapse-error-classes.md`
- `docs/solutions/workflow/gt-sync-exit-128-stale-index-lock.md`
- Files and line references are on the stack top at plan time:
  - `plugins/yellow-review/skills/pr-review-workflow/scripts/run-verify-command`
    (`--revert-denied` around line 555, nested-repo die around line 657)
  - `plugins/yellow-review/lib/resolve-paths.sh` (`rp_denied` around line
    318, `rp_ignored_changed_since` around line 642)
  - `plugins/yellow-review/commands/review/sweep.md` (Step 1b at lines
    133–182, Skip line at lines 455–470)
  - `plugins/yellow-review/lib/review-ledger.sh` (`remote-head` around line
    2079)
  - `plugins/yellow-core/skills/git-worktree/scripts/worktree-restack.sh`
    (lines 1384–1503)
  - `plugins/yellow-review/skills/pr-review-workflow/scripts/commit-resolve-fixes`
    (`check_tools_outside_repo` around line 611)
  - `scripts/validate-council-roster.js` (`redactionExcluded` around line
    924)
- Prior art for the ignore probe: `git check-ignore` with a temp work-tree.
  pre-commit's `staged_files_only.py` is the precedent for keeping a patch
  before any revert.

<!-- deepen-plan: external -->
> **Research:** Sources for this enrichment (2026-10-14):
> - https://docs.github.com/en/pull-requests/reference/stacked-prs-cli-commands
> - https://github.com/github/gh-stack/blob/main/internal/git/gitops.go
> - https://github.com/github/gh-stack/blob/main/cmd/rebase.go
> - https://github.com/github/gh-stack/blob/main/skills/gh-stack/references/troubleshooting.md
> - https://github.com/git/git/blob/master/Documentation/git-rebase.adoc
> - https://github.com/git/git/blob/master/Documentation/git-worktree.adoc
> - https://github.com/git/git/blob/master/Documentation/git-rev-parse.adoc
> - https://github.com/git/git/blob/master/builtin/check-ignore.c
> - https://git.github.io/htmldocs/gitignore.html
> - https://mywiki.wooledge.org/BashFAQ/028
<!-- /deepen-plan -->
