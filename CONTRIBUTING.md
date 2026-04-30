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
MARKETPLACE=~/.claude/plugins/marketplaces/yellow-plugins/plugins
CACHE=~/.claude/plugins/cache/yellow-plugins
for plugin_dir in "$MARKETPLACE"/*/; do
  plugin=$(basename "$plugin_dir")
  mp_ver=$(jq -r '.version // ""' "$plugin_dir/.claude-plugin/plugin.json")
  [ -z "$mp_ver" ] && continue
  target="$CACHE/$plugin/$mp_ver"
  if [ ! -d "$target" ]; then
    # New version dir for a fresh chore: version packages bump —
    # seed from the most recent existing version dir's structure.
    existing=$(ls -d "$CACHE/$plugin"/*/ 2>/dev/null | tail -1)
    [ -n "$existing" ] && cp -r "$existing" "$target"
  fi
  [ -d "$target" ] && rsync -a --delete "$plugin_dir/" "$target/"
done
```

After the rsync, run `/reload-plugins` in your session so the runtime
re-reads the registry.

The rsync uses `--delete`, which removes any cache-only files not present
in the marketplace clone. For a fresh post-`chore: version packages`
state where the cache has no existing version dir to seed from (e.g.,
brand-new plugin install), the loop has nothing to copy structure from;
in that case an interactive `/plugin marketplace update` is still
required to initialize the versioned directory. The rsync shortcut is
for the common case where the directory already exists but its contents
are stale.

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

## Questions?

- Browse each plugin's README for usage
- Check `docs/plugin-validation-guide.md` for validation rules
- Open a discussion or issue on GitHub

---

Thank you for contributing to Yellow Plugins!
