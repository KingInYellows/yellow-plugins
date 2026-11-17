# Moving stacked pull requests from Graphite to GitHub

Status as of 2026-11-17. The Graphite subscription is planned to end on
2026-12-28. This guide makes GitHub's own stacked pull requests the path for new
work and keeps Graphite usable for stacks that already live there.

Nothing in this guide cancels a subscription, uninstalls an app, removes a
credential, changes a required check, or merges a pull request. Those are steps
for the repository owner, listed in the readiness checklist at the end.

## What is verified and what is not

Read this before trusting anything below.

**Verified with the real `gh-stack` v0.3.0 binary** in a throwaway local
repository with a local bare remote, through
`plugins/github-workflow/lib/github-stack-runtime.js`:

- `init` for a new branch, on a dirty trunk (uncommitted work follows to the new
  branch), and adopting four existing branches bottom to top; wrong order is
  refused before anything runs
- `add`, `checkout`, `view`
- amending a lower layer, `view` reporting `needsRebase: true`, then
  `rebase --mode upstack`
- a rebase conflict (`CONFLICT`), a second mutation while paused
  (`REBASE_ACTIVE`), `rebase --mode abort` restoring every branch, and resolve
  plus `rebase --mode continue`
- a stack spread over two worktrees: rebase runs in the worktree that owns each
  branch; a dirty owning worktree refuses the whole rebase with nothing
  rewritten; checking out a branch another worktree holds is refused
- `push` with and without an unambiguous remote, `unstack` and its confirmation
  gate, `sync` against the local remote
- `submit`, `merge` and `link` failing cleanly (`API_FAILURE`) when the remote
  is not GitHub

