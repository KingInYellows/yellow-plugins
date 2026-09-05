/**
 * Async fixed-authority process transport for Provider Protocol v1 probes
 * and runs. One child at a time; the caller owns a single AbortController
 * and one absolute deadline shared across every phase. This module only
 * mechanically spawns/kills/collects — protocol interpretation (JSON
 * shape, terminal agreement) lives in provider-protocol.ts and runtime.ts.
 */
import { spawn as spawnChild } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GoalEngineError } from './errors.js';

const SIGKILL_GRACE_MS = 5000;

export interface ProtocolChildResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
  readonly localCause?: 'caller-cancelled' | 'deadline';
  readonly forcedKill: boolean;
}

export interface ProtocolChildLimits {
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
}

export interface SpawnProtocolChildOptions {
  readonly bin: string;
  readonly argv: readonly string[];
  readonly cwd?: string;
  readonly env: NodeJS.ProcessEnv;
  /** Absolute epoch ms; this child's own cancellation race, not a fresh one. */
  readonly deadlineAt: number;
  readonly signal: AbortSignal;
  readonly limits: ProtocolChildLimits;
  /** When supplied, stdout chunks are streamed here and never buffered. */
  readonly onStdout?: (chunk: Buffer) => void;
}

function mapSpawnError(error: NodeJS.ErrnoException): GoalEngineError {
  switch (error.code) {
    case 'ENOENT':
      return new GoalEngineError(
        'GOAL_ENGINE_MISSING',
        `protocol engine binary not found (${error.message})`
      );
    case 'EACCES':
    case 'EPERM':
      return new GoalEngineError(
        'GOAL_ENGINE_UNRUNNABLE',
        `protocol engine binary could not be executed (${error.code})`
      );
    default:
      return new GoalEngineError(
        'GOAL_PROTOCOL_TRANSPORT',
        `protocol child spawn error: ${error.message}`
      );
  }
}

/**
 * Spawn one protocol child under one shared abort signal and one absolute
 * deadline. Cancellation (either the signal firing or the deadline
 * elapsing) is recorded as a local cause before SIGTERM; a child that
 * ignores SIGTERM for {@link SIGKILL_GRACE_MS} is escalated to SIGKILL.
 * The promise settles exactly once, on `close`, except for spawn/stream
 * errors and byte-bound overflow, which reject immediately after best-effort
 * SIGKILL. Every timer and listener is released at settlement.
 */
