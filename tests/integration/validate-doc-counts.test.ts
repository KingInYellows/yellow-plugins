/**
 * Integration test for `scripts/validate-doc-counts.js`.
 *
 * Verifies that:
 *   1. A narrative doc claiming the wrong plugin count (e.g., "15 plugins"
 *      when canonical is 3) → exit 1 with file/line/found/expected in stderr.
 *   2. A narrative doc claiming the correct count → exit 0.
 *   3. A narrative doc with no count claim → exit 0.
 *   4. Multiple mismatches → all reported, exit 1.
 *
 * Test parameterization: VALIDATE_DOC_COUNTS_ROOT overrides the project
 * root, so tests can build a fixture tree without touching the real repo.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const VALIDATOR = resolve(__dirname, '..', '..', 'scripts', 'validate-doc-counts.js');

// Mirrors SCAN_FILES in the validator (it runs main() on load, so it cannot
// be imported). The missing-file test below fails if the two drift apart.
const SCAN_FILES = [
  'CLAUDE.md',
  'README.md',
  'CONTRIBUTING.md',
  'AGENTS.md',
  'docs/architecture-overview.md',
];

interface ValidatorRun {
  status: number;
  stdout: string;
  stderr: string;
}

function runValidator(rootDir: string): ValidatorRun {
  try {
    const stdout = execFileSync('node', [VALIDATOR], {
      env: { ...process.env, VALIDATE_DOC_COUNTS_ROOT: rootDir },
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

function writeFile(rootDir: string, relPath: string, body: string): void {
  const fullPath = join(rootDir, relPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, body, 'utf8');
}

function writeMarketplace(rootDir: string, count: number): void {
  const plugins = Array.from({ length: count }, (_, i) => ({
    name: `plugin-${i}`,
    description: `desc-${i}`,
    source: `./plugins/plugin-${i}`,
  }));
  writeFile(
    rootDir,
    '.claude-plugin/marketplace.json',
    JSON.stringify({ name: 'test', plugins }, null, 2)
  );
}

describe('validate-doc-counts', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-validate-doc-counts-'));
    // Every SCAN_FILES entry must exist; stub them with count-free content so
    // each test only writes the file it exercises.
    for (const relPath of SCAN_FILES) {
      writeFile(tmpRoot, relPath, '# Stub\n');
    }
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('passes when narrative count matches canonical', () => {
    writeMarketplace(tmpRoot, 3);
    writeFile(tmpRoot, 'CLAUDE.md', '# Test\n\nThis project ships 3 plugins.\n');

    const { status, stdout } = runValidator(tmpRoot);

    expect(status).toBe(0);
    expect(stdout).toMatch(/PASS/);
  });

  it('fails when CLAUDE.md claims wrong plugin count', () => {
    writeMarketplace(tmpRoot, 18);
    writeFile(
      tmpRoot,
      'CLAUDE.md',
      '# Test\n\nThis project ships 14 plugins under plugins/.\n'
    );

    const { status, stderr } = runValidator(tmpRoot);

    expect(status).toBe(1);
    expect(stderr).toMatch(/CLAUDE\.md:3/);
    expect(stderr).toMatch(/14 plugins/);
    expect(stderr).toMatch(/marketplace has 18/);
  });

  it('passes when no count claims are present', () => {
    writeMarketplace(tmpRoot, 5);
    writeFile(tmpRoot, 'README.md', '# Test\n\nA project.\nNo counts.\n');

    const { status } = runValidator(tmpRoot);

    expect(status).toBe(0);
  });

  it('reports all mismatches across multiple files', () => {
    writeMarketplace(tmpRoot, 18);
    writeFile(
      tmpRoot,
      'CLAUDE.md',
      '# CLAUDE\n\nShips 14 plugins.\n'
    );
    writeFile(
      tmpRoot,
      'README.md',
      '# README\n\nLines.\nWe have 17 plugins.\n'
    );

    const { status, stderr } = runValidator(tmpRoot);

    expect(status).toBe(1);
    expect(stderr).toMatch(/CLAUDE\.md.*14 plugins/);
    expect(stderr).toMatch(/README\.md.*17 plugins/);
  });

  it('matches "marketplace plugins" pattern as well as bare "plugins"', () => {
    writeMarketplace(tmpRoot, 18);
    writeFile(
      tmpRoot,
      'README.md',
      '# Test\n\nWe ship 17 marketplace plugins to consumers.\n'
    );

    const { status, stderr } = runValidator(tmpRoot);

    expect(status).toBe(1);
    expect(stderr).toMatch(/17 marketplace plugins/);
  });

  it('scans the nested docs/architecture-overview.md entry', () => {
    writeMarketplace(tmpRoot, 18);
    writeFile(
      tmpRoot,
      'docs/architecture-overview.md',
      '# Overview\n\nThe marketplace (17 plugins) ships from one repo.\n'
    );

    const { status, stderr } = runValidator(tmpRoot);

    expect(status).toBe(1);
    expect(stderr).toMatch(/docs\/architecture-overview\.md:3/);
  });

  it('catches a claim that prose wrapping split across two lines', () => {
    writeMarketplace(tmpRoot, 18);
    writeFile(
      tmpRoot,
      'README.md',
      '# Test\n\nThe marketplace ships 17\nplugins to consumers.\n'
    );

    const { status, stderr } = runValidator(tmpRoot);

    expect(status).toBe(1);
    expect(stderr).toMatch(/README\.md:3/);
    expect(stderr).toMatch(/17 plugins/);
  });

  it.each(SCAN_FILES)('fails when SCAN_FILES entry %s is missing', (relPath) => {
    writeMarketplace(tmpRoot, 3);
    rmSync(join(tmpRoot, relPath));

    const { status, stderr } = runValidator(tmpRoot);

    expect(status).toBe(1);
    expect(stderr).toContain(`${relPath} is listed in SCAN_FILES but does not exist`);
  });
});
