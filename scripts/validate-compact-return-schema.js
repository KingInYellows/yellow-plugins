#!/usr/bin/env node

/**
 * Compact-Return Schema Drift Validator
 *
 * Every Wave 2 review persona emits findings in the compact-return schema the
 * `/review:pr` aggregator parses. A subagent cannot read
 * `pr-review-workflow/SKILL.md` at dispatch, so each persona carries an inline
 * copy, and a drifted copy used to fail only at runtime, as a return the
 * aggregator could not parse (CLAUDE-30).
 *
 * The canonical schema lives in plugins/yellow-review/skills/pr-review-workflow/
 * SKILL.md between two marker lines:
 *
 *   <!-- compact-return-schema:begin -->  ...one ```json fence...  <!-- compact-return-schema:end -->
 *   <!-- compact-return-notes:begin -->   ...persona-facing prose...  <!-- compact-return-notes:end -->
 *
 * Rules, for every Markdown file under plugins/<name>/agents/ and
 * plugins/<name>/skills/ (generated codex/ and cursor/ copies are covered by
 * `generate-manifests.js --check` instead):
 *
 *   U  Unmarked copy. A ```json or ```jsonc fence holding both "findings" and
 *      "residual_risks" outside a schema marker pair fails, so a new persona
 *      cannot copy the schema without being checked.
 *   S  Structure. Each marked copy keeps the canonical top-level keys and
 *      finding keys in the same order with the same value types. Enum fields
 *      (`severity`, `autofix_class`, `owner`) may narrow to a subset; the
 *      `rule` and `scope` placeholders must match byte for byte; extension
 *      keys may follow `suggested_fix`; `confidence` must be a rubric anchor.
 *   N  Notes. Every file under agents/ that carries a schema copy also
 *      carries the notes block, byte-identical to the canonical one.
 *
 * Usage:
 *   node scripts/validate-compact-return-schema.js
 *
 * Exit codes:
 *   0 - every copy agrees with the canonical schema
 *   1 - at least one disagreement (file and reason printed to stderr)
 *
 * Test parameterization (used by integration tests):
 *   VALIDATE_COMPACT_RETURN_ROOT - override the project root
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(
  process.env.VALIDATE_COMPACT_RETURN_ROOT || process.cwd()
);
const CANONICAL_REL =
  'plugins/yellow-review/skills/pr-review-workflow/SKILL.md';

const SCHEMA_BEGIN = '<!-- compact-return-schema:begin -->';
const SCHEMA_END = '<!-- compact-return-schema:end -->';
const NOTES_BEGIN = '<!-- compact-return-notes:begin -->';
const NOTES_END = '<!-- compact-return-notes:end -->';

const ENUM_FIELDS = new Set(['severity', 'autofix_class', 'owner']);
const EXACT_FIELDS = new Set(['rule', 'scope']);
const CONFIDENCE_ANCHORS = new Set([0, 25, 50, 75, 100]);
const JSON_FENCE = /^```jsonc?$/;

const errors = [];
function fail(rel, message) {
  errors.push(`${rel}: ${message}`);
}

/** Lines strictly between the begin and end marker lines, or null. */
function extractRegion(lines, begin, end, rel) {
  const starts = [];
  const ends = [];
  lines.forEach((line, i) => {
    if (line.trim() === begin) starts.push(i);
    if (line.trim() === end) ends.push(i);
  });
  if (starts.length === 0 && ends.length === 0) return null;
  if (starts.length !== 1 || ends.length !== 1 || ends[0] < starts[0]) {
    fail(rel, `expected exactly one ${begin} ... ${end} pair`);
    return null;
  }
  return {
    start: starts[0],
    end: ends[0],
    body: lines.slice(starts[0] + 1, ends[0]),
  };
}

/** The JSON text of the single ```json fence inside a schema region. */
function fenceJson(region, rel) {
  const body = region.body.filter((l) => l.trim() !== '');
  if (
    body.length < 2 ||
    !JSON_FENCE.test(body[0].trim()) ||
    body[body.length - 1].trim() !== '```'
  ) {
    fail(
      rel,
      'the schema markers must wrap exactly one ```json (or ```jsonc) fence'
    );
    return null;
  }
  // JSONC: persona copies may annotate extension keys with // comment lines.
  return body
    .slice(1, -1)
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}

function parseSchema(text, rel) {
  try {
    return JSON.parse(text);
  } catch (err) {
    fail(rel, `schema block is not valid JSON: ${err.message}`);
    return null;
  }
}

