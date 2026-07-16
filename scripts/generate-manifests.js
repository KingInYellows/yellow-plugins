#!/usr/bin/env node
/**
 * generate-manifests.js
 *
 * Regenerates the Claude distribution artifacts from the neutral catalog
 * sources (R4, R8, R9):
 *
 *   catalog/catalog.json + catalog/plugins/<name>.json + plugins/<name>/package.json
 *     -> plugins/<name>/.claude-plugin/plugin.json   (per Claude-enabled plugin)
 *     -> .claude-plugin/marketplace.json
 *
 * Modes:
 *   (default)   Apply: atomically rewrite every target whose bytes differ.
 *   --check     Compute every target's serialized bytes vs the committed
 *               file; exit nonzero while ANY difference remains. Performs
 *               zero writes.
 *   --dry-run   Print the same diff report as --check but always exit 0
 *               (unless the catalog itself is invalid).
 *
 * Exported for in-process tests: `generateManifests({ mode, rootDir })`.
 */

'use strict';

const { readFileSync } = require('fs');
const { join, relative, resolve } = require('path');

const { loadCatalog, loadPluginSources } = require('./lib/generate/catalog-reader');
const { buildPluginManifest, buildMarketplace } = require('./lib/generate/emit-claude');
const { assertWithinRoot, atomicWrite, serializeJson } = require('./lib/generate/write');

const DEFAULT_ROOT = resolve(__dirname, '..');
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

// Fields every catalog plugin source must carry for the builders to emit a
// complete manifest + marketplace entry. Checked up front so apply mode can
// never write a manifest with silently-dropped keys.
const REQUIRED_SOURCE_KEYS = [
  '$schema', 'description', 'author', 'homepage', 'repository', 'license',
  'keywords', 'marketplace', 'targets',
];

function validateSource(name, source, errors) {
  for (const key of REQUIRED_SOURCE_KEYS) {
    if (!(key in source)) {
      errors.push(`catalog/plugins/${name}.json: missing required key "${key}"`);
    }
  }
  if (source.marketplace) {
    for (const key of ['category', 'source']) {
      if (!(key in source.marketplace)) {
        errors.push(`catalog/plugins/${name}.json: missing required key "marketplace.${key}"`);
      }
    }
  }
}

/**
 * Compute (and in apply mode, write) every generated target.
 *
 * @param {{ mode?: 'apply'|'check'|'dry-run', rootDir?: string }} [options]
 * @returns {{
 *   status: 'ok'|'error',
 *   errors: string[],
 *   diffs: { path: string, state: 'differs'|'missing' }[],
 *   written: string[],
 *   checked: number,
 * }}
 */
