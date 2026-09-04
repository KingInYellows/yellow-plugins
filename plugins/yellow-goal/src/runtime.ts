import { GoalEngineError } from './errors.js';
import { PINNED_ENGINE_VERSION } from './pin.js';
import type { SpawnEngine, SpawnResult } from './spawn.js';
import { resolveEngineBin } from './spawn.js';

export interface RuntimeDeps {
  readonly spawn: SpawnEngine;
  readonly env: NodeJS.ProcessEnv;
}

export interface SetupResult {
  readonly engineVersion: string;
  readonly pinnedVersion: string;
  readonly binary: string;
}

export interface RequestCreateResult {
  readonly requestId: string;
  readonly output: string;
}

export interface RequestValidateResult {
  readonly valid: true;
  readonly request: string;
}

function firstJsonLine(text: string): unknown {
  const line = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (line === undefined) {
    throw new GoalEngineError(
      'GOAL_ENGINE_UNPARSEABLE',
      'goal-gen produced empty stdout'
    );
  }
  try {
    return JSON.parse(line);
  } catch {
    throw new GoalEngineError(
      'GOAL_ENGINE_UNPARSEABLE',
      `goal-gen stdout was not JSON: ${line.slice(0, 200)}`
    );
  }
}

function engineErrorMessage(result: SpawnResult): string {
  const line = result.stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (line !== undefined) {
    try {
      const parsed = JSON.parse(line) as {
        error?: { code?: string; message?: string };
      };
      if (parsed.error?.message) {
        return `${parsed.error.code ?? 'ENGINE'}: ${parsed.error.message}`;
      }
    } catch {
      return line.slice(0, 400);
    }
    return line.slice(0, 400);
  }
  return result.stdout.trim().slice(0, 400) || `exit ${result.exitCode}`;
}

function throwOnEngineFailure(result: SpawnResult): void {
  if (result.exitCode === 0) {
    return;
  }
  if (result.exitCode === 2) {
    throw new GoalEngineError(
      'GOAL_ENGINE_USAGE_ERROR',
      engineErrorMessage(result)
    );
  }
  throw new GoalEngineError('GOAL_ENGINE_FAILED', engineErrorMessage(result));
}

export function setup(deps: RuntimeDeps): SetupResult {
  const result = deps.spawn(['version', '--json']);
  throwOnEngineFailure(result);
  const parsed = firstJsonLine(result.stdout);
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    !('engineVersion' in parsed) ||
    typeof (parsed as { engineVersion: unknown }).engineVersion !== 'string'
  ) {
    throw new GoalEngineError(
      'GOAL_ENGINE_UNPARSEABLE',
      'goal-gen version --json did not include a string engineVersion'
    );
  }
  const engineVersion = (parsed as { engineVersion: string }).engineVersion;
  if (engineVersion !== PINNED_ENGINE_VERSION) {
    throw new GoalEngineError(
      'GOAL_ENGINE_VERSION_MISMATCH',
      `engineVersion ${engineVersion} does not match pin ${PINNED_ENGINE_VERSION}`,
      { engineVersion, pinnedVersion: PINNED_ENGINE_VERSION }
    );
  }
  return {
    engineVersion,
    pinnedVersion: PINNED_ENGINE_VERSION,
    binary: resolveEngineBin(deps.env),
  };
}

export function requestCreate(
  deps: RuntimeDeps,
  input: { repo: string; goal: string; output: string }
): RequestCreateResult {
  const result = deps.spawn([
    'request',
    'create',
    '--repo',
    input.repo,
    '--goal',
    input.goal,
    '--output',
    input.output,
    '--json',
  ]);
  throwOnEngineFailure(result);
  const parsed = firstJsonLine(result.stdout);
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    !('requestId' in parsed) ||
    typeof (parsed as { requestId: unknown }).requestId !== 'string'
  ) {
    throw new GoalEngineError(
      'GOAL_ENGINE_UNPARSEABLE',
      'goal-gen request create --json did not include a string requestId'
    );
  }
  return {
    requestId: (parsed as { requestId: string }).requestId,
    output: input.output,
  };
}

export function requestValidate(
  deps: RuntimeDeps,
  input: { request: string }
): RequestValidateResult {
  const result = deps.spawn(['request', 'validate', input.request, '--json']);
  throwOnEngineFailure(result);
  const parsed = firstJsonLine(result.stdout);
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    (parsed as { valid?: unknown }).valid !== true
  ) {
    throw new GoalEngineError(
      'GOAL_ENGINE_FAILED',
      `request validate did not return valid:true (${JSON.stringify(parsed).slice(0, 200)})`
    );
  }
  return { valid: true, request: input.request };
}
