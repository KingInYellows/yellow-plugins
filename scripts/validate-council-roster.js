#!/usr/bin/env node

/**
 * Council Reviewer-Roster Drift Validator
 *
 * `/council` fans out to a roster of reviewers. That roster is restated across
 * ~120 sites in 22 files — prose, agent bodies, an executable setup.md, a test
 * helper array. Nothing kept them consistent, and seven sites went stale
 * describing the pre-claude-reviewer three-reviewer world without any reviewer
 * being added.
 *
 * scripts/council-roster.json is the canonical declaration. This validator
 * enforces four rules against it:
 *
 *   D  Structural. The roster must equal council.md's two real definition
 *      sites — the fixed `for reviewer in ...` loop and the set of
 *      `subagent_type="..."` spawns. Airtight; no prose parsing.
 *   T/C/O  Count lint. Numerals anchored to reviewer/slot/CLI nouns must equal
 *      the derived total (T), CLI subset (C), or total-minus-one (O). There are
 *      two live counts, not one: "the three CLI reviewers" is correct today.
 *   R  Redaction coverage. Every file carrying the canonical
 *      credential-redaction awk program must appear in REDACTION_SOURCES, or
 *      be listed with a reason in `redaction_known_untested`. Carriers are
 *      detected by CONTENT, not by the roster's boolean — trusting the flag
 *      just relocates the failure one level up. This is the drift site that
 *      fails SILENTLY: an unlisted copy is never tested and nothing is
 *      printed. Note the rule proves a file is *represented*, not that its
 *      copy is byte-identical — redaction.bats owns that, and it can only
 *      compare files extract-redaction-awk.bash knows how to parse.
 *   S  Epoch sweep ledger. Each file that restates the roster carries a stamp
 *      of the roster epoch it was last swept against. Changing the roster
 *      flips the epoch and fails every stamped file at once, so the failure
 *      output IS the sweep checklist. Silent between roster changes.
 *
 * Rule S exists because the count lint catches only one of the seven known
 * stale sites; the rest are name-list omissions with no numeral. A regex for
 * those was prototyped and measured at 75% false positives (legitimate
 * CLI-subset enumerations look identical), so it is deliberately not built.
 *
 * Known blind spots, stated rather than papered over:
 *   - The count lint skips any line mentioning `yellow-review` (a separate
 *     pipeline that also says "four reviewers"). A genuine council count
 *     sharing such a line is not checked. A proximity window was tried and
 *     reverted — it failed legitimate yellow-review sentences, and a gate
 *     that cries wolf gets disabled.
 *   - Roster path containment is lexical, so a symlink inside the repo that
 *     points outside it is readable by checkExceptions.
 *   - Rule R proves a carrier is *represented*, not that its copy is
 *     byte-identical; redaction.bats owns that comparison.
 *
 * Usage:
 *   node scripts/validate-council-roster.js
 *   node scripts/validate-council-roster.js --write-stamps
 *
 * Exit codes:
 *   0 - roster, counts, redaction coverage, and ledger all agree
 *   1 - at least one disagreement (file/line/found/expected printed to stderr)
 *
 * Test parameterization (used by integration tests):
 *   VALIDATE_COUNCIL_ROSTER_ROOT - override the project root
 *
 * Note: this file must contain no literal error-catalog code
 * (see scripts/lint-error-codes.js, which fails on any such literal under
 * scripts/). Messages here are deliberately plain English, matching
 * validate-doc-counts.js and validate-versions.js.
 *
 * Path triggers: both validate-schemas workflows must keep their JSON path
 * glob (the one covering every .json file). A scripts-only JS glob would not
 * cover council-roster.json, and an edit to it alone would skip this gate.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Normalised: a trailing separator (from the env hook, or cwd === '/') would
// make every `startsWith(ROOT + sep)` containment check reject its input.
const ROOT = path.resolve(
  process.env.VALIDATE_COUNCIL_ROSTER_ROOT || process.cwd()
);
const ROSTER_FILE = path.join(ROOT, 'scripts', 'council-roster.json');
const COUNCIL_MD = path.join(
  ROOT,
  'plugins/yellow-council/commands/council/council.md'
);
const REDACTION_LIB = path.join(
  ROOT,
  'plugins/yellow-council/tests/lib/extract-redaction-awk.bash'
);

const WRITE_MODE = process.argv.includes('--write-stamps');

const colors = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m' };

/**
 * Files scanned by the count lint (T/C/O). An explicit include-list, not a
 * deny-list: everything historical (CHANGELOG.md, docs/research, docs/spikes,
 * docs/solutions, docs/brainstorms, plans/**, AUDIT_REPORT.md, RESEARCH/**) is
 * out of scope by construction, and so are generated manifests and snapshots.
 *
 * The allowlist is load-bearing, not belt-and-braces: yellow-review's pipeline
 * also says "four reviewers", and its files would otherwise match the anchor.
 */
const SCAN_FILES = [
  'plugins/yellow-council/commands/council/council.md',
  'plugins/yellow-council/commands/council/setup.md',
  'plugins/yellow-council/CLAUDE.md',
  'plugins/yellow-council/README.md',
  'plugins/yellow-council/skills/council-patterns/SKILL.md',
  'plugins/yellow-council/skills/council-patterns/references/cross-references.md',
  'plugins/yellow-council/agents/review/claude-reviewer.md',
  'plugins/yellow-council/agents/review/gemini-reviewer.md',
  'plugins/yellow-council/agents/review/opencode-reviewer.md',
  'docs/testing/yellow-council-manual-tests.md',
  'docs/review-surface-routing-protocol.md',
  'docs/security.md',
  'plugins/yellow-codex/CLAUDE.md',
  'plugins/yellow-core/commands/setup/all.md',
];

