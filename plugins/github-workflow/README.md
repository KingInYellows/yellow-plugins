# github-workflow

GitHub-native stacked-PR **provider skeleton** for the `stacked-pr`
capability group.

> **Foundation only.** This plugin does not create, submit, amend,
> synchronise, rebase, clean up, or merge stacks. It checks whether the
> official GitHub tooling is present and reports provider readiness. Every
> mutating `gh stack` subcommand is deliberately out of scope until the
> authoring shell lands — see
> [`plans/stacked-pr-provider-abstraction.md`](../../plans/stacked-pr-provider-abstraction.md).

## Why it exists

GitHub shipped native stacked pull requests in **public preview** on
2026-07-30, with a first-party CLI extension (`github/gh-stack`) and an
official agent skill. Graphite remains this repository's working provider.
Rather than guess which wins, the marketplace now models both as
interchangeable providers of one capability, with exactly one enabled at a
time.

Full evidence, including what is still pre-GA, is in
[`docs/research/2026-08-16-github-native-stacks-vs-graphite.md`](../../docs/research/2026-08-16-github-native-stacks-vs-graphite.md).

## Provider model

| | |
| --- | --- |
| Capability group | `stacked-pr` |
| Provider id | `github` |
| Alternative | `gt-workflow` (id `graphite`) |
| Mutual exclusion | both may be **installed**; exactly one may be **enabled** |
| Selection | `/stack:select` (owned by `yellow-core`) |
| State | `/stack:status` (owned by `yellow-core`) |

Installing this plugin does **not** switch your provider. Nothing here
disables Graphite, and there is no fallback in either direction — an
ambiguous state is reported, never silently resolved.

## Requirements

- GitHub CLI (`gh`) v2.0 or later, authenticated (`gh auth status`).
- The **official** stacked-PR extension:

  ```bash
  gh extension install github/gh-stack
  ```

  Verify the owner, not just the command name: `gh extension search stack`
  returns several third-party extensions that also expose `gh stack`. Only
  `github/gh-stack` is first-party.

- `yellow-core`, declared as a plugin dependency — it owns the
  provider-neutral `/stack:*` surface.

## Commands

| Command | What it does |
| --- | --- |
| `/github-stack:setup` | Checks `gh`, auth, and that the installed `gh stack` extension is `github/gh-stack`. Reports what is missing; installs nothing without confirmation. |
| `/github-stack:status` | Reports this provider's readiness and whether it is the enabled `stacked-pr` provider. Read-only. |

Both are thin wrappers over same-named skills, matching the
`/plan:status` → `plan-status` pattern used elsewhere in this marketplace.

## What this plugin does not do

- No MCP server.
- No hooks.
- No mutating `gh stack` invocation (`init`, `add`, `submit`, `push`,
  `sync`, `rebase`, `merge`, `unstack`).
- No edits to settings JSON, branch protections, rulesets, merge queues, or
  required checks.
- No duplicate command names with `gt-workflow`.

## Status

Version 0.1.0 — skeleton. The command surface that maps `gt` operations onto
`gh stack` is deferred; see "Deferred work" in the plan document.
