---
date: 2026-03-03
topic: plugin-versioning-strategy
approach: B — Automate the Changesets pipeline
---

# Plugin Versioning Strategy — Approach B Implementation Spec

## What We're Building

A fully automated versioning pipeline for the yellow-plugins monorepo that:

1. Requires developers to record a changeset file (`.changeset/<slug>.md`) on
   every PR that modifies plugin files — enforced as a blocking CI check.
2. Runs `changesets/action@v1` on every merge to `main`, which calls
   `changeset version && node scripts/sync-manifests.js` and opens a
   "Version Packages" PR that batches all pending version bumps.
3. When that "Version Packages" PR merges, Changesets creates per-plugin git
   tags (e.g. `yellow-core@1.2.0`) and a single catalog tag (e.g. `v1.2.0`)
   that triggers the existing `publish-release.yml` workflow.
4. Ensures `plugin.json` and `marketplace.json` are always updated in lockstep
   with `package.json` so Claude Code's cache-invalidation mechanism sees the
   new version.

The prior brainstorm (2026-02-23) defined the strategy and data model. This
document is the implementation spec for Approach B specifically — what files
change, in what order, and why.

---

## Problem Statement

Claude Code performs plugin auto-updates by comparing the cached version of
`plugin.json` against the version field in the remote `marketplace.json`. If
the version is unchanged, no update is fetched. This means a version bump in
`plugin.json` (and the corresponding `marketplace.json` entry) is the
**only mechanism** that signals to Claude Code that new content is available.

Currently:

- `plugin.json` and `marketplace.json` version fields are present and in sync
  (11 plugins, all at `1.1.0` except `yellow-devin` at `2.0.1`).
- `plugins/*/package.json` files exist and are the source of truth for
  Changesets — they also agree with the manifest files.
- The Changesets CLI (`@changesets/cli`) is installed and `apply:changesets`
  runs `changeset version && node scripts/sync-manifests.js` locally.
- `validate-versions.js` enforces three-way consistency in CI (blocking).
- `changeset-check` in CI is advisory (non-blocking) — PRs can merge without
  a changeset file, silently skipping version automation.
- **No workflow exists** that automatically runs `changeset version` on merges
  to `main` and opens a "Version Packages" PR.
- **No workflow creates per-plugin git tags** after a version bump.
- The `publish-release.yml` fires on `v*.*.*` tags but validates only the root
  `package.json` version — it has no awareness of per-plugin versions.

The gap: developers can ship plugin changes without bumping any version, users
never get an auto-update notification, and the versioning infrastructure is
wired but never triggered automatically.

---

## Current State Analysis

### Three-Way Sync Model

The version for each plugin must be identical across three files:

```
plugins/<name>/package.json        ("version": "1.1.0")
  |
  v  [sync-manifests.js]
plugins/<name>/.claude-plugin/plugin.json   ("version": "1.1.0")
  |
  v  [sync-manifests.js]
.claude-plugin/marketplace.json    ({ "name": "<name>", "version": "1.1.0" })
```

`package.json` is the Changesets source of truth. `sync-manifests.js` is the
bridge that propagates it to the manifest files. `validate-versions.js` fails
the build if any of the three disagree.

### What Already Works

- `pnpm changeset` — creates a `.changeset/<slug>.md` intent file.
- `pnpm apply:changesets` — calls `changeset version` (bumps `package.json`,
  writes `CHANGELOG.md`, removes intent files) then `sync-manifests.js`.
- `validate:versions` CI job — blocking, fails on three-way drift.
- `changeset-check` CI job — present but non-blocking; warns on missing
  changeset files.
- `publish-release.yml` — fires on `v*.*.*` tags, validates root version,
  builds artifact, creates GitHub Release.

### What Does Not Exist Yet

- A GitHub Actions workflow (`.github/workflows/version-packages.yml`) that
  runs `changeset version && sync-manifests.js` on push to `main` and opens
  a "Version Packages" PR via `changesets/action@v1`.
- Per-plugin git tags (e.g. `yellow-core@1.2.0`) created automatically on
  "Version Packages" PR merge.
