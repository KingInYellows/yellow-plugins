#!/usr/bin/env node

/**
 * backfill-solution-frontmatter.js
 *
 * Adds `track`, `problem`, and (where missing) `tags` frontmatter fields to
 * existing entries under `docs/solutions/`. Idempotent — re-running on a
 * fully-backfilled tree produces zero changes.
 *
 * Usage:
 *   node scripts/backfill-solution-frontmatter.js              # apply
 *   node scripts/backfill-solution-frontmatter.js --dry-run    # report only
 *   node scripts/backfill-solution-frontmatter.js --check      # exit non-zero if any file would change
 *
 * Env:
 *   SOLUTIONS_DIR=docs/solutions   override target dir (used by tests)
 *
 * Heuristic (per plans/everyinc-merge.md W2.0a):
 *   - logic-errors / security-issues / build-errors → track: bug
 *   - code-quality / workflow / integration-issues → track: knowledge
 *   - security-issues entries containing "audit", "threat model", or
 *     "pre-implementation" in title or first paragraph are flagged for
 *     manual review (NOT auto-assigned). Flagged entries are listed in the
 *     final report; they are NOT modified — operator must classify manually.
 *
 * The `problem` field is derived from the entry's existing `title`,
 * `symptom`, or first body paragraph in that order. If none yield a usable
 * one-liner ≤ 120 chars, the entry is flagged for manual review.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOLUTIONS_DIR = path.resolve(
  ROOT,
  process.env.SOLUTIONS_DIR || 'docs/solutions'
);

// Path-traversal guard: refuse to operate on a directory outside ROOT or the
// system temp directory. The temp-dir exception is for vitest fixtures that
// build synthetic solution trees under /tmp/yellow-* — see
// tests/integration/backfill-solution-frontmatter.test.ts.
const TMP_PREFIX = require('os').tmpdir();
if (
  !SOLUTIONS_DIR.startsWith(ROOT + path.sep) &&
  !SOLUTIONS_DIR.startsWith(TMP_PREFIX + path.sep)
) {
  console.error(
    '[backfill-solution-frontmatter] Error: SOLUTIONS_DIR resolves outside ' +
      'project root or system temp dir. Refusing to operate on: ' +
      SOLUTIONS_DIR
  );
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const CHECK_MODE = args.has('--check');

const CATEGORY_TO_TRACK = Object.freeze({
  'logic-errors': 'bug',
  'security-issues': 'bug',
  'build-errors': 'bug',
  'code-quality': 'knowledge',
  workflow: 'knowledge',
  'integration-issues': 'knowledge',
});

const SECURITY_KNOWLEDGE_MARKERS = [
  'audit',
  'threat model',
  'threat-model',
  'pre-implementation',
  'pre-implementation-review',
];

const RESULTS = {
  modified: [],
  alreadyComplete: [],
  flaggedForReview: [],
  errors: [],
};

function readEntry(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    // Distinguish I/O errors from parse errors so the operator gets a useful
    // message. ENOENT/EACCES indicate filesystem state, not bad content.
    throw new Error(`I/O error reading file: ${err.code || err.message}`);
  }
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    throw new Error(
      'missing YAML frontmatter (file does not start with `---` block); ' +
        'add full frontmatter inline before re-running'
    );
  }
  return { fmRaw: match[1], body: match[2], full: text };
}

function fmHasField(fmRaw, key) {
  return new RegExp(`^${escapeRe(key)}\\s*:`, 'm').test(fmRaw);
}

// True iff the field is present AND has a non-empty value. Used by the
// already-complete short-circuit so an empty `problem:` doesn't bypass
// derivation. Distinct from fmHasField, which only checks key presence.
function fmHasNonEmptyField(fmRaw, key) {
  if (!fmHasField(fmRaw, key)) return false;
  // For list-style keys (tags), check the parser explicitly. fmGetScalar
  // returns the raw inline string (e.g. '[]' for `tags: []`, 2 chars) which
  // would pass a length check below and short-circuit the parser fallback,
  // letting empty tag lists masquerade as "already complete".
  if (key === 'tags') return parseTagsList(fmRaw).length > 0;
  const value = fmGetScalar(fmRaw, key);
  return value !== null && value.trim().length > 0;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fmGetScalar(fmRaw, key) {
  // Handles three YAML forms:
  //   1. Inline scalar:           `title: foo` or `title: 'foo'`
  //   2. Folded/literal block:    `title: >` / `title: |` followed by indented lines
  //   3. Plain multi-line:        `title:` (or value-on-same-line + continuation
  //      lines that are merely indented; common in prettier-formatted YAML where
  //      a long string wraps under the key).
  // The third form is what produced the truncated `problem` values found in the
  // initial backfill (e.g., `wsl2-crlf-pr-merge-unblocking.md`,
  // `yellow-linear-plugin-pr-review-fixes.md`,
  // `skill-frontmatter-attribute-and-format-requirements.md`). The fix joins
  // continuation lines for case (3) the same way it does for case (2).
  const escKey = escapeRe(key);
  // [ \t]* (not \s*) between `:` and capture group — \s* would greedy-match
  // across newlines and capture the first indented line as the "head value",
  // which produced the truncated `problem` regression in the initial backfill.
  const inline = fmRaw.match(new RegExp(`^${escKey}\\s*:[ \\t]*(.*)$`, 'm'));
  if (!inline) return null;
  const headValue = inline[1];

  // Case 2: folded/literal block scalar.
  if (headValue.trim() === '>' || headValue.trim() === '|') {
    const collected = collectIndentedContinuation(fmRaw, key);
    return collected || null;
  }

  // Case 3: plain multi-line — head value is non-empty but next line is
  // indented (no key prefix). Join continuation.
  const continuation = collectIndentedContinuation(fmRaw, key);
  if (continuation) {
    const joined = `${headValue.trim()} ${continuation}`.trim();
    return stripWrappingQuotes(joined);
  }

  // Case 1: simple inline scalar.
  return stripWrappingQuotes(headValue.trim());
}

// Collect lines that follow `<key>:` AND are indented (i.e., they are
// continuation lines belonging to the value, not the next top-level key or a
// block-style list bullet). Returns the joined text or empty string.
function collectIndentedContinuation(fmRaw, key) {
  const lines = fmRaw.split(/\r?\n/);
  const escKey = escapeRe(key);
  let started = false;
  const collected = [];
  for (const line of lines) {
    if (!started) {
      if (line.match(new RegExp(`^${escKey}\\s*:`))) {
        started = true;
        continue;
      }
      continue;
    }
    // Stop on next top-level key (column-0, ends with `:`) or block-list marker.
    if (/^\S/.test(line) && !line.match(/^\s*-/)) break;
    // List-item match: dash followed by whitespace OR by non-whitespace.
    // The looser pattern catches malformed `  -item` (no space after dash)
    // which would otherwise be incorrectly collected as a scalar
    // continuation, producing corrupted `problem` field derivations.
    if (line.match(/^\s*-(\s|\S)/)) break;
    if (line.trim() === '') break;
    collected.push(line.replace(/^\s+/, ''));
  }
  return collected.join(' ').trim();
}

function stripWrappingQuotes(s) {
  return s.replace(/^['"]|['"]$/g, '');
}

function deriveCategory(filePath) {
  const rel = path.relative(SOLUTIONS_DIR, filePath);
  return rel.split(path.sep)[0];
}

function deriveTrack(category, fmRaw, body) {
  const defaultTrack = CATEGORY_TO_TRACK[category];
  if (!defaultTrack) {
    return { track: null, reason: `unknown-category:${category}` };
  }

  // security-issues marker check: if title or first paragraph signals
  // audit / threat-model / pre-implementation, flag for manual review
  // rather than auto-assigning bug.
  if (category === 'security-issues') {
    const title = fmGetScalar(fmRaw, 'title') || '';
    const firstPara = body.split(/\r?\n\r?\n/)[0] || '';
    const haystack = `${title}\n${firstPara}`.toLowerCase();
    for (const marker of SECURITY_KNOWLEDGE_MARKERS) {
      if (haystack.includes(marker)) {
        return {
          track: null,
          reason: `manual-review-needed:security-issues-with-${marker.replace(/\s+/g, '-')}-marker`,
        };
      }
    }
  }

  return { track: defaultTrack, reason: `default-for-${category}` };
}

function deriveProblem(fmRaw, body) {
  // Priority order: existing `problem`, `symptom` (folded or scalar),
  // `title`, first non-empty body paragraph.
  const existing = fmGetScalar(fmRaw, 'problem');
  if (existing) return { problem: existing, source: 'existing-problem-field' };

  const symptom = fmGetScalar(fmRaw, 'symptom');
  if (symptom) {
    const trimmed = symptom.length > 120 ? symptom.slice(0, 117) + '...' : symptom;
    return { problem: trimmed, source: 'derived-from-symptom' };
  }

  const title = fmGetScalar(fmRaw, 'title');
  if (title) {
    const trimmed = title.length > 120 ? title.slice(0, 117) + '...' : title;
    return { problem: trimmed, source: 'derived-from-title' };
  }

  const firstPara = body.split(/\r?\n\r?\n/).find((p) => p.trim().length > 0);
  if (firstPara) {
    const flat = firstPara.replace(/\s+/g, ' ').trim();
    const trimmed = flat.length > 120 ? flat.slice(0, 117) + '...' : flat;
    return { problem: trimmed, source: 'derived-from-first-paragraph' };
  }

  return { problem: null, source: 'no-source-found' };
}

function deriveTags(fmRaw, category) {
  // If `tags:` already exists, never inject. Two cases:
  //   - At least one parseable entry: leave it alone.
  //   - Zero parseable items (bare `tags:`, `tags: []`, malformed list):
  //     do NOT inject a second `tags:` block — that would produce duplicate
  //     YAML keys. Operator must expand the existing key by hand.
  if (fmHasField(fmRaw, 'tags')) return null;

  // Seed minimum tags from the category as a fallback when the key is
  // missing entirely. Operators should expand by hand.
  return [category];
}

function parseTagsList(fmRaw) {
  const inline = fmRaw.match(/^tags\s*:\s*\[([^\]]+)\]/m);
  if (inline) {
    return inline[1]
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }
  const lines = fmRaw.split(/\r?\n/);
  const collected = [];
  let inList = false;
  for (const line of lines) {
    if (!inList) {
      if (/^tags\s*:\s*$/.test(line)) inList = true;
      continue;
    }
    const item = line.match(/^\s*-\s+(.+?)\s*$/);
    if (item) {
      collected.push(item[1].replace(/^['"]|['"]$/g, ''));
      continue;
    }
    if (line.trim() === '') continue;
    if (!/^\s/.test(line)) break;
  }
  return collected;
}

function injectFrontmatter(fmRaw, additions) {
  // Insert new fields after the existing `category:` line. Some legacy
  // entries use `problem_type:` instead of `category:` — fall back to that,
  // then to end of frontmatter as a last resort.
  // Detect and preserve the original line ending. Splitting on /\r?\n/
  // and rejoining with `\n` would silently convert CRLF frontmatter to
  // LF while leaving the rest of the file with CRLF — producing mixed
  // line endings (a known WSL2 / Windows hazard, see
  // docs/solutions/workflow/wsl2-crlf-pr-merge-unblocking.md).
  const lineEndingMatch = fmRaw.match(/\r?\n/);
  const lineEnding = lineEndingMatch ? lineEndingMatch[0] : '\n';
  const lines = fmRaw.split(/\r?\n/);
  const categoryIdx = lines.findIndex((l) => /^category\s*:/.test(l));
  const problemTypeIdx = lines.findIndex((l) => /^problem_type\s*:/.test(l));
  const insertIdx =
    categoryIdx >= 0
      ? categoryIdx + 1
      : problemTypeIdx >= 0
        ? problemTypeIdx + 1
        : lines.length;
  const newLines = [];
  if (additions.track) newLines.push(`track: ${additions.track}`);
  if (additions.problem) {
    const escaped = additions.problem.replace(/'/g, "''");
    newLines.push(`problem: '${escaped}'`);
  }
  if (additions.tags && additions.tags.length > 0) {
    const tagsBlock = ['tags:', ...additions.tags.map((t) => `  - ${t}`)];
    newLines.push(...tagsBlock);
  }
  lines.splice(insertIdx, 0, ...newLines);
  return lines.join(lineEnding);
}

function processEntry(filePath) {
  let parsed;
  try {
    parsed = readEntry(filePath);
  } catch (err) {
    RESULTS.errors.push({ file: filePath, error: err.message });
    return;
  }

  const category = deriveCategory(filePath);
  // Use fmHasNonEmptyField for the already-complete short-circuit so a
  // bare `problem:` (no value) or empty `tags:` list does not silently
  // bypass derivation. Use fmHasField below when deciding whether to add
  // a field — if the key is present (even empty) we still skip injection
  // to avoid duplicate keys.
  const hasTrack = fmHasNonEmptyField(parsed.fmRaw, 'track');
  const hasProblem = fmHasNonEmptyField(parsed.fmRaw, 'problem');
  const hasTags = fmHasNonEmptyField(parsed.fmRaw, 'tags');

  if (hasTrack && hasProblem && hasTags) {
    RESULTS.alreadyComplete.push(path.relative(ROOT, filePath));
    return;
  }

  // Don't double-inject — these gate field addition.
  const hasTrackKey = fmHasField(parsed.fmRaw, 'track');
  const hasProblemKey = fmHasField(parsed.fmRaw, 'problem');

  const additions = {};

  if (!hasTrackKey) {
    const { track, reason } = deriveTrack(category, parsed.fmRaw, parsed.body);
    if (!track) {
      RESULTS.flaggedForReview.push({
        file: path.relative(ROOT, filePath),
        category,
        reason,
      });
      return;
    }
    additions.track = track;
  }

  if (!hasProblemKey) {
    const { problem, source } = deriveProblem(parsed.fmRaw, parsed.body);
    if (!problem) {
      RESULTS.flaggedForReview.push({
        file: path.relative(ROOT, filePath),
        category,
        reason: `no-derivable-problem:${source}`,
      });
      return;
    }
    additions.problem = problem;
  }

  const tags = deriveTags(parsed.fmRaw, category);
  if (tags !== null) additions.tags = tags;

  // If derivation produced no additions (e.g., all keys present-but-empty
  // and we don't double-inject), there is nothing to do. Flag for review
  // rather than counting as modified — a present-but-empty field is a
  // sign of operator action needed, not a clean state.
  if (Object.keys(additions).length === 0) {
    RESULTS.flaggedForReview.push({
      file: path.relative(ROOT, filePath),
      category,
      reason:
        'present-but-empty-fields: track/problem keys exist but have no ' +
        'value, and the gate prevents double-injection. Set values manually.',
    });
    return;
  }

  const newFm = injectFrontmatter(parsed.fmRaw, additions);
  // Preserve the original line ending around the `---` delimiters so a CRLF
  // file does not produce mixed line endings. injectFrontmatter already
  // preserves CRLF inside the frontmatter body, and `parsed.body` retains its
  // original endings — only the delimiter newlines need explicit handling.
  const lineEndingMatch = parsed.full.match(/\r?\n/);
  const lineEnding = lineEndingMatch ? lineEndingMatch[0] : '\n';
  const newText = `---${lineEnding}${newFm}${lineEnding}---${lineEnding}${parsed.body}`;

  if (!DRY_RUN && !CHECK_MODE) {
    // Atomic write: write to a sibling temp file, then rename. A partial
    // write (disk full, kill -9, permission flip mid-write) leaves the
    // original file untouched rather than truncated. Same-directory temp
    // ensures rename(2) is atomic on every supported filesystem.
    const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    try {
      fs.writeFileSync(tmpPath, newText, 'utf8');
      fs.renameSync(tmpPath, filePath);
    } catch (err) {
      // Best-effort cleanup of the temp file if it exists.
      try {
        fs.unlinkSync(tmpPath);
      } catch (_) {
        // ignore — the rename either succeeded (no temp left) or never
        // created the temp; either way nothing to do.
      }
      RESULTS.errors.push({
        file: filePath,
        error: `write failed: ${err.code || err.message}`,
      });
      return;
    }
  }
  RESULTS.modified.push({
    file: path.relative(ROOT, filePath),
    added: Object.keys(additions),
  });
}

function walkSolutions() {
  const entries = [];
  let topLevel;
  try {
    topLevel = fs.readdirSync(SOLUTIONS_DIR, { withFileTypes: true });
  } catch (err) {
    RESULTS.errors.push({
      file: SOLUTIONS_DIR,
      error: `cannot read SOLUTIONS_DIR: ${err.code || err.message}`,
    });
    return entries;
  }
  // Warn on root-level .md files — the script only walks one level deep
  // (category subdirectory → files), so anything at the root would be
  // silently ignored without this warning.
  for (const dirent of topLevel) {
    if (dirent.isFile() && dirent.name.endsWith('.md')) {
      console.warn(
        `[backfill-solution-frontmatter] Warning: skipping root-level file ` +
          `${dirent.name} (expected category subdirectory)`
      );
    }
    if (!dirent.isDirectory()) continue;
    const subDir = path.join(SOLUTIONS_DIR, dirent.name);
    let subEntries;
    try {
      subEntries = fs.readdirSync(subDir);
    } catch (err) {
      RESULTS.errors.push({
        file: subDir,
        error: `cannot read category dir: ${err.code || err.message}`,
      });
      continue;
    }
    for (const f of subEntries) {
      if (f.endsWith('.md')) entries.push(path.join(subDir, f));
    }
  }
  return entries;
}

function main() {
  if (!fs.existsSync(SOLUTIONS_DIR)) {
    console.error(
      `[backfill-solution-frontmatter] Error: ${SOLUTIONS_DIR} not found`
    );
    process.exit(1);
  }

  const files = walkSolutions();
  for (const file of files) processEntry(file);

  console.log('=== backfill-solution-frontmatter.js ===');
  console.log(`mode: ${DRY_RUN ? 'dry-run' : CHECK_MODE ? 'check' : 'apply'}`);
  console.log(`scanned: ${files.length} files`);
  console.log(`modified: ${RESULTS.modified.length}`);
  console.log(`already complete: ${RESULTS.alreadyComplete.length}`);
  console.log(`flagged for manual review: ${RESULTS.flaggedForReview.length}`);
  console.log(`errors: ${RESULTS.errors.length}`);

  if (RESULTS.modified.length > 0) {
    console.log('\n--- modified ---');
    for (const m of RESULTS.modified) {
      console.log(`  ${m.file}  +${m.added.join(', +')}`);
    }
  }

  if (RESULTS.flaggedForReview.length > 0) {
    console.log('\n--- flagged for manual review ---');
    for (const f of RESULTS.flaggedForReview) {
      console.log(`  ${f.file}  (${f.reason})`);
    }
    console.log(
      '\nReview the flagged files manually. For each, decide whether the entry'
    );
    console.log(
      'is bug-track (specific incident) or knowledge-track (pattern/guideline)'
    );
    console.log(
      'and add `track:` to the frontmatter explicitly. Then re-run this script.'
    );
  }

  // Exit code precedence:
  //   - errors AND --check changes:   exit 1 (errors take priority; CI logs
  //     should always investigate errors first, then re-run --check after
  //     errors are resolved to get the "needs-changes" signal).
  //   - errors only:                  exit 1
  //   - --check changes only:         exit 2
  //   - clean run:                    exit 0
  // The "errors take priority" precedence is intentional and documented; the
  // alternative (return 2 even when errors exist) would mask filesystem
  // problems behind the "needs-changes" path.
  if (RESULTS.errors.length > 0) {
    console.log('\n--- errors ---');
    for (const e of RESULTS.errors) {
      console.log(`  ${e.file}: ${e.error}`);
    }
    if (CHECK_MODE && RESULTS.modified.length > 0) {
      console.log(
        '\n[check] Note: Files would also need modification, but errors ' +
          'take precedence. Resolve errors and re-run with --check.'
      );
    }
    process.exit(1);
  }

  if (CHECK_MODE && RESULTS.modified.length > 0) {
    console.log(
      '\n[check] Files would be modified. Run without --check to apply.'
    );
    process.exit(2);
  }

  // --check must also fail when entries need manual review. Otherwise an
  // entry flagged for ambiguous track classification (e.g., a security-
  // issues doc that may be an audit/threat-model rather than a bug fix)
  // silently passes the gate and the unresolved frontmatter ships with
  // the PR.
  if (CHECK_MODE && RESULTS.flaggedForReview.length > 0) {
    console.log(
      `\n[check] ${RESULTS.flaggedForReview.length} entries flagged for ` +
        `manual review. Resolve their classification (e.g., set track: ` +
        `knowledge for audit/threat-model docs) before proceeding.`
    );
    process.exit(3);
  }
}

main();
