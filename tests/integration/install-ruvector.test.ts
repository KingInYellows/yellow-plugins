/**
 * Integration test for `plugins/yellow-ruvector/lib/install-ruvector.sh`.
 *
 * Covers the pieces that differ from yellow-morph's install lib:
 *   1. Path validation (traversal, clean path, ROOT unset, DATA outside
 *      HOME/tmp) — same guard as morph.
 *   2. Data-dir fallback to ${XDG_DATA_HOME:-$HOME/.local/share}/yellow-ruvector
 *      when CLAUDE_PLUGIN_DATA is unset.
 *   3. needs_install keyed on the lockfile hash via the `current` symlink.
 *   4. swap_current + prune keep only the current and previous install dirs.
 *   5. install_in_progress only for a live lock owner.
 *   6. model_cached reads ruvector's disk cache layout.
 *
 * No test runs `npm ci`; install dirs are faked on disk.
 */

import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const LIB = resolve(
  __dirname,
  '..',
  '..',
  'plugins',
  'yellow-ruvector',
  'lib',
  'install-ruvector.sh'
);

interface BashResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runBash(
  script: string,
  env: Record<string, string | undefined>
): BashResult {
  const filteredEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined) filteredEnv[k] = v;
  }
  try {
    const stdout = execFileSync('bash', ['-c', `. "${LIB}" && ${script}`], {
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

function lockHash(root: string, home: string): string {
  return runBash('yellow_ruvector_lock_hash', {
    HOME: home,
    PATH: process.env.PATH,
    CLAUDE_PLUGIN_ROOT: root,
  }).stdout.trim();
}

function fakeInstall(data: string, name: string): void {
  const bin = join(data, name, 'node_modules', 'ruvector', 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'cli.js'), '// fake\n');
}

describe('yellow-ruvector install lib', () => {
  let home: string;
  let root: string;
  let data: string;
  let env: Record<string, string | undefined>;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'yellow-ruvector-home-'));
    root = join(home, 'plugin');
    data = join(home, 'data');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'package.json'), '{"name":"x"}\n');
    writeFileSync(join(root, 'package-lock.json'), '{"lockfileVersion":3}\n');
    env = {
      HOME: home,
      PATH: process.env.PATH,
      CLAUDE_PLUGIN_ROOT: root,
      CLAUDE_PLUGIN_DATA: data,
    };
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  describe('validate_paths', () => {
    it('accepts HOME-rooted root and data dirs', () => {
      const r = runBash('yellow_ruvector_validate_paths', env);
      expect(r.status).toBe(0);
    });

    it('rejects when CLAUDE_PLUGIN_ROOT is unset', () => {
      const r = runBash('yellow_ruvector_validate_paths', {
        ...env,
        CLAUDE_PLUGIN_ROOT: undefined,
      });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('CLAUDE_PLUGIN_ROOT unset');
    });

    it('rejects a data dir outside HOME/tmp', () => {
      const r = runBash('yellow_ruvector_validate_paths', {
        ...env,
        CLAUDE_PLUGIN_DATA: '/etc/yellow-ruvector',
      });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('outside HOME/tmp');
    });

    it('rejects `..` traversal once canonicalized (GNU realpath hosts)', () => {
      const hasGnuRealpath = (() => {
        try {
          execFileSync('realpath', ['-m', '--', '/tmp'], { stdio: 'ignore' });
          return true;
        } catch {
          return false;
        }
      })();
      const depth = home.split('/').filter(Boolean).length;
      const r = runBash('yellow_ruvector_validate_paths', {
        ...env,
        CLAUDE_PLUGIN_DATA: `${home}/${'../'.repeat(depth)}etc`,
      });
      if (hasGnuRealpath) {
        expect(r.status).not.toBe(0);
        expect(r.stderr).toContain('outside HOME/tmp');
      }
    });
  });

  it('rejects `..` components when realpath -m is unavailable (BSD/macOS)', () => {
    const bin = join(home, 'fakebin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'realpath'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const r = runBash('yellow_ruvector_validate_paths', {
      ...env,
      PATH: `${bin}:${process.env.PATH}`,
      CLAUDE_PLUGIN_DATA: `${home}/../../etc/yellow-ruvector`,
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('. or .. component');
  });

  describe('data dir fallback', () => {
    it('uses XDG_DATA_HOME when CLAUDE_PLUGIN_DATA is unset', () => {
      const xdg = join(home, 'xdg');
      const r = runBash(
        'yellow_ruvector_data_dir; printf "%s|%s" "$RUVECTOR_DATA" "$RUVECTOR_DATA_FALLBACK"',
        { ...env, CLAUDE_PLUGIN_DATA: undefined, XDG_DATA_HOME: xdg }
      );
      expect(r.stdout).toBe(`${xdg}/yellow-ruvector|1`);
    });

    it('falls back to ~/.local/share without XDG_DATA_HOME', () => {
      const r = runBash(
        'yellow_ruvector_data_dir; printf "%s|%s" "$RUVECTOR_DATA" "$RUVECTOR_DATA_FALLBACK"',
        { ...env, CLAUDE_PLUGIN_DATA: undefined }
      );
      expect(r.stdout).toBe(`${home}/.local/share/yellow-ruvector|1`);
    });

    it('prefers CLAUDE_PLUGIN_DATA when set', () => {
      const r = runBash(
        'yellow_ruvector_data_dir; printf "%s|%s" "$RUVECTOR_DATA" "$RUVECTOR_DATA_FALLBACK"',
        env
      );
      expect(r.stdout).toBe(`${data}|0`);
    });
  });

  describe('needs_install', () => {
    it('needs install when nothing is installed', () => {
      const r = runBash(
        'yellow_ruvector_data_dir; yellow_ruvector_needs_install',
        env
      );
      expect(r.status).toBe(0);
    });

    it('is in sync when current points at install-<lockhash>', () => {
      const hash = lockHash(root, home);
      expect(hash).toMatch(/^[0-9a-f]{12}$/);
      fakeInstall(data, `install-${hash}`);
      symlinkSync(`install-${hash}`, join(data, 'current'));
      const r = runBash(
        'yellow_ruvector_data_dir; yellow_ruvector_needs_install',
        env
      );
      expect(r.status).not.toBe(0);
    });

    it('needs install after the lockfile changes', () => {
      const oldHash = lockHash(root, home);
      fakeInstall(data, `install-${oldHash}`);
      symlinkSync(`install-${oldHash}`, join(data, 'current'));
      writeFileSync(
        join(root, 'package-lock.json'),
        '{"lockfileVersion":3,"x":1}\n'
      );
      const r = runBash(
        'yellow_ruvector_data_dir; yellow_ruvector_needs_install',
        env
      );
      expect(r.status).toBe(0);
    });
  });

  describe('swap_current and prune', () => {
    it('swaps current and keeps only the current and previous installs', () => {
      for (const n of ['install-aaa', 'install-bbb', 'install-ccc']) {
        fakeInstall(data, n);
      }
      mkdirSync(join(data, '.install-ddd.tmp.123'));
      symlinkSync('install-bbb', join(data, 'current'));
      const r = runBash(
        'yellow_ruvector_data_dir; yellow_ruvector_swap_current install-ccc && yellow_ruvector_prune install-ccc install-bbb',
        env
      );
      expect(r.status).toBe(0);
      expect(readlinkSync(join(data, 'current'))).toBe('install-ccc');
      expect(existsSync(join(data, 'install-ccc'))).toBe(true);
      expect(existsSync(join(data, 'install-bbb'))).toBe(true);
      expect(existsSync(join(data, 'install-aaa'))).toBe(false);
      expect(existsSync(join(data, '.install-ddd.tmp.123'))).toBe(false);
    });
  });

  describe('rollback to an install dir that still exists', () => {
    it('reuses it without npm ci and without deleting its files', () => {
      const hash = lockHash(root, home);
      fakeInstall(data, `install-${hash}`);
      writeFileSync(join(data, `install-${hash}`, 'marker'), 'live');
      fakeInstall(data, 'install-newer');
      symlinkSync('install-newer', join(data, 'current'));
      const bin = join(home, 'nonpm');
      mkdirSync(bin, { recursive: true });
      writeFileSync(join(bin, 'npm'), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
      const r = runBash('yellow_ruvector_data_dir; yellow_ruvector_do_install', {
        ...env,
        PATH: `${bin}:${process.env.PATH}`,
      });
      expect(r.status).toBe(0);
      expect(readlinkSync(join(data, 'current'))).toBe(`install-${hash}`);
      expect(existsSync(join(data, `install-${hash}`, 'marker'))).toBe(true);
    });
  });

  describe('prune keeps installs a live process still uses', () => {
    it('skips an install dir named on a running command line', async () => {
      for (const n of ['install-aaa', 'install-bbb', 'install-ccc']) {
        fakeInstall(data, n);
      }
      const holder = spawn(
        'sh',
        ['-c', 'sleep 30', join(data, 'install-aaa', 'node_modules', 'x.js')],
        { stdio: 'ignore' }
      );
      try {
        await new Promise((r) => setTimeout(r, 200));
        const r = runBash(
          'yellow_ruvector_data_dir; yellow_ruvector_prune install-ccc install-bbb',
          env
        );
        expect(r.status).toBe(0);
        expect(existsSync(join(data, 'install-aaa'))).toBe(true);
      } finally {
        holder.kill('SIGKILL');
      }
    });
  });

  describe('install lock', () => {
    it('reports an install in progress only for a live owner', () => {
      mkdirSync(join(data, '.install.lock'), { recursive: true });
      writeFileSync(join(data, '.install.lock', 'pid'), String(process.pid));
      expect(
        runBash(
          'yellow_ruvector_data_dir; yellow_ruvector_install_in_progress',
          env
        ).status
      ).toBe(0);
      writeFileSync(join(data, '.install.lock', 'pid'), '999999999');
      expect(
        runBash(
          'yellow_ruvector_data_dir; yellow_ruvector_install_in_progress',
          env
        ).status
      ).not.toBe(0);
    });

    it('recovers a stale lock and acquires it', () => {
      mkdirSync(join(data, '.install.lock'), { recursive: true });
      writeFileSync(join(data, '.install.lock', 'pid'), '999999999');
      const r = runBash(
        'yellow_ruvector_data_dir; yellow_ruvector_acquire_install_lock 2 && yellow_ruvector_release_install_lock',
        env
      );
      expect(r.status).toBe(0);
      expect(existsSync(join(data, '.install.lock'))).toBe(false);
    });
  });

  describe('model_cached', () => {
    it('is true only when model.onnx and tokenizer.json are non-empty', () => {
      const dir = join(home, '.ruvector', 'models', 'all-MiniLM-L6-v2');
      expect(runBash('yellow_ruvector_model_cached', env).status).not.toBe(0);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'model.onnx'), 'x');
      expect(runBash('yellow_ruvector_model_cached', env).status).not.toBe(0);
      writeFileSync(join(dir, 'tokenizer.json'), '{}');
      expect(runBash('yellow_ruvector_model_cached', env).status).toBe(0);
    });

    it('honors RUVECTOR_CACHE_DIR', () => {
      const cache = join(home, 'cache');
      const dir = join(cache, '.ruvector', 'models', 'all-MiniLM-L6-v2');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'model.onnx'), 'x');
      writeFileSync(join(dir, 'tokenizer.json'), '{}');
      expect(
        runBash('yellow_ruvector_model_cached', {
          ...env,
          RUVECTOR_CACHE_DIR: cache,
        }).status
      ).toBe(0);
    });
  });
});
