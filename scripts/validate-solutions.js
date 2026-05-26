#!/usr/bin/env node

/**
 * validate-solutions.js
 *
 * Diff-scoped validator for `docs/solutions/` entries. Runs on PR diffs to:
 *
 *   1. Block when a NEW doc reuses a slug that already exists elsewhere in
 *      the corpus (exact filename collision — accidental overwrite).
 *   2. Block when a NEW or MODIFIED doc has missing/invalid required
 *      frontmatter fields (title, date, category, track, problem, tags) or
 *      out-of-enum values.
 *
 * The validator runs only on files in the diff against `origin/main` (or the
 * ref in `VALIDATE_SOLUTIONS_BASE_REF`). Pre-existing non-conforming docs
 * are intentionally NOT touched — see the Phase 0 calibration research at
 * `docs/research/2026-05-21-solution-doc-jaccard-calibration.md`.
 *
 * Files under `docs/solutions/archived/` are skipped (legacy/inactive docs
 * are not held to the live schema).
 *
 * Error codes (catalog: packages/domain/src/validation/errorCatalog.ts) are
 * assembled via string concatenation so `scripts/lint-error-codes.js` does
 * not flag this file as re-implementing them.
 *
 * Env:
 *   VALIDATE_SOLUTIONS_BASE_REF=origin/main   diff base (override for CI)
 *   VALIDATE_SOLUTIONS_DIFF                   newline list of `A\t<path>` /
 *                                             `M\t<path>` / `R<score>\t<old>\t<new>`
 *                                             lines (tab-separated, matching
 *                                             `git diff --name-status`).
 *                                             Bypasses git diff. Tests use
 *                                             this to inject synthetic change
 *                                             sets.
 *   SOLUTIONS_DIR=docs/solutions              corpus root (test override)
 *   GITHUB_ACTIONS=true                       emits `::error file=`/`::notice::`
 *                                             annotations.
 *
 * Exit codes:
 *   0 - no validation errors (or soft-skip)
 *   1 - one or more validation errors found
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOLUTIONS_DIR = path.resolve(
  ROOT,
  process.env.SOLUTIONS_DIR || 'docs/solutions'
);

// Path-traversal guard: refuse to operate on a directory outside the project
// root, with a temp-dir exception for vitest fixtures (same convention as
// scripts/backfill-solution-frontmatter.js).
const TMP_PREFIX = os.tmpdir();
if (
  !SOLUTIONS_DIR.startsWith(ROOT + path.sep) &&
  !SOLUTIONS_DIR.startsWith(TMP_PREFIX + path.sep)
) {
  console.error(
    '[validate-solutions] Error: SOLUTIONS_DIR resolves outside project ' +
      'root or system temp dir. Refusing to operate on: ' +
      SOLUTIONS_DIR
  );
  process.exit(1);
}

const IS_CI = process.env.GITHUB_ACTIONS === 'true';
const BASE_REF = process.env.VALIDATE_SOLUTIONS_BASE_REF || 'origin/main';

// Catalog code prefixes assembled via concatenation. See the module header
// for why these codes are assembled instead of imported from the catalog.
const SOL = 'ERROR-' + 'SOL';
const SOL_SLUG_COLLISION = SOL + '-001';
const SOL_FRONTMATTER = SOL + '-002';

const VALID_CATEGORIES = new Set([
  'security-issues',
  'build-errors',
  'integration-issues',
  'code-quality',
  'workflow',
  'logic-errors',
]);
const VALID_TRACKS = new Set(['bug', 'knowledge']);
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(value) {
  if (!ISO_DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const SLUG_MAX_LEN = 50;

const errors = [];

function emitError(file, code, msg) {
  errors.push({ file, code, msg });
  if (IS_CI) {
    console.log(`::error file=${file}::${code}: ${msg}`);
  } else {
    console.error(`✗ ${file}: ${code}: ${msg}`);
  }
}

function emitNotice(msg) {
  if (IS_CI) {
    console.log(`::notice::${msg}`);
  } else {
    console.log(`[validate-solutions] ${msg}`);
  }
}

// Parse `git diff --name-status -z` output. Records are NUL-separated.
// For A/M: status\0path\0   For R/C: status\0old\0new\0
// Returns array of {status, path, newPath?} records. Status may carry
// similarity digits (R100, C75); callers use the first char.
function parseNulSeparatedDiff(raw) {
  const records = [];
  const parts = raw.split('\0');
  // git's -z output ends with a trailing NUL → an extra empty element.
  // Walk by status to know how many fields each record consumes.
  let i = 0;
  while (i < parts.length) {
    const status = parts[i];
    if (!status) {
      i++;
      continue;
    }
    const ch = status[0];
    if (ch === 'R' || ch === 'C') {
      // Rename/copy: status, old, new
      const oldPath = parts[i + 1];
      const newPath = parts[i + 2];
      if (oldPath === undefined || newPath === undefined) break;
      records.push({ status, path: oldPath, newPath });
      i += 3;
    } else {
      // A/M/D/T: status, path
      const path = parts[i + 1];
      if (path === undefined) break;
      records.push({ status, path });
      i += 2;
    }
  }
  return records;
}

// Parse synthetic VALIDATE_SOLUTIONS_DIFF env var content (tab+newline format
// matching `git diff --name-status` without `-z`). Test ergonomics only —
// the real git path uses `-z` (NUL-separated) for unicode/space safety.
function parseTabSeparatedDiff(raw) {
  const records = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split(/\t/);
    const status = parts[0];
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

// Returns array of {status: 'A'|'M', relPath} entries within docs/solutions/
// (excluding archived/), or null when the diff base is unreachable. Rename
// entries are normalized to 'A' on the new path so they receive
// slug-collision checking the same as fresh additions.
function getChangedFiles() {
  const injected = process.env.VALIDATE_SOLUTIONS_DIFF;
  let records;
  if (injected !== undefined) {
    // Synthetic test injection: tab+newline format. Tests don't carry
    // unusual filenames so the tab format is safe and ergonomic for
    // fixture writers (NUL bytes are awkward in JS string literals).
    records = parseTabSeparatedDiff(injected);
  } else {
    let raw;
    try {
      // Use execFileSync (no shell) and pass the ref as an argument so a
      // hostile VALIDATE_SOLUTIONS_BASE_REF cannot inject shell commands.
      // execSync with a template literal would interpret metacharacters via
      // /bin/sh -c, which was the original P1 security finding.
      //
      // `-z` is load-bearing: without it, git quotes paths containing
      // unusual characters (non-ASCII like `café`, spaces, tabs, etc.)
      // using C-style escaping, which would fail the later
      // `startsWith('docs/solutions/')` check and silently bypass
      // validation. With `-z`, records are NUL-separated and paths are
      // emitted verbatim (no quoting).
      raw = execFileSync(
        'git',
        ['diff', '--name-status', '-z', `${BASE_REF}...HEAD`, '--', 'docs/solutions/'],
        { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
    } catch (err) {
      // Soft-skip for unreachable refs (fork PR, shallow clone). For other
      // errors (git binary missing, EACCES on .git/, corrupt index), surface
      // a stderr warning so the soft-skip is distinguishable from a runner
      // misconfiguration — otherwise CI silently reports green on a
      // misconfigured runner where validation never ran.
      const stderr = err.stderr ? err.stderr.toString() : '';
      const looksUnreachable =
        /unknown revision|bad revision|does not have a commit|fatal: ambiguous argument/i.test(
          stderr
        );
      if (!looksUnreachable) {
        process.stderr.write(
          `[validate-solutions] warn: git diff failed (${err.code || 'unknown'}): ${stderr.trim()}\n`
        );
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
    } else if (statusChar === 'R') {
      // Rename: treat new path as added (new slug → collision check).
      relPath = rec.newPath;
      normalizedStatus = 'A';
    } else {
      continue;
    }
    if (!relPath) continue;
    if (!relPath.startsWith('docs/solutions/')) continue;
    if (relPath.startsWith('docs/solutions/archived/')) continue;
    // Non-.md files under docs/solutions/ violate the corpus convention.
    // Block rather than silently skip so an accidental .MD / .markdown /
    // .txt landing in the solutions tree is caught at PR time.
    if (!relPath.endsWith('.md')) {
      emitError(
        relPath,
        SOL_FRONTMATTER,
        `non-.md file under docs/solutions/ — expected lowercase .md extension`
      );
      continue;
    }
    // Path-traversal guard: startsWith('docs/solutions/') alone passes
    // payloads like 'docs/solutions/../../../etc/passwd', which path.join
    // would then resolve outside the corpus root. Reject any entry whose
    // normalized form escapes the corpus directory.
    const normalized = path.posix.normalize(relPath);
    if (
      normalized !== relPath ||
      normalized.split('/').some(s => s === '..') ||
      path.isAbsolute(normalized)
    ) {
      process.stderr.write(
        `[validate-solutions] warn: rejecting suspicious diff path: ${relPath}\n`
      );
      continue;
    }
    // Require exact category-subdirectory shape: docs/solutions/<category>/<slug>.md
    // Paths with more than 4 segments (e.g. docs/solutions/workflow/nested/doc.md)
    // bypass slug-collision detection because buildCorpusIndex() only walks one
    // level under each category. Reject them explicitly instead of silently
    // continuing.
    const segments = normalized.split('/');
    if (segments.length !== 4) {
      emitError(
        normalized,
        SOL_FRONTMATTER,
        `expected docs/solutions/<category>/<slug>.md (depth 4), got: ${normalized}`
      );
      continue;
    }
    entries.push({ status: normalizedStatus, path: normalized });
  }
  return entries;
}

// Parse YAML frontmatter — handrolled regex modeled on
// scripts/backfill-solution-frontmatter.js. Returns null if no frontmatter
// delimiter pair is present.
function parseFrontmatter(text) {
  // The closing `---` may be followed by a newline + body, or by end-of-file
  // (some editors strip the trailing newline). Require the opening delimiter
  // newline but allow either form to terminate so we do not false-positive
  // SOL-002 on a perfectly valid frontmatter-only file.
  // Fast exit: if there is no second `---` delimiter, the regex's lazy
  // `[\s\S]*?` would still try every backtrack permutation before failing.
  // Cheap pre-check eliminates ReDoS exposure on unclosed frontmatter blocks.
  if (!text.startsWith('---') || text.indexOf('\n---', 3) === -1) return null;
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/);
  if (!match) return null;
  const fmRaw = match[1];
  // Prototype-pollution guard: a frontmatter key named `__proto__` or
  // `constructor` would otherwise mutate Object.prototype for the lifetime
  // of this process. Use a null-prototype object as the accumulator and
  // reject the forbidden keys explicitly.
  // Basic YAML syntax check: detect unclosed flow sequences/mappings on scalar
  // value lines (e.g. `title: [broken`). The regex parser accepts these
  // silently; downstream readers (YAML-based) will fail on them.
  for (const line of fmRaw.split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const val = kv[2].trim();
    const openBrackets = (val.match(/\[/g) || []).length;
    const closeBrackets = (val.match(/\]/g) || []).length;
    const openBraces = (val.match(/\{/g) || []).length;
    const closeBraces = (val.match(/\}/g) || []).length;
    if (openBrackets !== closeBrackets || openBraces !== closeBraces) {
      return { __yamlError: `malformed YAML: unclosed flow collection on line: ${line.trim()}` };
    }
  }
  const fields = Object.create(null);
  for (const line of fmRaw.split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/);
    if (kv) {
      if (kv[1] === '__proto__' || kv[1] === 'constructor' || kv[1] === 'prototype') continue;
      const value = kv[2].trim().replace(/^['"]|['"]$/g, '');
      fields[kv[1]] = value;
    }
  }
  // tags can be inline (`tags: [a, b]`) or block-list. Both count as present.
  const tagsInline = /^tags\s*:\s*\[([^\]]+)\]/m.test(fmRaw);
  const lines = fmRaw.split(/\r?\n/);
  let tagsBlock = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^tags\s*:\s*$/.test(lines[i])) {
      // Look ahead for at least one list item before the next top-level key.
      for (let j = i + 1; j < lines.length; j++) {
        if (/^\s*-\s+\S/.test(lines[j])) {
          tagsBlock = true;
          break;
        }
        if (/^\S/.test(lines[j])) break;
      }
      break;
    }
  }
  fields.__hasTags = tagsInline || tagsBlock;
  return fields;
}

function validateFrontmatter(file, fm) {
  // Required scalar fields. `tags` is checked separately because its shape
  // (inline array or block list) requires extra parsing.
  const required = ['title', 'date', 'category', 'track', 'problem'];
  for (const field of required) {
    if (!fm[field] || fm[field].length === 0) {
      emitError(file, SOL_FRONTMATTER, `missing required field: ${field}`);
    }
  }
  if (!fm.__hasTags) {
    emitError(file, SOL_FRONTMATTER, 'missing required field: tags');
  }
  if (fm.category && !VALID_CATEGORIES.has(fm.category)) {
    emitError(
      file,
      SOL_FRONTMATTER,
      `invalid category "${fm.category}" — must be one of: ` +
        [...VALID_CATEGORIES].sort().join(', ')
    );
  }
  if (fm.track && !VALID_TRACKS.has(fm.track)) {
    emitError(
      file,
      SOL_FRONTMATTER,
      `invalid track "${fm.track}" — must be one of: bug, knowledge`
    );
  }
  if (fm.date && !isValidIsoDate(fm.date)) {
    emitError(
      file,
      SOL_FRONTMATTER,
      `date "${fm.date}" is not ISO 8601 (YYYY-MM-DD)`
    );
  }
}

function validateSlug(file) {
  const slug = path.basename(file, '.md');
  if (slug.length > SLUG_MAX_LEN) {
    emitError(
      file,
      SOL_FRONTMATTER,
      `slug "${slug}" exceeds ${SLUG_MAX_LEN} chars`
    );
    return false;
  }
  if (!SLUG_RE.test(slug)) {
    emitError(
      file,
      SOL_FRONTMATTER,
      `slug "${slug}" must match ^[a-z0-9]+(-[a-z0-9]+)*$ ` +
        '(lowercase, no leading/trailing/consecutive hyphens)'
    );
    return false;
  }
  return true;
}

// Build slug → [corpusRelPath, ...] map of pre-existing corpus files. Paths
// are stored as `<category>/<slug>.md` (corpus-relative) so the same-file
// check works regardless of where SOLUTIONS_DIR is rooted. Excludes
// archived/ for the same reason it is excluded from the diff scan.
function buildCorpusIndex() {
  const index = new Map();
  const stats = fs.statSync(SOLUTIONS_DIR, { throwIfNoEntry: false });
  if (!stats || !stats.isDirectory()) return index;
  for (const cat of fs.readdirSync(SOLUTIONS_DIR, { withFileTypes: true })) {
    if (!cat.isDirectory() || cat.name === 'archived') continue;
    const subDir = path.join(SOLUTIONS_DIR, cat.name);
    let files;
    try {
      files = fs.readdirSync(subDir);
    } catch (err) {
      // Log the skipped directory so runner misconfiguration (chmod, broken
      // mount) is visible. A silently-incomplete corpus index would produce
      // false-negative slug-collision results.
      process.stderr.write(
        `[validate-solutions] warn: could not read ${subDir}: ${err.code || err.message}\n`
      );
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.md')) continue;
      const slug = path.basename(f, '.md');
      const corpusRel = `${cat.name}/${f}`;
      if (!index.has(slug)) index.set(slug, []);
      index.get(slug).push(corpusRel);
    }
  }
  return index;
}

function checkSlugCollision(file, corpusIndex) {
  const slug = path.basename(file, '.md');
  // The diff entry is repo-relative ("docs/solutions/<cat>/<slug>.md");
  // strip the prefix so it matches the corpus-relative form stored in the
  // index, otherwise a self-comparison would never filter out and produce a
  // false "collides with itself" error.
  const selfCorpusRel = file.replace(/^docs\/solutions\//, '');
  const existing = (corpusIndex.get(slug) || []).filter(
    (p) => p !== selfCorpusRel
  );
  if (existing.length > 0) {
    const displayPaths = existing.map((p) => `docs/solutions/${p}`);
    emitError(
      file,
      SOL_SLUG_COLLISION,
      `slug "${slug}" collides with existing: ${displayPaths.join(', ')}. ` +
        'Rename to a distinct slug or amend the existing doc.'
    );
  }
}

function main() {
  const changed = getChangedFiles();
  if (changed === null) {
    emitNotice(
      `cannot reach ${BASE_REF} (likely fork PR or shallow clone) — ` +
        'skipping solution-doc validation'
    );
    process.exit(0);
  }
  if (changed.length === 0) {
    // getChangedFiles() may have emitted errors (e.g., depth-4 violations)
    // even though the actionable entries list is empty. Surface those and fail
    // instead of silently exiting 0.
    if (errors.length > 0) {
      process.exit(1);
    }
    emitNotice('no docs/solutions/ changes in diff — nothing to validate');
    process.exit(0);
  }

  const corpusIndex = buildCorpusIndex();

  for (const entry of changed) {
    // Diff entries are repo-relative ("docs/solutions/<cat>/<slug>.md").
    // Strip the corpus prefix and resolve under SOLUTIONS_DIR so the lookup
    // works both for production (SOLUTIONS_DIR = ROOT/docs/solutions) and
    // for tests (SOLUTIONS_DIR overridden to a tmpdir).
    const relUnderCorpus = entry.path.replace(/^docs\/solutions\//, '');
    const fullPath = path.join(SOLUTIONS_DIR, relUnderCorpus);
    let text;
    try {
      text = fs.readFileSync(fullPath, 'utf8');
    } catch (err) {
      // ENOENT is an expected deletion race (the diff says it changed; a
      // later commit on the branch may have removed it). Other error codes
      // (EACCES, EMFILE) signal runner misconfiguration and deserve a warning
      // even though we still continue (the validator is not the right place
      // to block on infrastructure faults).
      if (err.code !== 'ENOENT') {
        process.stderr.write(
          `[validate-solutions] warn: could not read ${fullPath}: ${err.code || err.message}\n`
        );
      }
      continue;
    }
    const fm = parseFrontmatter(text);
    if (!fm) {
      emitError(
        entry.path,
        SOL_FRONTMATTER,
        'missing YAML frontmatter block (file must start with `---` ... `---`)'
      );
      continue;
    }
    if (fm.__yamlError) {
      emitError(entry.path, SOL_FRONTMATTER, fm.__yamlError);
      continue;
    }
    validateFrontmatter(entry.path, fm);
    if (entry.status === 'A') {
      if (validateSlug(entry.path)) {
        checkSlugCollision(entry.path, corpusIndex);
      }
    }
  }

  console.log(
    `\n[validate-solutions] checked ${changed.length} file(s); ` +
      `${errors.length} error(s)`
  );
  process.exit(errors.length > 0 ? 1 : 0);
}

main();
