# Repository Guidelines

## Project Structure & Module Organization

This repository is a `pnpm` monorepo for Claude Code plugins and validation tooling.

- `.claude-plugin/marketplace.json`: marketplace catalog loaded by Claude Code.
- `plugins/<plugin-name>/`: plugin implementations (typically `CLAUDE.md`,
  `commands/`, `agents/`, `skills/`, and `.claude-plugin/plugin.json`).
- `packages/`: TypeScript workspace packages using layered architecture:
  - `packages/domain` (business rules/types)
  - `packages/infrastructure` (AJV validation, external libs)
  - `packages/cli` (CLI entry points)
- `schemas/`: JSON schemas for marketplace and plugin manifests.
- `scripts/`: schema/business-rule validators (for example
  `validate-marketplace.js`, `validate-plugin.js`).
- `examples/`: sample marketplace/plugin JSON files.

## Build, Test, and Development Commands

- `pnpm install`: install workspace dependencies (Node `>=18 <=24`, pnpm `>=8`).
- `pnpm build`: build all workspace packages.
- `pnpm lint`: run ESLint across `.js` and `.ts`.
- `pnpm typecheck`: run TypeScript checks without emitting.
- `pnpm test:unit`: run Vitest for `packages/`.
- `pnpm test:integration`: run Vitest integration tests under `tests/integration`.
- `pnpm validate:schemas`: run marketplace + plugin schema/business-rule validation.
- `pnpm release:check`: release gate (`validate:*` + `typecheck`).

## Coding Style & Naming Conventions

- Formatting is enforced by Prettier (`2` spaces, single quotes, semicolons, `printWidth: 80`).
- Linting uses ESLint + `@typescript-eslint` with strict rules
  (`no-explicit-any`, import ordering, no cycles).
- Maintain architecture boundaries: `domain -> infrastructure -> cli` (no reverse imports).
- Naming: files `kebab-case.ts`, classes/interfaces `PascalCase`, functions
  `camelCase`, constants `UPPER_SNAKE_CASE`.

## Testing Guidelines

- Use Vitest for TypeScript logic; place tests as `*.test.ts` or `*.spec.ts`.
- Use Bats for shell-heavy plugin logic (for example `plugins/yellow-ci/tests/*.bats`).
- Run plugin shell tests directly when relevant: `bats plugins/<plugin>/tests/*.bats`.
- Cover happy paths and error paths; target strong coverage for new logic
  (project guidance: `>80%`).

## Commit & Pull Request Guidelines

- Follow Conventional Commit style seen in history: `feat:`, `fix:`, `docs:`,
  `chore:`, `refactor:` with optional scope (example:
  `fix(yellow-ruvector): ...`).
- Keep commits focused and descriptive.
- Before opening a PR, run: `pnpm lint && pnpm typecheck &&
  pnpm test:unit && pnpm test:integration && pnpm validate:schemas`.
- PRs should include: clear summary, rationale, linked issue/requirement IDs
  when available, test updates, and docs/ADR updates for architectural changes.
