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

- Node.js 18-24 LTS
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
    plugin.json          # Required: name, description, author
  CLAUDE.md              # Plugin context and conventions
  README.md              # User-facing documentation
  commands/              # Slash commands (*.md)
  agents/                # Agent definitions (*.md)
  skills/                # Skill definitions (SKILL.md)
```

### Adding a Plugin

1. Create the directory structure above
2. Add a `plugin.json` with at minimum `name`, `description`, `author`
3. Register in `.claude-plugin/marketplace.json` under the `plugins` array
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
- [ ] Changeset file created if plugin files changed: `pnpm changeset` (see [Versioning](#versioning))

### PR Review Process

1. Automated checks must pass (CI/CD)
2. At least one maintainer review required
3. All review comments addressed
4. Documentation reviewed for completeness

## Versioning

Yellow-plugins uses [Changesets](https://github.com/changesets/changesets) to
manage plugin versions. **CI will block any PR that modifies plugin files without
a `.changeset/*.md` file.** This ensures every change surfaces to users via the
auto-update mechanism.

### When to create a changeset

Required when your PR modifies any file under `plugins/` that affects plugin
behavior, commands, agents, skills, or configuration schemas.

Not required for:
- Changes only to `packages/` (internal TypeScript tooling)
- Changes only to `scripts/`, `.github/`, or `docs/`
- Changes only to non-functional files (README, comments, formatting)

### How to create a changeset

```bash
pnpm changeset
```

The CLI will prompt you to:
1. Select which plugin packages changed (e.g. `yellow-core`, `yellow-review`)
2. Choose the bump type:
   - `patch` — bug fix, behavior correction, documentation update inside a plugin
   - `minor` — new command, new skill, new agent, or any additive change
   - `major` — breaking change to a command's interface, or removal of a command

This writes a `.changeset/<auto-slug>.md` file. Commit it alongside your changes.

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

### Emergency manual release

```bash
pnpm apply:changesets         # bumps plugin versions + syncs manifests
node scripts/catalog-version.js patch   # bumps root catalog version
git add -A
git commit -m "chore: version packages"
git push
pnpm tag                      # creates per-plugin git tags
git tag v<catalog-version>    # e.g. v1.1.2
git push --tags               # triggers publish-release.yml
```

### Note on auto-updates (GitHub issue #26744)

Claude Code's background auto-update check has a known bug where it does not
prompt users even when a newer version is available in the marketplace. Until
fixed, users can run `/plugin marketplace update` to fetch the latest. Version
bumps are still worth doing — they will be retroactively effective once the bug
is fixed.

## Coding Standards

### TypeScript

- Follow strict TypeScript configuration (defined in `tsconfig.base.json`)
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
