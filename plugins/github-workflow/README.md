# github-workflow

GitHub-native stacked-PR **provider** for the `stacked-pr` capability group.

> **Full command surface.** This plugin creates, submits, amends, synchronises,
> navigates, cleans up, and merges stacks via `github-stack-runtime.js`, its
> dependency-free CLI adapter over the official `gh stack` extension. Every
> mutating call is argument-array-only (no shell interpolation), validated, and
> — for destructive operations — gated behind an explicit confirmation. See
> [`plans/stacked-pr-provider-abstraction.md`](../../plans/complete/stacked-pr-provider-abstraction.md)
> for the design history.

## Why it exists

GitHub's native stacked pull requests (public preview 2026-07-30, generally
available 2026-10-06) come with a first-party CLI extension, `github/gh-stack`.
The marketplace models GitHub and Graphite as interchangeable providers of one
capability, with exactly one enabled at a time. GitHub is the recommended
provider for new work; Graphite stays supported for stacks that already live
there. Moving over is described in
[`docs/stacked-prs-native-migration.md`](../../docs/stacked-prs-native-migration.md).

The original comparison is in
[`docs/research/2026-08-16-github-native-stacks-vs-graphite.md`](../../docs/research/2026-08-16-github-native-stacks-vs-graphite.md).

## Provider model

|                  |                                                           |
| ---------------- | --------------------------------------------------------- |
| Capability group | `stacked-pr`                                              |
| Provider id      | `github`                                                  |
| Alternative      | `gt-workflow` (id `graphite`)                             |
| Mutual exclusion | both may be **installed**; exactly one may be **enabled** |
| Selection        | `/stack:select` (owned by `yellow-core`)                  |
| State            | `/stack:status` (owned by `yellow-core`)                  |

Installing this plugin does **not** switch your provider. Nothing here disables
Graphite, and there is no fallback in either direction — an ambiguous state is
reported, never silently resolved.

## Requirements

- GitHub CLI (`gh`) v2.0 or later, authenticated (`gh auth status`), and Git
  2.36 or later.
- The **official** stacked-PR extension, v0.3.0 or later (the version this
  plugin is tested against; older ones report not ready):

  ```bash
  gh extension install github/gh-stack   # or: gh extension upgrade stack
  ```

  Verify the owner, not just the command name: `gh extension search stack`
  returns several third-party extensions that also expose `gh stack`. Only
  `github/gh-stack` is first-party.

- `yellow-core`, declared as a plugin dependency — it owns the provider-neutral
  `/stack:*` surface.

## Commands

| Command                      | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/github-stack:setup`        | Checks `gh`, auth, and that the installed `gh stack` extension is `github/gh-stack`. Reports what is missing; installs nothing without confirmation.                                                                                                                                                                                                                                                                                                                                                                                   |
| `/github-stack:status`       | Reports this provider's readiness and whether it is the enabled `stacked-pr` provider. Read-only.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `/github-stack:plan`         | Read-only stack view via the adapter's `view` operation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `/github-stack:submit`       | Stages, commits, and submits uncommitted changes as a draft PR (`--open` to open immediately). An independent change becomes a one-branch stack, which is an ordinary PR.                                                                                                                                                                                                                                                                                                                                                              |
| `/github-stack:amend`        | Amends the current branch's commit, rebases the branches above it, and re-submits.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `/github-stack:sync`         | Syncs the local stack with trunk and pushes the rebased branches; pruning merged branches requires confirmation.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `/github-stack:nav`          | Checks out a stack target (branch, PR number, PR URL, or stack number); prompts if none given.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `/github-stack:cleanup`      | Removes local stack tracking; by default also remote-unstacks every PR via the GitHub API (`--local` skips that). Never deletes local branches. Always behind confirmation.                                                                                                                                                                                                                                                                                                                                                            |
| `/github-stack:merge`        | Merges a PR and every unmerged PR below it via `gh stack merge` (never `gh pr merge`), always behind confirmation. The preview reads the set from the stack on GitHub, as `gh stack merge` does, so a branch you do not have locally is shown too. It names the repository gh-stack resolves (`GH_REPO`, `gh repo set-default`, or the remotes ranked upstream, github, origin), and the merge is refused if the repository, the set, a head commit, the base or the method changed since the preview, or the repository is ambiguous. |
| `/github-stack:merge-single` | Merges one ordinary PR with an explicit merge method, pinned to the head commit you confirmed. Refuses a PR that belongs to a stack (its own answer or the Stacks API). A PR into a release or hotfix branch needs `--base <branch>`. The preview lists open PRs built on its branch.                                                                                                                                                                                                                                                  |

Each is a thin wrapper over a same-named skill, matching the `/plan:status` →
`plan-status` pattern used elsewhere in this marketplace.

## Hooks

Two safety hooks (independent copies of `gt-workflow`'s, not a shared runtime
dependency):

- `check-git-push` (PreToolUse) allows a plain `git push`, including
  `git push -u origin <branch>`. It blocks force pushes (`-f`, `--force`,
  `--force-with-lease`, a `+refspec`), `--mirror` and branch deletes (`-d`,
  `--delete`, `--prune`, a `:branch` refspec), because those can rewrite or
  remove a branch that a stacked pull request builds on. A push it cannot read
  in full (inside `bash -c`, an alias, a `-c` or `GIT_CONFIG_*` override, xargs,
  a process substitution, `$'…'` quoting, or a `$` value) is blocked too.
  Pushing a branch listed in the local gh-stack catalog goes through with a
  reminder to run `/github-stack:sync` afterwards. Detection is tokenised, so
  path-qualified, `-C`/`--git-dir` and wrapper forms are caught while quoted
  literals are not.
- `check-commit-message` (PostToolUse) warns on a non-conventional commit
  message.

See `CLAUDE.md` for detail.

## What this plugin does not do

- No MCP server.
- No mutating `gh stack` invocation outside `github-stack-runtime.js` — no
  command or skill's Bash block calls `gh stack <verb>` directly.
- No edits to settings JSON, branch protections, rulesets, merge queues, or
  required checks.
- No duplicate command names with `gt-workflow`.
- No `modify`/`switch` support — both are TUI-only in the upstream `gh stack`
  CLI with no noninteractive flag surface; conflict recovery only uses
  `rebase --continue`/`--abort`.

## Status

Full command surface implemented and tested against `gh-stack` v0.3.0 with a
local fixture. Submitting, merging and merge-queue behavior have not been
exercised against a live GitHub repository from this codebase; the migration
guide lists exactly what is and is not verified.
