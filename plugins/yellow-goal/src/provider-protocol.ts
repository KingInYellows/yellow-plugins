/**
 * Pure Provider Protocol v1 validators (PP-01..PP-11,
 * yellow-goal/goal-gen/plans/specs/provider-protocol-v1.md). No I/O, no
 * child_process, no imports from yellow-goal source: these are consumer
 * guards over observable JSON/bytes, not a copy of the engine's schemas.
 */
import { GoalEngineError } from './errors.js';

export const PROTOCOL_VERSION = 'yellow-goal/provider-protocol/v1' as const;
export const CAPABILITIES_SCHEMA_VERSION =
  'yellow-goal/provider-capabilities/v1' as const;
export const REQUEST_SCHEMA_VERSION = 'yellow-goal/request/v1' as const;
export const RUN_EVENT_SCHEMA_VERSION = 'yellow-goal/run-event/v1' as const;

export const REQUIRED_OPERATIONS = [
  'capabilities',
  'request.create',
  'request.validate',
  'run',
  'version',
] as const;

export const REQUIRED_CAPABILITIES = [
  'run.cancel.os-signal',
  'run.executor.stub',
  'run.gate.noninteractive',
  'run.stdout.jsonl',
  'run.timeout',
] as const;

/** The consumer allowlist of publicly usable stub scenarios. */
export const STUB_SCENARIOS = [
  'success',
  'failed',
  'budget-exhausted',
  'await-cancel',
] as const;
export type StubScenario = (typeof STUB_SCENARIOS)[number];

export const CONSUMER_LIMITS = Object.freeze({
  maxEventBytes: 1_048_576,
  maxStdoutBytes: 4_194_304,
  maxStderrBytes: 65_536,
  bootstrapMaxStdoutBytes: 65_536,
  bootstrapMaxStderrBytes: 65_536,
});

/**
 * Ceiling for the peer's declared writer-finalization budget (the engine
 * declares 5_000). The consumer owns its own SIGTERM/SIGKILL deadline, so this
 * declared value is advisory; the ceiling only rejects absurd declarations.
 */
const MAX_WRITER_FINALIZATION_TIMEOUT_MS = 60_000;

/** Engine stderr code for stdout transport loss (PP-06/PP-09); it takes
 *  precedence over any summary status or cancellation cause. */
const ENGINE_STDOUT_TRANSPORT_CODE = 'RUN_STDOUT_TRANSPORT_FAILED';

// ---------------------------------------------------------------------------
// Small shared predicates
// ---------------------------------------------------------------------------

function invalid(message: string): never {
  throw new GoalEngineError('GOAL_PROTOCOL_INVALID', message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

const RFC3339_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isRfc3339Timestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (Number.isNaN(Date.parse(value))) return false;
  return RFC3339_RE.test(value);
}

function isUniqueNonEmptyStringArray(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  if (!value.every((item) => typeof item === 'string' && item.length > 0)) {
    return false;
  }
  return new Set(value).size === value.length;
}

function containsAll(
  haystack: readonly string[],
  required: readonly string[]
): boolean {
  const set = new Set(haystack);
  return required.every((item) => set.has(item));
}

/** Diagnostics-only helper: bounds a string for inclusion in an error
 *  message or extras. Returns undefined for non-string input. */
export function boundedString(value: unknown, max = 200): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.length > max ? value.slice(0, max) : value;
}

// ---------------------------------------------------------------------------
// parseSingleJsonObject
// ---------------------------------------------------------------------------

function decodeStrictUtf8(bytes: Buffer, label: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    invalid(`${label} is not strict UTF-8`);
  }
}

/**
 * Parse a byte buffer expected to contain exactly one LF-terminated (one
 * optional CR before the LF) UTF-8 JSON object, and nothing else.
 *
 * - Empty input, malformed UTF-8/JSON, more than one record, or a
 *   non-object JSON value -> GOAL_PROTOCOL_INVALID.
 * - A trailing fragment that never reached its terminating LF ->
 *   GOAL_PROTOCOL_TRANSPORT.
 * - Bytes exceeding the optional `maxBytes` bound -> GOAL_PROTOCOL_TRANSPORT.
 */
