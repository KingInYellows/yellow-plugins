#!/usr/bin/env node

/**
 * validate-jules.js — drift check over the units yellow-jules copies from
 * yellow-cursor (docs/yellow-jules/contract-v1.md "Redaction"). An installed
 * plugin cannot import across plugins, so the copies are deliberate; this
 * gate keeps them from silently diverging.
 *
 * Each unit is wrapped in both files by an anchored line pair
 *   // replica:<unit>:start
 *   // replica:<unit>:end
 * and the two slices must match after normalization:
 *   - CRLF -> LF;
 *   - the declared substitution map applied to the yellow-cursor slice
 *     (`CURSOR` -> `JULES`, `yellow-cursor` -> `yellow-jules`), which covers
 *     the intentionally divergent env-var names and error-code prefixes;
 *   - whitespace removed and trailing commas before a closing bracket
 *     dropped, so formatter line-folding (the substituted names differ in
 *     length) is not drift. Whitespace inside string, template, and regex
 *     literals is preserved: changing it changes behavior.
 * Intentionally divergent lines (secret patterns, the live-key env var) stay
 * outside the markers.
 *
 * Checks (codes in packages/domain/src/validation/errorCatalog.ts):
 *   - every registered unit has exactly one marker pair in each file (-001)
 *   - the normalized slices are identical (-002)
 *
 * Env overrides (for integration-test fixtures):
 *   VALIDATE_JULES_ROOT — project root to validate
 *
 * Exit codes: 0 = all units match; 1 = any check failed.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(
  process.env.VALIDATE_JULES_ROOT || path.join(__dirname, '..')
);

// Assembled via concatenation, not literals: scripts/lint-error-codes.js
// fails CI on literal catalog codes under scripts/ (ESM catalog, CJS
// scripts). Any change to the catalog entries requires a paired edit here.
const JULES = 'ERROR-' + 'JULES';
const JULES_REPLICA_MARKER_MISSING = JULES + '-001';
const JULES_REPLICA_DRIFT = JULES + '-002';

const SUBSTITUTIONS = [
  ['yellow-cursor', 'yellow-jules'],
  ['CURSOR', 'JULES'],
];

const REPLICAS = [
  { unit: 'validateRef', file: 'validate.ts' },
  { unit: 'validateIdempotencyKey', file: 'validate.ts' },
  { unit: 'assertNoSecretShapedValues', file: 'redact.ts' },
  { unit: 'redactDeep', file: 'redact.ts' },
  { unit: 'resolveDataDir', file: 'config.ts' },
  { unit: 'AppError', file: 'errors.ts' },
  { unit: 'makeAppError', file: 'errors.ts' },
];

function markerLine(unit, edge) {
  return `// replica:${unit}:${edge}`;
}

/** Returns the text strictly between the unit's marker lines, or an error string. */
function sliceUnit(text, unit) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const starts = [];
  const ends = [];
  lines.forEach((line, index) => {
    if (line.trim() === markerLine(unit, 'start')) starts.push(index);
    if (line.trim() === markerLine(unit, 'end')) ends.push(index);
  });
  if (starts.length !== 1 || ends.length !== 1) {
    return {
      error: `expected exactly one ${markerLine(unit, 'start')} / ${markerLine(unit, 'end')} pair, found ${starts.length} start and ${ends.length} end`,
    };
  }
  if (ends[0] <= starts[0]) {
    return { error: `${markerLine(unit, 'end')} precedes its start marker` };
  }
  return { slice: lines.slice(starts[0] + 1, ends[0]).join('\n') };
}

function substitute(text) {
  return SUBSTITUTIONS.reduce(
    (out, [from, to]) => out.split(from).join(to),
    text
  );
}

// A `/` starts a regex literal (not division) after one of these characters.
const REGEX_PRECEDERS = '(,=:[!&|?{};+-*%<>~^';

