# Plugin Versioning Guide

This document explains the versioning system for yellow-plugins. There are two
version namespaces: **per-plugin versions** (tracked by Changesets) and the
**catalog version** (the root `package.json` version, released as a git tag).

## Two-Level Version Model

| Level | Source of truth | Who bumps it | When |
|---|---|---|---|
| Per-plugin | `plugins/<name>/package.json` | `pnpm apply:changesets` | On every release cut |
| Catalog | root `package.json` | `node scripts/catalog-version.js` | When ready to tag a release |

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

```sh
# 1. Apply all pending changesets
pnpm apply:changesets
# → Bumps plugins/*/package.json versions
# → Writes CHANGELOG.md entries for each changed plugin
# → Syncs plugin.json and marketplace.json versions

# 2. Regenerate the lockfile (versions changed)
pnpm install

# 3. Commit the version bumps
gt modify -c -m "chore(release): version packages"

# 4. Bump the catalog version
node scripts/catalog-version.js minor   # or patch / major

# 5. Commit the catalog bump
gt modify -c -m "chore(release): bump catalog to v1.x.x"

# 6. Run pre-flight checks
pnpm release:check

# 7. Tag and push
git tag v1.x.x && git push --tags  # Tags are not managed by Graphite — raw git push is correct here
# → publish-release.yml fires and creates a GitHub Release
```

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

Add workflows:brainstorm command to yellow-core. Fix silent failure in yellow-review PR comment resolver.
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

**When to bump the catalog:**

| Plugins changed | Suggested catalog bump |
|---|---|
| Only patch-level plugin changes | catalog patch |
| Any minor-level plugin change | catalog minor |
| Any major-level plugin change | catalog minor (catalog majors are rare) |

The catalog version does NOT need to match any individual plugin version. It is
a timestamp of the marketplace snapshot, not a semantic compatibility signal.

## Validate Version Consistency

At any time you can check that `package.json`, `plugin.json`, and
`marketplace.json` are in sync:

```sh
pnpm validate:versions        # fails on drift
pnpm validate:versions:dry    # reports drift without failing
```

This runs automatically in CI on every PR.

## Troubleshooting

### apply:changesets partial failure

If `sync-manifests.js` fails after `changeset version` has already run, the changesets
are consumed but plugin.json and marketplace.json are not synced. Recovery:

1. Fix the underlying issue (e.g. malformed plugin.json, missing field)
2. Run `node scripts/sync-manifests.js` manually to complete the sync
3. Run `pnpm validate:versions` to confirm the manifests are now consistent
