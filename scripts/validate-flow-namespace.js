#!/usr/bin/env node

/**
 * validate-flow-namespace.js
 *
 * Sweep-completeness gate for the `workflows:` -> `flow:` command namespace
 * migration (plans/workflows-to-flow-namespace-migration.md).
 *
 * The 10 commands formerly under `workflows:` were renamed to `flow:` because
 * native Claude Code's built-in `/workflows` occupies that autocomplete
 * prefix. The rename itself is one PR; the prose sweep spans several more.
 * This gate is what makes "the sweep finished" a machine-checked fact instead
 * of an assertion — this repo has documented repeat failures at exactly that
 * shape (docs/solutions/code-quality/doc-fix-mechanical-verification-gap.md,
 * "assertion is not a check").
 *
 * WHAT IT BANS — three shapes, not one. A `/`-anchored-only pattern misses
 * every functional site, because the runtime surfaces are unslashed:
 *
 *   1. bare slashed prose            /workflows:work
 *   2. unslashed runtime values      skill: "workflows:work", [workflows:plan]
 *   3. plugin-qualified references   yellow-core:workflows:work
 *
 * Shape 2 is the superset that subsumes 1 and 3, so a single unslashed
 * matcher covers all three. It is spelled out here because the brainstorm
 * that preceded this gate proposed the anchored-only pattern.
 *
 * WHAT IT DELIBERATELY DOES NOT BAN — the singular `workflow:` agent
 * namespace (`yellow-core:workflow:knowledge-compounder` and friends). The
 * matcher requires the literal `s` in `workflows:`, so that false positive is
 * structurally impossible here. The `flow`/`workflow` substring hazard lives
 * entirely in the sweep's *replace* step, not in this *detect* step. Do not
 * "harden" against it — see
 * docs/solutions/code-quality/mcp-tool-rename-prefix-collision.md.
 *
 * ALLOWLIST — `scripts/flow-namespace-allowlist.json`, keyed on
 * repo-relative POSIX path PLUS expected occurrence count:
 *
 *   { "plugins/gt-workflow/CLAUDE.md": 7, ... }
 *
 * The count is load-bearing. A path-only allowlist is non-monotonic: sweeping
 * N-1 of N references leaves the entry valid and hides partial completion.
 * Counts MUST be produced by this script's own `--write-allowlist` mode, so
 * they always come from the same matcher the gate enforces with. Never
 * transcribe them from an ad-hoc `rg` run.
 *
 * A declared allowlist path that is missing from disk is a HARD ERROR, per
 * the MEMORY_PROTOCOL_SENTINEL precedent in
 * scripts/validate-agent-authoring.js. Without it the allowlist rots silently
 * as later sweep PRs delete entries, and moving an allowlisted file passes
 * unnoticed.
 *
 * SCOPE — walks the whole repository from the root, INCLUDING hidden
 * directories. Every other validator in this repo roots at PLUGINS_DIR, which
 * is precisely why three separate prose censuses during planning each missed
 * `.github/` (ripgrep skips dotdirs by default) and `RESEARCH/`. The one
 * carve-out is machine-local gitignored state (`.claude/`, `.codex/`,
 * `.entire/`, `.ruvector/`) — see EXCLUDED_DIRS below — which cannot be part
 * of the commit and would otherwise turn per-developer state into a false
 * blocking failure. A directory or file that IS walked but cannot be read is
 * a hard error, not a silent skip: this is a completeness gate, so treating
 * an unreadable path as "nothing to scan" could let it go green while stale
 * references sit unseen underneath.
 *
 * Error codes (catalog: packages/domain/src/validation/errorCatalog.ts) are
 * assembled via string concatenation so scripts/lint-error-codes.js does not
 * flag this file as re-implementing them.
 *
 * Usage:
 *   node scripts/validate-flow-namespace.js                  # gate (CI)
 *   node scripts/validate-flow-namespace.js --write-allowlist # regenerate
 *
 * Env:
 *   FLOW_NS_ROOT=<dir>          repo root override (tests)
 *   FLOW_NS_ALLOWLIST=<file>    allowlist path override (tests)
 *   GITHUB_ACTIONS=true         emit `::error file=` annotations
 *
 * Exit codes:
 *   0 - clean
 *   1 - stale references, count drift, or a missing allowlist path
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.FLOW_NS_ROOT || path.join(__dirname, '..'));
const ALLOWLIST_FILE = path.resolve(
  process.env.FLOW_NS_ALLOWLIST || path.join(ROOT, 'scripts', 'flow-namespace-allowlist.json')
);
const IS_CI = process.env.GITHUB_ACTIONS === 'true';
const WRITE_MODE = process.argv.includes('--write-allowlist');

// Catalog code prefixes assembled via concatenation. See the module header.
const NS = 'ERROR-' + 'NAMESPACE';
const NS_STALE_REFERENCE = NS + '-001';
const NS_ALLOWLIST_COUNT_DRIFT = NS + '-002';
const NS_ALLOWLIST_PATH_MISSING = NS + '-003';

/**
 * The 10 renamed commands. Spelled out rather than matching `workflows:\w+`
 * so an unrelated `workflows:` token (a YAML key, a URL fragment) can never
 * trip the gate, and so a future command added under `flow:` must be added
 * here deliberately.
 */
