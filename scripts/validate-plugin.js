#!/usr/bin/env node

/**
 * Plugin Manifest Validator
 *
 * Validates plugin.json files inside each plugin's .claude-plugin directory.
 * Checks both the official minimal format and optional extended fields.
 *
 * Usage:
 *   node scripts/validate-plugin.js                      # Validate all plugins in plugins/
 *   node scripts/validate-plugin.js plugins/yellow-starter  # Validate specific plugin
 *
 * Exit codes:
 *   0 - All valid
 *   1 - Validation failed
 *   2 - Plugin not found
 *
 * Architecture (PR-A decomposition — see CONTRIBUTING.md "Split validation
 * architecture"): this file is a thin orchestrator. The per-rule checks live
 * in scripts/lib/plugin-rules.js, path/hook helpers in scripts/lib/plugin-paths.js,
 * shared console logging in scripts/lib/logging.js, and the shared
 * marketplace.json reader in scripts/lib/marketplace-reader.js.
 *
 * NOTE: JSON Schema validation (AJV) runs separately via validate-schemas.js /
 * `pnpm validate:schemas`. This script enforces additional rules not expressible
 * in JSON Schema: path existence, directory structure, .md file presence, hook
 * script sanity, hooks.json drift, and the userConfig shape constraints. Always
 * run both together via `pnpm validate:schemas`.
 */

const fs = require('fs');
const path = require('path');

const { colors, logError, logWarning, logInfo, logSuccess } = require('./lib/logging');
const { readMarketplaceManifest } = require('./lib/marketplace-reader');
const { collectInlineHooks } = require('./lib/plugin-paths');
const {
  ruleRequiredFields,
  ruleNameMatchesDir,
  ruleVersionFormat,
  ruleDescriptionQuality,
  ruleKeywords,
  rulePathFields,
  ruleInlineHookScripts,
  ruleHooksJson,
  ruleUserConfig,
  ruleDependencies,
  ruleMcpServerEnv,
} = require('./lib/plugin-rules');

const PROJECT_ROOT = process.cwd();

// Lazy-loaded set of plugin names declared in the marketplace catalog.
// Populated on first call and reused for every subsequent plugin's RULE 11
// cross-dep check. Returns null when marketplace.json is absent (silent —
// single-plugin validation outside the monorepo is a legitimate flow),
// unparseable, or has an unexpected shape; the latter two also emit a
// WARNING so a broken catalog doesn't quietly reduce validation coverage.
let _marketplacePluginNames = undefined;
function getMarketplacePluginNames() {
  if (_marketplacePluginNames !== undefined) return _marketplacePluginNames;
  const marketplacePath = path.join(
    PROJECT_ROOT,
    '.claude-plugin',
    'marketplace.json'
  );
  const result = readMarketplaceManifest(marketplacePath);
  if (result.status === 'missing') {
    _marketplacePluginNames = null;
  } else if (result.status === 'invalid') {
    logWarning(
      'cannot parse .claude-plugin/marketplace.json (invalid JSON); skipping dependency cross-checks'
    );
    _marketplacePluginNames = null;
  } else if (result.data && Array.isArray(result.data.plugins)) {
    _marketplacePluginNames = new Set(
      result.data.plugins
        .filter((p) => p && typeof p.name === 'string')
        .map((p) => p.name)
    );
  } else {
    logWarning(
      'cannot parse .claude-plugin/marketplace.json (unexpected shape); skipping dependency cross-checks'
    );
    _marketplacePluginNames = null;
  }
  return _marketplacePluginNames;
}

/**
 * Load and parse a plugin manifest. Returns `{ manifest }` on success or
 * `{ failure }` carrying the validator's `{ valid: false, errors }` result
 * for a missing/unreadable/unparseable manifest (both are terminal cases
 * the orchestrator returns directly).
 */
function loadManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    let reason = 'file not found';
    try {
      fs.lstatSync(manifestPath);
      reason = 'broken symbolic link';
    } catch (lstatErr) {
      if (lstatErr.code === 'EACCES') reason = 'permission denied';
      else if (lstatErr.code === 'ENOTDIR') reason = 'parent is not a directory';
    }
    logError(`plugin.json not found at: ${manifestPath} (${reason})`);
    return { failure: { valid: false, errors: [`manifest not found: ${reason}`] } };
  }
  try {
    return { manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) };
  } catch (err) {
    const detail = err.code ? ` [${err.code}]` : '';
    logError(`Invalid JSON in ${manifestPath}: ${err.message}${detail}`);
    return { failure: { valid: false, errors: [`invalid JSON: ${err.message}`] } };
  }
}

/**
 * Validate a single plugin directory. Thin orchestrator: load + parse the
 * manifest, then run RULES 1–12 (no RULE 10 — reverted) from
 * scripts/lib/plugin-rules.js in order, accumulating into `errors`.
 */