export function parseSingleJsonObject(
  bytes: Buffer,
  label: string,
  maxBytes?: number
): Record<string, unknown> {
  if (maxBytes !== undefined && bytes.length > maxBytes) {
    throw new GoalEngineError(
      'GOAL_PROTOCOL_TRANSPORT',
      `${label} exceeded the ${maxBytes}-byte bound`
    );
  }
  if (bytes.length === 0) {
    invalid(`${label} was empty`);
  }
  const lastByte = bytes.readUInt8(bytes.length - 1);
  if (lastByte !== 0x0a) {
    throw new GoalEngineError(
      'GOAL_PROTOCOL_TRANSPORT',
      `${label} has an unterminated trailing fragment`
    );
  }
  let end = bytes.length - 1;
  if (end > 0 && bytes.readUInt8(end - 1) === 0x0d) end -= 1;
  const text = decodeStrictUtf8(bytes.subarray(0, end), label);
  if (text.length === 0) {
    invalid(`${label} record was empty`);
  }
  if (text.includes('\n') || text.includes('\r')) {
    invalid(`${label} must contain exactly one record`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    invalid(`${label} was not valid JSON`);
  }
  if (!isPlainObject(parsed)) {
    invalid(`${label} was not a JSON object`);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// validateVersionProbe
// ---------------------------------------------------------------------------

export function validateVersionProbe(
  value: unknown,
  pinnedVersion: string
): string {
  if (!isPlainObject(value)) invalid('version probe must be a JSON object');
  const engineVersion = value['engineVersion'];
  if (!isNonEmptyString(engineVersion)) {
    invalid('version probe engineVersion must be a nonempty string');
  }
  if (engineVersion !== pinnedVersion) {
    throw new GoalEngineError(
      'GOAL_ENGINE_VERSION_MISMATCH',
      `engineVersion ${engineVersion} does not match pin ${pinnedVersion}`,
      { engineVersion, pinnedVersion }
    );
  }
  return engineVersion;
}

// ---------------------------------------------------------------------------
// validateCapabilities
// ---------------------------------------------------------------------------

export interface CapabilitiesLimits {
  readonly maxEventBytes: number;
  readonly maxQueuedBytes: number;
  readonly writerFinalizationTimeoutMs: number;
}

export interface ValidatedCapabilities {
  readonly schemaVersion: typeof CAPABILITIES_SCHEMA_VERSION;
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly engineVersion: string;
  readonly requestSchemaVersion: typeof REQUEST_SCHEMA_VERSION;
  readonly runEventSchemaVersion: typeof RUN_EVENT_SCHEMA_VERSION;
  readonly operations: readonly string[];
  readonly capabilities: readonly string[];
  readonly stubScenarios: readonly string[];
  readonly limits: CapabilitiesLimits;
}

function incompatible(
  message: string,
  extras: { engineVersion?: string; pinnedVersion?: string } = {}
): never {
  throw new GoalEngineError('GOAL_PROTOCOL_INCOMPATIBLE', message, extras);
}

export function validateCapabilities(
  value: unknown,
  pinnedVersion: string
): ValidatedCapabilities {
  if (!isPlainObject(value)) invalid('capabilities must be a JSON object');

  const schemaVersion = value['schemaVersion'];
  const protocolVersion = value['protocolVersion'];
  const engineVersion = value['engineVersion'];
  const requestSchemaVersion = value['requestSchemaVersion'];
  const runEventSchemaVersion = value['runEventSchemaVersion'];
  const operations = value['operations'];
  const capabilities = value['capabilities'];
  const stubScenarios = value['stubScenarios'];
  const limits = value['limits'];

  if (!isNonEmptyString(schemaVersion)) {
    invalid('capabilities.schemaVersion must be a nonempty string');
  }
  if (!isNonEmptyString(protocolVersion)) {
    invalid('capabilities.protocolVersion must be a nonempty string');
  }
  if (!isNonEmptyString(engineVersion)) {
    invalid('capabilities.engineVersion must be a nonempty string');
  }
  if (!isNonEmptyString(requestSchemaVersion)) {
    invalid('capabilities.requestSchemaVersion must be a nonempty string');
  }
  if (!isNonEmptyString(runEventSchemaVersion)) {
    invalid('capabilities.runEventSchemaVersion must be a nonempty string');
  }
  if (!isUniqueNonEmptyStringArray(operations)) {
    invalid('capabilities.operations must be unique nonempty strings');
  }
  if (!isUniqueNonEmptyStringArray(capabilities)) {
    invalid('capabilities.capabilities must be unique nonempty strings');
  }
  if (!isUniqueNonEmptyStringArray(stubScenarios)) {
    invalid('capabilities.stubScenarios must be unique nonempty strings');
  }
  if (!isPlainObject(limits)) {
    invalid('capabilities.limits must be a JSON object');
  }

  const maxEventBytes = limits['maxEventBytes'];
  const maxQueuedBytes = limits['maxQueuedBytes'];
  const writerFinalizationTimeoutMs = limits['writerFinalizationTimeoutMs'];
  if (!isPositiveSafeInteger(maxEventBytes)) {
    invalid(
      'capabilities.limits.maxEventBytes must be a positive safe integer'
    );
  }
  if (!isPositiveSafeInteger(maxQueuedBytes)) {
    invalid(
      'capabilities.limits.maxQueuedBytes must be a positive safe integer'
    );
  }
  if (!isPositiveSafeInteger(writerFinalizationTimeoutMs)) {
    invalid(
      'capabilities.limits.writerFinalizationTimeoutMs must be a positive safe integer'
    );
  }

  const extras = { engineVersion, pinnedVersion };
  if (schemaVersion !== CAPABILITIES_SCHEMA_VERSION) {
    incompatible('unexpected capabilities schemaVersion', extras);
  }
  if (protocolVersion !== PROTOCOL_VERSION) {
    incompatible('unexpected protocolVersion', extras);
  }
  if (requestSchemaVersion !== REQUEST_SCHEMA_VERSION) {
    incompatible('unexpected requestSchemaVersion', extras);
  }
  if (runEventSchemaVersion !== RUN_EVENT_SCHEMA_VERSION) {
    incompatible('unexpected runEventSchemaVersion', extras);
  }
  if (engineVersion !== pinnedVersion) {
    incompatible('engineVersion does not match pin', extras);
  }
  if (!containsAll(operations, REQUIRED_OPERATIONS)) {
    incompatible('capabilities is missing a required operation', extras);
  }
  if (!containsAll(capabilities, REQUIRED_CAPABILITIES)) {
    incompatible('capabilities is missing a required capability', extras);
  }
  if (!containsAll(stubScenarios, STUB_SCENARIOS)) {
    incompatible('capabilities is missing a required stub scenario', extras);
  }
  if (maxEventBytes > CONSUMER_LIMITS.maxEventBytes) {
    incompatible(
      'capabilities.limits.maxEventBytes exceeds the consumer bound',
      extras
    );
  }
  if (maxQueuedBytes > CONSUMER_LIMITS.maxStdoutBytes) {
    incompatible(
      'capabilities.limits.maxQueuedBytes exceeds the consumer bound',
      extras
    );
  }
  if (writerFinalizationTimeoutMs > MAX_WRITER_FINALIZATION_TIMEOUT_MS) {
    incompatible(
      'capabilities.limits.writerFinalizationTimeoutMs exceeds the consumer bound',
      extras
    );
  }

  return Object.freeze({
    schemaVersion: CAPABILITIES_SCHEMA_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    engineVersion,
    requestSchemaVersion: REQUEST_SCHEMA_VERSION,
    runEventSchemaVersion: RUN_EVENT_SCHEMA_VERSION,
    operations: Object.freeze([...operations]),
    capabilities: Object.freeze([...capabilities]),
    stubScenarios: Object.freeze([...stubScenarios]),
    limits: Object.freeze({
      maxEventBytes,
      maxQueuedBytes,
      writerFinalizationTimeoutMs,
    }),
  });
}

// ---------------------------------------------------------------------------
// JsonLinesFramer
// ---------------------------------------------------------------------------

export interface JsonLinesFramerLimits {
  readonly maxRecordBytes: number;
  readonly maxTotalBytes: number;
}

/**
 * Raw-byte JSON-Lines framer: finds LF in the raw buffer (never trimmed
 * text), accepts one optional CR immediately before it, decodes each
 * complete record with fatal UTF-8, and bounds both per-record and
 * cumulative byte counts before it would otherwise grow an unbounded
 * pending buffer.
 */
export class JsonLinesFramer {
  private readonly maxRecordBytes: number;
  private readonly maxTotalBytes: number;
  private pending: Buffer = Buffer.alloc(0);
  private totalBytes = 0;
  private consumed = 0;
  private count = 0;
  private finished = false;

  constructor(limits: JsonLinesFramerLimits) {
    this.maxRecordBytes = limits.maxRecordBytes;
    this.maxTotalBytes = limits.maxTotalBytes;
  }

  get bytesConsumed(): number {
    return this.consumed;
  }

  get recordCount(): number {
    return this.count;
  }

  push(chunk: Buffer): unknown[] {
    if (this.finished) {
      throw new GoalEngineError(
        'GOAL_PROTOCOL_TRANSPORT',
        'framer already finished'
      );
    }
    const prospectiveTotal = this.totalBytes + chunk.length;
    if (prospectiveTotal > this.maxTotalBytes) {
      this.totalBytes = prospectiveTotal;
      throw new GoalEngineError(
        'GOAL_PROTOCOL_TRANSPORT',
        'stream exceeded the total byte bound'
      );
    }
    this.totalBytes = prospectiveTotal;
    this.pending =
      this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);

    const records: unknown[] = [];
    for (;;) {
      const lfIndex = this.pending.indexOf(0x0a);
      if (lfIndex === -1) {
        if (this.pending.length > this.maxRecordBytes) {
          throw new GoalEngineError(
            'GOAL_PROTOCOL_TRANSPORT',
            'pending record exceeded the per-record byte bound'
          );
        }
        break;
      }
      const recordLenWithLf = lfIndex + 1;
      if (recordLenWithLf > this.maxRecordBytes) {
        throw new GoalEngineError(
          'GOAL_PROTOCOL_TRANSPORT',
          'record exceeded the per-record byte bound'
        );
      }
      let end = lfIndex;
      if (end > 0 && this.pending.readUInt8(end - 1) === 0x0d) end -= 1;
      records.push(this.parseRecord(this.pending.subarray(0, end)));
      this.consumed += recordLenWithLf;
      this.count += 1;
      this.pending = this.pending.subarray(recordLenWithLf);
    }
    return records;
  }

  private parseRecord(bytes: Buffer): unknown {
    if (bytes.length === 0) {
      invalid('empty JSON-lines record');
    }
    const text = decodeStrictUtf8(bytes, 'JSON-lines record');
    try {
      return JSON.parse(text);
    } catch {
      invalid('JSON-lines record was not valid JSON');
    }
  }

  finish(): void {
    this.finished = true;
    if (this.pending.length > 0) {
      throw new GoalEngineError(
        'GOAL_PROTOCOL_TRANSPORT',
        'stream ended with an unterminated fragment'
      );
    }
  }
}

// ---------------------------------------------------------------------------
// RunStreamValidator
// ---------------------------------------------------------------------------

const GATE_KINDS = ['dod', 'reconfirm', 'acceptance'] as const;
type GateKind = (typeof GATE_KINDS)[number];

const TERMINATION_REASONS = ['signal', 'timeout', 'gate-required'] as const;
type RunTerminationReason = (typeof TERMINATION_REASONS)[number];

const SUMMARY_STATUSES = [
  'succeeded',
  'failed',
  'budget-exhausted',
  'cancelled',
] as const;
type SummaryStatus = (typeof SUMMARY_STATUSES)[number];

function isSummaryStatus(value: unknown): value is SummaryStatus {
  return (
    typeof value === 'string' &&
    SUMMARY_STATUSES.includes(value as SummaryStatus)
  );
}

export interface StartMetadata {
  readonly protocolVersion: string;
  readonly executor: string;
  readonly stubScenario: string;
  readonly simulation: boolean;
  readonly targetRepositoryHonored: boolean;
}

export interface ValidatedAction {
  readonly actionId: string;
  readonly status: 'succeeded' | 'failed';
  readonly attempts: number;
  readonly costUsd: number;
}

export interface ValidatedSummary {
  readonly status: SummaryStatus;
  readonly goalText: string;
  readonly costUsd: number;
  readonly replans: number;
  readonly reextractions: number;
  readonly actions: readonly ValidatedAction[];
  readonly reason: string;
  readonly terminationReason?: RunTerminationReason;
}

export interface RunStreamSnapshot {
  readonly runId?: string;
  readonly eventCount: number;
  readonly nextSequence: number;
  readonly start?: StartMetadata;
  readonly gateKind?: GateKind;
  readonly summary?: ValidatedSummary;
}

/**
 * Validates a `run-event/v1` stream one record at a time, retaining only
 * bounded identity/progress state (never the raw event list).
 */
export class RunStreamValidator {
  private runId: string | undefined;
  private eventCount = 0;
  private nextSeq = 0;
  private start: StartMetadata | undefined;
  private gateKind: GateKind | undefined;
  private summary: ValidatedSummary | undefined;
  private summarySeen = false;

  get snapshot(): RunStreamSnapshot {
    return {
      ...(this.runId !== undefined ? { runId: this.runId } : {}),
      eventCount: this.eventCount,
      nextSequence: this.nextSeq,
      ...(this.start !== undefined ? { start: this.start } : {}),
      ...(this.gateKind !== undefined ? { gateKind: this.gateKind } : {}),
      ...(this.summary !== undefined ? { summary: this.summary } : {}),
    };
  }

  accept(record: unknown): void {
    if (this.summarySeen) invalid('event received after run.summary');
    if (!isPlainObject(record)) invalid('event envelope must be a JSON object');

    const schemaVersion = record['schemaVersion'];
    const runId = record['runId'];
    const sequence = record['sequence'];
    const timestamp = record['timestamp'];
    const type = record['type'];
    const payload = record['payload'];

    if (schemaVersion !== RUN_EVENT_SCHEMA_VERSION) {
      invalid('unexpected envelope schemaVersion');
    }
    if (!isNonEmptyString(runId)) {
      invalid('envelope runId must be a nonempty string');
    }
    if (this.runId === undefined) this.runId = runId;
    else if (this.runId !== runId) invalid('envelope runId changed mid-stream');

    if (!isNonNegativeSafeInteger(sequence)) {
      invalid('envelope sequence must be a nonnegative safe integer');
    }
    if (sequence !== this.nextSeq) {
      invalid('envelope sequence is not contiguous from zero');
    }
    this.nextSeq += 1;

    if (!isRfc3339Timestamp(timestamp)) {
      invalid('envelope timestamp must be a valid RFC3339 string');
    }
    if (!isNonEmptyString(type)) {
      invalid('envelope type must be a nonempty string');
    }
    if (payload !== undefined && !isPlainObject(payload)) {
      invalid('envelope payload must be an object when present');
    }
    this.eventCount += 1;

    if (type === 'run.start') {
      if (this.start !== undefined) invalid('duplicate run.start');
      this.start = this.validateStartPayload(payload);
      return;
    }
    if (this.start === undefined) invalid('first event must be run.start');
    if (type === 'run.summary') {
      this.summary = this.validateSummaryPayload(payload);
      this.summarySeen = true;
      return;
    }
    if (type === 'gate.required') {
      const kind = isPlainObject(payload) ? payload['kind'] : undefined;
      if (kind !== 'dod' && kind !== 'reconfirm' && kind !== 'acceptance') {
        invalid('gate.required payload.kind is invalid');
      }
      if (this.gateKind === undefined) this.gateKind = kind;
      return;
    }
    // Unknown nonterminal event types are tolerated; they still consumed a
    // validated sequence number above.
  }

  finish(): void {
    if (this.start === undefined) invalid('stream ended without run.start');
    if (this.summary === undefined) invalid('stream ended without run.summary');
  }

  private validateStartPayload(payload: unknown): StartMetadata {
    if (!isPlainObject(payload)) invalid('run.start payload must be an object');
    const protocolVersion = payload['protocolVersion'];
    const executor = payload['executor'];
    const stubScenario = payload['stubScenario'];
    const simulation = payload['simulation'];
    const targetRepositoryHonored = payload['targetRepositoryHonored'];

    if (protocolVersion !== PROTOCOL_VERSION) {
      invalid('run.start protocolVersion mismatch');
    }
    if (executor !== 'stub') invalid('run.start executor must be stub');
    if (
      typeof stubScenario !== 'string' ||
      !STUB_SCENARIOS.includes(stubScenario as StubScenario)
    ) {
      invalid('run.start stubScenario is invalid');
    }
    if (simulation !== true) invalid('run.start simulation must be true');
    if (targetRepositoryHonored !== false) {
      invalid('run.start targetRepositoryHonored must be false');
    }
    return {
      protocolVersion,
      executor,
      stubScenario,
      simulation,
      targetRepositoryHonored,
    };
  }

  private validateSummaryPayload(payload: unknown): ValidatedSummary {
    if (!isPlainObject(payload))
      invalid('run.summary payload must be an object');
    const status = payload['status'];
    const goalText = payload['goalText'];
    const costUsd = payload['costUsd'];
    const replans = payload['replans'];
    const reextractions = payload['reextractions'];
    const actions = payload['actions'];
    const reason = payload['reason'];
    const terminationReason = payload['terminationReason'];

    if (!isSummaryStatus(status)) {
      invalid('run.summary status is unknown');
    }
    if (typeof goalText !== 'string') {
      invalid('run.summary goalText must be a string');
    }
    if (!isFiniteNonNegativeNumber(costUsd)) {
      invalid('run.summary costUsd must be a finite nonnegative number');
    }
    if (!isNonNegativeSafeInteger(replans)) {
      invalid('run.summary replans must be a nonnegative safe integer');
    }
    if (!isNonNegativeSafeInteger(reextractions)) {
      invalid('run.summary reextractions must be a nonnegative safe integer');
    }
    if (!Array.isArray(actions)) {
      invalid('run.summary actions must be an array');
    }
    const validatedActions = actions.map((action: unknown) =>
      this.validateAction(action)
    );
    if (typeof reason !== 'string') {
      invalid('run.summary reason must be a string');
    }

    const isCancelled = status === 'cancelled';
    if (isCancelled) {
      if (
        terminationReason !== 'signal' &&
        terminationReason !== 'timeout' &&
        terminationReason !== 'gate-required'
      ) {
        invalid('cancelled summary requires a valid terminationReason');
      }
    } else if (terminationReason !== undefined) {
      invalid('terminationReason is only valid for a cancelled summary');
    }

    return {
      status,
      goalText,
      costUsd,
      replans,
      reextractions,
      actions: validatedActions,
      reason,
      ...(isCancelled ? { terminationReason } : {}),
    };
  }

  private validateAction(action: unknown): ValidatedAction {
    if (!isPlainObject(action)) invalid('summary action must be an object');
    const actionId = action['actionId'];
    const status = action['status'];
    const attempts = action['attempts'];
    const costUsd = action['costUsd'];
    if (!isNonEmptyString(actionId)) {
      invalid('summary action actionId must be a nonempty string');
    }
    if (status !== 'succeeded' && status !== 'failed') {
      invalid('summary action status must be succeeded or failed');
    }
    if (!isNonNegativeSafeInteger(attempts)) {
      invalid('summary action attempts must be a nonnegative safe integer');
    }
    if (!isFiniteNonNegativeNumber(costUsd)) {
      invalid('summary action costUsd must be a finite nonnegative number');
    }
    return { actionId, status, attempts, costUsd };
  }
}

// ---------------------------------------------------------------------------
// validateTerminalAgreement
// ---------------------------------------------------------------------------

export type TerminalOutcome =
  | { readonly kind: 'succeeded' }
  | {
      readonly kind: 'engine-terminal';
      readonly code:
        | 'GOAL_RUN_FAILED'
        | 'GOAL_RUN_BUDGET_EXHAUSTED'
        | 'GOAL_RUN_CANCELLED'
        | 'GOAL_RUN_ENGINE_TIMEOUT'
        | 'GOAL_RUN_GATE_REQUIRED';
      readonly engineCode: string;
      readonly message: string;
    };

type EngineTerminalCode = Extract<
  TerminalOutcome,
  { kind: 'engine-terminal' }
>['code'];

/** Best-effort detection of the engine's transport-failure envelope. Parse
 *  failures are swallowed here; the regular agreement path re-raises them. */
function isStdoutTransportFailure(stderr: Buffer): boolean {
  try {
    const parsed = parseSingleJsonObject(
      stderr,
      'stderr',
      CONSUMER_LIMITS.maxStderrBytes
    );
    const errorField = parsed['error'];
    return (
      isPlainObject(errorField) &&
      errorField['code'] === ENGINE_STDOUT_TRANSPORT_CODE
    );
  } catch {
    return false;
  }
}

export function validateTerminalAgreement(input: {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stderr: Buffer;
  readonly summary: ValidatedSummary;
  readonly gateKind?: string;
}): TerminalOutcome {
  const { exitCode, signal, stderr, summary, gateKind } = input;
  if (signal !== null) {
    invalid('process terminated by a signal, not a protocol terminal');
  }
  if (exitCode === 1 && stderr.length > 0 && isStdoutTransportFailure(stderr)) {
    throw new GoalEngineError(
      'GOAL_PROTOCOL_TRANSPORT',
      'engine reported stdout transport failure after the summary'
    );
  }

  if (summary.status === 'succeeded') {
    if (exitCode !== 0) invalid('succeeded summary requires exit 0');
    if (stderr.length !== 0) {
      invalid('succeeded summary requires empty stderr');
    }
    return { kind: 'succeeded' };
  }

  let expectedEngineCode: string;
  let code: EngineTerminalCode;
  if (summary.status === 'failed') {
    expectedEngineCode = 'RUN_FAILED';
    code = 'GOAL_RUN_FAILED';
  } else if (summary.status === 'budget-exhausted') {
    expectedEngineCode = 'RUN_BUDGET_EXHAUSTED';
    code = 'GOAL_RUN_BUDGET_EXHAUSTED';
  } else if (summary.status === 'cancelled') {
    if (summary.terminationReason === 'signal') {
      expectedEngineCode = 'RUN_CANCELLED';
      code = 'GOAL_RUN_CANCELLED';
    } else if (summary.terminationReason === 'timeout') {
      expectedEngineCode = 'RUN_TIMEOUT';
      code = 'GOAL_RUN_ENGINE_TIMEOUT';
    } else if (summary.terminationReason === 'gate-required') {
      expectedEngineCode = 'RUN_GATE_REQUIRED';
      code = 'GOAL_RUN_GATE_REQUIRED';
      if (gateKind === undefined) {
        invalid(
          'gate-required terminal requires an observed gate.required kind'
        );
      }
    } else {
      invalid('cancelled summary is missing its termination reason');
    }
  } else {
    invalid('unknown terminal status');
  }

  if (exitCode !== 1) invalid(`${summary.status} summary requires exit 1`);
  const errorObject = parseSingleJsonObject(
    stderr,
    'stderr',
    CONSUMER_LIMITS.maxStderrBytes
  );
  const errorField = errorObject['error'];
  if (!isPlainObject(errorField)) {
    invalid('stderr error envelope is missing its error object');
  }
  const engineCode = errorField['code'];
  const message = errorField['message'];
  if (typeof engineCode !== 'string' || typeof message !== 'string') {
    invalid('stderr error envelope has an invalid code/message shape');
  }
  if (engineCode !== expectedEngineCode) {
    invalid('stderr error code disagrees with the summary status');
  }
  return { kind: 'engine-terminal', code, engineCode, message };
}

// ---------------------------------------------------------------------------
// classifyPreflightFailure
// ---------------------------------------------------------------------------

export function classifyPreflightFailure(input: {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}): GoalEngineError {
  const { exitCode, signal, stdout, stderr } = input;
  if (signal !== null) {
    return new GoalEngineError(
      'GOAL_PROTOCOL_INVALID',
      'preflight failure was terminated by a signal'
    );
  }
  if (stdout.length !== 0) {
    return new GoalEngineError(
      'GOAL_PROTOCOL_INVALID',
      'preflight failure produced stdout'
    );
  }

  let errorObject: Record<string, unknown>;
  try {
    errorObject = parseSingleJsonObject(
      stderr,
      'stderr',
      CONSUMER_LIMITS.bootstrapMaxStderrBytes
    );
  } catch (err) {
    if (err instanceof GoalEngineError) return err;
    throw err;
  }

  const errorField = errorObject['error'];
  if (!isPlainObject(errorField)) {
    return new GoalEngineError(
      'GOAL_PROTOCOL_INVALID',
      'preflight stderr is missing a structured error object'
    );
  }
  const code = errorField['code'];
  const message = errorField['message'];
  if (typeof code !== 'string' || typeof message !== 'string') {
    return new GoalEngineError(
      'GOAL_PROTOCOL_INVALID',
      'preflight stderr error has an invalid code/message shape'
    );
  }

  if (exitCode === 2 && code === 'USAGE_ERROR') {
    return new GoalEngineError(
      'GOAL_ENGINE_USAGE_ERROR',
      boundedString(message, 400) ?? message
    );
  }
  if (exitCode === 2 || code === 'USAGE_ERROR') {
    return new GoalEngineError(
      'GOAL_PROTOCOL_INVALID',
      'preflight exit code and USAGE_ERROR disagree'
    );
  }
  if (exitCode === 1) {
    const composed = `${code}: ${message}`;
    return new GoalEngineError(
      'GOAL_ENGINE_FAILED',
      boundedString(composed, 400) ?? composed
    );
  }
  return new GoalEngineError(
    'GOAL_PROTOCOL_INVALID',
    `unexpected preflight exit code ${String(exitCode)}`
  );
}
