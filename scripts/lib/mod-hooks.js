'use strict';

/**
 * The one shape of plugins/<name>/hooks/hooks.json this repository accepts:
 * a Claude Code mod's hooks-module declaration, `{ "modules": ["./x.ts"] }`.
 *
 * Every other hooks/hooks.json stays forbidden (validate-plugin RULE 7,
 * generate-manifests' forbidden sweep): command hooks are generated into
 * plugin.json from catalog/plugins/<name>.json#hooks, and Claude Code
 * auto-loads hooks/hooks.json as a second source beside that block. A mod's
 * hooks module cannot be declared anywhere else, so a file holding only
 * `modules` adds no second command-hook source.
 */

const { lstatSync, readFileSync } = require('fs');
const path = require('path');

const MODULE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
]);

/**
 * Classifies the entry at hooksJsonPath.
 * @returns {{ kind: 'absent' } | { kind: 'mod', module: string } | { kind: 'forbidden', reason: string }}
 */
function classifyHooksJson(hooksJsonPath) {
  let stat;
  try {
    stat = lstatSync(hooksJsonPath);
  } catch (err) {
    // ENOTDIR: `hooks` is a plain file, so nothing can sit beneath it.
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR')
      return { kind: 'absent' };
    return { kind: 'forbidden', reason: `cannot stat: ${err.message}` };
  }
  if (!stat.isFile()) {
    return { kind: 'forbidden', reason: 'not a regular file' };
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(hooksJsonPath, 'utf8'));
  } catch (err) {
    return { kind: 'forbidden', reason: `invalid JSON: ${err.message}` };
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.keys(parsed).length !== 1 ||
    !Array.isArray(parsed.modules)
  ) {
    return {
      kind: 'forbidden',
      reason: 'holds something other than a lone "modules" key',
    };
  }
  if (parsed.modules.length !== 1 || typeof parsed.modules[0] !== 'string') {
    return {
      kind: 'forbidden',
      reason: '"modules" must name exactly one hooks module path',
    };
  }
  const modulePath = parsed.modules[0];
  if (!modulePath.startsWith('./') || modulePath.split('/').includes('..')) {
    return {
      kind: 'forbidden',
      reason: `module path "${modulePath}" must start with ./ and stay inside hooks/`,
    };
  }
  if (!MODULE_EXTENSIONS.has(path.extname(modulePath))) {
    return {
      kind: 'forbidden',
      reason: `module path "${modulePath}" has no hooks-module extension`,
    };
  }
  const resolved = path.join(path.dirname(hooksJsonPath), modulePath);
  let moduleStat;
  try {
    moduleStat = lstatSync(resolved);
  } catch (_) {
    return { kind: 'forbidden', reason: `module "${modulePath}" not found` };
  }
  if (!moduleStat.isFile()) {
    return {
      kind: 'forbidden',
      reason: `module "${modulePath}" is not a regular file`,
    };
  }
  return { kind: 'mod', module: modulePath };
}

module.exports = { classifyHooksJson, MODULE_EXTENSIONS };