const WORD_NUMBERS = Object.assign(Object.create(null), {
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
});

// Numerals start at 3. one/two are quantifiers in this corpus, never roster
// sizes ("cited by >=2 reviewers", "unique to one reviewer"), and no true
// positive uses a value below 3.
const NUM = '(?:[3-9]|[1-9][0-9]+|three|four|five|six|seven|eight|nine|ten)';

// Kills the ordinal-adjacency class ("Wave 3 reviewers", "Step 5 reviewer").
// Also excludes "other", which family O claims instead.
const NEG =
  '(?<!\\b(?:other|phase|wave|step|tier|layer|round|cycle|pass)[\\s-])';

const PATTERNS = [
  // TOTAL. The trailing lookahead stops double-firing on "3 reviewer CLIs",
  // which family C owns (three real cases in yellow-core/setup/all.md).
  {
    id: 'T1',
    family: 'TOTAL',
    regex: new RegExp(
      `${NEG}\\b(${NUM})[\\s-]+reviewers?\\b(?![\\s-]*CLIs?\\b)`,
      'gi'
    ),
  },
  {
    id: 'T2',
    family: 'TOTAL',
    regex: new RegExp(`${NEG}\\b(${NUM})[\\s-]+slots\\b`, 'gi'),
  },
  // setup.md is executable; these two reach literals no noun anchor can.
  { id: 'T3', family: 'TOTAL', regex: /Reviewers:\s*%d\s+of\s+(\d+)/gi },
  { id: 'T4', family: 'TOTAL', regex: /READY_COUNT[^\n]{0,12}-lt\s+(\d+)/gi },

  // CLI subset.
  {
    id: 'C1',
    family: 'CLI',
    regex: new RegExp(
      `${NEG}\\b(${NUM})[\\s-]+(?:CLI|external\\s+LLM)[\\s-]+reviewers?\\b`,
      'gi'
    ),
  },
  {
    id: 'C2',
    family: 'CLI',
    regex: new RegExp(`${NEG}\\b(${NUM})[\\s-]+reviewer[\\s-]+CLIs?\\b`, 'gi'),
  },
  {
    id: 'C3',
    family: 'CLI',
    regex: new RegExp(
      `${NEG}\\b(${NUM})[\\s-]+CLI[\\s-]+(?:slots|legs)\\b`,
      'gi'
    ),
  },
  {
    id: 'C4',
    family: 'CLI',
    regex: new RegExp(`\\b(${NUM})-CLI\\s+council\\b`, 'gi'),
  },

  // Roster minus the reviewer being described.
  {
    id: 'O1',
    family: 'OTHER',
    regex: new RegExp(`\\bother[\\s-]+(${NUM})[\\s-]+reviewers?\\b`, 'gi'),
  },
];

/**
 * Directory prefixes the ledger never walks. Everything here is either a dated
 * record (which would be FALSIFIED by rewriting), a different pipeline that
 * uses the same vocabulary, or generated output.
 */
const LEDGER_EXCLUDED_DIRS = [
  '.git',
  'node_modules',
  '.changeset',
  'dist',
  'coverage',
  'RESEARCH',
  'plans',
  'tests',
  'fixtures',
  'docs/research',
  'docs/brainstorms',
  'docs/spikes',
  'docs/solutions',
  'docs/maintenance',
  'docs/optimization',
  'plugins/yellow-review',
  '.agents',
  // `/council` writes committed reports here that name every reviewer. They
  // are dated records, so registering one would falsify the ledger — and not
  // excluding them means running the command once red-lights validate:schemas.
  'docs/council',
  'docs/audits',
];

/**
 * Individual files the ledger never registers, by exact repo-relative path or
 * by rule. Split from the directory list because these are scattered.
 */
const LEDGER_EXCLUDED_FILES = new Set([
  'AUDIT_REPORT.md', // dated 2026-05-07 audit record
  'scripts/council-roster.json', // the roster itself
  'scripts/validate-council-roster.js', // this validator
]);

function ledgerExcluded(rel) {
  if (LEDGER_EXCLUDED_FILES.has(rel)) return true;
  // Any-segment, not just top-level: the repo has nested node_modules under
  // plugins/*/ and packages/*/, and walking them makes the ledger's file set
  // a function of gitignored install state.
  if (rel.split('/').includes('node_modules')) return true;
  // Changelogs are append-only history; their reviewer counts record past
  // states and are correct as written.
  if (path.basename(rel) === 'CHANGELOG.md') return true;
  // Generated from catalog/ — editing them is never the fix.
  if (rel.includes('.claude-plugin/')) return true;
  return LEDGER_EXCLUDED_DIRS.some((x) => rel === x || rel.startsWith(`${x}/`));
}

