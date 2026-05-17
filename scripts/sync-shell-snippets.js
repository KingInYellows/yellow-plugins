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
// codex + semgrep + ruvector + yellow-research's install-ast-grep.sh;
// install-version-gte is shared by codex + semgrep (ruvector keeps its own
// version_lt).
//
// Known additional consumers not yet onboarded to this generator (codex P2
// review #534, threadId PRRT_kwDOQ3SUys6CmtOZ):
//   - plugins/yellow-research/scripts/install-ast-grep.sh — embeds the
//     install-helpers block byte-for-byte; onboarded as a TARGETS entry.
//   - plugins/yellow-mempalace/scripts/install-mempalace.sh — defines a
//     version_gte that differs ONLY in heredoc-delimiter style
//     (__EOF_VERSION_LEFT__ / __EOF_VERSION_RIGHT__) to avoid
//     heredoc-delimiter collision with user input. That safety property
//     is documented in MEMORY.md "Heredoc delimiter collision". Do NOT
//     migrate mempalace to install-version-gte without first porting the
//     unique-delimiter pattern into the canonical snippet.
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
  'plugins/yellow-research/scripts/install-ast-grep.sh': ['install-helpers'],
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
      `[sync-shell-snippets] ✓ all ${Object.keys(TARGETS).length} install ` +
        'scripts are in sync with scripts/snippets/'
    );
  } else {
    console.log('[sync-shell-snippets] done');
  }
  process.exit(0);
}

main();
