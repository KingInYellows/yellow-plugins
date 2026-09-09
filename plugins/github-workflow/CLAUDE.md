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
  mutating operation (`init`, `add`, `checkout`, `rebase`, `sync`,
  `submit`, `merge`, `unstack`). Calling `gh stack` directly from a Bash
  block bypasses `redact()` and can surface a token from a
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

### Commands (9)

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

### Skills (9)

- `github-stack-setup` — prerequisite check: `gh` present and authenticated,
  and the installed `gh stack` extension is the official `github/gh-stack`.
  Reports gaps; runs no installer without explicit confirmation.
- `github-stack-status` — read-only provider readiness report, including
  whether this plugin is the enabled `stacked-pr` provider (delegates that
  question to `yellow-core`'s `/stack:status`).
- `github-stack-plan` — read-only stack view via the runtime adapter's
  `view` operation.
- `github-stack-submit` — stage, commit, and submit uncommitted changes via
  the runtime adapter's `submit` operation (draft by default).
- `github-stack-amend` — amend the current branch commit and re-submit via
  the runtime adapter's `submit` operation.
- `github-stack-sync` — sync the local stack with trunk via the runtime
  adapter's `sync` operation; pruning merged branches requires an
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
  an `AskUserQuestion` confirmation; never calls `gh pr merge`.

### MCP servers (0) · Hooks (2)

No MCP server — not needed for this plugin's command surface; every
mutating operation goes through the runtime adapter's own validation and
confirmation gating instead.

Two hooks, mirroring `gt-workflow`'s (independent copies, not a
cross-plugin require — this plugin has no runtime dependency on
`gt-workflow` being present, matching the "never require the other
provider's files" reading of this repo's provider-neutrality invariant):

- `check-git-push` (PreToolUse) — blocks raw `git push`, pointing at
  `github-stack-submit` instead of Graphite's `gt submit`.
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

## Preview status (as of 2026-08-17)

GitHub's native stacked PRs, the `gh skill` distribution channel, and
`gh-stack` itself (v0.1.0) are all pre-GA. Merge-queue support for stacked
PRs was still rolling out. Treat behaviour as unstable and re-verify before
building on it — see
`docs/research/2026-08-16-github-native-stacks-vs-graphite.md`.

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
`tests/fixtures/bin/`. Both manifest hooks run under a 1-second `timeout`.
