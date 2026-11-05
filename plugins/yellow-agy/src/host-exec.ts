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

import type { Budget } from './budget';
import { AgyError } from './errors';
import type { Host } from './invocation';
import {
  assertWslPath,
  BRIDGE_GROUP_SCRIPT,
  BRIDGE_UNSET_VARS,
  bridgeKillCommand,
  filterDriverNames,
  hookConfig,
  scrubEnv,
} from './invocation';
import { splitPgidMarker } from './process';

export interface ExecResult {
  readonly code: number | null;
  readonly stdout: string;
  /** stdout as raw bytes, for patches (text files need not be UTF-8). */
  readonly stdoutBytes: Buffer;
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
  /**
   * Runs git with every filter driver the repo at `options.cwd` defines
   * turned off (discovered fresh on each call).
   */
  git(args: readonly string[], options: ExecOptions): Promise<ExecResult>;
  /** The filter driver names the repo at `cwd` defines, for agy turns. */
  filterDrivers(cwd: string): Promise<string[]>;
  writeFile(filePath: string, content: string): Promise<void>;
  removeFile(filePath: string): Promise<void>;
  /**
   * Gives back the time held for a turn that will not run now, so rollback
   * after a failed pre-turn step is not starved by it.
   */
  releaseTurnReserve?(): void;
}

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const ENV_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;

export interface SpawnSpec {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd: string | undefined;
  readonly env: Readonly<Record<string, string>>;
  /**
   * Set on the bridge: the command leads its own Linux process group and
   * prints its pgid first on stderr, the same way a bridge turn does, so a
   * timeout can kill that group (killing wsl.exe alone leaves git running).
   */
  readonly linuxGroup?: { readonly distro?: string };
}

/** Runs the group kill and resolves when it has finished (or failed). */
export type GroupKill = (
  file: string,
  args: readonly string[]
) => Promise<void>;

/** How long to wait for `wsl.exe … kill` before rejecting anyway. */
const GROUP_KILL_WAIT_MS = 10_000;

function defaultGroupKill(
  file: string,
  args: readonly string[]
): Promise<void> {
  return new Promise((resolve) => {
    const k = spawn(file, [...args], { stdio: 'ignore', windowsHide: true });
    const timer = setTimeout(() => {
      k.kill('SIGKILL');
      resolve();
    }, GROUP_KILL_WAIT_MS);
    const done = (): void => {
      clearTimeout(timer);
      resolve();
    };
    k.on('error', done);
    k.on('close', done);
  });
}

/** Pure: how `cmd args` is spawned on `host`, with git hooks off. */
export function hostCommand(
  host: Host,
  cmd: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly env?: Readonly<Record<string, string>>;
    /** Filter drivers to turn off; [] only for non-git commands or discovery. */
    readonly filterDrivers: readonly string[];
  },
  baseEnv: Readonly<Record<string, string | undefined>>
): SpawnSpec {
  const extra = options.env ?? {};
  for (const key of Object.keys(extra)) {
    // GIT_CONFIG_* carries the hook and filter overrides; no caller may touch it.
    if (!ENV_NAME_RE.test(key) || key.startsWith('GIT_CONFIG')) {
      throw new AgyError(
        'AGY_INTERNAL',
        `invalid env name ${JSON.stringify(key)}`
      );
    }
  }
  const nullDevice = host.kind === 'windows-native' ? 'NUL' : '/dev/null';
  const hooks = hookConfig(nullDevice, options.filterDrivers);
  if (host.kind !== 'wsl-bridge') {
    return {
      file: cmd,
      args: [...args],
      cwd: options.cwd,
      env: { ...scrubEnv(baseEnv), ...extra, ...hooks },
    };
  }
  assertWslPath(options.cwd, 'a bridge command directory');
  const wslArgs: string[] = [];
  if (host.distro !== undefined) wslArgs.push('-d', host.distro);
  wslArgs.push('--cd', options.cwd, '-e', 'env');
  for (const name of BRIDGE_UNSET_VARS) wslArgs.push('-u', name);
  for (const [key, value] of Object.entries({ ...extra, ...hooks })) {
    wslArgs.push(`${key}=${value}`);
  }
  // setsid makes the shell (then cmd, via exec) lead a new Linux group.
  wslArgs.push('setsid', '-w', 'sh', '-c', BRIDGE_GROUP_SCRIPT, 'sh');
  wslArgs.push(cmd, ...args);
  return {
    file: 'wsl.exe',
    args: wslArgs,
    cwd: undefined,
    env: scrubEnv(baseEnv),
    linuxGroup: host.distro === undefined ? {} : { distro: host.distro },
  };
}

