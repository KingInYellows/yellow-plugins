# Plugin Versioning Guide

This document explains the versioning system for yellow-plugins. There are two
version namespaces: **per-plugin versions** (tracked by Changesets) and the
**catalog version** (the root `package.json` version, released as a git tag).

## Two-Level Version Model

| Level | Source of truth | Who bumps it | When |
|---|---|---|---|
| Per-plugin | `plugins/<name>/package.json` | `pnpm apply:changesets` | On every release cut |
| Catalog | root `package.json` | `node scripts/catalog-version.js patch` (run by `pnpm version-packages`) | Once per release batch |

The catalog version appears on GitHub Releases. Plugin versions appear in
`marketplace.json` and are what Claude Code checks for updates.

## Developer Workflow

### When making changes to a plugin

```sh
# 1. After your code changes, record the intent
pnpm changeset
# → Interactive CLI: select which plugins changed, choose bump level, write a summary
# → Creates .changeset/<random-name>.md

# 2. Commit the changeset file alongside your code
gt modify -c -m "feat(yellow-core): add new brainstorm command" -m "chore: add changeset"
```

### When cutting a release

The standard path is automated — feature PRs carry changesets, and a bot opens
the version bump PR for you:

```sh
# 1. Merge your feature PR (with its changeset) to main.
#    version-packages.yml detects the pending changeset and opens/updates a
#    "chore: version packages" PR, running `pnpm run version-packages`:
#    → Applies changesets (bumps plugins/*/package.json, writes CHANGELOG.md)
#    → Syncs plugin.json and marketplace.json versions
#    → Bumps the catalog version: node scripts/catalog-version.js patch
#    → Refreshes the manifest snapshot test
#      (tests/integration/generate-manifests-characterization.test.ts, vitest -u)

# 2. Review the "Version Packages" PR (bump types, CHANGELOG entries,
#    three-way version match — see CONTRIBUTING.md "Reviewing the Version
#    Packages PR"), then run pre-flight checks against it:
pnpm release:check

# 3. Do not tag by hand. Merge the "Version Packages" PR. Its push to `main`
#    runs version-packages.yml again, which creates per-plugin tags
#    (`<name>@<version>`), the root catalog tag (`v<catalog-version>`), and
#    the GitHub Release. A manually pushed tag does not trigger that workflow.
#    Recovery: gh workflow run version-packages.yml -f force_publish=true
```

**Emergency manual release** (only when the bot cannot open the Version
Packages PR): see `CONTRIBUTING.md` "Emergency manual release". That path runs
`pnpm version-packages` on a hand-made branch and merges it through a normal
PR; the merge publishes exactly as in step 3. Do not push tags before that
merge — an existing `v<catalog-version>` tag makes the run log "nothing to do"
and skip the GitHub Release. If the run fails or skips publishing, run
`gh workflow run version-packages.yml -f force_publish=true`. It is a recovery
procedure, never the default.

## Semver Bump Rules

Use this table when the `pnpm changeset` CLI asks for the bump level:

| Change type | Bump level |
|---|---|
| Bug fix, typo, internal refactor (no behavior change) | **patch** |
| New command added | **minor** |
| New agent added | **minor** |
| New skill added | **minor** |
| New MCP server added to `plugin.json` | **minor** |
| `plugin.json` metadata only (`description`, `changelog`, `homepage`) | **patch** |
| `CLAUDE.md` update or documentation only | **patch** |
| Permission scope added to `plugin.json` | **minor** |
| Existing command renamed | **major** |
| Existing command removed | **major** |
| Existing command argument changed (breaking) | **major** |
| Existing command argument added (additive, optional) | **minor** |
| Agent instruction change (behavior only, no interface change) | **patch** |

### When in doubt

- If users who haven't changed their usage will see different behavior → **minor** or **major**
- If only the internals change → **patch**
- If existing workflows break → **major**

## Changeset File Format

A changeset file looks like this:

```markdown
---
"yellow-core": minor
"yellow-review": patch
---

Add flow:brainstorm command to yellow-core. Fix silent failure in yellow-review PR comment resolver.
```

The `pnpm changeset` CLI creates these files for you interactively. You can
also edit them manually.

## Which Changes Need a Changeset?

**Need a changeset:**
- Any change to a plugin's commands, agents, skills, or hooks
- Any change to a plugin's `plugin.json` that affects behavior
- Bug fixes in plugin scripts or documentation that users read

**Don't need a changeset:**
- CI/CD workflow changes
- Root-level documentation changes (`README.md`, `docs/operations/`)
- Schema or validation script changes (root infrastructure, not a plugin)
- Changes to the `packages/` internal tooling

## Checking Pending Changesets

```sh
# See what plugins have pending changesets
pnpm changeset status

# See what plugins have pending changesets relative to main
pnpm changeset status --since=origin/main
```

## Catalog Version Rules

The catalog version (`root package.json`) represents the overall marketplace
snapshot bundled into a GitHub Release tarball.

**Bump level:** always patch. `pnpm version-packages` runs
`node scripts/catalog-version.js patch` once per release batch, whatever bump
levels the plugins received, and the emergency path runs the same command.
Pass `minor` or `major` to `catalog-version.js` by hand only as a deliberate,
out-of-band decision.

The catalog version does NOT need to match any individual plugin version. It is
a timestamp of the marketplace snapshot, not a semantic compatibility signal.

## Validate Version Consistency

At any time you can check version sync. For every plugin directory with a
`package.json`, `scripts/validate-versions.js` checks the Claude three-way set:
`plugins/<name>/package.json`, `plugins/<name>/.claude-plugin/plugin.json`, and
the `.claude-plugin/marketplace.json` entry. A plugin directory without a
`package.json` is skipped unless it is Codex- or Cursor-enabled, in which case
the missing file is reported as drift.

When `catalog/plugins/<name>.json` has `targets.codex.enabled` true, it also
requires `package.json` to match `.codex-plugin/plugin.json`, and checks
`.agents/plugins/marketplace.json` for membership, name, order, and path
(those entries have no version field). When `targets.cursor.enabled` is true,
it requires `package.json` to match `.cursor-plugin/plugin.json`, and checks
`.cursor-plugin/marketplace.json` the same way.

```sh
pnpm validate:versions        # fails on drift
pnpm validate:versions:dry    # reports drift without failing
```

This runs automatically in CI on every PR. The success line reports how many
plugins were checked (`OK: <N> plugins — all versions in sync`), not a fixed
three-manifest count.

## Troubleshooting

### apply:changesets partial failure

If `sync-manifests.js` fails after `changeset version` has already run, the changesets
are consumed but plugin.json and marketplace.json are not synced. Recovery:

1. Fix the underlying issue (e.g. malformed plugin.json, missing field)
2. Run `node scripts/sync-manifests.js` manually to complete the sync
3. Run `pnpm validate:versions` to confirm the manifests are now consistent
