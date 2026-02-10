# Claude Code Configuration - yellow-plugins

## Project Overview

This is a Claude Code plugin marketplace repository. It provides plugins that can be installed via `/plugin marketplace add kinginyellow/yellow-plugins`.

## Key Files

- `.claude-plugin/marketplace.json` — The catalog file Claude Code reads to discover plugins (create this file in the repository root if it does not yet exist). Uses the official Anthropic marketplace format.
- `plugins/*/` — Individual plugin directories. Each contains `.claude-plugin/plugin.json`.
- `schemas/` — JSON schemas for validation (official + extended custom schemas).
- `scripts/validate-marketplace.js` — Validates the marketplace catalog.
- `scripts/validate-plugin.js` — Validates all plugin manifests.

## Adding a Plugin

1. Create `plugins/<name>/.claude-plugin/plugin.json` with at minimum `name`, `description`, `author`.
2. Add commands in `plugins/<name>/commands/*.md` and/or other entrypoints.
3. Add a `CLAUDE.md` in the plugin root for context.
4. Register the plugin in `.claude-plugin/marketplace.json` under the `plugins` array.
5. Run `pnpm validate:schemas` to verify.

## Validation

```bash
pnpm validate:schemas        # All validation
pnpm validate:marketplace    # Marketplace only
pnpm validate:plugins        # Plugin manifests only
```

## Architecture

The TypeScript packages under `packages/` provide schema validation tooling:
- `packages/domain` — Validation types, error codes, and error catalog.
- `packages/infrastructure` — AJV-based JSON Schema validators.
- `packages/cli` — Thin validation CLI wrapper.

Install/uninstall/rollback/browse logic is NOT in this repo — Claude Code handles all of that natively.
