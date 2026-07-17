#!/usr/bin/env node
/**
 * validate-versions.js
 *
 * Target-aware version consistency check (R12):
 *   Claude (three-way, unchanged since before the Codex pilot):
 *     plugins/<name>/package.json == plugins/<name>/.claude-plugin/plugin.json
 *                                 == .claude-plugin/marketplace.json entry
 *   Codex (two-way, new — only for plugins with targets.codex.enabled: true):
 *     plugins/<name>/package.json == plugins/<name>/.codex-plugin/plugin.json
 *   Codex marketplace (new, no version field): .agents/plugins/marketplace.json
 *     is checked separately for membership, name, order, and path — not
 *     version comparison, since Codex marketplace entries carry no version.
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
 *   - Missing package.json -> skip (not a versioned plugin), UNLESS the
 *     plugin is Codex-enabled, in which case it's drift (R12: a
 *     Codex-enabled plugin must always reach the two-way check)
 *   - Missing version field in any manifest -> drift with explicit message
 *   - Missing marketplace entry for a plugin -> drift
 *   - Malformed JSON -> exit 1 immediately
 *
 * The Claude three-way comparison (lines below marked "unchanged") is left
 * exactly as it was before this pilot — deliberately NOT refactored into a
 * pure function alongside the new Codex checks, to avoid touching working,
 * previously-untested logic without a regression net (advisor review: the
 * baseline `pnpm validate:versions` output on a clean tree was captured
 * before this change and confirmed byte-identical after). The new Codex
 * logic (`computeCodexTwoWayDrift`, `computeCodexMarketplaceIssues`) is
 * exported as pure functions specifically because it's new and needs the
 * unit coverage R43 asks for.
 */

'use strict';

const { readFileSync, readdirSync, statSync, existsSync } = require('fs');
const { join, resolve, sep } = require('path');

const { loadCatalog, loadPluginSources } = require('./lib/generate/catalog-reader');
const { isCodexEnabled } = require('./lib/generate/emit-codex');

const ROOT = resolve(__dirname, '..');
const PLUGINS_DIR = join(ROOT, 'plugins');
const MARKETPLACE_PATH = join(ROOT, '.claude-plugin', 'marketplace.json');
const CODEX_MARKETPLACE_PATH = join(ROOT, '.agents', 'plugins', 'marketplace.json');

const SEMVER_RE = /^\d+\.\d+\.\d+(-[a-zA-Z0-9][a-zA-Z0-9.]*)?$/;
const NAME_RE = /^[a-zA-Z0-9_-]+$/;

function assertWithinRoot(filePath, rootDir) {
  const canonical = resolve(filePath);
  const rootCanonical = resolve(rootDir);
  if (canonical !== rootCanonical && !canonical.startsWith(rootCanonical + sep)) {
    throw new Error(`[validate-versions] Path traversal detected: ${filePath}`);
  }
}

/**
 * Pure two-way comparison for the Codex target (R12). No I/O.
 *
 * @param {string} pkgVersion - plugins/<name>/package.json version.
 * @param {string|null} codexManifestVersion - plugins/<name>/.codex-plugin/
 *   plugin.json version, or null if missing/unreadable.
 * @returns {string|null} issue description, or null when in sync.
 */
function computeCodexTwoWayDrift(pkgVersion, codexManifestVersion) {
  if (codexManifestVersion === null) {
    return 'Codex-enabled but plugins/<name>/.codex-plugin/plugin.json version is missing or unreadable';
  }
  if (codexManifestVersion !== pkgVersion) {
    return `.codex-plugin/plugin.json: ${codexManifestVersion} (expected ${pkgVersion})`;
  }
  return null;
}

/**
 * Pure membership/name/order/path check for the Codex marketplace (R12).
 * No version comparison — Codex marketplace entries carry no version field
 * (R5), so this validates structural consistency instead: every
 * Codex-enabled plugin has exactly one entry, in the same relative order
 * as the catalog's canonical order, with the expected name and source
 * path. No I/O.
 *
 * @param {string[]} codexEnabledPluginNames - in catalog canonical order,
 *   filtered to Codex-enabled.
 * @param {{ name: string, source?: { path?: string } }[]} marketplaceEntries
 *   - the parsed .agents/plugins/marketplace.json "plugins" array.
 * @returns {string[]} issue descriptions (empty when consistent).
 */
