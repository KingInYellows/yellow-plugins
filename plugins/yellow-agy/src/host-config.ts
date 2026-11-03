/**
 * The invocation `setup` resolves once and records in the data dir
 * (contract-v0 "Host bridge"): which host agy runs on, and where worktrees
 * and the plan schema go in that host's filesystem. On the bridge the
 * worktree root is resolved with realpath inside WSL, so a symlink into
 * /mnt is caught here rather than trusted.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { AgyError } from './errors';
import type { Host } from './invocation';
import { assertWslPath } from './invocation';

export interface HostConfig {
  readonly version: 1;
  readonly host: Host;
  readonly worktreeRoot: string;
  readonly schemaPath: string;
  /** Never true in v0: --sandbox is unverified on every host. */
  readonly sandboxVerified: false;
}

const FILE = 'host.json';
const DISTRO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export type Which = (cmd: string) => boolean;

function defaultWhich(cmd: string): boolean {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  try {
    execFileSync(probe, [cmd], { stdio: 'ignore', windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/** Runs one exec-only command in WSL and returns its trimmed stdout. */
export type WslRun = (distro: string | undefined, args: string[]) => string;

function defaultWslRun(distro: string | undefined, args: string[]): string {
  const argv =
    distro === undefined ? ['-e', ...args] : ['-d', distro, '-e', ...args];
  return execFileSync('wsl.exe', argv, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60_000,
  })
    .replace(/\r/g, '')
    .trim();
}

export interface DetectOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
  readonly which?: Which;
  readonly wslRun?: WslRun;
}

/** Works out the host and makes its worktree root (0700 where it can). */
export function detectHost(options: DetectOptions = {}): HostConfig {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const which = options.which ?? defaultWhich;
  const set = (name: string): string | undefined => {
    const v = env[name];
    return v === undefined || v === '' ? undefined : v;
  };
  if (platform !== 'win32') {
    if (!which('agy')) {
      throw new AgyError('AGY_NOT_INSTALLED', 'agy is not on PATH');
    }
    const base =
      set('XDG_DATA_HOME') ?? path.join(os.homedir(), '.local', 'share');
    const root = path.join(base, 'yellow-agy', 'worktrees');
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    const real = fs.realpathSync(root);
    // mkdir's mode doesn't tighten a root that already existed.
    fs.chmodSync(real, 0o700);
    return {
      version: 1,
      host: { kind: 'posix' },
      worktreeRoot: real,
      schemaPath: path.join(path.dirname(real), 'plan.schema.json'),
      sandboxVerified: false,
    };
  }
  // buildInvocation spawns agy.exe on this host; a bare `agy` shim isn't it.
  if (which('agy.exe')) {
    const base =
      set('LOCALAPPDATA') ?? path.join(os.homedir(), 'AppData', 'Local');
    const root = path.join(base, 'yellow-agy', 'worktrees');
    fs.mkdirSync(root, { recursive: true });
    const real = fs.realpathSync(root);
    return {
      version: 1,
      host: { kind: 'windows-native' },
      worktreeRoot: real,
      schemaPath: path.join(path.dirname(real), 'plan.schema.json'),
      sandboxVerified: false,
    };
  }
  if (!which('wsl.exe')) {
    throw new AgyError(
      'AGY_NOT_INSTALLED',
      'agy is not on PATH and wsl.exe is not available'
    );
  }
  const distro = set('YELLOW_AGY_WSL_DISTRO');
  if (distro !== undefined && !DISTRO_RE.test(distro)) {
    throw new AgyError(
      'AGY_BRIDGE',
      `YELLOW_AGY_WSL_DISTRO is not a distro name: ${JSON.stringify(distro)}`
    );
  }
  const run = options.wslRun ?? defaultWslRun;
  let real: string;
  try {
    if (run(distro, ['sh', '-c', 'command -v agy']) === '') {
      throw new Error('no agy');
    }
    // A fixed script; nothing from the caller is interpolated into it.
    real = run(distro, [
      'sh',
      '-c',
      'd="$HOME/.local/share/yellow-agy/worktrees" && mkdir -p -m 700 "$d" && chmod 700 "$d" && realpath -e -- "$d"',
    ]);
  } catch {
    throw new AgyError(
      'AGY_BRIDGE',
      `agy or its worktree root could not be reached in ${distro ?? 'the default WSL distro'}`
    );
  }
  assertWslPath(real, 'the WSL worktree root');
  return {
    version: 1,
    host:
      distro === undefined
        ? { kind: 'wsl-bridge' }
        : { kind: 'wsl-bridge', distro },
    worktreeRoot: real,
    schemaPath: path.posix.join(path.posix.dirname(real), 'plan.schema.json'),
    sandboxVerified: false,
  };
}

function isHost(v: unknown): v is Host {
  if (v === null || typeof v !== 'object') return false;
  const h = v as Record<string, unknown>;
  if (h['kind'] === 'posix' || h['kind'] === 'windows-native') return true;
  return (
    h['kind'] === 'wsl-bridge' &&
    (h['distro'] === undefined ||
      (typeof h['distro'] === 'string' && DISTRO_RE.test(h['distro'])))
  );
}

export function writeHostConfig(dataDir: string, config: HostConfig): void {
  const file = path.join(dataDir, FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
  fs.renameSync(tmp, file);
}

/** The recorded host; refuses until setup has recorded one. */
export function readHostConfig(dataDir: string): HostConfig {
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(path.join(dataDir, FILE), 'utf8'));
  } catch {
    throw new AgyError(
      'AGY_NOT_INSTALLED',
      'no host is recorded yet',
      'Run /agy:setup first.'
    );
  }
  const c = value as Partial<HostConfig> | null;
  if (
    c === null ||
    typeof c !== 'object' ||
    c.version !== 1 ||
    !isHost(c.host) ||
    typeof c.worktreeRoot !== 'string' ||
    typeof c.schemaPath !== 'string'
  ) {
    throw new AgyError(
      'AGY_INTERNAL',
      `${path.join(dataDir, FILE)} has an unknown format`,
      'Run /agy:setup again.'
    );
  }
  if (c.host.kind === 'wsl-bridge') {
    assertWslPath(c.worktreeRoot, 'the recorded worktree root');
    assertWslPath(c.schemaPath, 'the recorded schema path');
  }
  return {
    version: 1,
    host: c.host,
    worktreeRoot: c.worktreeRoot,
    schemaPath: c.schemaPath,
    sandboxVerified: false,
  };
}
