'use strict';

/**
 * I/O module replicating plugins/yellow-ci/hooks/scripts/session-start.sh.
 *
 * Detects CI context and surfaces recent-failure + runner-routing context as a
 * SessionStart `systemMessage`. Dependency-free Node (no `jq` — uses
 * JSON.parse). Budget contract unchanged: routing cache read is cheap,
 * `gh run list` is bounded to a 2s timeout, results cached for 60s.
 *
 * Returns `{ systemMessage: string, stderr: string[] }`. An empty
 * systemMessage means "emit {"continue": true} with no message". stderr lines
 * mirror the original hook's `>&2` warnings (compared by the parity harness).
 *
 * Faithful to the bash hook's degrade-safely contract: any missing tool,
 * unauthenticated `gh`, failed API call, or unreadable cache falls back to the
 * routing summary (or empty) — it never throws to the caller.
 */

const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// --- Cache location (R38) -------------------------------------------------
// WRITES go to a plugin-data directory; READS prefer that new path and fall
// back READ-ONLY to the legacy `${HOME}/.cache/yellow-ci` location (the legacy
// path is never written again). The env-var resolution lives in this
// (non-exposure-linted) hook layer; Codex sets CLAUDE_PLUGIN_DATA for
// plugin-hook compat. Defined once here and reused for every cache file.
function newCacheDir(env) {
  if (env.CLAUDE_PLUGIN_DATA) return env.CLAUDE_PLUGIN_DATA;
  const base = env.XDG_DATA_HOME || path.join(env.HOME || os.homedir(), '.local', 'share');
  return path.join(base, 'yellow-ci');
}

function legacyCacheDir(env) {
  return path.join(env.HOME || os.homedir(), '.cache', 'yellow-ci');
}

// Resolve a readable path for a cache file: prefer the new location, fall back
// READ-ONLY to the legacy one. Returns the new path when neither exists so
// callers' stat/read fail consistently against the write location.
function resolveCacheReadPath(env, filename) {
  const newPath = path.join(newCacheDir(env), filename);
  if (fs.existsSync(newPath)) return newPath;
  const legacyPath = path.join(legacyCacheDir(env), filename);
  if (fs.existsSync(legacyPath)) return legacyPath;
  return newPath;
}

function readRoutingSummary(env) {
  try {
    // head -c 500 — bounded by BYTES, like the bash hook.
    const buf = fs.readFileSync(resolveCacheReadPath(env, 'routing-summary.txt'));
    return buf.subarray(0, 500).toString('utf8');
  } catch {
    return '';
  }
}

// `command -v <cmd>` equivalent: scan PATH for an executable of that name.
function commandExists(cmd, env) {
  const dirs = (env.PATH || '').split(path.delimiter);
  for (const dir of dirs) {
    if (!dir) continue;
    try {
      fs.accessSync(path.join(dir, cmd), fs.constants.X_OK);
      return true;
    } catch {
      // not here; keep scanning
    }
  }
  return false;
}

function ghAuthOk(env) {
  // Bound with a timeout like ghRunList — otherwise a hung `gh auth status`
  // could blow the hook's 3s budget before the run-list call even starts.
  const res = spawnSync('gh', ['auth', 'status'], { env, stdio: 'ignore', timeout: 1000 });
  return !res.error && res.status === 0;
}

function ghRunList(env) {
  const res = spawnSync(
    'gh',
    [
      'run', 'list', '--status', 'failure', '--limit', '3',
      '--json', 'databaseId,headBranch,displayTitle,conclusion,updatedAt',
      '-q', '[.[] | select(.conclusion == "failure")]',
    ],
    { env, encoding: 'utf8', timeout: 2000 }
  );
  if (res.error || res.status !== 0) {
    return { failed: true, stdout: '' };
  }
  return { failed: false, stdout: res.stdout || '' };
}

function cacheKeyFor(cwd) {
  return crypto.createHash('md5').update(cwd).digest('hex').slice(0, 32);
}

