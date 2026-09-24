# Claude Code Configuration - yellow-plugins

## Project Overview

This is a Claude Code plugin marketplace repository. It provides plugins that
can be installed via `/plugin marketplace add KingInYellows/yellow-plugins`.

## Key Files

- `catalog/` — Neutral source of truth (`catalog.json` +
  `catalog/plugins/<name>.json`) from which the manifests below are generated
  (`pnpm generate:manifests`). See `catalog/README.md`.
- `.claude-plugin/marketplace.json` — The catalog file Claude Code reads to
  discover plugins. **Generated** from `catalog/`; never hand-edit. Uses the
  official Anthropic marketplace format.
- `plugins/*/` — Individual plugin directories. Each contains a generated
  `.claude-plugin/plugin.json` and a `package.json` (version source of truth).
- `schemas/` — JSON schemas for validation (official + extended custom schemas).
- `scripts/validate-marketplace.js` — Validates the marketplace catalog.
- `scripts/validate-plugin.js` — Validates all plugin manifests.

## Adding a Plugin

New plugin: `package.json` (version source of truth, `"private": true`) +
`catalog/plugins/<name>.json` + a `pluginOrder` entry, then
`pnpm generate:manifests`, wire it into
`plugins/yellow-core/commands/setup/all.md`, run `pnpm install` (lockfile),
`pnpm changeset`, and `pnpm validate:schemas` (refresh the manifest
characterization snapshot if it fails). The full numbered procedure — including
the conditional Step 1.5/1.6 `setup/all.md` entries — is the single source of
truth in
[CONTRIBUTING.md "Adding a Plugin"](../CONTRIBUTING.md#adding-a-plugin);
`docs/plugin-template.md` has the full worked example.

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

**The only command a plugin author runs is `pnpm changeset`, before
committing.** CI blocks PRs that modify `plugins/*/` without a `.changeset/*.md`
file.

```bash
pnpm changeset               # record bump type (patch/minor/major) for affected plugins
```

**Bump type guide:**

- `patch` — bug fix or documentation-only change inside a plugin
- `minor` — new command, skill, or agent (additive change)
- `major` — breaking change or removal of a command

**Release flow (automated):** On merge to `main`, `version-packages.yml` opens a
"chore: version packages" PR by running `pnpm apply:changesets` (bumps versions,
syncs `plugin.json`/`marketplace.json`) and
`node scripts/catalog-version.js patch` (bumps the root catalog version). When
that PR merges, `scripts/ci/release-tags.sh` creates the per-plugin tags
(`yellow-core@1.1.1`, via `changeset tag`) and the root catalog tag (`v1.1.2`,
which `changeset tag` does not create), and the build-and-release job in the
same workflow builds artifacts and publishes a GitHub Release.
`apply:changesets`, `catalog-version.js`, and `tag` are CI-run steps, not
developer commands. Hand-running `apply:changesets` outside CI is an
**emergency-only** recovery procedure (bot cannot open the PR) that always
mirrors the bot's own `patch` bump — see `CONTRIBUTING.md` "Emergency manual
release". Hand-running `catalog-version.js` with `minor` or `major` is a
separate, deliberate out-of-band catalog-snapshot decision, independent of any
plugin release urgency — see `docs/operations/versioning.md` "Catalog Version
Rules". Manual recovery when a publish run failed or logged "nothing to do" is a
`force_publish=true` dispatch, but never copy it bare: without `--ref` it builds
the current `main` and can re-publish under a stale tag. Follow the guarded
procedure in `docs/operations/release-checklist.md` Section 5.2, which pins the
dispatch to the release merge.

**Known issue:** Claude Code's background auto-update has a bug (GH #26744) where
it doesn't prompt users when a new version is available. Users can run
`/plugin marketplace update` manually.

## Solution Docs

`docs/solutions/` captures recurring engineering learnings. The default
authoring pattern is **in-PR co-shipped** — while on a feature branch with
an open draft PR, run `/flow:compound --in-pr` and the
`knowledge-compounder` agent will draft both the solution doc and the
MEMORY.md index line from the PR body and commits. CI gates new docs on
exact-slug uniqueness (`ERROR-SOL-001`) and required frontmatter
(`ERROR-SOL-002`) via `scripts/validate-solutions.js`, wired into
`pnpm validate:schemas`. Full policy, skip criteria, and CI behavior in
[CONTRIBUTING.md "Solution Docs"](../CONTRIBUTING.md#solution-docs).
