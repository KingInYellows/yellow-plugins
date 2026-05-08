#!/usr/bin/env node

/**
 * Narrative Doc Count Validator
 *
 * Reads .claude-plugin/marketplace.json as the canonical plugin count, then
 * scans root-level narrative docs (CLAUDE.md, README.md, etc.) for
 * "<N> plugins" / "<N> marketplace plugins" / "<N> consumers" claims and
 * fails if any claim's integer does not match the canonical count.
 *
 * M-01 (audit 2026-05-07): catches drift between marketplace.json and the
 * narrative documentation. CLAUDE.md said "14 plugins" while marketplace
 * had 18; README.md said "17". The lint runs in pnpm release:check.
 *
 * Usage:
 *   node scripts/validate-doc-counts.js
 *   ROOT=/some/path node scripts/validate-doc-counts.js
 *
 * Exit codes:
 *   0 - All claims match canonical count
 *   1 - At least one mismatch (file/line/found/expected printed to stderr)
 *
 * Test parameterization (used by integration tests):
 *   VALIDATE_DOC_COUNTS_ROOT - override the project root
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.env.VALIDATE_DOC_COUNTS_ROOT || process.cwd();
const MARKETPLACE = path.join(ROOT, '.claude-plugin', 'marketplace.json');

// Files to scan. Root-level narrative docs only — plugins/<name>/CLAUDE.md
// and docs/solutions/ are NOT scanned (per-plugin counts may legitimately
// differ from the canonical marketplace count).
const SCAN_FILES = ['CLAUDE.md', 'README.md', 'CONTRIBUTING.md', 'AGENTS.md'];

// Patterns to match. Each pattern captures a single integer (group 1) before
// the keyword. Use \b around keywords to avoid matching "Nplugins" or
// "consumers123".
const PATTERNS = [
  { regex: /\b(\d+)\s+plugins\b/gi, label: 'plugins' },
  { regex: /\b(\d+)\s+marketplace\s+plugins\b/gi, label: 'marketplace plugins' },
  { regex: /\b(\d+)\s+consumers\b/gi, label: 'consumers' },
];

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
};

function readMarketplaceCount() {
  if (!fs.existsSync(MARKETPLACE)) {
    console.error(
      `${colors.red}✗ ERROR:${colors.reset} ${MARKETPLACE} not found`
    );
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(MARKETPLACE, 'utf8'));
  if (!Array.isArray(data.plugins)) {
    console.error(
      `${colors.red}✗ ERROR:${colors.reset} ${MARKETPLACE} missing plugins array`
    );
    process.exit(1);
  }
  return data.plugins.length;
}

// Same canonical count is used for plugins / marketplace plugins /
// consumers — they all reference the same metric in the audit context.
// If a project later wants distinct counts per label, extend this map.
function expectedFor(_label, canonical) {
  return canonical;
}

function scanFile(filePath, canonical, mismatches) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { regex, label } of PATTERNS) {
      // Reset lastIndex per line to avoid stateful regex pitfalls.
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(line)) !== null) {
        const found = parseInt(match[1], 10);
        const expected = expectedFor(label, canonical);
        if (found !== expected) {
          mismatches.push({
            file: path.relative(ROOT, filePath),
            line: i + 1,
            label,
            found,
            expected,
            context: line.trim(),
          });
        }
      }
    }
  }
}

function main() {
  const canonical = readMarketplaceCount();
  const mismatches = [];

  for (const relPath of SCAN_FILES) {
    scanFile(path.join(ROOT, relPath), canonical, mismatches);
  }

  if (mismatches.length === 0) {
    console.log(
      `${colors.green}✓ PASS:${colors.reset} doc counts match marketplace canonical (${canonical} plugins)`
    );
    return;
  }

  for (const m of mismatches) {
    console.error(
      `${colors.red}✗ ERROR:${colors.reset} ${m.file}:${m.line} claims "${m.found} ${m.label}" but marketplace has ${m.expected}`
    );
    console.error(`    ${m.context}`);
  }
  process.exit(1);
}

main();
