#!/usr/bin/env node

'use strict';

/**
 * sync-shell-snippets.js — build-time generator that keeps copy-pasted
 * shell helper blocks in the plugin install scripts in sync with a single
 * canonical source (debt findings 014/015/036/037).
 *
 * Canonical snippets live in scripts/snippets/<name>.sh. Each consuming
 * file carries one generated block per snippet it embeds,
 * delimited by sentinel markers:
 *
 *   # >>> generated: <name> (source: scripts/snippets/<name>.sh) >>>
 *   # DO NOT EDIT — regenerate with: pnpm generate:snippets
 *   <verbatim snippet content>
 *   # <<< generated: <name> <<<
 *
 * Usage:
 *   node scripts/sync-shell-snippets.js            # apply (rewrite blocks)
 *   node scripts/sync-shell-snippets.js --check    # CI drift check (exit 1 on drift)
 *
 * Exit codes:
 *   0 - in sync (or successfully regenerated)
 *   1 - drift detected (--check), or a missing sentinel block / file error
 */

const fs = require('fs');
const path = require('path');

// Allow tests to point ROOT at a fixture tree, mirroring the
// validate-doc-counts.js / validate-agent-authoring.js test-injection
// pattern (VALIDATE_DOC_COUNTS_ROOT, etc.).
const ROOT = process.env.SYNC_SHELL_SNIPPETS_ROOT
  ? path.resolve(process.env.SYNC_SHELL_SNIPPETS_ROOT)
  : path.resolve(__dirname, '..');
const SNIPPETS_DIR = path.join(ROOT, 'scripts', 'snippets');
const CHECK_MODE = process.argv.slice(2).includes('--check');

// Manifest: each install script → the ordered list of snippet names it
// embeds. install-helpers (colors + error/warning/success) is shared by
// codex + semgrep + yellow-research's install-ast-grep.sh;
// install-version-gte is shared by codex + semgrep. (yellow-ruvector no
// longer ships an install script: it installs into the plugin data dir via
// lib/install-ruvector.sh.)
//
// Known additional consumers not yet onboarded to this generator (codex P2
// review #534, threadId PRRT_kwDOQ3SUys6CmtOZ):
//   - plugins/yellow-research/scripts/install-ast-grep.sh — embeds the
//     install-helpers block byte-for-byte; onboarded as a TARGETS entry.
// yellow-core-root is the library-path bootstrap shared by /stack:status and
// stack-provider-router. It cannot be sourced: the block runs before the
// plugin root is known. plugin-list-json runs `claude plugin list --json`
// from the repository root, so project-scope overrides are folded in
// (CLAUDE-392); every surface that reads the list embeds it.
const TARGETS = {
  'plugins/yellow-codex/scripts/install-codex.sh': [
    'install-helpers',
    'install-version-gte',
  ],
  'plugins/yellow-semgrep/scripts/install-semgrep.sh': [
    'install-helpers',
    'install-version-gte',
  ],
  'plugins/yellow-research/scripts/install-ast-grep.sh': ['install-helpers'],
  'plugins/yellow-core/commands/stack/status.md': [
    'yellow-core-root',
    'plugin-list-json',
  ],
  'plugins/yellow-core/skills/stack-provider-router/SKILL.md': [
    'yellow-core-root',
    'plugin-list-json',
  ],
  'plugins/yellow-core/skills/stack-provider-guard/SKILL.md': [
    'plugin-list-json',
  ],
  'plugins/yellow-core/commands/setup/all.md': ['plugin-list-json'],
  'plugins/yellow-core/commands/statusline/setup.md': ['plugin-list-json'],
  'plugins/yellow-core/commands/stack/select.md': ['plugin-list-json'],
  'plugins/yellow-claudemod/commands/claudemod/setup.md': ['plugin-list-json'],
  'plugins/yellow-linear/commands/linear/setup.md': ['plugin-list-json'],
  // Four separate bash fences, one generated block in each.
  'plugins/yellow-linear/commands/linear/delegate.md': ['plugin-list-json'],
};

// Cache loaded snippets so a multi-target manifest does not re-read the
// same file once per (target, snippet) pair (copilot review #534).
const snippetCache = new Map();

