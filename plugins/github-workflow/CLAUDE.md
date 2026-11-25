# github-workflow Plugin

GitHub-native stacked-PR provider. One of two members of the `stacked-pr`
capability group; the other is `gt-workflow` (Graphite).

## Hard constraints

These are not style preferences — a change that breaks one of them breaks the
provider model:

- **All mutating `gh stack` calls MUST go through
  `plugins/github-workflow/lib/github-stack-runtime.js`** — never invoke
  `gh stack <verb>` directly from a command or skill's Bash block. The runtime
  adapter is the sole owner of argument validation, confirmation gating,
  exit-code interpretation, and **credential redaction** for every mutating
  operation (`init`, `add`, `checkout`, `rebase`, `sync`, `push`, `submit`,
  `merge`, `merge-single`, `unstack`). `merge-single` is the one operation that
  calls `gh api` rather than `gh stack`. Calling `gh stack` directly from a Bash
  block bypasses `redact()` and can surface a token from a credential-bearing
  remote URL straight into model context.
- **Never disable, uninstall, or work around `gt-workflow`.** Provider switching
  is `yellow-core`'s `/stack:select` and nothing else.
- **Never fall back to the other provider.** If this provider is not ready, say
  so and stop.
- **Never edit settings JSON directly.** Plugin state changes go through
  `claude plugin install|enable|disable` plus `/reload-plugins`.
- **Never introduce a command name that collides with `gt-workflow`'s.** This
  plugin's namespace is `github-stack:`.

## Components

### Commands (10)

- `/github-stack:setup` — thin wrapper invoking the `github-stack-setup` skill
  via the `Skill` tool.
- `/github-stack:status` — thin wrapper invoking the `github-stack-status` skill
  via the `Skill` tool.
- `/github-stack:plan` — thin wrapper invoking the `github-stack-plan` skill via
  the `Skill` tool.
- `/github-stack:submit` — thin wrapper invoking the `github-stack-submit` skill
  via the `Skill` tool.
- `/github-stack:amend` — thin wrapper invoking the `github-stack-amend` skill
  via the `Skill` tool.
- `/github-stack:sync` — thin wrapper invoking the `github-stack-sync` skill via
  the `Skill` tool.
- `/github-stack:nav` — thin wrapper invoking the `github-stack-nav` skill via
  the `Skill` tool.
- `/github-stack:cleanup` — thin wrapper invoking the `github-stack-cleanup`
  skill via the `Skill` tool.
- `/github-stack:merge` — thin wrapper invoking the `github-stack-merge` skill
  via the `Skill` tool.
- `/github-stack:merge-single` — thin wrapper invoking the
  `github-stack-merge-single` skill via the `Skill` tool.

### Skills (10)

- `github-stack-setup` — prerequisite check: `gh` present and authenticated, the
  installed `gh stack` extension is the official `github/gh-stack` at or above
  the tested version, and `git` is 2.36+. Reports gaps; runs no installer or
  upgrade without explicit confirmation.
