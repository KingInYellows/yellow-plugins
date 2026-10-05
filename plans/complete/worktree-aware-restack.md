# Feature: worktree-aware restack (`/worktree:restack`)

> **Status: shipped (PR #993).** Plan-time text below is design history: where it
> differs, the shipped contract is the header of
> `plugins/yellow-core/skills/git-worktree/scripts/worktree-restack.sh`. Known
> differences: exit `31` (state kept) and `60` (submit failed) were added; the
> state file has no `token`, `tool` or per-entry `phase`/lock fields; the GitHub
> base for the ancestry check is the current branch's parent; lock takeover runs
> inside a guard directory; `runtime/probe/` was a local scratch path, not committed.

## Overview

A stack whose branches are each checked out in their own worktree cannot be
restacked in one pass: the provider has to check a branch out, and git refuses
with `fatal: '<branch>' is already used by worktree at <path>`. The workaround
today is one restack per worktree, by hand.

`/worktree:restack` (yellow-core) records each stack worktree's branch,
detaches it, runs one restack through the active stacked-PR provider, and
restores every worktree. One worktree per PR is kept. Content conflicts still
happen (they come from the commits); the command pauses on them and resumes
with `--continue` / `--abort`.

Decisions taken with the user (2026-10-03):

- Home: a new yellow-core command beside `/worktree:cleanup`, routed through
  `stack-provider-router`, driving the registry's primitives. The
  detach/record/restore helper lives next to `worktree-manager.sh` in the
  `git-worktree` skill.
- Conflict model: pause, keep stack worktrees detached, persist state;
  `--continue` runs the provider's continue then restores, `--abort` runs the
  provider's abort then restores.
- GitHub-native path (decided after enrichment): gh-stack ≥ 0.2.0 only. On
  0.2.0+, gh-stack rebases across worktrees natively, so the command runs its
  preflight and then the adapter's `rebase` from the current worktree, with no
  detach. On < 0.2.0 it refuses and tells the user to upgrade. No
  github-workflow changes. (The local gh-stack is v0.1.0 and needs
  `gh extension upgrade stack` before a live GitHub test.)

## Problem Statement

### Proof results (throwaway repos, 2026-10-03)

Tested in `runtime/probe/worktree-restack{,-ghstack}/` (setup script:
`runtime/probe/worktree-restack-proof-setup.sh`) with gt 1.7.20, gh-stack
v0.1.0 and git 2.55.0: a three-branch stack, one worktree per branch, trunk
advanced.

| Case | Result |
|---|---|
| `gt restack --upstack`, clean worktrees, no conflict | Works on 1.7.20: gt rebases with `merge-tree` + `commit-tree`, then `git -C <wt> reset --keep <new>` in each owning worktree |
| `gt checkout <branch>` held by another worktree | The exact `already used by worktree` error |
| Dirty worktree, files untouched by the restack | Works; edits kept (`reset --keep`) |
| Dirty file the restack changes | gt refuses: `Cannot restack checked out branch … conflicting unstaged changes`; no ref moved |
| Content conflict on a mid-stack branch | **Fails**: gt falls back to `git rebase --onto <parent> <base> <branch>`, which needs a checkout → `already used by worktree`. Lower branches stay restacked, no rebase left in progress |
| Same, after `git checkout --detach` in the other stack worktrees | **Hypothesis holds**: conflict pauses in the run worktree; `gt add` + `gt continue` finishes and returns the run worktree to its branch |
| Restore via `git checkout <branch>` | Clean worktree: fine. Non-overlapping dirty edit: carried. Overlapping dirty edit: refused, worktree left detached, edit intact (no loss, but stranded) |
| Restore the conflicting branch's worktree while the conflict is paused | Impossible: the branch counts as in use by the rebasing worktree |
| Restore a descendant before `gt continue` | `gt continue` then fails with the worktree error on that branch (safe, but fails) |
| `gt abort` during the paused conflict | Rolls back the **whole** restack (including already-restacked branches); full restore then works |
| `gh stack rebase` (v0.1.0), clean worktrees | Fails with the worktree error even without a conflict (no plumbing path). Its state is in `<git-dir>/gh-stack`, so it only works from the main checkout |
| Same, after detaching the stack worktrees | Works from the main checkout; restore clean |
| `gt submit --stack --dry-run` | Not verifiable offline: local stack validation passed, then a GitHub 404 for the fake repo. Submit pushes refs, so no checkout is involved — still unverified |

### Upstream changes (verified from release notes)

- **gt 1.8.4 (2026-04-13)**: "Updated the behavior of gt commands to only
  affect the current worktree." On gt ≥ 1.8.4 a plain restack skips branches
  held by other worktrees, apparently silently. Detaching is then needed even
  without a conflict, and success must be checked per branch, not by exit code.
- **gh-stack v0.2.0 (2026-10-02)**: native cross-worktree `rebase` / `sync` /
  `modify` (each change runs in the owning checkout), a shared
  `<common-dir>/gh-stack` catalog, a dirty-worktree preflight, and `--continue`
  / `--abort` from any worktree. Requires git ≥ 2.36. The installed extension
  is v0.1.0.

<!-- deepen-plan: external -->
> **Research:** Graphite's command reference states it directly: "`gt restack` skips branches
> checked out in other worktrees. Starting in `gt` version `1.8.4`, `gt restack`
> will skip non-trunk branches that are checked out in another worktree." The
> multiple-worktrees page contradicts this ("exits with an informative error"),
> and neither page documents the skip message or exit code. A third-party wrapper
> (pi-graphite) notes "gt frequently exits 0 while skipping branches". Nothing
> documents how a *detached* worktree is treated, so Task 1.1 must test it.
> See https://graphite.com/docs/command-reference,
> https://graphite.com/docs/multiple-worktrees
<!-- /deepen-plan -->

Implication: detaching is the right default for Graphite on every version.
For GitHub it is needed on gh-stack < 0.2.0 and unnecessary on ≥ 0.2.0.

## Proposed Solution

### Shape

- `plugins/yellow-core/commands/worktree/restack.md`. A thin orchestrator: it
  resolves the provider, runs preflight, shows the plan, confirms, then calls
  the script and interprets its exit code. It holds no `gt`/`gh stack`
  literals, which keeps `validate-provider-neutral-commands` at 0 for it.
- `plugins/yellow-core/skills/git-worktree/scripts/worktree-restack.sh`.
  Standalone bash (`#!/usr/bin/env bash`, `set -uo pipefail`), invoked as
  `bash "${CLAUDE_PLUGIN_ROOT}/skills/git-worktree/scripts/worktree-restack.sh" <sub> …`.
  It is never sourced, so it needs no shell-compat tier entry. All provider
  CLI calls live here and mirror the registry's `inspectStack`,
  `rebaseUpstack`, `continueConflict`, `abortConflict` and `submitStack`
  entries.
- Each subcommand is one Bash call that does its whole job. `start` detaches,
  restacks and (on success or non-conflict failure) restores inside **one**
  process, so its `trap` covers every non-conflict exit. Crossing tool calls
  is needed only for a paused conflict, and the state file carries that.

### Subcommands and exit codes

| Sub | Does |
|---|---|
| `preflight --provider P` | Read-only. Prints the run worktree, the stack branch set, the worktrees to detach, and any refusal reasons |
| `start --provider P [--submit]` | Lock, write state, detach, restack, verify, restore, clear state, optional submit |
| `continue` | Provider continue (recorded provider), then verify + restore + clear; another conflict → paused again |
| `abort` | Provider abort, then restore + clear |
| `status` | Prints state and any stack-branch worktree left detached without state |
| `restore` | Restore only (recovery after a manual provider finish); best-effort per entry |

Exit codes (one per outcome, so the command can branch): `0` done · `2`
usage · `3` restack already in progress (lock or state exists) · `4` state
invalid · `5` active provider differs from the recorded one · `10` paused on
conflict · `20` preflight refused · `30` restack failed, worktrees restored ·
`40` partial restore (some worktree left detached; per-entry lines say why) ·
`50` restack incomplete (ancestry check failed), worktrees restored, no submit.

### Key design decisions

1. **Detach policy.** Graphite: always detach (needed on conflict for 1.7.x and
   always for ≥ 1.8.4; harmless otherwise). GitHub: never detach. Require
   gh-stack ≥ 0.2.0 and run the adapter's `rebase` natively. On < 0.2.0, or
   when the version can't be parsed, refuse (exit 20) with an upgrade
   message. The version comes from `gh extension list`. The dirty and
   mid-operation preflight applies to both providers.

   <!-- deepen-plan: external -->
   > **Research:** gh-stack v0.2.0 resolves ownership from `git worktree list --porcelain -z`. A
   > plainly detached worktree owns no branch. A mid-rebase one owns the branch in
   > `rebase-merge/head-name`. Dirty or busy affected worktrees stop the run before
   > any rewrite (`uncommitted changes in worktree <path>…`, `a Git operation is
   > already in progress in worktree <path>…`). The recovery record is
   > `<common-dir>/gh-stack-rebase-state`, and read-only `view` works from linked
   > worktrees. So on ≥ 0.2.0 the run-from-main-checkout constraint also goes away:
   > run from the current worktree with no detach.
   > See https://github.com/github/gh-stack/pull/529,
   > https://raw.githubusercontent.com/github/gh-stack/v0.2.0/README.md
   <!-- /deepen-plan -->

   <!-- deepen-plan: codebase -->
   > **Codebase:** The gh-stack version parse is new code. `gh extension list` is tab-separated
   > (`gh stack<TAB>github/gh-stack<TAB>v0.1.0`), and `lib/stack-tooling-probe.js`
   > (:150-168, :193) never extracts the extension version: its `version` field is
   > the `gh --version` line.
   <!-- /deepen-plan -->

2. **Run worktree.** Graphite: the current worktree, which must be on a
   tracked non-trunk branch. The restack set is that branch plus its upstack
   (`restack --upstack`, matching `rebaseUpstack`). GitHub (≥ 0.2.0): the
   current worktree. The adapter acts on the current branch, so the
   branch-targeting gap below doesn't arise, and nothing is detached. A
   GitHub pause therefore needs no restore: `--continue` / `--abort` map to
   the adapter's `rebase --mode continue|abort`. The run worktree is never
   detached, but it gets the same dirty/mid-operation checks.

   <!-- deepen-plan: codebase -->
   > **Codebase:** **Blocker for the GitHub path as written.** The adapter cannot target a
   > branch. `rebase({mode, remote})` emits only `gh stack rebase --<mode> [--remote]`
   > (`plugins/github-workflow/lib/github-stack-runtime.js:464-478`), and `view` is a
   > bare `gh stack view --json` (:409-412). Run from the main checkout on trunk,
   > both act on trunk, which likely gives `NOT_IN_STACK`. The "fall back to direct
   > calls" trade-off is not allowed: `plugins/github-workflow/CLAUDE.md:11-18`
   > forbids any command or skill from calling `gh stack <verb>` directly. Options:
   > (i) add a validated `--branch` to the adapter's `rebase`/`view`, which adds
   > `github-stack-runtime.js`, `tests/integration/github-stack-runtime.test.ts:184-211`
   > (pins `['stack','rebase','--upstack']`) and a github-workflow changeset; or
   > (ii) support GitHub only on gh-stack ≥ 0.2.0, where the current worktree can
   > run the rebase natively (no detach, no branch targeting), and refuse on 0.1.x
   > with an upgrade message.
   <!-- /deepen-plan -->

3. **Selection.** Detach exactly the worktrees whose branch is in the restack
   set, excluding the run worktree. Worktrees on other branches are not
   touched or reported. A stack branch in the main checkout is an ordinary
   selected worktree for Graphite.
4. **Refusals (preflight, before anything mutates).** A selected worktree that
   is dirty (ignoring an untracked `.ruvector` symlink, which
   `worktree-manager.sh` creates and `.gitignore`'s `.ruvector/` does not
   match), mid-operation (`rebase-merge`, `rebase-apply`, `MERGE_HEAD`,
   `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `sequencer`, located per worktree via
   `git -C <wt> rev-parse --path-format=absolute --git-path`), locked, or
   prunable. Also refused: a non-linear stack (a fork in the inspected
   stack), a worktree path containing a tab or newline, a current branch not
   in a stack, and an existing state file or live lock.
5. **Confirmation.** The command lists every worktree it will detach (path +
   branch) and asks once via `AskUserQuestion` before `start`. Worktrees
   outside the repo, such as `~/.herdr/worktrees/*` owned by another session,
   are listed like any other; the user decides. A `git worktree lock` is
   treated as "owned by someone else" and refused.
6. **State file.** `<git-common-dir>/yellow-core/worktree-restack/state`,
   `umask 077`, written atomically (tmp + `mv -f`, `>|`), **before** the first
   detach and updated after each step. Fixed-field TSV, never sourced or
   eval'd. Header: schema `v1`, provider, provider tool version, absolute
   common dir, run worktree, `submit` flag, a random token, the stack branch
   list. Entries: `path<TAB>refs/heads/<branch><TAB><sha-at-detach><TAB>phase`
   (`detached|restored|skipped`). Before writing anything, `start` prints the
   manual recovery lines (`git -C <path> checkout <branch>`) to stderr, so the
   transcript holds them even if the state is lost.
7. **Lock.** `mkdir <dir>/lock.d` holding a `pid`/`started` file. The lock is
   held across a paused conflict. It is reclaimable only when its pid is dead
   **and** no state file exists. With state present, every path points to
   `--continue`, `--abort` or `status`. Scope: one restack per git common dir.

   <!-- deepen-plan: codebase -->
   > **Codebase:** `mkdir`-lock precedents with a generation-safe stale reclaim (directory
   > inode + mtime, `.reclaim.*` marker) are `plugins/yellow-ruvector/lib/install-ruvector.sh:296-330`
   > and `plugins/yellow-ruvector/hooks/scripts/lib/coedit.sh:258-336` (`coedit_lock_path`).
   > Copy that rather than "pid dead and no state", which misses the window between
   > `mkdir` and the pid write. `flock` (as in `review-ledger.sh:157-171`) is
   > unsuitable here because it dies with the process, and the lock must survive a
   > paused conflict.
   <!-- /deepen-plan -->

8. **State is untrusted on read** (`docs/solutions/security-issues/shell-owned-state-is-not-a-boundary-against-write.md`).
   `continue`, `abort`, `restore` and `status` re-validate the following before
   acting:
   - the common dir matches the current repo, and the provider matches the
     router's current state (else exit 5, naming the original provider's
     command)
   - each path is in a fresh `git worktree list --porcelain -z`
   - each ref matches `refs/heads/*` and passes `git check-ref-format --branch`
   - each SHA matches `^[0-9a-f]{40}([0-9a-f]{24})?$`
   - no field has a leading `-` or `..` or a control character

   Every git call uses `-C` and `--`. The residual (a model that writes a
   self-consistent state file) is documented, not claimed closed.
9. **Restore is per-entry best-effort.** For each entry:
   - path gone or no longer a worktree → drop it with a warning
   - branch deleted → drop it with a warning
   - worktree now on another branch → skip, keep the entry, report it (the
     user moved it)
   - detached at a SHA other than the recorded one (someone committed in the
     detached worktree during the pause) → skip, keep the entry, and print
     the floating commits (`git -C <wt> log --oneline <recorded>..HEAD`)
     with a rescue line (`git -C <wt> branch <name> HEAD` or a cherry-pick
     onto the restacked branch). Never restore over them silently: a
     checkout would orphan those commits
   - branch checked out elsewhere → skip and report (never
     `--ignore-other-worktrees`)
   - otherwise `git -C <wt> checkout <branch>` with no `-f` and no `-m` (`-m`
     auto-stashes into the shared stash stack); on refusal leave it detached
     and print the manual line

   The state is deleted only when every entry is `restored` or dropped.
   Otherwise exit 40.
10. **Success is ancestry, not exit code.** After the provider reports done,
    check that each restacked branch has its stack-order parent (trunk for the
    bottom) as an ancestor. On failure: restore, exit 50, never submit.

    <!-- deepen-plan: codebase -->
    > **Codebase:** Use `gt branch info --branch <b>` for the parent; it prints `Parent: <b>`
    > (verified on gt 1.7.20). It is more reliable than glyph parsing. `gt parent`
    > and `gt children` act only on the current branch. No plugin uses any of these
    > yet.
    <!-- /deepen-plan -->

11. **Submit.** Only with `--submit` (persisted in state across a pause), only
    after exit 0, and only through `submitStack` (Graphite
    `gt submit --stack --no-interactive`, GitHub via the adapter's `submit`).
    A submit failure is reported and does not unwind the restore. Never
    `git push`, never `gh pr create`.
12. **`--abort` warning.** Before running it, say that Graphite's abort rolls
    back the whole restack, including branches that had already restacked
    cleanly.
13. **Paused worktrees are marked and guarded.** A pause can last minutes or
    days, and other sessions share these worktrees. A commit made in a
    detached worktree lands on no branch.
    - On pause, `git worktree lock --reason "worktree:restack paused — do
      not commit; run /worktree:restack --continue or --abort"` each
      detached worktree. Preflight refuses already-locked worktrees, so every
      lock is ours. The state records this, and restore unlocks only entries
      it locked. The lock shows in `git worktree list` and makes
      `/worktree:cleanup` skip the worktree (`git worktree lock` does not
      block commits; decision 9 catches those).
    - The exit-10 message lists every detached worktree (path, branch) and
      says plainly: do not commit there until `--continue` / `--abort`.
    - `status`, `--continue` and `--abort` first check each detached entry
      for commits made since detach (decision 9) and report them before doing
      anything else.

### Trade-offs considered

- *Retry-on-error* (run a plain restack, detach only when the worktree error
  appears) avoids detaching in the clean case on gt 1.7.x. Rejected: on
  gt ≥ 1.8.4 the clean case skips silently, so we'd detach anyway. It also
  adds a second code path.
- *Abort-then-restore on conflict* keeps the "restore already done" property
  but throws away conflict-resolution progress. The user picked pause/resume.
- *GitHub on gh-stack 0.1.x* would need the adapter extended with `--branch`
  (direct `gh stack` calls are forbidden by github-workflow), and that path
  becomes dead weight once 0.2.0 is the floor. Rejected in favour of a
  gh-stack ≥ 0.2.0 requirement.

<!-- deepen-plan: codebase -->
> **Codebase:** Registry deviation to state explicitly or fix:
> - the script's `restack --upstack` vs `rebaseUpstack` = `['restack']` (`stack-operation-registry.js:149`)
> - `submit --stack` vs `submitStack` = `['submit','--no-interactive']` (:145)
> - `inspectStack` has no `--stack` (:117)
> - the GitHub entries spell `['--upstack']`/`['--continue']`/`['--abort']`, but the adapter CLI takes `--mode upstack|continue|abort`
> - the adapter's `submit` adds `--auto` itself
<!-- /deepen-plan -->

## Implementation Plan

### Phase 1: Spikes (no repo changes)

- [x] 1.1: Install gt ≥ 1.8.4 into a scratch npm prefix (`npm i --prefix
      <scratch> @withgraphite/graphite-cli@<latest>`; leave the user's gt
      untouched) and rerun the proof matrix with it. Confirm: (a) the plain
      restack skips held branches, and whether it says so; (b) restack after
      detach works and `continue` returns the run worktree to its branch.
      Record the results in this plan.

      **Results (gt 1.8.6, 2026-10-03, scratch prefix):**
      - (a) Plain `gt restack --upstack` from the run worktree skips every
        branch held by another worktree, **exit 0**, and says so on stdout:
        `Did not restack branch <b> because it is checked out in worktree
        <path>.` The ancestry check (decision 10) is the only reliable signal;
        the message text is a bonus, not a contract.
      - (b) With the other stack worktrees detached, `restack --upstack`
        restacks the whole stack, exit 0. A mid-stack content conflict exits
        **1**, pauses in the run worktree (`rebase-merge/` plus `.gtcontinue`
        in its per-worktree git dir, `Unmerged files:` list in the output), and
        `gt add` + `gt continue --no-interactive` finishes the stack and
        returns the run worktree to its branch.
      - Same conflict **without** detaching: still exit 0 and skipped, so on
        1.8.x a conflict never even surfaces; detach is required on every
        version, as decision 1 says.
      - Probe script: scratchpad `spike.sh <gt> <skip|detach-clean|plain-conflict|detach-conflict>`.

      <!-- deepen-plan: codebase -->
      > **Codebase:** Task 1.1 note: no file in the repo mentions gt 1.8.4 or gh-stack 0.2.0
      > (`docs/research/2026-08-18-github-stack-provider-operations-revalidation.md`
      > covers only gh-stack v0.1.0). The scratch install is the only local
      > corroboration available.
      <!-- /deepen-plan -->

- [x] 1.2: GitHub (≥ 0.2.0 only): in the throwaway repo, upgrade gh-stack (or
      install v0.2.x under an isolated `GH_CONFIG_DIR` so the user's v0.1.0
      stays put unless they upgrade). Confirm that the adapter's
      `rebase --mode upstack` from a linked worktree rebases branches held by
      other worktrees in place, that a dirty one stops it before any rewrite,
      and how a conflict surfaces in the adapter's JSON (`status: CONFLICT`,
      which worktree holds the paused rebase). Settle the adapter-path
      resolver (annotation below).

      **Results (gh-stack v0.2.0 under isolated `XDG_DATA_HOME` + `GH_CONFIG_DIR`,
      local bare origin, 3-branch stack, one worktree per branch, 2026-10-03;
      probe script: scratchpad `spike-gh.sh`):**
      - Clean: the adapter's `rebase --mode upstack` run from `wt-s1` rebased
        s1, s2 and s3 in place (each held by its own worktree), `status:
        SUCCESS`, no detach. Progress lines are on **stderr**, `stdout` is empty.
      - Dirty `wt-s2`: stops before any rewrite (every tip unchanged),
        `status: ERROR`, exit 1, stderr `uncommitted changes in worktree
        <path>; commit or stash them before continuing`.
      - Conflict on s2: `status: CONFLICT`, `exitCode: 3`. stderr names the
        paused worktree (`Conflict worktree: <path>`) and lists `Conflicted
        files:`. That worktree is left detached with `AA <file>`; s1 and s3
        stay on their branches. Recovery state is `<common-dir>/gh-stack-rebase-state`
        plus `gh-stack-operation.lock`. Continue/abort run from any worktree.
      - gh-stack v0.2.0 also accepts `gh stack rebase [branch]`, which the
        adapter does not expose; not needed here.
      - Adapter-path resolver: try `${CLAUDE_PLUGIN_ROOT}/../github-workflow/lib/github-stack-runtime.js`
        (checkout), then the highest `"${CLAUDE_PLUGIN_ROOT}"/../../github-workflow/*/lib/github-stack-runtime.js`
        by dotted-numeric compare (`plugins/yellow-debt/lib/validate.sh` shape);
        fail with a message naming github-workflow when neither resolves.

      <!-- deepen-plan: codebase -->
      > **Codebase:** `${CLAUDE_PLUGIN_ROOT}/../github-workflow/lib/github-stack-runtime.js`, the
      > form used by `flow/work.md:151`, `flow/review.md:456`, `stack-traversal/SKILL.md:64`
      > and `devin/review-prs.md:277`, **does not resolve in the installed cache**
      > (`cache/yellow-plugins/<plugin>/<version>/`): `yellow-core/2.6.2/../github-workflow`
      > does not exist. Use the documented resolver: try the sibling path, then glob
      > `"${CLAUDE_PLUGIN_ROOT}"/../../github-workflow/*/lib/…` with a numeric version
      > compare (`docs/solutions/code-quality/cross-plugin-shared-skill-pattern.md:319-345`,
      > implemented at `plugins/yellow-debt/lib/validate.sh:12-13,55`). Fail loudly when
      > github-workflow is not installed, and add a bats case that builds a
      > `cache/<plugin>/<version>` tree. The adapter always exits 0 with JSON: read
      > `.status` (`SUCCESS`, `CONFLICT`, `NOT_IN_STACK`, `REBASE_ACTIVE`, `LOCK_FAILED`,
      > … at :78-92). It also inherits cwd, so `cd` to the run worktree for each call.
      <!-- /deepen-plan -->

- [x] 1.3: Graphite stack inspection: pick the parse for the restack set and
      parent order (`gt log short --stack --no-interactive`, stripping graph
      glyphs, as `skills/stack-traversal/SKILL.md` does) and fork detection.
      Confirm it on a forked stack.

      **Results (gt 1.7.20, stack main → a → b → {c, d}, trunk advanced):**
      - Output is top-first, trunk last; `◉` marks the current branch. Lines
        below `◉` are ancestors, lines above it are the upstack. Restack set =
        the `◉` line plus every line above it. Suffixes like `(needs restack)`
        are stripped (`sed 's/ ([^)]*)$//'`).
      - A fork off the current branch or above renders a branch line whose
        prefix has a `│` column before its glyph (`│ ◯  agent/d`) and a `─┘`
        joiner. Rule: any line with text before its first `◯`/`◉` is a fork →
        refuse (exit 20). From `c`, `--stack` shows only c's ancestors (siblings
        off ancestors are hidden), so a fork below the run branch is not
        detected and not restacked; that is correct for `--upstack`.
      - `gt branch info --branch <b>` prints `Parent: <b>` on its own line;
        used by the ancestry check for the parent of each restacked branch
        (trunk for the bottom). `gt children`/`gt parent` act on the current
        branch only; unused.
      - `restack --branch`/`--cwd` unverified and not needed.

<!-- deepen-plan: codebase -->
> **Codebase:** Task 1.3 note: on gt 1.7.20, `gt log short --stack --no-interactive` prints
> top-first with trunk as the last line, and lines carry suffixes such as
> `(needs restack)` (existing consumers do not strip them). A fork renders as
> extra columns (`│ ◯  b3b`, `◉─┘`), and `--stack` hides sibling forks off
> ancestors, so fork detection covers the current branch and above. `gt restack`
> also accepts `--branch <b>` and a global `--cwd`, which might lift the
> "run worktree on the branch" rule (unverified).
<!-- /deepen-plan -->

### Phase 2: Script

- [x] 2.1: `worktree-restack.sh` skeleton: arg parsing, exit-code constants,
      common-dir resolution (`--path-format=absolute --git-common-dir` with
      fallback, as `review-ledger.sh` does), and NUL-safe porcelain parsing
      (`while IFS= read -r -d ''` fed by `< <(git worktree list --porcelain -z)`).

      <!-- deepen-plan: codebase -->
      > **Codebase:** Copy from `plugins/yellow-review/lib/review-ledger.sh`: `rl_common_dir` (:103-111),
      > `rl_ensure_dir` (:119-126), `rl_atomic_write` (:174-185). Require git ≥ 2.36
      > for `git worktree list --porcelain -z` (nothing else in the repo uses `-z`;
      > `worktree-manager.sh:67,84` assumes ≥ 2.5) and fail clearly below it. `jq` is
      > needed for the adapter JSON (`handoff.sh` precedent: exit 11 when it is
      > missing).
      <!-- /deepen-plan -->

- [x] 2.2: `preflight`: stack set, run worktree, selection, all refusals
      (decision 4), human-readable plan plus a final machine line.
- [x] 2.3: State and lock helpers: write (atomic), read (fixed-field), and
      validate (decision 8); lock acquire/release/stale-reclaim (decision 7).
- [x] 2.4: `start`: recovery lines to stderr, then lock, state, detach,
      provider restack, ancestry check, restore, clear, optional submit. The
      trap restores on every non-conflict exit; conflict detection leaves the
      worktrees detached, prints the branch plus conflicting files (cap 20,
      "+N more") and the exact resume/abort lines, and exits 10.

      <!-- deepen-plan: codebase -->
      > **Codebase:** Verified on gt 1.7.20:
      > - a conflict exits **1**, the same as other failures
      > - conflict detection must use git state: `rebase-merge/` **and** `.gtcontinue`, both in the run worktree's *per-worktree* git dir (`git rev-parse --path-format=absolute --git-dir`)
      > - `.gtcontinue` survives `gt abort`, so it never counts as paused alone
      > - `gt abort --no-interactive` fails ("Cannot perform interactive operation"), while `gt abort --force` works, so the abort path must pass `--force` (the registry's `abortConflict` omits it)
      <!-- /deepen-plan -->

      <!-- deepen-plan: external -->
      > **Research:** Graphite publishes no exit-code table and does not document `.gtcontinue`.
      > Conflict wording has changed between releases ("Improved `gt restack` conflict
      > messaging"), so detect through git state, not output text. `-f, --force` is
      > `gt abort`'s only documented flag. `gt continue` has `--all` and `--no-edit`;
      > non-interactive use is undocumented but worked locally.
      > See https://graphite.com/docs/restack-branches
      <!-- /deepen-plan -->

- [x] 2.5: `continue`, `abort`, `restore`, `status` (decisions 8, 9, 12),
      with each subcommand idempotent (restore twice, abort after a partial
      restore, continue with no state → "no restack in progress", exit 0
      with nothing done).
- [x] 2.6: Provider dispatch functions mirroring the registry primitives, plus
      the gh-stack version gate (decision 1). Strip control characters from
      every printed path and branch, and quote resume commands with
      `printf %q`.

<!-- deepen-plan: codebase -->
> **Codebase:** Task 2.6 note: the `validate-provider-neutral-commands` scan covers every
> `.md` under `plugins/` (not `.sh`). That includes the edits to yellow-core's
> `CLAUDE.md`, `README.md`, `skills/git-worktree/SKILL.md` and
> `troubleshooting.md`, each capped at 0. Keep `gt restack|continue|abort|submit`
> and `gh stack rebase|submit` literals out of all of them, including the
> stranded-worktree recipe.
<!-- /deepen-plan -->

### Phase 3: Command

- [x] 3.1: `commands/worktree/restack.md`. Frontmatter `name:
      worktree:restack`, single-line single-quoted `description`,
      `argument-hint: '[--continue | --abort | --status] [--submit] [--yes]'`,
      `allowed-tools: [Bash, Skill, AskUserQuestion]`. Flow:
      - parse flags by value (`for arg in $ARGUMENTS`, as `cleanup.md` does);
        `--continue`/`--abort`/`--status` are mutually exclusive
      - invoke the `stack-provider-router` skill; stop on any state but
        READY_*, printing `detail` fenced as untrusted
      - `preflight`, render it, confirm via `AskUserQuestion` unless `--yes`
      - `start` / `continue` / `abort`
      - map the exit code to a report and the next step
- [x] 3.2: Keep the body free of `gt <verb>` / `gh stack <verb>` literals.
      Refer to "the provider's `rebaseUpstack` primitive" instead.

<!-- deepen-plan: codebase -->
> **Codebase:** Every existing plugin command uses the block-list form for `allowed-tools`.
> The flag-parse precedent is `cleanup.md:34-45`.
<!-- /deepen-plan -->

### Phase 4: Tests

- [x] 4.1: `skills/git-worktree/tests/worktree-restack.bats` builds real temp
      repos with linked worktrees. A stub `gt` on `PATH` replays a stack file
      with real `git rebase --onto` per branch, so git's own worktree
      constraint is exercised. A stub `gh` does the same for `stack rebase`,
      reports a version, and logs every call (no real `gt`/`gh`).

      <!-- deepen-plan: codebase -->
      > **Codebase:** No existing stub can be reused. `plugins/gt-workflow/tests/mocks/gt` only logs,
      > and `plugins/yellow-core/tests/mocks/{gt,gh}` are forbidden-command shims that
      > exit 97: keep them off PATH for this suite. Repo and stub patterns to copy:
      > `plugins/yellow-review/tests/helpers/ledger-repo.bash:1-36`,
      > `plugins/yellow-ruvector/tests/resolve.bats:126-222`,
      > `skills/git-worktree/tests/worktree-manager.bats:10-26` (invoke the new script
      > with `bash`, not `sh`). No bats file runs a real `git rebase` yet. CI budget:
      > `validate-schemas.yml:1434-1440` is 10 minutes, and the ledger suite already
      > uses about 1 of them.
      <!-- /deepen-plan -->

- [x] 4.2: Cases, each with a negative assertion (`run grep` + `[ "$status"
      -eq 1 ]`, never a mid-test `! grep`):
      - success: all worktrees end on their branches, state gone, lock gone
      - dirty, locked, mid-rebase and prunable worktrees refused, and nothing
        detached
      - a worktree whose only change is an untracked `.ruvector` symlink is
        accepted
      - conflict → exit 10, worktrees detached, state present;
        `continue` → restored
      - conflict → `abort` → restored
      - second conflict during `continue` → exit 10 again
      - `continue`/`abort` with no state
      - existing state → `start` exits 3
      - stale lock with a dead pid and no state → reclaimed
      - forged state (path outside the worktree list, `refs/tags/x`, a
        leading `-`, bad SHA, wrong common dir) → exit 4, no checkout run
      - provider mismatch → exit 5
      - worktree removed during the pause → entry dropped with a warning,
        exit 0 (decision 9); branch deleted or worktree switched by the user
        during the pause → exit 40 with the right per-entry lines (`restore`)
      - commit made in a detached worktree during the pause → that entry is
        not restored, its floating commit SHA and rescue line are printed,
        exit 40, and the commit is still reachable from that worktree's HEAD
      - paused worktrees are `git worktree lock`ed with the restack reason;
        restore and abort unlock them; a pre-existing lock is never removed
      - ancestry failure (the stub skips a branch, like gt ≥ 1.8.4) → exit 50,
        restored, submit never called
      - `--submit` persisted across a pause; `git push` never invoked
        (assert on the stub log)
      - worktree path containing a space works; one containing a newline is
        refused
      - GitHub provider with a stub reporting gh-stack v0.2.x → no detach,
        adapter `rebase --mode upstack` run from the current worktree; stub
        reporting v0.1.0 or an unparseable version → exit 20 with an upgrade
        message and nothing touched
- [x] 4.3: Keep the suite inside CI's 10-minute `plugin-shell-tests` budget
      (smallest repos, shared fixtures).
- [x] 4.4: Manual live acceptance (not CI): rerun the throwaway-repo proof
      against real gt 1.7.20 (and the 1.8.x scratch install) through the
      script, conflict case included.

### Phase 5: Docs and release

- [x] 5.1: `plugins/yellow-core/CLAUDE.md`:
      - "Commands (18)" → 19, plus a `/worktree:restack` bullet
      - a `git-worktree` skill note for the new script
      - the bats list in Testing
      - the `stack-operation-registry.js` note now names the script as a
        second prose mirror
      Also: `README.md` command table; root `README.md` "18 commands" → 19
      (two places, not validator-gated).
- [x] 5.2: Registry header comment: add `worktree-restack.sh` beside
      `commands/flow/work.md` as a mirror that must change with the registry.
- [x] 5.3: `skills/git-worktree/SKILL.md`: document the script and its
      subcommands. `troubleshooting.md`: a "stranded detached worktree"
      recipe.
- [x] 5.4: `.changeset/worktree-aware-restack.md`: `'yellow-core': minor`.

### Phase 6: Quality gates

- [x] 6.1: `pnpm validate:agents`, `pnpm lint:plugins`,
      `pnpm validate:shell-compat`, `pnpm check:shell-parse`, then
      `pnpm validate:schemas` (includes provider-neutral-commands and
      doc-counts).
- [x] 6.2: `cd plugins/yellow-core && bats skills/git-worktree/tests/ tests/`.
- [x] 6.3: Baseline: `pnpm test:unit && pnpm test:integration && pnpm lint &&
      pnpm typecheck` (via `corepack pnpm@8.15.0`, Node through
      `nvm exec "$(cat <workspace>/.node-version)"`).
- [x] 6.4: CRLF check on new files; no token-shaped literals in tests.

## Technical Specifications

### Files to create

- `plugins/yellow-core/commands/worktree/restack.md`
- `plugins/yellow-core/skills/git-worktree/scripts/worktree-restack.sh` (mode 755)
- `plugins/yellow-core/skills/git-worktree/tests/worktree-restack.bats`
- `.changeset/worktree-aware-restack.md`

### Files to modify

- `plugins/yellow-core/CLAUDE.md`, `plugins/yellow-core/README.md`, `README.md`
- `plugins/yellow-core/skills/git-worktree/SKILL.md`, `troubleshooting.md`
- `plugins/yellow-core/lib/stack-operation-registry.js` (comment only)

### Not changed

- Catalog, generated manifests, `setup/all.md`, codex allowlist (yellow-core
  excludes its commands from Codex), `scripts/shell-compat-config.json`, the
  registry's entries and its integration test.

<!-- deepen-plan: codebase -->
> **Codebase:** If the GitHub path takes option (i) from Decision 3's note, then "Not
> changed" is wrong: add `plugins/github-workflow/lib/github-stack-runtime.js`,
> `tests/integration/github-stack-runtime.test.ts` and a github-workflow
> changeset.
<!-- /deepen-plan -->

## Acceptance Criteria

1. On a 3-branch stack with one worktree per branch and a mid-stack conflict,
   `/worktree:restack` pauses with the branch and file list; after resolving,
   `--continue` leaves every worktree on its original branch with the stack
   restacked (bats + manual live run).
2. A dirty, locked, mid-operation or prunable stack worktree makes `start`
   refuse before any detach (bats).
3. No path discards uncommitted work: no `checkout -f`, `-m`, `reset --hard`,
   `stash`, or `--ignore-other-worktrees` anywhere in the script (grep
   assertion in bats).

   <!-- deepen-plan: codebase -->
   > **Codebase:** A raw `grep stash` on the script would trip on its own comments (for example
   > "`-m` auto-stashes"). Either keep the word out of comments or match only
   > non-comment lines.
   <!-- /deepen-plan -->

4. A forged or foreign state file never reaches `git checkout` (bats).
4a. While paused, every detached worktree is locked with the restack reason
    and listed in the pause message. A commit made in one during the pause
    is reported with its SHA and a rescue line on resume, and is never
    orphaned by a restore (bats).
5. A silently skipped branch is caught by the ancestry check, and no submit
   follows (bats).
6. Submit happens only with `--submit`, only through the provider, and never
   via `git push` / `gh pr create` (bats stub log).
7. Any router state other than READY_GRAPHITE / READY_GITHUB stops the command
   before the script runs.
8. All Phase 6 gates pass.

## Edge Cases & Error Handling

- Run from trunk, or from a branch outside any stack: refuse (exit 20) and
  name the fix (check out a stack branch).
- A stack branch held by the main checkout: Graphite detaches it like any
  worktree; for GitHub the main checkout is the run worktree.
- Crash between the detach and the state write: impossible by ordering (state
  first). A crash mid-run leaves state + lock; `status` shows them, and the
  stderr recovery lines exist regardless.
- Merged or deleted branches after a sync: dropped from restore with a
  warning.
- Multiple stacks: only the current branch's upstack is touched.

<!-- deepen-plan: codebase -->
> **Codebase:** Exit-code semantics differ from sibling scripts (`review-ledger.sh:18-20`:
> 3 validation, 4 lock timeout; `handoff.sh:14-18`: 10 mismatched). These are
> independent scripts that nothing wraps, so it is not a real collision, but
> document the table in the script header.
<!-- /deepen-plan -->

## Security Considerations

- State and lock live under the git common dir with `umask 077`. The state is
  re-validated on every read, and fixed-field parsing is used (no
  `source`/`eval`/JSON-to-shell).
- Router `detail` and printed paths/branches are untrusted: fence `detail`,
  strip control characters, and `printf %q` any command that is echoed back.
- The script never touches a worktree outside the restack set, never
  force-reclaims a branch, and treats a locked worktree as off-limits.

## Follow-up candidates (out of scope)

- (a) Conflict-assisted restack: replay with the replayed commit winning each
  conflict, then one fix-up commit from `git merge-tree --write-tree
  --merge-base=<old parent tip> <new parent tip> <old child tip>`.
- (b) After a restack, re-record fix SHAs in the review-findings ledger
  (`plugins/yellow-review/lib/review-ledger.sh`). The recorded SHA no longer
  exists, so `settle` marks applied findings `reopened (fix-abandoned)`.
- (c) `gt-sync` still calls the deprecated `gt stack restack` alias, and its
  conflict path could point to `/worktree:restack` when it sees the worktree
  error.
- (d) Fix the `${CLAUDE_PLUGIN_ROOT}/../github-workflow` adapter path in
  `flow/work.md`, `flow/review.md`, `stack-traversal`, `devin/review-prs.md`.
  It doesn't resolve in the installed cache layout (see the Task 1.2
  annotation).

## References

- `plugins/yellow-core/lib/stack-operation-registry.js` (PRIMITIVES :117-155)
- `plugins/yellow-core/skills/stack-provider-router/SKILL.md`
- `plugins/yellow-core/commands/worktree/cleanup.md` (porcelain parsing, flags)
- `plugins/yellow-core/skills/git-worktree/scripts/worktree-manager.sh` + `tests/`
- `plugins/yellow-review/lib/review-ledger.sh` (common-dir state, atomic writes)
- `plugins/github-workflow/lib/github-stack-runtime.js` (`rebase --mode`, `view`)
- `docs/solutions/code-quality/trap-cleanup-across-tool-call-boundaries.md`
- `docs/solutions/security-issues/shell-owned-state-is-not-a-boundary-against-write.md`
- `docs/solutions/workflow/worktree-batch-pipeline-branch-held-elsewhere.md`
- `docs/solutions/logic-errors/git-worktree-cleanup-review-edge-cases.md`
- Graphite CLI changelog 1.8.4: https://graphite.com/docs/cli-changelog
- gh-stack v0.2.0: https://github.com/github/gh-stack/releases/tag/v0.2.0

<!-- deepen-plan: external -->
> **Research:** Further sources from enrichment:
> - Graphite command reference (restack skips held branches): https://graphite.com/docs/command-reference
> - Graphite multiple worktrees: https://graphite.com/docs/multiple-worktrees
> - Graphite restack conflicts: https://graphite.com/docs/restack-branches
> - gh-stack v0.2.0 README / CLI reference: https://raw.githubusercontent.com/github/gh-stack/v0.2.0/README.md, https://raw.githubusercontent.com/github/gh-stack/v0.2.0/docs/src/content/docs/reference/cli.md
> - gh-stack PR #529 (cross-worktree ownership): https://github.com/github/gh-stack/pull/529
> - git-rebase `--update-refs` skips branches checked out in a worktree: https://git-scm.com/docs/git-rebase
<!-- /deepen-plan -->
