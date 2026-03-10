# Claude Code Configuration - yellow-plugins

## Project Overview

This is a Claude Code plugin marketplace repository. It provides plugins that
can be installed via `/plugin marketplace add KingInYellows/yellow-plugins`.

## Key Files

- `.claude-plugin/marketplace.json` — The catalog file Claude Code reads to
  discover plugins (create this file in the repository root if it does not yet
  exist). Uses the official Anthropic marketplace format.
- `plugins/*/` — Individual plugin directories. Each contains
  `.claude-plugin/plugin.json`.
- `schemas/` — JSON schemas for validation (official + extended custom schemas).
- `scripts/validate-marketplace.js` — Validates the marketplace catalog.
- `scripts/validate-plugin.js` — Validates all plugin manifests.

## Adding a Plugin

1. Create `plugins/<name>/.claude-plugin/plugin.json` with at minimum `name`,
   `description`, `author`.
2. Add commands in `plugins/<name>/commands/*.md` and/or other entrypoints.
3. Add a `CLAUDE.md` in the plugin root for context.
4. Register the plugin in `.claude-plugin/marketplace.json` under the `plugins`
   array.
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

Install/uninstall/rollback/browse logic is NOT in this repo — Claude Code
handles all of that natively.

## Versioning

Plugin versions use a three-way sync model:

```text
plugins/<name>/package.json  →  plugin.json  →  marketplace.json
```

`package.json` is the Changesets source of truth. `sync-manifests.js` propagates
it to the other two. `validate-versions.js` blocks CI if any of the three drift.

**Always run `pnpm changeset` before committing plugin file changes.** CI blocks
PRs that modify `plugins/*/` without a `.changeset/*.md` file.

```bash
pnpm changeset              # record bump type (patch/minor/major) for affected plugins
pnpm apply:changesets       # apply pending changesets locally (also runs sync-manifests.js)
node scripts/catalog-version.js patch  # bump root catalog version (required for release tags)
pnpm tag                    # create per-plugin git tags after version bump
```

**Bump type guide:**
- `patch` — bug fix or documentation-only change inside a plugin
- `minor` — new command, skill, or agent (additive change)
- `major` — breaking change or removal of a command

**Release flow (automated):** On merge to `main`, `version-packages.yml` opens a
"chore: version packages" PR. When that PR merges, per-plugin tags
(`yellow-core@1.1.1`) and a root catalog tag (`v1.1.2`) are created, and the
build-and-release job in the same workflow builds artifacts and publishes a
GitHub Release. Manual recovery: trigger `workflow_dispatch` with
`force_publish=true`.

**Known issue:** Claude Code's background auto-update has a bug (GH #26744) where
it doesn't prompt users when a new version is available. Users can run
`/plugin marketplace update` manually.