**Verified live on 2026-11-17** with throwaway `pilot/*` branches in this
repository, from a workstation clone with `gh-stack` v0.3.0 (pull requests #1822
to #1824 as stack #1825, and #1827 and #1828 as stack #1829):

- `init` adopting three existing branches, then `submit`: three draft pull
  requests, each based on the branch below it, linked as one stack. The REST
  pull request object carries a `stack` field (`number`, `position`, `size`,
  `base`); an ordinary pull request has no such field
- amending the bottom layer, `rebase --mode upstack` stopping on a real conflict
  (`CONFLICT`), `submit` refused while paused (`REBASE_ACTIVE`), resolve plus
  `rebase --mode continue`, then `submit` force-pushing the rebased branches
  with numbers, bases and the stack unchanged
- adoption: two ordinary draft pull requests opened with `gh pr create`, then
  `init` of their branches and `sync`. GitHub created a stack from them without
  recreating anything; numbers, bases, draft state and commits were unchanged,
  and `sync` opened no pull request
- from a Claude Code cloud session `submit` cannot work: `gh-stack` uses
  GitHub's GraphQL API, which those sessions block. It pushed the branches,
  opened nothing and exited 0, which the adapter now reports as `INCOMPLETE`
- `init` on a detached HEAD creates the branch and then fails with exit 2
- a second full run with the adapter as of commit 9ad234e: `init --branch` from
  the trunk, two `add`, `submit` (#1834 to #1836 as stack #1837), an amend
  without a conflict, `rebase --mode upstack` and a second `submit`; and a
  second adoption (#1838 and #1839 as stack #1840)
- `sync` after the trunk moved: the three branches were rebased and pushed, and
  numbers, bases and the stack were unchanged
- partial merge: `merge --target 1823 --confirm` on the middle layer landed
  #1822 and #1823 on `main` as two squash commits, one per pull request, and
  left #1824 open. No merge method was passed; `gh-stack` chose squash. The
  result text ("Merged #1822, #1823 into main") is on `stderr`. GitHub then
  retargeted #1824 to `main` and rebased its head on the server before any local
  command ran, and deleted the two merged head branches. Both merged pull
  requests keep their `stack` field
- `sync` after that merge: skipped the two merged branches, rebased the top
  branch onto `main`, force-pushed it over the server-side rebase, and reported
  the stack up to date with one open pull request

The first submit, rebase and adoption runs used the adapter as of commit
e8b9cba, before the `INCOMPLETE` status and the pull request URL check were
added. Every test pull request and `pilot/*` branch has since been closed or
deleted.

**Not verified — needs a live GitHub repository:**

- merging a whole stack by its top layer or stack number, and `--merge-method`
- adoption of pull requests that Graphite opened (the live adoption used plain
  `gh` pull requests)
- that `gh stack merge` refuses an ordinary, unstacked pull request (read from
  the v0.3.0 source, `cmd/merge.go`, not run)
- merge-queue behavior for a stack
- whether a server-side "Rebase stack" produces signed commits
- how `gh pr merge` and the REST merge endpoint behave on a stacked pull request
- `merge-single` against GitHub: it is covered by fixture tests only. The
  `stack` field it checks was read from live pull requests (present on #1823,
  absent on unstacked ones)

One live lifecycle (submit, restack, sync, partial merge, sync) has been run,
from a workstation clone that called the adapter directly. No machine has GitHub
selected as its provider, and the skills themselves have not been run live.
Statements about the unverified items below come from GitHub's documentation and
are marked "documented".

## Versions

| Tool                        | Required                                              | Tested |
| --------------------------- | ----------------------------------------------------- | ------ |
| `github/gh-stack` extension | 0.3.0 or later (enforced by `stack-tooling-probe.js`) | 0.3.0  |
| GitHub CLI `gh`             | 2.0 or later                                          | 2.89.0 |
| Git                         | 2.36 or later (enforced)                              | 2.43.0 |

`gh-stack` 0.2.0 moved stack state from each worktree to
`<git-common-dir>/gh-stack`. Upstream's instruction is not to mix old and new
versions within one clone. Upgrade every environment that touches a clone
together, and finish or abort any in-progress operation first.

GitHub's stacked pull requests have been generally available since 2026-10-06.

## Select and verify the provider

One provider is enabled at a time. `/stack:select` is the only switch.

1. Upgrade or install the extension and check the tooling:

   ```bash
   gh extension install github/gh-stack    # or: gh extension upgrade stack
   gh extension list                       # owner must be github/gh-stack
   ```

   Then run `/github-stack:setup`. It reports the extension version, the Git
   version and authentication, and offers the upgrade when the extension is too
   old.

2. Run `/stack:status`. With Graphite still enabled it prints `READY_GRAPHITE`;
   that is expected.
3. Finish or adopt open Graphite stacks first (see below).
4. Run `/stack:select github`, approve the printed plan, then `/reload-plugins`.
5. Run `/stack:status` again. Continue only on `READY_GITHUB`.
6. Optional: let `/stack:select` write `provider: github` to
   `.yellow-stack.yml`, so a session with Graphite enabled is reported as
   `CONFIG_MISMATCH` instead of silently using Graphite.

When no provider is selected, `/stack:status` recommends `github`
(`RECOMMENDED_PROVIDER` in `plugins/yellow-core/lib/stack-provider-state.js`).
It never selects it for you, and it never moves an enabled Graphite setup.

## Everyday use

**An independent change is an ordinary pull request.** `/github-stack:submit`
registers the branch as a one-branch stack on the trunk and opens one draft pull
request. GitHub forms a stack only when two pull requests exist. Such a pull
request lands with `/github-stack:merge-single <number>`, which needs a merge
method and a confirmation and refuses a pull request that belongs to a stack.
`gh stack merge` accepts only a stack or a stacked pull request, so
`/github-stack:merge` stops on an ordinary one instead of merging.

**Stack only when pull requests depend on one another.**

| Step                                      | Command                                                                                                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Start                                     | `/github-stack:submit` on the trunk or a new branch                                                              |
| Add a dependent layer                     | `/flow:work` (adapter `add` from the top branch)                                                                 |
| See the stack                             | `/github-stack:plan`                                                                                             |
| Change a lower layer                      | check it out with `/github-stack:nav`, then `/github-stack:amend` (amends, rebases the layers above, re-submits) |
| Catch up with the trunk, or after a merge | `/github-stack:sync`                                                                                             |
| Land an independent pull request          | `/github-stack:merge-single`                                                                                     |
| Land a stack of two or more               | `/github-stack:merge`                                                                                            |
| Stop tracking                             | `/github-stack:cleanup`                                                                                          |

Things that differ from Graphite:

- `gh stack merge` lands the target **and every unmerged pull request below it**
  in one all-or-nothing operation. To land part of a stack, target the highest
  layer you want. The merge skill lists the whole set before asking.
- If the base branch uses a merge queue, the same command queues the set
  (documented). It has no admin bypass.
- `gh pr merge` and the REST merge endpoint are not the stack merge. GitHub
  documents a separate asynchronous stack merge API. Do not merge a stacked pull
  request with them until the pilot shows what happens.
- `sync` rebases, **pushes**, and links existing pull requests. It never opens
  one.
- A rebased branch has a new head. Test results, review approvals and
  `/review:merge-ready` evidence for the old head are stale. Never report a
  stack as ready to publish with a failed test, an unfinished rebase, a
  `needsRebase` layer, or evidence from an older head.

## Existing Graphite stacks

Recognise one: `gt log short` lists branches other than the trunk, or the pull
request carries Graphite's stack comment.

**One provider owns a stack.** Never run `gt restack` / `gt sync` and
`gh stack rebase` / `gh stack sync` against the same branches, and never put one
stack in two merge queues.

Preferred: **finish it with Graphite.** Keep `gt-workflow` enabled, merge the
stack (directly; see the queue note in the inventory), then switch.

Alternative: **adopt it without closing pull requests.** Verified live with pull
requests opened by plain `gh`, not yet with ones Graphite opened.

1. In Graphite's stack, make sure every layer is restacked and pushed, and that
   nothing is in Graphite's merge queue.
2. `/stack:select github`, `/reload-plugins`, `/stack:status` shows
   `READY_GITHUB`.
3. Register the existing branches, bottom to top (verified locally; the adapter
   refuses an order in which a branch does not contain the one below):

   ```bash
   node plugins/github-workflow/lib/github-stack-runtime.js init \
     --base main --branch <bottom> --branch <middle> --branch <top>
   ```

4. `/github-stack:sync`. It links the open pull requests into a GitHub stack
   when two or more exist and opens none (documented). Check each pull request's
   base on GitHub afterwards.
5. Stop using `gt` on those branches. `gt untrack <branch>` removes Graphite's
   local tracking; it is optional and local.

If step 4 does not link them, nothing has been closed: switch back with
`/stack:select graphite` and finish with Graphite.
`/github-stack:cleanup --local` removes the local GitHub tracking.

## Going back to Graphite

`/stack:select graphite`, then `/reload-plugins`. Graphite stays installed
throughout. For a stack that GitHub now tracks, run `/github-stack:cleanup`
first (it unstacks the pull requests on GitHub and keeps the branches), then
`gt track` the branches. After 2026-12-28 this needs an active Graphite plan.

## Conflicts and worktrees

- `CONFLICT`: fix the files, `git add` them, then run the adapter's
  `rebase --mode continue`. `rebase --mode abort` restores every branch to where
  it was. No other stack mutation runs while a rebase is paused.
- `BASE_CHANGE_UNCONFIRMED`: GitHub retargeted the stack and the old base did
  not merge. Rebasing onto the new base drops the old base's commits. The sync
  skill asks before passing `--accept-base-change`.
- `SYNC_ABORTED`: local and remote stacks diverged. Nothing was changed. Resolve
  it in an interactive terminal.
- Worktrees share one stack state per clone. A rebase runs in whichever worktree
  has each branch checked out, and refuses up front if that worktree has
  uncommitted changes. Commit or stash there first.
- `/worktree:restack` already routes through the enabled provider.
- Try anything risky on a throwaway clone. Rebase, sync, push and cleanup
  rewrite or publish branches.

## CI cost and required checks

- GitHub Actions run for every pull request in a stack. Rebasing a five-layer
  stack starts five full runs. Keep stacks short.
- Every layer that changes `plugins/*/` needs its own changeset, because
  `changeset-check` runs per pull request.
- `main` requires `CI Status Summary` (non-strict), no approvals, no signed
  commits, no linear history, and has no GitHub merge queue (read from the API
  on 2026-11-17). GitHub evaluates those rules for every pull request in a stack
  against the stack's base (documented).
- No workflow here filters `pull_request` by base branch, so upper layers get
  the same checks. `github.event.pull_request.stack` is available if a workflow
  should skip work on upper layers; nothing uses it yet.
- **Signed commits: GitHub's documentation disagrees with itself.** The
  stacked-PR reference, the merging page and the GA changelog say a server-side
  "Rebase stack" produces signed commits. "Managing stacked pull requests" says
  those commits are not signed. This repository does not require signatures, so
  it is not a blocker here. A repository that does should test it before relying
  on the button. Local rebases sign only if local signing is configured.

## Graphite inventory

### yellow-plugins

| Item                          | Where                                                                                                                                                                                 | Action                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Graphite provider plugin      | `plugins/gt-workflow/`                                                                                                                                                                | Keep through the transition. Decide after cutover whether to keep it for other users.    |
| Convention file               | `.graphite.yml`                                                                                                                                                                       | Read only by gt-workflow. Remove with the plugin, not before.                            |
| Merge-readiness label         | `graphite-queue` in `plugins/yellow-review/skills/pr-review-workflow/scripts/check-merge-ready`, `commands/review/merge-ready.md`, its README, CLAUDE.md and bats test                | Needs a provider-neutral replacement before the label stops meaning anything. Follow-up. |
| Review workflow bot allowance | `.github/workflows/claude-code-review.yml` (`allowed_bots: 'cursor,graphite-app'`)                                                                                                    | Drop `graphite-app` after the app is removed.                                            |
| Merge-queue draft handling    | comment in `.github/workflows/review-gate.yml`; draft pull request #1816 skips `gtmq_*` branches                                                                                      | Harmless. Remove once no `gtmq_*` branch can appear.                                     |
| Contributor docs              | `CONTRIBUTING.md` (queue note, `gt submit` example), `README.md` ("Graphite's merge queue" and semgrep's Graphite CLI note), `plugins/yellow-linear/README.md` "Graphite Merge Queue" | Reword at cutover.                                                                       |
| Setup dashboard               | `plugins/yellow-core/commands/setup/all.md` Graphite rows                                                                                                                             | Keep while gt-workflow ships.                                                            |
| Codex smoke test              | `scripts/smoke-codex-graphite-auth.js`                                                                                                                                                | Keep while gt-workflow is Codex-enabled.                                                 |
| Other plugins                 | yellow-review, yellow-debt, yellow-devin, yellow-semgrep, yellow-linear                                                                                                               | Already provider-neutral through the router; they mention Graphite only as one branch.   |

Outside the tree, for this repository:

- The Graphite GitHub App is installed and has a branch-protection bypass
  allowance on `main`. Removing it is an owner step.
- Graphite's merge queue has landed nothing here since 2026-10-29; merges have
  been direct squash merges. Nothing depends on the queue today. It can leave
  `[Graphite MQ] Draft PR GROUP` pull requests and `gtmq_*` branches behind;
  none were open on 2026-11-17.
- Cloud session environments may install `gt` and hold a Graphite token. Check
  the environment's setup script and secrets.
- Local clones carry `.git/.graphite_repo_config`. It is inert without `gt`.

### Other repositories (not changed by this work)

`yellow-goal` has three branches tracked by Graphite, each directly on `main`,
so they are independent pull requests and need no adoption. Its `CLAUDE.md` and
`.graphite.yml` mention Graphite.

These local clones also carry Graphite repository config and need the same check
before the date: IAC, MSTUP, YNAB-MCP, carcosa-fleet, codemachine-pipeline,
grok-workflows, medianest, nestwatch-nswch11-disposable, sunsip-mke,
workflow_init, yellow-career, yellow-dotfiles, yellow-grafana, yellow-sleeper,
yellowking-opencode. For each: any open Graphite stack, any Graphite merge queue
or required check, and whether the Graphite app is installed.

## Readiness checklist for 2026-12-28

Expiry of a plan is not the same as non-renewal being configured.

- [ ] In Graphite's billing page, confirm the renewal setting yourself and note
      the date you checked. Do not infer it from this document.
- [ ] `gh-stack` 0.3.0 or later in every environment that touches the clones
      (WSL was upgraded from 0.1.0 to 0.3.0 during the pilot on 2026-11-17;
      Windows had none).
- [ ] `github-workflow` installed where work happens (it was not installed on
      the workstation on 2026-11-17).
- [ ] Pilot with throwaway `pilot/*` branches. Done on 2026-11-17: submit a
      three-layer stack, amend the bottom layer, restack, adopt two existing
      pull requests, sync onto a newer trunk, merge the bottom two, sync again,
      clean up.
- [ ] `/stack:select github` on each machine, `/stack:status` shows
      `READY_GITHUB`.
- [ ] No open Graphite stacks in any repository in the inventory, and nothing in
      a Graphite merge queue.
- [ ] `graphite-queue` label logic in yellow-review replaced or retired.
- [ ] Cloud environments no longer need `gt` or a Graphite token.
- [ ] Owner steps, in this order and only after everything above: remove
      Graphite's bypass allowance on `main`, uninstall the Graphite GitHub App,
      revoke Graphite tokens, delete leftover `gtmq_*` branches.
- [ ] Decide whether `gt-workflow` stays in the marketplace for other users.

## Reproducing the local verification

```bash
export GH_STACK_NO_UPDATE_NOTIFIER=1
R="$PWD/plugins/github-workflow/lib/github-stack-runtime.js"
tmp=$(mktemp -d) && cd "$tmp"
git init -q --bare remote.git && git clone -q remote.git work && cd work
git checkout -q -b main && git commit -q --allow-empty -m init
git push -q -u origin main
node "$R" init --base main --branch feat/one
echo one > one && git add one && git commit -q -m 'feat: one'
echo two > two && git add two
node "$R" add --branch feat/two --message 'feat: two'
node "$R" checkout --target feat/one
echo more >> one && git add one && git commit -q --amend --no-edit
node "$R" view                      # feat/two: needsRebase true
node "$R" rebase --mode upstack
node "$R" push --remote origin
```

Automated coverage:
`pnpm vitest run tests/integration/github-stack-runtime.test.ts tests/integration/stack-tooling-probe.test.ts tests/integration/stack-provider-state.test.ts`
and `bats tests/` in `plugins/github-workflow/`. Those use fake `gh` and `git`
executables and never reach GitHub.