- Blocking CI enforcement of changeset files on plugin-modifying PRs.
- Documentation of the expected developer workflow.

### Known Bug: GitHub Issue #26744

Claude Code's auto-update command (`/plugin marketplace update`) does not
currently trigger when only `marketplace.json` version fields change. The bug
is tracked as GitHub issue #26744 (open, unassigned). Until it is fixed, users
must run `/plugin marketplace update` manually after a release.

This does **not** mean version bumps are useless — once the bug is fixed,
update detection will be retroactive for any plugin whose version in
`marketplace.json` is ahead of what the user has cached. It means version
bumps are a prerequisite for future auto-updates, not a current blocker for
shipping changes.

---

## Selected Approach: B — Automate the Changesets Pipeline

### Philosophy

The Changesets toolchain already handles the hard parts: intent recording,
semver math, CHANGELOG generation, and workspace-aware version bumping.
The gap is purely operational — nothing runs `changeset version` automatically
and nothing creates the post-bump git tags.

Approach B fills that gap with minimal new code:

- One new GitHub Actions workflow (`version-packages.yml`).
- One change to `validate-schemas.yml` (make `changeset-check` blocking).
- One new `CONTRIBUTING.md` section (developer workflow).
- Optional: add `changelog` URL field to each `plugin.json`.

No new scripts. No new dependencies. No changes to the three-way sync model.

### Full Implementation Plan

#### Step 1: Create `.github/workflows/version-packages.yml`

This workflow uses the official `changesets/action@v1` action. It:

1. Triggers on push to `main`.
2. Checks for pending `.changeset/*.md` files.
3. If changesets exist: runs `changeset version && node scripts/sync-manifests.js`,
   commits the result, and opens (or updates) a PR titled "Version Packages".
4. If no changesets exist: exits silently — no PR is created or updated.

Key configuration choices:

- `publish` step is left empty (we do not publish to npm; GitHub Releases are
  handled separately by `publish-release.yml`).
- The action needs `GITHUB_TOKEN` with `contents: write` and
  `pull-requests: write` permissions.
- A `PNPM_VERSION` env var should be set to match the repo's `8.15.0`.

Skeleton workflow:

```yaml
name: Version Packages

on:
  push:
    branches:
      - main

concurrency:
  group: version-packages
  cancel-in-progress: false  # never cancel — partial PRs leave dirty state

permissions:
  contents: write
  pull-requests: write

jobs:
  version:
    name: Version or Publish
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@41ff72655975bd51cab0327fa583b6e92b6d3061
        with:
          version: '8.15.0'

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - run: pnpm install --frozen-lockfile

      - uses: changesets/action@v1
        with:
          version: pnpm apply:changesets
          commit: 'chore: version packages'
          title: 'Version Packages'
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Why `version: pnpm apply:changesets`? Because `apply:changesets` runs both
`changeset version` (the Changesets default) and `node scripts/sync-manifests.js`
(our bridge). This keeps the manifest files in sync in the same commit the
action creates.

#### Step 2: Add Per-Plugin Git Tags on "Version Packages" Merge

The `changesets/action@v1` has a `publish` parameter. When set, the action
calls it after the "Version Packages" PR merges and creates git tags for each
bumped package. We want per-plugin tags like `yellow-core@1.2.0` plus a
catalog tag `v1.2.0` that triggers `publish-release.yml`.

The `publish` step needs to:

1. Create per-plugin git tags (Changesets does this natively when `publish`
   is configured via `changeset tag`).
2. Create a root catalog tag that matches the root `package.json` version.

Extend the workflow's `version` job:

```yaml
      - uses: changesets/action@v1
        with:
          version: pnpm apply:changesets
          publish: pnpm tag && git tag "v$(node -p "require('./package.json').version")" && git push --tags
          commit: 'chore: version packages'
          title: 'Version Packages'
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

`pnpm tag` is an alias for `changeset tag`, which reads the bumped
`package.json` files and creates `<packageName>@<version>` tags. The
additional `git tag v$(...)` creates the catalog tag that fires
`publish-release.yml`.

