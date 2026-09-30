/**
 * Builds the CLI into a temp "plugin cache" with `tsc --outDir` (never
 * touching the committed dist/) and spawns it with the loopback preload.
 * `withWorkspaceSdk` symlinks the real node_modules in (the workspace
 * branch); without it the plugin root has no node_modules at all, as in an
 * installed Claude Code plugin cache, so the SDK can only come from the
 * data dir.
 */

import { execFile, execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';

export const PLUGIN_DIR = path.resolve(__dirname, '..', '..');
export const PRELOAD = path.join(__dirname, 'loopback-preload.cjs');

export interface BuiltPlugin {
  readonly root: string;
  readonly pluginRoot: string;
  readonly cli: string;
}

export function buildPlugin(options: {
  withWorkspaceSdk: boolean;
}): BuiltPlugin {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yellow-jules-cli-'));
  const pluginRoot = path.join(root, 'plugin');
  fs.mkdirSync(pluginRoot);
  const tsc = createRequire(path.join(PLUGIN_DIR, 'package.json')).resolve(
    'typescript/bin/tsc'
  );
  execFileSync(
    process.execPath,
    [
      tsc,
      '-p',
      path.join(PLUGIN_DIR, 'tsconfig.json'),
      '--outDir',
      path.join(pluginRoot, 'dist'),
    ],
    {
      stdio: 'pipe',
    }
  );
  fs.copyFileSync(
    path.join(PLUGIN_DIR, 'package.json'),
    path.join(pluginRoot, 'package.json')
  );
  fs.cpSync(
    path.join(PLUGIN_DIR, 'runtime'),
    path.join(pluginRoot, 'runtime'),
    { recursive: true }
  );
  if (options.withWorkspaceSdk) {
    fs.symlinkSync(
      path.join(PLUGIN_DIR, 'node_modules'),
      path.join(pluginRoot, 'node_modules')
    );
  }
  return { root, pluginRoot, cli: path.join(pluginRoot, 'dist', 'cli.js') };
}

export interface CliRun {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** The single stdout line, parsed. */
  readonly json: Record<string, unknown>;
  readonly stdoutLines: number;
}

export interface Isolation {
  readonly home: string;
  readonly dataDir: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}

/** HOME, XDG_*, TMPDIR, cwd, and the data dir all under one temp root, outside any git work tree. */
export function isolation(
  root: string,
  pathValue: string,
  extra: NodeJS.ProcessEnv = {}
): Isolation {
  const make = (name: string): string => {
    const dir = path.join(root, name);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
  };
  const home = make('home');
  const dataDir = path.join(root, 'data');
  const cwd = make('cwd');
  const env: NodeJS.ProcessEnv = {
    PATH: pathValue,
    HOME: home,
    XDG_DATA_HOME: make('xdg-data'),
    XDG_CONFIG_HOME: make('xdg-config'),
    XDG_CACHE_HOME: make('xdg-cache'),
    TMPDIR: make('tmp'),
    NODE_DISABLE_COMPILE_CACHE: '1',
    YELLOW_JULES_DATA_DIR: dataDir,
    JULES_API_KEY: 'dummy-jules-test-key',
    ...extra,
  };
  return { home, dataDir, cwd, env };
}

export function runCli(
  cli: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; cwd: string; timeoutMs?: number }
): Promise<CliRun> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['--require', PRELOAD, cli, ...args],
      {
        env: options.env,
        cwd: options.cwd,
        timeout: options.timeoutMs ?? 120_000,
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const code =
          error === null
            ? 0
            : typeof error.code === 'number'
              ? error.code
              : null;
        const lines = stdout.split('\n').filter((l) => l.length > 0);
        let json: Record<string, unknown> = {};
        try {
          json = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
        } catch {
          json = {};
        }
        resolve({ code, stdout, stderr, json, stdoutLines: lines.length });
      }
    );
  });
}