function fail(msg) {
  console.error(`${colors.red}✗ ERROR:${colors.reset} ${msg}`);
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function numFrom(raw) {
  const lower = String(raw).toLowerCase();
  return lower in WORD_NUMBERS
    ? WORD_NUMBERS[lower]
    : Number.parseInt(lower, 10);
}

function loadRoster(errors) {
  if (!fs.existsSync(ROSTER_FILE)) {
    fail(`${toPosix(path.relative(ROOT, ROSTER_FILE))} not found`);
    process.exit(1);
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(ROSTER_FILE, 'utf8'));
  } catch (err) {
    fail(`council-roster.json is not valid JSON: ${err.message}`);
    process.exit(1);
  }
  if (!Array.isArray(data.reviewers) || data.reviewers.length === 0) {
    fail('council-roster.json must carry a non-empty "reviewers" array');
    process.exit(1);
  }
  const seen = new Set();
  const seenAgents = new Set();
  const seenAgentPaths = new Set();
  for (const r of data.reviewers) {
    for (const field of ['name', 'kind', 'agent', 'agent_path']) {
      if (typeof r[field] !== 'string' || r[field] === '') {
        errors.push(
          `roster entry ${JSON.stringify(r.name ?? r)} is missing "${field}"`
        );
      }
    }
    if (r.kind !== 'in-process' && r.kind !== 'cli') {
      errors.push(
        `roster entry "${r.name}" has kind "${r.kind}" (expected in-process or cli)`
      );
    }
    // Consumed via Boolean(r.ships_redaction_awk) downstream — a string
    // like "false" coerces to true and silently inverts the declared
    // intent, so the shape check must reject anything but a real boolean.
    if (typeof r.ships_redaction_awk !== 'boolean') {
      errors.push(
        `roster entry "${r.name}" has non-boolean "ships_redaction_awk" ` +
          `(${JSON.stringify(r.ships_redaction_awk)})`
      );
    }
    if (seen.has(r.name)) {
      errors.push(`roster has duplicate reviewer name "${r.name}"`);
    }
    seen.add(r.name);
    // Rule D2's sequence-equality check derives expectedAgents straight
    // from this array, so a reviewer reusing another's `agent` produces an
    // identical spawn sequence in council.md and passes, even though the
    // council invokes the same agent twice instead of the intended new one.
    if (typeof r.agent === 'string' && r.agent !== '') {
      if (seenAgents.has(r.agent)) {
        errors.push(
          `roster has duplicate agent "${r.agent}" (reviewer "${r.name}")`
        );
      }
      seenAgents.add(r.agent);
    }
    if (typeof r.agent_path === 'string' && r.agent_path !== '') {
      if (seenAgentPaths.has(r.agent_path)) {
        errors.push(
          `roster has duplicate agent_path "${r.agent_path}" (reviewer "${r.name}")`
        );
      }
      seenAgentPaths.add(r.agent_path);
    }
  }
  for (const r of data.reviewers) {
    if (typeof r.agent_path !== 'string') continue;
    if (!assertRepoRelative(r.agent_path, 'agent_path', errors)) continue;
    // A typo'd agent_path is otherwise silent: the file never enters the
    // ledger, and --write-stamps then drops the real one from it.
    if (!fs.existsSync(path.join(ROOT, r.agent_path))) {
      errors.push(
        `reviewer "${r.name}" declares agent_path "${r.agent_path}", which does not exist`
      );
    }
  }
  // Optional collection fields are attacker/typo-controlled JSON, not
  // guaranteed arrays — iterating a malformed value (object, string, number)
  // below would throw a raw TypeError instead of a plain-English error.
  for (const field of [
    'exceptions',
    'redaction_extra_sources',
    'redaction_known_untested',
  ]) {
    if (data[field] !== undefined && !Array.isArray(data[field])) {
      errors.push(`council-roster.json "${field}" must be an array`);
      data[field] = undefined;
    }
  }
  // Members are just as attacker/typo-controlled as the array itself — a
  // null or non-object entry would crash the .file/.reason reads below with
  // a raw TypeError instead of a plain-English error. redaction_extra_sources
  // is consumed as bare strings (see checkRedaction's `listed.has(p)`), not
  // objects, so it gets its own string check.
  //
  // exceptions gets its required-field check here too: checkExceptions()
  // calls path.join(ROOT, e.file), which throws a raw TypeError on a missing
  // or non-string `file` instead of the plain-English error every other
  // shape problem gets. redaction_known_untested's own fields are checked
  // further down (its consumers only ever Set/Array-compare `file`, which
  // does not throw), so it is not duplicated here.
  const REQUIRED_MEMBER_FIELDS = { exceptions: ['file', 'contains'] };
  for (const field of ['exceptions', 'redaction_known_untested']) {
    if (!Array.isArray(data[field])) continue;
    const required = REQUIRED_MEMBER_FIELDS[field];
    data[field] = data[field].filter((entry, i) => {
      const isPlainObject =
        typeof entry === 'object' && entry !== null && !Array.isArray(entry);
      if (!isPlainObject) {
        errors.push(
          `council-roster.json "${field}[${i}]" must be an object, got ` +
            `${JSON.stringify(entry)}`
        );
        return false;
      }
      if (required) {
        const missing = required.filter(
          (key) => typeof entry[key] !== 'string' || entry[key] === ''
        );
        if (missing.length > 0) {
          errors.push(
            `council-roster.json "${field}[${i}]" must have non-empty string ` +
              `field(s): ${missing.join(', ')} (got ${JSON.stringify(entry)})`
          );
          return false;
        }
      }
      return true;
    });
  }
  if (Array.isArray(data.redaction_extra_sources)) {
    data.redaction_extra_sources = data.redaction_extra_sources.filter(
      (entry, i) => {
        const isNonEmptyString = typeof entry === 'string' && entry !== '';
        if (!isNonEmptyString) {
          errors.push(
            `council-roster.json "redaction_extra_sources[${i}]" must be a ` +
              `non-empty string, got ${JSON.stringify(entry)}`
          );
        }
        return isNonEmptyString;
      }
    );
  }
  for (const e of data.exceptions || []) {
    if (typeof e.file === 'string')
      assertRepoRelative(e.file, 'exception file', errors);
  }

  // Structural validity is a precondition for every later rule — continuing
  // past a missing field crashes in restatesRoster() with a raw TypeError
  // before these plain-English messages are ever printed.
  if (errors.length > 0) {
    for (const e of errors) fail(e);
    process.exit(1);
  }

  data.prose_sites = data.prose_sites || {};
  data.exceptions = data.exceptions || [];
  data.redaction_extra_sources = data.redaction_extra_sources || [];
  data.redaction_known_untested = data.redaction_known_untested || [];
  // An escape hatch with no stated reason is just a mute button.
  for (const k of data.redaction_known_untested) {
    if (typeof k.file !== 'string' || k.file === '') {
      errors.push('redaction_known_untested entry is missing "file"');
    } else {
      assertRepoRelative(k.file, 'redaction_known_untested file', errors);
    }
    if (typeof k.reason !== 'string' || k.reason.trim().length < 20) {
      errors.push(
        `redaction_known_untested entry "${k.file}" needs a "reason" of at ` +
          'least 20 characters explaining why it cannot be wired into ' +
          'REDACTION_SOURCES'
      );
    }
  }
  return data;
}

