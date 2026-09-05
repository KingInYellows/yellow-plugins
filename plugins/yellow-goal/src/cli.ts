#!/usr/bin/env node
/**
 * Entry point. Exactly one JSON object on stdout per invocation; all
 * diagnostics go to stderr. Exit codes: 0 on ok:true, 1 on ok:false
 * (engine/business failure), 2 on a consumer CLI usage error.
 *
 * This process never imports yellow-goal TypeScript. It only spawns
 * `goal-gen` (or $GOAL_GEN_BIN) as a child.
 */
import { parseArgs } from 'node:util';

import { GoalEngineError, toGoalError } from './errors.js';
import { STUB_SCENARIOS, type StubScenario } from './provider-protocol.js';
import * as runtime from './runtime.js';
import { createDefaultSpawn } from './spawn.js';

const KNOWN_OPERATIONS = ['setup', 'request', 'run-stub'] as const;

type DispatchResult =
  | runtime.SetupResult
  | runtime.RequestCreateResult
  | runtime.RequestValidateResult
  | runtime.RunStubResult;

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

class UsageError extends Error {}

function requireString(value: string | undefined, flag: string): string {
  if (value === undefined || value.length === 0) {
    throw new UsageError(`missing required flag ${flag}`);
  }
  return value;
}

function buildDeps(): runtime.RuntimeDeps {
  return {
    spawn: createDefaultSpawn(process.env),
    env: process.env,
  };
}

