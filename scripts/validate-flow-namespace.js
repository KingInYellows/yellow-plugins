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
 * TWO TIERS, both fingerprint-checked, neither a silent whole-file skip:
 *
 * 1. ALLOWLIST — `scripts/flow-namespace-allowlist.json`, keyed on
 *    repo-relative POSIX path PLUS a per-command occurrence-count fingerprint:
 *
 *      { "plugins/gt-workflow/CLAUDE.md": { "work": 5, "plan": 2 }, ... }
 *
 *    This is the SHRINKING sweep-progress ledger. It must reach zero entries
 *    at the migration's terminal state; every entry here represents a file
 *    the sweep has not finished yet.
 *
 * 2. PINNED_FILES — a `const` map in THIS script (not JSON; see its
 *    docblock below), same fingerprint shape. This is the PERMANENT tier:
 *    dated records whose `workflows:` occurrences must never be rewritten,
 *    because rewriting would falsify a historical claim. Unlike the old
 *    whole-file `EXCLUDED_FILES` list this replaces, a pinned file is still
 *    WALKED AND SCANNED — its live prose stays under the gate, and only the
 *    pinned occurrences are permitted. A newly-introduced stale reference
 *    anywhere else in a pinned file still fails the gate, because it changes
 *    the file's fingerprint away from what's pinned.
 *
 * Both tiers compare fingerprints, not just totals — that's what catches a
 * same-count substitution in either one: if a PR removes one `workflows:work`
 * reference from a file but introduces a different `workflows:plan`
 * reference elsewhere in the same file, the total is unchanged and a
 * total-only gate reports nothing. Comparing per-command counts detects
 * that. Fingerprints for BOTH tiers MUST be produced by this script's own
 * matcher — `--write-allowlist` for the allowlist,
 * `--print-pinned-fingerprints` for PINNED_FILES — so they always come from
 * the same matcher the gate enforces with. Never transcribe them from an
 * ad-hoc `rg` run.
 *
 * A declared path that is missing from disk is a HARD ERROR in EITHER tier,
 * per the MEMORY_PROTOCOL_SENTINEL precedent in
 * scripts/validate-agent-authoring.js. Without it a ledger rots silently as
 * later sweep PRs delete entries, and moving a declared file passes
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
 *   node scripts/validate-flow-namespace.js                        # gate (CI)
 *   node scripts/validate-flow-namespace.js --write-allowlist       # regenerate the allowlist
 *   node scripts/validate-flow-namespace.js --print-pinned-fingerprints
 *       # print the CURRENT per-command fingerprint for every PINNED_FILES
 *       # path, computed by this script's own matcher, formatted to paste
 *       # into the PINNED_FILES literal below. Run this after editing a
 *       # pinned file's preserved captures, or after adding a new path to
 *       # PINNED_FILES with a placeholder fingerprint. Never hand-transcribe.
 *
 * Env:
 *   FLOW_NS_ROOT=<dir>          repo root override (tests)
 *   FLOW_NS_ALLOWLIST=<file>    allowlist path override (tests)
 *   GITHUB_ACTIONS=true         emit `::error file=` annotations
 *
 * Exit codes:
 *   0 - clean
 *   1 - stale references, count drift, or a missing allowlist/pinned path
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
const PRINT_PINNED_MODE = process.argv.includes('--print-pinned-fingerprints');

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

