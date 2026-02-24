#!/usr/bin/env node

/**
 * Marketplace Schema Validator
 *
 * Validates .claude-plugin/marketplace.json against the official Claude Code
 * marketplace format and enforces additional business rules.
 *
 * Usage:
 *   node scripts/validate-marketplace.js
 *   node scripts/validate-marketplace.js --marketplace path/to/marketplace.json
 *
 * Exit codes:
 *   0 - Validation passed
 *   1 - Validation failed
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_MARKETPLACE_PATH = '.claude-plugin/marketplace.json';
const PROJECT_ROOT = process.cwd();

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function assertWithinRoot(filePath, rootDir) {
  const canonical = path.resolve(filePath);
  const rootCanonical = path.resolve(rootDir);
  if (canonical !== rootCanonical && !canonical.startsWith(rootCanonical + path.sep)) {
    throw new Error(`[validate-marketplace] Path traversal detected: ${filePath}`);
  }
}

const args = process.argv.slice(2);
let marketplacePath = DEFAULT_MARKETPLACE_PATH;

const marketplaceFlagIndex = args.indexOf('--marketplace');
if (marketplaceFlagIndex !== -1) {
  const providedPath = args[marketplaceFlagIndex + 1];
  if (!providedPath || providedPath.startsWith('--')) {
    console.error(
      `${colors.red}✗ ERROR:${colors.reset} Missing value for --marketplace flag`
    );
    process.exit(1);
  }
  marketplacePath = providedPath;
  const fullMarketplacePath = path.resolve(PROJECT_ROOT, marketplacePath);
  try {
    assertWithinRoot(fullMarketplacePath, PROJECT_ROOT);
  } catch (err) {
    console.error(`${colors.red}✗ ERROR:${colors.reset} ${err.message}`);
    process.exit(1);
  }
}

const errors = [];
const warnings = [];
let marketplace = null;

function logError(message) {
  errors.push(message);
  console.error(`${colors.red}✗ ERROR:${colors.reset} ${message}`);
}

function logWarning(message) {
  warnings.push(message);
  console.warn(`${colors.yellow}⚠ WARNING:${colors.reset} ${message}`);
}

function logInfo(message) {
  console.log(`${colors.blue}ℹ INFO:${colors.reset} ${message}`);
}

function logSuccess(message) {
  console.log(`${colors.green}✓ PASS:${colors.reset} ${message}`);
}

/**
 * RULE 1: Load and parse marketplace.json
 */
function validateFileExists() {
  const fullPath = path.join(PROJECT_ROOT, marketplacePath);

  if (!fs.existsSync(fullPath)) {
    logError(`Marketplace file not found: ${marketplacePath}`);
    return false;
  }

  try {
    const content = fs.readFileSync(fullPath, 'utf8');
    marketplace = JSON.parse(content);
    logSuccess(`Marketplace file loaded: ${marketplacePath}`);
    return true;
  } catch (err) {
    logError(`Failed to parse marketplace.json: ${err.message}`);
    return false;
  }
}

/**
 * RULE 2: Official schema compliance (flat format)
 */
function validateOfficialFormat() {
  logInfo('Validating official Claude Code marketplace format...');

  // Required: name
  if (!marketplace.name || typeof marketplace.name !== 'string') {
    logError('Missing or invalid required field: "name" (string)');
  } else {
    logSuccess(`Marketplace name: ${marketplace.name}`);
  }

  // Required: plugins array
  if (!Array.isArray(marketplace.plugins)) {
    logError('Missing or invalid required field: "plugins" (array)');
  } else {
    logSuccess(`Found ${marketplace.plugins.length} plugin(s)`);
  }

  // Optional but recommended: owner
  if (marketplace.owner) {
    if (
      typeof marketplace.owner.name !== 'string' ||
      marketplace.owner.name.trim() === ''
    ) {
      logWarning('owner.name is missing or empty');
    } else {
      logSuccess(`Owner: ${marketplace.owner.name}`);
    }
  }

  // Optional: metadata
  if (marketplace.metadata && marketplace.metadata.version) {
    const semverPattern = /^[0-9]+\.[0-9]+\.[0-9]+$/;
    if (!semverPattern.test(marketplace.metadata.version)) {
      logError(
        `Invalid metadata.version format: ${marketplace.metadata.version} (must be semver)`
      );
    }
  }

  // Warn if using old custom format
  if (marketplace.schemaVersion || marketplace.marketplace) {
    logWarning(
      'Detected old custom format fields (schemaVersion, marketplace). The official format uses flat top-level fields: name, owner, plugins.'
    );
  }
}

/**
 * RULE 3: Plugin name uniqueness
 */
function validatePluginNameUniqueness() {
  if (!Array.isArray(marketplace.plugins)) return;

  logInfo('Validating plugin name uniqueness...');

  const names = marketplace.plugins.map((p) => p.name);
  const duplicates = names.filter(
    (name, index) => names.indexOf(name) !== index
  );

  if (duplicates.length > 0) {
    logError(`Duplicate plugin names: ${[...new Set(duplicates)].join(', ')}`);
  } else {
    logSuccess('All plugin names are unique');
  }
}

/**
 * RULE 4: Required plugin fields (name + source per official format)
 */
