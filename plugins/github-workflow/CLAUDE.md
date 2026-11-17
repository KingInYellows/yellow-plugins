# github-workflow Plugin

GitHub-native stacked-PR provider. One of two members of the `stacked-pr`
capability group; the other is `gt-workflow` (Graphite).

## Hard constraints

These are not style preferences — a change that breaks one of them breaks
the provider model:

- **All mutating `gh stack` calls MUST go through
  `plugins/github-workflow/lib/github-stack-runtime.js`** — never invoke
  `gh stack <verb>` directly from a command or skill's Bash block. The
  runtime adapter is the sole owner of argument validation, confirmation
  gating, exit-code interpretation, and **credential redaction** for every
  mutating operation (`init`, `add`, `checkout`, `rebase`, `sync`, `push`,
  `submit`, `merge`, `merge-single`, `unstack`). `merge-single` is the one
  operation that calls `gh api` rather than `gh stack`. Calling `gh stack`
  directly from a Bash block bypasses `redact()` and can surface a token from a
  credential-bearing remote URL straight into model context.
- **Never disable, uninstall, or work around `gt-workflow`.** Provider
  switching is `yellow-core`'s `/stack:select` and nothing else.
- **Never fall back to the other provider.** If this provider is not
  ready, say so and stop.
- **Never edit settings JSON directly.** Plugin state changes go through
  `claude plugin install|enable|disable` plus `/reload-plugins`.
- **Never introduce a command name that collides with `gt-workflow`'s.**
  This plugin's namespace is `github-stack:`.

## Components

### Commands (10)

- `/github-stack:setup` — thin wrapper invoking the `github-stack-setup`
  skill via the `Skill` tool.
- `/github-stack:status` — thin wrapper invoking the `github-stack-status`
  skill via the `Skill` tool.
- `/github-stack:plan` — thin wrapper invoking the `github-stack-plan`
  skill via the `Skill` tool.
- `/github-stack:submit` — thin wrapper invoking the `github-stack-submit`
  skill via the `Skill` tool.
- `/github-stack:amend` — thin wrapper invoking the `github-stack-amend`
  skill via the `Skill` tool.
- `/github-stack:sync` — thin wrapper invoking the `github-stack-sync`
  skill via the `Skill` tool.
- `/github-stack:nav` — thin wrapper invoking the `github-stack-nav`
  skill via the `Skill` tool.
- `/github-stack:cleanup` — thin wrapper invoking the `github-stack-cleanup`
  skill via the `Skill` tool.
- `/github-stack:merge` — thin wrapper invoking the `github-stack-merge`
  skill via the `Skill` tool.
- `/github-stack:merge-single` — thin wrapper invoking the
  `github-stack-merge-single` skill via the `Skill` tool.

### Skills (10)

- `github-stack-setup` — prerequisite check: `gh` present and authenticated,
  the installed `gh stack` extension is the official `github/gh-stack` at or
  above the tested version, and `git` is 2.36+. Reports gaps; runs no
  installer or upgrade without explicit confirmation.
- `github-stack-status` — read-only provider readiness report, including
  whether this plugin is the enabled `stacked-pr` provider (delegates that
  question to `yellow-core`'s `/stack:status`).
- `github-stack-plan` — read-only stack view via the runtime adapter's
  `view` operation.
- `github-stack-submit` — stage, commit, and submit uncommitted changes via
  the runtime adapter's `submit` operation (draft by default). A branch
  outside any stack is registered as a one-branch stack first (an ordinary
  pull request); a Graphite-tracked branch is refused.
- `github-stack-amend` — amend the current branch commit, rebase the
  branches above it (`rebase --mode upstack`), and re-submit. No submit
  after an unfinished rebase.
- `github-stack-sync` — sync the local stack with trunk via the runtime
  adapter's `sync` operation, which also pushes the rebased branches;
  pruning merged branches and accepting a retargeted base each require an
  `AskUserQuestion` confirmation before `--confirm` is passed.
- `github-stack-nav` — check out a stack target via the runtime adapter's
  `checkout` operation; resolves an omitted target via `view` +
  `AskUserQuestion` rather than letting the underlying CLI pick.
- `github-stack-cleanup` — remove local stack tracking via the runtime
  adapter's `unstack` operation; by default ALSO remote-unstacks every PR
  via the GitHub API (`--local` skips that and stays local-only). Never
  deletes local git branches, either form. Always behind an
  `AskUserQuestion` confirmation that states which of the two happens.
- `github-stack-merge` — merge a stacked PR via the runtime adapter's
  `merge` operation (Preview → Confirm → Merge → Report), always behind
  an `AskUserQuestion` confirmation; never calls `gh pr merge`. The preview
  lists the target and every unmerged PR below it, because GitHub lands
  that whole set (or queues it when the base uses a merge queue).
- `github-stack-merge-single` — merge one ordinary pull request via the
  runtime adapter's `merge-single` operation (Preview → Confirm → Merge →
  Report). The adapter refuses a pull request GitHub reports as part of a
  stack, a draft, a closed one, or one not based on the default branch,
  needs an explicit merge method, and merges only the head commit and base
  branch the preview reported (REST merge call with `sha`). The skill stops
  on a pull request Graphite owns. No admin override, auto-merge or branch
  deletion.

