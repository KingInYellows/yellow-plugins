/**
 * Runs one agy turn as a child process and reports a TurnOutcome for
 * classify.ts. stdin is closed, the child gets its own process group on
 * POSIX so a deadline or cancel reaches agy's tools too, and a deadline sends
 * SIGTERM first (agy then reports "interrupted" with partial text) and
 * SIGKILL after a grace period.
 */

import { spawn } from 'node:child_process';

import type { TurnOutcome } from './classify';
import { AgyError } from './errors';
import type { Invocation } from './invocation';
import { BRIDGE_PGID_MARKER, bridgeKillCommand } from './invocation';

const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const DEFAULT_GRACE_MS = 10_000;
const MAX_TIMER_MS = 2_147_483_647;

export interface RunOptions {
  /** Wall-clock limit for the whole process, in ms. */
  readonly deadlineMs: number;
  /** Time between SIGTERM and SIGKILL. */
  readonly graceMs?: number;
  /** Aborting it cancels the run (owner cancel). */
  readonly signal?: AbortSignal;
  /**
   * Called with the child pid as soon as it exists, to make the active-run
   * claim durable. A rejection stops the turn and the run rejects with it.
   */
  readonly onSpawn?: (pid: number) => Promise<void> | void;
  /** Spawns a bridge group kill; tests replace it. */
  readonly spawnKill?: (file: string, args: readonly string[]) => void;
}

function defaultSpawnKill(file: string, args: readonly string[]): void {
  const k = spawn(file, [...args], { stdio: 'ignore', windowsHide: true });
  k.on('error', () => undefined);
}

/**
 * Splits the bridge's leading pgid line off `stderr`. Returns undefined
 * until a full first line has arrived.
 */
export function splitPgidMarker(
  stderr: Buffer
): { pgid: number | undefined; rest: Buffer } | undefined {
  const nl = stderr.indexOf(0x0a);
  if (nl < 0) return undefined;
  const line = stderr.subarray(0, nl).toString('utf8');
  if (!line.startsWith(BRIDGE_PGID_MARKER)) {
    return { pgid: undefined, rest: stderr };
  }
  const pgid = Number(line.slice(BRIDGE_PGID_MARKER.length));
  return {
    pgid: Number.isInteger(pgid) && pgid > 1 ? pgid : undefined,
    rest: stderr.subarray(nl + 1),
  };
}

export function runTurn(
  inv: Invocation,
  options: RunOptions
): Promise<TurnOutcome> {
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
  // Node clamps a delay outside 1..2^31-1 ms to 1 ms, which would kill the
  // turn at once.
  const validDelay = (ms: number): boolean =>
    Number.isFinite(ms) && ms >= 1 && ms <= MAX_TIMER_MS;
  if (!validDelay(options.deadlineMs) || !validDelay(graceMs)) {
    return Promise.reject(
      new AgyError(
        'AGY_INTERNAL',
        `deadlineMs and graceMs must be between 1 and ${MAX_TIMER_MS} ms`
      )
    );
  }
  const groupKill = process.platform !== 'win32';
  return new Promise((resolve, reject) => {
    const child = spawn(inv.file, [...inv.args], {
      cwd: inv.cwd,
      env: inv.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: groupKill,
      windowsHide: true,
    });
    let killedByDeadline = false;
    let cancelled = false;
    let overflow = false;
    let size = 0;
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let graceTimer: NodeJS.Timeout | undefined;
    let drainTimer: NodeJS.Timeout | undefined;
    let closed = false;
    let spawnError: unknown;
    let spawnDone: Promise<void> = Promise.resolve();
    const bridge = inv.linuxGroup;
    let linuxPgid: number | undefined;
    let markerPending = bridge !== undefined;
    const spawnKill = options.spawnKill ?? defaultSpawnKill;
    const killLinux = (sig: NodeJS.Signals): void => {
      if (bridge === undefined || linuxPgid === undefined) return;
      const cmd = bridgeKillCommand(
        bridge.distro,
        linuxPgid,
        sig === 'SIGKILL' ? 'KILL' : 'TERM'
      );
      try {
        spawnKill(cmd.file, cmd.args);
      } catch {
        // best effort; wsl.exe is killed below too
      }
    };

    // After the leader exits, a tool it started can still hold the pipes open,
    // so on POSIX the group stays killable until 'close'. The group id can't be
    // reused while any member is alive.
    const kill = (sig: NodeJS.Signals): void => {
      if (child.pid === undefined || closed) return;
      killLinux(sig);
      if (!groupKill && child.exitCode !== null) return;
      try {
        if (groupKill) process.kill(-child.pid, sig);
        else {
          // Windows has no groups: taskkill /T takes the tree while the
          // leader still lives (the drain timer covers what outlives it).
          if (bridge === undefined) {
            spawnKill('taskkill', ['/PID', String(child.pid), '/T', '/F']);
          }
          child.kill(sig);
        }
      } catch {
        // already gone
      }
    };
    const stop = (): void => {
      kill('SIGTERM');
      graceTimer ??= setTimeout(() => kill('SIGKILL'), graceMs);
    };
    const collect = (sink: Buffer[]) => (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) {
        overflow = true;
        kill('SIGKILL');
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
      // A stop requested before the pgid arrived reaches the group now.
      if (killedByDeadline || cancelled) killLinux('SIGTERM');
    });

    const deadline = setTimeout(() => {
      killedByDeadline = true;
      stop();
    }, options.deadlineMs);
    const onAbort = (): void => {
      cancelled = true;
      stop();
    };
    if (options.signal?.aborted === true) onAbort();
    else options.signal?.addEventListener('abort', onAbort, { once: true });

    const cleanup = (): void => {
      clearTimeout(deadline);
      if (graceTimer !== undefined) clearTimeout(graceTimer);
      if (drainTimer !== undefined) clearTimeout(drainTimer);
      options.signal?.removeEventListener('abort', onAbort);
    };
    child.on('error', (e: NodeJS.ErrnoException) => {
      cleanup();
      reject(
        e.code === 'ENOENT'
          ? new AgyError('AGY_NOT_INSTALLED', `${inv.file} was not found`)
          : e
      );
    });
    child.on('spawn', () => {
      if (child.pid === undefined || options.onSpawn === undefined) return;
      spawnDone = Promise.resolve()
        .then(() => options.onSpawn?.(child.pid as number))
        .catch((e: unknown) => {
          spawnError = e;
          cancelled = true;
          stop();
        });
    });
    child.on('exit', () => {
      // agy is done; a tool still in its group would keep 'close' from firing.
      if (groupKill) kill('SIGKILL');
      killLinux('SIGKILL');
      // A descendant we could not kill (Windows) may still hold the pipes;
      // stop waiting for it so the turn always settles.
      drainTimer ??= setTimeout(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
      }, graceMs);
    });
    child.on('close', (code, signal) => {
      closed = true;
      cleanup();
      // Leave nothing behind in the group once the leader is gone.
      if (groupKill && child.pid !== undefined) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          // group already empty
        }
      }
      void spawnDone.then(() => finish(code, signal));
    });
    const finish = (
      code: number | null,
      signal: NodeJS.Signals | null
    ): void => {
      if (spawnError !== undefined) {
        reject(spawnError);
        return;
      }
      if (overflow) {
        reject(
          new AgyError(
            'AGY_INTERNAL',
            `agy printed more than ${MAX_OUTPUT_BYTES} bytes`
          )
        );
        return;
      }
      resolve({
        exitCode: code,
        signal,
        killedByDeadline,
        cancelled,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
      });
    };
  });
}
