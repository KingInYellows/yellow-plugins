'use strict';

/**
 * Readers for the neutral catalog sources under `catalog/`.
 *
 * Both entry points return discriminated-union results (the
 * `scripts/lib/marketplace-reader.js` precedent) instead of throwing:
 *   - `loadCatalog`        → { status: 'ok', data } | { status: 'missing', path }
 *                            | { status: 'invalid', path, errors }
 *   - `loadPluginSources`  → { status: 'ok', sources } | { status: 'invalid', errors }
 *
 * Safety properties (R1, R2):
 *   - every plugin name must match the `^[a-zA-Z0-9_-]+$` allowlist
 *   - every derived path is containment-checked via `assertWithinRoot`
 *   - symlinked source files are rejected (`lstatSync`)
 *   - the catalog order and `catalog/plugins/*.json` are cross-checked by
 *     explicit name key in BOTH directions — an order entry with no source
 *     file and a source file missing from the order both fail by name
 *     (never by count).
 */

const { readFileSync, readdirSync, lstatSync, existsSync } = require('fs');
const { join } = require('path');

const { assertWithinRoot, NAME_RE } = require('./write');

// Top-level catalog.json keys the emitters dereference unconditionally.
// Checked here so a malformed catalog.json fails with a clean structured
// error instead of a TypeError inside buildMarketplace.
const REQUIRED_CATALOG_KEYS = ['name', 'description', 'owner', 'metadata', 'pluginOrder', 'targets'];

/**
 * Read + parse one JSON file with symlink rejection. Returns a
 * discriminated union; never throws for expected failure shapes.
 */
function readJsonSource(filePath) {
  if (!existsSync(filePath)) {
    return { status: 'missing' };
  }
  if (lstatSync(filePath).isSymbolicLink()) {
    return { status: 'invalid', error: 'symlinked source files are not allowed' };
  }
  try {
    return { status: 'ok', data: JSON.parse(readFileSync(filePath, 'utf8')) };
  } catch (err) {
    return { status: 'invalid', error: err.message };
  }
}

/**
 * Load and validate `catalog/catalog.json`.
 *
 * @param {string} catalogDir - Absolute path to the catalog/ directory.
 */
function loadCatalog(catalogDir) {
  const path = join(catalogDir, 'catalog.json');
  const read = readJsonSource(path);
  if (read.status === 'missing') {
    return { status: 'missing', path };
  }
  if (read.status === 'invalid') {
    return { status: 'invalid', path, errors: [`catalog.json: ${read.error}`] };
  }

  const data = read.data;
  const errors = [];
  for (const key of REQUIRED_CATALOG_KEYS) {
    if (!(key in data)) {
      errors.push(`catalog.json: missing required key "${key}"`);
    }
  }
  if (
    'targets' in data &&
    (!data.targets ||
      !data.targets.claude ||
      typeof data.targets.claude.marketplaceSchema !== 'string')
  ) {
    errors.push('catalog.json: "targets.claude.marketplaceSchema" must be a string');
  }
  if (!Array.isArray(data.pluginOrder) || data.pluginOrder.length === 0) {
    errors.push('catalog.json: "pluginOrder" must be a non-empty array');
  } else {
    const seen = new Set();
    for (const name of data.pluginOrder) {
      if (typeof name !== 'string' || !NAME_RE.test(name)) {
        errors.push(`catalog.json: pluginOrder entry ${JSON.stringify(name)} fails the [a-zA-Z0-9_-] allowlist`);
        continue;
      }
      if (seen.has(name)) {
        errors.push(`catalog.json: duplicate pluginOrder entry "${name}"`);
      }
      seen.add(name);
    }
  }
  if (errors.length > 0) {
    return { status: 'invalid', path, errors };
  }
  return { status: 'ok', data };
}

/**
 * Load all `catalog/plugins/<name>.json` sources and cross-check them
 * against the catalog order by explicit name key in both directions.
 *
 * @param {string} catalogDir - Absolute path to the catalog/ directory.
 * @param {string[]} pluginOrder - Validated canonical order from loadCatalog.
 * @returns {{ status: 'ok', sources: Record<string, object> }
 *          | { status: 'invalid', errors: string[] }}
 */
function loadPluginSources(catalogDir, pluginOrder) {
  const pluginsDir = join(catalogDir, 'plugins');
  const errors = [];

  let fileNames;
  try {
    fileNames = readdirSync(pluginsDir).filter((f) => f.endsWith('.json'));
  } catch (err) {
    return { status: 'invalid', errors: [`cannot read ${pluginsDir}: ${err.message}`] };
  }

  const onDisk = new Set();
  for (const fileName of fileNames) {
    const name = fileName.slice(0, -'.json'.length);
    if (!NAME_RE.test(name)) {
      errors.push(`catalog/plugins/${fileName}: name fails the [a-zA-Z0-9_-] allowlist`);
      continue;
    }
    onDisk.add(name);
  }

  // Cross-check by explicit name key, both directions.
  for (const name of pluginOrder) {
    if (!onDisk.has(name)) {
      errors.push(`pluginOrder entry "${name}" has no catalog/plugins/${name}.json source file`);
    }
  }
  const orderSet = new Set(pluginOrder);
  for (const name of onDisk) {
    if (!orderSet.has(name)) {
      errors.push(`catalog/plugins/${name}.json is not listed in catalog.json pluginOrder`);
    }
  }
  if (errors.length > 0) {
    return { status: 'invalid', errors };
  }

  const sources = {};
  for (const name of pluginOrder) {
    const filePath = join(pluginsDir, `${name}.json`);
    try {
      assertWithinRoot(filePath, catalogDir);
    } catch (err) {
      errors.push(err.message);
      continue;
    }
    const read = readJsonSource(filePath);
    if (read.status !== 'ok') {
      errors.push(
        `catalog/plugins/${name}.json: ${read.status === 'missing' ? 'file disappeared during read' : read.error}`
      );
      continue;
    }
    sources[name] = read.data;
  }
  if (errors.length > 0) {
    return { status: 'invalid', errors };
  }
  return { status: 'ok', sources };
}

module.exports = { loadCatalog, loadPluginSources };