function generateManifests({ mode = 'apply', rootDir = DEFAULT_ROOT } = {}) {
  const errors = [];
  const result = { status: 'ok', errors, diffs: [], written: [], checked: 0 };

  const catalogResult = loadCatalog(join(rootDir, 'catalog'));
  if (catalogResult.status === 'missing') {
    errors.push(`catalog not found at ${catalogResult.path}`);
    result.status = 'error';
    return result;
  }
  if (catalogResult.status === 'invalid') {
    errors.push(...catalogResult.errors);
    result.status = 'error';
    return result;
  }
  const catalog = catalogResult.data;

  const sourcesResult = loadPluginSources(join(rootDir, 'catalog'), catalog.pluginOrder);
  if (sourcesResult.status === 'invalid') {
    errors.push(...sourcesResult.errors);
    result.status = 'error';
    return result;
  }
  const sources = sourcesResult.sources;

  // Versions come from plugins/<name>/package.json only (R3). Matched by
  // explicit name key: pkg.name must equal the catalog source name.
  const pkgs = {};
  for (const name of catalog.pluginOrder) {
    validateSource(name, sources[name], errors);
    const pkgPath = join(rootDir, 'plugins', name, 'package.json');
    try {
      assertWithinRoot(pkgPath, join(rootDir, 'plugins'));
    } catch (err) {
      errors.push(err.message);
      continue;
    }
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    } catch (err) {
      errors.push(`cannot read plugins/${name}/package.json: ${err.message}`);
      continue;
    }
    if (pkg.name !== name) {
      errors.push(
        `plugins/${name}/package.json "name" is "${pkg.name}", expected "${name}"`
      );
      continue;
    }
    if (typeof pkg.version !== 'string' || !SEMVER_RE.test(pkg.version)) {
      errors.push(
        `plugins/${name}/package.json has invalid or missing version: "${pkg.version}"`
      );
      continue;
    }
    pkgs[name] = pkg;
  }
  if (errors.length > 0) {
    result.status = 'error';
    return result;
  }

  // Assemble every target's serialized bytes before touching the filesystem.
  const targets = [];
  for (const name of catalog.pluginOrder) {
    const source = sources[name];
    if (!source.targets || source.targets.claude !== true) {
      continue;
    }
    const targetPath = join(rootDir, 'plugins', name, '.claude-plugin', 'plugin.json');
    assertWithinRoot(targetPath, join(rootDir, 'plugins'));
    targets.push({
      path: targetPath,
      bytes: serializeJson(buildPluginManifest(source, pkgs[name])),
    });
  }
  targets.push({
    path: join(rootDir, '.claude-plugin', 'marketplace.json'),
    bytes: serializeJson(buildMarketplace(catalog, sources, pkgs)),
  });

  result.checked = targets.length;
  for (const target of targets) {
    let current = null;
    try {
      current = readFileSync(target.path, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') {
        errors.push(`cannot read ${target.path}: ${err.message}`);
        continue;
      }
    }
    if (current === target.bytes) {
      continue;
    }
    const rel = relative(rootDir, target.path);
    result.diffs.push({ path: rel, state: current === null ? 'missing' : 'differs' });
    if (mode === 'apply') {
      atomicWrite(target.path, target.bytes);
      result.written.push(rel);
    }
  }
  if (errors.length > 0) {
    result.status = 'error';
  }
  return result;
}

function main() {
  const args = process.argv.slice(2);
  const known = new Set(['--check', '--dry-run']);
  const unknown = args.filter((a) => !known.has(a));
  if (unknown.length > 0) {
    console.error(`[generate-manifests] Unknown argument(s): ${unknown.join(' ')}`);
    console.error('[generate-manifests] Usage: node scripts/generate-manifests.js [--check | --dry-run]');
    process.exit(1);
  }
  if (args.includes('--check') && args.includes('--dry-run')) {
    console.error('[generate-manifests] --check and --dry-run are mutually exclusive');
    process.exit(1);
  }
  const mode = args.includes('--check') ? 'check' : args.includes('--dry-run') ? 'dry-run' : 'apply';

  // Test hook (validator-harness precedent): point the CLI at a fixture tree.
  const rootDir = process.env.GENERATE_MANIFESTS_ROOT || DEFAULT_ROOT;
  const result = generateManifests({ mode, rootDir });

  if (result.status === 'error') {
    for (const error of result.errors) {
      console.error(`[generate-manifests] ERROR: ${error}`);
    }
    process.exit(1);
  }

  for (const diff of result.diffs) {
    console.log(`[generate-manifests] DRIFT: ${diff.path} (${diff.state})`);
  }

  if (mode === 'apply') {
    console.log(
      `[generate-manifests] Complete: ${result.checked} targets checked, ${result.written.length} rewritten`
    );
    return;
  }

  if (result.diffs.length > 0) {
    console.log(
      `[generate-manifests] ${result.diffs.length} of ${result.checked} generated files ` +
        `differ from catalog/ sources. Run \`pnpm generate:manifests\` to regenerate.`
    );
    // --check fails while ANY diff remains; --dry-run always reports cleanly.
    process.exit(mode === 'check' ? 1 : 0);
  }
  console.log(`[generate-manifests] All ${result.checked} generated files match catalog/ sources`);
}

if (require.main === module) {
  main();
}

module.exports = { generateManifests };
