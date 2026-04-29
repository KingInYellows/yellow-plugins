---
title: 'Plugin Release Process — Version Bumps Required for Distribution'
date: 2026-03-11
category: workflow
track: bug
problem: 'Merged plugin features are invisible to other installations until a deliberate version bump and release are cut'
tags:
  - release
  - version-management
  - marketplace
  - changesets
  - distribution
  - workflow
severity: P1
components:
  - .changeset/
  - scripts/sync-manifests.js
  - .claude-plugin/marketplace.json
---

# Plugin Release Process — Version Bumps Required for Distribution

**Date:** 2026-03-11
**Category:** Workflow / Release Management
**Severity:** P1 — merged features invisible to all other installations

## Problem

After merging new plugin features (e.g., `/devin:review-prs` in PR #200),
those features don't appear on other machines where the plugins are installed.
Users run `/plugin marketplace update` but see no changes. The new
commands/skills/agents are invisible because no release was cut.

## Root Cause

Claude Code marketplace plugins use **version-based cache invalidation**:

1. When a plugin is installed, Claude Code caches it at a specific **git commit
   SHA + version**.
2. On other machines, Claude Code compares the cached version against the
   `marketplace.json` version.
3. **Without a version bump, new commits won't be fetched** — even if code is
   merged to `main`.
4. `/plugin marketplace update` checks the **released version** in
   `marketplace.json`, not the latest commit.

The release pipeline requires a deliberate multi-step process that was not
completed after merging PR #200:

```
PR merged → changesets pending → apply changesets → version bump → push → CI tags/release → users update
```

The pipeline stalled at "changesets pending" — 8 changesets accumulated without
being applied.

## Version Locations (Three-Way Sync)

Versions must be consistent across three files per plugin:

| File | Role |
|---|---|
| `plugins/<name>/package.json` | Source of truth (changeset writes here) |
| `plugins/<name>/.claude-plugin/plugin.json` | Plugin manifest (Claude Code reads this) |
| `.claude-plugin/marketplace.json` | Marketplace catalog (other machines check this) |

`scripts/sync-manifests.js` propagates from `package.json` → the other two.
**Never edit versions manually.**

## Release Checklist

### 1. Create changeset (during PR)

```bash
pnpm changeset
# Select affected plugin(s), bump type (patch/minor/major), description
```

This creates `.changeset/<slug>.md`. Commit it with the PR.

### 2. Apply changesets (after PR merges)

```bash
GITHUB_TOKEN=$(gh auth token) pnpm apply:changesets
```

This:
- Consumes all `.changeset/*.md` files
- Bumps `package.json` versions
- Runs `sync-manifests.js` to sync `plugin.json` + `marketplace.json`
- Generates `CHANGELOG.md` entries with GitHub PR links

**Note:** `GITHUB_TOKEN` is required because `@changesets/changelog-github`
fetches PR metadata for changelog entries.

### 3. Bump catalog version

```bash
node scripts/catalog-version.js patch   # or minor/major
```

This bumps the root `package.json` and `marketplace.json` metadata version.

**Important:** `apply:changesets` does NOT touch root `package.json` — only
plugin-level files. The `catalog-version.js` script writes to root
`package.json`, which must be explicitly staged. Missing this causes
`release-tags.sh` to read the old version and fail with "tag already exists."

### 4. Validate

```bash
pnpm validate:schemas
```

### 5. Commit and push

```bash
git add -A
git commit -m "chore: version packages"
git push origin main   # or gt submit if on a branch
```

### 6. CI creates release

The `version-packages.yml` workflow:
- Detects no pending changesets → runs publish phase
- Creates per-plugin git tags (e.g., `yellow-devin@2.1.0`)
- Creates a root catalog tag (e.g., `v1.2.0`)
- Builds tarball, SBOM, checksums
- Creates GitHub Release

### 7. Users update

On other machines:
```
/plugin marketplace update
```

## Recovery

If CI fails to create tags/releases:

```bash
gh workflow run "Version Packages" -f force_publish=true
```

This skips changeset detection and goes straight to the publish phase with
`RECOVERY_MODE=true`.

## Bump Type Guide

| Change | Bump | Example |
|---|---|---|
| Bug fix in existing command | `patch` | Fix curl error handling |
| New command/skill/agent | `minor` | Add `/devin:review-prs` |
| Breaking API/convention change | `major` | MCP server migration |
| Documentation-only | No changeset needed | Update CLAUDE.md |

## Incident: 2026-03-11

- **8 changesets** accumulated without being applied (spanning PRs #139–#200)
- **4 plugins** had unreleased features: gt-workflow, yellow-core, yellow-devin, yellow-semgrep
- Applied all changesets, bumped versions, pushed to main
- gt-workflow: 1.2.0 → 1.3.0, yellow-core: 1.3.0 → 1.4.0, yellow-devin: 2.0.1 → 2.1.0, yellow-semgrep: 1.1.0 → 2.0.0
- Catalog: 1.1.0 → 1.2.0

## Prevention

- After merging any plugin PR, check for pending changesets: `ls .changeset/*.md`
- If changesets exist, run the apply + bump + push steps above
- The CI workflow also handles this automatically when it creates a "Version
  Packages" PR — but only if the workflow is healthy
- Consider adding a CI check that warns when changesets accumulate beyond a
  threshold