function loadSnippet(name) {
  if (snippetCache.has(name)) {
    return snippetCache.get(name);
  }
  const p = path.join(SNIPPETS_DIR, `${name}.sh`);
  if (!fs.existsSync(p)) {
    // Throw rather than process.exit so main()'s outer loop can keep
    // surfacing the rest of the targets' errors in a single CI run
    // (gemini review #534).
    throw new Error(`snippet not found: ${p}`);
  }
  // Trim a trailing newline so the generated block joins cleanly; the
  // begin/end markers supply their own line breaks.
  const content = fs.readFileSync(p, 'utf8').replace(/\n$/, '');
  snippetCache.set(name, content);
  return content;
}

/**
 * Replace the body of every `<name>` generated block in `content` (a file
 * with several separate bash fences carries one block per fence). Returns
 * the new content, or throws if no well-formed sentinel pair exists.
 */
function regenerateBlock(content, name) {
  const begin = `# >>> generated: ${name} (source: scripts/snippets/${name}.sh) >>>`;
  const end = `# <<< generated: ${name} <<<`;
  const block =
    `${begin}\n` +
    '# DO NOT EDIT — regenerate with: pnpm generate:snippets\n' +
    `${loadSnippet(name)}\n` +
    end;
  let out = '';
  let cursor = 0;
  let replaced = 0;
  for (;;) {
    const beginIdx = content.indexOf(begin, cursor);
    if (beginIdx === -1) break;
    // Anchor the end search after the begin marker — a snippet body that
    // documents the sentinel format must not be able to truncate the
    // generated block on the next run (gemini/copilot review #534).
    const endIdx = content.indexOf(end, beginIdx + begin.length);
    const nextBegin = content.indexOf(begin, beginIdx + begin.length);
    // A begin with no end before the next begin is malformed: pairing it
    // with a later block's end would delete everything in between.
    if (endIdx === -1 || (nextBegin !== -1 && nextBegin < endIdx)) {
      replaced = 0;
      break;
    }
    out += content.slice(cursor, beginIdx) + block;
    cursor = endIdx + end.length;
    replaced++;
  }
  if (replaced === 0) {
    throw new Error(
      `missing or malformed sentinel block for "${name}" ` +
        `(expected "${begin}" ... "${end}")`
    );
  }
  return out + content.slice(cursor);
}

function main() {
  let driftCount = 0;
  let errorCount = 0;

  for (const [relPath, snippetNames] of Object.entries(TARGETS)) {
    const absPath = path.join(ROOT, relPath);
    if (!fs.existsSync(absPath)) {
      console.error(
        `[sync-shell-snippets] Error: target not found: ${relPath}`
      );
      errorCount++;
      continue;
    }
    const original = fs.readFileSync(absPath, 'utf8');
    let updated = original;
    try {
      for (const name of snippetNames) {
        // regenerateBlock now also surfaces "snippet not found" by way of
        // loadSnippet throwing, so a missing snippet is per-target rather
        // than terminating the whole run.
        updated = regenerateBlock(updated, name);
      }
    } catch (err) {
      console.error(`[sync-shell-snippets] Error: ${relPath}: ${err.message}`);
      errorCount++;
      continue;
    }

    if (updated === original) {
      continue; // already in sync
    }

    if (CHECK_MODE) {
      console.error(
        `[sync-shell-snippets] ✗ drift: ${relPath} — a generated block ` +
          'does not match its canonical snippet. Run `pnpm generate:snippets`.'
      );
      driftCount++;
    } else {
      fs.writeFileSync(absPath, updated, 'utf8');
      console.log(`[sync-shell-snippets] updated ${relPath}`);
    }
  }

  if (errorCount > 0) {
    process.exit(1);
  }
  if (CHECK_MODE) {
    if (driftCount > 0) {
      process.exit(1);
    }
    console.log(
      `[sync-shell-snippets] ✓ all ${Object.keys(TARGETS).length} targets ` +
        'are in sync with scripts/snippets/'
    );
  } else {
    console.log('[sync-shell-snippets] done');
  }
  process.exit(0);
}

main();
