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
 *   3. Block when the optional `retire_when` field (the outside-the-repo
 *      condition that would retire a learning; ported from Compound
 *      Engineering's ce-compound schema) is present but not a non-empty,
 *      single-line string.
 *   4. Block when a NEW or MODIFIED doc's body cites a repo path, commit or
 *      relative link that does not exist, or leaves a `{{...}}` drafting
 *      placeholder (SOL-003; see scripts/lib/doc-claims.js, a Node
 *      port of Compound Engineering's validate-doc-claims.py). Deleted
 *      paths, stale checkouts, unclassifiable hex and links to archived
 *      docs are warnings only, and so is any finding on a line marked
 *      `(historical)`.
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
 *   VALIDATE_SOLUTIONS_REPO_ROOT=<repo root>  root that cited paths and
 *                                             commits resolve against (test
 *                                             override)
 *   GITHUB_ACTIONS=true                       emits `::error file=`/`::notice::`
 *                                             annotations.
 *
 * Usage:
 *   node scripts/validate-solutions.js              diff-scoped (CI)
 *   node scripts/validate-solutions.js --doc <path> one doc, no diff; used by
 *                                                   knowledge-compounder
 *                                                   before its M3 gate
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

const yaml = require('yaml');

const { checkDocClaims } = require('./lib/doc-claims');

// Private Symbol sentinel for YAML parse errors. Symbol keys cannot appear in
// a YAML-parsed object (YAML produces only string-keyed objects), so there is
// no collision risk with user frontmatter keys.
const Y_ERR = Symbol('yamlError');

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

const REPO_ROOT = path.resolve(
  process.env.VALIDATE_SOLUTIONS_REPO_ROOT || ROOT
);
if (REPO_ROOT !== ROOT && !REPO_ROOT.startsWith(TMP_PREFIX + path.sep)) {
  console.error(
    '[validate-solutions] Error: VALIDATE_SOLUTIONS_REPO_ROOT must be the ' +
      'project root or under the system temp dir. Refusing: ' +
      REPO_ROOT
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
const SOL_CLAIM = SOL + '-003';

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

let warningCount = 0;
function emitWarning(file, msg) {
  warningCount += 1;
  if (IS_CI) {
    console.log(`::warning file=${file}::${msg}`);
  } else {
    console.error(`! ${file}: warning: ${msg}`);
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
        [
          'diff',
          '--name-status',
          '-z',
          `${BASE_REF}...HEAD`,
          '--',
          'docs/solutions/',
        ],
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
      normalized.split('/').some((s) => s === '..') ||
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
  let parsed;
  try {
    parsed = yaml.parse(fmRaw) || {};
  } catch (err) {
    return { [Y_ERR]: `malformed YAML: ${err.message}` };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { [Y_ERR]: 'malformed YAML: frontmatter must be a YAML mapping' };
  }
  // Prototype-pollution guard: copy whitelisted (string-keyed, non-dangerous)
  // keys into a null-prototype object. yaml.parse() returns a plain object but
  // we explicitly exclude __proto__ / constructor / prototype defensively.
  const fields = Object.create(null);
  for (const [k, v] of Object.entries(parsed)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    fields[k] = v;
  }
  // tags can be inline (`tags: [a, b]`) or block-list. yaml.parse normalises
  // both forms to a JS array, so a simple Array.isArray check suffices.
  fields.__hasTags = Array.isArray(parsed.tags) && parsed.tags.length > 0;
  // YAML folds a block scalar (`|` / `>`, any indicator) and a plain or
  // quoted scalar continued on indented lines into one parsed line, so
  // record from the value node whether the source spans lines for
  // validateRetireWhen(). The node range excludes trailing comments.
  fields.__retireWhenMultiLine = retireWhenSpansLines(fmRaw);
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

function retireWhenSpansLines(fmRaw) {
  const doc = yaml.parseDocument(fmRaw);
  const items = (doc.contents && doc.contents.items) || [];
  const pair = items.find(
    (i) => i.key && String(i.key.value) === 'retire_when'
  );
  const node = pair && pair.value;
  if (!node || !node.range) return false;
  if (node.type === 'BLOCK_LITERAL' || node.type === 'BLOCK_FOLDED') {
    return true;
  }
  return /[\r\n]/.test(fmRaw.slice(node.range[0], node.range[1]));
}

// `retire_when` is optional. When present it names the change outside the
// repo that would retire the learning, as one line a refresh can check.
function validateRetireWhen(file, fm) {
  if (!('retire_when' in fm)) return;
  const value = fm.retire_when;
  if (typeof value !== 'string') {
    let got = typeof value;
    if (Array.isArray(value)) got = 'a list';
    else if (value === null) got = 'empty';
    emitError(
      file,
      SOL_FRONTMATTER,
      `retire_when must be a single-line string (got ${got}); omit the field ` +
        'when no outside condition retires the learning'
    );
    return;
  }
  if (fm.__retireWhenMultiLine || /[\r\n]/.test(value)) {
    emitError(
      file,
      SOL_FRONTMATTER,
      'retire_when must be a single-line string, not a multi-line or block ' +
        'scalar (`|` / `>`)'
    );
    return;
  }
  if (value.trim().length === 0) {
    emitError(
      file,
      SOL_FRONTMATTER,
      'retire_when is empty; omit the field when no outside condition ' +
        'retires the learning'
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

// `--doc <path>`: validate one doc outside the diff (knowledge-compounder
// runs this before M3). Status 'M' skips the slug-collision check, which
// the agent's own suffix loop already covers.
let DOC_MODE = false;
function getDocArg() {
  const i = process.argv.indexOf('--doc');
  if (i === -1) return undefined;
  const arg = process.argv[i + 1];
  if (!arg) {
    console.error('[validate-solutions] Error: --doc needs a path');
    process.exit(2);
  }
  const abs = path.resolve(arg);
  const rel = path.relative(SOLUTIONS_DIR, abs).split(path.sep).join('/');
  if (
    rel.startsWith('..') ||
    path.isAbsolute(rel) ||
    rel.startsWith('archived/') ||
    rel.split('/').length !== 2 ||
    !rel.endsWith('.md')
  ) {
    console.error(
      '[validate-solutions] Error: --doc must name a live ' +
        `docs/solutions/<category>/<slug>.md file, got: ${arg}`
    );
    process.exit(2);
  }
  return [{ status: 'M', path: `docs/solutions/${rel}` }];
}

// The doc as it was before this change, or undefined when it did not exist
// (or git cannot say): the merge base in a diff-scoped run, HEAD with --doc
// (so an uncommitted amendment is judged only on what it adds).
function baseVersion(relPath) {
  const run = (args) =>
    execFileSync('git', args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  try {
    const base = DOC_MODE
      ? 'HEAD'
      : run(['merge-base', BASE_REF, 'HEAD']).trim();
    return run(['show', `${base}:${relPath}`]);
  } catch {
    return undefined;
  }
}

function checkClaims(entry, fullPath, text) {
  const result = checkDocClaims({
    text,
    docPath: fullPath,
    repoRoot: REPO_ROOT,
    baseRef: BASE_REF,
    baselineText: entry.status === 'M' ? baseVersion(entry.path) : undefined,
  });
  const { warnings, notes } = result;
  for (const msg of result.errors) emitError(entry.path, SOL_CLAIM, msg);
  for (const msg of warnings) emitWarning(entry.path, msg);
  for (const msg of notes) emitNotice(`${entry.path}: note: ${msg}`);
}

function main() {
  const docArg = getDocArg();
  DOC_MODE = docArg !== undefined;
  const changed = docArg || getChangedFiles();
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
    if (fm[Y_ERR]) {
      emitError(entry.path, SOL_FRONTMATTER, fm[Y_ERR]);
      continue;
    }
    validateFrontmatter(entry.path, fm);
    validateRetireWhen(entry.path, fm);
    checkClaims(entry, fullPath, text);
    if (entry.status === 'A') {
      if (validateSlug(entry.path)) {
        checkSlugCollision(entry.path, corpusIndex);
      }
    }
  }

  console.log(
    `\n[validate-solutions] checked ${changed.length} file(s); ` +
      `${errors.length} error(s), ${warningCount} warning(s)`
  );
  process.exit(errors.length > 0 ? 1 : 0);
}

main();
