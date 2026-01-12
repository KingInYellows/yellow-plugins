#!/usr/bin/env node

/**
 * Plugin Manifest Validator
 *
 * Validates .claude-plugin/plugin.json against schema and additional business rules.
 * Exit codes: 0 = valid, 1 = invalid, 2 = file not found
 *
 * Usage:
 *   node validate-plugin.js <path-to-plugin-directory>
 *   node validate-plugin.js plugins/hookify
 */

const fs = require('fs');
const path = require('path');

const Ajv = require('ajv');
const addFormats = require('ajv-formats');

// Load schemas
const pluginSchemaPath = path.join(__dirname, '../schemas/plugin.schema.json');
const pluginSchema = JSON.parse(fs.readFileSync(pluginSchemaPath, 'utf-8'));

// Initialize AJV with formats (email, uri, etc.)
const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(pluginSchema);

/**
 * Validation Rule 1: Schema Compliance
 */
function validateSchema(manifest) {
  const valid = validate(manifest);
  if (!valid) {
    return {
      valid: false,
      errors: validate.errors.map(err => ({
        rule: 'SCHEMA_COMPLIANCE',
        field: err.instancePath || '(root)',
        message: err.message,
        params: err.params
      }))
    };
  }
  return { valid: true };
}

/**
 * Validation Rule 2: Name-Version Consistency
 * Plugin name must match directory name (kebab-case convention)
 */
function validateNamingConsistency(manifest, pluginDir) {
  const dirName = path.basename(pluginDir);
  if (manifest.name !== dirName) {
    return {
      valid: false,
      errors: [{
        rule: 'NAME_CONSISTENCY',
        field: 'name',
        message: `Plugin name '${manifest.name}' must match directory name '${dirName}'`
      }]
    };
  }
  return { valid: true };
}

/**
 * Validation Rule 3: Entrypoint File Existence
 * All declared entrypoint files must exist
 */
