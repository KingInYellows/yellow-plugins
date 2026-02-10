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
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = process.cwd();

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function logError(message) {
  console.error(`${colors.red}✗ ERROR:${colors.reset} ${message}`);
}

function logWarning(message) {
  console.warn(`${colors.yellow}⚠ WARNING:${colors.reset} ${message}`);
}

function logInfo(message) {
  console.log(`${colors.blue}ℹ INFO:${colors.reset} ${message}`);
}

function logSuccess(message) {
  console.log(`${colors.green}✓ PASS:${colors.reset} ${message}`);
}

/**
 * Validate a single plugin directory
 */
function validatePlugin(pluginDir) {
  const manifestPath = path.join(pluginDir, '.claude-plugin', 'plugin.json');
  const dirName = path.basename(pluginDir);
  const errors = [];

  // Check manifest exists
  if (!fs.existsSync(manifestPath)) {
    logError(`plugin.json not found at: ${manifestPath}`);
    return { valid: false, errors: ['manifest not found'] };
  }

  // Parse JSON
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch (err) {
    logError(`Invalid JSON in ${manifestPath}: ${err.message}`);
    return { valid: false, errors: ['invalid JSON'] };
  }

  console.log(`\n${colors.cyan}Validating plugin: ${dirName}${colors.reset}`);

  // RULE 1: Required fields (official format: name, description, author)
  if (!manifest.name || typeof manifest.name !== 'string') {
    errors.push('Missing required field: "name"');
    logError('Missing required field: "name"');
  }

  if (!manifest.description || typeof manifest.description !== 'string') {
    errors.push('Missing required field: "description"');
    logError('Missing required field: "description"');
  }

  if (!manifest.author) {
    errors.push('Missing required field: "author"');
    logError('Missing required field: "author"');
  } else if (typeof manifest.author === 'object' && !manifest.author.name) {
    errors.push('author.name is required');
    logError('author.name is required');
  }

  // RULE 2: Name matches directory
  if (manifest.name && manifest.name !== dirName) {
    errors.push(`Plugin name "${manifest.name}" does not match directory name "${dirName}"`);
    logError(`Plugin name "${manifest.name}" does not match directory name "${dirName}"`);
  }

  // RULE 3: Version format (if present)
  if (manifest.version) {
    const semverPattern = /^[0-9]+\.[0-9]+\.[0-9]+$/;
    if (!semverPattern.test(manifest.version)) {
      errors.push(`Invalid version format: ${manifest.version}`);
      logError(`Invalid version format: ${manifest.version} (must be MAJOR.MINOR.PATCH)`);
    } else {
      logSuccess(`Version: ${manifest.version}`);
    }
  }

  // RULE 4: Description quality
  if (manifest.description && manifest.description.length < 10) {
    logWarning('Description is very short (< 10 chars). Consider being more descriptive.');
  }

  // RULE 5: Keywords format (if present)
  if (manifest.keywords) {
    if (!Array.isArray(manifest.keywords)) {
      errors.push('keywords must be an array');
      logError('keywords must be an array');
    } else {
      const invalidKeywords = manifest.keywords.filter(kw => typeof kw !== 'string');
      if (invalidKeywords.length > 0) {
        errors.push('All keywords must be strings');
        logError('All keywords must be strings');
      }
    }
  }

  // Summary
  if (errors.length === 0) {
    logSuccess(`Plugin "${manifest.name}" is valid`);
    if (manifest.version) logInfo(`  Version: ${manifest.version}`);
    if (manifest.author) logInfo(`  Author: ${typeof manifest.author === 'object' ? manifest.author.name : manifest.author}`);
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
    .filter(e => e.isDirectory())
    .map(e => path.join(pluginsDir, e.name));
}

// CLI entry point
if (require.main === module) {
  const pluginArg = process.argv[2];
  let pluginDirs;

  if (pluginArg) {
    const fullPath = path.isAbsolute(pluginArg) ? pluginArg : path.join(PROJECT_ROOT, pluginArg);
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

  console.log(`\n${colors.cyan}========================================${colors.reset}`);
  console.log(`${colors.cyan}  Plugin Validator (Official Format)${colors.reset}`);
  console.log(`${colors.cyan}========================================${colors.reset}`);
  logInfo(`Validating ${pluginDirs.length} plugin(s)\n`);

  let hasErrors = false;

  for (const dir of pluginDirs) {
    const result = validatePlugin(dir);
    if (!result.valid) hasErrors = true;
  }

  console.log(`\n${colors.cyan}========================================${colors.reset}`);
  console.log(`${colors.cyan}  Validation Summary${colors.reset}`);
  console.log(`${colors.cyan}========================================${colors.reset}\n`);

  if (hasErrors) {
    console.log(`${colors.red}✗ Some plugins failed validation${colors.reset}\n`);
    process.exit(1);
  } else {
    console.log(`${colors.green}✓ All plugins passed validation${colors.reset}\n`);
    process.exit(0);
  }
}

module.exports = { validatePlugin };

  console.log(`${colors.green}✓ All plugins passed validation${colors.reset}\n`);
  process.exit(0);
}
