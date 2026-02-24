#!/usr/bin/env node
/**
 * sync-manifests.js
 *
 * Syncs plugins/<name>/package.json versions -> plugin.json + marketplace.json.
 * Run after: changeset version (via `pnpm apply:changesets`).
 *
 * Flags:
 *   --dry-run / --verify   Report drift without writing files (exit 0 if no drift, exit 0 in dry mode)
 *
 * Security:
 *   - Allowlist plugin directory names to [a-zA-Z0-9_-] (rejects path traversal)
 *   - assertWithinRoot() verifies every derived path stays inside PLUGINS_DIR
 *   - Atomic writes via tmp file + renameSync (POSIX atomic on same filesystem)
 *
 * Error handling:
 *   - ENOENT on package.json -> skip (not a plugin dir)
 *   - Any other read error -> exit 1 with named error
 *   - Missing or invalid version in package.json -> exit 1
 *   - Plugin directory not in marketplace.json -> exit 1
 *   - Count < marketplace.plugins.length -> exit 1
 */

'use strict';

const { readFileSync, writeFileSync, readdirSync, renameSync, unlinkSync, statSync, existsSync } = require('fs');
const { join, resolve } = require('path');

const ROOT = resolve(__dirname, '..');
const PLUGINS_DIR = join(ROOT, 'plugins');
const MARKETPLACE_PATH = join(ROOT, '.claude-plugin', 'marketplace.json');

const DRY_RUN = process.argv.includes('--dry-run') || process.argv.includes('--verify');
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

function assertWithinRoot(filePath, rootDir) {
  const canonical = resolve(filePath);
  const rootCanonical = resolve(rootDir);
  if (canonical !== rootCanonical && !canonical.startsWith(rootCanonical + '/')) {
    throw new Error(`[sync-manifests] Path traversal detected: ${filePath}`);
  }
}

function atomicWrite(filePath, content) {
  const tmp = filePath + '.tmp';
  writeFileSync(tmp, content, 'utf8');
  try {
    renameSync(tmp, filePath); // atomic on Linux when on same filesystem
  } catch (e) {
    try { unlinkSync(tmp); } catch (_) {}
    throw new Error(`[atomicWrite] rename ${tmp} -> ${filePath} failed: ${e.message}`);
  }
}

// --- Load marketplace.json first (needed for count assertion) ---
let marketplace;
try {
  marketplace = JSON.parse(readFileSync(MARKETPLACE_PATH, 'utf8'));
} catch (e) {
  console.error(`[sync-manifests] Cannot read marketplace.json: ${e.message}`);
  process.exit(1);
}

if (!Array.isArray(marketplace.plugins)) {
  console.error('[sync-manifests] marketplace.json has no "plugins" array');
  process.exit(1);
}

const expectedCount = marketplace.plugins.length;

// --- Collect plugin versions from plugins/*/package.json ---
const pluginVersions = {};

if (!existsSync(PLUGINS_DIR)) {
  console.error(`[sync-manifests] plugins/ directory not found at ${PLUGINS_DIR}`);
  process.exit(1);
}

for (const name of readdirSync(PLUGINS_DIR)) {
  // Security: reject suspicious directory names (path traversal guard)
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    console.warn(`[sync-manifests] Skipping suspicious directory name: "${name}"`);
    continue;
  }

  const pluginPath = join(PLUGINS_DIR, name);

  // Skip non-directories (e.g. stray files in plugins/)
  if (!statSync(pluginPath).isDirectory()) continue;

  const pkgPath = join(PLUGINS_DIR, name, 'package.json');
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') {
      // Not a plugin workspace package -- expected for dirs without package.json
      continue;
    }
    // Real error: malformed JSON, permission denied, etc.
    console.error(`[sync-manifests] Error reading ${pkgPath}: ${e.message}`);
    process.exit(1);
  }

  if (typeof pkg.version !== 'string' || !SEMVER_RE.test(pkg.version)) {
    console.error(
      `[sync-manifests] Invalid or missing version in ${pkgPath}: "${pkg.version}". ` +
        'Expected a semver string (e.g. "1.0.0").'
    );
    process.exit(1);
  }

  pluginVersions[name] = pkg.version;
}

// --- Count assertion: must have at least as many plugins as marketplace expects ---
const foundCount = Object.keys(pluginVersions).length;
if (foundCount < expectedCount) {
  console.error(
    `[sync-manifests] Expected ${expectedCount} plugins (from marketplace.json), ` +
      `found only ${foundCount} with package.json. ` +
      'Check for missing plugins/*/package.json files.'
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
    console.error(`[sync-manifests] Cannot read plugin.json for "${name}": ${e.message}`);
    process.exit(1);
  }

  if (manifest.version !== version) {
    const old = manifest.version != null ? manifest.version : '(none)';
    console.log(
      `${DRY_RUN ? '[DRY RUN] Would sync' : 'Synced'} ${name} plugin.json: ${old} -> ${version}`
    );
    if (!DRY_RUN) {
      manifest.version = version;
      atomicWrite(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    }
    syncedPlugins++;
  }
}

// --- Sync marketplace.json ---
let syncedMarketplace = 0;
let marketplaceDirty = false;

for (const plugin of marketplace.plugins) {
  const version = pluginVersions[plugin.name];
  if (version === undefined) {
    console.error(
      `[sync-manifests] Marketplace plugin "${plugin.name}" has no corresponding ` +
        'plugins/ directory with a package.json. ' +
        'Either add the directory with a package.json or remove the marketplace entry.'
    );
    process.exit(1);
  }
  if (plugin.version !== version) {
    const old = plugin.version != null ? plugin.version : '(none)';
    console.log(
      `${DRY_RUN ? '[DRY RUN] Would sync' : 'Synced'} marketplace.json ${plugin.name}: ${old} -> ${version}`
    );
    if (!DRY_RUN) {
      plugin.version = version;
      syncedMarketplace++;
      marketplaceDirty = true;
    }
  }
}

if (!DRY_RUN && marketplaceDirty) {
  atomicWrite(MARKETPLACE_PATH, JSON.stringify(marketplace, null, 2) + '\n');
}

const mode = DRY_RUN ? 'Dry run complete' : 'Complete';
console.log(
  `[sync-manifests] ${mode}: ${foundCount} plugins checked, ` +
    `${syncedPlugins} plugin.json synced, ${syncedMarketplace} marketplace entries synced`
);
