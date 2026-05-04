# Feature: Plugin Versioning Automation

> **Status: Implemented** — Unified `version-packages.yml` workflow shipped (later refactored into single-workflow release pipeline via PR #160). Three-way sync via `scripts/sync-manifests.js`, catalog versioning via `scripts/catalog-version.js`, `validate-versions.js` for CI.

## Overview

Automate the version bump pipeline for the yellow-plugins monorepo so that
every merged plugin change results in a version bump that Claude Code can use
for update detection. Currently the Changesets toolchain is fully installed and
the three-way sync model (`package.json → plugin.json → marketplace.json`) is
working, but nothing triggers it automatically. This plan wires up the missing
automation with minimal new code.

Based on brainstorm: `docs/brainstorms/2026-03-03-plugin-versioning-strategy-brainstorm.md`
Research: `docs/research/claude-code-plugins-versioning-auto-upda.md`

---

## Problem Statement

Claude Code's plugin update mechanism compares the version in the user's cached
`plugin.json` against the remote `marketplace.json`. Without a version bump,
users never receive update notifications — even if new commands, skills, or bug
fixes have been shipped.

Currently:
- Developers can merge plugin changes without creating a changeset file.
- `changeset-check` CI job is **advisory only** (always exits 0, not in `ci-status`).
- No workflow runs `changeset version` automatically on merge to `main`.
- No per-plugin git tags are created after a version bump.
- The "Version Packages" PR pattern (standard Changesets automation) doesn't exist.

---

## Current State

### Three-Way Sync Model (Already Working Locally)

```
plugins/<name>/package.json        ← Changesets source of truth
  │ sync-manifests.js
  ▼
plugins/<name>/.claude-plugin/plugin.json   ← Claude Code reads this
  │ sync-manifests.js
  ▼
.claude-plugin/marketplace.json    ← Claude Code cache-invalidation key
```

### What Already Exists

| Artifact | Status |
|----------|--------|
| `@changesets/cli` installed | ✅ |
| `.changeset/config.json` | ✅ — `commit: false`, `privatePackages.version: true, tag: true` |
| `pnpm apply:changesets` script | ✅ — runs `changeset version && node scripts/sync-manifests.js` |
| `pnpm tag` script | ✅ — alias for `changeset tag` |
| `scripts/sync-manifests.js` | ✅ — atomic writes to plugin.json + marketplace.json |
| `scripts/validate-versions.js` | ✅ — blocking CI check, three-way drift detection |
| `changeset-check` CI job | ✅ — present but **non-blocking** (exits 0 always) |
| `validate-schemas.yml` → `ci-status` aggregator | ✅ — does NOT include `changeset-check` |
| `publish-release.yml` | ✅ — fires on `v*.*.*` tags |

### What Does Not Exist Yet

- `.github/workflows/version-packages.yml` — the Changesets automation workflow
- Per-plugin git tags (`yellow-core@1.2.0`) created automatically
- Blocking `changeset-check` enforcement
- Versioning developer documentation in `CONTRIBUTING.md`

---

## Implementation Plan

### Phase 1: CI Enforcement (Make Changeset-Check Blocking)

**Goal:** PRs that modify plugin files without a changeset file fail CI.

#### Task 1.1 — Promote `changeset-check` to blocking in `validate-schemas.yml`

File: `.github/workflows/validate-schemas.yml`

**Change the advisory warning block to an error block:**

Find the section (around line 748) that prints the warning and always exits 0:

```yaml
          echo "::warning::Plugin files changed but no .changeset/*.md file found."
          echo "::warning::Changed plugins: $(echo "$CHANGED_PLUGINS" | tr '\n' ' ')"
          echo "::warning::Run \`pnpm changeset\` to record the change type (patch/minor/major)."
          echo "::warning::This is advisory — the PR can still merge without a changeset."
```

Replace with:

```yaml
          echo "::error::Plugin files were modified but no .changeset/*.md file found."
          echo "::error::Changed plugins: $(echo "$CHANGED_PLUGINS" | tr '\n' ' ')"
          echo "::error::Run 'pnpm changeset' and commit the resulting .changeset/*.md file."
          echo "::error::See CONTRIBUTING.md#versioning for the developer workflow."
          exit 1
```

Keep the job name and `if: github.event_name == 'pull_request'` unchanged — this must never run on `push` to `main` (the "Version Packages" PR itself has no changeset file).

#### Task 1.2 — Add `changeset-check` to `ci-status` aggregator

File: `.github/workflows/validate-schemas.yml` (around line 852)

Add `changeset-check` to the `needs` array of the `ci-status` job:

```yaml
ci-status:
  name: CI Status Summary
  runs-on: ubuntu-latest
  if: always()
  needs:
    [
      validate-schemas,
      validate-versions,
      lint-and-typecheck,
      unit-tests,
      integration-tests,
      contract-drift,
      security-audit,
      build,
      changeset-check,    # ← add this
    ]
```

**Note:** Because `changeset-check` only runs on `pull_request` and `ci-status`
uses `if: always()`, the aggregator will correctly skip `changeset-check` on
push events without failing.

---

### Phase 2: Automation Workflow (Version Packages on Merge)

**Goal:** On every push to `main`, automatically create/update a "Version Packages" PR if pending changesets exist.

#### Task 2.1 — Create `.github/workflows/version-packages.yml`

```yaml
name: Version Packages

on:
  push:
    branches:
      - main

concurrency:
  group: version-packages
  cancel-in-progress: false  # Never cancel — partial PRs leave dirty state

permissions:
  contents: write
  pull-requests: write

jobs:
  version:
    name: Version or Publish
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          # Full history needed for changeset to read git log for changelogs
          fetch-depth: 0

      - uses: pnpm/action-setup@41ff72655975bd51cab0327fa583b6e92b6d3061
        with:
          version: '8.15.0'

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Create Version PR or Create Tags
        uses: changesets/action@v1
        with:
          # version: called when changesets are pending → bumps package.json files,
          # then sync-manifests.js propagates to plugin.json + marketplace.json.
          version: pnpm apply:changesets
          # publish: called when the Version Packages PR merges → creates per-plugin
          # tags (yellow-core@1.2.0) and catalog tag (v1.2.0) for publish-release.yml.
          publish: pnpm tag
          commit: 'chore: version packages'
          title: 'chore: version packages'
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Why `pnpm apply:changesets` as the `version` command?**
The default `version` command is just `changeset version`, which only bumps
`package.json`. Our `apply:changesets` script runs `changeset version &&
node scripts/sync-manifests.js`, ensuring `plugin.json` and `marketplace.json`
are updated in the same commit the action creates.

**Why `pnpm tag` as the `publish` command?**
`changeset tag` (aliased as `pnpm tag`) reads the bumped `package.json` files
and creates `<packageName>@<version>` git tags. Because `.changeset/config.json`
has `privatePackages.tag: true`, private packages (all our plugins) get tagged.
The `publish-release.yml` fires on `v*.*.*` tags — the root `package.json` tag.

#### Task 2.2 — Verify root package gets bumped

`.changeset/config.json` currently ignores:
- `@yellow-plugins/cli`
- `@yellow-plugins/domain`
- `@yellow-plugins/infrastructure`

The root workspace package (`yellow-plugins-root` or similar name) is **NOT** in
the ignore list. Confirm by checking `package.json` `name` field and verifying
it matches what Changesets uses.

If the root is not being bumped automatically (because no plugin has it as a
workspace dependency), add a one-time changeset at the same time as the first
real changeset to align the root version.

**Verification step (run locally before merging Phase 2):**
```bash
# Create a test changeset
echo '---
"yellow-core": patch
---
Test version bump.' > .changeset/test-bump.md

# Dry-run apply
pnpm changeset version --dry-run 2>&1 | grep -E "(yellow-core|yellow-plugins-root|version)"

# Clean up
rm .changeset/test-bump.md
```

---

### Phase 3: Documentation

**Goal:** Developers know exactly what to do and why.

#### Task 3.1 — Add versioning section to `CONTRIBUTING.md`

`CONTRIBUTING.md` already exists. Add a new `## Versioning` section after the
existing `## Pull Request Process` section:

```markdown
## Versioning

Yellow-plugins uses [Changesets](https://github.com/changesets/changesets) to
manage plugin versions. Every PR that modifies plugin files **must** include a
changeset file — CI will block the PR if one is missing.

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
   - `patch` — bug fix, behavior correction, documentation update
   - `minor` — new command, new skill, new agent, additive change
   - `major` — breaking change to a command's interface, removal of a command

This writes a `.changeset/<auto-slug>.md` file. Commit it alongside your changes.

### What happens on merge

1. The "Version Packages" workflow detects pending changesets.
2. A "Version Packages" PR is opened (or updated) that bumps versions in
   `package.json`, `plugin.json`, and `marketplace.json` files, and writes
   `CHANGELOG.md` entries.
3. When the "Version Packages" PR merges, git tags are created
   (e.g. `yellow-core@1.2.0`) and a GitHub Release is published.

### Reviewing the "Version Packages" PR

The PR is created by the Changesets bot. Before merging:
- Verify bump types are correct for each plugin.
- Check that `CHANGELOG.md` entries are coherent.
- Confirm `plugin.json` and `marketplace.json` versions match `package.json`.

The PR can be held open to batch multiple features before releasing.

### Emergency manual release

```bash
pnpm apply:changesets   # bumps versions + syncs manifests
git add -A
git commit -m "chore: version packages"
git push
git tag v<new-version>
git push --tags
```

### Note on auto-updates (GitHub issue #26744)

Claude Code's background auto-update check has a known bug where it does not
prompt users even when a newer version is available. Until fixed, users should
run `/plugin marketplace update` to fetch latest versions after a release.
Version bumps are still worth doing — they will be retroactively effective
once the bug is fixed.
```

#### Task 3.2 — Add versioning summary to `docs/CLAUDE.md`

Append a `## Versioning` section to `docs/CLAUDE.md` so Claude Code agents
have context when working in this repo:

```markdown
## Versioning

Plugin versions are managed with Changesets. The three-way sync model keeps
`package.json`, `.claude-plugin/plugin.json`, and `.claude-plugin/marketplace.json`
in lock-step.

**Always run `pnpm changeset` before committing plugin changes.** CI blocks PRs
that modify plugin files without a `.changeset/*.md` file.

**To apply pending changesets locally:** `pnpm apply:changesets`

**Version bump types:**
- `patch` — bug fix or documentation
- `minor` — new command/skill/agent
- `major` — breaking change or removal
```

---

### Phase 4: Verification (Post-Deploy Acceptance Tests)

Once all phases are merged, verify with these tests:

- [x] **Test 1 (blocking enforcement):** Open a PR that modifies
  `plugins/yellow-core/commands/review.md` with no `.changeset/*.md` file.
  CI `changeset-check` job should fail with `::error::` message. PR cannot merge.

- [x] **Test 2 (passing with changeset):** Add a `.changeset/test.md` with a
  `patch` bump for `yellow-core`. CI `changeset-check` should pass.

- [x] **Test 3 (Version Packages PR creation):** Merge the PR from Test 2 to
  `main`. Within minutes, `version-packages.yml` should open a PR titled
  "chore: version packages" with `yellow-core` bumped to `1.1.1`, `plugin.json`
  and `marketplace.json` updated.

- [x] **Test 4 (tags and release):** Merge the "Version Packages" PR. Verify:
  - Git tag `yellow-core@1.1.1` exists.
  - Root catalog tag `v<root-version>` exists.
  - `publish-release.yml` fires and creates a GitHub Release.

- [x] **Test 5 (three-way consistency):** `pnpm validate:versions` passes on
  the final state of `main`.

---

## Technical Details

### Files to Modify

| File | Change | Phase |
|------|--------|-------|
| `.github/workflows/validate-schemas.yml` | Make `changeset-check` exit 1 on failure; add to `ci-status` needs | 1 |
| `CONTRIBUTING.md` | Add `## Versioning` section | 3 |
| `docs/CLAUDE.md` | Add versioning summary | 3 |

### Files to Create

| File | Purpose | Phase |
|------|---------|-------|
| `.github/workflows/version-packages.yml` | Changesets automation workflow | 2 |

### No New Dependencies

All required tooling (`@changesets/cli`, `changesets/action@v1`) is already
installed or is a GitHub Action (no npm install needed).

---

## Edge Cases

### "Version Packages" PR conflicts with branch protection

If branch protection requires human approval and the bot PR is stuck, add a
branch protection exception for `github-actions[bot]`, or configure the PR to
require one human approval (which doubles as a release review gate).

### `sync-manifests.js` output not staged by `changesets/action`

The action runs the `version` command and then commits all changes. Since
`sync-manifests.js` writes to `plugin.json` and `marketplace.json` as part of
`apply:changesets`, these files should be in the working tree when the action
commits. If they are not included in the commit, add an explicit `git add`
before the action runs or verify with a dry-run first.

### Root package version coherence

The root `package.json` must be bumped for the `v*.*.*` catalog tag to be
meaningful to `publish-release.yml`. Verify that Changesets bumps the root
package automatically (it should, since it's not in the `ignore` list and has
`privatePackages.version: true`).

### `yellow-devin` at version `2.0.1`

All other plugins are at `1.1.0`. This is intentional — Changesets handles
independent per-plugin versions correctly. No action needed.

---

## Acceptance Criteria

1. A PR modifying any `plugins/*/` file without a `.changeset/*.md` file fails
   CI with a clear, actionable error message.
2. A PR with a valid changeset file passes CI.
3. On merge to `main`, a "Version Packages" PR is automatically created/updated
   when changesets are pending.
4. When the "Version Packages" PR merges, per-plugin git tags and a catalog tag
   are created, and `publish-release.yml` fires.
5. `pnpm validate:versions` passes on the final state of `main` after every release.
6. `CONTRIBUTING.md` has a clear versioning section that developers can follow
   without external documentation.

---

## References

- Brainstorm: `docs/brainstorms/2026-03-03-plugin-versioning-strategy-brainstorm.md`
- Research: `docs/research/claude-code-plugins-versioning-auto-upda.md`
- CI workflow: `.github/workflows/validate-schemas.yml` (lines 717-754 for `changeset-check`, 852-862 for `ci-status`)
- Changeset config: `.changeset/config.json`
- Sync script: `scripts/sync-manifests.js`
- Root scripts: `package.json` (`apply:changesets`, `tag`)
- Changesets action: [github.com/changesets/action](https://github.com/changesets/action)
- Known bug: [github.com/anthropics/claude-code/issues/26744](https://github.com/anthropics/claude-code/issues/26744)
