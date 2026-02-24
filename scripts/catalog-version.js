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

const { readFileSync, writeFileSync, renameSync } = require('fs');
const { join } = require('path');

const ROOT = join(__dirname, '..');
const PKG_PATH = join(ROOT, 'package.json');

const VALID_BUMPS = new Set(['major', 'minor', 'patch']);
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

const bump = process.argv[2];

if (!bump || !VALID_BUMPS.has(bump)) {
  console.error('[catalog-version] Usage: node scripts/catalog-version.js <major|minor|patch>');
  process.exit(1);
}

function atomicWrite(filePath, content) {
  const tmp = filePath + '.tmp';
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, filePath);
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
const match = SEMVER_RE.exec(current);

if (!match) {
  console.error(
    `[catalog-version] Invalid current version in package.json: "${current}". ` +
      'Expected a semver string (e.g. "1.0.0").'
  );
  process.exit(1);
}

let [, major, minor, patch] = match.map(Number);

if (bump === 'major') {
  major += 1;
  minor = 0;
  patch = 0;
} else if (bump === 'minor') {
  minor += 1;
  patch = 0;
} else {
  patch += 1;
}

const next = `${major}.${minor}.${patch}`;

pkg.version = next;
atomicWrite(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n');

console.log(`[catalog-version] Bumped catalog version: ${current} -> ${next}`);
