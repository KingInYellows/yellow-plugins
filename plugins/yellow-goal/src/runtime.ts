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
  RealRunStreamValidator,
  STUB_SCENARIOS,
  RunStreamValidator,
  classifyPreflightFailure,
  isEngineStdoutTransportFailure,
  parseSingleJsonObject,
  validateCapabilities,
  validateRealRunRefusal,
  validateRealRunTerminalAgreement,
  validateTerminalAgreement,
  validateVersionProbe,
  type RealRunOutcomeKind,
  type RunStreamSnapshot,
  type StubScenario,
  type ValidatedRealSpend,
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
// runStub — async fixed-authority Provider Protocol v2 stub lifecycle
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
/**
 * Released engine defaults (goal-gen `REAL_RUN_WALL_CLOCK_MS` /
 * `RUN_WALL_CLOCK_MS`). The consumer deadline is the stub bootstrap slack
 * plus this budget. The action timeout sits inside the wall clock and is
 * not added again.
 */
export const REAL_RUN_DEFAULT_WALL_CLOCK_MS = 600_000;
export const REAL_RUN_MAX_WALL_CLOCK_MS = 3_600_000;

/** Bootstrap slack plus the engine wall clock. Omitted flag uses 600000ms. */
export function realRunConsumerDeadlineMs(
  runWallClockMs: string | undefined
): number {
  if (runWallClockMs === undefined) {
    return DEFAULT_DEADLINE_BASE_MS + REAL_RUN_DEFAULT_WALL_CLOCK_MS;
  }
  if (!/^[1-9][0-9]*$/.test(runWallClockMs)) {
    runStubUsageError('--run-wall-clock-ms must be a positive decimal integer');
  }
  const wall = Number(runWallClockMs);
  if (!Number.isSafeInteger(wall) || wall > REAL_RUN_MAX_WALL_CLOCK_MS) {
    runStubUsageError(
      `--run-wall-clock-ms must be <= ${REAL_RUN_MAX_WALL_CLOCK_MS}`
    );
  }
  return DEFAULT_DEADLINE_BASE_MS + wall;
}

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

/** A graceful exit, or death by the signal we sent (or a terminal-delivered
 *  SIGINT to the whole foreground group), is the expected close after a
 *  recorded local cause; anything else is transport. */
function isExpectedCancellationClose(signal: NodeJS.Signals | null): boolean {
  return signal === null || signal === 'SIGTERM' || signal === 'SIGINT';
}

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
    isExpectedCancellationClose(result.signal)
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

/**
 * A compatible engine must honor the requested scenario: run.start must echo
 * it and the terminal status must be one the scenario can produce. Otherwise
 * a requested deterministic failure could be reported as a success.
 */
function assertScenarioBinding(
  scenario: StubScenario,
  snapshot: RunStreamSnapshot
): void {
  const start = snapshot.start;
  const summary = snapshot.summary;
  if (start === undefined || summary === undefined) {
    throw new GoalEngineError(
      'GOAL_PROTOCOL_INVALID',
      'run stream is missing its start or summary'
    );
  }
  if (start.stubScenario !== scenario) {
    throw new GoalEngineError(
      'GOAL_PROTOCOL_INVALID',
      `engine ran scenario ${start.stubScenario} instead of ${scenario}`,
      { runId: snapshot.runId, eventCount: snapshot.eventCount }
    );
  }
  const allowed: Record<StubScenario, readonly string[]> = {
    success: ['succeeded', 'cancelled'],
    failed: ['failed', 'cancelled'],
    'budget-exhausted': ['budget-exhausted', 'cancelled'],
    'await-cancel': ['cancelled'],
  };
  if (!allowed[scenario].includes(summary.status)) {
    throw new GoalEngineError(
      'GOAL_PROTOCOL_INVALID',
      `terminal status ${summary.status} is not a ${scenario} outcome`,
      {
        runId: snapshot.runId,
        eventCount: snapshot.eventCount,
        terminalStatus: summary.status,
      }
    );
  }
  // Zero-spend contract: stub runs never cost anything. The one exception is
  // an actual budget-exhausted terminal, whose summary carries the simulated
  // accounting that tripped the budget (PP-10), never metered spend. A
  // budget-exhausted request that ended cancelled must still report zero.
  const expectZeroCost = summary.status !== 'budget-exhausted';
  const anyActionCost = summary.actions.some((action) => action.costUsd !== 0);
  if (expectZeroCost && (summary.costUsd !== 0 || anyActionCost)) {
    throw new GoalEngineError(
      'GOAL_PROTOCOL_INVALID',
      `stub ${scenario} run reported a nonzero cost`,
      {
        runId: snapshot.runId,
        eventCount: snapshot.eventCount,
        terminalStatus: summary.status,
      }
    );
  }
}

