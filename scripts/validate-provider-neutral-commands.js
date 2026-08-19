#!/usr/bin/env node

/**
 * validate-provider-neutral-commands.js
 *
 * GOAL.md Phase 6: rejects direct mutating `gt` or `gh stack` command
 * references outside provider-owned surfaces, so an active provider-neutral
 * workflow (yellow-core, yellow-review, yellow-linear, yellow-debt,
 * yellow-devin, root CLAUDE.md/AGENTS.md) cannot silently reintroduce a
 * hardcoded Graphite (or GitHub) assumption after this migration.
 *
 * Scope, deliberately narrow (per GOAL.md: "avoid a broad directory
 * allowlist that could hide future regressions"):
 *
 *   1. PATH exclusion — provider IMPLEMENTATION directories
 *      (`plugins/gt-workflow/`, `plugins/github-workflow/`). These plugins
 *      own the commands they reference; that is the entire point of the
 *      provider split.
 *   2. PATH exclusion — historical record directories (`plans/complete/`,
 *      `docs/research/`, `plans/handoff/`). Content describing PAST
 *      behavior accurately is not rewritten to satisfy a forward-looking
 *      gate.
 *   3. COUNT exclusion — `scripts/provider-neutral-commands-allowlist.json`,
 *      a small `{ "relative/path.md": maxOccurrences }` map. Two legitimate
 *      shapes populate it: (a) a genuinely deliberate example in a file
 *      that is neither provider-owned nor historical (e.g. a comparison
 *      table), and (b) a MIGRATED provider-neutral workflow, where a
 *      mutating `gt`/`gh stack` reference still appears in the text but is
 *      now reached only after an explicit provider-resolution step (see
 *      `stack-provider-router`) and sits alongside a GitHub-equivalent
 *      branch — this lexical sweep cannot distinguish "gated behind
 *      resolved-Graphite" from "hardcoded", so the reviewed count is the
 *      gate for that distinction instead. Grows only on review; empty by
 *      default. Exceeding the allowed count for a file still fails — the
 *      allowlist caps occurrences, it does not exempt the file, so an
 *      unreviewed NEW mutating reference above the recorded count still
 *      breaks CI.
 *
 * What counts as "mutating": `gt <verb>` for a fixed list of state-changing
 * gt subcommands, and `gh stack <verb>` for a fixed list of state-changing
 * gh-stack subcommands (both lists exclude read-only/navigation verbs —
 * `gt log`/`up`/`down`/`top`/`bottom`/`trunk`/`checkout`,
 * `gh stack view`/`checkout`/`up`/`down`/`top`/`bottom`/`trunk` — on
 * purpose: this gate is about MUTATION, not about mentioning the CLI at
 * all). This is intentionally a lexical sweep, matching the same
 * "regex over prose + code fences" approach as
 * scripts/validate-flow-namespace.js, not an AST/shell parser — a
 * markdown-embedded command example is exactly the kind of text this gate
 * must see.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const SELF_RELATIVE = 'scripts/validate-provider-neutral-commands.js';
const ALLOWLIST_PATH = path.join(__dirname, 'provider-neutral-commands-allowlist.json');

const OWNED_PREFIXES = ['plugins/gt-workflow/', 'plugins/github-workflow/'];
const HISTORICAL_PREFIXES = ['plans/complete/', 'docs/research/', 'plans/handoff/'];

// State-changing `gt` subcommands. Excludes read/navigation verbs
// (log, checkout, up, down, top, bottom, trunk, pr) on purpose.
const MUTATING_GT_VERBS = ['create', 'modify', 'submit', 'sync', 'restack', 'delete', 'commit', 'merge', 'get', 'continue', 'abort'];
// State-changing `gh stack` subcommands, per the command surface verified
// in docs/research/2026-08-18-github-stack-provider-operations-revalidation.md.
// Excludes view/checkout/up/down/top/bottom/trunk/switch/feedback/alias.
const MUTATING_GH_STACK_VERBS = ['init', 'add', 'submit', 'push', 'sync', 'rebase', 'modify', 'merge', 'link', 'unstack'];

const GT_RE = new RegExp(`\`?\\bgt\\s+(${MUTATING_GT_VERBS.join('|')})\\b`, 'g');
const GH_STACK_RE = new RegExp(`\`?\\bgh\\s+stack\\s+(${MUTATING_GH_STACK_VERBS.join('|')})\\b`, 'g');

function walkMarkdown(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.git')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkMarkdown(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

function toRelative(absPath) {
  return path.relative(REPO_ROOT, absPath).split(path.sep).join('/');
}

function isExcludedByPath(relPath) {
  if (relPath === SELF_RELATIVE) return true;
  // CHANGELOG.md files are changeset-generated historical records of past
  // releases — the same "accurately describes past behavior" rationale as
  // the HISTORICAL_PREFIXES directories, just filename-keyed because
  // CHANGELOG.md lives inside every plugin directory rather than one
  // shared root.
  if (path.basename(relPath) === 'CHANGELOG.md') return true;
  return (
    OWNED_PREFIXES.some((prefix) => relPath.startsWith(prefix)) ||
    HISTORICAL_PREFIXES.some((prefix) => relPath.startsWith(prefix))
  );
}

function collectTargetFiles() {
  const files = walkMarkdown(path.join(REPO_ROOT, 'plugins'), []);
  for (const rootDoc of ['CLAUDE.md', 'AGENTS.md']) {
    const full = path.join(REPO_ROOT, rootDoc);
    if (fs.existsSync(full)) files.push(full);
  }
  return files;
}

function findMatches(text) {
  const matches = [];
  for (const re of [GT_RE, GH_STACK_RE]) {
    re.lastIndex = 0;
    let match;
    // eslint-disable-next-line no-cond-assign
    while ((match = re.exec(text)) !== null) {
      matches.push(match[0].replace(/^`/, ''));
    }
  }
  return matches;
}

function main() {
  const allowlist = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'));
  const files = collectTargetFiles();
  const violations = [];

  for (const file of files) {
    const rel = toRelative(file);
    if (isExcludedByPath(rel)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const matches = findMatches(text);
    if (matches.length === 0) continue;
    const allowed = typeof allowlist[rel] === 'number' ? allowlist[rel] : 0;
    if (matches.length <= allowed) continue;
    violations.push({ rel, count: matches.length, allowed, samples: [...new Set(matches)].slice(0, 5) });
  }

  if (violations.length === 0) {
    console.log(
      `[validate-provider-neutral-commands] OK: ${files.length} markdown file(s) scanned, no unallowlisted mutating gt/gh-stack references outside provider-owned or historical paths.`
    );
    return 0;
  }

  console.error('[validate-provider-neutral-commands] FAILED — direct mutating provider commands found outside provider-owned surfaces:\n');
  for (const violation of violations) {
    console.error(
      `  ${violation.rel}: ${violation.count} occurrence(s) (allowlisted: ${violation.allowed}) — e.g. ${violation.samples.join(', ')}`
    );
  }
  console.error(
    '\nRoute through /stack:status + the provider-neutral registry instead (plugins/yellow-core/lib/stack-operation-registry.js), or, for a genuinely deliberate example, add a narrow, reviewed entry to scripts/provider-neutral-commands-allowlist.json.'
  );
  return 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { findMatches, isExcludedByPath, MUTATING_GT_VERBS, MUTATING_GH_STACK_VERBS };