- `github-stack-status` — read-only provider readiness report, including whether
  this plugin is the enabled `stacked-pr` provider (delegates that question to
  `yellow-core`'s `/stack:status`).
- `github-stack-plan` — read-only stack view via the runtime adapter's `view`
  operation.
- `github-stack-submit` — stage, commit, and submit uncommitted changes via the
  runtime adapter's `submit` operation (draft by default). A branch outside any
  stack is registered as a one-branch stack first (an ordinary pull request); a
  Graphite-tracked branch is refused.
- `github-stack-amend` — amend the current branch commit, rebase the branches
  above it (`rebase --mode upstack`), and re-submit. No submit after an
  unfinished rebase.
- `github-stack-sync` — sync the local stack with trunk via the runtime
  adapter's `sync` operation, which also pushes the rebased branches; pruning
  merged branches and accepting a retargeted base each require an
  `AskUserQuestion` confirmation before `--confirm` is passed.
- `github-stack-nav` — check out a stack target via the runtime adapter's
  `checkout` operation; resolves an omitted target via `view` +
  `AskUserQuestion` rather than letting the underlying CLI pick.
- `github-stack-cleanup` — remove local stack tracking via the runtime adapter's
  `unstack` operation; by default ALSO remote-unstacks every PR via the GitHub
  API (`--local` skips that and stays local-only). Never deletes local git
  branches, either form. Always behind an `AskUserQuestion` confirmation that
  states which of the two happens.
- `github-stack-merge` — merge a stacked PR via the runtime adapter's `merge`
  operation (Preview → Confirm → Merge → Report), always behind an
  `AskUserQuestion` confirmation; never calls `gh pr merge`. The preview lists
  the target and every unmerged PR below it, because GitHub lands that whole set
  (or queues it when the base uses a merge queue). The adapter reads that set
  from the Stacks REST API the way gh-stack does, not from the local stack file,
  and a confirmed merge needs the previewed `repository` and `previewToken`
  back.
- `github-stack-merge-single` — merge one ordinary pull request via the runtime
  adapter's `merge-single` operation (Preview → Confirm → Merge → Report). The
  adapter refuses a pull request GitHub reports as part of a stack, a draft, a
  closed one, or one not based on the default branch, needs an explicit merge
  method, and merges only the head commit and base branch the preview reported
  (REST merge call with `sha`). A pull request is stacked if its own answer has
  a `stack` object or the Stacks API lists it. A non-default base passes only
  when the user names it (`--base`, a release or hotfix branch) and no open pull
  request has it as its head. The preview lists open pull requests based on its
  head branch (`dependents`). The skill stops on a pull request Graphite owns.
  No admin override, auto-merge or branch deletion.

### MCP servers (0) · Hooks (2)

No MCP server — not needed for this plugin's command surface; every mutating
operation goes through the runtime adapter's own validation and confirmation
gating instead.

Two hooks, modelled on `gt-workflow`'s (independent copies, not a cross-plugin
require — this plugin has no runtime dependency on `gt-workflow` being present,
matching the "never require the other provider's files" reading of this repo's
provider-neutrality invariant):

- `check-git-push` (PreToolUse) — allows a plain `git push` and denies only
  pushes that can rewrite or delete a branch a stacked PR builds on: force
  (`-f`, `--force`, `--force-with-lease`, `--force-if-includes`, a `+refspec`,
  and any unambiguous prefix git accepts such as `--forc`), `--mirror`, and
  deletes (`-d`, `--delete`, `--prune`, a `:branch` refspec). This differs from
  gt-workflow on purpose: a push outside `gt submit` leaves Graphite's metadata
  stale, but gh-stack keeps its state locally and `sync`/`submit` pick a pushed
  branch up. A push whose words the detector cannot read in full is denied with
  its own message: one inside a nested shell, heredoc or pager, an alias or
  plumbing (`send-pack`, `subtree push`, remote helpers), a `-c`/`--config-env`
  override (`remote.origin.mirror=true`) or the same config through any
  `GIT_CONFIG*` variable, `--receive-pack`/`--exec` (git runs their value),
  xargs, a process substitution, `$'…'` quoting, or any `$`/substitution word
  (it can expand to a flag or refspec). A plain push of a branch listed in
  `<git-common-dir>/gh-stack` (read by `hooks/scripts/lib/stack-membership.js`,
  no git process) is allowed with `hookSpecificOutput.additionalContext` telling
  the model to run `/github-stack:sync` afterwards; it sets no
  `permissionDecision`, so the user's own permission rules still apply.
  Repository config that turns a plain push into a mirror or forced push
  (`remote.<name>.mirror`, a `+` in `remote.<name>.push`) is out of scope.
  Detection is `hooks/scripts/lib/git-push-detector.js`, a byte-identical copy
  of gt-workflow's tokenising detector (the root
  `tests/integration/git-push-detector-parity.test.ts` fails on drift — edit
  both copies together); this plugin uses its `analyzeGitPushCommand`, which
  scans the whole command and returns every push's words, while gt-workflow uses
  only `classifyGitPushCommand`. A present-but-non-string `tool_input.command`
  fails closed; an absent `tool_input` or unparseable envelope still fails open.
  Hook `timeout` is 5 s (was 1 s) for the same reason as gt-workflow's sibling:
  a cold Node start on a slow disk could exceed 1 s and a timed-out PreToolUse
  hook is non-blocking; the parity suite bounds the detector at < 500 ms (and <
  256 MB over its whole adversarial set) on 64 KB input.
- `check-commit-message` (PostToolUse) — warns on a non-conventional commit
  message, triggered on `git commit` instead of
  `gt modify`/`gt commit`/`gt create`.

Both are pure policy functions (`hooks/scripts/lib/policy-check-*.js`) with
direct behavior tests in `tests/hooks.bats` — not a bash-golden parity harness
like `gt-workflow`'s, since there is no deleted bash predecessor for these to
reproduce.

## Extension identity matters