function validateEntrypointFiles(manifest, pluginDir) {
  const errors = [];
  const entrypoints = manifest.entrypoints || {};

  for (const [type, paths] of Object.entries(entrypoints)) {
    if (!Array.isArray(paths)) continue;

    for (const relativePath of paths) {
      const fullPath = path.join(pluginDir, relativePath);
      if (!fs.existsSync(fullPath)) {
        errors.push({
          rule: 'ENTRYPOINT_EXISTS',
          field: `entrypoints.${type}`,
          message: `Entrypoint file not found: ${relativePath}`
        });
      }
    }
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

/**
 * Validation Rule 4: Lifecycle Script Existence
 * All declared lifecycle scripts must exist and be executable
 */
function validateLifecycleScripts(manifest, pluginDir) {
  const errors = [];
  const lifecycle = manifest.lifecycle || {};

  for (const [hook, scriptPath] of Object.entries(lifecycle)) {
    const fullPath = path.join(pluginDir, scriptPath);

    if (!fs.existsSync(fullPath)) {
      errors.push({
        rule: 'LIFECYCLE_SCRIPT_EXISTS',
        field: `lifecycle.${hook}`,
        message: `Lifecycle script not found: ${scriptPath}`
      });
    } else {
      // Check if script is executable (Unix-like systems only)
      try {
        const stats = fs.statSync(fullPath);
        if (process.platform !== 'win32') {
          const isExecutable = (stats.mode & fs.constants.S_IXUSR) !== 0;
          if (!isExecutable) {
            errors.push({
              rule: 'LIFECYCLE_SCRIPT_EXECUTABLE',
              field: `lifecycle.${hook}`,
              message: `Lifecycle script not executable: ${scriptPath}. Run: chmod +x ${scriptPath}`
            });
          }
        }
      } catch (err) {
        // Ignore stat errors (file may not exist, already caught above)
      }
    }
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

/**
 * Validation Rule 5: Permission Scope Constraints
 * Paths/domains/commands must be specified for their respective scopes
 */
function validatePermissionConstraints(manifest) {
  const errors = [];
  const permissions = manifest.permissions || [];

  for (let i = 0; i < permissions.length; i++) {
    const perm = permissions[i];
    const prefix = `permissions[${i}]`;

    // Filesystem scope should have paths
    if (perm.scope === 'filesystem' && (!perm.paths || perm.paths.length === 0)) {
      errors.push({
        rule: 'PERMISSION_CONSTRAINT',
        field: `${prefix}.paths`,
        message: 'Filesystem permission should specify paths for transparency (or omit for unrestricted)'
      });
    }

    // Network scope should have domains
    if (perm.scope === 'network' && (!perm.domains || perm.domains.length === 0)) {
      errors.push({
        rule: 'PERMISSION_CONSTRAINT',
        field: `${prefix}.domains`,
        message: 'Network permission should specify domains for transparency (or omit for unrestricted)'
      });
    }

    // Shell scope should have commands
    if (perm.scope === 'shell' && (!perm.commands || perm.commands.length === 0)) {
      errors.push({
        rule: 'PERMISSION_CONSTRAINT',
        field: `${prefix}.commands`,
        message: 'Shell permission should specify commands for transparency (or omit for unrestricted)'
      });
    }

    // Env scope should have envVars
    if (perm.scope === 'env' && (!perm.envVars || perm.envVars.length === 0)) {
      errors.push({
        rule: 'PERMISSION_CONSTRAINT',
        field: `${prefix}.envVars`,
        message: 'Environment permission should specify variables for transparency (or omit for unrestricted)'
      });
    }
  }

  // Note: These are warnings, not hard errors. Return as valid but log warnings.
  if (errors.length > 0) {
    console.warn('\n⚠️  Permission Transparency Warnings:');
    errors.forEach(err => console.warn(`   - ${err.message}`));
  }

  return { valid: true };
}

/**
 * Validation Rule 6: Node.js Version Range
 * If nodeMin specified, must be 18-24 (NOT 25+)
 */
function validateNodeVersion(manifest) {
  const nodeMin = manifest.compatibility?.nodeMin;
  if (nodeMin) {
    const version = parseInt(nodeMin, 10);
    if (version < 18 || version > 24) {
      return {
        valid: false,
        errors: [{
          rule: 'NODE_VERSION_RANGE',
          field: 'compatibility.nodeMin',
          message: `Node.js version must be 18-24 (got ${version}). Claude Code does NOT support Node.js 25+.`
        }]
      };
    }
  }
  return { valid: true };
}

/**
 * Validation Rule 7: Plugin Dependency Resolution
 * If pluginDependencies specified, warn about install order
 */
function validatePluginDependencies(manifest) {
  const deps = manifest.compatibility?.pluginDependencies || [];
  if (deps.length > 0) {
    console.info(`ℹ️  Plugin Dependencies: ${deps.join(', ')}`);
    console.info('   These plugins must be installed first. Installation will prompt if missing.');
  }
  return { valid: true };
}

/**
 * Validation Rule 8: Description Quality
 * Description should be informative (not just plugin name)
 */
function validateDescriptionQuality(manifest) {
  const desc = manifest.description.toLowerCase();
  const name = manifest.name.toLowerCase().replace(/-/g, ' ');

  if (desc === name || desc.includes('plugin for') || desc.length < 20) {
    return {
      valid: false,
      errors: [{
        rule: 'DESCRIPTION_QUALITY',
        field: 'description',
        message: 'Description should be informative and at least 20 characters. Avoid just repeating the plugin name.'
      }]
    };
  }
  return { valid: true };
}

/**
 * Validation Rule 9: Documentation URLs Reachability
 * Check if README URL returns 200 (optional, network check)
 */
async function validateDocumentationURLs(manifest, skipNetwork = false) {
  if (skipNetwork) {
    return { valid: true };
  }

  const readmeURL = manifest.docs?.readme;
  if (!readmeURL) {
    return { valid: true }; // Already caught by schema
  }

  try {
    const https = require('https');
    const http = require('http');
    const urlObj = new URL(readmeURL);
    const client = urlObj.protocol === 'https:' ? https : http;

    return new Promise((resolve) => {
      const req = client.get(readmeURL, { method: 'HEAD', timeout: 5000 }, (res) => {
        if (res.statusCode >= 200 && res.statusCode < 400) {
          resolve({ valid: true });
        } else {
          resolve({
            valid: false,
            errors: [{
              rule: 'DOCUMENTATION_REACHABILITY',
              field: 'docs.readme',
              message: `README URL returned ${res.statusCode}: ${readmeURL}`
            }]
          });
        }
      });

      req.on('error', (err) => {
        resolve({
          valid: false,
          errors: [{
            rule: 'DOCUMENTATION_REACHABILITY',
            field: 'docs.readme',
            message: `README URL unreachable: ${err.message}`
          }]
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          valid: false,
          errors: [{
            rule: 'DOCUMENTATION_REACHABILITY',
            field: 'docs.readme',
            message: 'README URL timeout (5s)'
          }]
        });
      });
    });
  } catch (err) {
    return {
      valid: false,
      errors: [{
        rule: 'DOCUMENTATION_REACHABILITY',
        field: 'docs.readme',
        message: `Invalid README URL: ${err.message}`
      }]
    };
  }
}

/**
 * Validation Rule 10: Semantic Version Compliance
 * Version must be valid semver (already enforced by schema, but double-check)
 */
function validateSemanticVersion(manifest) {
  const version = manifest.version;
  const parts = version.split('.');

  if (parts.length !== 3) {
    return {
      valid: false,
      errors: [{
        rule: 'SEMANTIC_VERSION',
        field: 'version',
        message: `Invalid semver format: ${version}. Must be MAJOR.MINOR.PATCH (e.g., 1.2.3)`
      }]
    };
  }

  const [major, minor, patch] = parts.map(p => parseInt(p, 10));
  if (isNaN(major) || isNaN(minor) || isNaN(patch)) {
    return {
      valid: false,
      errors: [{
        rule: 'SEMANTIC_VERSION',
        field: 'version',
        message: `Version parts must be integers: ${version}`
      }]
    };
  }

  return { valid: true };
}

/**
 * Validation Rule 11: Repository URL Matches Homepage
 * If both specified, should point to same base repository
 */
function validateRepositoryConsistency(manifest) {
  const repoURL = manifest.repository?.url;
  const homepage = manifest.homepage;

  if (repoURL && homepage) {
    try {
      const repoBase = new URL(repoURL).hostname;
      const homeBase = new URL(homepage).hostname;

      if (repoBase !== homeBase) {
        console.warn(`⚠️  Repository and homepage on different domains: ${repoBase} vs ${homeBase}`);
      }
    } catch (err) {
      // URL parsing errors already caught by schema
    }
  }

  return { valid: true };
}

/**
 * Validation Rule 12: Keywords Relevance
 * Keywords should not duplicate name/description words
 */
function validateKeywordRelevance(manifest) {
  const keywords = manifest.keywords || [];
  const name = manifest.name.toLowerCase();
  const descWords = manifest.description.toLowerCase().split(/\s+/);

  const duplicates = keywords.filter(kw =>
    kw === name || descWords.some(word => word.includes(kw))
  );

  if (duplicates.length > 0) {
    console.warn(`⚠️  Redundant keywords (already in name/description): ${duplicates.join(', ')}`);
  }

  return { valid: true };
}

/**
 * Main Validation Function
 */
async function validatePlugin(pluginDir, options = {}) {
  const manifestPath = path.join(pluginDir, '.claude-plugin', 'plugin.json');

  // Check manifest exists
  if (!fs.existsSync(manifestPath)) {
    console.error(`❌ plugin.json not found at: ${manifestPath}`);
    return { valid: false, exitCode: 2 };
  }

  // Parse manifest
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch (err) {
    console.error(`❌ Invalid JSON in plugin.json: ${err.message}`);
    return { valid: false, exitCode: 1 };
  }

  console.log(`\n🔍 Validating plugin: ${manifest.name || '(unnamed)'}\n`);

  // Run all validation rules
  const results = [
    validateSchema(manifest),
    validateNamingConsistency(manifest, pluginDir),
    validateEntrypointFiles(manifest, pluginDir),
    validateLifecycleScripts(manifest, pluginDir),
    validatePermissionConstraints(manifest),
    validateNodeVersion(manifest),
    validatePluginDependencies(manifest),
    validateDescriptionQuality(manifest),
    validateSemanticVersion(manifest),
    validateRepositoryConsistency(manifest),
    validateKeywordRelevance(manifest)
  ];

  // Add async validation (network check)
  if (!options.skipNetwork) {
    results.push(await validateDocumentationURLs(manifest, options.skipNetwork));
  }

  // Collect all errors
  const allErrors = results.flatMap(r => r.errors || []);

  if (allErrors.length > 0) {
    console.error('❌ Validation FAILED\n');
    allErrors.forEach(err => {
      console.error(`   [${err.rule}] ${err.field}`);
      console.error(`      ${err.message}\n`);
    });
    return { valid: false, exitCode: 1 };
  }

  console.log('✅ Validation PASSED');
  console.log(`   Plugin: ${manifest.name} v${manifest.version}`);
  console.log(`   Author: ${manifest.author.name}`);
  console.log(`   Entrypoints: ${Object.keys(manifest.entrypoints).join(', ')}\n`);

  return { valid: true, exitCode: 0 };
}

// CLI entry point
if (require.main === module) {
  const pluginDir = process.argv[2];

  if (!pluginDir) {
    console.error('Usage: node validate-plugin.js <plugin-directory>');
    console.error('Example: node validate-plugin.js plugins/hookify');
    process.exit(2);
  }

  const options = {
    skipNetwork: process.argv.includes('--skip-network')
  };

  validatePlugin(pluginDir, options)
    .then(result => process.exit(result.exitCode))
    .catch(err => {
      console.error(`❌ Validation error: ${err.message}`);
      process.exit(2);
    });
}

module.exports = { validatePlugin };
