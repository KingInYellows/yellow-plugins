# Feature: Cycle 1 — resolve-flow hardening, CI split, restack abort guard

## Overview

Six code fixes from the Cycle 1 Linear follow-ups, delivered as a linear stack
of PRs on `main` (branch prefix `agent/`), plus a reconcile step for five
ledger issues that research found already shipped. Source brainstorm:
`docs/brainstorms/2026-10-05-CLAUDE-cycle-1-stack-brainstorm.md` (per-issue
detail in the sibling `2026-10-05-CLAUDE-NN-*.md` docs).

Verified against `main` at `38d5d5d25`: CLAUDE-44, 45, 46, 48 and 49 are
implemented in `plugins/yellow-review/lib/review-ledger.sh`
(`rl_occurrence`, `rl_verify_scope`, `rl_publication_fix`, `rl_settle_one`,
`rl_dismissal_applicable_row`, a lexical-only `rl_validate_path`), and
`bats -f CLAUDE-4 tests/review-ledger.bats` passes 33/33. They need a
reconcile step, not code. The first 11-PR decomposition in the brainstorm is
superseded by this plan.

## Problem Statement

- The unattended resolve commit and verify scripts still execute a repo-local
  `git` before any check runs, miss symlinked tool paths, and leave
  `core.fsmonitor` open in the rollback `git status`.
- `get-pr-blockers` can run 300 s inside a 300000 ms wrapper, so the budget
  fires exactly at the legitimate limit.
- The sweep and resolve-stack walks treat unreadable PR state as a skip;
  `resolve-stack.md` is 501 lines (RULE 21 advisory ceiling 500).
- The credential scan over-refuses non-English prose, accepts short Basic
  credentials, and misses vendor token prefixes.
- `/worktree:restack --abort` checks only the run worktree.
- The `Plugin Shell Tests` job ran 429–600+ s against a 15-minute cap, and two
  CLAUDE-49 ledger tests skip silently in CI because `universal-ctags` is not
  installed.

<!-- deepen-plan: codebase -->
> **Codebase:** The last `main` run of `Plugin Shell Tests` took 11m19s, 76%
> of the 15-minute cap, not the 429-600+ s quoted above, so the split is still
> justified. "33/33" for `bats -f CLAUDE-4` overstates the ledger evidence:
> that filter also matches 6 CLAUDE-47 tests, and 2 CLAUDE-49 ctags tests
> skip. By prefix there are 27 tests across CLAUDE-44, 45, 46, 48 and 49 (6,
> 2, 3, 6 and 10).
<!-- /deepen-plan -->

## Linear Issues

- CLAUDE-75
- CLAUDE-71
- CLAUDE-72
- CLAUDE-73
- CLAUDE-70
- CLAUDE-74

Reconcile only, no code (Phase 7): CLAUDE-44, CLAUDE-45, CLAUDE-46,
CLAUDE-48, CLAUDE-49.

## Proposed Solution

### Decisions (confirmed with the user)

| Decision | Choice |
|---|---|
| Overlap with `agent/feat/stage-unattended-learnings` (5 commits, no PR; edits `sweep.md`, `sweep-all.md`, `review-pr.md`, `plugins/yellow-review/CLAUDE.md`, `skill-content.bats`) | It lands first. PR 4 starts from a rebased base. |
| CLAUDE-72 unreported edits | Revert only paths on the contract deny list. No `Resolve:` line change and no edits to the three `resolve-contract.md` copies. |
| CLAUDE-71 `git` on PATH | Resolve `git`, `gh`, `jq` to absolute paths once, reject any whose canonical path is inside the worktree, then call the absolute paths. |
| ctags in CI | Install `universal-ctags` in the new job; the two skipping tests fail instead of skipping when `CI` is set. |

### Decisions the plan makes (change only with a reason)

- `get-pr-blockers` wrapper timeout is 360000 ms (worst case 300 s plus
  headroom). `get-pr-comments` stays at 300000 ms (~270 s deadline).
- Hardening keeps `credential.helper` untouched, because unattended pushes use
  it. It forces `core.fsmonitor=false`, `core.untrackedCache=false`,
  `core.hooksPath=/dev/null` (hooks stay disabled by default, as today),
  signing off, `safe.bareRepository=explicit`.
- `--ignored-since` becomes required in attended runs too; every interactive
  caller in `resolve-pr.md` already passes it.
- Vendor prefixes: add `tvly-` and `pplx-` (vendor docs) and `sgp_`
  (repo-documented in yellow-semgrep as `^sgp_[a-zA-Z0-9]{20,}$`; no public
  Semgrep format, so record that).
- CLAUDE-74 `--abort`: bounded detect-and-abort loop over every rebasing
  stack worktree, then one final all-worktree check; stop with `X_KEPT` only
  if a marker remains.
- The `$ARGUMENTS` heredoc convention (CLAUDE-74, second paragraph) is a
  framework limitation: document it as won't-fix, no script change.