`gh extension search stack` returns at least four extensions that expose a
`gh stack` command; three are third-party. Any readiness check must confirm the
installed extension's **owner** via `gh extension list` (look for
`github/gh-stack`), not merely that `gh stack` resolves. A third-party lookalike
answering `gh stack --help` is a false READY.

## Upstream status and tested version

GitHub's stacked pull requests have been generally available since 2026-10-06.
This plugin is tested against `github/gh-stack` **v0.3.0**
(`TESTED_GH_STACK_VERSION` in yellow-core's `stack-tooling-probe.js`); an older
extension is reported not ready. Facts the adapter depends on:

- v0.2.0 moved stack state to `<git-common-dir>/gh-stack`, shared by every
  worktree. Never mix older and newer versions in one clone.
- `add` takes no `--remote`; `init` adopts existing branches given bottom to
  top; `merge` takes a stack or PR number only (the adapter reduces a PR URL);
  `sync` pushes and links existing PRs but never opens one.
- gh-stack picks its repository with go-gh `repository.Current()`: `GH_REPO`,
  else the remote marked by `gh repo set-default`, else the remotes on hosts gh
  knows ranked upstream, github, origin, with SSH host aliases resolved
  (`ssh -G`). The adapter's `stackRepository()` copies that for `merge`, refuses
  when it could name two repositories or when a remote on another host wins, and
  the merge skill passes the previewed repository back (`--repository`). The
  confirmed `gh stack merge` runs with `GH_REPO=github.com/<that repository>`,
  so it cannot act elsewhere. `view --repository <owner/repo>` reads the stack
  under the same pin. A hostless `GH_REPO` gets gh's default host as go-gh
  `auth.DefaultHost()` works it out (`GH_HOST`, else the only host in
  `hosts.yml`), and is refused when that is not github.com.
- `gh stack merge <n>` reads `n` as a stack number first
  (`GET repos/<repo>/stacks/<n>`), then as a pull request
  (`GET repos/<repo>/stacks?pull_request=<n>`), and picks the landing set from
  that remote stack (`mergeCandidates` in `cmd/merge.go`): merged pull requests
  at the bottom are skipped and the first draft or closed one blocks everything
  above it. The adapter's merge preview copies that.
- `rebase` and `sync` leave the stack un-rebased when GitHub retargeted its base
  and the old base did not merge. The adapter reports that as
  `BASE_CHANGE_UNCONFIRMED`, never `SUCCESS`, and `--accept-base-change` needs
  `confirm: true`.
- `gh-stack` exits 0 when a GitHub call inside `submit`/`sync` fails and only
  prints `⚠ failed to …`. The adapter reports that as `INCOMPLETE`. It talks to
  GitHub over GraphQL, which Claude Code cloud sessions block, so `submit`
  cannot open pull requests from a cloud session.
- `gh stack merge` lands the target and every PR below it. `gh pr merge` and the
  REST merge endpoint are not equivalent for a stacked PR.

What was verified against the real extension in a local fixture, and what still
needs a live GitHub repository, is recorded in
`docs/stacked-prs-native-migration.md`. Bump the tested version only after
re-running that fixture list.

## Where the provider gate lives

The `github-stack-*` skills do not run `/stack:status` before mutating. The gate
stays with the provider-neutral callers (`/stack:*` and yellow-core's
`stack-operation-registry.js`), which classify readiness first. A skill is
reachable only while this plugin is enabled, and exactly one `stacked-pr`
provider is enabled at a time. The skills keep their own checks for what the
gate cannot see: Graphite tracking a branch, and gh-stack readiness reported by
the adapter.

## Dependency on yellow-core

`dependencies: ["yellow-core"]` in the catalog source is load-bearing: Claude
Code auto-enables declared dependencies at the same scope, and
`claude plugin enable` fails if the dependency is not installed. That is what
guarantees `/stack:select` and `/stack:status` exist whenever this provider is
enabled. `gt-workflow` now carries the same dependency (see its `CLAUDE.md`,
"Dependency on yellow-core"); the history of the earlier deferral is in the
"Documented adjustments" section of
`plans/complete/stacked-pr-provider-abstraction.md`.

## Testing

`bats tests/` from the plugin directory — `hooks.bats` (hook behavior) and
`skill-content.bats` (skill text pins), with fake `gh` / `git` executables in
`tests/fixtures/bin/`. Both manifest hooks run under a 5-second `timeout`
(`catalog/plugins/github-workflow.json`).
