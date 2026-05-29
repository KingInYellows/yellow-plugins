/**
 * Integration test for `scripts/check-upstream-pins.js`.
 *
 * Verifies the four CLI-hardening fixes landed for issue #267:
 *   1. `--threshold` with no following value → exit 1, stderr names the flag.
 *   2. `--threshold abc` (non-numeric value) → exit 1, stderr explains.
 *   3. `--verbose` surfaces the underlying npm failure reason on lookup
 *      failure (instead of swallowing it via the bare `catch {}`).
 *   4. Uppercase npm package names are rejected by `NPM_NAME_OK` before
 *      reaching `getNpmLatest` (previously `/i` flag let them through, then
 *      they surfaced as "npm lookup failed" — misclassified input).
 *
 * Test parameterization: `CHECK_UPSTREAM_PINS_ROOT` overrides the project
 * root the script scans, so each test builds a minimal `plugins/<name>/`
 * tree under tmp without touching the real repo.
 *
 * Cases 1-2 do not invoke npm — argv validation happens before the scan
 * loop. Cases 3-4 spawn the full scan but provide a fixture pin whose
 * registry response is deterministic (case 4) or guaranteed to fail
 * lookup (case 3).
 */

import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
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
  'check-upstream-pins.js'
);

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function run(rootDir: string, args: string[] = []): RunResult {
  // spawnSync (not execFileSync) — execFileSync returns stdout-only on
  // success and discards stderr, which masks the --verbose case where
  // the script exits 0 but writes diagnostic lines to stderr.
  const r = spawnSync('node', [SCRIPT, ...args], {
    env: { ...process.env, CHECK_UPSTREAM_PINS_ROOT: rootDir },
    encoding: 'utf8',
    // Generous timeout — the --verbose case invokes npm view, which
    // can be slow on a cold cache. Cases 1-2 return before any
    // subprocess spawn.
    timeout: 30000,
  });
  return {
    status: r.status ?? 1,
    stdout: r.stdout?.toString() ?? '',
    stderr: r.stderr?.toString() ?? '',
  };
}

function write(rootDir: string, relPath: string, body: string): void {
  const full = join(rootDir, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body, 'utf8');
}

function seedMinimalPlugin(
  rootDir: string,
  pluginName: string,
  manifest: Record<string, unknown>
): void {
  write(
    rootDir,
    `plugins/${pluginName}/.claude-plugin/plugin.json`,
    JSON.stringify(manifest, null, 2)
  );
}

describe('check-upstream-pins.js — CLI hardening (#267)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'check-upstream-pins-'));
    // Seed at least one plugin so the script does not exit early on an
    // empty plugins/ directory. Cases 1-2 never reach the scan loop.
    seedMinimalPlugin(tmp, 'test-plugin', {
      name: 'test-plugin',
      version: '0.0.1',
    });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('--threshold with no value exits 1 and names the flag', () => {
    const result = run(tmp, ['--threshold']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--threshold requires a numeric argument');
  });

  it('--threshold with a non-numeric value exits 1 and reports the bad value', () => {
    const result = run(tmp, ['--threshold', 'abc']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--threshold must be numeric');
    expect(result.stderr).toContain('abc');
  });

  it('--verbose surfaces npm lookup failure reasons', () => {
    // Pin a package name that does not exist on the npm registry. The
    // NPM_NAME_OK regex still passes (lowercase, valid chars), so the
    // call reaches getNpmLatest and the registry returns 404. The
    // --verbose flag should print npm's error message to stderr.
    seedMinimalPlugin(tmp, 'verbose-plugin', {
      name: 'verbose-plugin',
      version: '0.0.1',
      mcpServers: {
        bogus: {
          command: 'npx',
          args: [
            '-y',
            'this-package-does-not-exist-on-npm-registry-yellow-plugins-test@1.0.0',
          ],
        },
      },
    });
    const result = run(tmp, ['--verbose']);
    // The script exits 0 even when lookups fail (no drift detected
    // means no threshold trip). Stdout should report the lookup failed,
    // and stderr should — under --verbose — include the npm error reason.
    expect(result.stdout).toContain('npm lookup failed');
    expect(result.stderr).toContain('npm view');
    // Assert the ACTUAL npm registry error detail surfaces, not just the
    // script's own prefix. This guards the regression where stderr was
    // discarded (stdio 'ignore') / suppressed (--silent) and only a generic
    // "Command failed" reached --verbose output.
    expect(result.stderr).toMatch(/404|E404|not found/i);
  });

  it('uppercase package names are rejected by NPM_NAME_OK before getNpmLatest runs', () => {
    // Plant an uppercase pin via the package.json scan path (mcpServers
    // args produce a different regex match). package.json deps are
    // filtered by NPM_NAME_OK before reaching getNpmLatest.
    seedMinimalPlugin(tmp, 'uppercase-plugin', {
      name: 'uppercase-plugin',
      version: '0.0.1',
    });
    write(
      tmp,
      'plugins/uppercase-plugin/package.json',
      JSON.stringify(
        {
          name: 'uppercase-plugin',
          version: '0.0.1',
          dependencies: { 'Express': '4.0.0' }, // capital E — npm rejects
        },
        null,
        2
      )
    );
    const result = run(tmp);
    // The uppercase name should not appear in the report at all — it is
    // filtered out at NPM_NAME_OK before the report.push, not after.
    expect(result.stdout).not.toContain('Express@4.0.0');
    // Sanity: the scan still ran (exit 0, total-pins line present).
    expect(result.stdout).toContain('Total npm pins');
  });
});
