import { rmSync } from 'node:fs';

import { GoalEngineError, type GoalErrorLocalCause } from './errors.js';
import { PINNED_ENGINE_VERSION } from './pin.js';
import {
  buildChildEnv,
  createOperationScratchDir,
  spawnProtocolChild,
  type ProtocolChildLimits,
  type ProtocolChildResult,
} from './provider-process.js';
import {
  CONSUMER_LIMITS,
  JsonLinesFramer,
  STUB_SCENARIOS,
  RunStreamValidator,
  classifyPreflightFailure,
  isEngineStdoutTransportFailure,
  parseSingleJsonObject,
  validateCapabilities,
  validateTerminalAgreement,
  validateVersionProbe,
  type StubScenario,
  type ValidatedSummary,
} from './provider-protocol.js';
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isValidationError(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value['path'] === 'string' &&
    typeof value['message'] === 'string'
  );
}

function isSchemaInvalidValidationResult(
  value: unknown,
  validationPath: string
): boolean {
  if (!isRecord(value)) return false;
  if (value['valid'] !== false || value['path'] !== validationPath)
    return false;
  return (
    Array.isArray(value['errors']) &&
    value['errors'].length > 0 &&
    value['errors'].every(isValidationError)
  );
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
    isSchemaInvalidValidationResult(parsed, validationPath)
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

// ---------------------------------------------------------------------------
// runStub — async fixed-authority Provider Protocol v1 lifecycle
// ---------------------------------------------------------------------------

export interface ProtocolRuntimeDeps {
  readonly env: NodeJS.ProcessEnv;
  /** Test-only seam (e.g. a NODE_OPTIONS preload); production never sets
   *  this. Forwarded verbatim into every child's allowlisted environment. */
  readonly childEnvOverride?: NodeJS.ProcessEnv;
}

export interface RunStubInput {
  readonly request: string;
  readonly scenario: StubScenario;
  readonly timeoutMs?: number;
  readonly yes?: boolean;
  /** Consumer absolute deadline in ms from now; default 120_000 plus the
   *  engine timeout when one is given. */
  readonly deadlineMs?: number;
  readonly signal?: AbortSignal;
}

export interface RunStubResult {
  readonly engineVersion: string;
  readonly protocolVersion: string;
  readonly runId: string;
  readonly eventCount: number;
  readonly summary: ValidatedSummary;
}

const DEFAULT_DEADLINE_BASE_MS = 120_000;
const MIN_TIMEOUT_MS = 1;
const MAX_TIMEOUT_MS = 3_600_000;

function runStubUsageError(message: string): never {
  throw new GoalEngineError('GOAL_INVALID_INPUT', message);
}

function validateScenario(scenario: StubScenario): void {
  if (!STUB_SCENARIOS.includes(scenario)) {
    runStubUsageError(
      `unknown stub scenario "${scenario}"; expected one of: ${STUB_SCENARIOS.join(', ')}`
    );
  }
}

function validateTimeoutMs(
  timeoutMs: number | undefined,
  scenario: StubScenario
): void {
  if (timeoutMs === undefined) {
    if (scenario === 'await-cancel') {
      runStubUsageError('the await-cancel scenario requires --timeout-ms');
    }
    return;
  }
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < MIN_TIMEOUT_MS ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    runStubUsageError(
      `--timeout-ms must be a safe integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}`
    );
  }
}

function localCauseError(
  cause: GoalErrorLocalCause,
  extras: { runId?: string; eventCount?: number } = {}
): GoalEngineError {
  if (cause === 'caller-cancelled') {
    return new GoalEngineError(
      'GOAL_RUN_CANCELLED',
      'run cancelled by the caller before completion',
      { ...extras, localCause: cause }
    );
  }
  return new GoalEngineError(
    'GOAL_RUN_DEADLINE_EXCEEDED',
    'the consumer deadline elapsed before completion',
    { ...extras, localCause: cause }
  );
}

