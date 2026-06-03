/**
 * Integration test for scripts/smoke-plugin-install.sh.
 *
 * Exercises only the claude-CLI-free code paths — argument parsing, marketplace
 * inventory parsing (--dry-run), usage errors, and the soft/hard skip behavior
 * when the `claude` CLI is absent. The install tiers themselves require the
 * Claude Code CLI and are intentionally NOT exercised here (that is what
 * `pnpm smoke:install` does locally against a live CLI).
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

const SCRIPT = resolve(__dirname, '..', '..', 'scripts', 'smoke-plugin-install.sh');

// Derive the expected inventory from the same manifest the script parses, so a
// legitimate plugin add/remove cannot break this test on an unrelated change.
const MARKETPLACE = JSON.parse(
  readFileSync(
    resolve(__dirname, '..', '..', '.claude-plugin', 'marketplace.json'),
    'utf8'
  )
) as { name: string; plugins: Array<{ name: string }> };

// Force the absent-CLI path deterministically by pointing CLAUDE_BIN at a
// nonexistent binary (independent of PATH / whether claude is installed).
const NO_CLAUDE = '/nonexistent/claude-smoke-test-bin';

interface Run {
  status: number;
  out: string;
}

function run(args: string[], env?: NodeJS.ProcessEnv): Run {
  try {
    const stdout = execFileSync('bash', [SCRIPT, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, out: stdout };
  } catch (err) {
    const e = err as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe('smoke-plugin-install.sh (claude-free paths)', () => {
  it('--help prints usage and exits 0', () => {
    const r = run(['--help']);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/Usage:/);
    expect(r.out).toMatch(/--dry-run/);
    expect(r.out).toMatch(/Exit codes:/);
  });

  it('--dry-run parses the marketplace inventory', () => {
    const r = run(['--dry-run']);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(new RegExp(`marketplace\\s*:\\s*${MARKETPLACE.name}`));
    expect(r.out).toMatch(new RegExp(`plugins\\s*:\\s*${MARKETPLACE.plugins.length}`));
    expect(r.out).toMatch(/- yellow-core/);
    expect(r.out).toMatch(/- yellow-codex/);
    // dry-run must not invoke claude or create temp dirs.
    expect(r.out).toMatch(/no claude invocation/);
  });

  it('--dry-run --plugin yellow-codex narrows to a single plugin', () => {
    const r = run(['--dry-run', '--plugin', 'yellow-codex']);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/plugins\s*:\s*1/);
    expect(r.out).toMatch(/- yellow-codex/);
    expect(r.out).not.toMatch(/- yellow-core\b/);
  });

  it('rejects an unknown --plugin with exit 2', () => {
    const r = run(['--plugin', 'definitely-not-a-plugin']);
    expect(r.status).toBe(2);
    expect(r.out).toMatch(/not in/);
  });

  it('rejects an unknown flag with exit 2', () => {
    const r = run(['--frobnicate']);
    expect(r.status).toBe(2);
    expect(r.out).toMatch(/usage error/);
  });

  it('rejects an out-of-range --tier with exit 2', () => {
    const r = run(['--tier', '9']);
    expect(r.status).toBe(2);
    expect(r.out).toMatch(/--tier must be 0 or 1/);
  });

  it('soft-skips (exit 0) when claude CLI is absent', () => {
    const r = run(['--tier', '0'], { CLAUDE_BIN: NO_CLAUDE });
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/claude CLI not found/);
  });

  it('hard-skips (exit 2) when claude CLI is absent and --ci is set', () => {
    const r = run(['--tier', '0', '--ci'], { CLAUDE_BIN: NO_CLAUDE });
    expect(r.status).toBe(2);
    expect(r.out).toMatch(/hard skip/);
  });
});
