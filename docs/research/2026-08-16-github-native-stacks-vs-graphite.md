# GitHub native stacked PRs vs Graphite — provider revalidation

**Date:** 2026-08-16 (evidence collected 2026-08-17)
**Verified against:** `gh` 2.97.0 (2026-07-31) · Claude Code 2.1.233 · `github/gh-stack` v0.1.0
**Method:** live `gh api` / `gh extension search` / `gh skill --help` / `claude plugin --help`
probes on this workstation, plus first-party documentation fetches
(github.blog changelog, github/gh-stack README, code.claude.com docs).
**Relationship to prior work:** this document does **not** supersede
[`graphite-merge-queue-stacked-prs-coding-agents.md`](graphite-merge-queue-stacked-prs-coding-agents.md)
(2026-04-30). That report's Graphite findings and its April 2026
conclusions stand as the historical record and are deliberately left
unedited. This document records what changed on the GitHub side between
April and August 2026 and what that means for a provider abstraction.

---

## 1. Executive summary

- **GitHub native stacked PRs are real, first-party, and in _public preview_
  — not GA.** Announced 2026-07-30, rolling out to all repositories "over
  the coming days".
- **`github/gh-stack` is genuinely first-party.** It lives under the
  `github` organization, is MIT-licensed, and `gh` itself advertises it:
  running `gh stack` without the extension installed prints "gh stack is
  available as an official extension."
- **There _is_ an official agent skill**, installed with
  `gh skill install github/gh-stack`. However, `gh skill` is itself a
  preview surface: `gh skill --help` prints "Working with agent skills in
  the GitHub CLI is in preview and subject to change without notice," and
  every subcommand is individually labelled `(preview)`.
- **Merge queue support for stacked PRs is still rolling out.** The
  changelog states it is "rolling out progressively over the coming weeks."
  This is the single most consequential gap for this repository, whose
  current workflow is Graphite-queue based (see §5).
- **Two independent preview surfaces stack their risk.** The GitHub feature
  is preview, the agent-skill distribution channel is preview, and the
  extension is at v0.1.0. A provider abstraction is therefore the right
  investment now; a provider _migration_ is not.

**Adjustment recorded against the task premise.** The task framing called
`github/gh-stack` and its agent skill "official", which the evidence
confirms, but did not state that the underlying GitHub feature, the CLI
skill channel, and the extension version are all pre-1.0/preview. That is
why this foundation ships provider *selection* and *classification* only,
with no stack operations — see
[`plans/stacked-pr-provider-abstraction.md`](../../plans/stacked-pr-provider-abstraction.md).

---

## 2. GitHub native stacked pull requests

**Source:** <https://github.blog/changelog/2026-07-30-stacked-pull-requests-are-now-in-public-preview/>
(fetched 2026-08-17)

| Fact | Value |
| --- | --- |
| Status | Public preview since 2026-07-30 — **not GA** |
| Rollout | "rolling out in public preview to all repositories over the coming days" |
| Surfaces | github.com, GitHub CLI, GitHub mobile, coding agents (via the gh-stack skill) |
| Merge model | "Merge the latest ready pull request to land it and every unmerged layer below it in one single operation" |
| Retargeting | Merging a layer causes the layers above to "automatically rebase and retarget" |
| Protections | "Existing branch protections and required checks remain enforced" |
| Merge queue | "Merge queue support for stacked pull requests is rolling out progressively over the coming weeks" |

Docs entry points (first-party):

- <https://docs.github.com/en/pull-requests/get-started/about-stacked-prs>
- <https://docs.github.com/en/pull-requests/how-tos/stacked-pull-requests>
- <https://gh.io/stacks> (the repository's declared homepage)

---

## 3. `github/gh-stack`

**Source:** `gh api repos/github/gh-stack` and the repository README
(fetched 2026-08-17).

```text
full_name:   github/gh-stack
description: GitHub Stacked PRs
license:     MIT
created_at:  2026-02-06
pushed_at:   2026-08-12
homepage:    https://gh.io/stacks
topics:      cli, gh-extension, github, stacked-prs
latest tag:  v0.1.0 (published 2026-07-29)
```

Install: `gh extension install github/gh-stack` (requires GitHub CLI v2.0+).

### 3.1 Ownership is verifiable two ways

1. The repository is under the `github` organization, not an individual.
2. `gh` 2.97.0 with the extension **absent** resolves `gh stack` to a
   built-in hint rather than "unknown command":

   ```text
   $ gh stack --help
   gh stack is available as an official extension.
   To install it, run:
     gh extension install github/gh-stack
   ```

### 3.2 Name-collision hazard (operational, not theoretical)

`gh extension search stack` on 2026-08-17 returned, in order:

