'use strict';

/**
 * Read-only lookup of the local gh-stack catalog for the check-git-push
 * hook: which branches belong to a stack, and which branch is checked out.
 *
 * gh-stack (v0.2.0+) keeps one JSON catalog per clone at
 * `<git-common-dir>/gh-stack`:
 * `{"schemaVersion":1,"stacks":[{"trunk":{...},"branches":[{"branch":"x"},...]}]}`.
 * The hook only adds a reminder from this, so every failure (no repository,
 * no catalog, an unreadable or unexpected file) returns null and the push
 * goes ahead without one. No git process is started: the hook runs before
 * every Bash command and must stay fast.
 */

const fs = require('fs');
const path = require('path');

// The catalog is small (a few hundred bytes per stack); a larger file is
// not one this hook should parse on every Bash call.
const MAX_CATALOG_BYTES = 1024 * 1024;
const MAX_PARENT_WALK = 100;

function readSmall(file, limit) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > limit) return null;
  return fs.readFileSync(file, 'utf8');
}

/** `{gitDir, commonDir}` for the repository containing `start`, or null. */
function findGitDirs(start) {
  let dir = path.resolve(start);
  for (let n = 0; n < MAX_PARENT_WALK; n += 1) {
    const dotGit = path.join(dir, '.git');
    let stat = null;
    try {
      stat = fs.statSync(dotGit);
    } catch {
      stat = null;
    }
    if (stat) {
      let gitDir = dotGit;
      if (stat.isFile()) {
        // Worktree or submodule: `gitdir: <path>`.
        const m = /^gitdir:\s*(.+?)\s*$/m.exec(readSmall(dotGit, 4096) || '');
        if (!m) return null;
        gitDir = path.resolve(dir, m[1]);
      }
      let commonDir = gitDir;
      try {
        const rel = (readSmall(path.join(gitDir, 'commondir'), 4096) || '').trim();
        if (rel) commonDir = path.resolve(gitDir, rel);
      } catch {
        // No commondir file: the git dir is the common dir.
      }
      return { gitDir, commonDir };
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * @param {string} cwd Directory the Bash command runs in.
 * @returns {{stacked: Set<string>, currentBranch: string|null} | null}
 *   null when there is no repository or no readable gh-stack catalog.
 */
function readStackInfo(cwd) {
  try {
    const dirs = findGitDirs(cwd);
    if (!dirs) return null;
    const raw = readSmall(path.join(dirs.commonDir, 'gh-stack'), MAX_CATALOG_BYTES);
    if (raw === null) return null;
    const catalog = JSON.parse(raw);
    if (!catalog || !Array.isArray(catalog.stacks)) return null;
    const stacked = new Set();
    for (const stack of catalog.stacks) {
      if (!stack || !Array.isArray(stack.branches)) continue;
      for (const ref of stack.branches) {
        if (ref && typeof ref.branch === 'string' && ref.branch !== '') stacked.add(ref.branch);
      }
    }
    let currentBranch = null;
    try {
      const head = readSmall(path.join(dirs.gitDir, 'HEAD'), 4096) || '';
      const m = /^ref:\s*refs\/heads\/(.+?)\s*$/m.exec(head);
      if (m) currentBranch = m[1];
    } catch {
      currentBranch = null;
    }
    return { stacked, currentBranch };
  } catch {
    return null;
  }
}

module.exports = { readStackInfo };