/** Rethrow a caught failure with runId/eventCount filled in when absent. */
function attachRunDiagnostics(
  err: unknown,
  runId: string | undefined,
  eventCount: number
): never {
  if (err instanceof GoalEngineError) {
    throw new GoalEngineError(err.code, err.message, {
      engineVersion: err.engineVersion,
      pinnedVersion: err.pinnedVersion,
      runId: err.runId ?? runId,
      eventCount: err.eventCount ?? eventCount,
      terminalStatus: err.terminalStatus,
      terminationReason: err.terminationReason,
      gateKind: err.gateKind,
      localCause: err.localCause,
    });
  }
  throw err;
}

const BOOTSTRAP_LIMITS: ProtocolChildLimits = {
  maxStdoutBytes: CONSUMER_LIMITS.bootstrapMaxStdoutBytes,
  maxStderrBytes: CONSUMER_LIMITS.bootstrapMaxStderrBytes,
};

/**
 * Probe-phase outcome (reconciliation): a forced kill is transport; a
 * recorded local cause with a graceful close or the expected SIGTERM close
 * maps to the local cancellation/deadline code and discards partial output;
 * any other signal exit is transport. A probe that produced stdout must also
 * have exited 0 with empty stderr, otherwise its output is not trusted.
 */
function probeOutcome(result: ProtocolChildResult, label: string): void {
  if (result.forcedKill) {
    throw new GoalEngineError(
      'GOAL_PROTOCOL_TRANSPORT',
      `${label} probe was force-killed`
    );
  }
  if (
    result.localCause !== undefined &&
    (result.signal === null || result.signal === 'SIGTERM')
  ) {
    throw localCauseError(result.localCause);
  }
  if (result.signal !== null) {
    throw new GoalEngineError(
      'GOAL_PROTOCOL_TRANSPORT',
      `${label} probe did not close cleanly`
    );
  }
  if (result.stdout.length === 0) return;
  if (result.exitCode !== 0 || result.stderr.length !== 0) {
    throw new GoalEngineError(
      'GOAL_PROTOCOL_INVALID',
      `${label} probe output contradicts its exit code or stderr`
    );
  }
}

export async function runStub(
  deps: ProtocolRuntimeDeps,
  input: RunStubInput
): Promise<RunStubResult> {
  validateScenario(input.scenario);
  validateTimeoutMs(input.timeoutMs, input.scenario);
  const pinnedScratch = deps.env['GOAL_GEN_SCRATCH'];
  const scratchDir = createOperationScratchDir(deps.env);
  try {
    return await runStubInScratch(deps, input, scratchDir);
  } finally {
    if (typeof pinnedScratch !== 'string' || pinnedScratch.length === 0) {
      rmSync(scratchDir, { recursive: true, force: true });
    }
  }
}

async function runStubInScratch(
  deps: ProtocolRuntimeDeps,
  input: RunStubInput,
  scratchDir: string
): Promise<RunStubResult> {
  const controller = new AbortController();
  let localCause: GoalErrorLocalCause | undefined;
  const deadlineAt =
    Date.now() +
    (input.deadlineMs ?? DEFAULT_DEADLINE_BASE_MS + (input.timeoutMs ?? 0));

  const recordLocalCause = (cause: GoalErrorLocalCause): void => {
    if (localCause === undefined) localCause = cause;
  };

  const onCallerAbort = (): void => {
    recordLocalCause('caller-cancelled');
    controller.abort();
  };
  if (input.signal !== undefined) {
    if (input.signal.aborted) onCallerAbort();
    else input.signal.addEventListener('abort', onCallerAbort, { once: true });
  }
  try {
    return await runStubPhases(deps, input, scratchDir, {
      controller,
      deadlineAt,
      localCause: () => localCause,
      recordLocalCause,
    });
  } finally {
    input.signal?.removeEventListener('abort', onCallerAbort);
  }
}

interface RunStubLifecycle {
  readonly controller: AbortController;
  readonly deadlineAt: number;
  readonly localCause: () => GoalErrorLocalCause | undefined;
  readonly recordLocalCause: (cause: GoalErrorLocalCause) => void;
}