/**
 * Roster-supplied paths are read from disk, so they must stay inside the
 * repository. Without this, `../` or an absolute path in council-roster.json
 * turns checkExceptions into a substring oracle over any readable file.
 */
function assertRepoRelative(p, label, errors) {
  if (path.isAbsolute(p)) {
    errors.push(`${label} "${p}" must be repo-relative, not absolute`);
    return false;
  }
  const resolved = path.resolve(ROOT, p);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) {
    errors.push(`${label} "${p}" resolves outside the repository root`);
    return false;
  }
  return true;
}

/** Reads a file, turning any I/O failure into a reported error, never a throw. */
function readOrReport(rel, errors) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
  } catch (err) {
    errors.push(`${rel}: unreadable (${err.code || err.message})`);
    return null;
  }
}

function derive(roster) {
  const total = roster.reviewers.length;
  const cli = roster.reviewers.filter((r) => r.kind === 'cli').length;
  // Derived, never stored: a hand-maintained epoch could be forgotten on a
  // roster change, which is the exact failure this mechanism exists to catch.
  //
  // Covers the WHOLE reviewer record, not just names. Hashing names alone
  // left a hole: flipping a reviewer's `kind` moves the derived CLI count
  // while the epoch stays put, so no stamped file is ever asked to re-sweep
  // and the run passes with live drift in the 8 registered files the count
  // lint does not scan.
  // Declaration order, NOT sorted: Rule D treats loop order as load-bearing
  // (it drives report-section ordering), so a reorder is a roster change and
  // must invalidate every stamp.
  //
  // Includes the display name restatesRoster() actually matches against
  // (`r.display || r.name`, mirrored here). Without it, renaming a
  // reviewer's display (e.g. OpenCode -> OpenCoder) left the epoch
  // unchanged, so --write-stamps re-stamped at the stale epoch and prose
  // still naming the old display could pass unswept.
  const fingerprint = roster.reviewers.map((r) => [
    r.name,
    r.display || r.name,
    r.kind,
    r.agent,
    r.agent_path,
    Boolean(r.ships_redaction_awk),
  ]);
  const epoch = crypto
    .createHash('sha256')
    .update(JSON.stringify(fingerprint))
    .digest('hex')
    .slice(0, 8);
  return { TOTAL: total, CLI: cli, OTHER: total - 1, epoch };
}