const COMMANDS = [
  'brainstorm',
  'compound',
  'decompose',
  'deepen-plan',
  'expand-shell',
  'pick-next-shell',
  'plan',
  'review',
  'spec',
  'work',
];

// Shape 2 (unslashed) subsumes shapes 1 and 3 — see the module header.
// `-` must come last inside the character class so it is a literal.
const STALE_RE = new RegExp('workflows:(?:' + COMMANDS.join('|') + ')(?![a-z-])', 'g');

/**
 * Permanent exclusions — never swept, by design.
 *
 * Three classes:
 *   - Dated records that would be FALSIFIED by rewriting (archived plans,
 *     brainstorms, solution docs, frozen audit snapshots, changelogs). The
 *     discriminator is "is this loaded as authoritative instruction, or is it
 *     a closed record of a past decision?" — not "is it old".
 *   - Transient or generated content (`.changeset/**` is consumed by the
 *     version-packages PR; this migration's own changesets legitimately name
 *     the old namespace, and the gate runs on the PR before they are consumed).
 *   - Machine-local gitignored state (per `.gitignore`) that is never part of
 *     the commit and cannot be fixed by the migration: a stale reference
 *     there would be an unactionable, false-blocking failure. This is
 *     narrower than "everything .gitignore ignores" — it targets the
 *     directories that are large, per-developer, or tool-generated (agent
 *     memory, vector-index blobs, sibling-CLI session state), not every
 *     ignored pattern in the repo.
 *
 * Matched against repo-relative POSIX paths.
 */
const EXCLUDED_DIRS = [
  '.git',
  'node_modules',
  '.changeset',
  'plans', // open plans AND plans/complete/** — dated records; this
  // migration's own plan doc lives here and narrates the old namespace
  'docs/brainstorms',
  'docs/solutions',
  '.claude', // per-developer agent memory (gitignored)
  '.codex', // Codex CLI per-developer state (gitignored)
  '.entire', // Entire AI tool per-developer config (gitignored)
  '.ruvector', // ruvector vector-index blobs, often a symlink (gitignored)
];

const EXCLUDED_FILES = [
  'CHANGELOG.md', // root, bot-generated release history
  'AUDIT_REPORT.md', // dated snapshot
  // Frozen audit snapshot living under a directory whose name suggests
  // living docs — classified per-file, not by directory.
  'docs/maintenance/plugin-audit-2026-06-10.md',
];

/** `plugins/<name>/CHANGELOG.md` — per-plugin release history. */
const PLUGIN_CHANGELOG_RE = /^plugins\/[^/]+\/CHANGELOG\.md$/;

/** Only text files worth scanning. Binary and lockfiles are pointless noise. */
const SCANNED_EXTENSIONS = new Set([
  '.md',
  '.js',
  '.cjs',
  '.mjs',
  '.ts',
  '.tsx',
  '.json',
  '.yml',
  '.yaml',
  '.sh',
  '.bats',
  '.txt',
]);

function toPosix(p) {
  return p.split(path.sep).join('/');
}

/**
 * This file names the banned pattern in its own regex and documentation.
 * Same self-reference carve-out as scripts/lint-error-codes.js, which skips
 * `__filename` for the identical reason. Bound to the resolved real path so
 * it still matches when ROOT is overridden in tests.
 */