function writeCacheAtomic(cacheFile, content, warn) {
  // PID-suffixed tmp (like resolve-runner-targets.sh's `.tmp.$$`) so two
  // concurrent SessionStart hooks on the same cwd don't race on one tmp file.
  const tmp = `${cacheFile}.tmp.${process.pid}`;
  try {
    fs.writeFileSync(tmp, content);
  } catch {
    warn(`[yellow-ci] Warning: Cannot write cache to ${tmp}`);
    return;
  }
  try {
    fs.renameSync(tmp, cacheFile);
  } catch {
    warn(`[yellow-ci] Warning: Cache write failed for ${cacheFile}`);
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
  }
}

/**
 * @param {{cwd: string, env: NodeJS.ProcessEnv}} ctx
 * @returns {{systemMessage: string, stderr: string[]}}
 */
function runSessionStart({ cwd, env }) {
  const stderr = [];
  const warn = (line) => stderr.push(line);
  const done = (systemMessage) => ({ systemMessage: systemMessage || '', stderr });

  // Early exit for non-CI projects.
  try {
    if (!fs.statSync(path.join(cwd, '.github', 'workflows')).isDirectory()) {
      return done('');
    }
  } catch {
    return done('');
  }

  // Routing context (read before gh checks so it surfaces even without gh).
  const routingSummary = readRoutingSummary(env);

  if (!commandExists('gh', env)) {
    return done(routingSummary);
  }
  if (!ghAuthOk(env)) {
    return done(routingSummary);
  }

  const cacheFileName = `last-check-${cacheKeyFor(cwd)}`;
  const readCacheFile = resolveCacheReadPath(env, cacheFileName);

  // Cache freshness (60s TTL). Read prefers the new location and falls back
  // READ-ONLY to a legacy cache file (R38). Checked BEFORE creating the write
  // dir, so a fresh cache (new OR legacy) is still served even when the new
  // plugin-data dir cannot be created.
  try {
    const st = fs.statSync(readCacheFile);
    const ageSec = Math.floor(Date.now() / 1000) - Math.floor(st.mtimeMs / 1000);
    if (ageSec < 60) {
      try {
        return done(fs.readFileSync(readCacheFile, 'utf8'));
      } catch {
        warn(`[yellow-ci] Warning: Cannot read cache file ${readCacheFile}`);
        return done(routingSummary);
      }
    }
  } catch {
    // no cache file — fall through to fetch
  }

  // Cache miss: fetch recent failed runs.
  const { failed, stdout: failedJson } = ghRunList(env);
  if (failed) {
    return done(routingSummary);
  }

  // Parse.
  let failureCount = 0;
  let branches = '';
  const trimmed = failedJson.trim();
  if (trimmed !== '' && trimmed !== '[]' && trimmed !== 'null') {
    let parsed;
    try {
      parsed = JSON.parse(failedJson);
    } catch {
      parsed = undefined;
    }
    if (Array.isArray(parsed)) {
      failureCount = parsed.length;
      const uniqueBranches = [...new Set(
        parsed.map((r) => r && r.headBranch).filter((b) => typeof b === 'string' && b.length > 0)
      )].sort();
      branches = uniqueBranches.join(', ');
    } else {
      warn('[yellow-ci] Warning: Unexpected GitHub API response format');
      failureCount = 0;
    }
  }

  // Assemble output: routing summary first, then a conditional failure line.
  let output = routingSummary || '';
  if (failureCount > 0) {
    const failureMsg = branches
      ? `[yellow-ci] CI: ${failureCount} recent failure(s) on branch(es): ${branches}. Use /ci:diagnose to investigate.`
      : `[yellow-ci] CI: ${failureCount} recent failure(s) detected. Use /ci:diagnose to investigate.`;
    output = output ? `${output}\n${failureMsg}` : failureMsg;
  }

  // Write the result cache (best-effort). Create the plugin-data write dir only
  // now — it is needed only for writing, so a mkdir failure must NOT suppress
  // the freshly-computed output (the failure info still surfaces).
  const writeCacheDir = newCacheDir(env);
  try {
    fs.mkdirSync(writeCacheDir, { recursive: true });
    writeCacheAtomic(path.join(writeCacheDir, cacheFileName), output, warn);
  } catch {
    warn(`[yellow-ci] Warning: Cannot create cache directory ${writeCacheDir}`);
  }
  return done(output);
}

module.exports = { runSessionStart };