/**
 * Collective forms that name the namespace as a whole rather than one command:
 * `workflows:*` (glob) and `workflows:<cmd>` (angle-bracket placeholder).
 *
 * These are NOT covered by the COMMANDS list, and they are exactly the shape a
 * sweep misses — they appear in overview prose and namespace-split sections
 * that a per-command find-and-replace never touches. PR2 found a live one at
 * plugins/yellow-core/CLAUDE.md by hand, not by the gate; this closes that.
 *
 * The glob is `\*(?!\*)`, not a bare `\*`. Markdown bold puts `**` directly
 * after a colon-terminated phrase — "**Template-driven workflows:**" — and a
 * bare `\*` matches that as `workflows:` + `*`, which is ordinary English, not
 * a namespace reference. Three such false positives appeared the moment this
 * rule was added. A real glob is followed by a backtick, quote, or space,
 * never by a second asterisk.
 *
 * The glob is TWO alternatives, not one with an optional escape, because the
 * bold guard must apply to exactly one of them:
 *
 *   `\\\*`      the markdown-ESCAPED spelling `workflows:\*`. Prose that has
 *               to render a literal asterisk escapes it, so the same
 *               reference is spelled both ways in the same repo —
 *               RESEARCH/MERGE_PLAN.md uses the escaped form seven times.
 *               NO bold guard here: the escape already proves the asterisk is
 *               content, so a following `*` is markdown formatting around the
 *               reference (`**workflows:\***`), not a second glob character.
 *               Guarding this branch is what let a bolded escaped glob slip
 *               through the gate.
 *   `\*(?!\*)`  the bare spelling. The guard IS needed here: markdown bold
 *               puts `**` directly after a colon-terminated phrase —
 *               "**Template-driven workflows:**" — and an unguarded `\*`
 *               matches that as `workflows:` + `*`, which is ordinary
 *               English. Three such false positives appeared the moment this
 *               rule was added.
 *
 *               `(?!\*)` only rules out BOLD, because bold closes with two
 *               `*` characters. Markdown ITALIC closes with exactly one —
 *               the same character the real glob uses — so
 *               "*Template-driven workflows:*" still matches this
 *               alternative. That case is not filtered by the regex; see
 *               keepMatch() below, which applies a source-position check
 *               (immediately preceded by `/` or a backtick) to this bare
 *               alternative only, after the match, where the surrounding
 *               line text is available.
 */
const COLLECTIVE_FORMS = ['\\\\\\*', '\\*(?!\\*)', '<[a-z-]+>'];

// Shape 2 (unslashed) subsumes shapes 1 and 3 — see the module header.
// The tail guard applies only to the command alternation: `*` and `<...>` are
// self-delimiting, and applying `(?![a-z-])` to them would be a no-op anyway.
//
// Two capturing groups, so scanFile() can bucket occurrences per command name —
// the allowlist fingerprint needs the command, not just a total count. Group 1
// is the command; group 2 is a collective form, which names no single command
// and is bucketed under one of the COLLECTIVE_KEYS instead.
const STALE_RE = new RegExp(
  'workflows:(?:(' +
    COMMANDS.join('|') +
    ')(?![a-z-])|(' +
    COLLECTIVE_FORMS.join('|') +
    '))',
  'g'
);

/**
 * Fingerprint buckets for collective forms. They match the namespace without
 * naming one of the 10 commands, so they need a key of their own rather than
 * an `undefined` one — and the glob and the placeholder need SEPARATE keys.
 *
 * A single shared bucket would reintroduce the very blindness the fingerprint
 * exists to remove: swapping an allowlisted `workflows:*` for a
 * `workflows:<cmd>` in the same file leaves a shared count unchanged, so the
 * gate would accept a newly-introduced retired-namespace reference. Keyed
 * separately, that substitution shows up as drift like any other.
 */
const COLLECTIVE_GLOB_KEY = '(glob)';
const COLLECTIVE_PLACEHOLDER_KEY = '(placeholder)';

/**
 * Which collective bucket a group-2 match belongs to. The placeholder form is
 * the only one that starts with `<`; the glob is `*` or its markdown-escaped
 * `\*`, so anything else is the glob.
 */
function collectiveKeyFor(match) {
  return match.startsWith('<') ? COLLECTIVE_PLACEHOLDER_KEY : COLLECTIVE_GLOB_KEY;
}

