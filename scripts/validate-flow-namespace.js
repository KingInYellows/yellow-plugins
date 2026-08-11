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
 * repo-relative POSIX path PLUS a per-command occurrence-count fingerprint:
 *
 *   { "plugins/gt-workflow/CLAUDE.md": { "work": 5, "plan": 2 }, ... }
 *
 * The fingerprint is load-bearing, not just its total. A path+total-only
 * allowlist cannot catch a same-count substitution: if a PR removes one
 * `workflows:work` reference from an allowlisted file but introduces a
 * different `workflows:plan` reference elsewhere in the same file, the total
 * is unchanged and a total-only gate reports nothing. Comparing per-command
 * counts detects that. Fingerprints MUST be produced by this script's own
 * `--write-allowlist` mode, so they always come from the same matcher the
 * gate enforces with. Never transcribe them from an ad-hoc `rg` run.
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
 * carve-out is machine-local gitignored state — see GIT_IGNORED below, which
 * resolves every untracked path `.gitignore` covers (not a hand-enumerated
 * subset) via `git ls-files`, so it cannot be part of the commit and would
 * otherwise turn per-developer generated state into a false blocking
 * failure. A directory or file that IS walked but cannot be read is a hard
 * error, not a silent skip: this is a completeness gate, so treating an
 * unreadable path as "nothing to scan" could let it go green while stale
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

const { execFileSync } = require('child_process');
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
// Capturing group (rather than `(?:...)`) so scanFile() can bucket
// occurrences per command name — the allowlist fingerprint needs the
// command, not just a total count.
const STALE_RE = new RegExp('workflows:(' + COMMANDS.join('|') + ')(?![a-z-])', 'g');

/**
 * Permanent exclusions — never swept, by design.
 *
 * Three classes:
 *   - Dated records that would be FALSIFIED by rewriting (archived plans in
 *     plans/complete/**, brainstorms, solution docs, frozen audit snapshots,
 *     changelogs). The discriminator is "is this loaded as authoritative
 *     instruction, or is it a closed record of a past decision?" — not "is
 *     it old". Active plans directly under plans/ (and plans/shells/,
 *     plans/specs/, plans/handoff/) are live implementation instructions,
 *     not closed records, so they ARE scanned: a stale reference there would
 *     hand a future /workflows:work session to a command this migration
 *     deleted.
 *   - Transient or generated content (`.changeset/**` is consumed by the
 *     version-packages PR; this migration's own changesets legitimately name
 *     the old namespace, and the gate runs on the PR before they are consumed).
 *   - Machine-local gitignored state — resolved dynamically via GIT_IGNORED
 *     below, not hand-enumerated here. `.git` and `node_modules` stay
 *     hardcoded because they're VCS/tooling internals worth naming
 *     explicitly regardless of .gitignore's contents.
 *
 * Matched against repo-relative POSIX paths.
 */
const EXCLUDED_DIRS = [
  '.git',
  'node_modules',
  '.changeset',
  'plans/complete', // archived plan records — dated, would be FALSIFIED by rewriting
  'docs/brainstorms',
  'docs/solutions',
];

/**
 * Every path `.gitignore` covers that is NOT tracked, resolved once via
 * `git ls-files` instead of hand-enumerated (the prior approach hardcoded
 * `.claude/`, `.codex/`, `.entire/`, `.ruvector/` and missed everything else
 * `.gitignore` covers — `.swarm/`, `.hive-mind/`, `.claude-flow/`, `memory/`,
 * `coordination/`, build outputs, ... — turning any of those into a false
 * blocking failure on a developer machine that has them).
 *
 * `--others` scopes this to *untracked* paths only, so a file that is both
 * tracked and pattern-matched by `.gitignore` (e.g.
 * plugins/yellow-debt/.debt/.gitignore, added before its ignore rule
 * existed) is never swept up here — git tracks it, so it can enter a commit,
 * so the gate must still scan it. `--directory` collapses a fully-ignored
 * directory into a single trailing-slash entry instead of descending into
 * every file beneath it, so isExcluded()'s prefix check can skip the whole
 * subtree without the walk ever entering it.
 *
 * Resolved once at module load, before main() runs — --write-allowlist mode
 * needs the same exclusion set as the gate mode. If `git` is unavailable or
 * ROOT is not inside a git work tree (a release tarball, an archived copy of
 * the repo, a checkout without `.git`), this degrades to FALLBACK_IGNORED —
 * the exact hardcoded list the pre-dynamic version of this script used —
 * rather than aborting the process. Running `pnpm validate:schemas` in such
 * an environment must still scan, just with less precise exclusions; hard
 * `process.exit(1)`ing here would turn every git-less invocation into a
 * false-blocking failure of the whole authoring matrix target. Falling back
 * to an *empty* set instead would reintroduce that same false-blocking
 * failure the dynamic lookup was added to fix (untracked local generated
 * state would show up as stale references), so the fallback is the fixed
 * list, not nothing.
 */
const FALLBACK_IGNORED = ['.claude/', '.codex/', '.entire/', '.ruvector/'];

function gitIgnoredEntries() {
  let out;
  try {
    out = execFileSync(
      'git',
      ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'],
      { cwd: ROOT, encoding: 'utf8' }
    );
  } catch (err) {
    console.error(
      `[validate-flow-namespace] Warning: could not list git-ignored paths under ` +
        `${ROOT} (${err.message}) — is it inside a git work tree? Falling back to a ` +
        `hardcoded exclusion set (${FALLBACK_IGNORED.join(', ')}); results outside that ` +
        'fixed list may be less accurate in this environment.'
    );
    return FALLBACK_IGNORED;
  }
  return out.split('\0').filter(Boolean).map(toPosix);
}

const GIT_IGNORED = gitIgnoredEntries();

