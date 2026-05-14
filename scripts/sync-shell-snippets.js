#!/usr/bin/env node

'use strict';

/**
 * sync-shell-snippets.js — build-time generator that keeps copy-pasted
 * shell helper blocks in the plugin install scripts in sync with a single
 * canonical source (debt findings 014/015/036/037).
 *
 * Canonical snippets live in scripts/snippets/<name>.sh. Each consuming
 * install script carries one generated block per snippet it embeds,
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

const ROOT = path.resolve(__dirname, '..');
const SNIPPETS_DIR = path.join(ROOT, 'scripts', 'snippets');
const CHECK_MODE = process.argv.slice(2).includes('--check');

// Manifest: each install script → the ordered list of snippet names it
// embeds. install-helpers (colors + error/warning/success) is shared by all
// three; install-version-gte is shared only by codex + semgrep (ruvector
// keeps its own version_lt).
const TARGETS = {
  'plugins/yellow-codex/scripts/install-codex.sh': [
    'install-helpers',
    'install-version-gte',
  ],
  'plugins/yellow-semgrep/scripts/install-semgrep.sh': [
    'install-helpers',
    'install-version-gte',
  ],
  'plugins/yellow-ruvector/scripts/install.sh': ['install-helpers'],
};

function loadSnippet(name) {
  const p = path.join(SNIPPETS_DIR, `${name}.sh`);
  if (!fs.existsSync(p)) {
    console.error(`[sync-shell-snippets] Error: snippet not found: ${p}`);
    process.exit(1);
  }
  // Trim a trailing newline so the generated block joins cleanly; the
  // begin/end markers supply their own line breaks.
  return fs.readFileSync(p, 'utf8').replace(/\n$/, '');
}

/**
 * Replace the body of the `<name>` generated block in `content`. Returns
 * the new content, or throws if the sentinel pair is missing.
 */
function regenerateBlock(content, name) {
  const begin = `# >>> generated: ${name} (source: scripts/snippets/${name}.sh) >>>`;
  const end = `# <<< generated: ${name} <<<`;
  const beginIdx = content.indexOf(begin);
  // Anchor the end search after the begin marker — a snippet body that
  // documents the sentinel format must not be able to truncate the
  // generated block on the next run (gemini/copilot review #534).
  const endSearchFrom = beginIdx === -1 ? 0 : beginIdx + begin.length;
  const endIdx = content.indexOf(end, endSearchFrom);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    throw new Error(
      `missing or malformed sentinel block for "${name}" ` +
        `(expected "${begin}" ... "${end}")`
    );
  }
  const block =
    `${begin}\n` +
    '# DO NOT EDIT — regenerate with: pnpm generate:snippets\n' +
    `${loadSnippet(name)}\n` +
    end;
  return content.slice(0, beginIdx) + block + content.slice(endIdx + end.length);
}

function main() {
  let driftCount = 0;
  let errorCount = 0;

  for (const [relPath, snippetNames] of Object.entries(TARGETS)) {
    const absPath = path.join(ROOT, relPath);
    if (!fs.existsSync(absPath)) {
      console.error(`[sync-shell-snippets] Error: target not found: ${relPath}`);
      errorCount++;
      continue;
    }
    const original = fs.readFileSync(absPath, 'utf8');
    let updated = original;
    try {
      for (const name of snippetNames) {
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
      `[sync-shell-snippets] ✓ all ${Object.keys(TARGETS).length} install ` +
        'scripts are in sync with scripts/snippets/'
    );
  } else {
    console.log('[sync-shell-snippets] done');
  }
  process.exit(0);
}

main();