/** Rule D — the roster must equal council.md's two definition sites. */
function checkDefinitionSites(roster, errors) {
  if (!fs.existsSync(COUNCIL_MD)) {
    errors.push(`${toPosix(path.relative(ROOT, COUNCIL_MD))} not found`);
    return;
  }
  const councilBody = readOrReport(
    toPosix(path.relative(ROOT, COUNCIL_MD)),
    errors
  );
  if (councilBody === null) return;
  const lines = councilBody.split(/\r?\n/);
  const rel = toPosix(path.relative(ROOT, COUNCIL_MD));

  // D1 — the fixed-list loop. The character class excludes the key-iteration
  // loops (`for reviewer in "${!REVIEWER_FENCED_PATHS[@]}"`), which are
  // deliberately roster-agnostic and must not be touched.
  const loops = [];
  lines.forEach((line, i) => {
    const m = /^for reviewer in ([a-z0-9 ]+); do$/.exec(line);
    if (m) loops.push({ line: i + 1, names: m[1].trim().split(/\s+/) });
  });
  if (loops.length !== 1) {
    errors.push(
      `${rel}: expected exactly one \`for reviewer in <names>; do\` line, found ${loops.length}`
    );
  } else {
    const expected = roster.reviewers.map((r) => r.name);
    if (loops[0].names.join(' ') !== expected.join(' ')) {
      errors.push(
        `${rel}:${loops[0].line}: reviewer loop is "${loops[0].names.join(' ')}" but roster is ` +
          `"${expected.join(' ')}" (order is load-bearing — it drives report-section ordering)`
      );
    }
  }

  // D2 — the spawn block.
  const spawns = [];
  lines.forEach((line, i) => {
    const re = /subagent_type="([^"]+)"/g;
    let m;
    while ((m = re.exec(line)) !== null)
      spawns.push({ line: i + 1, agent: m[1] });
  });
  const spawnedAgents = spawns.map((s) => s.agent);
  const expectedAgents = roster.reviewers.map((r) => r.agent);

  // Per-reviewer diagnostics stay Set-based so a single missing or unknown
  // agent still gets a precise, individually actionable message.
  const spawned = new Set(spawnedAgents);
  for (const r of roster.reviewers) {
    if (!spawned.has(r.agent)) {
      errors.push(
        `${rel}: roster names agent "${r.agent}" but no Agent() spawn uses it`
      );
    }
  }
  const known = new Set(expectedAgents);
  for (const s of spawns) {
    if (!known.has(s.agent)) {
      errors.push(
        `${rel}:${s.line}: spawns "${s.agent}" which is not in the roster`
      );
    }
  }

  // Set membership alone hides drift: a duplicated Agent() line collapses
  // in `spawned` and still passes, and a reordered spawn block changes
  // nothing either check above notices — but `/council` fans out one leg
  // per spawn line, in spawn order, so count and order are load-bearing.
  if (JSON.stringify(spawnedAgents) !== JSON.stringify(expectedAgents)) {
    errors.push(
      `${rel}: spawn sequence [${spawnedAgents.join(', ')}] does not match roster order ` +
        `[${expectedAgents.join(', ')}] (spawn count and order must equal the roster, duplicates included)`
    );
  }
}

/**
 * Strips a bash line comment, respecting double-quoted strings, so a
 * commented-out array entry (`# "path"`) is not mistaken for a live one.
 * Everything from the first unquoted `#` to end of line is dropped.
 */
function stripBashLineComment(line) {
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === '#' && !inQuote) return line.slice(0, i);
  }
  return line;
}

/**
 * Matches a bash array literal declared at the START of a line. The anchor is
 * load-bearing: an unanchored match lets a commented-out `# NAME=(...)`
 * example above the live array win the first-match race and repoint every
 * consumer. Returns the entry count plus, for exactly one declaration, the
 * text between the parens — so callers can word "absent" and "declared twice"
 * differently.
 */
function matchArrayLiteral(body, name) {
  const matches = Array.from(
    body.matchAll(new RegExp(`^${name}=\\(([\\s\\S]*?)\\)`, 'gm'))
  );
  return {
    count: matches.length,
    inner: matches.length === 1 ? matches[0][1] : null,
  };
}

/**
 * The canonical anchor markers used to detect a carrier by content are no
 * longer hardcoded here — they are authored once, in the same lib that owns
 * REDACTION_SOURCES, and parsed the same way. A hardcoded copy would drift
 * silently the moment the awk program's function names changed.
 *
 * Takes the lib body checkRedactionSources already read, and the file cache,
 * rather than re-reading from disk: a second read can observe a different
 * file, and the caller has already reported an unreadable lib.
 *
 * Returns null (after pushing a clear error) when the array is absent,
 * declared more than once, holds anything but exactly two entries, or names a
 * marker that no longer appears in CANONICAL_SOURCE. Callers MUST treat null
 * as "carrier detection is unavailable", never as "zero carriers" — the
 * latter would silently green-light Rule R's carrier-dependent checks.
 */