<!-- deepen-plan: codebase -->
> **Codebase:** Two decisions above need adjusting at implementation. (1)
> Forcing `core.hooksPath=/dev/null` in the shared function would break the
> `YELLOW_REVIEW_COMMIT_HOOKS=1` opt-in (`commit-resolve-fixes:819-836`,
> `disable_git_hooks`); keep hooks handling where it is. (2) Signing is forced
> off today only when local gpg config exists
> (`commit-resolve-fixes:488-505`); keep that condition. `lgit` and
> `lgit_nohooks` already set fsmonitor and untrackedCache false, so only
> `run-verify-command` L833 lacks the override. The `--ignored-since` change
> also touches docs that say attended runs may omit it: the
> `run-verify-command` header (L18, L39-43, L197-199),
> `references/local-scripts.md:19`, `plugins/yellow-review/CLAUDE.md:228-231`,
> `README.md:161` and `dispositions.md:483`. Only `resolve-pr.md:498` calls
> run mode, so the "every interactive caller passes it" claim holds.
<!-- /deepen-plan -->

### Order

`0 prerequisites → PR1 CLAUDE-75 → PR2 CLAUDE-71 → PR3 CLAUDE-72 → PR4
CLAUDE-73 → PR5 CLAUDE-70 → PR6 CLAUDE-74 → Phase 7 reconcile`. PR 3 before
PR 4 (both edit `resolve-stack.md` and `skill-content.bats`). PR 6 touches
only yellow-core and may be unstacked to reduce restack risk.

## Implementation Plan

### Phase 0: Prerequisites

- [ ] 0.1: Run `/stack:status`; proceed only on `READY_GRAPHITE` or `READY_GITHUB`.
- [ ] 0.2: Confirm `agent/feat/stage-unattended-learnings` has merged (or is
  about to). Rebase this stack on the current `main`; `38d5d5d25` is a
  version-packages merge, so package baselines just moved.
- [ ] 0.3: Re-read `sweep-all.md` after that merge; its end-of-loop
  `/flow:compound` pass is being dropped, which changes task 4.4.

<!-- deepen-plan: codebase -->
> **Codebase:** `agent/feat/stage-unattended-learnings` is checked out in
> `worktrees/yellow-plugins/agent-feat-stage-unattended-learnings`, so another
> session may own it; check before rebasing onto it. It also edits
> `plugins/yellow-core/CLAUDE.md`,
> `plugins/yellow-core/lib/compound-staging.sh` (+89) and
> `plugins/yellow-core/tests/compound-staging.bats`, which the overlap note
> omitted. It deletes `sweep-all.md` Step 6 and its Error Handling bullets, so
> task 4.4 will be moot.
<!-- /deepen-plan -->

### Phase 1: PR 1 — `chore(ci)`: split yellow-review bats into its own required job (CLAUDE-75)

- [ ] 1.1: Add a `yellow-review` shell-test job modelled on `ruvector-shell-tests`
  (`validate-schemas.yml` ~L1548). Copy the fork-PR `if:` guard from
  `plugin-shell-tests`, `needs: [validate-schemas]`, `timeout-minutes: 15`,
  and install `bats@1.11.0`, gawk, zsh and `universal-ctags`. Run
  `bats plugins/yellow-review/tests/`. No `continue-on-error`.
- [ ] 1.2: Remove the yellow-review step (~L1498) from `plugin-shell-tests`.
  Keep `plugins/yellow-review/tests` in the advisory loop `case` skip
  (~L1521–1531) so it does not run twice; update the comment at ~L1514–1518.
- [ ] 1.3: Wire `ci-status`: `needs:` list (~L1741–1755), result env var
  (~L1760–1771), the AND gate (~L1773–1784), and the failure echo (~L1796).
  Check what `report-metrics` consumes before deciding whether it lists the
  new job.
- [ ] 1.4: In `plugins/yellow-review/tests/review-ledger.bats` (~L767–786) make
  the two ctags tests fail instead of skip when `CI` is set (same pattern as
  the kislyuk `yq` check in `shell-compat-tests`).
- [ ] 1.5: Update together: `CLAUDE.md` (~L63–66 required-job list),
  `docs/operations/ci.md` (~L71–73, L118–124), `docs/architecture-overview.md`
  (~L349–355).
- [ ] 1.6: Add a changeset (`yellow-review: patch`); task 1.4 edits a file under
  `plugins/`, and `changeset-check` greps `^plugins/[^/]+/`.
- [ ] 1.7: Verify: summed test counts of both jobs equal the old total; both
  jobs green; the gate turns `ci-status` red when the new job fails (read the
  gate, or prove it once on the branch).