export function spawnProtocolChild(
  opts: SpawnProtocolChildOptions
): Promise<ProtocolChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawnChild(opts.bin, [...opts.argv], {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
    });

    let settled = false;
    let localCause: 'caller-cancelled' | 'deadline' | undefined;
    let forcedKill = false;
    let sigkillTimer: NodeJS.Timeout | undefined;
    let deadlineTimer: NodeJS.Timeout | undefined;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;

    const clearTimers = (): void => {
      if (sigkillTimer !== undefined) clearTimeout(sigkillTimer);
      if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
      sigkillTimer = undefined;
      deadlineTimer = undefined;
    };

    const removeListeners = (): void => {
      child.stdout?.removeAllListeners();
      child.stderr?.removeAllListeners();
      child.removeAllListeners();
      opts.signal.removeEventListener('abort', onAbort);
    };

    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimers();
      removeListeners();
      action();
    };

    function killSigkill(): void {
      forcedKill = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // Best effort: the process may already be gone.
      }
    }

    function beginCancellation(cause: 'caller-cancelled' | 'deadline'): void {
      if (localCause !== undefined) return;
      localCause = cause;
      try {
        child.kill('SIGTERM');
      } catch {
        // Best effort: the process may already be gone.
      }
      sigkillTimer = setTimeout(killSigkill, SIGKILL_GRACE_MS);
    }

    function onAbort(): void {
      beginCancellation('caller-cancelled');
    }

    opts.signal.addEventListener('abort', onAbort);
    if (opts.signal.aborted) onAbort();

    const remainingMs = opts.deadlineAt - Date.now();
    deadlineTimer = setTimeout(
      () => beginCancellation('deadline'),
      Math.max(0, remainingMs)
    );

    function hardFail(err: unknown): void {
      killSigkill();
      finish(() =>
        reject(
          err instanceof GoalEngineError
            ? err
            : new GoalEngineError('GOAL_PROTOCOL_TRANSPORT', String(err))
        )
      );
    }

    child.once('error', (error) => {
      finish(() => reject(mapSpawnError(error as NodeJS.ErrnoException)));
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      if (settled) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > opts.limits.maxStdoutBytes) {
        hardFail(
          new GoalEngineError(
            'GOAL_PROTOCOL_TRANSPORT',
            'stdout exceeded its byte bound'
          )
        );
        return;
      }
      if (opts.onStdout !== undefined) {
        try {
          opts.onStdout(chunk);
        } catch (err) {
          hardFail(err);
        }
      } else {
        stdoutChunks.push(chunk);
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (settled) return;
      stderrBytes += chunk.length;
      if (stderrBytes > opts.limits.maxStderrBytes) {
        hardFail(
          new GoalEngineError(
            'GOAL_PROTOCOL_TRANSPORT',
            'stderr exceeded its byte bound'
          )
        );
        return;
      }
      stderrChunks.push(chunk);
    });
    child.stdout?.once('error', (error: Error) => {
      hardFail(
        new GoalEngineError(
          'GOAL_PROTOCOL_TRANSPORT',
          `stdout stream error: ${error.message}`
        )
      );
    });
    child.stderr?.once('error', (error: Error) => {
      hardFail(
        new GoalEngineError(
          'GOAL_PROTOCOL_TRANSPORT',
          `stderr stream error: ${error.message}`
        )
      );
    });

    child.once('close', (code, signal) => {
      finish(() =>
        resolve({
          exitCode: code,
          signal,
          stdout: Buffer.concat(stdoutChunks),
          stderr: Buffer.concat(stderrChunks),
          ...(localCause !== undefined ? { localCause } : {}),
          forcedKill,
        })
      );
    });
  });
}

export interface ChildEnvInput {
  readonly sourceEnv: NodeJS.ProcessEnv;
  readonly scratchDir: string;
  /** Test-only injection seam (e.g. a NODE_OPTIONS preload); production
   *  callers never set this. */
  readonly childEnvOverride?: NodeJS.ProcessEnv;
}

/**
 * Allowlisted, credential-free child environment: PATH, LANG/LC_ALL when
 * present, and a disposable HOME/TMPDIR/XDG_CONFIG_HOME/XDG_CACHE_HOME under
 * `scratchDir`. Ambient provider credentials and NODE_OPTIONS are never
 * forwarded from `sourceEnv`.
 */
export function buildChildEnv(input: ChildEnvInput): NodeJS.ProcessEnv {
  const { sourceEnv, scratchDir, childEnvOverride } = input;
  const home = join(scratchDir, 'home');
  const tmp = join(scratchDir, 'tmp');
  mkdirSync(home, { recursive: true });
  mkdirSync(tmp, { recursive: true });

  const env: NodeJS.ProcessEnv = {
    PATH: sourceEnv['PATH'] ?? '',
    HOME: home,
    TMPDIR: tmp,
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_CACHE_HOME: join(home, '.cache'),
  };
  const lang = sourceEnv['LANG'];
  if (lang !== undefined) env['LANG'] = lang;
  const lcAll = sourceEnv['LC_ALL'];
  if (lcAll !== undefined) env['LC_ALL'] = lcAll;

  if (childEnvOverride !== undefined) {
    for (const [key, value] of Object.entries(childEnvOverride)) {
      if (value !== undefined) env[key] = value;
    }
  }
  return env;
}

/**
 * One scratch directory per operation (shared HOME/TMPDIR base across every
 * phase of a single `runStub` lifecycle). `GOAL_GEN_SCRATCH` lets tests pin
 * a directory they control instead of a fresh `mkdtemp`.
 */
export function createOperationScratchDir(env: NodeJS.ProcessEnv): string {
  const override = env['GOAL_GEN_SCRATCH'];
  if (typeof override === 'string' && override.length > 0) return override;
  return mkdtempSync(join(tmpdir(), 'yellow-goal-op-'));
}
