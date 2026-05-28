/**
 * Integration test for `plugins/yellow-morph/lib/install-morphmcp.sh`'s
 * `yellow_morph_validate_paths` function.
 *
 * Verifies the path-canonicalization fix landed for issue #269:
 *   1. CLAUDE_PLUGIN_DATA with `..` traversal that resolves outside HOME
 *      is rejected (canonicalization closes the prefix-string-match gap).
 *   2. Clean HOME-rooted CLAUDE_PLUGIN_DATA passes.
 *   3. CLAUDE_PLUGIN_ROOT unset → returns non-zero, stderr names the var.
 *   4. CLAUDE_PLUGIN_DATA outside HOME/tmp → returns non-zero.
 *   5. realpath unavailable (PATH stripped of realpath) → function still
 *      runs and the clean-path case still passes (regression guard
 *      against an over-strict conditional that would break BSD-realpath
 *      hosts where the capability test fails silently).
 *
 * Pattern: each case spawns a fresh `bash -c "source $LIB; yellow_morph_validate_paths"`
 * with controlled env vars and inspects exit code + stderr.
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const LIB = resolve(
  __dirname,
  '..',
  '..',
  'plugins',
  'yellow-morph',
  'lib',
  'install-morphmcp.sh'
);

interface BashResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runBash(script: string, env: Record<string, string | undefined>): BashResult {
  // Filter undefined keys so the env passed to bash matches the test
  // intent (HOME unset vs HOME='' are different to the case-guard).
  const filteredEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined) filteredEnv[k] = v;
  }
  try {
    const stdout = execFileSync('bash', ['-c', script], {
      env: filteredEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status: number; stdout?: string; stderr?: string };
    return {
      status: e.status ?? 1,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
    };
  }
}

// Run yellow_morph_validate_paths in a subshell. The function returns
// non-zero on failure; capture the return via explicit `|| exit $?` so
// bash's exit code reflects the function, not the source.
const INVOKE = `. "${LIB}" && yellow_morph_validate_paths`;

describe('yellow_morph_validate_paths — path canonicalization (#269)', () => {
  let tmpHome: string;

  beforeEach(() => {
    // Each test gets a unique HOME under tmp. This lets the case-guard
    // `"$HOME/*"` match the canonicalized value without interfering with
    // the developer's actual home dir.
    tmpHome = mkdtempSync(join(tmpdir(), 'yellow-morph-home-'));
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it('CLAUDE_PLUGIN_DATA with `..` traversal is rejected after canonicalization', () => {
    // $HOME/../../etc → realpath -m resolves to /etc, which fails the
    // HOME/tmp prefix guard. Before the fix, the raw string matched
    // "$HOME/*" and passed.
    const traversal = `${tmpHome}/../../etc`;
    const result = runBash(INVOKE, {
      HOME: tmpHome,
      PATH: process.env.PATH,
      CLAUDE_PLUGIN_ROOT: tmpHome,
      CLAUDE_PLUGIN_DATA: traversal,
    });
    // On hosts with GNU realpath the canonicalization runs and the
    // prefix guard rejects. On hosts without it, the test is documenting
    // the pre-fix vulnerability (still informative), so we assert the
    // post-fix behaviour on the platforms that have realpath -m.
    const hasGnuRealpath = (() => {
      try {
        execFileSync('realpath', ['-m', '--', '/tmp'], { stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    })();
    if (hasGnuRealpath) {
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('outside HOME/tmp');
    } else {
      // Document the fail-open posture on BSD-realpath hosts; the case
      // guard still runs on the raw value and matches "$HOME/*", so the
      // current behaviour is unchanged.
      expect([0, 1]).toContain(result.status);
    }
  });

  it('clean HOME-rooted CLAUDE_PLUGIN_DATA passes', () => {
    const cleanData = `${tmpHome}/.claude/plugins/data/yellow-morph`;
    const result = runBash(INVOKE, {
      HOME: tmpHome,
      PATH: process.env.PATH,
      CLAUDE_PLUGIN_ROOT: tmpHome,
      CLAUDE_PLUGIN_DATA: cleanData,
    });
    expect(result.status).toBe(0);
  });

  it('CLAUDE_PLUGIN_ROOT unset returns non-zero and stderr names the var', () => {
    const result = runBash(INVOKE, {
      HOME: tmpHome,
      PATH: process.env.PATH,
      CLAUDE_PLUGIN_DATA: `${tmpHome}/data`,
      // CLAUDE_PLUGIN_ROOT deliberately omitted
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('CLAUDE_PLUGIN_ROOT unset');
  });

  it('CLAUDE_PLUGIN_DATA outside HOME/tmp is rejected', () => {
    const result = runBash(INVOKE, {
      HOME: tmpHome,
      PATH: process.env.PATH,
      CLAUDE_PLUGIN_ROOT: tmpHome,
      CLAUDE_PLUGIN_DATA: '/etc/passwd',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('outside HOME/tmp');
  });

  it('realpath unavailable → fallback still passes clean paths (regression guard)', () => {
    // Shadow `realpath` with a shim that always exits non-zero, mirroring
    // what happens on BSD-realpath hosts where `realpath -m` is rejected
    // as an unknown flag. Prepend the shim dir to PATH so the lib resolves
    // it before any system realpath. Keep the rest of PATH intact so
    // bash's builtin lookups (printf, etc. — bash builtins, but be
    // defensive) and any other coreutils calls still work.
    const shimDir = mkdtempSync(join(tmpdir(), 'realpath-shim-'));
    const shim = join(shimDir, 'realpath');
    writeFileSync(shim, '#!/bin/sh\nexit 1\n', 'utf8');
    chmodSync(shim, 0o755);
    try {
      const result = runBash(INVOKE, {
        HOME: tmpHome,
        PATH: `${shimDir}:${process.env.PATH}`,
        CLAUDE_PLUGIN_ROOT: tmpHome,
        CLAUDE_PLUGIN_DATA: `${tmpHome}/data`,
      });
      expect(result.status).toBe(0);
    } finally {
      rmSync(shimDir, { recursive: true, force: true });
    }
  });
});