<!-- deepen-plan: codebase -->
> **Codebase:** `ruvector-shell-tests` is a poor template: it has
> `continue-on-error: true`, an "advisory" name, a 20-minute timeout and no
> gawk or zsh install. Model the new job on `plugin-shell-tests` (fork guard,
> gawk and zsh install at ~L1455-1468) and `shell-compat-tests` (required; a
> missing tool fails when `CI` is set). `report-metrics` needs only
> `plugin-shell-tests` (L1631-1642), so leave the new job out and add it to
> the exclusion sentence at `docs/operations/ci.md:123-124`.
> `validate-schemas-fork.yml` has its own `ci-status` and no plugin bats job,
> so it needs no edit. Branch protection requires only "CI Status Summary".
> Installing ctags changes the environment for every ledger test, so run the
> whole suite with ctags once.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** `universal-ctags` is in the Ubuntu 24.04 universe archive
> (5.9.20210829.0-1). Its real binary is `/usr/bin/ctags-universal`;
> `/usr/bin/ctags` is only an alternatives link, and `exuberant-ctags` can
> share it, so a bare `ctags` is not guaranteed to be the universal build.
> `--version` always contains "Universal Ctags". It is not preinstalled on
> runner images. Use `sudo apt-get update && sudo apt-get install -y
> universal-ctags`, and either call `ctags-universal` or check the banner
> (precedent: `which ctags-universal || which ctags` in
> espressif/arduino-esp32). See:
> https://packages.ubuntu.com/noble/amd64/universal-ctags/filelist and
> https://manpages.debian.org/unstable/universal-ctags/ctags-universal.1.en.html.
> Whether the alternatives link passes `rl_ctags_usable`
> (`review-ledger.sh:811-821`) is unconfirmed; test it in the PR.
<!-- /deepen-plan -->

### Phase 2: PR 2 — `fix(yellow-review)`: close git/PATH/fsmonitor trust gaps (CLAUDE-71)

- [ ] 2.1: In `lib/resolve-paths.sh` (next to `lgit` L21 and `lgit_nohooks` L28)
  add a shared hardening function. It returns codes rather than calling
  `die`, since the two scripts use different exit codes. Move the transport
  and filter refusals, signing-off and fsmonitor/untrackedCache overrides out
  of `commit-resolve-fixes` (L451–504) into it. Both scripts call it.
- [ ] 2.2: Resolve `git`, `gh`, `jq` (plus the existing `gt`, `node`) to absolute
  paths once, before the first git call (`commit-resolve-fixes` L200,
  `run-verify-command` L156). Canonicalise the binary with `cd -P`/`pwd -P`
  plus a bounded `readlink` loop (precedent at `resolve-paths.sh:121`), never
  bare `realpath`. Before git can report the repo top, reject a binary inside
  the containing worktree: walk ancestors of canonical `$PWD` for a `.git`
  file or directory without invoking git, or pick git from an independently
  trusted location. `$PWD` alone is not enough — a launch from `/repo/subdir`
  lets `/repo/bin/git` through. Test against the git toplevel once known.
  Drop empty and relative PATH entries. Call the resolved absolute paths.
- [ ] 2.3: `run-verify-command` L833: use `lgit_nohooks status`. Audit the other
  plain-`git` calls (`diff --no-index` L595/L606, `check-ignore` L347,
  `cat-file` L430/L588/L808).
- [ ] 2.4: Make `--ignored-since` required in attended runs (L254–263).
- [ ] 2.5: Defer deletion of FIFO/socket/device entries (`TO_REMOVE`, L461–468)
  until `save_patch` has written the snapshot, as `DIR_REMOVE` does at
  L797–806. If the snapshot cannot be written, delete nothing and refuse.
- [ ] 2.6: Tests (`tests/commit-resolve-fixes.bats`, `tests/run-verify-command.bats`),
  each failing on `main` and passing after: a hostile `git` earlier on PATH
  and one inside the repo write a canary that must not appear (invoke the
  in-repo canary from a subdirectory of the repository root); a symlink in
  an outside directory to an ignored in-tree executable is refused; a
  `core.fsmonitor` canary during the rollback status; a FIFO in the revert
  list (wrap in `timeout`, never open it); attended run without
  `--ignored-since` is refused; snapshot-failure keeps the special file.
  Use `run grep` plus a status assertion, never mid-test `! grep`.
- [ ] 2.7: `lib/*.sh` is hash-checked against HEAD, so commit lib edits before
  running the scripts in-tree. Update `plugins/yellow-review/CLAUDE.md` and
  `README.md` blurbs. Changeset `yellow-review: patch`.

<!-- deepen-plan: codebase -->
> **Codebase:** Corrections to tasks 2.1-2.5. (a) The plan is circular as
> written: `check_lib_integrity` runs bare `git` first
> (`commit-resolve-fixes:200`, `run-verify-command:156`) and only then sources
> `lib/`, so the git resolution must be inline before that call, not in
> `resolve-paths.sh`. (b) `harden_git_config` (~L449-506) runs after about 10
> earlier bare `git` calls, and both scripts have 40+ bare `git` call sites;
> `lgit` and `lgit_nohooks` call literal `git`. Precedent: the `gh()` shadow
> function (`commit-resolve-fixes:412`, `run-verify-command:187`). A `git()`
> shadow plus a sanitised exported PATH also covers child processes (gt, node)
> that spawn git. (c) `check_tools_outside_repo` already exists
> (`commit-resolve-fixes:424-437`, test at `commit-resolve-fixes.bats:2413`);
> it covers gt, gh, jq and node but not git, and canonicalises only `dirname`.
> It also treats `pwd -P` as the repository root, so a subdirectory launch
> has the same `/repo/bin/git` hole; the ancestor `.git` walk belongs there.
> `run-verify-command` has no equivalent (only `GH_BIN` at L186). Extend it,
> don't rebuild. (d) Task 2.5 lacks a rationale: `save_patch` (L581-610)
> handles only symlinks, regular files and directories, so a FIFO leaves
> nothing to snapshot; the change contradicts the comment at L393-396
> ("refusal cleanup still completes") and rewrites the tests at
> `run-verify-command.bats:857-880`, which assert the FIFO is deleted unopened
> with `treeClean` true. Decide before implementing whether to keep the
> current behaviour and close sub-item (f) with that explanation. (e) Add
> `tests/resolve-paths.bats` to the files list.
<!-- /deepen-plan -->

