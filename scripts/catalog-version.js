#!/usr/bin/env node
/**
 * catalog-version.js
 *
 * Bumps the catalog version in the root package.json.
 * The catalog version tracks the overall marketplace snapshot (released as a
 * GitHub Release tag), independent of individual plugin versions.
 *
 * Usage:
 *   node scripts/catalog-version.js <major|minor|patch>
 *
 * Security:
 *   - Validates bump type against an allowlist (major|minor|patch)
 *   - Validates current version is valid semver before bumping
 *   - Atomic write via tmp file + renameSync
 *
 * Error handling:
 *   - Missing or invalid bump type -> exit 1 with usage message
 *   - Invalid current version in package.json -> exit 1
 *   - Write errors -> exit 1
 */

'use strict';

const { readFileSync, writeFileSync, renameSync, unlinkSync } = require('fs');
const { join } = require('path');

const semver = require('semver');

const ROOT = join(__dirname, '..');
const PKG_PATH = join(ROOT, 'package.json');

const VALID_BUMPS = new Set(['major', 'minor', 'patch']);

const bump = process.argv[2];

if (!bump || !VALID_BUMPS.has(bump)) {
  console.error('[catalog-version] Usage: node scripts/catalog-version.js <major|minor|patch>');
  process.exit(1);
}

function atomicWrite(filePath, content) {
  const tmp = filePath + '.tmp';
  writeFileSync(tmp, content, 'utf8');
  try {
    renameSync(tmp, filePath);
  } catch (e) {
    try { unlinkSync(tmp); } catch (_) { /* ignore cleanup errors */ }
    throw new Error(`[atomicWrite] rename ${tmp} -> ${filePath} failed: ${e.message}`);
  }
}

// --- Read package.json ---
let pkg;
try {
  pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8'));
} catch (e) {
  console.error(`[catalog-version] Cannot read package.json: ${e.message}`);
  process.exit(1);
}

const current = pkg.version;

if (!semver.valid(current)) {
  console.error(
    `[catalog-version] Invalid current version in package.json: "${current}". ` +
      'Expected a semver string (e.g. "1.0.0").'
  );
  process.exit(1);
}

const next = semver.inc(current, bump);
if (!next) {
  console.error(`[catalog-version] Could not increment version "${current}" with bump type "${bump}"`);
  process.exit(1);
}

pkg.version = next;
atomicWrite(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n');

console.log(`[catalog-version] Bumped catalog version: ${current} -> ${next}`);
