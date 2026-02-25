---
title: "feat: Per-Plugin Versioning with Changesets + Catalog Release"
type: feat
date: 2026-02-23
deepened: 2026-02-23
brainstorm: docs/brainstorms/2026-02-23-plugin-versioning-brainstorm.md
---

# feat: Per-Plugin Versioning with Changesets + Catalog Release

## Enhancement Summary

**Deepened on:** 2026-02-23
**Research agents used:** 8 parallel (best-practices ×2, architecture, silent-failure-hunter, spec-flow-analyzer, security-sentinel, solutions-learnings, codebase-explorer)
**Sections enhanced:** All phases + risk table + open questions

### Critical Findings (Must Fix Before Implementation)

1. **`import.meta.dirname` incompatible with Node 20 LTS** — CI runner uses Node 20; `import.meta.dirname` requires Node 21.2+. Use `fileURLToPath(new URL('.', import.meta.url))` instead. Without this fix, Phase 2 will fail on every CI run.
2. **`privatePackages: { version: true, tag: true }` is required** in `.changeset/config.json` — without it, `private: true` packages are silently excluded from all version bumps. The plan omits this critical flag.
3. **`"changelog"` field will likely be rejected by Claude Code's remote validator** — `additionalProperties: false` in Claude Code's remote schema is known to reject unrecognized fields. Test on a fresh install before Phase 3 merges.
4. **`sync-manifests.js` has multiple silent failure modes** — the broad `catch { }` block can silently write `undefined` versions to `plugin.json` while logging a success message. Partial state corruption is possible on mid-loop failure.
5. **Missing explicit commit step in developer workflow** — `pnpm version` does not auto-commit (because `commit: false` in config). The workflow shows `pnpm version` then `git tag` with no `git add` / `gt modify -c` between them.
6. **`pnpm -r publish` in `publish-release.yml` will attempt to publish all 11 private plugin packages** after Phase 1 — `private: true` should skip them in pnpm 8 but this interaction is undocumented in the plan and should be explicitly verified.

### Key Improvements Over Original Plan

- Complete `.changeset/config.json` with `privatePackages`, `ignore` array for tooling packages
- Hardened `sync-manifests.js` with path traversal protection, atomic writes, semver validation
- `validate-versions.js` as a standalone Node.js script (not just a CI job description)
- `generate-release-notes.js` to replace fragile `awk` changelog extraction
- Upgrade `pnpm/action-setup@v2` → `@v4` across all workflows
- Warning-only changeset check with `continue-on-error: true` (not blocking)
- Developer workflow with the missing commit step
- Semver bump decision table (needed before Phase 1, not Phase 4)

### New Considerations Discovered

- `RULE 6` already exists in `validate-marketplace.js` — extend it rather than creating a separate CI job
- RULE 6 currently only checks `marketplace.json` vs `plugin.json`; the new three-way check adds `package.json`
- `pnpm version` script name shadows pnpm built-in — consider renaming to `apply:changesets`
- Initial plugin `CHANGELOG.md` files should use changesets auto-format (just a title line), not Keep-a-Changelog
- All new files created on WSL2 get CRLF — run `sed -i 's/\r$//'` after every Write-tool file creation
- `pnpm-lock.yaml` must be regenerated and committed in the Phase 1 PR

---

## Overview

Add a proper versioning system to yellow-plugins: each of the 11 plugins gets its own version lifecycle driven by `@changesets/cli`, while the monorepo keeps a single catalog release tag (`v1.x.x`) that builds one tarball and one GitHub Release.

**The core gap today:** Versions exist in `plugin.json` and `marketplace.json` but there is no tooling, process, or enforcement for when/how to bump them. The release infrastructure has never fired (no git tags). This plan closes that gap.

### Research Insights: Current State

**Confirmed via codebase exploration:**

- Root `package.json` is at `1.1.0` but has NO `@changesets/cli` or versioning scripts — clean slate
- `pnpm-workspace.yaml` does NOT include `plugins/*` — plugins are not workspace packages today
- No plugin directory has a `package.json` file
- `CHANGELOG.md` has only a `[1.0.0]` entry; root is already `1.1.0` — gap confirmed
- **RULE 6 already exists** in `validate-marketplace.js` (lines 240-286) — already checks `marketplace.json` vs `plugin.json` version consistency. The plan should extend RULE 6 rather than creating a parallel check from scratch.
- `plugin.schema.json` has `additionalProperties: false` — any new field (including `version` if not already there, `changelog`) requires a schema change first
- `pnpm/action-setup@v2` in both workflows — outdated; upgrade to `@v4`

---

## Problem Statement

