#!/usr/bin/env node
/**
 * validate-versions.js
 *
 * Three-way version consistency check:
 *   plugins/<name>/package.json == plugins/<name>/.claude-plugin/plugin.json
 *                               == .claude-plugin/marketplace.json entry
 *
 * Usage:
 *   node scripts/validate-versions.js                  # fail on drift (CI mode)
 *   node scripts/validate-versions.js --dry-run        # report drift, always exit 0
 *   node scripts/validate-versions.js --plugin <name>  # check one plugin only
 *
 * Security:
 *   - Allowlist plugin directory names to [a-zA-Z0-9_-] (rejects path traversal)
 *   - assertWithinRoot() verifies every derived path stays inside PLUGINS_DIR
 *
 * Error handling:
 *   - Missing package.json -> skip (not a versioned plugin)
 *   - Missing version field in any manifest -> drift with explicit message
 *   - Missing marketplace entry for a plugin -> drift
 *   - Malformed JSON -> exit 1 immediately
 */

'use strict';

const { readFileSync, readdirSync, statSync, existsSync } = require('fs');
const { join, resolve } = require('path');

const ROOT = resolve(__dirname, '..');
const PLUGINS_DIR = join(ROOT, 'plugins');
const MARKETPLACE_PATH = join(ROOT, '.claude-plugin', 'marketplace.json');

const DRY_RUN = process.argv.includes('--dry-run');
const PLUGIN_FLAG_IDX = process.argv.indexOf('--plugin');
const rawPlugin = PLUGIN_FLAG_IDX !== -1 ? process.argv[PLUGIN_FLAG_IDX + 1] : null;
if (PLUGIN_FLAG_IDX !== -1 && (!rawPlugin || rawPlugin.startsWith('--'))) {
  console.error('[validate-versions] --plugin requires a plugin name (e.g. --plugin yellow-core)');
  process.exit(1);
}
const SINGLE_PLUGIN = rawPlugin;

const SEMVER_RE = /^\d+\.\d+\.\d+(-[a-zA-Z0-9][a-zA-Z0-9.]*)?$/;
const NAME_RE = /^[a-zA-Z0-9_-]+$/;

function assertWithinRoot(filePath, rootDir) {
  const canonical = resolve(filePath);
  const rootCanonical = resolve(rootDir);
  if (canonical !== rootCanonical && !canonical.startsWith(rootCanonical + '/')) {
    throw new Error(`[validate-versions] Path traversal detected: ${filePath}`);
  }
}

// --- Load marketplace.json ---
let marketplace;
try {
  marketplace = JSON.parse(readFileSync(MARKETPLACE_PATH, 'utf8'));
} catch (e) {
  console.error(`[validate-versions] Cannot read marketplace.json: ${e.message}`);
  process.exit(1);
}

if (!Array.isArray(marketplace.plugins)) {
  console.error('[validate-versions] marketplace.json has no "plugins" array');
  process.exit(1);
}

// Build marketplace lookup: name -> version
const marketplaceVersions = {};
for (const entry of marketplace.plugins) {
  marketplaceVersions[entry.name] = entry.version != null ? String(entry.version) : null;
}

// --- Collect plugins to check ---
if (!existsSync(PLUGINS_DIR)) {
  console.error(`[validate-versions] plugins/ directory not found at ${PLUGINS_DIR}`);
  process.exit(1);
}

let pluginNames;
if (SINGLE_PLUGIN) {
  if (!NAME_RE.test(SINGLE_PLUGIN)) {
    console.error(`[validate-versions] Invalid plugin name: "${SINGLE_PLUGIN}"`);
    process.exit(1);
  }
  pluginNames = [SINGLE_PLUGIN];
} else {
  pluginNames = readdirSync(PLUGINS_DIR).filter((name) => {
    if (!NAME_RE.test(name)) return false;
    const p = join(PLUGINS_DIR, name);
    if (!statSync(p).isDirectory()) return false;
    // Only check plugins that have a package.json
    return existsSync(join(p, 'package.json'));
  });
}

const drifts = [];

for (const name of pluginNames) {
  const pluginDir = join(PLUGINS_DIR, name);
  const pkgPath = join(pluginDir, 'package.json');
  const manifestPath = join(pluginDir, '.claude-plugin', 'plugin.json');

  assertWithinRoot(pkgPath, PLUGINS_DIR);
  assertWithinRoot(manifestPath, PLUGINS_DIR);

  // --- Read package.json ---
  let pkgVersion;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    pkgVersion = typeof pkg.version === 'string' ? pkg.version : null;
  } catch (e) {
    if (e.code === 'ENOENT') {
      if (SINGLE_PLUGIN) {
        drifts.push({ plugin: name, issue: `package.json not found at ${pkgPath}` });
      }
      continue; // not a versioned plugin (or already added to drifts)
    }
    console.error(`[validate-versions] Cannot read ${pkgPath}: ${e.message}`);
    process.exit(1);
  }

  if (!pkgVersion || !SEMVER_RE.test(pkgVersion)) {
    drifts.push({
      plugin: name,
      issue: `package.json version missing or invalid: "${pkgVersion}"`,
    });
    continue;
  }

  // --- Read plugin.json ---
  let manifestVersion;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifestVersion = typeof manifest.version === 'string' ? manifest.version : null;
  } catch (e) {
    drifts.push({
      plugin: name,
      issue: `Cannot read plugin.json: ${e.message}`,
    });
    continue;
  }

  // --- Check marketplace.json ---
  const mktVersion = marketplaceVersions[name];
  const pluginJsonPath = join(PLUGINS_DIR, name, '.claude-plugin', 'plugin.json');
  if (mktVersion === undefined) {
    if (!existsSync(pluginJsonPath)) {
      // Truly new plugin — not yet registered anywhere, skip
      console.warn(`[validate-versions] WARN: "${name}" has package.json but no manifest yet — skipping`);
      continue;
    }
    drifts.push({ plugin: name, issue: `no entry in marketplace.json` });
    continue;
  }

  // --- Three-way comparison ---
  const pkgOk = pkgVersion != null;
  const manifestOk = manifestVersion === pkgVersion;
  const mktOk = mktVersion === pkgVersion;

  if (!pkgOk || !manifestOk || !mktOk) {
    const parts = [];
    if (!pkgOk) parts.push(`package.json: ${pkgVersion ?? '(none)'}`);
    if (!manifestOk)
      parts.push(`plugin.json: ${manifestVersion ?? '(none)'} (expected ${pkgVersion})`);
    if (!mktOk)
      parts.push(`marketplace.json: ${mktVersion ?? '(none)'} (expected ${pkgVersion})`);
    drifts.push({ plugin: name, issue: parts.join(', ') });
  }
}

// --- Report ---
if (drifts.length === 0) {
  const scope = SINGLE_PLUGIN ? `plugin "${SINGLE_PLUGIN}"` : `${pluginNames.length} plugins`;
  console.log(`[validate-versions] OK: ${scope} — all versions in sync`);
  process.exit(0);
}

console.error(`[validate-versions] Version drift detected (${drifts.length} plugin(s)):`);
for (const { plugin, issue } of drifts) {
  console.error(`  ${plugin}: ${issue}`);
}

if (DRY_RUN) {
  console.log('[validate-versions] Dry run: run `pnpm apply:changesets` to sync versions');
  process.exit(0);
} else {
  console.error('[validate-versions] Run `pnpm apply:changesets` to sync versions');
  process.exit(1);
}
