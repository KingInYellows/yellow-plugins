/**
 * Behavior suite for `scripts/sync-manifests.js` after its writes were
 * delegated to `generateManifests()` (PR #644 refactor). The script is
 * top-level code with no exports, so it is driven as a subprocess against a
 * temp fixture tree via the shared `GENERATE_MANIFESTS_ROOT` env hook,
 * following the `generate-manifests.test.ts` pattern.
 */

import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, it, expect, afterAll } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'sync-manifests.js');

const fixtureRoots: string[] = [];
afterAll(() => {
  for (const root of fixtureRoots) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeFixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'yellow-sync-'));
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

function bumpVersion(root: string, plugin: string, version: string): void {
  const pkgPath = join(root, 'plugins', plugin, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.version = version;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
}

function runSync(root: string, args: string[] = []): { status: number; stdout: string } {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], {
      env: { ...process.env, GENERATE_MANIFESTS_ROOT: root },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout };
  } catch (err) {
    const e = err as { status: number; stdout?: string };
    return { status: e.status, stdout: e.stdout ?? '' };
  }
}

describe('sync-manifests apply path (delegated to generateManifests)', () => {
  it('a version bump regenerates plugin.json and marketplace.json with the new version', () => {
    const root = makeFixtureRoot();
    bumpVersion(root, 'yellow-docs', '9.9.9');

    const result = runSync(root);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Synced yellow-docs plugin.json:');
    expect(result.stdout).toContain('Synced marketplace.json yellow-docs:');
    expect(result.stdout).toContain('1 plugin.json synced, 1 marketplace entries synced');

    const manifest = JSON.parse(
      readFileSync(join(root, 'plugins', 'yellow-docs', '.claude-plugin', 'plugin.json'), 'utf8')
    );
    expect(manifest.version).toBe('9.9.9');
    const marketplace = JSON.parse(
      readFileSync(join(root, '.claude-plugin', 'marketplace.json'), 'utf8')
    );
    const entry = marketplace.plugins.find((p: { name: string }) => p.name === 'yellow-docs');
    expect(entry.version).toBe('9.9.9');
  });

  it('--dry-run reports drift without writing', () => {
    const root = makeFixtureRoot();
    bumpVersion(root, 'yellow-docs', '9.9.9');
    const manifestPath = join(root, 'plugins', 'yellow-docs', '.claude-plugin', 'plugin.json');
    const before = readFileSync(manifestPath, 'utf8');

    const result = runSync(root, ['--dry-run']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('[DRY RUN] Would sync yellow-docs plugin.json:');
    expect(result.stdout).toContain('Dry run complete');
    expect(readFileSync(manifestPath, 'utf8')).toBe(before);
  });

  it('a clean tree syncs nothing and writes nothing', () => {
    const root = makeFixtureRoot();
    const marketplacePath = join(root, '.claude-plugin', 'marketplace.json');
    const before = readFileSync(marketplacePath, 'utf8');

    const result = runSync(root);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('0 plugin.json synced, 0 marketplace entries synced');
    expect(readFileSync(marketplacePath, 'utf8')).toBe(before);
  });
});