function readAnchorMarkers(body, fileCache, errors) {
  const arr = matchArrayLiteral(body, 'REDACTION_ANCHOR_MARKERS');
  if (arr.count === 0) {
    errors.push(
      'extract-redaction-awk.bash: REDACTION_ANCHOR_MARKERS array not found ' +
        'or has fewer than 2 entries'
    );
    return null;
  }
  if (arr.count > 1) {
    errors.push(
      `extract-redaction-awk.bash: REDACTION_ANCHOR_MARKERS is declared ${arr.count} ` +
        'times — keep exactly one live declaration, or a first-match race ' +
        'decides which one drives carrier detection'
    );
    return null;
  }
  const markers = Array.from(arr.inner.matchAll(/"([^"]+)"/g)).map((m) => m[1]);
  // extract-redaction-bodies.awk consumes exactly two markers: one that must
  // appear inside a walked body, one that anchors the walk. A third would be
  // parsed here and silently ignored there.
  if (markers.length !== 2) {
    errors.push(
      `extract-redaction-awk.bash: REDACTION_ANCHOR_MARKERS has ${markers.length} ` +
        'entries, expected exactly 2 (the body walker takes exactly two — one ' +
        'inside the body, one to anchor the walk)'
    );
    return null;
  }
  // Two IDENTICAL entries pass the arity check and then reduce carrier
  // detection to a single-marker test: `markers.every(m => text.includes(m))`
  // asks the same question twice, so any file quoting that one string reads as
  // a carrier. The walker is worse off still — it would receive the same string
  // as both ANCHOR and INNER, and every anchor line would satisfy its own
  // interior requirement.
  if (new Set(markers).size !== markers.length) {
    errors.push(
      'extract-redaction-awk.bash: REDACTION_ANCHOR_MARKERS entries #1 and #2 are ' +
        'identical — the two entries must be different strings (one that appears inside ' +
        'the body, one that anchors the walk), or carrier detection collapses ' +
        'to a single-marker test'
    );
    return null;
  }

  // Liveness. A marker that no longer appears in the program it identifies
  // matches nothing, so every carrier-dependent check would pass by finding
  // zero carriers — the exact silent green Rule R exists to prevent.
  const declarations = Array.from(
    body.matchAll(/^CANONICAL_SOURCE="([^"]+)"/gm)
  );
  if (declarations.length !== 1) {
    errors.push(
      'extract-redaction-awk.bash: expected exactly one CANONICAL_SOURCE="..." ' +
        `declaration, found ${declarations.length} — without it the marker set ` +
        'cannot be checked against the program it identifies'
    );
    return null;
  }
  const canonical = declarations[0][1];
  const canonicalBody = fileCache.get(canonical);
  if (canonicalBody === undefined) {
    // Report the declaration's LINE, never its value: CANONICAL_SOURCE is
    // repository controlled and a pasted credential standing in for it would
    // otherwise print into CI logs through this diagnostic (same reasoning
    // as the stale-marker-index diagnostic below).
    const declLine = body.slice(0, declarations[0].index).split('\n').length;
    errors.push(
      `extract-redaction-awk.bash:${declLine}: CANONICAL_SOURCE names a file ` +
        'that was not scanned (missing, or outside the redaction walk), so ' +
        'REDACTION_ANCHOR_MARKERS cannot be checked for staleness'
    );
    return null;
  }
  // Report the entry INDEX, never the value: the array is repository
  // controlled and a pasted credential in it would otherwise print into CI
  // logs through this diagnostic.
  const staleIdx = markers
    .map((m, i) => (canonicalBody.includes(m) ? -1 : i + 1))
    .filter((i) => i > 0);
  if (staleIdx.length > 0) {
    for (const i of staleIdx) {
      errors.push(
        `REDACTION_ANCHOR_MARKERS entry #${i} does not appear in ${canonical}; ` +
          'the marker set is stale'
      );
    }
    return null;
  }
  return markers;
}

/** Rule R — REDACTION_SOURCES must cover every agent shipping the awk program. */
function checkRedactionSources(roster, fileCache, errors) {
  if (!fs.existsSync(REDACTION_LIB)) {
    errors.push(`${toPosix(path.relative(ROOT, REDACTION_LIB))} not found`);
    return;
  }
  const body = readOrReport(
    toPosix(path.relative(ROOT, REDACTION_LIB)),
    errors
  );
  if (body === null) return;
  const sources = matchArrayLiteral(body, 'REDACTION_SOURCES');
  if (sources.count === 0) {
    errors.push(
      'extract-redaction-awk.bash: REDACTION_SOURCES array not found'
    );
    return;
  }
  if (sources.count > 1) {
    errors.push(
      `extract-redaction-awk.bash: REDACTION_SOURCES is declared ${sources.count} ` +
        'times — keep exactly one live declaration, or a first-match race ' +
        'decides which one Rule R checks'
    );
    return;
  }
  const listed = new Set(
    sources.inner
      .split('\n')
      .map(stripBashLineComment)
      .flatMap((line) =>
        Array.from(line.matchAll(/"([^"]+)"/g)).map((m) => m[1])
      )
  );
  const known = new Set(roster.redaction_known_untested.map((k) => k.file));

  const anchorMarkers = readAnchorMarkers(body, fileCache, errors);

  // Derived from file CONTENT, not from the roster's boolean. Trusting the
  // flag relocated the silent failure one level up: a copy pasted into an
  // agent whose flag says false would go untested and still pass.
  //
  // null (not []) when the marker list itself could not be trusted —
  // readAnchorMarkers already reported why. Carrier-dependent checks below
  // are skipped entirely rather than run against an empty/unreliable set,
  // so an absent marker list cannot turn Rule R green.
  const libRel = toPosix(path.relative(ROOT, REDACTION_LIB));
  const carriers = anchorMarkers
    ? Array.from(fileCache.entries())
        .filter(([rel, fileBody]) => {
          // The lib authors REDACTION_ANCHOR_MARKERS, so its own body always
          // contains both marker strings as array literals. Scrub that one
          // span rather than excluding the file from the walk: exclusion also
          // drops it from the Rule S ledger, and a real program pasted into
          // the lib must still register as a carrier.
          const text =
            rel === libRel
              ? fileBody.replace(/^REDACTION_ANCHOR_MARKERS=\([\s\S]*?\)/gm, '')
              : fileBody;
          return anchorMarkers.every((m) => text.includes(m));
        })
        .map(([rel]) => rel)
    : null;

  if (carriers) {
    for (const rel of carriers) {
      if (!listed.has(rel) && !known.has(rel)) {
        errors.push(
          `${rel} carries the canonical redaction program but is in neither ` +
            'extract-redaction-awk.bash REDACTION_SOURCES nor council-roster.json ' +
            'redaction_known_untested — its copy would never be drift-tested, and ' +
            'that failure is silent'
        );
      }
    }

    // The declared flag must agree with what is on disk, so the roster cannot
    // drift away from reality even though the flag no longer gates the rule.
    for (const r of roster.reviewers) {
      const carries = carriers.includes(r.agent_path);
      if (Boolean(r.ships_redaction_awk) !== carries) {
        errors.push(
          `council-roster.json: "${r.name}" declares ships_redaction_awk=` +
            `${Boolean(r.ships_redaction_awk)} but ${r.agent_path} ` +
            `${carries ? 'does' : 'does not'} carry the canonical program`
        );
      }
    }
  }

  for (const p of roster.redaction_extra_sources) {
    if (!listed.has(p)) {
      errors.push(
        `extract-redaction-awk.bash: REDACTION_SOURCES is missing "${p}"`
      );
    }
  }

  // A known-untested entry that no longer carries the program is dead weight.
  // Skipped when carriers is unavailable — see the comment above.
  if (carriers) {
    for (const k of roster.redaction_known_untested) {
      if (!carriers.includes(k.file)) {
        errors.push(
          `council-roster.json redaction_known_untested lists "${k.file}", which no ` +
            'longer carries the canonical program — remove the entry'
        );
      }
    }
  }
}