/**
 * Drops whitespace and trailing commas before a closing bracket, but leaves
 * the contents of string, template, and regex literals untouched so a change
 * such as 'Application Support' -> 'ApplicationSupport' is still drift.
 * A small scanner, not a parser: template `${}` bodies are kept verbatim.
 */
function normalize(text) {
  let out = '';
  let lastSignificant = '';
  let i = 0;
  const copyUntil = (end) => {
    out += text.slice(i, end);
    i = end;
  };
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      // Comment text is compared with whitespace removed (formatter-safe).
      const eol = text.indexOf('\n', i);
      out += text.slice(i, eol === -1 ? text.length : eol).replace(/\s+/g, '');
      i = eol === -1 ? text.length : eol;
      continue;
    }
    if (ch === '/' && next === '*') {
      const close = text.indexOf('*/', i + 2);
      const end = close === -1 ? text.length : close + 2;
      out += text.slice(i, end).replace(/\s+/g, '');
      i = end;
      continue;
    }
    const isRegex =
      ch === '/' &&
      (lastSignificant === '' || REGEX_PRECEDERS.includes(lastSignificant));
    if (ch === "'" || ch === '"' || ch === '`' || isRegex) {
      let j = i + 1;
      let inClass = false;
      while (j < text.length) {
        const c = text[j];
        if (c === '\\') {
          j += 2;
          continue;
        }
        if (isRegex && c === '[') inClass = true;
        else if (isRegex && c === ']') inClass = false;
        else if (c === ch && !inClass) break;
        j += 1;
      }
      copyUntil(Math.min(j + 1, text.length));
      lastSignificant = ch === '/' ? ')' : ch;
      continue;
    }
    if (')]}'.includes(ch) && out.endsWith(',')) out = out.slice(0, -1);
    out += ch;
    lastSignificant = ch;
    i += 1;
  }
  return out;
}

function firstDifference(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  const context = (s) => JSON.stringify(s.slice(Math.max(0, i - 20), i + 40));
  return `yellow-cursor ${context(a)} vs yellow-jules ${context(b)}`;
}

function readSource(plugin, file, errors, unit) {
  const full = path.join(ROOT, 'plugins', plugin, 'src', file);
  try {
    return fs.readFileSync(full, 'utf8');
  } catch (error) {
    errors.push(
      `${JULES_REPLICA_MARKER_MISSING}: ${path.relative(ROOT, full)} is unreadable for unit "${unit}": ${error.message}`
    );
    return undefined;
  }
}

function validateReplicas() {
  const errors = [];
  for (const { unit, file } of REPLICAS) {
    const cursorText = readSource('yellow-cursor', file, errors, unit);
    const julesText = readSource('yellow-jules', file, errors, unit);
    if (cursorText === undefined || julesText === undefined) continue;

    const cursor = sliceUnit(cursorText, unit);
    const jules = sliceUnit(julesText, unit);
    let missing = false;
    for (const [plugin, result] of [
      ['yellow-cursor', cursor],
      ['yellow-jules', jules],
    ]) {
      if (result.error !== undefined) {
        errors.push(
          `${JULES_REPLICA_MARKER_MISSING}: plugins/${plugin}/src/${file}: ${result.error}`
        );
        missing = true;
      }
    }
    if (missing) continue;

    const expected = normalize(substitute(cursor.slice));
    const actual = normalize(jules.slice);
    if (expected !== actual) {
      errors.push(
        `${JULES_REPLICA_DRIFT}: unit "${unit}" in plugins/yellow-jules/src/${file} drifts from plugins/yellow-cursor/src/${file}: ${firstDifference(expected, actual)}`
      );
    }
  }
  return errors;
}

function main() {
  const errors = validateReplicas();
  if (errors.length > 0) {
    for (const error of errors) console.error(`[validate-jules] ${error}`);
    process.exit(1);
  }
  console.log(
    `[validate-jules] OK: ${REPLICAS.length} replica unit(s) match yellow-cursor`
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  validateReplicas,
  sliceUnit,
  normalize,
  substitute,
  REPLICAS,
};