```text
github/gh-stack                                  GitHub Stacked PRs
boneskull/gh-stack                               A GitHub CLI extension for managing stacked pull requests.
slidingwindowheterostracan428/gh-stack           Manage stacked branches and pull requests directly from the GitHub CLI.
VladimirAnaniev/gh-stack                         GitHub CLI extension for managing stacked pull request workflows
ThePlenkov/gh-stackx
nir-mo/gh-stack-pr-skill                         Claude Code skill for stacked pull requests, driven by GitHub's gh stack extension
```

Four distinct extensions expose a `gh stack` command name and three of them
are third-party lookalikes. **Any tooling this repository ships must pin the
fully-qualified `github/gh-stack`, never the bare `gh-stack` name**, and
provider-status checks must verify the installed extension's owner, not just
that a `gh stack` command resolves.

### 3.3 Command surface (README, v0.1.0)

Core: `init` (`-b/--base`) · `add` (`-A/--all`, `-u/--update`, `-m/--message`) ·
`checkout` · `rebase` (`--downstack`, `--upstack`, `--no-trunk`, `--continue`,
`--abort`, `--remote`, `--committer-date-is-author-date/--preserve-dates`) ·
`modify` (`--continue`, `--abort`) · `sync` (`--remote`, `--prune`) ·
`push` (`--remote`) · `submit` (`--auto`, `--open`, `--remote`) ·
`link` (`--base`, `--open`, `--remote`) ·
`merge` (`--merge-method`, `--merge`, `--squash`, `--rebase`, `-y/--yes`) ·
`view` (`-s/--short`, `--json`) · `unstack` (`--local`)

Navigation: `up` · `down` · `top` · `bottom` · `trunk` · `switch`

Utility: `feedback` · `alias` (`--remove`)

**None of these are invoked by this change.** They are recorded here so the
later authoring shell has a verified surface to map `gt` equivalents onto.
`gh stack view --json` is the machine-readable read surface a future
`/stack:status` extension would consume.

### 3.4 The official agent skill

The README documents `gh skill install github/gh-stack` "to enable agent
integration". The distribution channel is itself preview — verified locally:

```text
$ gh skill --help
Install and manage agent skills from GitHub repositories.

Working with agent skills in the GitHub CLI is in preview and
subject to change without notice.

AVAILABLE COMMANDS
  install:   Install agent skills from a GitHub repository (preview)
  list:      List installed skills (preview)
  preview:   Preview a skill from a GitHub repository (preview)
  publish:   Validate and publish skills to a GitHub repository (preview)
  search:    Search for skills across GitHub (preview)
  update:    Update installed skills to their latest versions (preview)
```

The repository's own `AGENTS.md` is contributor build documentation (Go
build/test conventions), **not** agent-integration guidance — do not cite it
as the agent contract.

---

## 4. Claude Code plugin facts the provider model depends on

**Sources:** <https://code.claude.com/docs/en/discover-plugins>,
<https://code.claude.com/docs/en/plugins-reference>, plus live
`claude plugin --help` probes on Claude Code 2.1.233 (2026-08-17).

### 4.1 Installation scopes

| Scope | Settings file | Meaning |
| --- | --- | --- |
| `user` | `~/.claude/settings.json` | Personal, all projects (CLI default) |
| `project` | `.claude/settings.json` | Shared with collaborators via VCS |
| `local` | `.claude/settings.local.json` | This repo, this user, gitignored |
| `managed` | managed settings | Administrator-installed |

Docs, verbatim: "You may also see plugins with **managed** scope. These are
installed by administrators via managed settings and **can't be modified**."
Managed settings also outrank `--plugin-dir`: "The exception is plugins that
managed settings force-enable or force-disable: `--plugin-dir` cannot
override those."

**Consequence for this design:** a managed-scope provider is not
disableable by any command we can issue. Provider selection must therefore
**fail closed** on a managed conflict rather than emitting a `claude plugin
disable` that will be rejected.

### 4.2 CLI surface (verified via `--help`, 2026-08-17)

```text
claude plugin list   [--json] [--available]
claude plugin install <plugin> [-s|--scope user|project|local] [--config k=v] [-y|--yes]
claude plugin enable  <plugin> [-s|--scope user|project|local]   # default: auto-detect
claude plugin disable [plugin] [-s|--scope user|project|local] [-a|--all]
```

`--scope` defaults to `user` for `install` and to **auto-detect** for
`enable`/`disable` — so provider switching must pass `--scope` explicitly
rather than relying on the default.

### 4.3 `claude plugin list --json` shape (observed, not documented)