function suppressed(roster, relFile, lineText) {
  return roster.exceptions.some(
    (e) => e.file === relFile && lineText.includes(e.contains)
  );
}

/** Rules T/C/O — anchored count lint over the explicit allowlist. */
function checkCounts(roster, counts, errors) {
  for (const rel of SCAN_FILES) {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) {
      errors.push(
        `SCAN_FILES lists "${rel}", which does not exist — a renamed or moved ` +
          'doc drops out of count coverage silently; update the allowlist'
      );
      continue;
    }
    const scanBody = readOrReport(rel, errors);
    if (scanBody === null) continue;
    const lines = scanBody.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // yellow-review runs a separate pipeline that also says "four
      // reviewers", and council's own docs cite it by name. A proximity
      // window was tried and rejected: it turned legitimate yellow-review
      // sentences into blocking failures whenever the plugin name sat more
      // than a few words from the numeral, and a gate that cries wolf gets
      // disabled. Skipping the line trades that for a narrow blind spot,
      // recorded in "what this will not catch" below.
      if (line.includes('yellow-review')) continue;
      for (const { id, family, regex } of PATTERNS) {
        regex.lastIndex = 0;
        let m;
        while ((m = regex.exec(line)) !== null) {
          const found = numFrom(m[1]);
          const expected = counts[family];
          if (found !== expected && !suppressed(roster, rel, line)) {
            errors.push(
              `${rel}:${i + 1}: ${family} claim "${m[0].trim()}" is ${found} but roster derives ` +
                `${expected} [${id}]\n    ${line.trim()}`
            );
          }
        }
      }
    }
  }
}

/** Exceptions that no longer match anything are dead weight — fail them. */
function checkExceptions(roster, errors) {
  for (const e of roster.exceptions) {
    const full = path.join(ROOT, e.file);
    if (!fs.existsSync(full)) {
      errors.push(`exception targets missing file "${e.file}" — remove it`);
      continue;
    }
    let body;
    try {
      body = fs.readFileSync(full, 'utf8');
    } catch (err) {
      errors.push(
        `exception targets unreadable "${e.file}" (${err.code || err.message})`
      );
      continue;
    }
    if (!body.includes(e.contains)) {
      errors.push(
        `exception for "${e.file}" no longer matches any line (looked for ` +
          `"${e.contains}") — remove it`
      );
    }
  }
}

/**
 * Rule R scans far wider than the ledger. Sharing the ledger's exclusion list
 * put the silent failure straight back: a redaction copy under
 * plugins/yellow-review/, docs/council/, tests/, a CHANGELOG, or a .awk file
 * was simply invisible. Only VCS and dependency trees are skipped here.
 */
function redactionExcluded(rel) {
  const segs = rel.split('/');
  if (segs.includes('.git') || segs.includes('node_modules')) return true;
  // The detector and its fixtures carry the marker strings as literals. The
  // tool that finds carriers is not itself a carrier.
  return SELF_FILES.has(rel);
}

/**
 * Membership here removes a file from the redaction walk — and the ledger
 * cache is a filtered view of that same walk, so it removes the file from the
 * Rule S ledger too. That second effect is why the lib declaring
 * REDACTION_ANCHOR_MARKERS is NOT listed: it restates the roster and must stay
 * stamped. checkRedactionSources scrubs its marker array instead.
 */
const SELF_FILES = new Set([
  'scripts/validate-council-roster.js',
  'tests/integration/validate-council-roster.test.ts',
]);

const REDACTION_EXT = new Set([
  '.md',
  '.json',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.sh',
  '.bash',
  '.bats',
  '.awk',
  '.py',
  '.txt',
  '.yml',
  '.yaml',
]);

const TEXT_EXT = new Set([
  '.md',
  '.json',
  '.js',
  '.ts',
  '.sh',
  '.bash',
  '.bats',
  '.yml',
  '.yaml',
]);

