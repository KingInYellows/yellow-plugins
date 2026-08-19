/**
 * Deterministic fixture tests for the stacked-PR tooling-readiness probe.
 *
 * Fake `gt`/`gh` executables live in
 * `fixtures/stack-tooling-probe/bin/{gt,gh}` and branch entirely on env
 * vars, so one pair of fixtures covers every scenario below without a real
 * network call or a real Graphite/GitHub CLI installation.
 */

import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const probe = require('../../plugins/yellow-core/lib/stack-tooling-probe.js');

const { READINESS, OFFICIAL_EXTENSION, parseExtensionIdentity, probeGraphite, probeGithub, probeRepositoryStackAvailability } =
  probe;

const FIXTURE_BIN = join(__dirname, 'fixtures', 'stack-tooling-probe', 'bin');
const LIB = join(__dirname, '..', '..', 'plugins', 'yellow-core', 'lib', 'stack-tooling-probe.js');
// A genuinely empty directory for the "tool absent from PATH" scenarios.
// Falling back to the real (inherited) PATH would be non-deterministic:
// GitHub Actions runners ship a real `gh` preinstalled, so a test that
// reverted to the host PATH could pass or fail depending on the runner
// rather than on the code under test.
const EMPTY_BIN = mkdtempSync(join(tmpdir(), 'stack-tooling-probe-empty-bin-'));

const ENV_KEYS = [
  'FAKE_GT_VERSION_EXIT',
  'FAKE_GH_VERSION',
  'FAKE_GH_AUTH_EXIT',
  'FAKE_GH_EXT_EXIT',
  'FAKE_GH_EXT_OUTPUT',
  'FAKE_GH_STACK_VIEW_EXIT',
];

let originalPath: string | undefined;
const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  originalPath = process.env.PATH;
  // Fixture bin dir FIRST so the fakes shadow any real gt/gh on this
  // machine — this suite must be deterministic on every workstation and CI
  // runner regardless of what is actually installed.
  process.env.PATH = `${FIXTURE_BIN}:${originalPath}`;
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  process.env.PATH = originalPath;
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalEnv[key];
    }
  }
});

afterAll(() => {
  rmSync(EMPTY_BIN, { recursive: true, force: true });
});

describe('probeGraphite', () => {
  it('reports ready when gt is present and --version succeeds', () => {
    const result = probeGraphite();
    expect(result.readiness).toBe(READINESS.READY);
    expect(result.checks.present).toBe(true);
  });

  it('reports not-ready when gt is missing from PATH', () => {
    process.env.PATH = EMPTY_BIN;
    const result = probeGraphite();
    expect(result.readiness).toBe(READINESS.NOT_READY);
    expect(result.checks.present).toBe(false);
  });

  it('reports unknown when gt --version exits non-zero', () => {
    process.env.FAKE_GT_VERSION_EXIT = '3';
    const result = probeGraphite();
    expect(result.readiness).toBe(READINESS.UNKNOWN);
    expect(result.checks.present).toBe(true);
  });
});

describe('parseExtensionIdentity', () => {
  it('verifies the official github/gh-stack repo column', () => {
    expect(
      parseExtensionIdentity('NAME       REPO             VERSION\ngh-stack   github/gh-stack  v0.1.0\n')
    ).toBe('verified');
  });

  it('flags a same-named third-party extension as wrong-owner, not missing', () => {
    expect(
      parseExtensionIdentity('NAME       REPO                  VERSION\ngh-stack   boneskull/gh-stack    v1.0.0\n')
    ).toBe('wrong-owner');
  });

  it('reports missing when no stack-named extension is installed at all', () => {
    expect(
      parseExtensionIdentity('NAME     REPO                VERSION\ngh-foo   someone/gh-foo      v1.0.0\n')
    ).toBe('missing');
  });

  it('reports missing on empty output', () => {
    expect(parseExtensionIdentity('')).toBe('missing');
  });
});

