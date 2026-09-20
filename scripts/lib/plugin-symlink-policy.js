'use strict';

/**
 * Symlink containment helpers shared by validate-plugin, RULE 7, and
 * generate-manifests stale sweeps. Split from plugin-paths.js so that
 * file stays under Codacy's file-length gate while this policy grows.
 */

const fs = require('fs');
const path = require('path');

const { addError } = require('./logging');

/**
 * Walk the directories strictly between `rootDir` and `filePath` (rootDir
 * itself and the final component excluded) and return the first one that
 * is a symlink, or null when none is. Lexical containment
 * (`resolvePluginPath`, generate-manifests' assertWithinRoot) never touches
 * the filesystem, so `plugins/x/hooks/a.sh` passes it even when `hooks/` is
 * a symlink to somewhere outside the plugin; this is the on-disk half of
 * that check. A component that does not exist (ENOENT, or ENOTDIR under a
 * stale plain file) is treated as not a symlink — the caller's existence
 * check owns that error. Any other lstat failure is rethrown.
 */
function findSymlinkedAncestor(filePath, rootDir) {
  const root = path.resolve(rootDir);
  let dir = path.dirname(path.resolve(filePath));
  const chain = [];
  while (dir !== root && dir.startsWith(root + path.sep)) {
    chain.push(dir);
    dir = path.dirname(dir);
  }
  // Check from the root outward so the outermost symlink is the one named.
  for (const ancestor of chain.reverse()) {
    let st;
    try {
      st = fs.lstatSync(ancestor);
    } catch (err) {
      // ENOENT: not created yet. ENOTDIR: a higher ancestor is a stale
      // plain file the apply pass removes first — same as
      // sweepCandidateProblem's realpath branch. Nothing below either can
      // be a symlink.
      if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') throw err;
      return null;
    }
    if (st.isSymbolicLink()) return ancestor;
  }
  return null;
}

/**
 * True when `realPath` is `realRoot` or a descendant of it. Both arguments
 * are expected to be `fs.realpathSync` output so a symlinked cache root
 * (macOS `/var` -> `/private/var`) compares equal on both sides.
 */
function isWithinRealRoot(realPath, realRoot) {
  return realPath === realRoot || realPath.startsWith(realRoot + path.sep);
}

/**
 * Existence test that does NOT follow symlinks. `fs.existsSync` reports a
 * dangling symlink as absent, but the directory entry is still there — a
 * dangling `hooks/hooks.json` link is still a forbidden file for RULE 7,
 * and a dangling stale artifact still needs unlinking. ENOENT and ENOTDIR
 * (an ancestor is a plain file, so nothing can exist below it) count as
 * absent; any other failure (ELOOP on a symlink cycle, EACCES) counts as
 * PRESENT — an entry the caller cannot inspect must block, not slip past.
 * One implementation shared by validate-plugin RULE 7 and the generator's
 * stale sweep so the two cannot drift.
 */
function lexistsSync(filePath) {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (err) {
    return err.code !== 'ENOENT' && err.code !== 'ENOTDIR';
  }
}

/**
 * "passes through a symlinked directory (<rel>)" when a directory strictly
 * between `rootDir` and `filePath` is a symlink, "cannot be inspected
 * (…)" when the walk fails, or null. The message fragment is shared by
 * the hook-script and path-field validators.
 */
function symlinkedAncestorProblem(filePath, rootDir) {
  try {
    const ancestor = findSymlinkedAncestor(filePath, rootDir);
    return ancestor === null
      ? null
      : `passes through a symlinked directory (${path.relative(rootDir, ancestor)}) which is not permitted`;
  } catch (err) {
    return `cannot be inspected (${err.message})`;
  }
}

/**
 * `fs.realpathSync(pluginRoot)`, or null when the root does not exist
 * (nothing to sweep or write) — any other failure is pushed to `errors`.
 */
function resolvePluginRootReal(pluginRoot, errors) {
  try {
    return fs.realpathSync(pluginRoot);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      errors.push(`cannot resolve real path of ${pluginRoot}: ${err.message}`);
    }
    return null;
  }
}

/**
 * Why a plugin root cannot be operated on, or null. `plugins/<name>`
 * itself being a symlink is the one hole neither findSymlinkedAncestor
 * (which walks strictly below the root) nor both-sides realpath (which
 * resolves through it) can see; the sweep and every generated-file write
 * would follow it out of the repository.
 */
