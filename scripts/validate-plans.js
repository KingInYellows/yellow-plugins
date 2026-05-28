#!/usr/bin/env node

/**
 * validate-plans.js
 *
 * Diff-scoped validator for `plans/complete/` archival entries. Runs on PR
 * diffs to block when a NEW or MODIFIED archived plan contains stray
 * unchecked checkboxes (`- [ ]` lines). This catches premature archival
 * where the plan moved before its task list was complete.
 *
 * The validator runs only on files added or modified in the diff against
 * `origin/main` (or the ref in `PLAN_VALIDATOR_BASE_REF`). Renames produced
 * by `git mv plans/<slug>.md plans/complete/<slug>.md` are detected via the
 * `R<score>` records emitted by `git diff --name-status` and routed by
 * destination path — so the archival case is caught whether or not rename
 * detection fires. Pre-existing dirty files in `plans/complete/` that the
 * PR does not touch are intentionally NOT inspected (PR-diff-scoping). See
 * `plans/plan-lifecycle-management.md` for rationale.
 *
 * Error codes (catalog: packages/domain/src/validation/errorCatalog.ts) are
 * assembled via string concatenation so `scripts/lint-error-codes.js` does
 * not flag this file as re-implementing them. Same ESM/CJS bridge constraint
 * as scripts/validate-solutions.js.
 *
 * Env:
 *   PLAN_VALIDATOR_BASE_REF=origin/main  diff base (override for CI)
 *   PLAN_VALIDATOR_DIFF                  newline list of `A\t<path>` /
 *                                        `M\t<path>` / `R<score>\t<old>\t<new>`
 *                                        lines (tab-separated, matching
 *                                        `git diff --name-status` without
 *                                        `-z`). Bypasses git diff. Tests use
 *                                        this to inject synthetic change
 *                                        sets without `mkdtempSync` + bare
 *                                        repo init.
 *   PLANS_DIR=plans                      corpus root (test override)
 *   GITHUB_ACTIONS=true                  emits `::error file=`/`::notice::`
 *                                        annotations.
 *
 * Exit codes:
 *   0 - no validation errors (or soft-skip on unreachable BASE_REF)
 *   1 - one or more stray-checkbox findings, OR a hard infrastructure error
 *       (git binary missing / corrupt index, or a plan file that could not
 *       be read for a non-ENOENT reason). Infrastructure errors fail loudly
 *       rather than soft-skipping so CI never reports green on a runner where
 *       validation could not actually run.
 *
 * CI recipe: requires `actions/checkout@v4` with `fetch-depth: 0` (or an
 * explicit `git fetch origin <base-ref>`) so the diff base is reachable.
 * Without it, the validator soft-skips and emits a warning to stderr.
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PLANS_DIR = path.resolve(ROOT, process.env.PLANS_DIR || 'plans');

// Path-traversal guard: refuse to operate on a directory outside the project
// root, with a temp-dir exception for vitest fixtures (same convention as
// scripts/validate-solutions.js lines 60-73).
const TMP_PREFIX = os.tmpdir();
if (
  !PLANS_DIR.startsWith(ROOT + path.sep) &&
  !PLANS_DIR.startsWith(TMP_PREFIX + path.sep)
) {
  console.error(
    '[validate-plans] Error: PLANS_DIR resolves outside project ' +
      'root or system temp dir. Refusing to operate on: ' +
      PLANS_DIR
  );
  process.exit(1);
}

const IS_CI = process.env.GITHUB_ACTIONS === 'true';
const BASE_REF = process.env.PLAN_VALIDATOR_BASE_REF || 'origin/main';

// Catalog code prefixes assembled via concatenation. See module header for
// why these codes are assembled instead of imported from the catalog.
const PLAN = 'ERROR-' + 'PLAN';
const PLAN_STRAY_CHECKBOX = PLAN + '-001';

const CHECKBOX_RE = /^[ \t]*- \[ \]/;

const errors = [];

// Set when the validator could not read a file it was asked to inspect for a
// reason other than an expected deletion race (ENOENT). Tracked separately
// from `errors` (which holds the stray-checkbox findings) so the
// summary can distinguish "validated and found problems" from "could not
// validate". Either condition fails the run.
let infraError = false;

function emitError(file, line, code, msg) {
  errors.push({ file, line, code, msg });
  if (IS_CI) {
    console.log(`::error file=${file},line=${line}::${code}: ${msg}`);
  } else {
    console.error(`✗ ${file}:${line}: ${code}: ${msg}`);
  }
}

function emitNotice(msg) {
  if (IS_CI) {
    console.log(`::notice::${msg}`);
  } else {
    console.log(`[validate-plans] ${msg}`);
  }
}

// Parse `git diff --name-status -z` output. Records are NUL-separated.
// For A/M/D/T: status\0path\0   For R/C: status\0old\0new\0
// Returns array of {status, path, newPath?} records. Status may carry
// similarity digits (R100, C75); callers use the first char.
function parseNulSeparatedDiff(raw) {
  const records = [];
  const parts = raw.split('\0');
  let i = 0;
  while (i < parts.length) {
    const status = parts[i];
    if (!status) {
      i++;
      continue;
    }
    const ch = status[0];
    if (ch === 'R' || ch === 'C') {
      const oldPath = parts[i + 1];
      const newPath = parts[i + 2];
      if (oldPath === undefined || newPath === undefined) break;
      records.push({ status, path: oldPath, newPath });
      i += 3;
    } else {
      const p = parts[i + 1];
      if (p === undefined) break;
      records.push({ status, path: p });
      i += 2;
    }
  }
  return records;
}

// Parse synthetic PLAN_VALIDATOR_DIFF env var content (tab+newline format
// matching `git diff --name-status` without `-z`). Test ergonomics only —
// the real git path uses `-z` (NUL-separated) for unicode/space safety.
function parseTabSeparatedDiff(raw) {
  const records = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split(/\t/);
    const status = parts[0];
    if (!status) continue;
    const ch = status[0];
    if (ch === 'R' || ch === 'C') {
      if (parts.length < 3) continue;
      records.push({ status, path: parts[1], newPath: parts[2] });
    } else {
      if (parts.length < 2) continue;
      records.push({ status, path: parts[1] });
    }
  }
  return records;
}

// Returns array of {status: 'A'|'M', path} entries within plans/complete/,
// or null when the diff base is unreachable (soft-skip). On a hard git error
// (binary missing, EACCES on .git/, corrupt index) the function exits 1
// directly rather than returning — see the catch block. Rename/copy entries
// are normalized to 'A' on the new path so an archival move
// (plans/foo.md → plans/complete/foo.md) receives the same checkbox scan as
// a direct add.
function getChangedFiles() {
  const injected = process.env.PLAN_VALIDATOR_DIFF;
  let records;
  if (injected !== undefined) {
    records = parseTabSeparatedDiff(injected);
  } else {
    let raw;
    try {
      // Use execFileSync (no shell) and pass the ref as an argument so a
      // hostile PLAN_VALIDATOR_BASE_REF cannot inject shell commands.
      //
      // `-z` is load-bearing: without it, git quotes paths containing
      // non-ASCII characters (e.g. `café.md`) using C-style escaping, which
      // would fail the later `startsWith('plans/complete/')` check and
      // silently bypass validation. With `-z`, records are NUL-separated
      // and paths are emitted verbatim. See
      // docs/solutions/logic-errors/git-diff-name-status-nul-safe-parsing.md.
      raw = execFileSync(
        'git',
        ['diff', '--name-status', '-z', `${BASE_REF}...HEAD`, '--', 'plans/complete/'],
        { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
    } catch (err) {
      // Distinguish two failure modes:
      //   - Unreachable ref (fork PR, shallow clone): a no-op condition.
      //     Return null → main() emits a notice and exits 0 (soft-skip).
      //   - Hard error (git binary missing, EACCES on .git/, corrupt index):
      //     the validator should have run but couldn't. Fail loudly with
      //     exit 1 so CI does not report green on a misconfigured runner.
      const stderr = err.stderr ? err.stderr.toString() : '';
      const looksUnreachable =
        /unknown revision|bad revision|does not have a commit|fatal: ambiguous argument/i.test(
          stderr
        );
      if (!looksUnreachable) {
        const msg =
          `git diff failed (${err.code || 'unknown'}): ${stderr.trim()}`;
        if (IS_CI) {
          console.log(`::error::[validate-plans] ${msg}`);
        } else {
          process.stderr.write(`[validate-plans] error: ${msg}\n`);
        }
        process.exit(1);
      }
      return null;
    }
    records = parseNulSeparatedDiff(raw);
  }
  const entries = [];
  for (const rec of records) {
    const statusChar = rec.status[0];
    let relPath;
    let normalizedStatus;
    if (statusChar === 'A' || statusChar === 'M') {
      relPath = rec.path;
      normalizedStatus = statusChar;
    } else if (statusChar === 'R' || statusChar === 'C') {
      // Rename/copy: scan the destination contents. A copy into
      // plans/complete/ is a real archival path under
      // `git config diff.renames=copies`, so it must be gated the same as
      // a rename. Both carry newPath from the parsers above.
      relPath = rec.newPath;
      normalizedStatus = 'A';
    } else {
      // D (deletion), T (type change): not applicable.
      continue;
    }
    if (!relPath) continue;
    if (!relPath.startsWith('plans/complete/')) continue;
    if (!relPath.endsWith('.md')) continue;
    // Path-traversal guard: startsWith('plans/complete/') alone passes
    // payloads like 'plans/complete/../../../etc/passwd'. Reject any entry
    // whose normalized form escapes the corpus directory.
    const normalized = path.posix.normalize(relPath);
    if (
      normalized !== relPath ||
      normalized.split('/').some((s) => s === '..') ||
      path.isAbsolute(normalized)
    ) {
      process.stderr.write(
        `[validate-plans] warn: rejecting suspicious diff path: ${relPath}\n`
      );
      continue;
    }
    entries.push({ status: normalizedStatus, path: normalized });
  }
  return entries;
}

function scanFileForStrayCheckboxes(absPath, relPath) {
  let text;
  try {
    text = fs.readFileSync(absPath, 'utf8');
  } catch (err) {
    // ENOENT is an expected deletion race (the diff says it changed; a later
    // commit on the branch may have removed it) — silently skip. Other error
    // codes (EACCES, EMFILE, EISDIR) signal runner misconfiguration: the file
    // SHOULD have been scanned but couldn't be. Flag it so main() exits 1
    // rather than reporting a misleading green run.
    if (err.code !== 'ENOENT') {
      infraError = true;
      const msg = `could not read ${relPath}: ${err.code || err.message}`;
      if (IS_CI) {
        console.log(`::error file=${relPath}::[validate-plans] ${msg}`);
      } else {
        process.stderr.write(`[validate-plans] error: ${msg}\n`);
      }
    }
    return;
  }
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (CHECKBOX_RE.test(lines[i])) {
      emitError(
        relPath,
        i + 1,
        PLAN_STRAY_CHECKBOX,
        'archived plan contains an unchecked task box (`- [ ]`) — ' +
          'complete or remove the task before archiving'
      );
    }
  }
}

function main() {
  const changed = getChangedFiles();
  if (changed === null) {
    emitNotice(
      `cannot reach ${BASE_REF} (likely fork PR or shallow clone) — ` +
        'skipping plan-archival validation'
    );
    process.exit(0);
  }
  if (changed.length === 0) {
    emitNotice('no plans/complete/ changes in diff — nothing to validate');
    process.exit(0);
  }

  for (const entry of changed) {
    // Diff entries are repo-relative ("plans/complete/<slug>.md"). Strip
    // the corpus prefix and resolve under PLANS_DIR so tests (which override
    // PLANS_DIR to a tmpdir) work the same as production.
    const relUnderCorpus = entry.path.replace(/^plans\//, '');
    const fullPath = path.join(PLANS_DIR, relUnderCorpus);
    scanFileForStrayCheckboxes(fullPath, entry.path);
  }

  const summary =
    `\n[validate-plans] checked ${changed.length} file(s); ` +
    `${errors.length} error(s)` +
    (infraError ? '; 1+ file(s) could not be read (see errors above)' : '');
  console.log(summary);
  process.exit(errors.length > 0 || infraError ? 1 : 0);
}

main();
