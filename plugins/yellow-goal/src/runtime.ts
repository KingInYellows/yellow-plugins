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
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const line = lines[0];
  if (lines.length !== 1 || line === undefined) {
    throw new GoalEngineError(
      'GOAL_ENGINE_UNPARSEABLE',
      'goal-gen must produce exactly one JSON line on stdout'
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

function engineErrorMessage(
  result: SpawnResult,
  validationPath?: string
): string {
  if (result.stderr.trim()) {
    if (result.stdout.trim()) {
      throw new GoalEngineError(
        'GOAL_ENGINE_UNPARSEABLE',
        'engine failure contains both stdout and stderr'
      );
    }
    try {
      const parsed = JSON.parse(result.stderr.trim()) as {
        error?: { code?: string; message?: string };
      };
      if (
        result.stderr.trim().split(/\r?\n/).length === 1 &&
        typeof parsed?.error?.code === 'string' &&
        typeof parsed.error.message === 'string' &&
        (result.exitCode === 2) === (parsed.error.code === 'USAGE_ERROR')
      ) {
        return `${parsed.error.code}: ${parsed.error.message}`;
      }
    } catch {
      throw new GoalEngineError(
        'GOAL_ENGINE_UNPARSEABLE',
        'engine stderr is not a structured error'
      );
    }
    throw new GoalEngineError(
      'GOAL_ENGINE_UNPARSEABLE',
      'engine stderr disagrees with its exit code or error contract'
    );
  }
  // request validate reports schema-invalid data on stdout with exit 1.
  const parsed = firstJsonLine(result.stdout);
  if (
    validationPath !== undefined &&
    result.exitCode === 1 &&
    parsed !== null &&
    typeof parsed === 'object' &&
    'valid' in parsed &&
    parsed.valid === false &&
    'path' in parsed &&
    parsed.path === validationPath &&
    'errors' in parsed &&
    Array.isArray(parsed.errors) &&
    parsed.errors.length > 0 &&
    parsed.errors.every(
      (error: unknown) =>
        error !== null &&
        typeof error === 'object' &&
        'path' in error &&
        typeof error.path === 'string' &&
        'message' in error &&
        typeof error.message === 'string'
    )
  ) {
    return `request validation failed: ${JSON.stringify(parsed).slice(0, 400)}`;
  }
  throw new GoalEngineError(
    'GOAL_ENGINE_UNPARSEABLE',
    'engine failure has no structured error or validation result'
  );
}

function throwOnEngineFailure(
  result: SpawnResult,
  validationPath?: string
): void {
  if (![0, 1, 2].includes(result.exitCode)) {
    throw new GoalEngineError(
      'GOAL_ENGINE_UNPARSEABLE',
      `engine returned unsupported exit code ${result.exitCode}`
    );
  }
  if (result.exitCode === 0) {
    if (result.stderr.trim()) {
      throw new GoalEngineError(
        'GOAL_ENGINE_UNPARSEABLE',
        'engine success contains stderr diagnostics'
      );
    }
    return;
  }
  if (result.exitCode === 2) {
    throw new GoalEngineError(
      'GOAL_ENGINE_USAGE_ERROR',
      engineErrorMessage(result, validationPath)
    );
  }
  throw new GoalEngineError(
    'GOAL_ENGINE_FAILED',
    engineErrorMessage(result, validationPath)
  );
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
  setup(deps);
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
  setup(deps);
  const result = deps.spawn([
    'request',
    'validate',
    '--json',
    '--',
    input.request,
  ]);
  throwOnEngineFailure(result, input.request);
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