### Phase 3: PR 3 — `fix(yellow-review)`: unreported-edit policy and self-verify budgets (CLAUDE-72)

- [ ] 3.1: `commands/review/resolve-pr.md` Step 6 (L432–446) and
  `references/resolve/dispositions.md` (L560–577): revert an unreported edit
  only when its path is on the contract deny list in `lib/resolve-paths.sh`;
  other paths keep today's behaviour (ask when interactive; leave and report
  when unattended). Do not touch the `Resolve:` line or any `resolve-contract.md`.
- [ ] 3.2: `commands/review/resolve-stack.md` self-verify (L286–297): add a
  300000 ms Bash timeout. Sub-claim 2 (`--include-outdated`) is already fixed
  at L288; do not claim it.
- [ ] 3.3: `resolve-pr.md` Step 3 (L174–178): give `get-pr-blockers` its own
  360000 ms timeout. Add a `get-pr-blockers` worst-case row (5 sequential
  `gh` calls × 60 s) to the Bash-timeouts table in `dispositions.md` (L582–636).
- [ ] 3.4: Update the pins in `tests/skill-content.bats` (~L496, L555,
  L1140–1144, L1160–1166) and add assertions for the new timeouts and the
  deny-list-only revert.
- [ ] 3.5: Keep added lines in `resolve-stack.md` to a few; PR 4 offloads.
  Changeset `yellow-review: patch`.

<!-- deepen-plan: codebase -->
> **Codebase:** PR 3 is not markdown-only. `--revert-dirty` takes no path list
> (`run-verify-command:64, 323-324`); `--revert-only` waives the deny list and
> needs an explicit list (L72-77); nothing exposes `rp_denied` to command
> markdown, and Step 6 forbids putting resolver-derived paths on a command
> line. A "revert only deny-listed unreported edits" behaviour therefore needs
> a new `run-verify-command` mode plus tests, which makes PR 3 larger than
> planned. The pin at `skill-content.bats` ~L1140-1144 (the shared 300000 ms
> sentence) breaks by design with task 3.3, and the pins at ~L1160-1166 assert
> the "revert only reported files" sentences.
<!-- /deepen-plan -->

### Phase 4: PR 4 — `fix(yellow-review)`: sweep and resolve-stack walk hardening (CLAUDE-73)

Start from a base that includes `stage-unattended-learnings` and PR 3.

- [ ] 4.1: `sweep.md` Step 1b (L101–142): close the window where the starting
  branch does not ignore `yellow-plugins.local.md` but the target PR does.
  Resolve the PR head first, or snapshot after checkout. Pin in
  `skill-content.bats` (~L356).
- [ ] 4.2: `sweep-all.md` item 1b (L224–248): a non-rate-limit `gh pr view`
  failure stops the batch with its own reason, not a benign skip. Update the
  stop lists (L216–217, L322), the Error Handling bullets (L436–451), and the
  tests (~L644, L915, L929).
- [ ] 4.3: Offload the item 3b clean-tree/local-config block of `resolve-stack.md`
  (L318–370) into `references/review-resolve-stack/` behind a `Read` stub
  (add `Read` to `allowed-tools`). Target ≤ 500 lines. Repoint the greps that
  read the command inline (`skill-content.bats` ~L568–614, L714–722,
  L772–783, L1181+) and keep the L756–770 invariants (no inline
  `--revert-dirty`, no cross-command reference directory).
- [ ] 4.4: `sweep-all.md` Step 6 (L376–398): skip `/flow:compound` after any early
  stop that left tree state unknown, including the no-contract stop. If the
  merged staging branch already removed that pass, mark this task not
  applicable and note it on CLAUDE-73.
- [ ] 4.5: Run the whole `skill-content.bats`. Changeset `yellow-review: patch`.