function validatePlugin(pluginDir) {
  const manifestPath = path.join(pluginDir, '.claude-plugin', 'plugin.json');
  const dirName = path.basename(pluginDir);
  const errors = [];
  const marketplacePluginNames = getMarketplacePluginNames();

  const loaded = loadManifest(manifestPath);
  if (loaded.failure) return loaded.failure;
  const { manifest } = loaded;

  console.log(`\n${colors.cyan}Validating plugin: ${dirName}${colors.reset}`);

  ruleRequiredFields(manifest, errors);
  ruleNameMatchesDir(manifest, dirName, errors);
  ruleVersionFormat(manifest, errors);
  ruleDescriptionQuality(manifest);
  ruleKeywords(manifest, errors);
  rulePathFields(manifest, pluginDir, errors);

  // RULES 6/7/8 operate on inline event-keyed hook configs. collectInlineHooks
  // merges the top-level inline-object form and inline objects nested in the
  // array form into a single event-keyed dict.
  const inlineHooks = collectInlineHooks(manifest.hooks);
  const hasInlineHooks = Object.keys(inlineHooks).length > 0;
  ruleInlineHookScripts(manifest, inlineHooks, hasInlineHooks, pluginDir, errors);
  ruleHooksJson(pluginDir, inlineHooks, hasInlineHooks, errors);

  ruleUserConfig(manifest, errors);
  ruleDependencies(manifest, marketplacePluginNames);
  ruleMcpServerEnv(manifest);

  if (errors.length === 0) {
    logSuccess(`Plugin "${manifest.name}" is valid`);
    if (manifest.version) logInfo(`  Version: ${manifest.version}`);
    if (manifest.author) {
      logInfo(
        `  Author: ${typeof manifest.author === 'object' ? manifest.author.name : manifest.author}`
      );
    }
    return { valid: true };
  }
  return { valid: false, errors };
}

/**
 * Discover and validate all plugins in the plugins/ directory
 */
function discoverPlugins() {
  const pluginsDir = path.join(PROJECT_ROOT, 'plugins');
  if (!fs.existsSync(pluginsDir)) {
    logWarning('No plugins/ directory found. Nothing to validate.');
    return [];
  }
  const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => path.join(pluginsDir, e.name));
}

// CLI entry point
if (require.main === module) {
  // Support: node validate-plugin.js [pluginDir]
  //          node validate-plugin.js --plugin <manifest-path>
  let pluginArg = process.argv[2];
  let pluginDirs;

  if (pluginArg === '--plugin' && process.argv[3]) {
    // CI passes --plugin <manifest-path>; resolve to the plugin root
    // directory (two levels up from plugin.json).
    const manifestPath = process.argv[3];
    const fullManifest = path.isAbsolute(manifestPath)
      ? manifestPath
      : path.join(PROJECT_ROOT, manifestPath);
    const pluginRoot = path.dirname(path.dirname(fullManifest));
    pluginArg = pluginRoot;
    // Validate resolved path is within project root. Must use path.sep
    // boundary to prevent sibling-directory bypass.
    if (
      pluginRoot !== PROJECT_ROOT &&
      !pluginRoot.startsWith(PROJECT_ROOT + path.sep)
    ) {
      logError(`--plugin path escapes project root: ${manifestPath}`);
      process.exit(2);
    }
  }

  if (pluginArg) {
    const fullPath = path.isAbsolute(pluginArg)
      ? pluginArg
      : path.join(PROJECT_ROOT, pluginArg);
    if (!fs.existsSync(fullPath)) {
      logError(`Plugin directory not found: ${pluginArg}`);
      process.exit(2);
    }
    pluginDirs = [fullPath];
  } else {
    pluginDirs = discoverPlugins();
  }

  if (pluginDirs.length === 0) {
    logInfo('No plugins found to validate.');
    process.exit(0);
  }

  console.log(
    `\n${colors.cyan}========================================${colors.reset}`
  );
  console.log(
    `${colors.cyan}  Plugin Validator (Official Format)${colors.reset}`
  );
  console.log(
    `${colors.cyan}========================================${colors.reset}`
  );
  logInfo(`Validating ${pluginDirs.length} plugin(s)\n`);

  let hasErrors = false;
  for (const dir of pluginDirs) {
    const result = validatePlugin(dir);
    if (!result.valid) hasErrors = true;
  }

  console.log(
    `\n${colors.cyan}========================================${colors.reset}`
  );
  console.log(`${colors.cyan}  Validation Summary${colors.reset}`);
  console.log(
    `${colors.cyan}========================================${colors.reset}\n`
  );

  if (hasErrors) {
    console.log(
      `${colors.red}✗ Some plugins failed validation${colors.reset}\n`
    );
    process.exit(1);
  } else {
    console.log(
      `${colors.green}✓ All plugins passed validation${colors.reset}\n`
    );
    process.exit(0);
  }
}

module.exports = { validatePlugin };