**Note:** `publish-release.yml` currently validates that the git tag version
matches the root `package.json` version. This will continue to work because:

- The "Version Packages" PR bumps the root `package.json` when any plugin
  bumps (because Changesets sees a workspace dependency chain or we configure
  the root to track bumps).
- Alternatively, the root `package.json` can be bumped explicitly by
  changesets once `yellow-plugins-root` is no longer in the `.changeset/config.json`
  `ignore` list — see Open Questions.

#### Step 3: Make `changeset-check` Blocking

In `.github/workflows/validate-schemas.yml`, the `changeset-check` job
currently prints `::warning::` messages and always exits 0. Change it to
`exit 1` when plugin files are modified without a changeset:

Before (line 748 in current file):

```yaml
            echo "::warning::This is advisory — the PR can still merge without a changeset."
```

After:

```yaml
            echo "::error::Plugin files were modified but no changeset file was found."
            echo "::error::Run 'pnpm changeset' and commit the resulting .changeset/*.md file."
            exit 1
```

Also add `changeset-check` to the `needs` list of the `ci-status` aggregator
job so branch protection rules see it as required.

The check already correctly skips PRs that only touch non-plugin files, and
skips the entire job on `push` to `main` (only runs on `pull_request`). Both
behaviors should be preserved.

**Escape hatch:** A PR that intentionally ships plugin changes without a
version bump (e.g. fixing CI YAML inside a plugin directory, updating
documentation only) can include a `.changeset/*.md` with type `patch` for
all affected plugins. Developers should not rely on the escape hatch for
real feature work.

#### Step 4: Update `.changeset/config.json` — Root Package Handling

Currently `config.json` lists `@yellow-plugins/cli`, `@yellow-plugins/domain`,
and `@yellow-plugins/infrastructure` in `ignore`. The root workspace package
(`yellow-plugins-root`) is not listed.

Two options:

**Option 4A:** Add `yellow-plugins-root` to `ignore` and manually bump the
root `package.json` version in the "Version Packages" PR script before creating
the catalog tag.

**Option 4B:** Remove `yellow-plugins-root` from `ignore` (or never add it)
and let changesets bump the root automatically as a side effect of any plugin
bump. This is the simpler path and aligns the catalog version with "something
changed."

Recommendation: Option 4B. The root is already `private: true` and has
`privatePackages.version: true` in config, so changesets will bump it
without trying to publish it to npm. The root version becoming `1.2.0`
when any plugin bumps is semantically correct — the catalog snapshot is new.

#### Step 5: Document the Developer Workflow

Add a `## Versioning` section to the root `CONTRIBUTING.md` (create it if
it does not exist) and to `docs/CLAUDE.md` (which Claude Code reads as context).

The section should cover:

1. **When to create a changeset:** Any PR that modifies files under `plugins/`
   that would affect plugin behavior, commands, agents, skills, or configuration
   schemas. Not required for pure documentation changes.

2. **How to create a changeset:**

   ```bash
   pnpm changeset
   # Prompts: select affected packages (e.g. yellow-core), pick patch/minor/major
   # Writes: .changeset/<auto-slug>.md
   # Commit the .changeset file alongside your other changes
   ```

3. **What happens on merge:**
   - The "Version Packages" workflow runs.
   - If changesets are pending: a "Version Packages" PR is created/updated.
   - On that PR merge: versions bump, manifests sync, git tags are created,
     GitHub Release is published.

4. **What patch / minor / major mean for plugins:**
   - `patch`: bug fix, documentation update, or minor command behavior fix
     that does not break existing usage.
   - `minor`: new command, new skill, new agent, or any additive change.
   - `major`: breaking change to a command's interface, removal of a command,
     or change that requires users to update their workflow.

5. **Manual release path (escape hatch):**

   ```bash
   pnpm apply:changesets   # local: bumps versions, syncs manifests
   git tag v<version>
   git push --tags
   ```

   This is for emergency releases when the automated pipeline is broken.