/**
 * Discriminates a real bare-glob namespace reference (`/workflows:*`,
 * `` `workflows:*` ``) from ordinary prose whose italic markup happens to
 * close with a single `*` right after a colon-terminated phrase ending in
 * the plain English word "workflows:" (`*Template-driven workflows:*`).
 * COLLECTIVE_FORMS' `(?!\*)` guard already rules out bold (`**`); it cannot
 * rule out italic, which closes with exactly one `*` — the same character
 * the real glob uses — so this runs as a second pass over the match, in
 * scanFile(), where the line text around it is available.
 *
 * Every real bare-glob reference in this repo is written with the WHOLE
 * `workflows:*` phrase immediately preceded by a `/` or a backtick —
 * `` `/workflows:*` `` (docs/guides/common-workflows.md) and
 * `` `workflows:*` `` (RESEARCH/every-plugin-research.md, four
 * occurrences). An italicized phrase instead has a space or other prose
 * character right before "workflows" (`*Template-driven workflows:*`), so
 * the check is on the character before the MATCH START (`m.index`, the `w`
 * of `workflows:`) — not before the trailing `*`, which is always `:` and
 * would make the check a no-op. A match at the very start of a line
 * (`m.index === 0`) has no preceding character at all and is treated as
 * "not proven", falling into the accepted false negative below.
 *
 * Applies ONLY to the unescaped bare `*` alternative (`m[2] === '*'`): the
 * markdown-escaped `\*` spelling already proves intent (italic markup never
 * produces a backslash), and the `<placeholder>` form is self-delimiting —
 * widening this precedence requirement to either of them would be
 * incorrect, not just unnecessary, so neither is passed through this check.
 *
 * This deliberately trades one direction of error for the other: a false
 * positive here fails `pnpm validate:schemas` for every PR, and this gate
 * has no allowlist escape hatch at the terminal (zero-entry) state a false
 * positive would block reaching. The one accepted false negative — a bare
 * glob written in loose prose without a preceding slash or backtick, e.g.
 * "see workflows:* for the full list" — just leaves one stale reference for
 * a human reviewer to catch, the same category of miss any heuristic scan
 * already accepts elsewhere in this file.
 */
function keepMatch(line, m) {
  if (m[2] !== '*') return true; // escaped glob, placeholder, or a named command
  const prev = line[m.index - 1];
  return prev === '/' || prev === '`';
}

/**
 * Whole-subtree exclusions — never walked, never scanned, no fingerprint.
 *
 * These are BULK categories where every file underneath is uniformly out of
 * scope, so per-file fingerprint pinning (see PINNED_FILES below) would add
 * bookkeeping without adding safety:
 *   - Directories of archived/closed records (plans/complete/**, brainstorms,
 *     solution docs) — the discriminator is "is this loaded as authoritative
 *     instruction, or is it a closed record of a past decision?", not "is it
 *     old". Active plans directly under plans/ (and plans/shells/,
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
 * A single MIXED file — one that carries both live prose and a preserved
 * dated capture — must NOT go here: whole-subtree exclusion switches off
 * scanning for both halves, so a newly-introduced stale reference in the live
 * half would pass unnoticed. That per-file case is PINNED_FILES, below,
 * which stays scanned and fingerprint-locked instead.
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

/**
 * PINNED_FILES — permanent, per-file, fingerprint-checked. Replaces the old
 * whole-file `EXCLUDED_FILES` list. Every path below is WALKED AND SCANNED
 * like any other file; what's "pinned" is the expected count fingerprint,
 * not the file's visibility to the gate. A pinned file whose live fingerprint
 * no longer matches the value recorded here — in either direction — is
 * reported under `NS_ALLOWLIST_COUNT_DRIFT` (count drift), the same code the
 * shrinking allowlist uses, via `checkFingerprint()` below. The code is named
 * by its constant rather than spelled out, because `lint-error-codes.js`
 * fails any scripts/ file containing a literal catalog code — see the module
 * header's note on assembling them by concatenation.
 *
 * This is a permanent ledger, not a sweep-progress one: pinned entries are
 * NOT removed as the migration completes, and MUST NOT be moved into
 * `scripts/flow-namespace-allowlist.json` (that file must reach zero entries
 * at the migration's terminal state; PINNED_FILES has no such target).
 *
 * Regenerate a fingerprint with
 * `node scripts/validate-flow-namespace.js --print-pinned-fingerprints`
 * (see its docblock near WRITE_MODE) — never hand-transcribe from `rg`.
 *
 * Two classes below:
 *   - All-historical: every `workflows:` occurrence in the file is a dated
 *     record. Pinning these is strictly safer than leaving them off any
 *     ledger (a future edit that adds a *new* live reference still fails the
 *     gate, because the fingerprint no longer matches).
 *   - MIXED: the file carries both live prose (swept to `flow:` normally)
 *     and specific preserved captures (verbatim quotes, dated command names,
 *     provenance fields). Whole-file exclusion was a blind spot for these —
 *     it also stopped scanning the live half. Pinning fixes that: the live
 *     prose is scanned like normal, and the fingerprint only covers the
 *     preserved occurrences.
 */