function computeCodexMarketplaceIssues(codexEnabledPluginNames, marketplaceEntries) {
  const issues = [];
  const entryNames = marketplaceEntries.map((e) => e.name);
  const entryNameSet = new Set(entryNames);
  const expectedNameSet = new Set(codexEnabledPluginNames);

  for (const name of codexEnabledPluginNames) {
    if (!entryNameSet.has(name)) {
      issues.push(`Codex marketplace: "${name}" is Codex-enabled but has no entry in .agents/plugins/marketplace.json`);
    }
  }
  for (const name of entryNames) {
    if (!expectedNameSet.has(name)) {
      issues.push(`Codex marketplace: "${name}" has an entry but is not Codex-enabled in the catalog`);
    }
  }

  // Order: the subsequence of entryNames that ARE Codex-enabled must equal
  // codexEnabledPluginNames exactly (ignores unrelated/orphan entries
  // already reported above, so order drift isn't double-counted with them).
  const relevantEntryOrder = entryNames.filter((name) => expectedNameSet.has(name));
  const expectedOrder = codexEnabledPluginNames.filter((name) => entryNameSet.has(name));
  if (relevantEntryOrder.join(',') !== expectedOrder.join(',')) {
    issues.push(
      `Codex marketplace: entry order [${relevantEntryOrder.join(', ')}] does not match catalog canonical order [${expectedOrder.join(', ')}]`
    );
  }

  for (const entry of marketplaceEntries) {
    if (!expectedNameSet.has(entry.name)) continue; // already reported as orphan
    const expectedPath = `./plugins/${entry.name}`;
    const actualPath = entry.source && entry.source.path;
    if (actualPath !== expectedPath) {
      issues.push(`Codex marketplace: "${entry.name}" source.path is "${actualPath}" (expected "${expectedPath}")`);
    }
  }

  return issues;
}