#### Step 6: Add `changelog` URL to `plugin.json` (Optional / Deferred)

Claude Code can display per-plugin changelogs if `plugin.json` includes a
`changelog` field pointing to the `CHANGELOG.md` on GitHub. Each plugin
already has a `CHANGELOG.md` generated by Changesets.

```json
{
  "changelog": "https://raw.githubusercontent.com/KingInYellows/yellow-plugins/main/plugins/yellow-core/CHANGELOG.md"
}
```

This is low-risk to add now and provides immediate UX value once GitHub #26744
is fixed. Defer only if it adds schema validation friction.

---

## Files That Change

| File | Change | Priority |
|------|--------|----------|
| `.github/workflows/version-packages.yml` | Create new | P0 — core automation |
| `.github/workflows/validate-schemas.yml` | Make `changeset-check` blocking, add to `ci-status` needs | P0 — enforcement |
| `.changeset/config.json` | Verify `yellow-plugins-root` is not ignored | P1 — catalog tag |
| `CONTRIBUTING.md` | Create or extend with versioning workflow | P1 — developer DX |
| `docs/CLAUDE.md` | Add changeset workflow summary | P2 — agent context |
| `plugins/*/plugin.json` | Add `changelog` URL field | P3 — deferred |

---

## The Known Bug and Its Implications

**GitHub issue #26744:** Claude Code's update detection compares the version
in the user's cached copy of `marketplace.json` against the version in the
remote `marketplace.json`. The comparison logic has a bug where it does not
trigger the update prompt even when versions differ.

**Implications for this implementation:**

- Version bumps are still worth doing. When the bug is fixed, any plugin
  whose remote version exceeds the user's cached version will prompt for an
  update. Plugins that never bumped will not benefit from the fix.
- Manual update (`/plugin marketplace update`) works correctly today. The bug
  only affects the automatic background check.
- The `plugin.json` version field (not just `marketplace.json`) may be the
  relevant field for cache invalidation — the exact mechanism is not fully
  documented. Keeping both in sync (as we already do) covers both cases.

**Workaround to document:** Users who want to receive updates can run
`/plugin marketplace update` after each release. The GitHub Release page
and per-plugin `CHANGELOG.md` are the canonical sources for "what changed."

**Do not block implementation on this bug.** The pipeline should be built
correctly now so it is ready when the bug is fixed.

---

## Developer Workflow Going Forward

### Normal Feature Development

```
1. Create a branch.
2. Make changes to plugins/<name>/ files.
3. Run: pnpm changeset
   → Select affected plugin packages.
   → Choose: patch / minor / major.
   → A .changeset/<slug>.md file is created.
4. Commit both your changes and the .changeset file.
5. Open a PR. CI checks:
   - validate-schemas (blocking)
   - validate-versions (blocking — three-way sync must hold)
   - changeset-check (now blocking — ensures .changeset file exists)
6. PR merges to main.
7. version-packages.yml runs:
   - If changesets pending: creates/updates "Version Packages" PR.
   - No changesets: exits silently.
8. When "Version Packages" PR merges:
   - Versions bumped in package.json files.
   - plugin.json and marketplace.json synced.
   - CHANGELOG.md entries written.
   - Per-plugin tags created (e.g. yellow-core@1.2.0).
   - Catalog tag created (e.g. v1.2.0).
   - publish-release.yml fires → GitHub Release published.
```

### Reviewing the "Version Packages" PR

The "Version Packages" PR is generated by the Changesets bot. Reviewers should:

- Check that the version bumps are correct (patch/minor/major) for each plugin.
- Verify `CHANGELOG.md` entries are coherent (they aggregate the `.changeset/*.md`
  summaries).
- Confirm `plugin.json` and `marketplace.json` versions match.

The PR can be held open to batch multiple feature PRs before releasing.

### Hotfix Releases

For urgent fixes that cannot wait for a batched release:

1. Merge the fix PR (which includes a changeset).
2. If the "Version Packages" PR is already open, it will be updated automatically.
3. Merge the "Version Packages" PR immediately.

