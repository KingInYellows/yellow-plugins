/**
 * Behavior suite for `scripts/generate-manifests.js` (R9, R43 partial).
 *
 * Byte-identity and determinism run in-process against the real repo
 * (read-only). Every mutation scenario runs against a temp fixture copy of
 * the generator's inputs + targets, so the committed tree is never touched.
 * `--check` / `--dry-run` exit codes are exercised through a real
 * subprocess (the `validator-harness.ts` `execFileSync` pattern) with
 * `GENERATE_MANIFESTS_ROOT` pointing at the fixture.
 */

import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, it, expect, afterAll } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { generateManifests } = require('../../scripts/generate-manifests.js');

const REPO_ROOT = resolve(__dirname, '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'generate-manifests.js');

// Derived from the live plugin inventory (+1 for marketplace.json) rather
// than a hardcoded literal, matching the by-name/not-by-count discipline of
// the characterization suite.
const TARGET_COUNT =
  readdirSync(join(REPO_ROOT, 'plugins'), { withFileTypes: true }).filter((e) =>
    e.isDirectory()
  ).length + 1;

const fixtureRoots: string[] = [];
afterAll(() => {
  for (const root of fixtureRoots) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** Copy the generator's inputs + targets into a fresh temp root. */
function makeFixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'yellow-generate-'));
  fixtureRoots.push(root);
  cpSync(join(REPO_ROOT, 'catalog'), join(root, 'catalog'), { recursive: true });
  cpSync(join(REPO_ROOT, '.claude-plugin'), join(root, '.claude-plugin'), {
    recursive: true,
  });
  const plugins = readdirSync(join(REPO_ROOT, 'plugins'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  for (const name of plugins) {
    mkdirSync(join(root, 'plugins', name, '.claude-plugin'), { recursive: true });
    cpSync(
      join(REPO_ROOT, 'plugins', name, 'package.json'),
      join(root, 'plugins', name, 'package.json')
    );
    cpSync(
      join(REPO_ROOT, 'plugins', name, '.claude-plugin', 'plugin.json'),
      join(root, 'plugins', name, '.claude-plugin', 'plugin.json')
    );
  }
  return root;
}

function targetPaths(root: string): string[] {
  const plugins = readdirSync(join(root, 'plugins'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  return [
    join(root, '.claude-plugin', 'marketplace.json'),
    ...plugins.map((n) => join(root, 'plugins', n, '.claude-plugin', 'plugin.json')),
  ];
}

function readAllTargets(root: string): Record<string, string> {
  const bytes: Record<string, string> = {};
  for (const path of targetPaths(root)) {
    bytes[path] = readFileSync(path, 'utf8');
  }
  return bytes;
}

interface CliRun {
  status: number;
  stdout: string;
  stderr: string;
}

function runCli(root: string, args: string[]): CliRun {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], {
      env: { ...process.env, GENERATE_MANIFESTS_ROOT: root },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

describe('byte-identity and determinism', () => {
  it('generated output matches committed bytes for marketplace + all plugin manifests', () => {
    const result = generateManifests({ mode: 'check' });
    expect(result.status).toBe('ok');
    expect(result.diffs).toEqual([]);
    expect(result.checked).toBe(TARGET_COUNT);
  });

  it('two consecutive apply runs are byte-equal and the second writes nothing', () => {
    const root = makeFixtureRoot();
    const first = generateManifests({ mode: 'apply', rootDir: root });
    expect(first.status).toBe('ok');
    const afterFirst = readAllTargets(root);

    const second = generateManifests({ mode: 'apply', rootDir: root });
    expect(second.status).toBe('ok');
    expect(second.written).toEqual([]);
    expect(readAllTargets(root)).toEqual(afterFirst);
  });
});

describe('inventory and order cross-checks (explicit names, both directions)', () => {
  it('a catalog-order entry with no source file fails by name', () => {
    const root = makeFixtureRoot();
    rmSync(join(root, 'catalog', 'plugins', 'yellow-core.json'));
    const result = generateManifests({ mode: 'check', rootDir: root });
    expect(result.status).toBe('error');
    expect(result.errors).toContain(
      'pluginOrder entry "yellow-core" has no catalog/plugins/yellow-core.json source file'
    );
  });

  it('a source file missing from the catalog order fails by name', () => {
    const root = makeFixtureRoot();
    cpSync(
      join(root, 'catalog', 'plugins', 'yellow-core.json'),
      join(root, 'catalog', 'plugins', 'extra-plugin.json')
    );
    const result = generateManifests({ mode: 'check', rootDir: root });
    expect(result.status).toBe('error');
    expect(result.errors).toContain(
      'catalog/plugins/extra-plugin.json is not listed in catalog.json pluginOrder'
    );
  });
});

describe('catalog source safety', () => {
  it('rejects a malicious plugin name in the catalog order (path traversal)', () => {
    const root = makeFixtureRoot();
    const catalogPath = join(root, 'catalog', 'catalog.json');
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
    catalog.pluginOrder.push('../../../etc/passwd');
    writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n', 'utf8');

    const result = generateManifests({ mode: 'check', rootDir: root });
    expect(result.status).toBe('error');
    expect(
      result.errors.some((e: string) => e.includes('fails the [a-zA-Z0-9_-] allowlist'))
    ).toBe(true);
  });

  it('rejects a symlinked source file', () => {
    const root = makeFixtureRoot();
    const target = join(root, 'catalog', 'plugins', 'yellow-core.json');
    renameSync(target, join(root, 'yellow-core-real.json'));
    symlinkSync(join(root, 'yellow-core-real.json'), target);

    const result = generateManifests({ mode: 'check', rootDir: root });
    expect(result.status).toBe('error');
    expect(
      result.errors.some((e: string) =>
        e.includes('symlinked source files are not allowed')
      )
    ).toBe(true);
  });

  it('reports malformed source JSON as a clean structured error', () => {
    const root = makeFixtureRoot();
    writeFileSync(
      join(root, 'catalog', 'plugins', 'yellow-core.json'),
      '{ not json',
      'utf8'
    );
    const result = generateManifests({ mode: 'check', rootDir: root });
    expect(result.status).toBe('error');
    expect(
      result.errors.some((e: string) => e.startsWith('catalog/plugins/yellow-core.json:'))
    ).toBe(true);
  });
});

describe('--check stale-artifact detection (subprocess)', () => {
  it('exits nonzero while ANY diff remains, and performs zero writes', () => {
    const root = makeFixtureRoot();
    const pluginTarget = join(root, 'plugins', 'yellow-core', '.claude-plugin', 'plugin.json');
    const marketplaceTarget = join(root, '.claude-plugin', 'marketplace.json');
    const pluginBytes = readFileSync(pluginTarget, 'utf8');
    const marketplaceBytes = readFileSync(marketplaceTarget, 'utf8');

    // Two distinct mutations at once.
    writeFileSync(pluginTarget, pluginBytes.replace('"MIT"', '"Apache-2.0"'), 'utf8');
    writeFileSync(marketplaceTarget, marketplaceBytes + '\n', 'utf8');

    const before: Record<string, { bytes: string; mtimeMs: number }> = {};
    for (const path of targetPaths(root)) {
      before[path] = {
        bytes: readFileSync(path, 'utf8'),
        mtimeMs: statSync(path).mtimeMs,
      };
    }

    const bothDirty = runCli(root, ['--check']);
    expect(bothDirty.status).toBe(1);
    expect(bothDirty.stdout).toContain('plugins/yellow-core/.claude-plugin/plugin.json');
    expect(bothDirty.stdout).toContain('.claude-plugin/marketplace.json');

    // Zero writes: bytes AND mtimes untouched by --check.
    for (const path of targetPaths(root)) {
      expect(readFileSync(path, 'utf8')).toBe(before[path].bytes);
      expect(statSync(path).mtimeMs).toBe(before[path].mtimeMs);
    }

    // Fix ONE of the two diffs — --check must still fail while the other
    // remains (any-diff-remains semantics, not diffs-stopped-changing).
    writeFileSync(pluginTarget, pluginBytes, 'utf8');
    const oneDirty = runCli(root, ['--check']);
    expect(oneDirty.status).toBe(1);
    expect(oneDirty.stdout).toContain('.claude-plugin/marketplace.json');

    // Fix the last diff — clean pass.
    writeFileSync(marketplaceTarget, marketplaceBytes, 'utf8');
    const clean = runCli(root, ['--check']);
    expect(clean.status).toBe(0);
    expect(clean.stdout).toContain(`All ${TARGET_COUNT} generated files match`);
  });

  it('reports a missing target as drift', () => {
    const root = makeFixtureRoot();
    rmSync(join(root, 'plugins', 'yellow-docs', '.claude-plugin', 'plugin.json'));
    const result = runCli(root, ['--check']);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('plugins/yellow-docs/.claude-plugin/plugin.json (missing)');
  });
});

describe('--dry-run (subprocess)', () => {
  it('prints the same diff report as --check but exits 0', () => {
    const root = makeFixtureRoot();
    const target = join(root, 'plugins', 'yellow-core', '.claude-plugin', 'plugin.json');
    writeFileSync(target, readFileSync(target, 'utf8') + '\n', 'utf8');

    const result = runCli(root, ['--dry-run']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      'DRIFT: plugins/yellow-core/.claude-plugin/plugin.json (differs)'
    );
  });

  it('rejects unknown arguments and conflicting modes', () => {
    const root = makeFixtureRoot();
    expect(runCli(root, ['--bogus']).status).toBe(1);
    expect(runCli(root, ['--check', '--dry-run']).status).toBe(1);
  });
});