function walk(dir, out, errors, isExcluded, extSet) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    errors.push(
      `${toPosix(path.relative(ROOT, dir)) || '.'}: unreadable directory (${err.code || err.message})`
    );
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = toPosix(path.relative(ROOT, full));
    if (isExcluded(rel)) continue;
    if (entry.isDirectory()) walk(full, out, errors, isExcluded, extSet);
    else if (extSet.has(path.extname(entry.name))) out.push(rel);
  }
  return out;
}

/**
 * A file "restates the roster" if it discusses council AND names two or more
 * reviewers. Anchoring on `council` is what keeps the ubiquitous bare word
 * "Claude" from matching most of the repo.
 */
function restatesRoster(roster, body) {
  if (!/council/i.test(body)) return false;
  const tokens = roster.reviewers.flatMap((r) =>
    r.kind === 'cli'
      ? [r.display || r.name]
      : [path.basename(r.agent_path, '.md')]
  );
  const hits = tokens.filter((t) =>
    new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(
      body
    )
  );
  return hits.length >= 2;
}

/** Rule S — epoch sweep ledger. */
function checkLedger(roster, counts, fileCache, errors, stampTargets) {
  const restating = new Set();
  for (const [rel, body] of fileCache) {
    if (restatesRoster(roster, body)) restating.add(rel);
  }

  // Every reviewer's own agent file is registered unconditionally. A roster
  // change affects each of them by definition, and the ">=2 names" heuristic
  // under-includes an agent that only ever names itself (gemini-reviewer.md
  // mentions Gemini and nothing else).
  for (const r of roster.reviewers) {
    if (
      !ledgerExcluded(r.agent_path) &&
      fs.existsSync(path.join(ROOT, r.agent_path))
    ) {
      restating.add(r.agent_path);
    }
  }

  for (const rel of restating) {
    stampTargets.add(rel);
    const stamp = roster.prose_sites[rel];
    if (stamp === undefined) {
      errors.push(
        `${rel} restates the council roster but is not registered in ` +
          'council-roster.json "prose_sites" — add it (or run --write-stamps)'
      );
    } else if (stamp !== counts.epoch) {
      errors.push(
        `${rel} was last swept at roster epoch ${stamp}, current epoch is ` +
          `${counts.epoch} — re-read it for stale reviewer counts and name lists, then restamp`
      );
    }
  }

  for (const rel of Object.keys(roster.prose_sites)) {
    if (!restating.has(rel)) {
      errors.push(
        `council-roster.json "prose_sites" lists "${rel}", which no longer ` +
          'restates the roster — remove the entry'
      );
    }
  }
}

function main() {
  const errors = [];
  const roster = loadRoster(errors);
  const counts = derive(roster);

  // One walk, one read of each file — shared by Rule R and Rule S.
  // One walk over the wider redaction scope; the ledger set is a filtered
  // view of it, so Rule R is never narrowed by the ledger's exclusions.
  const walkErrors = [];
  const scanned = walk(ROOT, [], walkErrors, redactionExcluded, REDACTION_EXT);
  const fileCache = new Map();
  for (const rel of scanned) {
    const body = readOrReport(rel, walkErrors);
    if (body !== null) fileCache.set(rel, body);
  }
  const ledgerCache = new Map();
  for (const [rel, body] of fileCache) {
    if (!ledgerExcluded(rel) && TEXT_EXT.has(path.extname(rel))) {
      ledgerCache.set(rel, body);
    }
  }
  errors.push(...walkErrors);

  checkDefinitionSites(roster, errors);
  checkRedactionSources(roster, fileCache, errors);
  checkExceptions(roster, errors);

  const countErrors = [];
  checkCounts(roster, counts, countErrors);
  errors.push(...countErrors);

  const stampTargets = new Set();
  const ledgerErrors = [];
  checkLedger(roster, counts, ledgerCache, ledgerErrors, stampTargets);

  if (WRITE_MODE) {
    // Refuse to stamp while ANY rule still fails. Guarding only the count
    // lint left the D/R/exception/shape doors open: a maintainer running the
    // documented repair mode got a green "WROTE" line while the roster
    // structurally contradicted council.md. This cannot stop a human
    // restamping without reading — that limit is inherent.
    if (errors.length > 0) {
      for (const e of errors) fail(e);
      fail('refusing to write stamps while other checks fail — fix them first');
      process.exit(1);
    }
    const next = {};
    for (const rel of Array.from(stampTargets).sort()) next[rel] = counts.epoch;
    roster.prose_sites = next;
    // Atomic: write a sibling temp file, re-parse it, then rename over the
    // source of truth (docs/solutions/security-issues/
    // statusline-setup-pr-review-security-patterns.md).
    const tmp = `${ROSTER_FILE}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(roster, null, 2)}\n`, 'utf8');
    JSON.parse(fs.readFileSync(tmp, 'utf8'));
    fs.renameSync(tmp, ROSTER_FILE);
    console.log(
      `${colors.green}✓ WROTE:${colors.reset} stamped ${Object.keys(next).length} ` +
        `file(s) at roster epoch ${counts.epoch}`
    );
    return;
  }

  errors.push(...ledgerErrors);

  if (errors.length === 0) {
    console.log(
      `${colors.green}✓ PASS:${colors.reset} council roster consistent ` +
        `(${counts.TOTAL} reviewers, ${counts.CLI} CLI, epoch ${counts.epoch})`
    );
    return;
  }
  for (const e of errors) fail(e);
  process.exit(1);
}

main();