For truly emergency releases without the automation:

```bash
pnpm apply:changesets
git add -A
git commit -m "chore: emergency version bump"
git push
git tag v<new-version>
git push --tags
```

---

## Open Questions / Risks

### Q1: Should the root package version be independently bumped by changesets?

Currently the root `package.json` is not in `config.json`'s `ignore` list,
but changesets may or may not bump it automatically depending on whether
workspace dependency relationships are configured.

**Risk:** If the root version is not bumped automatically, `pnpm tag` creates
per-plugin tags correctly but the `git tag v$(root version)` step creates a
duplicate tag on repeat runs.

**Resolution path:** Explicitly configure the root to bump via a dedicated
changeset entry, or add a script that derives the catalog version from the
highest-bumped plugin version.

### Q2: Does `changesets/action@v1` commit the `sync-manifests.js` output?

The action runs the `version` command, stages all changes, and commits them.
Since `sync-manifests.js` modifies `plugin.json` and `marketplace.json`,
those files will be in the working tree when the action commits. As long as
the script runs before the action's internal `git add`, the synced files
will be included in the "Version Packages" commit.

**Risk:** If `changesets/action@v1` stages files before running the `version`
command, or runs the command in a subprocess that writes to a different working
directory, the manifest files may be unstaged.

**Resolution path:** Test with a dry-run PR. If manifest files are not staged,
add a post-version step that explicitly runs `git add plugins/**/.claude-plugin/plugin.json .claude-plugin/marketplace.json`.

### Q3: Branch protection and the Changesets bot

GitHub's branch protection rules require passing status checks before merge.
The "Version Packages" PR is created by `github-actions[bot]`. If the branch
protection requires human review, the bot PR will be stuck.

**Resolution path:** Add a branch protection exception for `github-actions[bot]`
on the "Version Packages" PR, or configure a dedicated release bot account.
Alternatively, require one human approval on the "Version Packages" PR (which
provides a release review gate anyway).

### Q4: Handling the `yellow-devin` version discrepancy

`yellow-devin` is currently at `2.0.1` while all other plugins are at `1.1.0`.
This is intentional (it tracks the Devin API version independently). The
changeset pipeline will handle it correctly — each plugin bumps independently.

No action required. Document in the versioning guide that plugin versions are
independent and `2.x.x` for `yellow-devin` is expected.

### Q5: What happens to the `publish-release.yml` check that validates root version?

`publish-release.yml` line 87-93 currently checks that root `package.json`
version equals the git tag version. This check will pass as long as the
catalog tag is derived from the root version after the "Version Packages" PR
bumps it.

**Risk:** If changesets bumps plugins but not the root, the catalog tag
creation step (`git tag v$(root version)`) will tag the wrong version.

**Resolution path:** Same as Q1 — ensure the root is configured to bump with
each changeset cycle, or add an explicit root bump step.

### Q6: `ci-status` aggregator does not currently include `changeset-check`

Making `changeset-check` blocking at the job level is not enough if the
`ci-status` aggregator job (which branch protection rules poll) does not
include `changeset-check` in its `needs` list. The aggregator must be updated.

**Resolution path:** Confirmed fix in Step 3 above — add `changeset-check`
to the `needs` list of the `ci-status` job.

---

## Success Criteria

The implementation is complete when:

1. A PR that modifies `plugins/yellow-core/commands/review.md` without a
   `.changeset/*.md` file fails CI with a clear error message.
2. A PR that includes a `patch` changeset for `yellow-core` passes CI.
3. After that PR merges, a "Version Packages" PR is automatically opened with
   `yellow-core` bumped to `1.1.1`, `plugin.json` and `marketplace.json`
   updated, and a `CHANGELOG.md` entry written.
4. When the "Version Packages" PR merges, git tags `yellow-core@1.1.1` and
   `v1.1.1` (or the next catalog version) are created.
5. The `publish-release.yml` fires on the catalog tag and creates a GitHub Release.
6. `validate-versions.js` passes on the final state of `main`.
