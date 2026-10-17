#!/usr/bin/env node

/**
 * run-github-stack-runtime.js — find the github-workflow plugin's
 * lib/github-stack-runtime.js and run it with this process's arguments,
 * stdio, and exit code.
 *
 * Commands cannot reach the runtime as `${CLAUDE_PLUGIN_ROOT}/../github-workflow/...`:
 * that only works in the source tree (plugins/<name>/). The installed cache
 * is <marketplace>/<plugin>/<version>/, so the sibling sits two levels up
 * under its own version directory. Lookup order mirrors yellow-review's
 * lib/sibling-plugin.sh: source sibling first, then the highest numeric
 * <marketplace>/github-workflow/<version>/.
 *
 * Every consuming plugin ships a byte-identical copy in its own lib/
 * (tests/integration/run-github-stack-runtime.test.ts enforces it), because
 * an installed plugin cannot rely on any sibling's path being known.
 *
 * Usage:
 *   node run-github-stack-runtime.js <op> [runtime args ...]
 *   node run-github-stack-runtime.js --locate   # print the runtime path
 *
 * When the runtime is missing, prints a runtime-shaped JSON result with
 * status RUNTIME_NOT_FOUND and a recoveryAction on stdout and exits 0, like
 * the runtime itself: callers branch on `status`, and `set -e` blocks that
 * capture the output still reach their recoveryAction report.
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REL = path.join('lib', 'github-stack-runtime.js');
const VERSION_RE = /^[0-9]+(\.[0-9]+)*$/;

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * @param {string} pluginRoot this plugin's root (source: plugins/<name>,
 *   cache: <marketplace>/<name>/<version>)
 * @returns {string|null}
 */
function locateRuntime(pluginRoot) {
  const sibling = path.join(pluginRoot, '..', 'github-workflow', REL);
  if (isFile(sibling)) return sibling;
  const cacheDir = path.join(pluginRoot, '..', '..', 'github-workflow');
  let versions;
  try {
    versions = fs.readdirSync(cacheDir).filter((v) => VERSION_RE.test(v));
  } catch {
    return null;
  }
  versions.sort(compareVersions).reverse();
  for (const v of versions) {
    const cand = path.join(cacheDir, v, REL);
    if (isFile(cand)) return cand;
  }
  return null;
}

function notFound(op) {
  const recoveryAction =
    'The github-workflow plugin runtime (lib/github-stack-runtime.js) was not found next to this plugin. Install or update the github-workflow plugin, or run /stack:select to switch providers.';
  return {
    operation: op || null,
    command: null,
    exitCode: null,
    status: 'RUNTIME_NOT_FOUND',
    safeSummary: 'github-stack-runtime.js not found -> RUNTIME_NOT_FOUND',
    stdout: '',
    stderr: '',
    recoveryAction,
    mayHaveMutated: false,
  };
}

function main(argv) {
  const pluginRoot = path.resolve(__dirname, '..');
  const runtime = locateRuntime(pluginRoot);
  if (argv[0] === '--locate') {
    if (!runtime) {
      console.error('github-stack-runtime.js not found; is the github-workflow plugin installed?');
      return 1;
    }
    console.log(runtime);
    return 0;
  }
  if (!runtime) {
    console.log(JSON.stringify(notFound(argv[0]), null, 2));
    console.error('github-stack-runtime.js not found; is the github-workflow plugin installed?');
    return 0;
  }
  const res = spawnSync(process.execPath, [runtime, ...argv], { stdio: 'inherit' });
  if (res.error) {
    console.error(`failed to start github-stack-runtime.js: ${res.error.message}`);
    return 1;
  }
  return res.status === null ? 1 : res.status;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { locateRuntime, compareVersions };
