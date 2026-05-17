'use strict';

/**
 * Shared reader for `.claude-plugin/marketplace.json`.
 *
 * Extracted from validate-plugin.js + validate-marketplace.js (PR-A,
 * finding 019) so the existence-check + parse logic lives in one place.
 * Both validators previously hand-rolled their own `fs.existsSync` +
 * `JSON.parse(fs.readFileSync(...))` block; a change to one (e.g. encoding
 * handling, error wording) silently diverged from the other.
 */

const fs = require('fs');

/**
 * Read and parse a marketplace.json file.
 *
 * @param {string} marketplacePath - Absolute path to marketplace.json.
 * @returns {{ status: 'ok'|'missing'|'invalid', data?: object, error?: string }}
 *   - status 'ok'      → `data` is the parsed manifest.
 *   - status 'missing' → the file does not exist (a legitimate state for
 *     single-plugin validation outside the monorepo).
 *   - status 'invalid' → the file exists but could not be parsed; `error`
 *     carries the parser message.
 */
function readMarketplaceManifest(marketplacePath) {
  if (!fs.existsSync(marketplacePath)) {
    return { status: 'missing' };
  }
  try {
    const data = JSON.parse(fs.readFileSync(marketplacePath, 'utf8'));
    return { status: 'ok', data };
  } catch (err) {
    return { status: 'invalid', error: err.message };
  }
}

module.exports = { readMarketplaceManifest };
