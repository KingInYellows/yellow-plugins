'use strict';

const { join, relative } = require('path');

const {
  lexistsSync,
  pluginRootProblem,
  resolvePluginRootReal,
  sweepCandidateProblem,
} = require('../plugin-symlink-policy');

const { assertWithinRoot } = require('./write');

/**
 * The catalog plugins whose plugins/<name> root — or plugins/ itself — is
 * a symlink, checked once up front. Each refusal is pushed to `errors`,
 * and the abort gate after the package.json loop returns before any
 * target is assembled, so the only loop that consults the set is that
 * first one (to skip the refused plugin's own package.json read). Such a
 * root is invisible to every per-path check (they walk
 * strictly below the root and realpath resolves through it) and would
 * send the sweep and every write elsewhere, so every later per-plugin
 * loop skips the names in this set.
 */
function symlinkedPluginRoots(pluginOrder, pluginsRoot, result, errors) {
  const refused = new Set();
  // plugins/ itself: every per-plugin container is plugins/<name>, so the
  // ancestor walk never lstat's `plugins`, and both-sides realpath resolves
  // through it consistently — a committed `plugins -> elsewhere` would send
  // every write and unlink into the link target with status ok.
  const dirProblem = pluginRootProblem(pluginsRoot);
  if (dirProblem !== null) {
    errors.push(`plugins ${dirProblem}`);
    for (const name of pluginOrder) {
      result.results[name] = 'error';
      refused.add(name);
    }
    return refused;
  }
  for (const name of pluginOrder) {
    const rootProblem = pluginRootProblem(join(pluginsRoot, name));
    if (rootProblem === null) continue;
    errors.push(`plugins/${name} ${rootProblem}`);
    result.results[name] = 'error';
    refused.add(name);
  }
  return refused;
}

/**
 * Queue for unlinking every stale candidate that is still present, not
 * expected, lexically under plugins/ (assertWithinRoot) and — the on-disk
 * half — not reached through a symlink (sweepCandidateProblem). Shared by
 * the Codex and Cursor sweeps.
 */
function queueStaleUnlinks(
  staleCandidates,
  pluginRoot,
  pluginsRoot,
  expectedPaths,
  targets,
  errors,
  rootDir
) {
  const pluginRootReal = resolvePluginRootReal(pluginRoot, errors);
  for (const candidate of staleCandidates) {
    if (expectedPaths.has(candidate) || !lexistsSync(candidate)) continue;
    try {
      assertWithinRoot(candidate, pluginsRoot);
    } catch (err) {
      errors.push(err.message);
      continue;
    }
    const problem = sweepCandidateProblem(
      candidate,
      pluginRoot,
      pluginRootReal,
      rootDir
    );
    if (problem !== null) {
      errors.push(
        `refusing to sweep ${relative(rootDir, candidate)}: ${problem}`
      );
      continue;
    }
    targets.push({ path: candidate, bytes: null });
  }
}

module.exports = {
  queueStaleUnlinks,
  symlinkedPluginRoots,
};
