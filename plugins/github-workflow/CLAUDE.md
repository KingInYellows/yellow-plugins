# github-workflow Plugin

GitHub-native stacked-PR provider skeleton. One of two members of the
`stacked-pr` capability group; the other is `gt-workflow` (Graphite).

## Hard constraints

These are not style preferences — a change that breaks one of them breaks
the provider model:

- **Never invoke a mutating `gh stack` subcommand** from this plugin:
  `init`, `add`, `submit`, `push`, `sync`, `rebase`, `modify`, `merge`,
  `link`, `unstack`. Read-only probes (`gh extension list`,
  `gh stack --help`, `gh stack view --json`) are the only permitted contact
  surface while this plugin is a skeleton.
- **Never disable, uninstall, or work around `gt-workflow`.** Provider
  switching is `yellow-core`'s `/stack:select` and nothing else.
- **Never fall back to the other provider.** If this provider is not
  ready, say so and stop.
- **Never edit settings JSON directly.** Plugin state changes go through
  `claude plugin install|enable|disable` plus `/reload-plugins`.
- **Never introduce a command name that collides with `gt-workflow`'s.**
  This plugin's namespace is `github-stack:`.

## Components

### Commands (2)

- `/github-stack:setup` — thin wrapper invoking the `github-stack-setup`
  skill via the `Skill` tool.
- `/github-stack:status` — thin wrapper invoking the `github-stack-status`
  skill via the `Skill` tool.

### Skills (2)

- `github-stack-setup` — prerequisite check: `gh` present and authenticated,
  and the installed `gh stack` extension is the official `github/gh-stack`.
  Reports gaps; runs no installer without explicit confirmation.
- `github-stack-status` — read-only provider readiness report, including
  whether this plugin is the enabled `stacked-pr` provider (delegates that
  question to `yellow-core`'s `/stack:status`).

### MCP servers (0) · Hooks (0)

Deliberate. Neither is needed to answer "is this provider usable?", and both
would add install-time surface to a skeleton.

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
provider is enabled. `gt-workflow` deliberately does **not** carry this
dependency yet — adding it would break existing standalone installs; see
the "Documented adjustments" section of
`plans/stacked-pr-provider-abstraction.md`.
