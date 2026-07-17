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
 *   - symlinked source files are rejected atomically with the read, via
 *     `openSync(..., O_NOFOLLOW)` (POSIX-only; this repo's CI is Linux and
 *     dev is WSL2)
 *   - the catalog order and `catalog/plugins/*.json` are cross-checked by
 *     explicit name key in BOTH directions — an order entry with no source
 *     file and a source file missing from the order both fail by name
 *     (never by count).
 */

const { readFileSync, readdirSync, openSync, closeSync, constants } = require('fs');
const { join } = require('path');

const { assertWithinRoot, NAME_RE } = require('./write');

// Top-level catalog.json keys the emitters dereference unconditionally.
// Checked here so a malformed catalog.json fails with a clean structured
// error instead of a TypeError inside buildMarketplace.
const REQUIRED_CATALOG_KEYS = ['name', 'description', 'owner', 'metadata', 'pluginOrder', 'targets'];

/**
 * Read + parse one JSON file with symlink rejection. Returns a
 * discriminated union; never throws for expected failure shapes.
 *
 * The open (with O_NOFOLLOW) and the read happen on the same file
 * descriptor, so there is no TOCTOU window between the symlink check and
 * the read: a symlink swapped in after a separate lstat/exists check would
 * no longer bypass the rejection.
 */
function readJsonSource(filePath) {
  let fd;
  try {
    fd = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { status: 'missing' };
    }
    if (err.code === 'ELOOP') {
      return { status: 'invalid', error: 'symlinked source files are not allowed' };
    }
    return { status: 'invalid', error: err.message };
  }
  try {
    return { status: 'ok', data: JSON.parse(readFileSync(fd, 'utf8')) };
  } catch (err) {
    return { status: 'invalid', error: err.message };
  } finally {
    closeSync(fd);
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
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { status: 'invalid', path, errors: ['catalog.json: top-level value must be an object'] };
  }
  const errors = [];
  for (const key of REQUIRED_CATALOG_KEYS) {
    if (!(key in data)) {
      errors.push(`catalog.json: missing required key "${key}"`);
    }
  }
  // Value-shape checks for the identity fields buildMarketplace splices
  // verbatim into marketplace.json. These mirror the constraints in
  // schemas/official-marketplace.schema.json that a hand-authored catalog.json
  // can violate — name/owner.name minLength, metadata sub-field types — so the
  // generator fails with a source-level error instead of emitting a
  // schema-invalid marketplace under status: 'ok'. Format-level rules
  // (uri/email) remain the AJV schema gate's job.
  if ('name' in data && (typeof data.name !== 'string' || data.name.length === 0)) {
    errors.push('catalog.json: "name" must be a non-empty string');
  }
  if ('description' in data && typeof data.description !== 'string') {
    errors.push('catalog.json: "description" must be a string');
  }
  if ('owner' in data) {
    const owner = data.owner;
    if (owner === null || typeof owner !== 'object' || Array.isArray(owner)) {
      errors.push('catalog.json: "owner" must be an object');
    } else {
      if (typeof owner.name !== 'string' || owner.name.length === 0) {
        errors.push('catalog.json: "owner.name" must be a non-empty string');
      }
      if ('url' in owner && typeof owner.url !== 'string') {
        errors.push('catalog.json: "owner.url" must be a string');
      }
      if ('email' in owner && typeof owner.email !== 'string') {
        errors.push('catalog.json: "owner.email" must be a string');
      }
    }
  }
  if ('metadata' in data) {
    const metadata = data.metadata;
    if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
      errors.push('catalog.json: "metadata" must be an object');
    } else {
      if ('description' in metadata && typeof metadata.description !== 'string') {
        errors.push('catalog.json: "metadata.description" must be a string');
      }
      if (
        'version' in metadata &&
        (typeof metadata.version !== 'string' ||
          !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(metadata.version))
      ) {
        errors.push('catalog.json: "metadata.version" must be a version string (e.g. "1.2.3")');
      }
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
    if (read.data === null || typeof read.data !== 'object' || Array.isArray(read.data)) {
      errors.push(`catalog/plugins/${name}.json: top-level value must be an object`);
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