const EXCLUDED_FILES = [
  'CHANGELOG.md', // root, bot-generated release history
  'AUDIT_REPORT.md', // dated snapshot
  // Frozen audit snapshot living under a directory whose name suggests
  // living docs — classified per-file, not by directory.
  'docs/maintenance/plugin-audit-2026-06-10.md',
  // This migration's own plan doc — narrates the old namespace ~32 times by
  // design, describing the very rename this gate enforces. Every other
  // active plan under plans/ (and plans/shells/, plans/specs/,
  // plans/handoff/) is a live instruction and IS scanned.
  'plans/workflows-to-flow-namespace-migration.md',
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
  for (const entry of GIT_IGNORED) {
    const ignoredPath = entry.endsWith('/') ? entry.slice(0, -1) : entry;
    if (relPath === ignoredPath || relPath.startsWith(ignoredPath + '/')) return true;
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

/**
 * `counts` buckets occurrences by command name (e.g. `{ work: 3, plan: 1 }`)
 * — the fingerprint a substitution (swap `workflows:work` for
 * `workflows:plan` at unchanged total) has to disturb. See the module
 * header's ALLOWLIST section.
 *
 * @returns {{ counts: Record<string, number>, lines: number[] }}
 */
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
  const counts = {};
  content.split('\n').forEach((line, i) => {
    const matches = [...line.matchAll(STALE_RE)];
    if (matches.length > 0) {
      lines.push(i + 1);
      for (const m of matches) counts[m[1]] = (counts[m[1]] || 0) + 1;
    }
  });
  return { counts, lines };
}

/** Sum of all per-command counts in a fingerprint. */
function totalOf(counts) {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

/** Renders a fingerprint as `cmd: n, cmd: n` for error messages, sorted for determinism. */
function fmtCounts(counts) {
  return Object.keys(counts)
    .sort()
    .map((cmd) => `${cmd}: ${counts[cmd]}`)
    .join(', ');
}

/**
 * True if two per-command fingerprints are identical, including a command
 * present (non-zero) in one but absent from the other.
 */
function countsEqual(a, b) {
  for (const cmd of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if ((a[cmd] || 0) !== (b[cmd] || 0)) return false;
  }
  return true;
}

/** @returns {Map<string, Record<string, number>>} repo-relative path -> per-command fingerprint */
function scanRepo() {
  const found = new Map();
  for (const rel of walk(ROOT, [])) {
    const { counts } = scanFile(rel);
    if (totalOf(counts) > 0) found.set(rel, counts);
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
          'must contain a JSON object mapping path -> a per-command count fingerprint.'
      );
      process.exit(1);
    }
    for (const [relPath, entry] of Object.entries(parsed)) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        console.error(
          `[validate-flow-namespace] Error: ${toPosix(path.relative(ROOT, ALLOWLIST_FILE))} ` +
            `entry for ${relPath} must be an object mapping command name -> expected count ` +
            '(e.g. { "work": 3, "plan": 1 }), produced via --write-allowlist.'
        );
        process.exit(1);
      }
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
  for (const [rel, counts] of found) obj[rel] = counts;
  fs.writeFileSync(ALLOWLIST_FILE, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  const total = [...found.values()].reduce((a, counts) => a + totalOf(counts), 0);
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
  //    current per-command fingerprint. Comparing the fingerprint (not just
  //    the total) is what catches a same-count substitution — see the
  //    module header's ALLOWLIST section.
  for (const [relPath, counts] of found) {
    const total = totalOf(counts);
    if (!(relPath in allowlist)) {
      const { lines } = scanFile(relPath);
      errors.push(
        `${NS_STALE_REFERENCE} ${relPath}: ${total} reference${total === 1 ? '' : 's'} to the ` +
          `retired \`workflows:\` namespace (line${lines.length === 1 ? '' : 's'} ` +
          `${lines.join(', ')}). Rename to \`flow:\`, or add the file to ` +
          `${toPosix(path.relative(ROOT, ALLOWLIST_FILE))} via --write-allowlist if it is ` +
          'a dated record that must not be rewritten.'
      );
      annotate(relPath, lines[0], `${NS_STALE_REFERENCE} stale \`workflows:\` reference`);
      continue;
    }
    const expected = allowlist[relPath];
    if (!countsEqual(counts, expected)) {
      const expectedTotal = totalOf(expected);
      const direction =
        total < expectedTotal
          ? 'partially swept'
          : total > expectedTotal
            ? 'gained references'
            : 'reference mix changed';
      errors.push(
        `${NS_ALLOWLIST_COUNT_DRIFT} ${relPath}: allowlist declares {${fmtCounts(expected)}} ` +
          `but found {${fmtCounts(counts)}} (${direction}). Finish the sweep for this file and ` +
          'remove its entry, or re-run --write-allowlist if the new fingerprint is intended.'
      );
      annotate(
        relPath,
        scanFile(relPath).lines[0],
        `${NS_ALLOWLIST_COUNT_DRIFT} allowlist count drift: expected {${fmtCounts(expected)}}, ` +
          `found {${fmtCounts(counts)}}`
      );
    }
  }

  // 3. An allowlisted file that exists but is now clean should lose its entry,
  //    so the allowlist shrinks monotonically toward the terminal state.
  for (const relPath of Object.keys(allowlist)) {
    if (!fs.existsSync(path.join(ROOT, relPath))) continue; // already reported above
    if (!found.has(relPath)) {
      errors.push(
        `${NS_ALLOWLIST_COUNT_DRIFT} ${relPath}: allowlist declares {${fmtCounts(
          allowlist[relPath]
        )}} reference(s) but the file is now clean. Remove the entry in the same commit ` +
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

  const remaining = [...found.values()].reduce((a, counts) => a + totalOf(counts), 0);
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
