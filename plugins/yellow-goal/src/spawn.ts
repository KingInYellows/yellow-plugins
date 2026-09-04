/**
 * Process-boundary spawn. The engine is always a child process — never
 * imported. Args are an argv array (`shell` stays false).
 */
import { spawnSync } from 'node:child_process';

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
    if (result.error) {
      const code = (result.error as NodeJS.ErrnoException).code;
      if (code === 'ETIMEDOUT') {
        throw new GoalEngineError(
          'GOAL_ENGINE_FAILED',
          `goal-gen timed out after ${timeoutMs}ms`
        );
      }
      if (code === 'ENOENT') {
        throw new GoalEngineError(
          'GOAL_ENGINE_MISSING',
          `goal-gen not found on PATH (looked up as ${bin})`
        );
      }
      if (code === 'EACCES' || code === 'EPERM') {
        throw new GoalEngineError(
          'GOAL_ENGINE_UNRUNNABLE',
          `goal-gen could not be executed (${code})`
        );
      }
      throw new GoalEngineError('GOAL_ENGINE_FAILED', result.error.message);
    }
    if (result.signal !== null) {
      throw new GoalEngineError(
        'GOAL_ENGINE_FAILED',
        `goal-gen terminated by ${result.signal}`
      );
    }
    return {
      exitCode: result.status ?? 1,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  };
}