function dispatchRequestCreate(
  rest: readonly string[],
  deps: runtime.RuntimeDeps
): runtime.RequestCreateResult {
  if (
    rest.some((arg) => arg === '--executor' || arg.startsWith('--executor='))
  ) {
    throw new UsageError(
      'refusing --executor; this plugin is read-only (create/validate only)'
    );
  }
  const { values } = parseArgs({
    args: rest.slice(1),
    options: {
      repo: { type: 'string' },
      goal: { type: 'string' },
      output: { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });
  return runtime.requestCreate(deps, {
    repo: requireString(values.repo, '--repo'),
    goal: requireString(values.goal, '--goal'),
    output: requireString(values.output, '--output'),
  });
}

function dispatchRequestValidate(
  rest: readonly string[],
  deps: runtime.RuntimeDeps
): runtime.RequestValidateResult {
  const { positionals } = parseArgs({
    args: rest.slice(1),
    strict: true,
    allowPositionals: true,
  });
  const request = positionals[0];
  if (
    positionals.length !== 1 ||
    typeof request !== 'string' ||
    request.length === 0
  ) {
    throw new UsageError(
      'request validate requires exactly one request file argument'
    );
  }
  return runtime.requestValidate(deps, { request });
}

function dispatchRequest(
  rest: readonly string[],
  deps: runtime.RuntimeDeps
): runtime.RequestCreateResult | runtime.RequestValidateResult {
  switch (rest[0]) {
    case 'create':
      return dispatchRequestCreate(rest, deps);
    case 'validate':
      return dispatchRequestValidate(rest, deps);
    default:
      throw new UsageError(
        `unknown request subcommand "${rest[0] ?? ''}"; expected create or validate`
      );
  }
}

function dispatchRunStub(
  rest: readonly string[],
  deps: runtime.ProtocolRuntimeDeps,
  controller: AbortController
): Promise<runtime.RunStubResult> {
  if (
    rest.some((arg) => arg === '--executor' || arg.startsWith('--executor='))
  ) {
    throw new UsageError(
      'refusing --executor; run-stub always uses the stub executor'
    );
  }
  if (
    rest.some((arg) => arg === '--protocol' || arg.startsWith('--protocol='))
  ) {
    throw new UsageError('refusing --protocol; run-stub always uses v1');
  }
  const { values, positionals } = parseArgs({
    args: rest,
    options: {
      scenario: { type: 'string' },
      'timeout-ms': { type: 'string' },
      yes: { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: true,
  });
  const request = positionals[0];
  if (
    positionals.length !== 1 ||
    typeof request !== 'string' ||
    request.length === 0
  ) {
    throw new UsageError('run-stub requires exactly one <request> argument');
  }
  const scenarioRaw = values.scenario ?? 'success';
  if (!STUB_SCENARIOS.includes(scenarioRaw as StubScenario)) {
    throw new UsageError(
      `unknown --scenario "${scenarioRaw}"; expected one of: ${STUB_SCENARIOS.join(', ')}`
    );
  }
  let timeoutMs: number | undefined;
  const timeoutRaw = values['timeout-ms'];
  if (timeoutRaw !== undefined) {
    if (!/^[1-9][0-9]*$/.test(timeoutRaw)) {
      throw new UsageError('--timeout-ms must be a positive decimal integer');
    }
    timeoutMs = Number(timeoutRaw);
  }
  return runtime.runStub(deps, {
    request,
    scenario: scenarioRaw as StubScenario,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    yes: values.yes === true,
    signal: controller.signal,
  });
}

async function dispatch(
  operation: string,
  rest: readonly string[],
  deps: runtime.RuntimeDeps,
  controller: AbortController
): Promise<DispatchResult> {
  switch (operation) {
    case 'setup': {
      parseArgs({ args: rest, strict: true, allowPositionals: false });
      return runtime.setup(deps);
    }
    case 'request':
      return dispatchRequest(rest, deps);
    case 'run-stub': {
      // GOAL_GEN_SCRATCH is a test-only seam: production never retains the
      // per-operation scratch tree, so the variable is stripped here.
      const { GOAL_GEN_SCRATCH: _testOnlyScratch, ...productionEnv } = deps.env;
      void _testOnlyScratch;
      return dispatchRunStub(rest, { env: productionEnv }, controller);
    }
    default:
      throw new UsageError(
        `unknown subcommand "${operation}"; expected one of: ${KNOWN_OPERATIONS.join(', ')}`
      );
  }
}

function isParseArgsError(err: unknown): err is Error {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  return typeof code === 'string' && code.startsWith('ERR_PARSE_ARGS_');
}

function isUsageError(err: unknown): err is Error {
  return (
    err instanceof UsageError ||
    isParseArgsError(err) ||
    (err instanceof GoalEngineError && err.code === 'GOAL_INVALID_INPUT')
  );
}

async function main(): Promise<void> {
  const [operation, ...rest] = process.argv.slice(2);
  const resolvedOperation = operation ?? 'unknown';

  if (operation === undefined) {
    process.stderr.write(
      `no subcommand given; expected one of: ${KNOWN_OPERATIONS.join(', ')}\n`
    );
    printJson({
      ok: false,
      operation: 'unknown',
      error: new GoalEngineError(
        'GOAL_INVALID_INPUT',
        `no subcommand given; expected one of: ${KNOWN_OPERATIONS.join(', ')}`
      ).toJson(),
    });
    process.exitCode = 2;
    return;
  }

  const controller = new AbortController();
  const forwardSignal = (): void => controller.abort();
  let signalsInstalled = false;
  function installSignalForwarding(): void {
    if (signalsInstalled) return;
    signalsInstalled = true;
    process.on('SIGINT', forwardSignal);
    process.on('SIGTERM', forwardSignal);
  }
  function removeSignalForwarding(): void {
    if (!signalsInstalled) return;
    signalsInstalled = false;
    process.off('SIGINT', forwardSignal);
    process.off('SIGTERM', forwardSignal);
  }

  try {
    // Only the async run-stub lifecycle listens to the controller; the
    // synchronous setup/request paths keep Node's default signal behavior.
    if (operation === 'run-stub') installSignalForwarding();
    const result = await dispatch(operation, rest, buildDeps(), controller);
    printJson({ ok: true, operation: resolvedOperation, ...result });
  } catch (err) {
    if (isUsageError(err)) {
      process.stderr.write(`${err.message}\n`);
      printJson({
        ok: false,
        operation: resolvedOperation,
        error: new GoalEngineError('GOAL_INVALID_INPUT', err.message).toJson(),
      });
      process.exitCode = 2;
      return;
    }
    const appError = toGoalError(err);
    process.stderr.write(`${appError.code}: ${appError.message}\n`);
    printJson({
      ok: false,
      operation: resolvedOperation,
      error: appError,
    });
    process.exitCode = 1;
  } finally {
    removeSignalForwarding();
  }
}

void main();