function pluginRootProblem(pluginDir) {
  try {
    // path.resolve drops a trailing separator: `lstat('plugins/x/')`
    // follows the link and reports the target directory.
    if (fs.lstatSync(path.resolve(pluginDir)).isSymbolicLink()) {
      return 'is a symlink — plugin roots must be real directories';
    }
  } catch (err) {
    if (err.code !== 'ENOENT') return `cannot be inspected (${err.message})`;
  }
  return null;
}

function sweepCandidateSymlinkProblem(candidate, pluginRoot, rootDir) {
  try {
    const symlinkedAncestor = findSymlinkedAncestor(candidate, pluginRoot);
    if (symlinkedAncestor === null) return null;
    return `${path.relative(rootDir, symlinkedAncestor)} is a symlink — generated artifacts must not live behind a symlinked directory`;
  } catch (err) {
    return `cannot inspect (${err.message})`;
  }
}

function sweepCandidateRealpathProblem(candidate, pluginRootReal) {
  let candidateReal = null;
  try {
    candidateReal = fs.realpathSync(candidate);
  } catch (err) {
    if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') {
      return `cannot resolve real path (${err.message})`;
    }
    return null;
  }
  if (
    candidateReal !== null &&
    pluginRootReal !== null &&
    !isWithinRealRoot(candidateReal, pluginRootReal)
  ) {
    return 'it resolves outside the plugin directory through a symlink';
  }
  return null;
}

/**
 * Why `candidate` (a path under `pluginRoot` that a sweep is about to
 * unlink, or a generated file it is about to write) must NOT be touched,
 * or null when it is safe. Lexical containment is the caller's job; this
 * is the on-disk half: no symlinked directory between the root and the
 * candidate (unlinking or writing through one reaches a file the
 * generator never owned), and the candidate's real path stays inside the
 * root's real path. A candidate that is itself a symlink is acceptable
 * only when its target stays inside the root (unlinkSync removes the
 * link, never its target; atomicWrite renames over it) — one that
 * resolves outside is refused, and a dangling one has no target to
 * protect. `pluginRootReal` is resolvePluginRootReal()'s result;
 * `rootDir` only shortens the path in the message.
 */
function sweepCandidateProblem(candidate, pluginRoot, pluginRootReal, rootDir) {
  const symlinkProblem = sweepCandidateSymlinkProblem(
    candidate,
    pluginRoot,
    rootDir
  );
  if (symlinkProblem !== null) return symlinkProblem;
  return sweepCandidateRealpathProblem(candidate, pluginRootReal);
}

/**
 * On-disk symlink policy for a hook script already resolved under
 * `pluginDir`: reject a symlinked plugin root, symlinked ancestors, and
 * real paths that escape the plugin. Returns false after pushing an error.
 */
function validateHookScriptSymlinkPolicy(
  scriptPath,
  eventName,
  pluginDir,
  errors
) {
  const rootProblem = pluginRootProblem(pluginDir);
  if (rootProblem !== null) {
    addError(errors, `Plugin directory ${rootProblem}: ${pluginDir}`);
    return false;
  }
  const ancestorProblem = symlinkedAncestorProblem(scriptPath, pluginDir);
  if (ancestorProblem !== null) {
    addError(
      errors,
      `Hook script path ${ancestorProblem} for ${eventName}: ${scriptPath}`
    );
    return false;
  }
  try {
    if (
      !isWithinRealRoot(fs.realpathSync(scriptPath), fs.realpathSync(pluginDir))
    ) {
      addError(
        errors,
        `Hook script resolves outside the plugin directory for ${eventName}: ${scriptPath}`
      );
      return false;
    }
  } catch (realErr) {
    addError(
      errors,
      `Hook script not accessible for ${eventName}: ${scriptPath} (${realErr.message})`
    );
    return false;
  }
  return true;
}

module.exports = {
  findSymlinkedAncestor,
  isWithinRealRoot,
  lexistsSync,
  symlinkedAncestorProblem,
  resolvePluginRootReal,
  pluginRootProblem,
  sweepCandidateProblem,
  validateHookScriptSymlinkPolicy,
};