const PINNED_FILES = {
  // All-historical — bot-generated / dated / provenance records.
  'CHANGELOG.md': { brainstorm: 1, compound: 1 }, // root, bot-generated release history
  'AUDIT_REPORT.md': { brainstorm: 1, plan: 1, work: 1, compound: 1, 'deepen-plan': 1 }, // dated snapshot
  // Frozen audit snapshot living under a directory whose name suggests
  // living docs — classified per-file, not by directory.
  'docs/maintenance/plugin-audit-2026-06-10.md': { plan: 1 },
  // This migration's own plan doc — narrates the old namespace by design,
  // describing the very rename this gate enforces. Every other active plan
  // under plans/ (and plans/shells/, plans/specs/, plans/handoff/) is a live
  // instruction and IS scanned against the shrinking allowlist instead.
  'plans/workflows-to-flow-namespace-migration.md': {
    '(glob)': 8,
    '(placeholder)': 9,
    plan: 3,
    work: 4,
    'deepen-plan': 1,
    spec: 1,
  },
  // `every-plugin-research.md` is upstream changelog analysis: every
  // `workflows:` reference is a claim about the UPSTREAM EveryInc plugin's
  // own `workflows:*` namespace and its v2.38.0 rename to `ce:*` — a
  // different project's history. Rewriting them to `flow:` would state a
  // falsehood about someone else's repo, which is a strictly worse outcome
  // than a stale-looking string.
  'RESEARCH/every-plugin-research.md': { '(glob)': 4, plan: 1, review: 1, brainstorm: 1 },
  // `MERGE_PLAN.md` is the concept-fork comparison. Its remaining
  // `workflows:` references are NOT all upstream-only: the doc's central
  // claim ("your commands are named workflows:* like upstream's
  // pre-v2.38.0 naming") is a true-in-the-old-vocabulary claim about
  // upstream history, and the inventory-diff table + "your state" prose
  // are a dated snapshot of THIS repo pinned to the doc's 2026-04-28
  // generation date — both are point-in-time records, not present-tense
  // claims, so they're preserved verbatim. The doc's present-tense
  // own-repo references (what brainstorm-orchestrator "drives", the
  // yellow-codex/yellow-core Codex-delegation overlap note, what
  // yellow-codex runs "outside of") were live claims about current
  // behavior and have been swept to `flow:*` directly in the file.
  'RESEARCH/MERGE_PLAN.md': { '(glob)': 7, plan: 1 },
  // `upstream-snapshots/.../MANIFEST.md` and `01-plugin-inventory.md` are
  // pinned historical snapshot/survey — provenance records that preserve
  // pre-rename command names verbatim (the fetch-manifest's `Fetched by`
  // field and the inventory's per-plugin command lists), each annotated
  // in-place with the post-rename equivalent rather than rewritten.
  'RESEARCH/upstream-snapshots/e5b397c9d1883354f03e338dd00f98be3da39f9f/MANIFEST.md': {
    work: 1,
  },
  'RESEARCH/01-plugin-inventory.md': {
    'deepen-plan': 1,
    plan: 1,
    work: 1,
    review: 1,
    compound: 1,
    brainstorm: 1,
  },

  // MIXED — live prose (scanned normally) plus preserved dated captures.
  //
  // Dated repo audit (2026-05-18) with two fenced blocks presented as
  // verbatim captures of pre-rename source: a "Lines 159–161" quote from
  // knowledge-compounder.md and compound.md's captured frontmatter
  // (`name: workflows:compound`). Both predate the 2026-08-10 rename, so
  // rewriting the quoted tokens would make the captures disagree with the
  // source actually inspected. Each fence carries an in-place annotation
  // giving the post-rename equivalent; the file's own prose (describing
  // the repo today) is on `flow:*` and IS scanned.
  'docs/research/repo/background-compounding-triggers-repo-audit.md': { compound: 2 },
  // Revalidation doc whose revision-2 provenance (2026-08-01, one week
  // before the 2026-08-10 rename) records the command used to re-enrich
  // it: `/yellow-research:workflows:deepen-plan`. Preserved verbatim in
  // both provenance sites (the Date line and the References source list),
  // each annotated with the post-rename equivalent. The body's own
  // `/flow:brainstorm` → `/flow:spec` → `/flow:decompose` pipeline mention
  // is a live statement about what happens next and IS scanned.
  'docs/research/yellow-council-v2-revalidation-2026-08-01.md': { 'deepen-plan': 2 },
  // Wave 3 research deliverable dated 2026-04-30, evaluating `codex-executor`
  // as it stood before the 2026-08-10 rename. Both dated-evaluation sites
  // (scope list, "Other observed expansion opportunities") preserve the
  // pre-rename `/workflows:work` name verbatim, each annotated in-place with
  // the post-rename `/flow:work` equivalent. The rest of the file's prose is
  // unaffected by the rename and IS scanned.
  'docs/research/yellow-codex-expansion.md': { work: 2 },
};

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
  // PINNED_FILES paths are NOT excluded here — they must be walked and
  // scanned like any other file. Their fingerprint is checked in main(),
  // not gated out of the walk. See PINNED_FILES's docblock.
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
    const matches = [...line.matchAll(STALE_RE)].filter((m) => keepMatch(line, m));
    if (matches.length === 0) return;
    lines.push(i + 1);
    for (const m of matches) {
      const key = m[1] || collectiveKeyFor(m[2]);
      counts[key] = (counts[key] || 0) + 1;
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

/**
 * `--print-pinned-fingerprints` — prints the CURRENT per-command fingerprint
 * for every PINNED_FILES path, computed by this script's own matcher against
 * `found` (the same scan the gate runs), formatted ready to paste into the
 * PINNED_FILES literal above. This is the only sanctioned way to produce a
 * pinned fingerprint — never hand-transcribe one from an ad-hoc `rg` run.
 */
function printPinnedFingerprints(found) {
  const keys = Object.keys(PINNED_FILES).sort();
  console.log(
    '[validate-flow-namespace] Current fingerprints for PINNED_FILES — paste into the map in ' +
      `${SELF_REL}:\n`
  );
  for (const relPath of keys) {
    const counts = found.get(relPath) || {};
    console.log(`  ${JSON.stringify(relPath)}: ${JSON.stringify(counts)},`);
  }
}

function annotate(relPath, line, message) {
  if (IS_CI) console.error(`::error file=${relPath},line=${line}::${message}`);
}

/**
 * Renders the `NS_ALLOWLIST_COUNT_DRIFT` (count-drift) message for one ledger
 * entry. Both ledgers compare fingerprints the same way (`countsEqual`), but
 * the guidance differs: the allowlist is a shrinking sweep-progress ledger
 * (drift usually means "finish the sweep"), while PINNED_FILES is a
 * permanent pin on dated content (drift usually means a NEW stale reference
 * appeared elsewhere in the file and must not be silently re-pinned away).
 */
function fingerprintDriftMessage(kind, relPath, expected, foundCounts) {
  if (kind === 'pinned') {
    return (
      `${NS_ALLOWLIST_COUNT_DRIFT} ${relPath}: PINNED_FILES declares {${fmtCounts(expected)}} ` +
      `but found {${fmtCounts(foundCounts)}}. This path is a PERMANENT pin on dated/historical ` +
      'content (see PINNED_FILES in scripts/validate-flow-namespace.js), not a sweep-in-progress ' +
      'entry — a mismatch usually means a NEW stale `workflows:` reference was introduced ' +
      'elsewhere in the file. Re-pin deliberately, with `node scripts/validate-flow-namespace.js ' +
      '--print-pinned-fingerprints` to regenerate the fingerprint, only if the new occurrence is ' +
      'genuinely historical; if it is a live claim, rename it to `flow:` instead.'
    );
  }
  const expectedTotal = totalOf(expected);
  const foundTotal = totalOf(foundCounts);
  const direction =
    foundTotal < expectedTotal
      ? 'partially swept'
      : foundTotal > expectedTotal
        ? 'gained references'
        : 'reference mix changed';
  return (
    `${NS_ALLOWLIST_COUNT_DRIFT} ${relPath}: allowlist declares {${fmtCounts(expected)}} ` +
    `but found {${fmtCounts(foundCounts)}} (${direction}). Finish the sweep for this file and ` +
    'remove its entry, or re-run --write-allowlist if the new fingerprint is intended.'
  );
}

function main() {
  const found = scanRepo();

  if (WRITE_MODE) {
    // PINNED_FILES entries are a separate, permanent ledger — they must
    // never be written into the shrinking allowlist, even though they are
    // now scanned like any other file and so appear in `found`.
    const sweepOnly = new Map([...found].filter(([relPath]) => !(relPath in PINNED_FILES)));
    writeAllowlist(sweepOnly);
    return;
  }

  if (PRINT_PINNED_MODE) {
    printPinnedFingerprints(found);
    return;
  }

  const allowlist = loadAllowlist();
  const errors = [];

  // 0. A path declared in BOTH ledgers is a maintainer authoring mistake:
  //    permanent pins must not live in the shrinking allowlist (module
  //    header's ALLOWLIST section) and vice versa. Fail loudly rather than
  //    silently preferring one ledger over the other.
  const dualDeclared = Object.keys(PINNED_FILES).filter((relPath) => relPath in allowlist);
  if (dualDeclared.length > 0) {
    console.error(
      '[validate-flow-namespace] ✗ configuration error: ' +
        `${dualDeclared.join(', ')} ${dualDeclared.length === 1 ? 'is' : 'are'} declared in ` +
        `BOTH PINNED_FILES (${SELF_REL}) and the allowlist ` +
        `(${toPosix(path.relative(ROOT, ALLOWLIST_FILE))}). A permanent pin must not also live in ` +
        'the shrinking allowlist. Remove it from whichever ledger is wrong.'
    );
    process.exit(1);
  }

  // 1. A declared path that no longer exists on disk is a hard error, in
  //    EITHER ledger. Without this a ledger rots as sweep PRs delete entries,
  //    and moving a declared file passes silently.
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
  for (const relPath of Object.keys(PINNED_FILES)) {
    if (!fs.existsSync(path.join(ROOT, relPath))) {
      errors.push(
        `${NS_ALLOWLIST_PATH_MISSING} ${relPath}: declared in PINNED_FILES (${SELF_REL}) but ` +
          'not found on disk. If the file moved, update its key in the same commit; if it was ' +
          'deleted, remove the entry.'
      );
      annotate(
        SELF_REL,
        1,
        `${NS_ALLOWLIST_PATH_MISSING} pinned path not found: ${relPath}`
      );
    }
  }

  // 2. Every file with a stale reference must be declared — in the allowlist
  //    or in PINNED_FILES — at the exact current per-command fingerprint.
  //    Comparing the fingerprint (not just the total) is what catches a
  //    same-count substitution — see the module header's ALLOWLIST section.
  for (const [relPath, counts] of found) {
    const total = totalOf(counts);
    const pinned = relPath in PINNED_FILES;
    const allowlisted = relPath in allowlist;

    if (!pinned && !allowlisted) {
      const { lines } = scanFile(relPath);
      errors.push(
        `${NS_STALE_REFERENCE} ${relPath}: ${total} reference${total === 1 ? '' : 's'} to the ` +
          `retired \`workflows:\` namespace (line${lines.length === 1 ? '' : 's'} ` +
          `${lines.join(', ')}). Rename to \`flow:\`, or add the file to ` +
          `${toPosix(path.relative(ROOT, ALLOWLIST_FILE))} via --write-allowlist if it is being ` +
          'swept in stages, or to PINNED_FILES in this script if it is a dated record that must ' +
          'never be rewritten.'
      );
      annotate(relPath, lines[0], `${NS_STALE_REFERENCE} stale \`workflows:\` reference`);
      continue;
    }

    const expected = pinned ? PINNED_FILES[relPath] : allowlist[relPath];
    if (!countsEqual(counts, expected)) {
      const msg = fingerprintDriftMessage(pinned ? 'pinned' : 'allowlist', relPath, expected, counts);
      errors.push(msg);
      annotate(relPath, scanFile(relPath).lines[0], msg);
    }
  }

  // 3a. An allowlisted file that exists but is now clean should lose its
  //     entry, so the allowlist shrinks monotonically toward the terminal
  //     state.
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

  // 3b. A pinned file that exists but no longer carries its expected
  //     occurrences is also drift — the preserved historical capture went
  //     missing — even though `found` never listed it (found only holds
  //     files with a non-zero live count). Unlike the allowlist case above,
  //     this is NOT "remove the entry": a permanent pin going to zero is
  //     unexpected and needs a maintainer to look, not a silent shrink.
  for (const relPath of Object.keys(PINNED_FILES)) {
    if (!fs.existsSync(path.join(ROOT, relPath))) continue; // already reported above
    if (!found.has(relPath)) {
      const expected = PINNED_FILES[relPath];
      if (totalOf(expected) > 0) {
        const msg = fingerprintDriftMessage('pinned', relPath, expected, {});
        errors.push(msg);
        annotate(SELF_REL, 1, msg);
      }
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
  const pinnedTotal = [...found.entries()].reduce(
    (a, [relPath, counts]) => a + (relPath in PINNED_FILES ? totalOf(counts) : 0),
    0
  );
  const sweepRemaining = remaining - pinnedTotal;
  if (sweepRemaining === 0) {
    console.log(
      '[validate-flow-namespace] ✓ no `workflows:` references remain outside permanent pins ' +
        `(${pinnedTotal} pinned reference${pinnedTotal === 1 ? '' : 's'} across ` +
        `${Object.keys(PINNED_FILES).length} permanent file${
          Object.keys(PINNED_FILES).length === 1 ? '' : 's'
        })`
    );
  } else {
    console.log(
      `[validate-flow-namespace] ✓ ${sweepRemaining} allowlisted \`workflows:\` reference` +
        `${sweepRemaining === 1 ? '' : 's'} (sweep in progress — counts match the allowlist ` +
        `exactly), plus ${pinnedTotal} permanently pinned reference${pinnedTotal === 1 ? '' : 's'}`
    );
  }
}

main();