<!-- deepen-plan: codebase -->
> **Codebase:** Corrections to tasks 4.3 and 4.4. `Read` is already in
> `resolve-stack.md` `allowed-tools` (L7), and item 3b already reads
> `references/review-resolve-stack/dirty-tree-cleanup.md` from an existing
> directory; drop "add Read" and "create". Offloading the item 3b block
> conflicts with tests that assert inline ordering in `RESOLVE_STACK`
> (snapshot, check, clear, status, then Step 4; `grep -c 'guard-local-config"
> clear' == 1`; the `3b. **Clean-tree` heading) and with the byte-identical
> copy check at `skill-content.bats` L757-770. RULE 21 is warning-tier
> (`validate-agent-authoring.js:1595-1609`), so a ~50-line offload to remove
> one line over the ceiling is disproportionate; trimming one line is enough,
> or accept the warning. Task 4.4 is moot once `stage-unattended-learnings`
> merges, since it deletes Step 6.
<!-- /deepen-plan -->

### Phase 5: PR 5 — `fix(yellow-review)`: credential-scan edge cases and oos→fixed reply (CLAUDE-70)

- [ ] 5.1: `lib/resolve-text.sh` L396/L403: stop refusing capitalised non-English
  prose. Treat a non-ASCII lead byte as possibly capitalised, keep the
  remaining shape checks, and avoid `{n,}` intervals (mawk). Contract: a
  planted ASCII credential after a bare keyword is still flagged under both
  awks.
- [ ] 5.2: L450–461: keep the Bearer floor at 20; give `Authorization: Basic`
  the minimum valid encoded length (4, `YTpi` = `a:b`) plus a decodable
  `user:pass` shape. Boundary tests at 4 and 8; do not assert that length 11
  stays clean. Keep the realistic-text test ("Authentication") that must
  not flag.
- [ ] 5.3: L478–490: add `tvly-`, `pplx-`, and repo-documented `sgp_`
  (`^sgp_[a-zA-Z0-9]{20,}$` in `plugins/yellow-semgrep/CLAUDE.md:80`) with
  floors from those in-repo formats. Add the same prefixes to yellow-core
  `cs_redact_secrets` (`compound-staging.sh` L118–150).
- [ ] 5.4: `scripts/reply-pr-thread` L215–217: allow `oos → fixed` and
  `oos → addressed`; keep `oos → oos` idempotent. Update the header
  (L14–16), `dispositions.md` (L650–653), and `plugins/yellow-review/CLAUDE.md`.
- [ ] 5.5: Tests in `check-resolve-text.bats` and `reply-pr-thread.bats`, run
  under gawk and mawk by explicit-binary PATH shims (the existing
  `failbin/awk` stub shows the pattern). Split vendor-prefix literals in the
  test file so it does not trip the scan. Changesets: `yellow-review: patch`,
  plus `yellow-core: patch` if 5.3 edits `compound-staging.sh`.

<!-- deepen-plan: codebase -->
> **Codebase:** Corrections to tasks 5.1-5.5. (a) Only L403 is code; L396 is a
> comment. "Lead byte" is wrong under gawk in UTF-8, where `substr` returns a
> whole character, so lowercase accented text is exempted too. A bracket range
> such as `[\200-\377]` is a fatal "Invalid collation character" error in gawk
> 5.2.1 under `C.UTF-8`, and `_rt_scan` does not pin `LC_ALL` (L24-29), so a
> fatal awk exit would read as a scan failure. `c !~ /^[\001-\177]/` and `c >
> "\177"` gave identical results in gawk and mawk (tested on `Él`, `él`, `Ab`,
> `ab`, `日本`). (b) A length floor alone cannot pass the plan's
> "Authentication must not flag" test, because "Authentication" is 14
> characters; the scan lowercases input (`l = tolower($0)`, L280 and L609), so
> a base64 shape check must use the original `$0`. The 4-character minimum
> plus that shape is what keeps prose clean. (c) The repo already
> documents vendor formats: Tavily `^tvly-[a-zA-Z0-9_-]{20,}$`
> (`yellow-research/commands/research/setup.md:199`), Perplexity
> `^pplx-[a-zA-Z0-9_-]{40,}$` (`setup.md:212`), Semgrep
> `^sgp_[a-zA-Z0-9]{20,}$` (`yellow-semgrep/CLAUDE.md:80`,
> `skills/semgrep-conventions/SKILL.md:49`). Use these floors; keep `sgp_`
> as repo-documented (see the external note). (d) `cs_redact_secrets` is at `compound-staging.sh:118-150` and the
> staging branch already edits L124, so expect an adjacent merge conflict. (e)
> `check-resolve-text.bats` has only a `failbin/awk` stub (L140-143, L405-408)
> that makes awk fail; there is no gawk or mawk selector, so task 5.5 must
> build one.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** Vendor evidence disagrees with the in-repo formats in places.
> Perplexity: gitleaks, Kingfisher and docker/portcullis match `pplx-` plus 48
> alphanumerics (portcullis allows 48-56); no rule accepts fewer than 48.
> Tavily: only Nosey Parker defines a rule (`tvly-[a-zA-Z0-9]{32}`), which
> cannot match the newer `tvly-dev-...` keys documented at
> https://docs.tavily.com/documentation/enterprise/generate-keys; allow an
> optional `dev-` or `prod-` segment. Semgrep: no vendor or scanner documents
> an `sgp_` prefix (https://docs.semgrep.dev/deployment/tokens publishes no
> format), so the in-repo claim is unverified outside this repo. Keep `sgp_`
> as repo-documented and keep `SEMGREP_APP_TOKEN` name-based matching.
> Over-flagging is the safe direction for a redaction scan, so the
> lower in-repo floors are acceptable. Sources:
> https://github.com/gitleaks/gitleaks/blob/master/cmd/generate/config/rules/perplexity.go
> and
> https://github.com/praetorian-inc/noseyparker/blob/main/crates/noseyparker/data/default/builtin/rules/tavily.yml.
<!-- /deepen-plan -->