function validateRequiredPluginFields() {
  if (!Array.isArray(marketplace.plugins)) return;

  logInfo('Validating required plugin fields...');

  let allValid = true;

  for (const plugin of marketplace.plugins) {
    if (!plugin.name) {
      logError(
        `Plugin missing required field "name": ${JSON.stringify(plugin)}`
      );
      allValid = false;
    }
    if (!plugin.source) {
      logError(
        `Plugin "${plugin.name || '(unnamed)'}" missing required field "source"`
      );
      allValid = false;
    }
  }

  if (allValid && marketplace.plugins.length > 0) {
    logSuccess('All plugins have required fields (name, source)');
  }
}

/**
 * RULE 5: Source path existence (for local sources)
 */
function validateSourcePaths() {
  if (!Array.isArray(marketplace.plugins)) return;

  logInfo('Validating plugin source paths...');

  let allExist = true;

  for (const plugin of marketplace.plugins) {
    if (!plugin.source) continue;

    // Skip remote sources (object format with url)
    if (typeof plugin.source === 'object') {
      logSuccess(
        `Plugin "${plugin.name}" uses remote source: ${plugin.source.url || '(url)'}`
      );
      continue;
    }

    const sourcePath = plugin.source.replace(/^\.\//, '');
    const pluginDir = path.join(PROJECT_ROOT, sourcePath);
    const manifestPath = path.join(pluginDir, '.claude-plugin', 'plugin.json');

    if (!fs.existsSync(pluginDir)) {
      logError(
        `Plugin "${plugin.name}" source directory not found: ${sourcePath}`
      );
      allExist = false;
    } else if (!fs.existsSync(manifestPath)) {
      logError(
        `Plugin "${plugin.name}" missing .claude-plugin/plugin.json at: ${sourcePath}`
      );
      allExist = false;
    } else {
      logSuccess(`Plugin "${plugin.name}" source verified: ${sourcePath}`);
    }
  }

  if (allExist && marketplace.plugins.length > 0) {
    logSuccess('All local plugin source paths exist');
  }
}

/**
 * RULE 6: Version format (marketplace.json versions must be valid semver)
 *
 * Cross-file version consistency (marketplace == plugin.json == package.json)
 * is handled exclusively by validate-versions.js, which uses package.json as
 * the canonical source. This rule only checks semver format.
 */
function validateVersionConsistency() {
  if (!Array.isArray(marketplace.plugins)) return;

  logInfo('Validating version format (semver)...');

  const semverPattern = /^[0-9]+\.[0-9]+\.[0-9]+$/;

  for (const plugin of marketplace.plugins) {
    if (!plugin.version) continue; // absence handled by RULE 7

    if (!semverPattern.test(plugin.version)) {
      logError(
        `Plugin "${plugin.name}" invalid version format: ${plugin.version} (must be semver X.Y.Z)`
      );
    } else {
      logSuccess(
        `Plugin "${plugin.name}" version format valid: ${plugin.version}`
      );
    }
  }
}

/**
 * RULE 7: Version presence (all local plugins must declare a version field)
 *
 * Only checks that the field exists. Cross-file consistency is handled by
 * validate-versions.js.
 */
function validateVersionPresence() {
  if (!Array.isArray(marketplace.plugins)) return;

  logInfo('Validating version presence...');

  let allPresent = true;

  for (const plugin of marketplace.plugins) {
    if (plugin.version) continue;

    // Only require version for local (non-remote) plugins
    if (plugin.source && typeof plugin.source === 'object') continue;

    logError(
      `Plugin "${plugin.name}" is missing a "version" field in marketplace.json.`
    );
    allPresent = false;
  }

  if (allPresent && marketplace.plugins.length > 0) {
    logSuccess('All local plugins have version fields');
  }
}

/**
 * RULE 8: Performance check
 */
function validatePerformance() {
  logInfo('Checking file size...');

  const fullPath = path.join(PROJECT_ROOT, marketplacePath);
  const stats = fs.statSync(fullPath);
  const sizeKB = (stats.size / 1024).toFixed(2);

  if (stats.size > 100 * 1024) {
    logWarning(
      `Marketplace file is large (${sizeKB} KB). Consider optimizing.`
    );
  } else {
    logSuccess(`File size: ${sizeKB} KB`);
  }
}

function printSummary() {
  console.log(
    `\n${colors.cyan}========================================${colors.reset}`
  );
  console.log(`${colors.cyan}  Validation Summary${colors.reset}`);
  console.log(
    `${colors.cyan}========================================${colors.reset}\n`
  );

  if (errors.length === 0 && warnings.length === 0) {
    console.log(
      `${colors.green}✓ All validation checks passed!${colors.reset}\n`
    );
  } else {
    if (errors.length > 0) {
      console.log(
        `${colors.red}✗ ${errors.length} error(s) found${colors.reset}`
      );
    }
    if (warnings.length > 0) {
      console.log(
        `${colors.yellow}⚠ ${warnings.length} warning(s) found${colors.reset}`
      );
    }
    console.log('');
  }
}

function runValidation() {
  console.log(
    `\n${colors.cyan}========================================${colors.reset}`
  );
  console.log(
    `${colors.cyan}  Marketplace Validator (Official Format)${colors.reset}`
  );
  console.log(
    `${colors.cyan}========================================${colors.reset}\n`
  );

  logInfo(`Validating: ${marketplacePath}`);
  logInfo(`Project root: ${PROJECT_ROOT}\n`);

  if (!validateFileExists()) {
    printSummary();
    process.exit(1);
  }

  validateOfficialFormat();
  validatePluginNameUniqueness();
  validateRequiredPluginFields();
  validateSourcePaths();
  validateVersionConsistency();
  validateVersionPresence();
  validatePerformance();

  printSummary();
  process.exit(errors.length > 0 ? 1 : 0);
}

runValidation();