export function runSpawn(
  spec: SpawnSpec,
  stdin: string | undefined,
  timeoutMs: number,
  // AGY_BUDGET when the budget cut the timeout: the command did not fail,
  // it ran out of time, so callers must not read the result as an answer.
  timeoutCode: 'AGY_INTERNAL' | 'AGY_BUDGET' = 'AGY_INTERNAL',
  groupKill: GroupKill = defaultGroupKill
): Promise<ExecResult> {
  // Own process group on POSIX, so a timeout also reaches what git started
  // (a credential helper, ssh).
  const group = process.platform !== 'win32';
  return new Promise((resolve, reject) => {
    const child = spawn(spec.file, [...spec.args], {
      cwd: spec.cwd,
      env: spec.env,
      stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      detached: group,
      windowsHide: true,
    });
    let closed = false;
    const bridge = spec.linuxGroup;
    let linuxPgid: number | undefined;
    let markerPending = bridge !== undefined;
    // On the bridge, the Linux group dies first and we wait for that before
    // rejecting, so nothing is still running when the caller moves on.
    let linuxKilled: Promise<void> = Promise.resolve();
    const killLinux = (): void => {
      if (bridge === undefined || linuxPgid === undefined) return;
      const cmd = bridgeKillCommand(bridge.distro, linuxPgid, 'KILL');
      linuxPgid = undefined;
      linuxKilled = groupKill(cmd.file, cmd.args).catch(() => undefined);
    };
    const killAll = (): void => {
      killLinux();
      if (child.pid === undefined || closed) return;
      try {
        if (group) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        // already gone
      }
    };
    // A child that exits before reading stdin must not crash the host.
    child.stdin?.on('error', () => undefined);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let size = 0;
    const collect = (sink: Buffer[]) => (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) {
        killAll();
        return;
      }
      sink.push(chunk);
    };
    child.stdout?.on('data', collect(out));
    const collectErr = collect(err);
    child.stderr?.on('data', (chunk: Buffer) => {
      collectErr(chunk);
      if (!markerPending) return;
      const split = splitPgidMarker(Buffer.concat(err));
      if (split === undefined) return;
      markerPending = false;
      linuxPgid = split.pgid;
      err.length = 0;
      if (split.rest.length > 0) err.push(split.rest);
      // A timeout that fired before the pgid arrived reaches the group now.
      if (timedOut || size > MAX_OUTPUT_BYTES) killLinux();
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killAll();
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      // A clean exit leaves no group to kill: `setsid -w` waited for it.
      if (timedOut || size > MAX_OUTPUT_BYTES) killAll();
      else if (bridge === undefined) killAll();
      closed = true;
      if (timedOut) {
        void linuxKilled.then(() =>
          reject(
            new AgyError(
              timeoutCode,
              `${spec.file} did not finish within ${timeoutMs} ms`
            )
          )
        );
        return;
      }
      if (size > MAX_OUTPUT_BYTES) {
        void linuxKilled.then(() =>
          reject(
            new AgyError(
              'AGY_INTERNAL',
              `${spec.file} printed more than ${MAX_OUTPUT_BYTES} bytes`
            )
          )
        );
        return;
      }
      const stdoutBytes = Buffer.concat(out);
      resolve({
        code,
        stdout: stdoutBytes.toString('utf8'),
        stdoutBytes,
        stderr: Buffer.concat(err).toString('utf8'),
      });
    });
    if (stdin !== undefined) child.stdin?.end(stdin);
  });
}

/** The real HostExec for `host`. */
export function createHostExec(
  host: Host,
  baseEnv: Readonly<Record<string, string | undefined>> = process.env,
  budget?: Budget,
  groupKill: GroupKill = defaultGroupKill
): HostExec {
  // Every host command (git, filter discovery, mkdir, tee, rm) is cut to
  // what is left of the call's budget, so slow git cannot outlive the
  // wrapper's Bash timeout.
  const run = async (
    cmd: string,
    args: readonly string[],
    options: ExecOptions,
    filterDrivers: readonly string[] = []
  ): Promise<ExecResult> => {
    const wanted = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timeoutMs =
      budget === undefined ? wanted : budget.hostTimeoutMs(wanted);
    return runSpawn(
      hostCommand(host, cmd, args, { ...options, filterDrivers }, baseEnv),
      options.stdin,
      timeoutMs,
      timeoutMs < wanted ? 'AGY_BUDGET' : 'AGY_INTERNAL',
      groupKill
    );
  };
  // Reading config runs no filter, so discovery itself needs none turned off.
  const discover = async (cwd: string): Promise<string[]> => {
    const res = await run(
      'git',
      ['config', '--name-only', '--get-regexp', '^filter\\.'],
      { cwd }
    );
    // Exit 1 with no output means no filter.* key is set.
    if (res.code === 1 && res.stdout === '') return [];
    if (res.code !== 0) {
      throw new AgyError(
        'AGY_WORKTREE',
        `reading the repository's git filter config failed: ${res.stderr.trim() || `exit ${res.code}`}`
      );
    }
    return filterDriverNames(res.stdout);
  };
  return {
    host,
    releaseTurnReserve: () => {
      if (budget !== undefined) budget.reserveMs = 0;
    },
    async git(args, options) {
      return run('git', args, options, await discover(options.cwd));
    },
    filterDrivers: discover,
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
      const res = await run('rm', ['-f', '--', filePath], { cwd: '/' });
      if (res.code !== 0)
        throw new AgyError(
          'AGY_BRIDGE',
          `removing ${filePath} in WSL failed: ${res.stderr.trim()}`
        );
    },
  };
}
