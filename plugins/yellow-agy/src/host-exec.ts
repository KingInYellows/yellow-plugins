/**
 * Runs non-agy commands where agy runs: git in the worktree, and the two
 * file operations the bridge needs (writing the plan schema, removing a
 * temporary index). On the WSL bridge every command goes through the same
 * exec-only `wsl.exe [-d <distro>] --cd <dir> -e env K=V <cmd> …` form as agy,
 * so no distro shell parses an argument. agy turns themselves go through
 * invocation.ts and process.ts; this module never starts agy.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { AgyError } from './errors';
import type { Host } from './invocation';
import { BRIDGE_UNSET_VARS, scrubEnv } from './invocation';

export interface ExecResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ExecOptions {
  readonly cwd: string;
  /** Extra variables for this command only (set inside WSL on the bridge). */
  readonly env?: Readonly<Record<string, string>>;
  readonly stdin?: string;
  readonly timeoutMs?: number;
}

/** The port the lifecycle uses; tests swap in a host-local implementation. */
export interface HostExec {
  readonly host: Host;
  git(args: readonly string[], options: ExecOptions): Promise<ExecResult>;
  writeFile(filePath: string, content: string): Promise<void>;
  removeFile(filePath: string): Promise<void>;
}

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const ENV_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;

export interface SpawnSpec {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd: string | undefined;
  readonly env: Readonly<Record<string, string>>;
}

/** Pure: how `cmd args` is spawned on `host`, with git hooks off. */
export function hostCommand(
  host: Host,
  cmd: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly env?: Readonly<Record<string, string>>;
  },
  baseEnv: Readonly<Record<string, string | undefined>>
): SpawnSpec {
  const extra = options.env ?? {};
  for (const key of Object.keys(extra)) {
    if (!ENV_NAME_RE.test(key)) {
      throw new AgyError(
        'AGY_INTERNAL',
        `invalid env name ${JSON.stringify(key)}`
      );
    }
  }
  const nullDevice = host.kind === 'windows-native' ? 'NUL' : '/dev/null';
  const hooks = {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: nullDevice,
  };
  if (host.kind !== 'wsl-bridge') {
    return {
      file: cmd,
      args: [...args],
      cwd: options.cwd,
      env: { ...scrubEnv(baseEnv), ...hooks, ...extra },
    };
  }
  if (!options.cwd.startsWith('/') || options.cwd.startsWith('/mnt/')) {
    throw new AgyError(
      'AGY_BRIDGE',
      `bridge commands must run inside the WSL filesystem, not ${JSON.stringify(options.cwd)}`
    );
  }
  const wslArgs: string[] = [];
  if (host.distro !== undefined) wslArgs.push('-d', host.distro);
  wslArgs.push('--cd', options.cwd, '-e', 'env');
  for (const name of BRIDGE_UNSET_VARS) wslArgs.push('-u', name);
  for (const [key, value] of Object.entries({ ...hooks, ...extra })) {
    wslArgs.push(`${key}=${value}`);
  }
  wslArgs.push(cmd, ...args);
  return {
    file: 'wsl.exe',
    args: wslArgs,
    cwd: undefined,
    env: scrubEnv(baseEnv),
  };
}

export function runSpawn(
  spec: SpawnSpec,
  stdin: string | undefined,
  timeoutMs: number
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(spec.file, [...spec.args], {
      cwd: spec.cwd,
      env: spec.env,
      stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let size = 0;
    const collect = (sink: Buffer[]) => (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) {
        child.kill('SIGKILL');
        return;
      }
      sink.push(chunk);
    };
    child.stdout?.on('data', collect(out));
    child.stderr?.on('data', collect(err));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (size > MAX_OUTPUT_BYTES) {
        reject(
          new AgyError(
            'AGY_INTERNAL',
            `${spec.file} printed more than ${MAX_OUTPUT_BYTES} bytes`
          )
        );
        return;
      }
      resolve({
        code,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
      });
    });
    if (stdin !== undefined) child.stdin?.end(stdin);
  });
}

/** The real HostExec for `host`. */
export function createHostExec(
  host: Host,
  baseEnv: Readonly<Record<string, string | undefined>> = process.env
): HostExec {
  const run = (
    cmd: string,
    args: readonly string[],
    options: ExecOptions
  ): Promise<ExecResult> =>
    runSpawn(
      hostCommand(host, cmd, args, options, baseEnv),
      options.stdin,
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    );
  return {
    host,
    git: (args, options) => run('git', args, options),
    async writeFile(filePath, content) {
      if (host.kind !== 'wsl-bridge') {
        fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
        fs.writeFileSync(filePath, content, { mode: 0o600 });
        return;
      }
      const dir = path.posix.dirname(filePath);
      const mk = await run('mkdir', ['-p', '-m', '700', '--', dir], {
        cwd: '/',
      });
      if (mk.code !== 0)
        throw new AgyError(
          'AGY_BRIDGE',
          `mkdir ${dir} failed in WSL: ${mk.stderr.trim()}`
        );
      // tee writes stdin to the file without a shell; its echo is discarded.
      const res = await run('tee', ['--', filePath], {
        cwd: '/',
        stdin: content,
      });
      if (res.code !== 0)
        throw new AgyError(
          'AGY_BRIDGE',
          `writing ${filePath} in WSL failed: ${res.stderr.trim()}`
        );
    },
    async removeFile(filePath) {
      if (host.kind !== 'wsl-bridge') {
        fs.rmSync(filePath, { force: true });
        return;
      }
      await run('rm', ['-f', '--', filePath], { cwd: '/' });
    },
  };
}