function typeOf(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  if (typeof value === 'number')
    return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function enumSet(value) {
  return new Set(
    String(value)
      .split('|')
      .map((s) => s.trim())
  );
}

function checkFinding(canon, copy, rel) {
  const canonKeys = Object.keys(canon);
  const copyKeys = Object.keys(copy);
  const base = copyKeys.slice(0, canonKeys.length);
  if (base.join(',') !== canonKeys.join(',')) {
    fail(
      rel,
      `finding keys must start with the canonical keys in order.\n    expected: ${canonKeys.join(', ')}\n    found:    ${base.join(', ')}`
    );
    return;
  }
  for (const key of canonKeys) {
    const want = typeOf(canon[key]);
    const got = typeOf(copy[key]);
    if (want !== got) {
      fail(rel, `finding.${key} must be ${want}, found ${got}`);
      continue;
    }
    if (ENUM_FIELDS.has(key)) {
      const allowed = enumSet(canon[key]);
      const extra = [...enumSet(copy[key])].filter((v) => !allowed.has(v));
      if (extra.length > 0) {
        fail(
          rel,
          `finding.${key} lists values outside the canonical set (${canon[key]}): ${extra.join(', ')}`
        );
      }
    }
    if (EXACT_FIELDS.has(key) && copy[key] !== canon[key]) {
      fail(
        rel,
        `finding.${key} placeholder must read ${JSON.stringify(canon[key])}`
      );
    }
    if (key === 'confidence' && !CONFIDENCE_ANCHORS.has(copy[key])) {
      fail(
        rel,
        `finding.confidence example must be a rubric anchor (0, 25, 50, 75, 100), found ${copy[key]}`
      );
    }
  }
}

function checkSchema(canon, copy, rel) {
  if (typeOf(copy) !== 'object') {
    fail(rel, 'schema block must be a JSON object');
    return;
  }
  const want = Object.keys(canon).join(',');
  const got = Object.keys(copy).join(',');
  if (want !== got) {
    fail(
      rel,
      `top-level keys must be exactly: ${Object.keys(canon).join(', ')} (found ${Object.keys(copy).join(', ')})`
    );
    return;
  }
  if (typeOf(copy.reviewer) !== 'string')
    fail(rel, 'reviewer must be a string');
  for (const bucket of ['residual_risks', 'testing_gaps']) {
    if (!Array.isArray(copy[bucket]) || copy[bucket].length !== 0) {
      fail(rel, `${bucket} must be an empty array (the aggregator owns it)`);
    }
  }
  if (
    !Array.isArray(copy.findings) ||
    copy.findings.length !== 1 ||
    typeOf(copy.findings[0]) !== 'object'
  ) {
    fail(rel, 'findings must hold exactly one example finding object');
    return;
  }
  checkFinding(canon.findings[0], copy.findings[0], rel);
}

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
}

function candidateFiles() {
  const pluginsDir = path.join(ROOT, 'plugins');
  const files = [];
  let plugins = [];
  try {
    plugins = fs
      .readdirSync(pluginsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory());
  } catch {
    return files;
  }
  // Only agents/ and skills/ are walked: plugins/<name>/codex/ and cursor/
  // hold generated skill copies that generate-manifests.js --check pins.
  for (const plugin of plugins) {
    walk(path.join(pluginsDir, plugin.name, 'agents'), files);
    walk(path.join(pluginsDir, plugin.name, 'skills'), files);
  }
  return files.sort();
}

/** Line ranges of ```json fences that look like a compact-return schema. */
function schemaLikeFences(lines) {
  const fences = [];
  for (let i = 0; i < lines.length; i++) {
    if (!JSON_FENCE.test(lines[i].trim())) continue;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== '```') j++;
    const text = lines.slice(i + 1, j).join('\n');
    if (text.includes('"findings"') && text.includes('"residual_risks"'))
      fences.push(i);
    i = j;
  }
  return fences;
}

function main() {
  const canonPath = path.join(ROOT, CANONICAL_REL);
  let canonLines;
  try {
    canonLines = fs.readFileSync(canonPath, 'utf8').split('\n');
  } catch (err) {
    console.error(
      `Cannot read the canonical schema file ${CANONICAL_REL}: ${err.message}`
    );
    process.exit(1);
  }
  const canonSchemaRegion = extractRegion(
    canonLines,
    SCHEMA_BEGIN,
    SCHEMA_END,
    CANONICAL_REL
  );
  const canonNotesRegion = extractRegion(
    canonLines,
    NOTES_BEGIN,
    NOTES_END,
    CANONICAL_REL
  );
  if (!canonSchemaRegion || !canonNotesRegion) {
    fail(
      CANONICAL_REL,
      'the canonical file must carry both the schema and the notes marker pairs'
    );
  }
  const canonText =
    canonSchemaRegion && fenceJson(canonSchemaRegion, CANONICAL_REL);
  const canon = canonText && parseSchema(canonText, CANONICAL_REL);
  if (!canon || errors.length > 0) {
    report(0);
    return;
  }
  const canonNotes = canonNotesRegion.body.join('\n');

  let copies = 0;
  for (const file of candidateFiles()) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (rel === CANONICAL_REL) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const schemaRegion = extractRegion(lines, SCHEMA_BEGIN, SCHEMA_END, rel);
    for (const at of schemaLikeFences(lines)) {
      if (!schemaRegion || at < schemaRegion.start || at > schemaRegion.end) {
        fail(
          rel,
          `line ${at + 1}: compact-return schema copy is not wrapped in ${SCHEMA_BEGIN} / ${SCHEMA_END}`
        );
      }
    }
    const notesRegion = extractRegion(lines, NOTES_BEGIN, NOTES_END, rel);
    if (notesRegion && notesRegion.body.join('\n') !== canonNotes) {
      fail(
        rel,
        `notes block differs from the canonical one in ${CANONICAL_REL}`
      );
    }
    if (!schemaRegion) continue;
    copies++;
    const text = fenceJson(schemaRegion, rel);
    const copy = text && parseSchema(text, rel);
    if (copy) checkSchema(canon, copy, rel);
    if (rel.includes('/agents/') && !notesRegion) {
      fail(
        rel,
        `persona carries a schema copy but no ${NOTES_BEGIN} / ${NOTES_END} block`
      );
    }
  }
  report(copies);
}

function report(copies) {
  if (errors.length > 0) {
    console.error(
      `\x1b[31m✗ Compact-return schema drift (${errors.length}):\x1b[0m`
    );
    for (const e of errors) console.error(`  ${e}`);
    console.error(`\nThe canonical schema and notes live in ${CANONICAL_REL}.`);
    process.exit(1);
  }
  console.log(
    `\x1b[32m✓ Compact-return schema: ${copies} persona copies agree with ${CANONICAL_REL}\x1b[0m`
  );
}

main();