const SELF_REL = toPosix(path.relative(ROOT, __filename));

function isExcluded(relPath) {
  if (relPath === SELF_REL) return true;
  if (EXCLUDED_FILES.includes(relPath)) return true;
  if (PLUGIN_CHANGELOG_RE.test(relPath)) return true;
  for (const dir of EXCLUDED_DIRS) {
    if (relPath === dir || relPath.startsWith(dir + '/')) return true;
  }
  return false;
}

/**
 * Recursive walk from the repo root. Hidden entries are NOT skipped — that
 * default is exactly what hid `.github/` from three prior censuses. Symlinked
 * directories are not followed (withFileTypes reports them as symlinks, and
 * only isDirectory() recurses), so a `.ruvector` worktree symlink cannot send
 * the walk outside the repo or into a cycle.
 */
function walk(dir, acc) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    // Fail loudly, not silently: this is a sweep-*completeness* gate, so
    // treating an unreadable directory as "nothing to scan" can make it go
    // green while stale `workflows:` references sit unseen underneath it.
    console.error(
      `[validate-flow-namespace] Error: could not read directory ` +
        `${toPosix(path.relative(ROOT, dir))}: ${err.message}`
    );
    process.exit(1);
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = toPosix(path.relative(ROOT, full));
    if (isExcluded(rel)) continue;
    if (entry.isDirectory()) {
      walk(full, acc);
    } else if (entry.isFile() && SCANNED_EXTENSIONS.has(path.extname(entry.name))) {
      acc.push(rel);
    }
  }
  return acc;
}

/** @returns {{ count: number, lines: number[] }} */
function scanFile(relPath) {
  let content;
  try {
    content = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  } catch (err) {
    // Same fail-loud reasoning as walk()'s readdirSync catch: an unreadable
    // file must not be silently treated as clean.
    console.error(
      `[validate-flow-namespace] Error: could not read file ${relPath}: ${err.message}`
    );
    process.exit(1);
  }
  const lines = [];
  let count = 0;
  content.split('\n').forEach((line, i) => {
    const matches = line.match(STALE_RE);
    if (matches) {
      count += matches.length;
      lines.push(i + 1);
    }
  });
  return { count, lines };
}

