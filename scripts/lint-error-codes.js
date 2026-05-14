#!/usr/bin/env node

'use strict';

/**
 * Error-code re-implementation lint (PR-A, finding 008 — narrowed).
 *
 * The repo has two parallel validation stacks (see CONTRIBUTING.md "Split
 * Validation Architecture"): the hand-rolled `scripts/*.js` validators and
 * the AJV-based `packages/` library. They are intentionally separate — but
 * the canonical error-code registry lives in
 * `packages/domain/src/validation/errorCatalog.ts`. If a `scripts/*.js`
 * validator hard-codes one of those `ERROR-<CATEGORY>-<NNN>` code strings,
 * the two stacks have silently drifted: the catalog is the single source of
 * truth and the script should import it (the packages build emits CJS that
 * `scripts/` can `require`).
 *
 * This check fails CI when any file under `scripts/` contains a literal
 * error-code string that is already defined in the catalog. It does NOT
 * flag the plain-English error messages the scripts currently use — only
 * the structured `ERROR-*` codes.
 *
 * Exit codes:
 *   0 - no re-implemented codes found
 *   1 - at least one scripts/ file hard-codes a catalog error code
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CATALOG = path.join(
  ROOT,
  'packages',
  'domain',
  'src',
  'validation',
  'errorCatalog.ts'
);
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

function main() {
  if (!fs.existsSync(CATALOG)) {
    console.error(
      `[lint-error-codes] Error: error catalog not found at ${path.relative(ROOT, CATALOG)}`
    );
    process.exit(1);
  }

  const catalogCodes = new Set(
    fs.readFileSync(CATALOG, 'utf8').match(CODE_PATTERN) || []
  );
  if (catalogCodes.size === 0) {
    console.error(
      '[lint-error-codes] Error: no ERROR-* codes found in the catalog — ' +
        'either the catalog moved or its format changed; update this lint.'
    );
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

main();
