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

### PR Review Process

1. Automated checks must pass (CI/CD)
2. At least one maintainer review required
3. All review comments addressed
4. Documentation reviewed for completeness

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
