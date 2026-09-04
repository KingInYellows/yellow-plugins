/**
 * Process-boundary spawn. The engine is always a child process — never
 * imported. Args are an argv array (`shell` stays false).
 */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';

import { GoalEngineError } from './errors.js';

export interface SpawnResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type SpawnEngine = (args: readonly string[]) => SpawnResult;

export function resolveEngineBin(env: NodeJS.ProcessEnv): string {
  const override = env['GOAL_GEN_BIN'];
  if (typeof override === 'string' && override.length > 0) {
    return override;
  }
  return 'goal-gen';
}

function spawnError(
  error: NodeJS.ErrnoException,
  bin: string,
  timeoutMs: number
): GoalEngineError {
  switch (error.code) {
    case 'ETIMEDOUT':
      return new GoalEngineError(
        'GOAL_ENGINE_FAILED',
        `goal-gen timed out after ${timeoutMs}ms`
      );
    case 'ENOENT':
      return new GoalEngineError(
        'GOAL_ENGINE_MISSING',
        `goal-gen not found on PATH (looked up as ${bin})`
      );
    case 'EACCES':
    case 'EPERM':
      return new GoalEngineError(
        'GOAL_ENGINE_UNRUNNABLE',
        `goal-gen could not be executed (${error.code})`
      );
    default:
      return new GoalEngineError('GOAL_ENGINE_FAILED', error.message);
  }
}

function outputText(value: string | null | undefined): string {
  return value ?? '';
}

function completedSpawn(
  result: SpawnSyncReturns<string>,
  bin: string,
  timeoutMs: number
): SpawnResult {
  if (result.error) throw spawnError(result.error, bin, timeoutMs);
  if (result.signal !== null) {
    throw new GoalEngineError(
      'GOAL_ENGINE_FAILED',
      `goal-gen terminated by ${result.signal}`
    );
  }
  return {
    exitCode: result.status ?? 1,
    stdout: outputText(result.stdout),
    stderr: outputText(result.stderr),
  };
}

export function createDefaultSpawn(
  env: NodeJS.ProcessEnv,
  timeoutMs = 30_000
): SpawnEngine {
  return (args) => {
    const bin = resolveEngineBin(env);
    const result = spawnSync(bin, [...args], {
      encoding: 'utf8',
      timeout: timeoutMs,
      // spawnSync waits for the child after timeout; SIGTERM can be ignored.
      killSignal: 'SIGKILL',
      env,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
      shell: false,
    });
    return completedSpawn(result, bin, timeoutMs);
  };
}