The docs describe the fields loosely; the observed output on 2.1.233 is a
**flat array** (not an object with an `installed` key — that is the *Codex*
CLI's shape, see `docs/research/2026-07-16-codex-plugin-contract-spike.md`):

```json
[
  {
    "id": "gt-workflow@yellow-plugins",
    "version": "1.6.2",
    "scope": "user",
    "enabled": true,
    "installPath": "/home/user/.claude/plugins/cache/yellow-plugins/gt-workflow/1.6.2",
    "installedAt": "2026-05-12T18:22:07.626Z",
    "lastUpdated": "2026-08-02T22:22:03.493Z"
  },
  {
    "id": "code-simplifier@claude-plugins-official",
    "version": "1.0.0",
    "scope": "project",
    "enabled": true,
    "installPath": "...",
    "installedAt": "...",
    "lastUpdated": "...",
    "projectPath": "/home/user/projects/other-project"
  }
]
```

Three properties matter and are easy to get wrong:

1. `id` is `name@marketplace`, **not** a bare plugin name.
2. The same plugin can appear **multiple times**, once per scope.
3. `project`/`local` entries carry a `projectPath` that may belong to a
   **different repository**. Any classifier that does not filter by the
   current project path will read another project's provider state as this
   project's. (Confirmed on this workstation: the raw list contains entries
   for three unrelated projects.)

### 4.4 Applying changes

`/reload-plugins` applies enable/disable/install without a restart; when the
reload would invalidate the prompt cache the command warns and skips until
rerun as `/reload-plugins --force`. `claude plugin …` shell commands never
apply to the running session on their own.

### 4.5 Plugin dependencies

`plugin.json` supports `dependencies: [ "name" | { name, version } ]`.
Claude Code auto-enables declared dependencies transitively **at the same
scope**, and `claude plugin enable` **fails** when a dependency is not
installed. `claude plugin prune` removes auto-installed dependencies that
are no longer needed.

**Consequence:** declaring `yellow-core` as a dependency of a provider
plugin is load-bearing (it makes provider-neutral `/stack:*` commands
present whenever a provider is enabled), but it is also a hard install-time
constraint for anyone who already has the provider installed.

---

## 5. Comparison for this repository

| Dimension | Graphite (`gt`) | GitHub native (`gh stack`) |
| --- | --- | --- |
| Maturity | Production, years of use here | Public preview since 2026-07-30; extension v0.1.0 |
| Stack metadata | Graphite-side, CLI-tracked | GitHub-side, first-class on PRs |
| Merge queue | Stack-aware queue, in use by this repo | "rolling out progressively over the coming weeks" |
| Agent surface | This repo's `gt-workflow` plugin | Official `gh skill install github/gh-stack` (preview channel) |
| Machine-readable read | `gt log --stack` / plugin MCP | `gh stack view --json` |
| Web review UX | Graphite web app | Native github.com stack map |
| Third-party name collisions | none (`gt` is unambiguous) | four `gh stack` extensions exist (§3.2) |

The April 2026 report's finding that Graphite's queue and GitHub's native
queue are mutually exclusive on the same branch
(`docs/solutions/integration-issues/graphite-github-native-queue-incompatibility.md`)
is **unchanged** by this preview. GitHub adding stack awareness to *its*
queue does not make the two queues co-runnable; it makes the eventual
either/or choice sharper. That is precisely why the provider model forbids
silent fallback: two stack providers active at once is a correctness bug,
not a redundancy feature.

---

## 6. What this justifies building now

1. **Provider metadata in the neutral catalog** — declarative, generated-
   artifact-invisible, so recording which plugin provides `stacked-pr`
   costs nothing at install time.
2. **A provider-neutral `/stack:*` surface in `yellow-core`** that reads
   state and selects a provider, and does nothing else.
3. **A `github-workflow` skeleton** with setup/status only — because the
   operations it would wrap are behind two preview surfaces.

## 7. What this does **not** justify yet

1. Porting `gt` operations to `gh stack` (feature is preview; merge queue
   incomplete).
2. Changing this repository's Graphite authority or `flow:work`.
3. Depending on `gh skill` as a distribution channel (explicitly "subject to
   change without notice").
4. Any change to branch protections, rulesets, merge queues, or required
   checks.

---

## 8. Sources

- <https://github.blog/changelog/2026-07-30-stacked-pull-requests-are-now-in-public-preview/>
- <https://docs.github.com/en/pull-requests/get-started/about-stacked-prs>
- <https://docs.github.com/en/pull-requests/how-tos/stacked-pull-requests>
- <https://github.com/github/gh-stack> (README, releases, repository metadata via `gh api`)
- <https://gh.io/stacks>
- <https://code.claude.com/docs/en/discover-plugins>
- <https://code.claude.com/docs/en/plugins-reference>
- <https://code.claude.com/docs/en/plugins>
- Local CLI probes: `gh --version`, `gh extension search stack`, `gh stack --help`,
  `gh skill --help`, `claude --version`, `claude plugin {list,install,enable,disable} --help`,
  `claude plugin list --json`