/** @returns {Map<string, number>} repo-relative path -> occurrence count */
function scanRepo() {
  const found = new Map();
  for (const rel of walk(ROOT, [])) {
    const { count } = scanFile(rel);
    if (count > 0) found.set(rel, count);
  }
  return new Map([...found.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

function loadAllowlist() {
  if (!fs.existsSync(ALLOWLIST_FILE)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(ALLOWLIST_FILE, 'utf8'));
    // `JSON.parse('null')` succeeds and yields null — guard the envelope
    // shape explicitly rather than trusting the parse to have produced an
    // object (docs/solutions/logic-errors/json-parse-null-envelope-validity-guard.md).
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      console.error(
        `[validate-flow-namespace] Error: ${toPosix(path.relative(ROOT, ALLOWLIST_FILE))} ` +
          'must contain a JSON object mapping path -> expected count.'
      );
      process.exit(1);
    }
    return parsed;
  } catch (err) {
    console.error(
      `[validate-flow-namespace] Error: could not parse ` +
        `${toPosix(path.relative(ROOT, ALLOWLIST_FILE))}: ${err.message}`
    );
    process.exit(1);
  }
}

function writeAllowlist(found) {
  const obj = {};
  for (const [rel, count] of found) obj[rel] = count;
  fs.writeFileSync(ALLOWLIST_FILE, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  const total = [...found.values()].reduce((a, b) => a + b, 0);
  console.log(
    `[validate-flow-namespace] Wrote ${found.size} entr${found.size === 1 ? 'y' : 'ies'} ` +
      `(${total} reference${total === 1 ? '' : 's'}) to ` +
      toPosix(path.relative(ROOT, ALLOWLIST_FILE))
  );
}

function annotate(relPath, line, message) {
  if (IS_CI) console.error(`::error file=${relPath},line=${line}::${message}`);
}

function main() {
  const found = scanRepo();

  if (WRITE_MODE) {
    writeAllowlist(found);
    return;
  }

  const allowlist = loadAllowlist();
  const errors = [];

  // 1. A declared path that no longer exists on disk is a hard error. Without
  //    this the allowlist rots as sweep PRs delete entries, and moving an
  //    allowlisted file passes silently.
  for (const relPath of Object.keys(allowlist)) {
    if (!fs.existsSync(path.join(ROOT, relPath))) {
      errors.push(
        `${NS_ALLOWLIST_PATH_MISSING} ${relPath}: declared in the allowlist but not found on ` +
          'disk. If the file moved, update its allowlist key in the same commit; ' +
          'if it was deleted or fully swept, remove the entry.'
      );
      annotate(
        toPosix(path.relative(ROOT, ALLOWLIST_FILE)),
        1,
        `${NS_ALLOWLIST_PATH_MISSING} allowlisted path not found: ${relPath}`
      );
    }
  }

  // 2. Every file with a stale reference must be allowlisted at the exact
  //    current count.
  for (const [relPath, count] of found) {
    if (!(relPath in allowlist)) {
      const { lines } = scanFile(relPath);
      errors.push(
        `${NS_STALE_REFERENCE} ${relPath}: ${count} reference${count === 1 ? '' : 's'} to the ` +
          `retired \`workflows:\` namespace (line${lines.length === 1 ? '' : 's'} ` +
          `${lines.join(', ')}). Rename to \`flow:\`, or add the file to ` +
          `${toPosix(path.relative(ROOT, ALLOWLIST_FILE))} via --write-allowlist if it is ` +
          'a dated record that must not be rewritten.'
      );
      annotate(relPath, lines[0], `${NS_STALE_REFERENCE} stale \`workflows:\` reference`);
      continue;
    }
    const expected = allowlist[relPath];
    if (count !== expected) {
      const direction = count < expected ? 'partially swept' : 'gained references';
      errors.push(
        `${NS_ALLOWLIST_COUNT_DRIFT} ${relPath}: allowlist declares ${expected} reference${
          expected === 1 ? '' : 's'
        } but found ${count} (${direction}). Finish the sweep for this file and remove its ` +
          'entry, or re-run --write-allowlist if the new count is intended.'
      );
      annotate(
        relPath,
        scanFile(relPath).lines[0],
        `${NS_ALLOWLIST_COUNT_DRIFT} allowlist count drift: expected ${expected}, found ${count}`
      );
    }
  }

  // 3. An allowlisted file that exists but is now clean should lose its entry,
  //    so the allowlist shrinks monotonically toward the terminal state.
  for (const relPath of Object.keys(allowlist)) {
    if (!fs.existsSync(path.join(ROOT, relPath))) continue; // already reported above
    if (!found.has(relPath)) {
      errors.push(
        `${NS_ALLOWLIST_COUNT_DRIFT} ${relPath}: allowlist declares ${allowlist[relPath]} ` +
          'reference(s) but the file is now clean. Remove the entry in the same commit ' +
          'that swept the file.'
      );
      annotate(
        toPosix(path.relative(ROOT, ALLOWLIST_FILE)),
        1,
        `${NS_ALLOWLIST_COUNT_DRIFT} stale allowlist entry: ${relPath} is clean`
      );
    }
  }

  if (errors.length > 0) {
    console.error('[validate-flow-namespace] ✗ namespace migration is not clean:');
    for (const e of errors) console.error(`  ${e}`);
    console.error(
      `\n[validate-flow-namespace] ${errors.length} error${errors.length === 1 ? '' : 's'}. ` +
        'See plans/workflows-to-flow-namespace-migration.md for the sweep plan.'
    );
    process.exit(1);
  }

  const remaining = [...found.values()].reduce((a, b) => a + b, 0);
  if (remaining === 0) {
    console.log(
      '[validate-flow-namespace] ✓ no `workflows:` references remain outside permanent exclusions'
    );
  } else {
    console.log(
      `[validate-flow-namespace] ✓ ${remaining} allowlisted \`workflows:\` reference` +
        `${remaining === 1 ? '' : 's'} across ${found.size} file${found.size === 1 ? '' : 's'} ` +
        '(sweep in progress — counts match the allowlist exactly)'
    );
  }
}

main();