function main() {
  const DRY_RUN = process.argv.includes('--dry-run');
  const PLUGIN_FLAG_IDX = process.argv.indexOf('--plugin');
  const rawPlugin = PLUGIN_FLAG_IDX !== -1 ? process.argv[PLUGIN_FLAG_IDX + 1] : null;
  if (PLUGIN_FLAG_IDX !== -1 && (!rawPlugin || rawPlugin.startsWith('--'))) {
    console.error('[validate-versions] --plugin requires a plugin name (e.g. --plugin yellow-core)');
    process.exit(1);
  }
  const SINGLE_PLUGIN = rawPlugin;

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

  // --- Load the catalog, for Codex-enablement (R12). Only a genuinely
  // MISSING catalog.json degrades to Claude-only checking rather than
  // hard-failing — the catalog didn't exist at all before shell 01, and
  // this script must keep working during any future bisect/rollback
  // scenario that predates it. An INVALID (malformed, or cross-check
  // failed) catalog or plugin-source set is not the same as missing —
  // silently leaving codexEnabledPluginNames empty in that case would
  // skip Codex drift checks while still exiting 0, so that case hard-fails
  // instead, matching the "Malformed JSON -> exit 1 immediately" contract
  // already used for marketplace.json above.
  const catalogResult = loadCatalog(join(ROOT, 'catalog'));
  let codexEnabledPluginNames = [];
  if (catalogResult.status === 'invalid') {
    console.error(`[validate-versions] Invalid catalog: ${catalogResult.errors.join('; ')}`);
    process.exit(1);
  } else if (catalogResult.status === 'ok') {
    const catalogPluginOrder = catalogResult.data.pluginOrder;
    const sourcesResult = loadPluginSources(join(ROOT, 'catalog'), catalogPluginOrder);
    if (sourcesResult.status === 'invalid') {
      console.error(`[validate-versions] Invalid catalog plugin sources: ${sourcesResult.errors.join('; ')}`);
      process.exit(1);
    }
    const sources = sourcesResult.sources;
    codexEnabledPluginNames = catalogPluginOrder.filter((name) => isCodexEnabled(sources[name]));
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
    const dirBasedNames = readdirSync(PLUGINS_DIR).filter((name) => {
      if (!NAME_RE.test(name)) return false;
      const p = join(PLUGINS_DIR, name);
      if (!statSync(p).isDirectory()) return false;
      // Only check plugins that have a package.json
      return existsSync(join(p, 'package.json'));
    });
    // Union in every Codex-enabled catalog plugin, even ones missing
    // package.json — otherwise such a plugin is silently dropped from the
    // worklist before it ever reaches the Codex two-way check below, and
    // the missing artifact never surfaces as drift.
    pluginNames = Array.from(new Set([...dirBasedNames, ...codexEnabledPluginNames]));
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
        // Codex-enabled plugins are always reported, even outside
        // --plugin mode, since a missing package.json is real drift for
        // them (there's nothing to compare .codex-plugin/plugin.json
        // against) rather than "not a versioned plugin yet".
        if (SINGLE_PLUGIN || codexEnabledPluginNames.includes(name)) {
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

    // --- Codex two-way comparison (new, R12) --- runs before the
    // Claude-only early exits below so a Codex-enabled plugin that lacks a
    // Claude marketplace entry or Claude manifest still has its
    // target-independent Codex artifacts checked for version drift.
    if (codexEnabledPluginNames.includes(name)) {
      const codexManifestPath = join(pluginDir, '.codex-plugin', 'plugin.json');
      let codexManifestVersion = null;
      try {
        const codexManifest = JSON.parse(readFileSync(codexManifestPath, 'utf8'));
        codexManifestVersion = typeof codexManifest.version === 'string' ? codexManifest.version : null;
      } catch {
        codexManifestVersion = null;
      }
      const codexIssue = computeCodexTwoWayDrift(pkgVersion, codexManifestVersion);
      if (codexIssue !== null) {
        drifts.push({ plugin: name, issue: codexIssue });
      }
    }

    // --- Check marketplace.json (Claude three-way, unchanged) ---
    const mktVersion = marketplaceVersions[name];
    if (mktVersion === undefined) {
      if (!existsSync(manifestPath)) {
        // Truly new plugin — not yet registered anywhere, skip
        console.warn(`[validate-versions] WARN: "${name}" has package.json but no manifest yet — skipping`);
        continue;
      }
      drifts.push({ plugin: name, issue: `no entry in marketplace.json` });
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

    // --- Three-way comparison (Claude, unchanged) ---
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

  // --- Codex marketplace membership/name/order/path (new, R12) ---
  // Skipped only when the catalog itself is missing (pre-Codex-era
  // checkout / bisect before shell 01): codexEnabledPluginNames is
  // deliberately [] in that case (documented Claude-only fallback), and
  // .agents/plugins/marketplace.json legitimately doesn't exist yet
  // either, so treating its absence as drift would break that fallback
  // contract. ('invalid' catalog status already exited above, so the
  // only other status reaching here is 'ok'.) Otherwise this block still
  // runs, even in --plugin mode for a plugin that is not currently
  // Codex-enabled: computeCodexMarketplaceIssues() still needs to see
  // scopedEntries so a stale .agents/plugins/marketplace.json entry left
  // behind after flipping targets.codex.enabled: true -> false is reported
  // as an orphan instead of silently skipped.
  if (catalogResult.status !== 'missing') {
    try {
      const codexMarketplace = JSON.parse(readFileSync(CODEX_MARKETPLACE_PATH, 'utf8'));
      if (!Array.isArray(codexMarketplace.plugins)) {
        drifts.push({
          plugin: '(codex marketplace)',
          issue: '.agents/plugins/marketplace.json has no "plugins" array',
        });
      } else {
        const entries = codexMarketplace.plugins;
        const scopedEnabledNames = SINGLE_PLUGIN
          ? codexEnabledPluginNames.filter((n) => n === SINGLE_PLUGIN)
          : codexEnabledPluginNames;
        const scopedEntries = SINGLE_PLUGIN ? entries.filter((e) => e.name === SINGLE_PLUGIN) : entries;
        for (const issue of computeCodexMarketplaceIssues(scopedEnabledNames, scopedEntries)) {
          drifts.push({ plugin: '(codex marketplace)', issue });
        }
      }
    } catch (e) {
      drifts.push({ plugin: '(codex marketplace)', issue: `cannot read .agents/plugins/marketplace.json: ${e.message}` });
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
}

if (require.main === module) {
  main();
}

module.exports = { computeCodexTwoWayDrift, computeCodexMarketplaceIssues };
