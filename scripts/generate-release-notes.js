#!/usr/bin/env node
/**
 * generate-release-notes.js
 *
 * Generates release-notes.md for a GitHub Release by combining:
 *   1. The catalog-level section from root CHANGELOG.md
 *   2. A Plugin Versions table from plugins/<name>/package.json
 *
 * Usage:
 *   node scripts/generate-release-notes.js [version]
 *   # version defaults to root package.json version if not provided
 *
 * Output:
 *   release-notes.md (in project root)
 *
 * Error handling:
 *   - Missing or malformed CHANGELOG.md -> falls back to minimal release header
 *   - Missing plugin package.json -> skip that plugin with a warning
 */

'use strict';

const { readFileSync, writeFileSync, renameSync, unlinkSync, readdirSync, statSync, existsSync } = require('fs');
const { join, resolve } = require('path');

const ROOT = resolve(__dirname, '..');
const CHANGELOG_PATH = join(ROOT, 'CHANGELOG.md');
const PLUGINS_DIR = join(ROOT, 'plugins');
const OUT_PATH = join(ROOT, 'release-notes.md');

const NAME_RE = /^[a-zA-Z0-9_-]+$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(-[a-zA-Z0-9][a-zA-Z0-9.]*)?$/;

// --- Atomic write helper ---
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

// --- Resolve version ---
let version = process.argv[2];
if (!version) {
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    version = pkg.version;
  } catch (e) {
    console.error(`[generate-release-notes] Cannot read package.json: ${e.message}`);
    process.exit(1);
  }
}

if (!SEMVER_RE.test(version)) {
  console.error(`[generate-release-notes] Invalid version: "${version}"`);
  process.exit(1);
}

// --- Extract catalog section from CHANGELOG.md ---
function extractChangelogSection(changelog, ver) {
  const lines = changelog.split('\n');
  const startPattern = new RegExp(`^## \\[?${ver.replace(/\./g, '\\.')}\\]?`);
  const nextPattern = /^## \[?[0-9]/;

  let capturing = false;
  const section = [];

  for (const line of lines) {
    if (!capturing && startPattern.test(line)) {
      capturing = true;
      section.push(line);
      continue;
    }
    if (capturing) {
      if (nextPattern.test(line)) break;
      section.push(line);
    }
  }

  return section.join('\n').trimEnd();
}

let catalogSection = '';
let usedPlaceholder = false;
try {
  const changelog = readFileSync(CHANGELOG_PATH, 'utf8');
  catalogSection = extractChangelogSection(changelog, version);
} catch (e) {
  console.warn(`[generate-release-notes] Warning: Cannot read CHANGELOG.md: ${e.message}`);
}

if (!catalogSection) {
  catalogSection = `## Release v${version}\n\nSee per-plugin changelogs for details.`;
  console.warn(`[generate-release-notes] Warning: No CHANGELOG.md entry found for v${version}. Using placeholder.`);
  usedPlaceholder = true;
}

// --- Build plugin versions table ---
const pluginVersions = [];

if (existsSync(PLUGINS_DIR)) {
  for (const name of readdirSync(PLUGINS_DIR).sort()) {
    if (!NAME_RE.test(name)) continue;
    const pluginPath = join(PLUGINS_DIR, name);
    if (!statSync(pluginPath).isDirectory()) continue;

    const pkgPath = join(pluginPath, 'package.json');
    if (!existsSync(pkgPath)) continue;

    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      if (typeof pkg.version === 'string' && SEMVER_RE.test(pkg.version)) {
        pluginVersions.push({ name, version: pkg.version });
      }
    } catch (e) {
      console.warn(`[generate-release-notes] Warning: Cannot read ${pkgPath}: ${e.message}`);
    }
  }
}

let versionsTable = '';
if (pluginVersions.length > 0) {
  // Only add a separator if the catalog section doesn't already end with one
  const separator = catalogSection.endsWith('---') ? '\n\n' : '\n\n---\n\n';
  versionsTable = separator + '## Plugin Versions\n\n';
  versionsTable += '| Plugin | Version |\n|--------|----------|\n';
  for (const { name, version: v } of pluginVersions) {
    versionsTable += `| \`${name}\` | ${v} |\n`;
  }
}

// --- Write output ---
const output = catalogSection + versionsTable + '\n';
atomicWrite(OUT_PATH, output);

console.log(`[generate-release-notes] Written release-notes.md for v${version}`);
console.log(`  Catalog section: ${usedPlaceholder ? 'placeholder' : 'found'}`);
console.log(`  Plugin versions: ${pluginVersions.length} plugins listed`);
