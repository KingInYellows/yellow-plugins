# Contributing to Yellow Plugins

Thank you for your interest in contributing to the Yellow Plugins marketplace!
This document provides guidelines and processes for contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Plugin Structure](#plugin-structure)
- [Testing Requirements](#testing-requirements)
- [Pull Request Process](#pull-request-process)
- [Solution Docs](#solution-docs)
- [Coding Standards](#coding-standards)

## Code of Conduct

This project adheres to professional standards of collaboration. Please be
respectful, constructive, and focused on technical merit in all interactions.

## Getting Started

### Prerequisites

- Node.js 22.22.0-24.x
- pnpm 8.0.0 or higher
- Git

### Initial Setup

```bash
# Clone the repository
git clone https://github.com/KingInYellows/yellow-plugins.git
cd yellow-plugins

# Install dependencies
pnpm install

# Verify setup
pnpm validate:schemas
pnpm test:unit
```

## Development Workflow

### Branch Strategy

- `main` — Production-ready code
- Feature branches: `feat/<description>`
- Bug fixes: `fix/<description>`

### Making Changes

1. Create a feature branch from `main`
2. Make your changes following coding standards
3. Add tests for new functionality
4. Update documentation
5. Run validation: `pnpm validate:schemas && pnpm test:unit`
6. Submit a pull request

## Plugin Structure

Each plugin lives in `plugins/<name>/` and must contain:

```
plugins/<name>/
  .claude-plugin/
    plugin.json          # Required: name, description, version, author
  CLAUDE.md              # Plugin context and conventions
  README.md              # User-facing documentation
  commands/              # Slash commands (*.md)
  agents/                # Agent definitions (*.md)
  skills/                # Skill definitions (SKILL.md)
```

### Adding a Plugin

1. Create the directory structure above
2. Add `.claude-plugin/plugin.json` with at minimum `name`, `description`,
   `version`, and `author`
3. Register it in `.claude-plugin/marketplace.json` under the top-level
   `plugins` array with a `source` like `./plugins/<name>`
4. Add a README with install command, prerequisites, and component tables
5. Validate: `pnpm validate:schemas`

See `docs/plugin-validation-guide.md` for detailed validation rules.

### Plugin Conventions

- SKILL.md `description:` must be single-line (no YAML folded scalars)
- SKILL.md frontmatter uses `user-invokable` (with k)
- Agent `.md` files should focus on project-specific rules, not generic LLM
  knowledge
- Commands must list all tools used in `allowed-tools`
- Commands use `$ARGUMENTS` placeholder, never hardcoded values
- All files must use LF line endings

## Testing Requirements

### Running Tests

```bash
# Run unit tests
pnpm test:unit

# Run integration tests
pnpm test:integration

# Run schema validation
pnpm validate:schemas

# Run full release gate
pnpm release:check
```

### Test Standards

- Write tests before or alongside implementation
- Test both happy paths and error cases
- Use descriptive test names that explain intent
- Shell scripts: use [Bats](https://github.com/bats-core/bats-core) for testing

## Pull Request Process

### Before Submitting

- [ ] All tests pass: `pnpm test:unit`
- [ ] Code lints successfully: `pnpm lint`
- [ ] Types check: `pnpm typecheck`
- [ ] Plugin validation passes: `pnpm validate:plugins`
- [ ] Documentation updated (README + CLAUDE.md)
- [ ] Commit messages use conventional format (`feat:`, `fix:`, `docs:`, etc.)
- [ ] Changeset file created if plugin files changed: `pnpm changeset` (see
      [Versioning](#versioning))
- [ ] Solution doc written, updated, or skip criteria documented in PR
      description (see [Solution Docs](#solution-docs))

### PR Review Process

1. Automated checks must pass (CI/CD)
2. At least one maintainer review required
3. All review comments addressed
4. Documentation reviewed for completeness

## Versioning

Yellow-plugins uses [Changesets](https://github.com/changesets/changesets) to
manage plugin versions. **CI will block any PR that modifies plugin files
without a `.changeset/*.md` file.** This ensures every change surfaces to users
via the auto-update mechanism.

### When to create a changeset

Required when your PR modifies **any** file under `plugins/` — including
commands, agents, skills, hooks, CLAUDE.md, README.md, and configuration files.
Documentation changes inside a plugin directory are user-visible and should be
versioned.

Not required for:

- Changes only to `packages/` (internal TypeScript tooling)
- Changes only to `scripts/`, `.github/`, or root-level `docs/`

### How to create a changeset

```bash
pnpm changeset
```

The CLI will prompt you to:

1. Select which plugin packages changed (e.g. `yellow-core`, `yellow-review`)
2. Choose the bump type:
   - `patch` — bug fix, behavior correction, documentation update inside a
     plugin
   - `minor` — new command, new skill, new agent, or any additive change
   - `major` — breaking change to a command's interface, or removal of a command

This writes a `.changeset/<auto-slug>.md` file. Commit it alongside your
changes.

Also update the PR checklist item:

- [ ] Changeset file created: `pnpm changeset`

### What happens on merge

1. The `version-packages.yml` workflow runs on push to `main`.
2. If changeset files are pending: a **"chore: version packages" PR** is opened
   (or updated) that bumps `package.json`, `plugin.json`, and `marketplace.json`
   for each changed plugin, and writes `CHANGELOG.md` entries.
3. When that PR merges, git tags are created (e.g. `yellow-core@1.1.1` and a
   root catalog tag `v1.1.2`) and a GitHub Release is published.

### Reviewing the "Version Packages" PR

The PR is created by the Changesets bot. Before merging, verify:

- Bump types are correct (patch/minor/major) for each plugin.
- `CHANGELOG.md` entries are coherent.
- `plugin.json` and `marketplace.json` versions match `package.json`.

The PR can be held open to batch multiple features before releasing.

**Note on CI coverage:** The Version Packages PR is created by the
`github-actions[bot]` using `GITHUB_TOKEN`. GitHub does not trigger
`on: pull_request` CI on bot-created PRs, so `validate-schemas.yml` will not run
on this PR. The PR content is machine-generated (version bumps and CHANGELOG
entries only), so manual review of the three bullet points above is the primary
verification gate before merging.

### Emergency manual release

> **Note**: Tags are for release tracking only and do **not** trigger the workflow.  
> The workflow triggers on push to `main` or manual `workflow_dispatch`.

```bash
pnpm apply:changesets         # bumps plugin versions + syncs manifests
node scripts/catalog-version.js patch   # bumps root catalog version
git add -A
git commit -m "chore: version packages"
gt submit --no-interactive    # push via Graphite (triggers the workflow automatically)
pnpm tag                      # creates per-plugin git tags for tracking
git tag v<catalog-version>    # e.g. v1.1.2
git push --tags               # push tags for tracking (tag push — not managed by Graphite)

# If the automated workflow failed and you need manual recovery:
gh workflow run version-packages.yml -f force_publish=true
```

### Note on auto-updates (GitHub issue #26744)

Claude Code's background auto-update check has a known bug where it does not
prompt users even when a newer version is available in the marketplace. Until
fixed, users can run `/plugin marketplace update` to fetch the latest. Version
bumps are still worth doing — they will be retroactively effective once the bug
is fixed.

### Manual cache refresh for non-interactive sessions

`/plugin marketplace update` requires the Claude Code TUI and is not
available over Remote Control / non-interactive sessions. If you need to
refresh the locally-cached plugin content without a TUI (e.g., a
background agent verifying a freshly-merged `chore: version packages`
release), rsync the marketplace clone over the cache:

```bash
set -euo pipefail

command -v rsync >/dev/null 2>&1 || {
  printf '[cache-refresh] Error: rsync required\n' >&2
  exit 1
}
command -v jq >/dev/null 2>&1 || {
  printf '[cache-refresh] Error: jq required\n' >&2
  exit 1
}

MARKETPLACE=~/.claude/plugins/marketplaces/yellow-plugins/plugins
CACHE=~/.claude/plugins/cache/yellow-plugins
[ -d "$MARKETPLACE" ] || {
  printf '[cache-refresh] Error: MARKETPLACE not found: %s\n' "$MARKETPLACE" >&2
  exit 1
}

for plugin_dir in "$MARKETPLACE"/*/; do
  # Skip non-plugin dirs (e.g., `.DS_Store`, partial clones) before any
  # jq invocation — `set -euo pipefail` would otherwise abort the loop on
  # the first non-plugin directory.
  [ -f "$plugin_dir/.claude-plugin/plugin.json" ] || continue
  plugin=$(basename "$plugin_dir")
  # Allowlist plugin name (kebab-case [a-z0-9-]) so a directory named
  # `..` or `foo$(rm)` cannot reach path construction below.
  case "$plugin" in
    *[!a-z0-9-]* | '' | -* | *-)
      printf '[cache-refresh] Skipping unsafe plugin name: %s\n' "$plugin" >&2
      continue
      ;;
  esac
  mp_ver=$(jq -r '.version // ""' "$plugin_dir/.claude-plugin/plugin.json")
  # Allowlist version: reject empty, traversal sequences, hidden-file
  # leading dot, or hyphen-prefixed values that rsync/cp could read as flags.
  case "$mp_ver" in
    '' | */* | *..* | .* | -*)
      printf '[cache-refresh] Skipping invalid version %s for %s\n' "$mp_ver" "$plugin" >&2
      continue
      ;;
  esac
  target="$CACHE/$plugin/$mp_ver"
  if [ ! -d "$target" ]; then
    # No version dir yet for this plugin (brand-new install or post
    # `chore: version packages` bump). Seed from the highest existing
    # semver dir's structure — `sort -V` handles 1.10 > 1.9 correctly,
    # which `ls | tail -1` would not. The trailing `|| true` is required
    # under `set -euo pipefail`: when no version dirs exist yet, `ls`
    # exits non-zero, `pipefail` propagates that through the pipeline,
    # and `set -e` would abort the entire script. With `|| true`,
    # `existing` becomes empty and the `[ -n "$existing" ]` guard below
    # skips the seed-copy as intended.
    existing=$(ls -d "$CACHE/$plugin"/*/ 2>/dev/null | sort -V | tail -1) || true
    if [ -n "$existing" ]; then
      cp -r -- "$existing" "$target" || {
        printf '[cache-refresh] Error: failed to seed %s from %s\n' "$target" "$existing" >&2
        continue
      }
    fi
  fi
  [ -d "$target" ] && rsync -a --delete -- "$plugin_dir/" "$target/"
done
```

After the rsync, run `/reload-plugins` in your session so the runtime
re-reads the registry.

The rsync uses `--delete`, which removes any cache-only files not present
in the marketplace clone. The seed-copy fallback only fires when no prior
version directory exists under `$CACHE/$plugin/` (brand-new install or
wiped cache); when no prior version is available to seed from, the loop
skips that plugin and an interactive `/plugin marketplace update` is
still required to initialize the versioned directory. The shortcut
covers the common case where a prior version directory already exists
(from a previous install or seed copy) but its contents are stale after
a version bump.

## Solution Docs

`docs/solutions/` captures recurring engineering learnings — bugs that took
investigation, integration gotchas, workflow patterns — so the next time the
same problem appears, the fix is already documented. `MEMORY.md` indexes
those docs from a project-local auto-memory at
`~/.claude/projects/<slug>/memory/MEMORY.md`.

### Default pattern: in-PR co-shipped

When a PR resolves a learning worth keeping, write the solution doc **in the
same PR as the fix**. Both land atomically, the doc preserves a causal link
to the code change, and MEMORY.md never points at a doc that does not exist
on `main`. Run while on the feature branch with an open draft PR:

```bash
/workflows:compound --in-pr
```

The `knowledge-compounder` agent reads your PR body and commit subjects
(via `gh pr view`), drafts both the solution doc and the one-line MEMORY.md
index entry, runs Related Docs Finder against the existing corpus to detect
updates to existing topics, and gates on AskUserQuestion before writing.
Amend the resulting files into the same PR with `gt amend`.

### When a doc is required

Write a solution doc when the PR resolves something that would waste future
time if forgotten:

- A non-obvious bug fix where the root cause was hard to find or the
  diagnosis path was indirect.
- A workflow gotcha that bit you and is likely to bite the next person
  (CRLF + WSL2, merge-queue + force-push, etc.).
- An integration failure mode for a third-party tool or MCP server where
  the surface error did not match the actual cause.
- A reusable pattern extracted from a one-off fix that should become
  policy.

### Skip criteria

Skip the doc when none of the above apply:

- Trivial fixes (typos, whitespace, formatting).
- Behavior already covered by an existing doc in `docs/solutions/`.
- Subjective preference changes (rename, style adjustment) with no
  underlying failure mode.
- Version bumps, dependency updates, dependency lock-file refreshes.

When you skip, note the reason in the PR description under a `## Notes`
section so reviewers can sanity-check the call (e.g.,
`No solution doc — typo fix in error message`).

### Exception path: post-PR dedicated doc PR

When a learning is too large to amend into the feature PR (e.g., a multi-
file post-mortem that would dwarf the original fix), file a follow-up
`docs(solutions): <topic>` PR within the same week. Link it back to the
original PR in the description so the causal chain is preserved. Mark the
feature PR's `## Notes` section: `Solution doc tracked separately in
<follow-up PR URL>`.

### CI behavior

Two checks run on every PR that touches `docs/solutions/`:

- **`validate-solutions` (blocking).** Runs inside `validate:schemas`.
  Fails on exact-slug collisions (`ERROR-SOL-001`) when a NEW doc reuses an
  existing slug from any category, and on missing or invalid required
  frontmatter (`ERROR-SOL-002`). Diff-scoped — only new/modified files in
  the current PR's diff are checked. Pre-existing non-conforming docs are
  not retroactively gated; they only trip the validator when modified.
- **`validate-solutions-advisory` (non-blocking).** Emits a
  `::warning::` annotation when a PR closes a P0/P1-labeled issue but
  contains no `docs/solutions/` change. This is a nudge, never a block —
  reviewers can override at their judgment.

The advisory job has known blind spots: it uses GitHub's
`closingIssuesReferences` GraphQL field, which only surfaces issues linked
via PR-body keywords (`closes`, `fixes`, `resolves`) in the same repo.
Cross-repo closures (`closes other-repo#123`) and commit-message-only
closing keywords do not trigger the warning. Author judgment fills the gap.

### How `--in-pr` mode differs from the standard flow

Without `--in-pr`, `/workflows:compound` extracts the solution from the
**live conversation context** (the in-session transcript). That mode runs
the full 5-subagent extraction pipeline and is best when the learning was
just figured out and the PR body has not yet been written.

With `--in-pr`, the agent skips the 5-subagent pipeline and uses the PR
body + commit subjects directly as the canonical source. Use `--in-pr`
once the PR description is in good shape; use the bare command earlier,
while the analysis is still in your head.

Both modes route to the same M3 AskUserQuestion gate, which shows the
solution doc draft and the MEMORY.md entry side-by-side before any write.

## Coding Standards

### TypeScript

- Follow the strict TypeScript configuration in `tsconfig.json` (extends
  `tsconfig.base.json` where the strict compiler options are defined)
- Use explicit types (avoid `any`)
- Prefer interfaces over type aliases for objects

### Shell Scripts

- Use `set -euo pipefail` at the top
- Always quote variables: `"$VAR"` not `$VAR`
- Validate user input before use in paths
- Reject path traversal: `..`, `/`, `~` in names
- Use `jq` for JSON construction, never string interpolation

### Naming Conventions

- Files: `kebab-case.ts` / `kebab-case.md`
- Classes: `PascalCase`
- Functions/methods: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- Plugin names: `kebab-case`

## Split Validation Architecture

The repo deliberately runs **two parallel validation stacks** that do not
share code:

1. **`scripts/*.js`** — hand-rolled Node validators (`validate-plugin.js`,
   `validate-marketplace.js`, `validate-agent-authoring.js`,
   `validate-setup-all.js`). These enforce rules that JSON Schema cannot
   express: filesystem path existence, directory layout, `.md` presence,
   hook-script sanity, `hooks.json` drift, the userConfig shape allowlist.
   `validate-plugin.js` does **not** AJV-load `schemas/plugin.schema.json`.
   Since PR-A it is a thin orchestrator: per-rule checks live in
   `scripts/lib/plugin-rules.js`, path/hook helpers in
   `scripts/lib/plugin-paths.js`, console output in `scripts/lib/logging.js`,
   and the shared `marketplace.json` reader in
   `scripts/lib/marketplace-reader.js`.
2. **`packages/`** — the AJV-based TypeScript validator library
   (`packages/domain`, `packages/infrastructure`, `packages/cli`). It owns
   the JSON Schema validation path and the canonical error-code registry,
   `packages/domain/src/validation/errorCatalog.ts`.

The two stacks are intentionally separate — `scripts/` exists because the
filesystem/authoring rules predate (and outgrew) the schema. But the
**error-code registry must not be re-implemented.** If a `scripts/*.js`
file ever needs a structured `ERROR-<CATEGORY>-<NNN>` code, it must
`require` it from the catalog rather than hard-coding the string — the
packages build emits CJS that `scripts/` can consume. `pnpm
validate:error-codes` (also run inside `pnpm validate:schemas`) fails CI if
any `scripts/` file hard-codes a code already defined in the catalog.

There is intentionally **no migration of `scripts/` into `packages/`** —
the two have different jobs, no shared consumer, and no concrete trigger
for unification (YAGNI).

## Local vs Remote Validator Divergence

Yellow-plugins runs two local validation passes: `pnpm validate:plugins`
checks plugin-specific rules in `scripts/validate-plugin.js` (path existence,
hook script sanity, userConfig allowlist, hooks.json drift), and
`pnpm validate:schemas` runs AJV against `schemas/plugin.schema.json`. CI
runs both. **Neither passing guarantees the plugin will install successfully
via `claude doctor`.** Claude Code's remote validator can reject keys our
local schemas permit — recent examples:

| Field | Status | Symptom on `claude doctor` |
|---|---|---|
| `userConfig.<key>.pattern` | rejected | `Unrecognized key: "pattern"` (PR #409 → reverted 2026-05-08) |
| `plugin.changelog` | rejected | unknown root key |
| `repository: {type, url}` (npm-style) | rejected | invalid type, expects string |
| `userConfig.<key>` missing `type` or `title` | rejected | required fields per official schema |

**Always test schema-affecting changes on a fresh install before merging:**

1. Run `claude plugin validate` (official local CLI) — catches more than AJV.
2. Optional: bundle plugin to a zip + serve via HTTPS, then test load in a
   disposable session via `claude --plugin-url <https-artifact-url>`. This
   exercises the client-side load path (still not the marketplace remote
   validator, but closest available).
3. Most reliable: check out the PR branch on a clean machine, install the
   marketplace, and run `claude doctor` to confirm zero plugin errors.

The canonical official schema reference is
`https://json.schemastore.org/claude-code-plugin-manifest.json`. All plugins
in this marketplace declare it via `"$schema": "..."` in `plugin.json` for
editor autocomplete and inline validation.

## Skill Description Budget

Plugin skill descriptions are subject to Claude Code's session-level
[skill listing budget](https://code.claude.com/docs/en/skills) (default 1%
of context, 8,000-char fallback). Each individual skill's combined
`description` + `when_to_use` is officially capped at **1,536 characters**;
yellow-plugins skill descriptions are all well under that limit. None of
the yellow-plugins SKILL.md files currently use `when_to_use:`; the
guidance below covers `description:` only. If `when_to_use:` is adopted
in a future PR, revisit the budget arithmetic.

**Trim for selection clarity, not for budget.** Two principles, both
load-bearing:

- **Do not cut content that aids selection accuracy.** The WHAT clause, the
  "Use when…" trigger, the clause that distinguishes a skill from its
  closest neighbor, and any scope boundary that prevents misfire all earn
  their characters. Removing them to fit a budget target will hurt
  auto-invocation.
- **Do cut content that does not contribute to selection.** Enumerated
  trigger phrase lists ("phrases like 'X', 'Y', 'Z'"), body-content
  repetition (methodology names, algorithm steps, scoring rubrics that
  belong in the skill body), and capability listings the model can
  extrapolate from a precise WHAT clause are all dead weight at listing
  time. They consume budget without contributing to selection.

The two are compatible: you can have short descriptions AND accurate
selection by keeping the differentiating clause and cutting the noise.
The only hard limit is the official per-skill cap of **1,536 characters**,
and all yellow-plugins descriptions sit well under it. The community
threshold cited in
[anthropics/claude-code#44780](https://github.com/anthropics/claude-code/issues/44780)
(observed 2026-05-09; behavior reported by users, not documented in the
official schema) is that
trailing content past ~250 chars may be deprioritized at auto-invocation
time. The implication is positional, not a budget to cut toward: keep
the differentiating clause and "Use when..." trigger inside the first
~200 chars regardless of total description length.

This guidance does NOT apply to `user-invokable: false` skills — those
descriptions are loaded only by agents that preload them via `skills:`
frontmatter, never rendered in the listing budget. The positional
~250-char threshold above does not apply. Trim them only when the
description has obvious documentation-style bloat (capability
enumerations, methodology names, body-content repetition that the
reader can recover from the skill body) — as the audit did for
`agent-native-audit` and `council-patterns` in PR #507. Do not trim
for budget pressure alone.

For downstream installs hitting the budget, see [`claude doctor` says
"descriptions dropped"](README.md#claude-doctor-says-descriptions-dropped)
for the user-side workarounds (`skillListingBudgetFraction`,
`CLAUDE_SLASH_COMMAND_TOOL_CHAR_BUDGET`).

When trims need to be rolled back, note that yellow-plugins uses a single
combined changeset per audit PR. Reverting one skill's description
requires a cherry-pick of just that file's diff plus a fresh patch
changeset — not a simple `git revert` of the whole PR.

## Questions?

- Browse each plugin's README for usage
- Check `docs/plugin-validation-guide.md` for validation rules
- Open a discussion or issue on GitHub

---

Thank you for contributing to Yellow Plugins!