### Phase 6: PR 6 — `fix(yellow-core)`: `/worktree:restack --abort` checks every stack worktree (CLAUDE-74)

- [ ] 6.1: `skills/git-worktree/scripts/worktree-restack.sh` `cmd_abort` (L1433–1461):
  before `restore_and_clear`, run a bounded detect-and-abort loop.
  `chain_rebase_worktree` (L1376–1391) returns only the first match, so keep
  calling it and running `git rebase --abort` in that worktree through the
  fail-closed wrapper until it returns none or the bound is hit. Then one
  final all-worktree check with `git rev-parse --path-format=absolute
  --git-path rebase-merge` and `rebase-apply` (or `wt_busy` across
  `WT_PATH`). Stop with `X_KEPT` (exit 31) if any marker remains. A second
  `--abort` must work.
- [ ] 6.2: Tests in `skills/git-worktree/tests/worktree-restack.bats`, modelled on
  the `--continue` test at L809–820: rebase paused in a non-run worktree;
  rebases in two worktrees; repeated `--abort`.
- [ ] 6.3: `commands/worktree/restack.md` Phase 4 text and exit table (L171–183,
  L213–224). Record the `$ARGUMENTS` heredoc limitation as won't-fix in
  `plugins/yellow-core/CLAUDE.md`. Changeset `yellow-core: patch`.

<!-- deepen-plan: codebase -->
> **Codebase:** `wt_busy` (`worktree-restack.sh:208-232`) already runs the
> per-worktree `rev-parse --path-format=absolute --git-path
> rebase-merge/rebase-apply` check, so reuse it across `WT_PATH` instead of
> writing a new probe. `chain_rebase_worktree` uses `--git-dir`, which is
> equivalent for per-worktree directories. There is no fail-closed wrapper and
> no `git rebase --abort` call anywhere in the script, so the wrapper in task
> 6.1 is new work. The `$ARGUMENTS` convention sits at `restack.md:41-60`;
> `plugins/yellow-core/CLAUDE.md` does not mention it yet.
<!-- /deepen-plan -->

### Phase 7: Reconcile shipped ledger issues (no code PR)

- [ ] 7.1: For CLAUDE-44, 45, 46, 48 and 49, map each acceptance bullet in the
  per-issue brainstorm doc to a named bats test in `review-ledger.bats`. Check
  specifically: tracked names with spaces/Unicode (45); three-plus identical
  occurrences (46); each row of the decision table in
  `plans/review-findings-ledger.md` (~L248–300) (48); the ctags path now
  running in CI (49).
- [ ] 7.2: Show the mapping and the merged PR numbers to the user and confirm
  before any Linear write. Check each issue for an active owner or branch.
  Then post the mapping as the closing comment and move the five issues to
  Done (a confirmed Tier 2 transition). Leave CLAUDE-47 alone.
- [ ] 7.3: Note on CLAUDE-72 that sub-claim 2 was already fixed.
- [ ] 7.4: Docs-only follow-up: add a "resolved, see `plans/review-findings-ledger.md`"
  banner to `docs/brainstorms/2026-09-23-review-findings-ledger-brainstorm.md`
  and state the anchor-only re-verify limit in `references/review-pr/ledger.md`
  if it appears only in the plan.
- [ ] 7.5: Capture the process lesson (check the code before decomposing a
  backlog item) with `/flow:compound`.

## Technical Specifications

### Files to modify

- `.github/workflows/validate-schemas.yml`, `CLAUDE.md`, `docs/operations/ci.md`, `docs/architecture-overview.md`
- `plugins/yellow-review/lib/{resolve-paths.sh,resolve-text.sh}`
- `plugins/yellow-review/skills/pr-review-workflow/scripts/{commit-resolve-fixes,run-verify-command,reply-pr-thread}`
- `plugins/yellow-review/commands/review/{resolve-pr,resolve-stack,sweep,sweep-all}.md`
- `plugins/yellow-review/references/resolve/dispositions.md`, `references/review-resolve-stack/`
- `plugins/yellow-review/tests/{commit-resolve-fixes,run-verify-command,check-resolve-text,reply-pr-thread,skill-content,review-ledger}.bats`
- `plugins/yellow-review/{CLAUDE.md,README.md}`
- `plugins/yellow-core/skills/git-worktree/scripts/worktree-restack.sh`, its bats file, `commands/worktree/restack.md`, `plugins/yellow-core/CLAUDE.md`
- `plugins/yellow-core/lib/compound-staging.sh` (only if task 5.3 syncs prefixes)

