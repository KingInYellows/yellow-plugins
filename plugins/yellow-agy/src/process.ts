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

const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const DEFAULT_GRACE_MS = 10_000;

export interface RunOptions {
  /** Wall-clock limit for the whole process, in ms. */
  readonly deadlineMs: number;
  /** Time between SIGTERM and SIGKILL. */
  readonly graceMs?: number;
  /** Aborting it cancels the run (owner cancel). */
  readonly signal?: AbortSignal;
  /** Called with the child pid as soon as it exists, for the active-run claim. */
  readonly onSpawn?: (pid: number) => void;
}

export function runTurn(
  inv: Invocation,
  options: RunOptions
): Promise<TurnOutcome> {
  if (!Number.isFinite(options.deadlineMs) || options.deadlineMs <= 0) {
    return Promise.reject(
      new AgyError('AGY_INTERNAL', 'deadlineMs must be a positive number')
    );
  }
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
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

    const kill = (sig: NodeJS.Signals): void => {
      if (child.pid === undefined || child.exitCode !== null) return;
      try {
        if (groupKill) process.kill(-child.pid, sig);
        else child.kill(sig);
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
    child.stderr?.on('data', collect(err));

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
      if (child.pid !== undefined) options.onSpawn?.(child.pid);
    });
    child.on('close', (code, signal) => {
      cleanup();
      // Leave nothing behind in the group once the leader is gone.
      if (groupKill && child.pid !== undefined) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          // group already empty
        }
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
    });
  });
}
