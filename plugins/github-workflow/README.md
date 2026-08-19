# github-workflow

GitHub-native stacked-PR **provider** for the `stacked-pr` capability
group.

> **Full command surface.** This plugin creates, submits, amends,
> synchronises, navigates, cleans up, and merges stacks via
> `github-stack-runtime.js`, its dependency-free CLI adapter over the
> official `gh stack` extension. Every mutating call is argument-array-only
> (no shell interpolation), validated, and — for destructive operations —
> gated behind an explicit confirmation. See
> [`plans/stacked-pr-provider-abstraction.md`](../../plans/stacked-pr-provider-abstraction.md)
> for the design history.

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
| `/github-stack:plan` | Read-only stack view via the adapter's `view` operation. |
| `/github-stack:submit` | Stages, commits, and submits uncommitted changes as a draft PR (`--open` to open immediately). |
| `/github-stack:amend` | Amends the current branch's commit and re-submits. |
| `/github-stack:sync` | Syncs the local stack with trunk; pruning merged branches requires confirmation. |
| `/github-stack:nav` | Checks out a stack target (branch, PR number, PR URL, or stack number); prompts if none given. |
| `/github-stack:cleanup` | Removes stack tracking (optionally local branches), always behind confirmation. |
| `/github-stack:merge` | Merges a stacked PR via `gh stack merge` (never `gh pr merge`), always behind confirmation. |

Each is a thin wrapper over a same-named skill, matching the
`/plan:status` → `plan-status` pattern used elsewhere in this marketplace.

## What this plugin does not do

- No MCP server.
- No hooks.
- No mutating `gh stack` invocation outside `github-stack-runtime.js` — no
  command or skill's Bash block calls `gh stack <verb>` directly.
- No edits to settings JSON, branch protections, rulesets, merge queues, or
  required checks.
- No duplicate command names with `gt-workflow`.
- No `modify`/`switch` support — both are TUI-only in the upstream `gh
  stack` CLI with no noninteractive flag surface; conflict recovery only
  uses `rebase --continue`/`--abort`.

## Status

Full command surface implemented. GitHub's native stacked pull requests and
`gh-stack` itself remain pre-GA as of 2026-08-17 — behavior may still
change upstream; see
[`docs/research/2026-08-16-github-native-stacks-vs-graphite.md`](../../docs/research/2026-08-16-github-native-stacks-vs-graphite.md).
