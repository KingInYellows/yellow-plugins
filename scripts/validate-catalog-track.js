#!/usr/bin/env node
/**
 * validate-catalog-track.js
 *
 * Q3 guard for the catalog/Release track (R13, docs/maintenance/
 * catalog-release-gap.md): plugin versions and the root catalog version are
 * independent tracks, and version-packages.yml silently skips the publish
 * phase when the catalog tag for the current root version already exists.
 * This guard fails when any plugin version changed since the last catalog
 * tag while the root package.json version did NOT advance — the exact state
 * that produces the silent skip.
 *
 * Pure core: `computeTrackViolations()` (exported for unit tests).
 * Git shell: reads plugin versions at HEAD from the filesystem and at the
 * catalog tag via `git show v<rootVersion>:plugins/<n>/package.json`.
 * Requires full tag history (CI checkouts need fetch-depth: 0).
 *
 * Exit codes: 0 = no violations (or no catalog tag to compare against),
 * 1 = violations found or the comparison itself failed.
 *
 * Uses only node built-ins — CI calls it before `pnpm install`.
 */

'use strict';

const { execFileSync } = require('child_process');
const { readFileSync, readdirSync, existsSync } = require('fs');
const { join, resolve } = require('path');

const { NAME_RE } = require('./lib/generate/write');

const ROOT = resolve(__dirname, '..');
const SEMVER_RE = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/;

/**
 * Pure comparison core. A violation exists only when the root version did
 * not advance: with the root unchanged, any plugin added, removed, or
 * version-changed since the catalog tag would silently skip the publish
 * phase. Matched by explicit name key, never by count.
 *
 * @returns {string[]} violation messages (empty = OK)
 */
function computeTrackViolations({
  pluginVersionsAtTag,
  pluginVersionsAtHead,
  rootVersionAtTag,
  rootVersionAtHead,
}) {
  if (rootVersionAtTag !== rootVersionAtHead) {
    return []; // root advanced -> the publish phase will arm; nothing to guard
  }
  const violations = [];
  const names = new Set([
    ...Object.keys(pluginVersionsAtTag),
    ...Object.keys(pluginVersionsAtHead),
  ]);
  for (const name of [...names].sort()) {
    const atTag = pluginVersionsAtTag[name];
    const atHead = pluginVersionsAtHead[name];
    if (atTag === atHead) {
      continue;
    }
    if (atTag === undefined) {
      violations.push(
        `plugin "${name}" (${atHead}) was added since catalog tag v${rootVersionAtTag} ` +
          'but the root package.json version did not advance'
      );
    } else if (atHead === undefined) {
      violations.push(
        `plugin "${name}" (${atTag}) was removed since catalog tag v${rootVersionAtTag} ` +
          'but the root package.json version did not advance'
      );
    } else {
      violations.push(
        `plugin "${name}" changed ${atTag} -> ${atHead} since catalog tag v${rootVersionAtTag} ` +
          'but the root package.json version did not advance'
      );
    }
  }
  return violations;
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
}

/** Plugin name -> version from the working tree's plugins/ directory. */
function readVersionsAtHead() {
  const versions = {};
  for (const name of readdirSync(join(ROOT, 'plugins'))) {
    if (!NAME_RE.test(name)) continue;
    const pkgPath = join(ROOT, 'plugins', name, 'package.json');
    if (!existsSync(pkgPath)) continue;
    versions[name] = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
  }
  return versions;
}

/** Plugin name -> version as committed at the given tag. */
function readVersionsAtTag(tag) {
  const versions = {};
  const names = git(['ls-tree', '-d', '--name-only', tag, 'plugins/'])
    .split('\n')
    .filter(Boolean)
    .map((p) => p.replace(/^plugins\//, ''));
  for (const name of names) {
    if (!NAME_RE.test(name)) continue;
    let raw;
    try {
      raw = git(['show', `${tag}:plugins/${name}/package.json`]);
    } catch (err) {
      const stderr = err.stderr ? err.stderr.toString() : '';
      if (/does not exist|exists on disk, but not in/.test(stderr)) {
        continue; // directory existed at the tag without a package.json
      }
      // Any other git failure means the comparison itself is unreliable —
      // surface it via main()'s comparison-failure handler, never as a
      // misleading "plugin added/removed" verdict.
      throw err;
    }
    versions[name] = JSON.parse(raw).version;
  }
  return versions;
}

function main() {
  const rootVersion = JSON.parse(
    readFileSync(join(ROOT, 'package.json'), 'utf8')
  ).version;
  if (typeof rootVersion !== 'string' || !SEMVER_RE.test(rootVersion)) {
    console.error(
      `[validate-catalog-track] Invalid root package.json version: "${rootVersion}"`
    );
    process.exit(1);
  }

  const tag = `v${rootVersion}`;
  let tagExists = true;
  try {
    execFileSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], {
      cwd: ROOT,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  } catch (err) {
    if (err.status === 1) {
      // `-q --verify` exits 1 with no output when the ref genuinely does
      // not exist — the only condition that legitimately skips the check.
      tagExists = false;
    } else {
      const stderr = err.stderr ? err.stderr.toString().trim() : err.message;
      console.error(
        `[validate-catalog-track] git rev-parse for ${tag} failed (status ${err.status}): ${stderr}`
      );
      process.exit(1);
    }
  }

  if (!tagExists) {
    console.log(
      `[validate-catalog-track] Catalog tag ${tag} not cut yet — root version has ` +
        'advanced, publish phase is armed. Nothing to check.'
    );
    return;
  }

  let violations;
  try {
    violations = computeTrackViolations({
      pluginVersionsAtTag: readVersionsAtTag(tag),
      pluginVersionsAtHead: readVersionsAtHead(),
      rootVersionAtTag: rootVersion,
      rootVersionAtHead: rootVersion,
    });
  } catch (err) {
    console.error(
      `[validate-catalog-track] Comparison against ${tag} failed: ${err.message}. ` +
        'Shallow clone? The tag comparison needs full history (fetch-depth: 0).'
    );
    process.exit(1);
  }

  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`[validate-catalog-track] ERROR: ${violation}`);
    }
    console.error(
      '[validate-catalog-track] Plugin versions moved past the last catalog snapshot; ' +
        'the release publish phase would silently skip. ' +
        'Run `node scripts/catalog-version.js <patch|minor|major>` in the release PR.'
    );
    process.exit(1);
  }
  console.log(
    `[validate-catalog-track] OK: plugin versions match catalog tag ${tag}`
  );
}

if (require.main === module) {
  main();
}

module.exports = { computeTrackViolations };