### Files to create

- One reference file under `plugins/yellow-review/references/review-resolve-stack/` (task 4.3)
- `.changeset/*.md` per plugin-touching PR (`yellow-review`, `yellow-core`: patch)

### Dependencies

None new at runtime. CI gains `universal-ctags` (apt) in the new job.

## Testing Strategy

- Every fix gets a test that fails on `main` and passes on the branch.
- Hardening tests plant a command-valued config or hostile binary that writes
  a canary file, then assert the canary is absent; they do not assert argument strings.
- Awk-touching tests run under gawk and mawk by binary name; shell-touching
  tests keep the bash and zsh coverage the suite already has.
- In bats, use `run grep` plus a status assertion; wrap process tests in
  `timeout`; never leave an empty `@test` body (bats 1.11.0).
- Per PR, run what the change needs: `pnpm validate:agents` and
  `pnpm lint:plugins` for command/agent/skill markdown;
  `pnpm validate:shell-compat` and `pnpm check:shell-parse` for shell (zsh
  must be installed); `bats plugins/<name>/tests/` for the touched plugin; then
  the local baseline (`pnpm validate:schemas && pnpm test:unit &&
  pnpm test:integration && pnpm lint && pnpm typecheck`).

## Acceptance Criteria

1. PR 1: two required jobs, no test run twice or dropped, `ci-status` depends
   on the new job, the ctags tests run in CI, three docs updated.
2. PR 2: each of the six CLAUDE-71 sub-items has a failing-then-passing test;
   no repo-local `git`, `gh` or `jq` can execute; unattended pushes still work.
3. PR 3: unreported edits are reverted only on the deny list; self-verify has
   a timeout; `get-pr-blockers` has headroom over its 300 s worst case; the
   `Resolve:` contract and its three copies are unchanged.
4. PR 4: `resolve-stack.md` is ≤ 500 lines with its tests repointed and green;
   unreadable PR state stops the batch; no `/flow:compound` after an
   unknown-tree stop (or the task is recorded as not applicable).
5. PR 5: planted ASCII credentials are flagged under gawk and mawk;
   non-English prose is not; Basic 4- and 8-character encoded credentials
   flag and "Authentication" does not; `tvly-`, `pplx-`, and `sgp_` flagged;
   `oos → fixed/addressed` works and `oos → oos` stays idempotent.
6. PR 6: `--abort` never reports success while any stack worktree holds a
   rebase marker, and is safe to repeat.
7. Phase 7: five Linear issues closed only after the user confirms the
   acceptance-to-test mapping.

## Edge Cases & Error Handling

- A lower PR is amended and the stack restacks over `plugins/yellow-review/CLAUDE.md`
  or `skill-content.bats`: resolve conflicts with the provider's restack
  command; prior art in `docs/solutions/workflow/plugins-yellow-review-lib-resolve-text-sh-conflict.md`.
- `stage-unattended-learnings` merges late: rebase PR 4 onto it before
  starting; re-read `sweep-all.md`.
- A FIFO in the revert list hangs a test: never open it; use `[ -p ]` and `timeout`.
- Two worktrees mid-rebase when `--abort` runs (PR 6): abort both, re-check, then clear.
- The new CI job times out: that is a cancelled job and turns `ci-status` red;
  keep both caps at 15 and cut them only after two measured runs.
- A Linear issue has an active owner at reconcile time: skip it and tell the user.

<!-- deepen-plan: codebase -->
> **Codebase:** Unverified claim: this plan assumes `get-pr-blockers` makes 5
> sequential `gh` calls at 60 s each. The code analysis found 3 call sites
> (L121, L180, L200); 5 is plausible if both the base and default branch are
> read, but nothing traced it. Confirm the call count before fixing the 360000
> ms figure. The Linear state and ownership of CLAUDE-44 to 49 and CLAUDE-70
> to 75 also remain unchecked until Phase 7.
<!-- /deepen-plan -->

## Security Considerations

- All of PR 2 and PR 5 sit on trust boundaries: fail closed, give each failure
  class its own exit code, and never pass file-derived text to awk with `-v`
  (use `ENVIRON`).
- Credential scan exemptions need a planted-secret test and a realistic-text test.
- Untrusted PR and Linear text stays inside reference-only fences.

## Migration & Rollback

Each PR is independent to revert. PR 2 makes `--ignored-since` mandatory in
attended runs; a caller that omits it now fails with a clear refusal.

## References

- `docs/brainstorms/2026-10-05-CLAUDE-cycle-1-stack-brainstorm.md` and the sibling `CLAUDE-NN` docs
- `plans/review-findings-ledger.md`
- `docs/solutions/logic-errors/review-ledger-awk-cache-and-reparse-bugs.md`
- `docs/solutions/logic-errors/resolve-stack-state-stale-after-fix-commit-push.md`
- `docs/solutions/logic-errors/early-exit-before-per-item-cleanup.md`
- `docs/solutions/logic-errors/restack-script-lock-takeover-and-fail-open-checks.md`
- `docs/solutions/security-issues/resolver-guards-trust-prompt-and-git-status-only.md`
- `docs/solutions/code-quality/bats-negated-grep-mid-test-never-fails.md`
- `docs/solutions/build-errors/empty-bats-test-blocks-cause-syntax-errors-in-bats.md`
- Vendor key formats: Tavily quickstart (`tvly-`), Perplexity API key management (`pplx-`)
- `git` docs: git-config (precedence, `GIT_CONFIG_COUNT`), git-worktree (`--porcelain`)