describe('probeGithub — READY requires auth AND verified extension identity together', () => {
  it('is ready only when auth is valid and the extension is verified', () => {
    process.env.FAKE_GH_AUTH_EXIT = '0';
    process.env.FAKE_GH_EXT_OUTPUT = `NAME       REPO             VERSION\\ngh-stack   ${OFFICIAL_EXTENSION}  v0.1.0\\n`;
    const result = probeGithub();
    expect(result.readiness).toBe(READINESS.READY);
    expect(result.checks.authValid).toBe(true);
    expect(result.checks.extensionIdentity).toBe('verified');
  });

  it('READY_GITHUB is impossible when auth is invalid, even with the extension verified', () => {
    process.env.FAKE_GH_AUTH_EXIT = '1';
    process.env.FAKE_GH_EXT_OUTPUT = `NAME       REPO             VERSION\\ngh-stack   ${OFFICIAL_EXTENSION}  v0.1.0\\n`;
    const result = probeGithub();
    expect(result.readiness).toBe(READINESS.NOT_READY);
    expect(result.checks.authValid).toBe(false);
    expect(result.detail).toContain('authentication');
  });

  it('not-ready when auth is valid but the extension is missing', () => {
    process.env.FAKE_GH_AUTH_EXIT = '0';
    process.env.FAKE_GH_EXT_OUTPUT = '';
    const result = probeGithub();
    expect(result.readiness).toBe(READINESS.NOT_READY);
    expect(result.checks.extensionIdentity).toBe('missing');
  });

  it('not-ready (not a silent fallback to ready) when a third-party gh-stack lookalike is installed', () => {
    process.env.FAKE_GH_AUTH_EXIT = '0';
    process.env.FAKE_GH_EXT_OUTPUT = 'NAME       REPO                    VERSION\\ngh-stack   VladimirAnaniev/gh-stack v2.0.0\\n';
    const result = probeGithub();
    expect(result.readiness).toBe(READINESS.NOT_READY);
    expect(result.checks.extensionIdentity).toBe('wrong-owner');
  });

  it('unknown, not not-ready, when gh extension list itself fails to run', () => {
    process.env.FAKE_GH_AUTH_EXIT = '0';
    process.env.FAKE_GH_EXT_EXIT = '1';
    const result = probeGithub();
    expect(result.readiness).toBe(READINESS.UNKNOWN);
    expect(result.checks.extensionIdentity).toBe('unavailable');
  });

  it('not-ready when gh is entirely absent from PATH', () => {
    process.env.PATH = EMPTY_BIN;
    const result = probeGithub();
    expect(result.readiness).toBe(READINESS.NOT_READY);
    expect(result.checks.present).toBe(false);
  });
});

describe('probeRepositoryStackAvailability', () => {
  it('available: true on exit 0', () => {
    process.env.FAKE_GH_STACK_VIEW_EXIT = '0';
    expect(probeRepositoryStackAvailability()).toEqual({
      available: true,
      detail: '`gh stack view --json` succeeded.',
    });
  });

  it('available: false on exit 9 (ErrStacksUnavailable)', () => {
    process.env.FAKE_GH_STACK_VIEW_EXIT = '9';
    const result = probeRepositoryStackAvailability();
    expect(result.available).toBe(false);
    expect(result.detail).toContain('exit 9');
  });

  it('available: true on exit 2 (ErrNotInStack — feature works, branch just is not in a stack)', () => {
    process.env.FAKE_GH_STACK_VIEW_EXIT = '2';
    const result = probeRepositoryStackAvailability();
    expect(result.available).toBe(true);
    expect(result.detail).toContain('exit 2');
  });

  it('available: null on an unrecognized exit code', () => {
    process.env.FAKE_GH_STACK_VIEW_EXIT = '4';
    const result = probeRepositoryStackAvailability();
    expect(result.available).toBeNull();
  });
});

describe('CLI: probe subcommand', () => {
  it('emits both providers by default and respects --provider', () => {
    process.env.FAKE_GH_AUTH_EXIT = '0';
    process.env.FAKE_GH_EXT_OUTPUT = `NAME       REPO             VERSION\\ngh-stack   ${OFFICIAL_EXTENSION}  v0.1.0\\n`;
    const both = JSON.parse(
      execFileSync(process.execPath, [LIB, 'probe'], { encoding: 'utf8', env: process.env })
    );
    expect(both.graphite.readiness).toBe(READINESS.READY);
    expect(both.github.readiness).toBe(READINESS.READY);

    const githubOnly = JSON.parse(
      execFileSync(process.execPath, [LIB, 'probe', '--provider', 'github'], {
        encoding: 'utf8',
        env: process.env,
      })
    );
    expect(githubOnly.graphite).toBeUndefined();
    expect(githubOnly.github.readiness).toBe(READINESS.READY);
  });

  it('rejects an unknown --provider value with a non-zero exit and no JSON', () => {
    expect(() =>
      execFileSync(process.execPath, [LIB, 'probe', '--provider', 'bitbucket'], {
        encoding: 'utf8',
        env: process.env,
      })
    ).toThrow();
  });

  it('--check-repo only runs the repository probe when the extension is verified', () => {
    process.env.FAKE_GH_AUTH_EXIT = '0';
    process.env.FAKE_GH_EXT_OUTPUT = `NAME       REPO             VERSION\\ngh-stack   ${OFFICIAL_EXTENSION}  v0.1.0\\n`;
    process.env.FAKE_GH_STACK_VIEW_EXIT = '9';
    const withVerified = JSON.parse(
      execFileSync(process.execPath, [LIB, 'probe', '--provider', 'github', '--check-repo'], {
        encoding: 'utf8',
        env: process.env,
      })
    );
    expect(withVerified.github.repository).toEqual({
      available: false,
      detail: 'Stacked PRs are not enabled for this repository (exit 9).',
    });

    process.env.FAKE_GH_EXT_OUTPUT = '';
    const withoutVerified = JSON.parse(
      execFileSync(process.execPath, [LIB, 'probe', '--provider', 'github', '--check-repo'], {
        encoding: 'utf8',
        env: process.env,
      })
    );
    expect(withoutVerified.github.repository).toBeUndefined();
  });
});