async function runStubPhases(
  deps: ProtocolRuntimeDeps,
  input: RunStubInput,
  scratchDir: string,
  lifecycle: RunStubLifecycle
): Promise<RunStubResult> {
  const { controller, deadlineAt, recordLocalCause } = lifecycle;

  function checkNotCancelled(): void {
    const cause = lifecycle.localCause();
    if (cause !== undefined) throw localCauseError(cause);
    if (Date.now() >= deadlineAt) {
      recordLocalCause('deadline');
      controller.abort();
      throw localCauseError('deadline');
    }
  }

  checkNotCancelled();

  const bin = resolveEngineBin(deps.env);
  const env = buildChildEnv({
    sourceEnv: deps.env,
    scratchDir,
    childEnvOverride: deps.childEnvOverride,
  });

  function runChild(
    argv: readonly string[],
    limits: ProtocolChildLimits,
    onStdout?: (chunk: Buffer) => void
  ): Promise<ProtocolChildResult> {
    return spawnProtocolChild({
      bin,
      argv,
      env,
      deadlineAt,
      signal: controller.signal,
      limits,
      ...(onStdout !== undefined ? { onStdout } : {}),
    });
  }

  // Phase 1: version.
  const versionResult = await runChild(['version', '--json'], BOOTSTRAP_LIMITS);
  probeOutcome(versionResult, 'version');
  if (versionResult.stdout.length === 0) {
    throw classifyPreflightFailure({
      exitCode: versionResult.exitCode,
      signal: versionResult.signal,
      stdout: versionResult.stdout,
      stderr: versionResult.stderr,
    });
  }
  const engineVersion = validateVersionProbe(
    parseSingleJsonObject(
      versionResult.stdout,
      'version probe',
      CONSUMER_LIMITS.bootstrapMaxStdoutBytes
    ),
    PINNED_ENGINE_VERSION
  );

  checkNotCancelled();

  // Phase 2: capabilities.
  const capabilitiesResult = await runChild(
    ['capabilities', '--json'],
    BOOTSTRAP_LIMITS
  );
  probeOutcome(capabilitiesResult, 'capabilities');
  if (capabilitiesResult.stdout.length === 0) {
    throw classifyPreflightFailure({
      exitCode: capabilitiesResult.exitCode,
      signal: capabilitiesResult.signal,
      stdout: capabilitiesResult.stdout,
      stderr: capabilitiesResult.stderr,
    });
  }
  const capabilities = validateCapabilities(
    parseSingleJsonObject(
      capabilitiesResult.stdout,
      'capabilities probe',
      CONSUMER_LIMITS.bootstrapMaxStdoutBytes
    ),
    PINNED_ENGINE_VERSION
  );
  if (!capabilities.stubScenarios.includes(input.scenario)) {
    throw new GoalEngineError(
      'GOAL_PROTOCOL_INCOMPATIBLE',
      `engine did not advertise the ${input.scenario} stub scenario`,
      {
        engineVersion: capabilities.engineVersion,
        pinnedVersion: PINNED_ENGINE_VERSION,
      }
    );
  }

  checkNotCancelled();

  // Phase 3: run.
  const runArgv = [
    'run',
    '--executor',
    'stub',
    '--protocol',
    'v1',
    '--stub-scenario',
    input.scenario,
    ...(input.timeoutMs !== undefined
      ? ['--timeout-ms', String(input.timeoutMs)]
      : []),
    ...(input.yes === true ? ['--yes'] : []),
    '--',
    input.request,
  ];

  const framer = new JsonLinesFramer({
    maxRecordBytes: Math.min(
      CONSUMER_LIMITS.maxEventBytes,
      capabilities.limits.maxEventBytes
    ),
    maxTotalBytes: CONSUMER_LIMITS.maxStdoutBytes,
  });
  const validator = new RunStreamValidator();
  const onStdout = (chunk: Buffer): void => {
    for (const record of framer.push(chunk)) validator.accept(record);
  };

  let runResult: ProtocolChildResult;
  try {
    runResult = await runChild(
      runArgv,
      {
        maxStdoutBytes: CONSUMER_LIMITS.maxStdoutBytes,
        maxStderrBytes: CONSUMER_LIMITS.maxStderrBytes,
      },
      onStdout
    );
  } catch (err) {
    attachRunDiagnostics(
      err,
      validator.snapshot.runId,
      validator.snapshot.eventCount
    );
  }

  if (runResult.forcedKill || runResult.signal !== null) {
    throw new GoalEngineError(
      'GOAL_PROTOCOL_TRANSPORT',
      'run did not close cleanly',
      {
        runId: validator.snapshot.runId,
        eventCount: validator.snapshot.eventCount,
        localCause: runResult.localCause,
      }
    );
  }

  function finalizeRunStream(): ReturnType<typeof validateTerminalAgreement> {
    framer.finish();
    const snapshot = validator.snapshot;
    if (framer.bytesConsumed === 0) {
      if (
        runResult.exitCode === 1 &&
        isEngineStdoutTransportFailure(runResult.stderr)
      ) {
        throw new GoalEngineError(
          'GOAL_PROTOCOL_TRANSPORT',
          'engine reported stdout transport failure before any event',
          { runId: snapshot.runId, eventCount: snapshot.eventCount }
        );
      }
      throw classifyPreflightFailure({
        exitCode: runResult.exitCode,
        signal: runResult.signal,
        stdout: Buffer.alloc(0),
        stderr: runResult.stderr,
      });
    }
    validator.finish();
    const finished = validator.snapshot;
    if (finished.summary === undefined) {
      throw new GoalEngineError(
        'GOAL_PROTOCOL_INVALID',
        'run stream ended without a validated summary'
      );
    }
    return validateTerminalAgreement({
      exitCode: runResult.exitCode,
      signal: runResult.signal,
      stderr: runResult.stderr,
      summary: finished.summary,
      gateKind: finished.gateKind,
    });
  }

  let outcome: ReturnType<typeof validateTerminalAgreement>;
  try {
    outcome = finalizeRunStream();
  } catch (err) {
    if (runResult.localCause !== undefined) {
      // A cancellation interrupted the stream before it could fully agree;
      // that is a transport artifact of our own signal, never a protocol
      // violation by the engine.
      throw new GoalEngineError(
        'GOAL_PROTOCOL_TRANSPORT',
        'run stream was incomplete after cancellation',
        {
          runId: validator.snapshot.runId,
          eventCount: validator.snapshot.eventCount,
          localCause: runResult.localCause,
        }
      );
    }
    attachRunDiagnostics(
      err,
      validator.snapshot.runId,
      validator.snapshot.eventCount
    );
  }

  const snapshot = validator.snapshot;
  if (runResult.localCause !== undefined) {
    // The stream fully and validly agreed (success or an engine terminal),
    // but a local cause still wins: it was observed before this close.
    recordLocalCause(runResult.localCause);
    throw new GoalEngineError(
      runResult.localCause === 'caller-cancelled'
        ? 'GOAL_RUN_CANCELLED'
        : 'GOAL_RUN_DEADLINE_EXCEEDED',
      runResult.localCause === 'caller-cancelled'
        ? 'run cancelled by the caller before completion'
        : 'the consumer deadline elapsed before completion',
      {
        runId: snapshot.runId,
        eventCount: snapshot.eventCount,
        terminalStatus: snapshot.summary?.status,
        terminationReason: snapshot.summary?.terminationReason,
        gateKind: snapshot.gateKind,
        localCause: runResult.localCause,
      }
    );
  }

  if (outcome.kind === 'succeeded') {
    if (snapshot.runId === undefined) {
      throw new GoalEngineError(
        'GOAL_PROTOCOL_INVALID',
        'succeeded run stream is missing its run identity'
      );
    }
    return {
      engineVersion,
      protocolVersion: capabilities.protocolVersion,
      runId: snapshot.runId,
      eventCount: snapshot.eventCount,
      summary: snapshot.summary as ValidatedSummary,
    };
  }

  throw new GoalEngineError(outcome.code, outcome.message, {
    runId: snapshot.runId,
    eventCount: snapshot.eventCount,
    terminalStatus: snapshot.summary?.status,
    terminationReason: snapshot.summary?.terminationReason,
    gateKind: snapshot.gateKind,
  });
}
