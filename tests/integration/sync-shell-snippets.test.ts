/**
 * Integration test for `scripts/sync-shell-snippets.js`.
 *
 * Verifies the generator's exit codes and stderr output for:
 *   1. In-sync targets → --check exits 0.
 *   2. Tampered generated block → --check exits 1, names the drifted target.
 *   3. Missing sentinel pair → reports cleanly (exit 1) without crashing.
 *   4. Missing snippet file → throws inside loadSnippet, surfaces via
 *      main()'s outer catch as a per-target error (exit 1), and does NOT
 *      short-circuit the rest of the target loop.
 *   5. Apply mode (no flag) rewrites a drifted block back to canonical
 *      content and exits 0.
 *
 * Test parameterization: SYNC_SHELL_SNIPPETS_ROOT overrides the project
 * root, so tests build a minimal fixture tree without touching the real
 * repo. The TARGETS map in the script is hardcoded; the fixture mirrors
 * every entry so the script's per-target loop finds all of them.
 */

import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const SCRIPT = resolve(
  __dirname,
  '..',
  '..',
  'scripts',
  'sync-shell-snippets.js'
);

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function run(rootDir: string, args: string[] = []): RunResult {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], {
      env: { ...process.env, SYNC_SHELL_SNIPPETS_ROOT: rootDir },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status: number; stdout?: string; stderr?: string };
    return {
      status: e.status,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
    };
  }
}

function write(rootDir: string, relPath: string, body: string): void {
  const full = join(rootDir, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body, 'utf8');
}

function generatedBlock(name: string, body: string): string {
  return [
    `# >>> generated: ${name} (source: scripts/snippets/${name}.sh) >>>`,
    `# DO NOT EDIT — regenerate with: pnpm generate:snippets`,
    body,
    `# <<< generated: ${name} <<<`,
  ].join('\n');
}

const HELPERS_BODY = `readonly RED='\\033[0;31m'\nerror() { printf '%s\\n' "$1" >&2; exit 1; }`;
const VERSION_GTE_BODY = `version_gte() { [ "$1" = "$2" ]; }`;

// Match the script's TARGETS manifest exactly so the per-target loop
// finds every entry. Focus drift tests on the ruvector target (single
// snippet, easiest to mutate cleanly).
const FOCUS_TARGET = 'plugins/yellow-ruvector/scripts/install.sh';

function buildSimpleTarget(blocks: string[]): string {
  return ['#!/bin/bash', 'set -Eeuo pipefail', '', ...blocks, ''].join('\n');
}

function seedAllTargets(tmp: string, ruvectorBlock: string): void {
  // Snippets — canonical content the script will compare against.
  write(tmp, 'scripts/snippets/install-helpers.sh', `${HELPERS_BODY}\n`);
  write(tmp, 'scripts/snippets/install-version-gte.sh', `${VERSION_GTE_BODY}\n`);

  const helpersBlock = generatedBlock('install-helpers', HELPERS_BODY);
  const versionBlock = generatedBlock('install-version-gte', VERSION_GTE_BODY);

  write(
    tmp,
    'plugins/yellow-codex/scripts/install-codex.sh',
    buildSimpleTarget([helpersBlock, versionBlock])
  );
  write(
    tmp,
    'plugins/yellow-semgrep/scripts/install-semgrep.sh',
    buildSimpleTarget([helpersBlock, versionBlock])
  );
  write(
    tmp,
    'plugins/yellow-research/scripts/install-ast-grep.sh',
    buildSimpleTarget([helpersBlock])
  );
  // The focus target uses the caller-supplied block so individual tests
  // can drift it without touching the other targets.
  write(tmp, FOCUS_TARGET, buildSimpleTarget([ruvectorBlock]));
}

describe('sync-shell-snippets.js', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sync-shell-snippets-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('--check exits 0 when every target is in sync', () => {
    seedAllTargets(tmp, generatedBlock('install-helpers', HELPERS_BODY));
    const result = run(tmp, ['--check']);
    expect(result.status).toBe(0);
  });

  it('--check exits 1 and names the drifted target', () => {
    seedAllTargets(tmp, generatedBlock('install-helpers', 'readonly TAMPERED=1'));
    const result = run(tmp, ['--check']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('drift');
    expect(result.stderr).toContain(FOCUS_TARGET);
  });

  it('reports cleanly when the focus target is missing its sentinel pair', () => {
    seedAllTargets(tmp, generatedBlock('install-helpers', HELPERS_BODY));
    // Overwrite the focus target with content that lacks the markers.
    write(tmp, FOCUS_TARGET, '#!/bin/bash\necho "no markers here"\n');
    const result = run(tmp, ['--check']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing or malformed sentinel');
    expect(result.stderr).toContain(FOCUS_TARGET);
  });

  it('reports a missing snippet file as a per-target error (does not crash)', () => {
    seedAllTargets(tmp, generatedBlock('install-helpers', HELPERS_BODY));
    // Remove the canonical snippet so loadSnippet throws on every target
    // that references it. Each target's error surfaces independently.
    rmSync(join(tmp, 'scripts/snippets/install-helpers.sh'));
    const result = run(tmp, ['--check']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('snippet not found');
    // All four targets reference install-helpers, so the error must
    // appear at least four times — proves the loop did not short-circuit.
    const errorLines = result.stderr
      .split('\n')
      .filter((l) => l.includes('snippet not found'));
    expect(errorLines.length).toBeGreaterThanOrEqual(4);
  });

  it('apply mode (no flag) rewrites a drifted block back to canonical content', () => {
    seedAllTargets(tmp, generatedBlock('install-helpers', 'readonly TAMPERED=1'));
    const result = run(tmp); // no --check → apply mode
    expect(result.status).toBe(0);
    const after = readFileSync(join(tmp, FOCUS_TARGET), 'utf8');
    expect(after).toContain(HELPERS_BODY);
    expect(after).not.toContain('TAMPERED');
  });
});