1. **No process for bumping versions** — developers don't know when or how to update `plugin.json` versions.
2. **No per-plugin changelogs** — users get no "what changed" context when Claude Code detects an update.
3. **Version drift is possible** — `plugin.json` and `marketplace.json` can diverge; only caught by `validate-marketplace.js` RULE 6 (which exists but isn't enough without Changesets tracking intent).
4. **Root version already drifted** — `package.json` is at `1.1.0` but `CHANGELOG.md` only has a `1.0.0` entry; `publish-release.yml` would fail today.
5. **No git tags** — the release workflow has never been exercised.

---

## Proposed Solution

Install `@changesets/cli`, add a thin `package.json` to each plugin directory (pnpm workspace), and wire up a `scripts/sync-manifests.js` bridge that propagates Changesets-bumped versions into `plugin.json` and `marketplace.json`. CI gets a new `validate-versions` job (by extending RULE 6). The existing single-tag release model is preserved.

**Developer workflow after this lands:**

```sh
# 1. When making changes to a plugin, record intent
pnpm changeset
# → CLI prompts: which plugins changed? patch/minor/major? Summary?
# → Creates .changeset/silver-dogs-eat.md

# 2. Commit the changeset file
gt modify -c -m "chore: add changeset for yellow-devin minor update"

# 3. On PR merge to main, accumulate. When ready to release, apply changesets:
pnpm apply:changesets          # ← renamed from "version" to avoid pnpm built-in shadow
# → Runs: changeset version + scripts/sync-manifests.js
# → Bumps plugins/yellow-devin/package.json from 2.0.0 → 2.1.0
# → Writes plugins/yellow-devin/CHANGELOG.md entry
# → Syncs plugins/yellow-devin/.claude-plugin/plugin.json version
# → Syncs .claude-plugin/marketplace.json yellow-devin entry

# 4. Commit the version bumps + lockfile update
pnpm install   # regenerate lockfile after package.json version changes
gt modify -c -m "chore(release): version packages"

# 5. Cut a catalog release (when ready to publish)
pnpm catalog:version minor   # bumps root package.json 1.1.0 → 1.2.0
gt modify -c -m "chore(release): bump catalog to v1.2.0"
git tag v1.2.0 && git push --tags
# → publish-release.yml fires, builds tarball, creates GitHub Release
```

### Research Insights: Script Name Collision

`pnpm version` (a script named `"version"` in `package.json`) shadows the `pnpm version` built-in command in pnpm 8. While pnpm 8 prioritizes scripts over built-ins, this creates confusion when a developer runs `pnpm version 1.2.0` expecting npm-style version bumping — it passes `1.2.0` as an argument to `changeset version`, which ignores it silently. **Recommendation:** Rename the script to `apply:changesets`:

```json
"apply:changesets": "changeset version && node scripts/sync-manifests.js"
```

---

## Technical Approach

### Architecture

```
yellow-plugins/
├── .changeset/
│   └── config.json                ← NEW: changeset config (see complete config below)
├── package.json                   ← EDIT: add @changesets/cli, new scripts
├── pnpm-workspace.yaml            ← EDIT: add plugins/*/
├── scripts/
│   ├── sync-manifests.js          ← NEW: syncs package.json → plugin.json + marketplace.json
│   ├── catalog-version.js         ← NEW: bumps root package.json + marketplace.json metadata.version
│   ├── validate-versions.js       ← NEW: standalone three-way version check script
│   ├── generate-release-notes.js  ← NEW: replaces awk changelog extraction in CI
│   └── validate-marketplace.js    ← EDIT: extend RULE 6 to three-way check + add RULE 7
├── schemas/
│   └── plugin.schema.json         ← EDIT: add optional "changelog" string property
├── plugins/
│   └── <name>/
│       ├── package.json           ← NEW ×11: private workspace package, mirrors plugin.json version
│       ├── CHANGELOG.md           ← NEW ×11: changesets auto-format (title-only seed)
│       └── .claude-plugin/
│           └── plugin.json        ← EDIT ×11: add "changelog" URL field (Phase 3, pending validator test)
├── CHANGELOG.md                   ← EDIT: add 1.1.0 entry, repurpose as catalog release notes
├── docs/operations/
│   ├── release-checklist.md       ← EDIT: update with Changesets workflow + explicit commit steps
│   └── versioning.md              ← NEW: semver rules + decision table (Phase 1, not Phase 4)
└── .github/workflows/
    ├── validate-schemas.yml        ← EDIT: extend RULE 6, upgrade pnpm/action-setup@v4
    └── publish-release.yml         ← EDIT: add sync-manifests --verify step, upgrade pnpm/action-setup@v4,
                                              replace awk with generate-release-notes.js
```

### Research Insights: Two-Validator Problem

Adding `"changelog"` and `"version"` fields to `plugin.json` faces the documented two-validator problem:

1. **Local CI (AJV strict):** Adding the field to `schemas/plugin.schema.json` + ensuring `-c ajv-formats` is passed for `format: "uri"` — already solved in PR #21 pattern.
2. **Claude Code remote validator:** Uses its own schema. Known to reject unknown keys (`additionalProperties: false`). The `changelog` field may not be in Claude Code's schema.

**Gating criterion for Phase 3:** Before merging the `"changelog"` field into `plugin.json`, test `plugin marketplace add KingInYellows/yellow-plugins` on a fresh machine with a modified `plugin.json`. If Claude Code rejects it, scope Phase 3 to CHANGELOG.md file creation only and keep `"changelog"` out of `plugin.json`.

---

### Implementation Phases

#### Phase 1: Workspace Foundation

**Goal:** Register plugins as pnpm workspace packages, install Changesets. No functional change yet.

**Tasks:**

- [ ] **Create `plugins/<name>/package.json` for all 11 plugins** — `private: true`, `name` matches plugin name, `version` matches current `plugin.json` version. All 11 files + the `pnpm-workspace.yaml` edit MUST be committed together in one commit to prevent broken `pnpm install` states.

  ```json
  {
    "name": "yellow-devin",
    "version": "2.0.0",
    "private": true,
    "description": "Devin AI integration for Claude Code"
  }
  ```

  Plugin versions:
  - gt-workflow@1.0.0
  - yellow-browser-test@1.0.0
  - yellow-chatprd@1.0.0
  - yellow-ci@1.0.0
  - yellow-core@1.0.0
  - yellow-debt@1.0.0
  - yellow-devin@2.0.0
  - yellow-linear@1.0.0
  - yellow-research@1.0.0
  - yellow-review@1.0.0
  - yellow-ruvector@1.0.0

- [ ] **Update `pnpm-workspace.yaml`** — add `'plugins/*'` to packages array:
  ```yaml
  packages:
    - 'packages/cli'
    - 'packages/domain'
    - 'packages/infrastructure'
    - 'scripts'
    - 'plugins/*'
  ```

- [ ] **Install `@changesets/cli` and `@changesets/changelog-github`** as root devDependencies:
  ```sh
  pnpm add -Dw @changesets/cli @changesets/changelog-github
  ```

- [ ] **Initialize Changesets** — create `.changeset/config.json` with the complete configuration:

  ```json
  {
    "$schema": "https://unpkg.com/@changesets/config/schema.json",
    "changelog": ["@changesets/changelog-github", { "repo": "KingInYellows/yellow-plugins" }],
    "commit": false,
    "fixed": [],
    "linked": [],
    "access": "restricted",
    "baseBranch": "main",
    "updateInternalDependencies": "patch",
    "ignore": [
      "@yellow-plugins/cli",
      "@yellow-plugins/domain",
      "@yellow-plugins/infrastructure"
    ],
    "privatePackages": {
      "version": true,
      "tag": true
    }
  }
  ```

  **Critical:** `privatePackages.version: true` is required. Without it, all 11 `"private": true` plugin packages are silently excluded from every version bump — the entire Changesets integration becomes a no-op. The `ignore` array prevents the internal tooling packages (`packages/*`) from appearing in the changeset interactive prompt.

  **Note:** `"access": "restricted"` is an npm registry directive (no npm publish attempted). The `privatePackages.tag: true` creates git tags without publishing.

- [ ] **Add scripts to root `package.json`**:
  ```json
  "changeset": "changeset",
  "apply:changesets": "changeset version && node scripts/sync-manifests.js",
  "tag": "changeset tag",
  "catalog:version": "node scripts/catalog-version.js",
  "validate:versions": "node scripts/validate-versions.js",
  "validate:versions:dry": "node scripts/validate-versions.js --dry-run"
  ```

- [ ] **Create `docs/operations/versioning.md`** — developer guide with semver decision table. **This must be created in Phase 1, not Phase 4.** Developers cannot use `pnpm changeset` correctly without the bump rules.

  Semver decision table:
  | Change type | Bump |
  |---|---|
  | Bug fix, typo correction, internal refactor (no behavior change) | patch |
  | New command, new agent, new skill, new MCP server added | minor |
  | Existing command renamed or removed | major |
  | Existing command argument changed (breaking) | major |
  | Existing command argument added (additive) | minor |
  | `plugin.json` metadata only (`description`, `changelog`, `homepage`) | patch |
  | `CLAUDE.md` update, documentation only | patch |
  | Permission scope added to `plugin.json` | minor |

- [ ] **Regenerate `pnpm-lock.yaml`** — run `pnpm install` after all 11 `package.json` files are created and commit the updated lockfile in the same PR. CI uses `--frozen-lockfile`; a stale lockfile will fail every CI run.

- [ ] **CRLF normalization** — on WSL2, all files created via the Write tool get CRLF. After creating any new file, run `sed -i 's/\r$//' <path>` before staging.

- [ ] **Upgrade `pnpm/action-setup@v2` to `@v4`** in both `validate-schemas.yml` and `publish-release.yml`. The v2 version is outdated and misses compatibility improvements and auto-`packageManager` detection:

  ```yaml
  # Before
  - uses: pnpm/action-setup@v2
    with:
      version: '8'

  # After
  - uses: pnpm/action-setup@v4
    # version derived automatically from packageManager in package.json

  - uses: actions/setup-node@v4
    with:
      node-version: ${{ env.NODE_VERSION }}
      cache: 'pnpm'   # handles pnpm store caching automatically
  ```

**Validation:** `pnpm install` succeeds, `pnpm list -r` shows all 11 plugins, `pnpm changeset --help` works, `pnpm changeset` interactive prompt lists plugin names but NOT `@yellow-plugins/cli`, `@yellow-plugins/domain`, or `@yellow-plugins/infrastructure`.

#### Phase 2: Sync Bridge + CI Enforcement

**Goal:** `pnpm apply:changesets` keeps all three version sources in sync. CI blocks drift.

**Tasks:**

- [ ] **Create `scripts/sync-manifests.js`** — reads all `plugins/*/package.json` versions, updates corresponding `plugin.json` and `marketplace.json` entries. The script must be written with hardened error handling, path validation, and atomic writes:

  ```js
  // scripts/sync-manifests.js
  // Syncs plugins/*/package.json versions → plugin.json + marketplace.json
  // Run after: changeset version (via pnpm apply:changesets)
  // Supports: --dry-run (report drift without writing), --verify (alias for --dry-run)

  import { readFileSync, writeFileSync, readdirSync, renameSync, statSync } from 'fs';
  import { join, resolve } from 'path';
  import { fileURLToPath } from 'url';

  // NOTE: import.meta.dirname requires Node 21.2+ but CI runs Node 20 LTS.
  // Use fileURLToPath instead:
  const __dirname = fileURLToPath(new URL('.', import.meta.url));
  const ROOT = resolve(__dirname, '..');
  const PLUGINS_DIR = join(ROOT, 'plugins');
  const MARKETPLACE_PATH = join(ROOT, '.claude-plugin', 'marketplace.json');

  const DRY_RUN = process.argv.includes('--dry-run') || process.argv.includes('--verify');
  const SEMVER_RE = /^\d+\.\d+\.\d+$/;

  function assertWithinRoot(filePath, rootDir) {
    const canonical = resolve(filePath);
    if (!canonical.startsWith(resolve(rootDir) + '/')) {
      throw new Error(`Path traversal detected: ${filePath}`);
    }
  }

  function atomicWrite(filePath, content) {
    const tmp = filePath + '.tmp';
    writeFileSync(tmp, content, 'utf8');
    renameSync(tmp, filePath);   // atomic on Linux (same filesystem)
  }

  // --- Collect plugin versions ---
  const pluginVersions = {};
  let dirCount = 0;

  for (const name of readdirSync(PLUGINS_DIR)) {
    // Reject suspicious directory names (path traversal guard)
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      console.warn(`[sync-manifests] Skipping suspicious directory name: ${name}`);
      continue;
    }

    const pluginPath = join(PLUGINS_DIR, name);

    // Skip non-directories
    if (!statSync(pluginPath).isDirectory()) continue;
    dirCount++;

    const pkgPath = join(PLUGINS_DIR, name, 'package.json');
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') {
        // Not a plugin directory — expected for dirs without package.json
        continue;
      }
      // Real error: bad JSON, permission denied, etc.
      console.error(`[sync-manifests] Error reading ${pkgPath}: ${e.message}`);
      process.exit(1);
    }

    if (typeof pkg.version !== 'string' || !SEMVER_RE.test(pkg.version)) {
      console.error(`[sync-manifests] Invalid or missing version in ${pkgPath}: "${pkg.version}"`);
      process.exit(1);
    }

    pluginVersions[name] = pkg.version;
  }

  // Count assertion: derive expected count from marketplace.json, not hardcoded
  const marketplace = (() => {
    try {
      return JSON.parse(readFileSync(MARKETPLACE_PATH, 'utf8'));
    } catch (e) {
      console.error(`[sync-manifests] Cannot read marketplace.json: ${e.message}`);
      process.exit(1);
    }
  })();

  const expectedCount = marketplace.plugins.length;
  const foundCount = Object.keys(pluginVersions).length;
  if (foundCount < expectedCount) {
    console.error(
      `[sync-manifests] Expected ${expectedCount} plugins (from marketplace.json), found only ${foundCount}. ` +
      `Check for missing package.json files.`
    );
    process.exit(1);
  }

  // --- Sync plugin.json files ---
  let syncedPlugins = 0;
  for (const [name, version] of Object.entries(pluginVersions)) {
    const manifestPath = join(PLUGINS_DIR, name, '.claude-plugin', 'plugin.json');
    assertWithinRoot(manifestPath, PLUGINS_DIR);

    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (e) {
      console.error(`[sync-manifests] Cannot read plugin.json for ${name}: ${e.message}`);
      process.exit(1);
    }

    if (manifest.version !== version) {
      console.log(`${DRY_RUN ? '[DRY RUN] Would sync' : 'Synced'} ${name} plugin.json: ${manifest.version} → ${version}`);
      if (!DRY_RUN) {
        manifest.version = version;
        atomicWrite(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
      }
      syncedPlugins++;
    }
  }

  // --- Sync marketplace.json ---
  let syncedMarketplace = 0;
  for (const plugin of marketplace.plugins) {
    const version = pluginVersions[plugin.name];
    if (version === undefined) {
      console.error(
        `[sync-manifests] Marketplace plugin "${plugin.name}" has no corresponding plugins/ directory. ` +
        `Either add the directory or remove the marketplace entry.`
      );
      process.exit(1);
    }
    if (plugin.version !== version) {
      console.log(`${DRY_RUN ? '[DRY RUN] Would sync' : 'Synced'} marketplace.json ${plugin.name}: ${plugin.version} → ${version}`);
      if (!DRY_RUN) {
        plugin.version = version;
        syncedMarketplace++;
      }
    }
  }

  if (!DRY_RUN && syncedMarketplace > 0) {
    atomicWrite(MARKETPLACE_PATH, JSON.stringify(marketplace, null, 2) + '\n');
  }

  console.log(`[sync-manifests] ${DRY_RUN ? 'Dry run complete' : 'Complete'}: ${foundCount} plugins checked, ${syncedPlugins} plugin.json synced, ${syncedMarketplace} marketplace entries synced`);
  ```

- [ ] **Create `scripts/catalog-version.js`** — bumps root `package.json` version and `marketplace.json metadata.version`. Validate both input and output:

  ```js
  // scripts/catalog-version.js
  // Usage: node scripts/catalog-version.js [patch|minor|major]
  // Bumps root package.json version + marketplace.json metadata.version

  import { readFileSync } from 'fs';
  import { fileURLToPath } from 'url';
  import { join, resolve } from 'path';
  import semver from 'semver';

  const __dirname = fileURLToPath(new URL('.', import.meta.url));
  const ROOT = resolve(__dirname, '..');

  const bumpType = process.argv[2];
  const VALID_BUMP_TYPES = ['patch', 'minor', 'major'];
  if (!bumpType || !VALID_BUMP_TYPES.includes(bumpType)) {
    console.error(`[catalog-version] Usage: node scripts/catalog-version.js [patch|minor|major]`);
    console.error(`[catalog-version] Received: "${bumpType}"`);
    process.exit(1);
  }

  const pkgPath = join(ROOT, 'package.json');
  const marketplacePath = join(ROOT, '.claude-plugin', 'marketplace.json');

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const currentVersion = pkg.version;

  if (!semver.valid(currentVersion)) {
    console.error(`[catalog-version] Invalid current version in package.json: "${currentVersion}"`);
    process.exit(1);
  }

  const newVersion = semver.inc(currentVersion, bumpType);
  if (!newVersion) {
    console.error(`[catalog-version] semver.inc returned null for version="${currentVersion}", type="${bumpType}"`);
    process.exit(1);
  }

  // Write root package.json
  pkg.version = newVersion;
  const { writeFileSync, renameSync } = await import('fs');
  const tmpPkg = pkgPath + '.tmp';
  writeFileSync(tmpPkg, JSON.stringify(pkg, null, 2) + '\n');
  renameSync(tmpPkg, pkgPath);
  console.log(`[catalog-version] Root package.json: ${currentVersion} → ${newVersion}`);

  // Write marketplace.json
  const marketplace = JSON.parse(readFileSync(marketplacePath, 'utf8'));
  marketplace.metadata.version = newVersion;
  const tmpMkt = marketplacePath + '.tmp';
  writeFileSync(tmpMkt, JSON.stringify(marketplace, null, 2) + '\n');
  renameSync(tmpMkt, marketplacePath);
  console.log(`[catalog-version] marketplace.json metadata.version: → ${newVersion}`);
  ```

- [ ] **Create `scripts/validate-versions.js`** — standalone three-way consistency check used by CI and pre-flight gates:

  ```js
  // scripts/validate-versions.js
  // Validates package.json ↔ plugin.json ↔ marketplace.json version consistency
  // Exit 0 = all consistent; Exit 1 = drift detected
  // Flags: --dry-run (report without failing), --plugin <path> (single plugin)

  'use strict';
  const fs = require('fs');
  const path = require('path');

  const ROOT = process.cwd();
  const args = process.argv.slice(2);
  const DRY_RUN = args.includes('--dry-run');
  const PLUGIN_FLAG_IDX = args.indexOf('--plugin');
  const SINGLE_PLUGIN = PLUGIN_FLAG_IDX !== -1 ? args[PLUGIN_FLAG_IDX + 1] : null;

  if (PLUGIN_FLAG_IDX !== -1 && (!SINGLE_PLUGIN || SINGLE_PLUGIN.startsWith('--'))) {
    console.error('[validate-versions] Error: --plugin requires a path argument');
    process.exit(1);
  }

  const errors = [];

  function fail(msg) {
    errors.push(msg);
    console.error(`[validate-versions] ERROR: ${msg}`);
  }

  function readJSON(filePath) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      fail(`Cannot read/parse ${filePath}: ${e.message}`);
      return null;
    }
  }

  const marketplace = readJSON(path.join(ROOT, '.claude-plugin', 'marketplace.json'));
  if (!marketplace) process.exit(1);

  const marketplaceVersions = {};
  for (const entry of (marketplace.plugins || [])) {
    if (entry.name && entry.version) marketplaceVersions[entry.name] = entry.version;
  }

  let pluginManifests = [];
  if (SINGLE_PLUGIN) {
    pluginManifests = [path.resolve(SINGLE_PLUGIN)];
  } else {
    const pluginsDir = path.join(ROOT, 'plugins');
    if (fs.existsSync(pluginsDir)) {
      for (const name of fs.readdirSync(pluginsDir)) {
        const mp = path.join(pluginsDir, name, '.claude-plugin', 'plugin.json');
        if (fs.existsSync(mp)) pluginManifests.push(mp);
      }
    }
  }

  let checkedCount = 0;
  for (const manifestPath of pluginManifests) {
    const pluginDir = path.dirname(path.dirname(manifestPath));
    const pluginManifest = readJSON(manifestPath);
    if (!pluginManifest) continue;

    const { name: pluginName, version: pluginJsonVersion } = pluginManifest;
    if (!pluginName) { fail(`plugin.json at ${manifestPath} missing "name" field`); continue; }

    // plugin.json vs marketplace.json
    const mktVersion = marketplaceVersions[pluginName];
    if (mktVersion === undefined) {
      fail(`Plugin "${pluginName}" not in marketplace.json — has sync-manifests.js been run?`);
    } else if (pluginJsonVersion && mktVersion !== pluginJsonVersion) {
      fail(`Drift for "${pluginName}": plugin.json=${pluginJsonVersion}, marketplace.json=${mktVersion}`);
    }

    // plugin.json vs package.json (if present)
    const pkgPath = path.join(pluginDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = readJSON(pkgPath);
      if (pkg && pkg.version && pluginJsonVersion && pkg.version !== pluginJsonVersion) {
        fail(`Drift for "${pluginName}": package.json=${pkg.version}, plugin.json=${pluginJsonVersion}`);
      } else if (pkg && pkg.version && !pluginJsonVersion) {
        fail(`Drift for "${pluginName}": package.json=${pkg.version}, plugin.json has no version field — run sync-manifests.js`);
      }
    }

    checkedCount++;
  }

  console.log(`[validate-versions] Checked ${checkedCount} plugin(s), ${errors.length} error(s)`);
  if (errors.length > 0 && !DRY_RUN) process.exit(1);
  ```

- [ ] **Extend RULE 6 in `validate-marketplace.js`** to three-way check (`package.json == plugin.json == marketplace.json`). Add RULE 7: fail if any plugin directory has a `package.json` but no corresponding `marketplace.json` entry. Update RULE 6 to use the same logic as `validate-versions.js` to avoid parallel divergent implementations.

- [ ] **Add `validate-versions` job to `.github/workflows/validate-schemas.yml`** — sequential job (not matrix), targeting under 5 seconds:

  ```yaml
  validate-versions:
    name: Version Sync Check
    runs-on: self-hosted
    timeout-minutes: 2
    needs: []  # Runs in parallel with other validation jobs
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install ${PNPM_INSTALL_FLAGS}

      - name: Validate version consistency
        run: node scripts/validate-versions.js
  ```

  Add `validate-versions` to the `needs:` list of the `ci-status` gate job.

- [ ] **Add warning-only changeset check** — a separate CI job that warns on PRs without changesets but never blocks:

  ```yaml
  changeset-check:
    name: Changeset Status (Advisory)
    runs-on: self-hosted
    continue-on-error: true   # Warning-only — never blocks PR merge
    if: |
      !startsWith(github.head_ref, 'changeset-release/')
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - name: Check for changeset (informational)
        run: |
          if pnpm changeset status --since=origin/main 2>&1; then
            echo "::notice::Changeset found for this PR"
          else
            echo "::warning::No changeset found. If this PR changes plugin behavior, run: pnpm changeset"
          fi
  ```

- [ ] **Fix current version drift** — add `## [1.1.0] - 2026-02-23` entry to root `CHANGELOG.md` so `publish-release.yml` awk extraction works for a `v1.1.0` tag.

**Validation:** `pnpm changeset` → select yellow-ci, patch, "fix typo" → `.changeset/*.md` created. `pnpm apply:changesets` → `plugins/yellow-ci/package.json` bumps to `1.0.1`, `plugin.json` and `marketplace.json` sync. `pnpm validate:schemas` passes. `node scripts/validate-versions.js` exits 0.

### Research Insights: sync-manifests.js Error Handling

The original plan code has 4 P1-severity silent failure modes (confirmed by silent-failure-hunter agent):

1. **`catch { }` in version collection loop** silently stores `undefined` in `pluginVersions` when a `package.json` has a JSON syntax error or missing `version` field. Downstream writes serialize `"version": undefined` as `null` in JSON while logging a "success" message.
2. **No error handling on `plugin.json` reads** — if any `plugin.json` is unreadable, the script throws an unhandled exception mid-loop, leaving some `plugin.json` files updated and others not.
3. **Non-atomic `writeFileSync` on `marketplace.json`** — truncation then write; if the process is killed between steps, `marketplace.json` is left as empty or truncated JSON (invalid). Use temp-file-then-rename pattern.
4. **`if (version && plugin.version !== version)`** — treats `undefined` the same as "no package.json", silently skipping a plugin that failed to parse. Use explicit `=== undefined` check.

The hardened script above addresses all four.

#### Phase 3: Per-Plugin Changelogs + Schema Update

**Goal:** Claude Code can surface per-plugin update notes. Each plugin has a changelog file.

**Prerequisites:** Verify empirically that Claude Code reads and displays the `changelog` URL field before merging this phase. Test on a fresh machine with `plugin marketplace add KingInYellows/yellow-plugins`. If Claude Code rejects the `changelog` field as an unknown key, scope Phase 3 to CHANGELOG.md file creation only (still valuable for GitHub browsing) and defer the `plugin.json` field.

**Tasks:**

- [ ] **Create `plugins/<name>/CHANGELOG.md` for all 11 plugins** — use changesets auto-format (NOT Keep-a-Changelog). The initial seed file should be minimal; `changeset version` will prepend entries automatically on first run:

  ```markdown
  # yellow-devin
  ```

  > **Do not add manual `## [x.y.z]` entries in Keep-a-Changelog style.** Changesets generates its own format when `changeset version` runs. Mixing styles creates visual inconsistency that confuses maintainers.

  The root `CHANGELOG.md` at the repo root should KEEP the Keep-a-Changelog format (it's written manually as catalog release notes, not by changesets).

- [ ] **Update `schemas/plugin.schema.json`** — add optional `changelog` string property with `format: "uri"` and domain restriction pattern. The `ajv-formats` library is already installed (see AJV strict mode solution); the `-c ajv-formats` flag must be present in every CI invocation of `ajv validate --strict=true`:

  ```json
  "changelog": {
    "type": "string",
    "format": "uri",
    "pattern": "^https://github\\.com/KingInYellows/yellow-plugins/blob/main/plugins/[a-zA-Z0-9_-]+/CHANGELOG\\.md$",
    "description": "URL to the plugin's CHANGELOG.md on GitHub"
  }
  ```

  The pattern restriction prevents arbitrary URLs from being placed in the field (security L2 finding).

- [ ] **Add `changelog` field to all 11 `plugin.json` files** (conditional on Phase 3 validator test passing):
  ```json
  "changelog": "https://github.com/KingInYellows/yellow-plugins/blob/main/plugins/yellow-devin/CHANGELOG.md"
  ```

- [ ] **Update `sync-manifests.js`** — add the `changelog` URL to the set of fields the sync script preserves (it should not overwrite or delete the `changelog` field when syncing versions).

- [ ] **Update root `CHANGELOG.md`** — add a header clarifying it is catalog-level release notes. Per-plugin changelogs live in `plugins/<name>/CHANGELOG.md`.

**Validation:** `pnpm validate:schemas` passes with new `changelog` field. All 11 plugin.json files have valid URLs matching the pattern. **Critical:** test `plugin marketplace add` on a fresh machine before merging.

### Research Insights: CHANGELOG.md Format

The auto-generated format by `@changesets/changelog-github` produces:

```markdown
# yellow-core

## 1.3.0

### Minor Changes

- abc1234: Add workflows:brainstorm command ([#45](https://github.com/...)) (@your-handle)
```

This is NOT Keep-a-Changelog format. Do not put initial `## [1.0.0] - 2026-02-18` entries in the plugin CHANGELOG files — they will conflict visually with future auto-generated entries.

#### Phase 4: Release Workflow Integration

**Goal:** The release workflow verifies version consistency; developer docs are updated.

**Tasks:**

- [ ] **Update `publish-release.yml`** — multiple changes:

  1. Add `--verify` step after checkout: `node scripts/sync-manifests.js --verify` to confirm no drift exists at tag time (exits 1 if any mismatch detected)
  2. Replace the awk changelog extraction with `scripts/generate-release-notes.js` which can include per-plugin excerpts
  3. Validate `workflow_dispatch.inputs.version` format before using it in shell commands:
     ```bash
     if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
       echo "::error::Invalid version format: $VERSION"
       exit 1
     fi
     ```
  4. Upgrade `pnpm/action-setup@v2` to `@v4`
  5. Pin `softprops/action-gh-release` to a commit SHA rather than the mutable `@v1` tag
  6. Add explicit `permissions: {}` at workflow level + per-job grants

- [ ] **Create `scripts/generate-release-notes.js`** — replaces the fragile `awk` pattern for extracting changelog entries. Aggregates root `CHANGELOG.md` section + per-plugin CHANGELOG excerpts for any plugin with an entry for the release version:

  ```js
  // Usage: node scripts/generate-release-notes.js --version 1.2.0 --output release-notes.md
  // Extracts root changelog section + per-plugin changelog sections for the given version
  ```

- [ ] **Update `docs/operations/release-checklist.md`** — replace manual version bump steps with Changesets workflow, including the explicit git commit step:

  ```
  Pre-release checklist:
  1. Run `pnpm changeset status` to review pending bumps
  2. Apply: `pnpm apply:changesets`
  3. Regenerate lockfile: `pnpm install`
  4. Stage and commit: `gt modify -c -m "chore(release): version packages"`   ← CRITICAL: don't skip this
  5. Catalog bump: `node scripts/catalog-version.js minor`
  6. Commit catalog bump: `gt modify -c -m "chore(release): bump catalog to v1.x.x"`
  7. Gate: `pnpm release:check` (validate:marketplace + validate:plugins + validate:versions + typecheck)
  8. Tag: `git tag v1.x.x && git push --tags`
  ```

- [ ] **Add changeset status check to CI** (warn-only, as specified in Phase 2 above).

### Research Insights: Missing Commit Step

The original developer workflow showed `pnpm version` then `git tag` with no commit step between them. With `"commit": false` in the config, `changeset version` writes version bumps but does NOT auto-commit. Tagging before committing creates a tag pointing at a commit without the bumped versions — `publish-release.yml` validation then fails with `PKG_VERSION != RELEASE_VERSION`, but the tag already exists and cannot easily be moved.

---

## Acceptance Criteria

### Functional

- [ ] `pnpm changeset` prompts the developer to select plugins and enter a summary
- [ ] `pnpm changeset` prompt lists only the 11 plugins (NOT `@yellow-plugins/cli` etc.)
- [ ] `pnpm apply:changesets` bumps `plugins/<name>/package.json`, writes `CHANGELOG.md` entries, and syncs `plugin.json` + `marketplace.json` in one command
- [ ] `pnpm validate:schemas` fails if `package.json`, `plugin.json`, and `marketplace.json` versions disagree for any plugin
- [ ] CI `validate-versions` job blocks a PR with mismatched versions (exit 1)
- [ ] Each plugin has a `CHANGELOG.md` and (pending validator test) a `changelog` URL in `plugin.json`
- [ ] Root `CHANGELOG.md` has a `1.1.0` entry (unblocks `publish-release.yml`)
- [ ] `node scripts/catalog-version.js minor` bumps root `package.json` + `marketplace.json metadata.version` together

### Non-Functional

- [ ] `pnpm install` still succeeds (no version conflicts from adding 11 private workspace packages)
- [ ] `validate-versions` CI job completes in under 10 seconds
- [ ] No changes to how Claude Code installs or updates plugins (transparent to users)
- [ ] `pnpm -r publish --dry-run` does NOT attempt to publish any private plugin package (verify before Phase 1 merges)

### Quality Gates

- [ ] All existing `pnpm validate:schemas` + `pnpm test:unit` + `pnpm test:integration` still pass
- [ ] `schemas/plugin.schema.json` schema update doesn't break AJV strict mode (`ajv-formats` already installed)
- [ ] **Phase 3 gate:** `changelog` field accepted by Claude Code remote validator (test on fresh machine before merging)

---

## Dependencies & Prerequisites

- `@changesets/cli` npm package (MIT license, 0 peer deps at the root level) — pin with `"^2.28.0"` (caret for bug fixes)
- `@changesets/changelog-github` — produces PR-linked changelog entries using GitHub API; requires `GITHUB_TOKEN` at `changeset version` time (falls back gracefully offline)
- `semver` — already in `packages/infrastructure/package.json`; also a transitive dep already in the lockfile. Add explicit root devDep.
- All 11 plugins need `package.json` AND `pnpm-workspace.yaml` must include `plugins/*` — both must land in one commit (or `pnpm install` will fail on partial state)
- `pnpm-lock.yaml` must be regenerated and committed in the Phase 1 PR

---

## Risk Analysis

| Risk | Likelihood | Mitigation |
|---|---|---|
| `pnpm-workspace.yaml` change causes install errors if any plugin dir has conflicting devDeps | Low | All plugin package.json are `private: true` with no deps. Add CI assertion that no plugin `package.json` declares `dependencies` or `devDependencies`. |
| `schemas/plugin.schema.json` update fails AJV strict mode on `format: "uri"` | Low | `ajv-formats` already installed; verify `-c ajv-formats` is passed in all CI `ajv validate` calls |
| `sync-manifests.js` silently skips a plugin | Medium | Derive expected count from `marketplace.json` plugins array (not hardcoded 11); validate every marketplace entry has a corresponding directory; script exits 1 on any mismatch |
| Catalog version and plugin versions drift conceptually confusing | Low | `docs/operations/versioning.md` clarifies the two-level model. Catalog version bump must be checked before tagging. |
| `"changelog"` field rejected by Claude Code remote validator | **High** | Gate Phase 3 on empirical fresh-install test. If rejected, scope Phase 3 to CHANGELOG.md files only. |
| `pnpm -r publish` in `publish-release.yml` attempts to publish private plugins | Medium | Verify with `pnpm -r publish --dry-run` before Phase 1 PR merges; `private: true` should skip them in pnpm 8 but must be explicitly confirmed |
| `import.meta.dirname` fails on Node 20 LTS | **High** | Fixed in hardened `sync-manifests.js` above — use `fileURLToPath(new URL('.', import.meta.url))` |
| Path traversal via crafted plugin directory name in `sync-manifests.js` | Low | Fixed in hardened script — allowlist `/^[a-zA-Z0-9_-]+$/` + `assertWithinRoot()` check |
| Missing commit step between `pnpm apply:changesets` and `git tag` | Medium | Updated release checklist with explicit `gt modify -c` step; developer workflow updated |
| `pnpm version` script name shadows pnpm built-in | Low | Renamed to `apply:changesets` in this plan |
| CRLF line endings on WSL2 for new files | Medium | Run `sed -i 's/\r$//'` after every Write-tool file creation; verify `.gitattributes` covers `*.json` and `*.md` |
| `pnpm-lock.yaml` stale after Phase 1 | Medium | Explicitly call out that lockfile must be regenerated and committed in same PR |

---

## Open Questions (Resolved)

- **Catalog version reset?** → Keep at `1.1.0` (don't reset; add the missing CHANGELOG entry instead)
- **Initial plugin package.json versions?** → Match current `plugin.json` values exactly (`yellow-devin@2.0.0`, others `@1.0.0`)
- **Add `changelog` URL field?** → Yes in Phase 3, but ONLY after empirical fresh-install validation. If rejected by Claude Code validator, scope to CHANGELOG.md only.
- **GitHub Release notes scope?** → Root catalog notes + per-plugin excerpts via `generate-release-notes.js` (Phase 4)
- **Is `pnpm version` run automatically in CI or manually?** → **Manually** by release manager as part of release cut. Changeset files accumulate on main between releases (standard Changesets monorepo pattern). CI does NOT auto-commit version bumps. This avoids the need for GitHub PAT with write access on every PR merge.
- **Hotfix releases on already-tagged catalog versions?** → Out of scope for this plan. Current model requires releasing all accumulated changesets together. For now, mitigation is to release frequently to keep blast radius small. Follow-up: add a `release/v1.x.x` hotfix branch model.
- **Does Claude Code surface the `changelog` field in its update flow?** → Unverified. Must be tested empirically before Phase 3. If not surfaced, the user-visible value of the `plugin.json` field addition is zero; CHANGELOG.md files still provide value for GitHub browsing.

---

## References

### Internal

- Brainstorm: `docs/brainstorms/2026-02-23-plugin-versioning-brainstorm.md`
- Release checklist: `docs/operations/release-checklist.md`
- CI pipeline spec: `docs/operations/ci-pipeline.md`
- Version validation (RULE 6): `scripts/validate-marketplace.js:240-286`
- Publish workflow: `.github/workflows/publish-release.yml`
- Schema validation: `.github/workflows/validate-schemas.yml`
- Plugin schema: `schemas/plugin.schema.json`
- Two-validator problem: `docs/solutions/build-errors/ci-schema-drift-hooks-inline-vs-string.md`
- AJV strict mode fix: `docs/solutions/build-errors/ajv-cli-v8-strict-mode-unknown-format.md`
- Manifest validation errors: `docs/solutions/build-errors/claude-code-plugin-manifest-validation-errors.md`
- CRLF on WSL2: `docs/solutions/workflow/wsl2-crlf-pr-merge-unblocking.md`
- Stale references & Prettier: `docs/solutions/code-quality/public-release-stale-references-and-prettier-formatting.md`

### External

- [Changesets docs](https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md)
- [Changesets in monorepos](https://github.com/changesets/changesets/blob/main/docs/adding-a-changeset.md)
- [Changesets config options](https://github.com/changesets/changesets/blob/main/docs/config-file-options.md)
- [Changesets versioning apps (non-npm)](https://github.com/changesets/changesets/blob/main/docs/versioning-apps.md) — key reference for `privatePackages` flag
- [changesets/action GitHub Action](https://github.com/changesets/action)
- [pnpm "Using Changesets with pnpm"](https://pnpm.io/using-changesets)
- [Keep a Changelog format](https://keepachangelog.com/)
- [Luke Hsiao — Changesets in polyglot monorepo (2024)](https://luke.hsiao.dev/blog/changesets-polyglot-monorepo/)