export async function runStub(
  deps: ProtocolRuntimeDeps,
  input: RunStubInput
): Promise<RunStubResult> {
  validateScenario(input.scenario);
  validateTimeoutMs(input.timeoutMs, input.scenario);
  const scratch = createOperationScratchDir(deps.env);
  try {
    return await runStubInScratch(deps, input, scratch.path);
  } finally {
    if (scratch.owned) {
      try {
        rmSync(scratch.path, { recursive: true, force: true });
      } catch {
        // Cleanup must never mask the run outcome (EBUSY/EPERM etc.).
      }
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
    ['capabilities', '--json', '--protocol', 'v2'],
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
    'v2',
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

  if (
    !runResult.forcedKill &&
    runResult.localCause !== undefined &&
    isExpectedCancellationClose(runResult.signal) &&
    framer.bytesConsumed === 0
  ) {
    // Our cancellation landed before the engine admitted the run (no event
    // was ever framed), so there is no stream to be incomplete: whether the
    // child exited cooperatively or died by the expected signal, this is the
    // probe-like local cancellation/deadline, not a transport failure.
    recordLocalCause(runResult.localCause);
    throw localCauseError(runResult.localCause);
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
  assertScenarioBinding(input.scenario, snapshot);
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

// ---------------------------------------------------------------------------
// runReal — user-supplied approval, no mint, no --yes
// ---------------------------------------------------------------------------

export interface RunRealInput {
  readonly request: string;
  readonly approvalPath: string;
  readonly profile: string;
  readonly maxTurns: string;
  readonly perActionUsd: string;
  readonly totalUsd: string;
  readonly authMode: string;
  readonly allowedTools: readonly string[];
  readonly bundleDir: string;
  readonly spendLedger: string;
  readonly model?: string;
  readonly actionTimeoutMs?: string;
  readonly runWallClockMs?: string;
  readonly expiresInMinutes?: string;
  readonly disallowedTools?: readonly string[];
  readonly deadlineMs?: number;
  readonly signal?: AbortSignal;
}

export interface RunRealResult {
  readonly engineVersion: string;
  readonly protocolVersion: string;
  /** Body returned by `run manifest --json`, unchanged. */
  readonly manifest: Record<string, unknown>;
  readonly outcome: RealRunOutcomeKind | 'refused';
  readonly eventCount: number;
  readonly runId?: string;
  readonly approvalId?: string;
  readonly spend?: ValidatedRealSpend;
  readonly bundleDir?: string;
  readonly refusalCode?: string;
  readonly refusalMessage?: string;
}

function requireRealText(value: string, flag: string): void {
  if (value.length === 0) runStubUsageError(`missing required flag ${flag}`);
}

function validateRealInput(input: RunRealInput): void {
  requireRealText(input.request, '<request>');
  requireRealText(input.approvalPath, '--approval');
  requireRealText(input.profile, '--profile');
  requireRealText(input.maxTurns, '--max-turns');
  requireRealText(input.perActionUsd, '--per-action-usd');
  requireRealText(input.totalUsd, '--total-usd');
  requireRealText(input.authMode, '--auth-mode');
  requireRealText(input.bundleDir, '--bundle-dir');
  requireRealText(input.spendLedger, '--spend-ledger');
  if (input.allowedTools.length === 0) {
    runStubUsageError('at least one --allowed-tool is required');
  }
  if (input.allowedTools.some((tool) => tool.length === 0)) {
    runStubUsageError('--allowed-tool must be a nonempty string');
  }
  if (input.authMode !== 'subscription' && input.authMode !== 'api-key') {
    runStubUsageError('--auth-mode must be subscription or api-key');
  }
}

/** Flags shared by `run manifest` and the real run. Never `--yes`. */
function realRunFlagArgv(input: RunRealInput): string[] {
  const argv = [
    '--profile',
    input.profile,
    '--max-turns',
    input.maxTurns,
    '--per-action-usd',
    input.perActionUsd,
    '--total-usd',
    input.totalUsd,
    '--auth-mode',
    input.authMode,
  ];
  for (const tool of input.allowedTools) argv.push('--allowed-tool', tool);
  argv.push(
    '--bundle-dir',
    input.bundleDir,
    '--spend-ledger',
    input.spendLedger
  );
  if (input.model !== undefined && input.model.length > 0) {
    argv.push('--model', input.model);
  }
  if (input.actionTimeoutMs !== undefined) {
    argv.push('--action-timeout-ms', input.actionTimeoutMs);
  }
  if (input.runWallClockMs !== undefined) {
    argv.push('--run-wall-clock-ms', input.runWallClockMs);
  }
  if (input.expiresInMinutes !== undefined) {
    argv.push('--expires-in-minutes', input.expiresInMinutes);
  }
  for (const tool of input.disallowedTools ?? []) {
    argv.push('--disallowed-tool', tool);
  }
  return argv;
}

function assertForwardingOnly(argv: readonly string[]): void {
  if (argv.includes('--yes') || (argv[0] === 'run' && argv[1] === 'approve')) {
    throw new GoalEngineError(
      'GOAL_INVALID_INPUT',
      'real-run cannot pass --yes or mint an approval'
    );
  }
}

export async function runReal(
  deps: ProtocolRuntimeDeps,
  input: RunRealInput
): Promise<RunRealResult> {
  validateRealInput(input);
  const scratch = createOperationScratchDir(deps.env);
  try {
    return await runRealInScratch(deps, input, scratch.path);
  } finally {
    if (scratch.owned) {
      try {
        rmSync(scratch.path, { recursive: true, force: true });
      } catch {
        // Cleanup must never mask the run outcome.
      }
    }
  }
}

async function runRealInScratch(
  deps: ProtocolRuntimeDeps,
  input: RunRealInput,
  scratchDir: string
): Promise<RunRealResult> {
  const controller = new AbortController();
  let localCause: GoalErrorLocalCause | undefined;
  const deadlineAt =
    Date.now() +
    (input.deadlineMs ?? realRunConsumerDeadlineMs(input.runWallClockMs));
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
    return await runRealPhases(deps, input, scratchDir, {
      controller,
      deadlineAt,
      localCause: () => localCause,
      recordLocalCause,
    });
  } finally {
    input.signal?.removeEventListener('abort', onCallerAbort);
  }
}

async function runRealPhases(
  deps: ProtocolRuntimeDeps,
  input: RunRealInput,
  scratchDir: string,
  lifecycle: RunStubLifecycle
): Promise<RunRealResult> {
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
    realRunAuthMode:
      input.authMode === 'api-key' ? 'api-key' : 'subscription',
  });
  function runChild(
    argv: readonly string[],
    limits: ProtocolChildLimits,
    onStdout?: (chunk: Buffer) => void
  ): Promise<ProtocolChildResult> {
    assertForwardingOnly(argv);
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
  const capabilitiesResult = await runChild(
    ['capabilities', '--json', '--protocol', 'v2'],
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

  checkNotCancelled();
  const flags = realRunFlagArgv(input);
  const manifestArgv = [
    'run',
    'manifest',
    ...flags,
    '--json',
    '--',
    input.request,
  ];
  const manifestResult = await runChild(manifestArgv, BOOTSTRAP_LIMITS);
  probeOutcome(manifestResult, 'manifest');
  if (manifestResult.stdout.length === 0) {
    throw classifyPreflightFailure({
      exitCode: manifestResult.exitCode,
      signal: manifestResult.signal,
      stdout: manifestResult.stdout,
      stderr: manifestResult.stderr,
    });
  }
  const manifest = parseSingleJsonObject(
    manifestResult.stdout,
    'run manifest',
    CONSUMER_LIMITS.bootstrapMaxStdoutBytes
  );

  checkNotCancelled();
  const runArgv = [
    'run',
    '--protocol',
    'v2',
    '--executor',
    'agx-claude-code',
    ...flags,
    '--approval',
    input.approvalPath,
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
  const validator = new RealRunStreamValidator();
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

  if (
    !runResult.forcedKill &&
    runResult.localCause !== undefined &&
    isExpectedCancellationClose(runResult.signal) &&
    framer.bytesConsumed === 0
  ) {
    recordLocalCause(runResult.localCause);
    throw localCauseError(runResult.localCause);
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

  const base = {
    engineVersion,
    protocolVersion: capabilities.protocolVersion,
    manifest,
  };

  if (framer.bytesConsumed === 0) {
    if (
      runResult.exitCode === 1 &&
      isEngineStdoutTransportFailure(runResult.stderr)
    ) {
      throw new GoalEngineError(
        'GOAL_PROTOCOL_TRANSPORT',
        'engine reported stdout transport failure before any event'
      );
    }
    if (runResult.exitCode === 2) {
      throw classifyPreflightFailure({
        exitCode: runResult.exitCode,
        signal: runResult.signal,
        stdout: Buffer.alloc(0),
        stderr: runResult.stderr,
      });
    }
    if (runResult.exitCode !== 1) {
      throw new GoalEngineError(
        'GOAL_PROTOCOL_INVALID',
        `refusal requires exit 1, received ${String(runResult.exitCode)}`
      );
    }
    const refusal = validateRealRunRefusal(runResult.stderr);
    return {
      ...base,
      outcome: 'refused',
      eventCount: 0,
      refusalCode: refusal.code,
      refusalMessage: refusal.message,
      ...(refusal.approvalId !== undefined
        ? { approvalId: refusal.approvalId }
        : {}),
    };
  }

  try {
    framer.finish();
    validator.finish();
  } catch (err) {
    if (runResult.localCause !== undefined) {
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
  if (snapshot.summary === undefined || snapshot.runId === undefined) {
    throw new GoalEngineError(
      'GOAL_PROTOCOL_INVALID',
      'real-run stream ended without a validated summary',
      { runId: snapshot.runId, eventCount: snapshot.eventCount }
    );
  }
  try {
    validateRealRunTerminalAgreement({
      exitCode: runResult.exitCode,
      signal: runResult.signal,
      stderr: runResult.stderr,
      summary: snapshot.summary,
    });
  } catch (err) {
    attachRunDiagnostics(err, snapshot.runId, snapshot.eventCount);
  }
  if (runResult.localCause !== undefined) {
    recordLocalCause(runResult.localCause);
    throw localCauseError(runResult.localCause, {
      runId: snapshot.runId,
      eventCount: snapshot.eventCount,
    });
  }
  return {
    ...base,
    outcome: snapshot.summary.outcome,
    eventCount: snapshot.eventCount,
    runId: snapshot.runId,
    approvalId: snapshot.summary.approvalId,
    ...(snapshot.spend !== undefined ? { spend: snapshot.spend } : {}),
    ...(snapshot.summary.bundleDir !== undefined
      ? { bundleDir: snapshot.summary.bundleDir }
      : {}),
  };
}