<!-- deepen-plan: external -->
> **Research:** External sources for the ctags and vendor-token findings:
> https://packages.ubuntu.com/noble/universal-ctags,
> https://packages.ubuntu.com/noble/amd64/universal-ctags/filelist,
> https://manpages.debian.org/unstable/universal-ctags/ctags-universal.1.en.html,
> https://github.com/espressif/arduino-esp32/blob/master/.github/workflows/push.yml,
> https://github.com/docker/portcullis/blob/main/rules.go,
> https://docs.tavily.com/documentation/quickstart,
> https://docs.perplexity.ai/docs/admin/api-key-management.
<!-- /deepen-plan -->

## Stack Decomposition

<!-- stack-topology: linear -->
<!-- stack-trunk: main -->

### 1. agent/chore/CLAUDE-75-split-yellow-review-bats-job
- **Type:** chore
- **Description:** chore(ci): split the yellow-review bats suite into its own required job
- **Scope:** .github/workflows/validate-schemas.yml, CLAUDE.md, docs/operations/ci.md, docs/architecture-overview.md, plugins/yellow-review/tests/review-ledger.bats
- **Tasks:** 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7
- **Depends on:** (none)
- **Linear:** CLAUDE-75

### 2. agent/fix/CLAUDE-71-harden-resolve-git-trust-boundary
- **Type:** fix
- **Description:** fix(yellow-review): close git/PATH/fsmonitor trust gaps in commit-resolve-fixes and run-verify-command
- **Scope:** plugins/yellow-review/lib/resolve-paths.sh, plugins/yellow-review/skills/pr-review-workflow/scripts/commit-resolve-fixes, plugins/yellow-review/skills/pr-review-workflow/scripts/run-verify-command, plugins/yellow-review/tests, plugins/yellow-review/CLAUDE.md, plugins/yellow-review/README.md
- **Tasks:** 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7
- **Depends on:** #1
- **Linear:** CLAUDE-71

### 3. agent/fix/CLAUDE-72-unattended-unreported-edits-policy
- **Type:** fix
- **Description:** fix(yellow-review): revert unreported edits on the deny list only and fix self-verify budgets
- **Scope:** plugins/yellow-review/commands/review/resolve-pr.md, plugins/yellow-review/commands/review/resolve-stack.md, plugins/yellow-review/skills/pr-review-workflow/scripts/run-verify-command, plugins/yellow-review/references/resolve/dispositions.md, plugins/yellow-review/tests/skill-content.bats
- **Tasks:** 3.1, 3.2, 3.3, 3.4, 3.5
- **Depends on:** #2
- **Linear:** CLAUDE-72

### 4. agent/fix/CLAUDE-73-sweep-walk-hardening
- **Type:** fix
- **Description:** fix(yellow-review): harden the sweep, sweep-all and resolve-stack walks
- **Scope:** plugins/yellow-review/commands/review/sweep.md, plugins/yellow-review/commands/review/sweep-all.md, plugins/yellow-review/commands/review/resolve-stack.md, plugins/yellow-review/tests/skill-content.bats
- **Tasks:** 4.1, 4.2, 4.3, 4.4, 4.5
- **Depends on:** #3
- **Linear:** CLAUDE-73

### 5. agent/fix/CLAUDE-70-credential-scan-and-oos-reply
- **Type:** fix
- **Description:** fix(yellow-review): credential-scan edge cases and oos to fixed/addressed reply upgrade
- **Scope:** plugins/yellow-review/lib/resolve-text.sh, plugins/yellow-review/skills/pr-review-workflow/scripts/reply-pr-thread, plugins/yellow-core/lib/compound-staging.sh, plugins/yellow-review/tests/check-resolve-text.bats, plugins/yellow-review/tests/reply-pr-thread.bats
- **Tasks:** 5.1, 5.2, 5.3, 5.4, 5.5
- **Depends on:** #4
- **Linear:** CLAUDE-70

### 6. agent/fix/CLAUDE-74-restack-abort-all-worktrees
- **Type:** fix
- **Description:** fix(yellow-core): /worktree:restack abort checks every stack worktree for an in-flight rebase
- **Scope:** plugins/yellow-core/skills/git-worktree/scripts/worktree-restack.sh, plugins/yellow-core/skills/git-worktree/tests/worktree-restack.bats, plugins/yellow-core/commands/worktree/restack.md, plugins/yellow-core/CLAUDE.md
- **Tasks:** 6.1, 6.2, 6.3
- **Depends on:** #5
- **Linear:** CLAUDE-74