### MCP servers (0) · Hooks (2)

No MCP server — not needed for this plugin's command surface; every
mutating operation goes through the runtime adapter's own validation and
confirmation gating instead.

Two hooks, mirroring `gt-workflow`'s (independent copies, not a
cross-plugin require — this plugin has no runtime dependency on
`gt-workflow` being present, matching the "never require the other
provider's files" reading of this repo's provider-neutrality invariant):

- `check-git-push` (PreToolUse) — blocks raw `git push`, pointing at
  `github-stack-submit` instead of Graphite's `gt submit`. Detection is
  `hooks/scripts/lib/git-push-detector.js`, a byte-identical copy of
  gt-workflow's tokenising detector (the root
  `tests/integration/git-push-detector-parity.test.ts` fails on drift —
  edit both copies together). A present-but-non-string
  `tool_input.command` fails closed; an absent `tool_input` or unparseable
  envelope still fails open. Hook `timeout` is 5 s (was 1 s) for the same
  reason as gt-workflow's sibling: a cold Node start on a slow disk could
  exceed 1 s and a timed-out PreToolUse hook is non-blocking; the parity
  suite bounds the detector at < 500 ms (and < 256 MB over its whole
  adversarial set) on 64 KB input.
- `check-commit-message` (PostToolUse) — warns on a non-conventional
  commit message, triggered on `git commit` instead of `gt modify`/`gt
  commit`/`gt create`.

Both are pure policy functions (`hooks/scripts/lib/policy-check-*.js`) with
direct behavior tests in `tests/hooks.bats` — not a bash-golden parity
harness like `gt-workflow`'s, since there is no deleted bash predecessor
for these to reproduce.

## Extension identity matters

`gh extension search stack` returns at least four extensions that expose a
`gh stack` command; three are third-party. Any readiness check must confirm
the installed extension's **owner** via `gh extension list` (look for
`github/gh-stack`), not merely that `gh stack` resolves. A third-party
lookalike answering `gh stack --help` is a false READY.

## Upstream status and tested version

GitHub's stacked pull requests have been generally available since
2026-10-06. This plugin is tested against `github/gh-stack` **v0.3.0**
(`TESTED_GH_STACK_VERSION` in yellow-core's `stack-tooling-probe.js`); an
older extension is reported not ready. Facts the adapter depends on:

- v0.2.0 moved stack state to `<git-common-dir>/gh-stack`, shared by every
  worktree. Never mix older and newer versions in one clone.
- `add` takes no `--remote`; `init` adopts existing branches given bottom
  to top; `merge` takes a stack or PR number only (the adapter reduces a
  PR URL); `sync` pushes and links existing PRs but never opens one.
- `rebase` and `sync` leave the stack un-rebased when GitHub retargeted its
  base and the old base did not merge. The adapter reports that as
  `BASE_CHANGE_UNCONFIRMED`, never `SUCCESS`, and `--accept-base-change`
  needs `confirm: true`.
- `gh-stack` exits 0 when a GitHub call inside `submit`/`sync` fails and
  only prints `⚠ failed to …`. The adapter reports that as `INCOMPLETE`.
  It talks to GitHub over GraphQL, which Claude Code cloud sessions block,
  so `submit` cannot open pull requests from a cloud session.
- `gh stack merge` lands the target and every PR below it. `gh pr merge` and
  the REST merge endpoint are not equivalent for a stacked PR.

What was verified against the real extension in a local fixture, and what
still needs a live GitHub repository, is recorded in
`docs/stacked-prs-native-migration.md`. Bump the tested version only after
re-running that fixture list.

## Dependency on yellow-core

`dependencies: ["yellow-core"]` in the catalog source is load-bearing:
Claude Code auto-enables declared dependencies at the same scope, and
`claude plugin enable` fails if the dependency is not installed. That is
what guarantees `/stack:select` and `/stack:status` exist whenever this
provider is enabled. `gt-workflow` now carries the same dependency (see its
`CLAUDE.md`, "Dependency on yellow-core"); the history of the earlier
deferral is in the "Documented adjustments" section of
`plans/complete/stacked-pr-provider-abstraction.md`.

## Testing

`bats tests/` from the plugin directory — `hooks.bats` (hook behavior) and
`skill-content.bats` (skill text pins), with fake `gh` / `git` executables in
`tests/fixtures/bin/`. Both manifest hooks run under a 5-second `timeout`
(`catalog/plugins/github-workflow.json`).
