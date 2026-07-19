#!/usr/bin/env node

'use strict';

/**
 * Error-code re-implementation lint (PR-A, finding 008 — narrowed).
 *
 * The repo has two parallel validation stacks (see CONTRIBUTING.md "Split
 * Validation Architecture"): the hand-rolled `scripts/*.js` validators and
 * the AJV-based `packages/` library. They are intentionally separate — but
 * the canonical error-code registry lives in
 * `packages/domain/src/validation/errorCatalog.ts` (most categories, as TS
 * literals) and `packages/domain/src/validation/error-codes.json` (the
 * DIST_* category, R14 — the first category shared as plain JSON instead of
 * TS literals, so `scripts/*.js` can `readFileSync` + `JSON.parse` it
 * directly; `packages/domain` is ESM-only, so `scripts/` — plain CJS —
 * cannot `require()` the TS-literal categories, unlike this stale claim's
 * predecessor comment implied). If a `scripts/*.js` validator hard-codes
 * one of those `ERROR-<CATEGORY>-<NNN>` code strings, the two stacks have
 * silently drifted: the catalog is the single source of truth.
 *
 * This check fails CI when any file under `scripts/` contains a literal
 * error-code string that is already defined in the catalog. It does NOT
 * flag the plain-English error messages the scripts currently use — only
 * the structured `ERROR-*` codes.
 *
 * Both CATALOG_FILES entries are scanned as raw text via CODE_PATTERN, not
 * imported/required — this means a category that moves from inline TS
 * literals to an import (as DIST_* just did) MUST have its new file added
 * here, or its codes silently drop out of `catalogCodes` with no error (see
 * docs/solutions/code-quality/raw-text-scan-inline-to-import-blind-spot.md).
 *
 * Exit codes:
 *   0 - no re-implemented codes found
 *   1 - at least one scripts/ file hard-codes a catalog error code
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CATALOG_FILES = [
  path.join(ROOT, 'packages', 'domain', 'src', 'validation', 'errorCatalog.ts'),
  path.join(ROOT, 'packages', 'domain', 'src', 'validation', 'error-codes.json'),
];
const SCRIPTS_DIR = path.join(ROOT, 'scripts');

// ERROR-<CATEGORY>-<NUMBER> — the catalog's documented code format.
const CODE_PATTERN = /ERROR-[A-Z]+-\d+/g;

function collectScriptFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectScriptFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Prefix-collision check (R14). Pure function, exported for unit tests.
 *
 * R14 requires "asserting category prefixes are unique and never
 * substring-collide (explicitly: DIST vs existing DISC)". DIST and DISC
 * are NOT substrings of each other (they share a 3-char common prefix
 * "DIS" but differ in the 4th character) — the parenthetical is
 * illustrative, not a case the check must reject: it names the one
 * existing near-miss pair to confirm the lint does NOT false-positive on
 * it, proving the DIST naming choice was deliberately substring-safe
 * against DISC. (An earlier draft of this check added a Hamming-distance
 * rule specifically to flag DIST/DISC — that reading is self-contradictory:
 * R14 ships both the DIST-* codes and a passing lint from the same shell,
 * and a check that always fails while DIST-* exists can never be green.
 * The impossible-to-satisfy state was the proof; reverted.)
 *
 * @param {Iterable<string>} codes - ERROR-<PREFIX>-<NNN> code strings.
 * @returns {{ a: string, b: string, reason: 'substring' }[]}
 */
function findPrefixCollisions(codes) {
  const prefixes = new Set();
  for (const code of codes) {
    const match = /^ERROR-([A-Z]+)-\d+$/.exec(code);
    if (match) {
      prefixes.add(match[1]);
    }
  }
  const list = [...prefixes].sort();
  const collisions = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (a.includes(b) || b.includes(a)) {
        collisions.push({ a, b, reason: 'substring' });
      }
    }
  }
  return collisions;
}

function main() {
  const catalogCodes = new Set();
  for (const file of CATALOG_FILES) {
    if (!fs.existsSync(file)) {
      console.error(
        `[lint-error-codes] Error: error catalog file not found at ${path.relative(ROOT, file)}`
      );
      process.exit(1);
    }
    const codesInFile = fs.readFileSync(file, 'utf8').match(CODE_PATTERN) || [];
    // Per-file, not just an aggregate size===0 check: a whole file's
    // contribution silently vanishing (e.g. a category migrating to an
    // import, as DIST_* did) is exactly the failure mode this lint exists
    // to catch, and an aggregate check across 2+ files would not notice a
    // partial shrink as long as the OTHER file still contributes codes.
    if (codesInFile.length === 0) {
      console.error(
        `[lint-error-codes] Error: no ERROR-* codes found in ${path.relative(ROOT, file)} — ` +
          'either it moved, its format changed, or a category was migrated out ' +
          'without updating CATALOG_FILES; update this lint.'
      );
      process.exit(1);
    }
    for (const code of codesInFile) {
      catalogCodes.add(code);
    }
  }

  const collisions = findPrefixCollisions(catalogCodes);
  if (collisions.length > 0) {
    console.error('[lint-error-codes] ✗ colliding category prefixes:');
    for (const c of collisions) {
      console.error(`  "${c.a}" and "${c.b}" — one is a substring of the other; choose a more distinct prefix (R14).`);
    }
    process.exit(1);
  }

  const violations = [];
  for (const file of collectScriptFiles(SCRIPTS_DIR)) {
    // The lint script itself names the pattern in prose/regex — skip it.
    if (file === __filename) continue;
    const content = fs.readFileSync(file, 'utf8');
    const found = new Set(content.match(CODE_PATTERN) || []);
    for (const code of found) {
      if (catalogCodes.has(code)) {
        violations.push({ file: path.relative(ROOT, file), code });
      }
    }
  }

  if (violations.length > 0) {
    console.error(
      '[lint-error-codes] ✗ scripts/ files re-implement domain error codes:'
    );
    for (const v of violations) {
      console.error(
        `  ${v.file}: hard-codes "${v.code}" — import it from ` +
          'packages/domain/src/validation/errorCatalog.ts instead of ' +
          'duplicating the string.'
      );
    }
    process.exit(1);
  }

  console.log(
    `[lint-error-codes] ✓ no scripts/ file re-implements any of the ` +
      `${catalogCodes.size} catalog error codes`
  );
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { findPrefixCollisions };
