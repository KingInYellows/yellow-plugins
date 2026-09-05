/**
 * Pure unit coverage for the Provider Protocol v1 validators. No child
 * processes, no filesystem: only buffers and plain objects.
 */
import { describe, expect, it } from 'vitest';

import { GoalEngineError, type GoalErrorCode } from '../src/errors.js';
import {
  CAPABILITIES_SCHEMA_VERSION,
  CONSUMER_LIMITS,
  JsonLinesFramer,
  PROTOCOL_VERSION,
  REQUEST_SCHEMA_VERSION,
  REQUIRED_CAPABILITIES,
  REQUIRED_OPERATIONS,
  RUN_EVENT_SCHEMA_VERSION,
  RunStreamValidator,
  STUB_SCENARIOS,
  boundedString,
  classifyPreflightFailure,
  parseSingleJsonObject,
  validateCapabilities,
  validateTerminalAgreement,
  validateVersionProbe,
  type ValidatedSummary,
} from '../src/provider-protocol.js';

// Deliberately synthetic: proves the validators are parameterized by the
// caller rather than reading the module pin.
const PIN = '9.9.9-test';

function expectGoalError(fn: () => unknown, code: GoalErrorCode): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(GoalEngineError);
    expect((err as GoalEngineError).code).toBe(code);
    return;
  }
  throw new Error('expected function to throw a GoalEngineError');
}

function makeCapabilities(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    schemaVersion: CAPABILITIES_SCHEMA_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    engineVersion: PIN,
    requestSchemaVersion: REQUEST_SCHEMA_VERSION,
    runEventSchemaVersion: RUN_EVENT_SCHEMA_VERSION,
    operations: [...REQUIRED_OPERATIONS],
    capabilities: [...REQUIRED_CAPABILITIES],
    stubScenarios: [...STUB_SCENARIOS],
    limits: {
      maxEventBytes: 1_048_576,
      maxQueuedBytes: 4_194_304,
      writerFinalizationTimeoutMs: 5_000,
    },
    ...overrides,
  };
}

describe('validateCapabilities', () => {
  it('accepts the exact engine-shaped happy path', () => {
    const result = validateCapabilities(makeCapabilities(), PIN);
    expect(result).toMatchObject({
      schemaVersion: CAPABILITIES_SCHEMA_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      engineVersion: PIN,
      requestSchemaVersion: REQUEST_SCHEMA_VERSION,
      runEventSchemaVersion: RUN_EVENT_SCHEMA_VERSION,
    });
    expect(result.operations).toEqual(
      expect.arrayContaining(REQUIRED_OPERATIONS as unknown as string[])
    );
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.limits)).toBe(true);
  });

  it('rejects a non-object value', () => {
    expectGoalError(
      () => validateCapabilities(null, PIN),
      'GOAL_PROTOCOL_INVALID'
    );
    expectGoalError(
      () => validateCapabilities([], PIN),
      'GOAL_PROTOCOL_INVALID'
    );
    expectGoalError(
      () => validateCapabilities('nope', PIN),
      'GOAL_PROTOCOL_INVALID'
    );
  });

  it.each([
    'schemaVersion',
    'protocolVersion',
    'requestSchemaVersion',
    'runEventSchemaVersion',
  ])('rejects a wrong %s identity as incompatible', (field) => {
    expectGoalError(
      () =>
        validateCapabilities(
          makeCapabilities({ [field]: 'wrong-identity' }),
          PIN
        ),
      'GOAL_PROTOCOL_INCOMPATIBLE'
    );
  });

  it('rejects an engineVersion/pin disagreement as incompatible, with extras', () => {
    try {
      validateCapabilities(makeCapabilities({ engineVersion: '9.9.9' }), PIN);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(GoalEngineError);
      const goalErr = err as GoalEngineError;
      expect(goalErr.code).toBe('GOAL_PROTOCOL_INCOMPATIBLE');
      expect(goalErr.engineVersion).toBe('9.9.9');
      expect(goalErr.pinnedVersion).toBe(PIN);
    }
  });

  it.each(REQUIRED_OPERATIONS)(
    'rejects capabilities missing required operation %s',
    (missing) => {
      const operations = REQUIRED_OPERATIONS.filter((op) => op !== missing);
      expectGoalError(
        () => validateCapabilities(makeCapabilities({ operations }), PIN),
        'GOAL_PROTOCOL_INCOMPATIBLE'
      );
    }
  );

  it.each(REQUIRED_CAPABILITIES)(
    'rejects capabilities missing required capability %s',
    (missing) => {
      const capabilities = REQUIRED_CAPABILITIES.filter((c) => c !== missing);
      expectGoalError(
        () => validateCapabilities(makeCapabilities({ capabilities }), PIN),
        'GOAL_PROTOCOL_INCOMPATIBLE'
      );
    }
  );

  it.each(STUB_SCENARIOS)(
    'rejects capabilities missing required stub scenario %s',
    (missing) => {
      const stubScenarios = STUB_SCENARIOS.filter((s) => s !== missing);
      expectGoalError(
        () => validateCapabilities(makeCapabilities({ stubScenarios }), PIN),
        'GOAL_PROTOCOL_INCOMPATIBLE'
      );
    }
  );

  it.each([
    ['duplicate entries', [...REQUIRED_OPERATIONS, REQUIRED_OPERATIONS[0]]],
    ['an empty-string entry', [...REQUIRED_OPERATIONS, '']],
    ['a non-string entry', [...REQUIRED_OPERATIONS, 42 as unknown as string]],
  ])('rejects operations with %s as malformed', (_label, operations) => {
    expectGoalError(
      () => validateCapabilities(makeCapabilities({ operations }), PIN),
      'GOAL_PROTOCOL_INVALID'
    );
  });

  it.each([
    ['0', 0],
    ['negative', -1],
    ['a float', 1.5],
    ['a non-safe integer', Number.MAX_SAFE_INTEGER + 10],
    ['a non-number', 'nope' as unknown as number],
  ])('rejects limits.maxEventBytes = %s as malformed', (_label, value) => {
    expectGoalError(
      () =>
        validateCapabilities(
          makeCapabilities({
            limits: {
              maxEventBytes: value,
              maxQueuedBytes: 4_194_304,
              writerFinalizationTimeoutMs: 5_000,
            },
          }),
          PIN
        ),
      'GOAL_PROTOCOL_INVALID'
    );
  });

  it('rejects limits.maxEventBytes over the consumer bound as incompatible', () => {
    expectGoalError(
      () =>
        validateCapabilities(
          makeCapabilities({
            limits: {
              maxEventBytes: CONSUMER_LIMITS.maxEventBytes + 1,
              maxQueuedBytes: 4_194_304,
              writerFinalizationTimeoutMs: 5_000,
            },
          }),
          PIN
        ),
      'GOAL_PROTOCOL_INCOMPATIBLE'
    );
  });

  it('rejects limits.maxQueuedBytes over the consumer bound as incompatible', () => {
    expectGoalError(
      () =>
        validateCapabilities(
          makeCapabilities({
            limits: {
              maxEventBytes: 1_048_576,
              maxQueuedBytes: CONSUMER_LIMITS.maxStdoutBytes + 1,
              writerFinalizationTimeoutMs: 5_000,
            },
          }),
          PIN
        ),
      'GOAL_PROTOCOL_INCOMPATIBLE'
    );
  });

  it('rejects writerFinalizationTimeoutMs over 60_000ms as incompatible', () => {
    expectGoalError(
      () =>
        validateCapabilities(
          makeCapabilities({
            limits: {
              maxEventBytes: 1_048_576,
              maxQueuedBytes: 4_194_304,
              writerFinalizationTimeoutMs: 60_001,
            },
          }),
          PIN
        ),
      'GOAL_PROTOCOL_INCOMPATIBLE'
    );
  });

  it('accepts exact-bound limits (not "over")', () => {
    expect(() =>
      validateCapabilities(
        makeCapabilities({
          limits: {
            maxEventBytes: CONSUMER_LIMITS.maxEventBytes,
            maxQueuedBytes: CONSUMER_LIMITS.maxStdoutBytes,
            writerFinalizationTimeoutMs: 60_000,
          },
        }),
        PIN
      )
    ).not.toThrow();
  });

  it('accepts additive unknown fields, capabilities, and scenarios', () => {
    const result = validateCapabilities(
      makeCapabilities({
        somethingNew: true,
        operations: [...REQUIRED_OPERATIONS, 'future.operation'],
        capabilities: [...REQUIRED_CAPABILITIES, 'future.capability'],
        stubScenarios: [...STUB_SCENARIOS, 'future-scenario'],
        limits: {
          maxEventBytes: 1_048_576,
          maxQueuedBytes: 4_194_304,
          writerFinalizationTimeoutMs: 5_000,
          futureLimit: 1,
        },
      }),
      PIN
    );
    expect(result.operations).toContain('future.operation');
    expect(result.capabilities).toContain('future.capability');
    expect(result.stubScenarios).toContain('future-scenario');
    expect(Reflect.has(result, 'somethingNew')).toBe(false);
  });
});

describe('validateVersionProbe', () => {
  it('returns engineVersion on agreement', () => {
    expect(validateVersionProbe({ engineVersion: PIN }, PIN)).toBe(PIN);
  });

  it('throws a version mismatch with extras', () => {
    try {
      validateVersionProbe({ engineVersion: '9.9.9' }, PIN);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(GoalEngineError);
      const goalErr = err as GoalEngineError;
      expect(goalErr.code).toBe('GOAL_ENGINE_VERSION_MISMATCH');
      expect(goalErr.engineVersion).toBe('9.9.9');
      expect(goalErr.pinnedVersion).toBe(PIN);
    }
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['missing engineVersion', {}],
    ['a non-string engineVersion', { engineVersion: 1 }],
    ['an empty engineVersion', { engineVersion: '' }],
  ])('rejects %s as malformed', (_label, value) => {
    expectGoalError(
      () => validateVersionProbe(value, PIN),
      'GOAL_PROTOCOL_INVALID'
    );
  });
});

describe('parseSingleJsonObject', () => {
  it('parses one LF-terminated object', () => {
    expect(parseSingleJsonObject(Buffer.from('{"a":1}\n'), 'x')).toEqual({
      a: 1,
    });
  });

  it('accepts one optional CR before the LF', () => {
    expect(parseSingleJsonObject(Buffer.from('{"a":1}\r\n'), 'x')).toEqual({
      a: 1,
    });
  });

  it('rejects empty input', () => {
    expectGoalError(
      () => parseSingleJsonObject(Buffer.alloc(0), 'x'),
      'GOAL_PROTOCOL_INVALID'
    );
  });

  it('treats a missing trailing LF as a transport failure', () => {
    expectGoalError(
      () => parseSingleJsonObject(Buffer.from('{"a":1}'), 'x'),
      'GOAL_PROTOCOL_TRANSPORT'
    );
  });

  it('rejects more than one record', () => {
    expectGoalError(
      () => parseSingleJsonObject(Buffer.from('{"a":1}\n{"b":2}\n'), 'x'),
      'GOAL_PROTOCOL_INVALID'
    );
  });

  it('rejects a non-object JSON value', () => {
    expectGoalError(
      () => parseSingleJsonObject(Buffer.from('[1,2]\n'), 'x'),
      'GOAL_PROTOCOL_INVALID'
    );
    expectGoalError(
      () => parseSingleJsonObject(Buffer.from('null\n'), 'x'),
      'GOAL_PROTOCOL_INVALID'
    );
  });

  it('rejects invalid UTF-8', () => {
    expectGoalError(
      () => parseSingleJsonObject(Buffer.from([0xff, 0xfe, 0x0a]), 'x'),
      'GOAL_PROTOCOL_INVALID'
    );
  });

  it('rejects invalid JSON', () => {
    expectGoalError(
      () => parseSingleJsonObject(Buffer.from('not json\n'), 'x'),
      'GOAL_PROTOCOL_INVALID'
    );
  });

  it('rejects bytes over the given max as a transport failure', () => {
    expectGoalError(
      () => parseSingleJsonObject(Buffer.from('{"a":1}\n'), 'x', 4),
      'GOAL_PROTOCOL_TRANSPORT'
    );
  });
});

describe('boundedString', () => {
  it('returns undefined for non-string input', () => {
    expect(boundedString(42)).toBeUndefined();
    expect(boundedString(undefined)).toBeUndefined();
  });

  it('returns the value unchanged under the max', () => {
    expect(boundedString('short')).toBe('short');
  });

  it('truncates over the max', () => {
    const long = 'x'.repeat(250);
    expect(boundedString(long)).toBe('x'.repeat(200));
    expect(boundedString(long, 10)).toBe('x'.repeat(10));
  });
});

describe('JsonLinesFramer', () => {
  const LIMITS = { maxRecordBytes: 1_048_576, maxTotalBytes: 4_194_304 };

  it('parses one-byte chunks', () => {
    const framer = new JsonLinesFramer(LIMITS);
    const bytes = Buffer.from('{"a":1}\n');
    const records: unknown[] = [];
    for (const byte of bytes) {
      records.push(...framer.push(Buffer.from([byte])));
    }
    expect(records).toEqual([{ a: 1 }]);
    expect(framer.recordCount).toBe(1);
    expect(framer.bytesConsumed).toBe(bytes.length);
  });

  it('reassembles a multibyte UTF-8 character split across chunks', () => {
    const framer = new JsonLinesFramer(LIMITS);
    const text = '{"e":"\u{1F389}"}\n';
    const bytes = Buffer.from(text, 'utf8');
    const prefixBytes = Buffer.byteLength('{"e":"', 'utf8');
    const splitPoint = prefixBytes + 2; // mid-way through the 4-byte emoji
    const first = framer.push(bytes.subarray(0, splitPoint));
    expect(first).toEqual([]);
    const second = framer.push(bytes.subarray(splitPoint));
    expect(second).toEqual([JSON.parse(text)]);
  });

  it('accepts LF and CRLF records in the same stream', () => {
    const framer = new JsonLinesFramer(LIMITS);
    const records = framer.push(Buffer.from('{"a":1}\n{"b":2}\r\n'));
    expect(records).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('rejects a blank line (bare LF or CRLF) as an empty record', () => {
    expectGoalError(
      () => new JsonLinesFramer(LIMITS).push(Buffer.from('\n')),
      'GOAL_PROTOCOL_INVALID'
    );
    expectGoalError(
      () => new JsonLinesFramer(LIMITS).push(Buffer.from('\r\n')),
      'GOAL_PROTOCOL_INVALID'
    );
  });

  it('treats a lone CR not immediately before LF as record content, not a boundary', () => {
    // No LF appears until the very end, so this is one record; its body
    // ("{"x":1}\r{"y":2}") is not valid JSON.
    expectGoalError(
      () => new JsonLinesFramer(LIMITS).push(Buffer.from('{"x":1}\r{"y":2}\n')),
      'GOAL_PROTOCOL_INVALID'
    );
  });

  it('rejects invalid UTF-8 within a record', () => {
    expectGoalError(
      () => new JsonLinesFramer(LIMITS).push(Buffer.from([0xff, 0xfe, 0x0a])),
      'GOAL_PROTOCOL_INVALID'
    );
  });

  it('rejects invalid JSON within a record', () => {
    expectGoalError(
      () => new JsonLinesFramer(LIMITS).push(Buffer.from('not json\n')),
      'GOAL_PROTOCOL_INVALID'
    );
  });

  it('finish() rejects a pending fragment missing its final LF', () => {
    const framer = new JsonLinesFramer(LIMITS);
    framer.push(Buffer.from('{"a":1}'));
    expectGoalError(() => framer.finish(), 'GOAL_PROTOCOL_TRANSPORT');
  });

  it('finish() accepts a fully-drained stream', () => {
    const framer = new JsonLinesFramer(LIMITS);
    framer.push(Buffer.from('{"a":1}\n'));
    expect(() => framer.finish()).not.toThrow();
  });

  it('accepts a record exactly at the per-record byte bound', () => {
    // '{"a":1}\n' is 8 bytes.
    const framer = new JsonLinesFramer({
      maxRecordBytes: 8,
      maxTotalBytes: 100,
    });
    expect(framer.push(Buffer.from('{"a":1}\n'))).toEqual([{ a: 1 }]);
  });

  it('rejects a record one byte over the per-record byte bound', () => {
    const framer = new JsonLinesFramer({
      maxRecordBytes: 7,
      maxTotalBytes: 100,
    });
    expectGoalError(
      () => framer.push(Buffer.from('{"a":1}\n')),
      'GOAL_PROTOCOL_TRANSPORT'
    );
  });

  it('rejects a pending fragment over the per-record byte bound before its LF arrives', () => {
    const framer = new JsonLinesFramer({
      maxRecordBytes: 4,
      maxTotalBytes: 100,
    });
    expectGoalError(
      () => framer.push(Buffer.from('{"a":1}')),
      'GOAL_PROTOCOL_TRANSPORT'
    );
  });

  it('accepts the stream exactly at the total byte bound', () => {
    const framer = new JsonLinesFramer({
      maxRecordBytes: 100,
      maxTotalBytes: 8,
    });
    expect(framer.push(Buffer.from('{"a":1}\n'))).toEqual([{ a: 1 }]);
  });

  it('rejects the stream one byte over the total byte bound', () => {
    const framer = new JsonLinesFramer({
      maxRecordBytes: 100,
      maxTotalBytes: 7,
    });
    expectGoalError(
      () => framer.push(Buffer.from('{"a":1}\n')),
      'GOAL_PROTOCOL_TRANSPORT'
    );
  });

  it('rejects further pushes after finish()', () => {
    const framer = new JsonLinesFramer(LIMITS);
    framer.push(Buffer.from('{"a":1}\n'));
    framer.finish();
    expectGoalError(
      () => framer.push(Buffer.from('{"b":2}\n')),
      'GOAL_PROTOCOL_TRANSPORT'
    );
  });
});

describe('RunStreamValidator', () => {
  function start(
    payloadOverrides: Record<string, unknown> = {},
    envelopeOverrides: Record<string, unknown> = {}
  ): Record<string, unknown> {
    return {
      schemaVersion: RUN_EVENT_SCHEMA_VERSION,
      runId: 'run-1',
      sequence: 0,
      timestamp: '2026-01-01T00:00:00.000Z',
      type: 'run.start',
      payload: {
        protocolVersion: PROTOCOL_VERSION,
        executor: 'stub',
        stubScenario: 'success',
        simulation: true,
        targetRepositoryHonored: false,
        ...payloadOverrides,
      },
      ...envelopeOverrides,
    };
  }

  function summary(
    seq: number,
    payloadOverrides: Record<string, unknown> = {},
    envelopeOverrides: Record<string, unknown> = {}
  ): Record<string, unknown> {
    return {
      schemaVersion: RUN_EVENT_SCHEMA_VERSION,
      runId: 'run-1',
      sequence: seq,
      timestamp: '2026-01-01T00:00:09.000Z',
      type: 'run.summary',
      payload: {
        status: 'succeeded',
        goalText: 'goal',
        costUsd: 0,
        replans: 0,
        reextractions: 0,
        actions: [],
        reason: 'done',
        ...payloadOverrides,
      },
      ...envelopeOverrides,
    };
  }

  function event(
    seq: number,
    type: string,
    payload: Record<string, unknown> = {},
    envelopeOverrides: Record<string, unknown> = {}
  ): Record<string, unknown> {
    return {
      schemaVersion: RUN_EVENT_SCHEMA_VERSION,
      runId: 'run-1',
      sequence: seq,
      timestamp: `2026-01-01T00:00:0${seq}.000Z`,
      type,
      payload,
      ...envelopeOverrides,
    };
  }

  it('validates a complete valid stream and snapshots progress', () => {
    const v = new RunStreamValidator();
    v.accept(start());
    v.accept(event(1, 'progress.tick', { note: 'ok' }));
    v.accept(summary(2));
    v.finish();
    expect(v.snapshot).toMatchObject({
      runId: 'run-1',
      eventCount: 3,
      nextSequence: 3,
      start: { executor: 'stub', stubScenario: 'success' },
      summary: { status: 'succeeded', goalText: 'goal', reason: 'done' },
    });
    expect(v.snapshot.gateKind).toBeUndefined();
  });

  it('validates a cancelled/gate-required stream and records gateKind', () => {
    const v = new RunStreamValidator();
    v.accept(start());
    v.accept(event(1, 'gate.required', { kind: 'dod' }));
    v.accept(
      summary(2, { status: 'cancelled', terminationReason: 'gate-required' })
    );
    v.finish();
    expect(v.snapshot.gateKind).toBe('dod');
    expect(v.snapshot.summary?.terminationReason).toBe('gate-required');
  });

  it.each([
    {
      label: 'wrong schemaVersion',
      overrides: { schemaVersion: 'yellow-goal/run-event/v2' },
    },
    { label: 'missing schemaVersion', overrides: { schemaVersion: undefined } },
    { label: 'empty type', overrides: { type: '' } },
    { label: 'missing type', overrides: { type: undefined } },
  ])('rejects an envelope with $label', ({ overrides }) => {
    const validator = new RunStreamValidator();
    expectGoalError(
      () => validator.accept(start({}, overrides)),
      'GOAL_PROTOCOL_INVALID'
    );
  });

  it('rejects a runId change mid-stream', () => {
    const v = new RunStreamValidator();
    v.accept(start());
    expectGoalError(
      () => v.accept(event(1, 'progress', {}, { runId: 'run-2' })),
      'GOAL_PROTOCOL_INVALID'
    );
  });

  it('rejects a duplicate sequence', () => {
    const v = new RunStreamValidator();
    v.accept(start());
    expectGoalError(
      () => v.accept(event(0, 'progress')),
      'GOAL_PROTOCOL_INVALID'
    );
  });

  it('rejects a skipped sequence', () => {
    const v = new RunStreamValidator();
    v.accept(start());
    expectGoalError(
      () => v.accept(event(2, 'progress')),
      'GOAL_PROTOCOL_INVALID'
    );
  });

  it('rejects a negative sequence', () => {
    const v = new RunStreamValidator();
    expectGoalError(
      () => v.accept(start({}, { sequence: -1 })),
      'GOAL_PROTOCOL_INVALID'
    );
  });

  it('rejects a non-integer sequence', () => {
    const v = new RunStreamValidator();
    expectGoalError(
      () => v.accept(start({}, { sequence: 0.5 })),
      'GOAL_PROTOCOL_INVALID'
    );
  });

  it('rejects a stream missing run.start', () => {
    const v = new RunStreamValidator();
    expectGoalError(
      () => v.accept(event(0, 'progress')),
      'GOAL_PROTOCOL_INVALID'
    );
  });

  it('rejects a duplicate run.start', () => {
    const v = new RunStreamValidator();
    v.accept(start());
    expectGoalError(
      () => v.accept(start({}, { sequence: 1 })),
      'GOAL_PROTOCOL_INVALID'
    );
  });

  it('finish() rejects a stream that never saw run.start', () => {
    const v = new RunStreamValidator();
    expectGoalError(() => v.finish(), 'GOAL_PROTOCOL_INVALID');
  });

  it('finish() rejects a stream missing run.summary', () => {
    const v = new RunStreamValidator();
    v.accept(start());
    expectGoalError(() => v.finish(), 'GOAL_PROTOCOL_INVALID');
  });

  it('rejects a duplicate run.summary', () => {
    const v = new RunStreamValidator();
    v.accept(start());
    v.accept(summary(1));
    expectGoalError(() => v.accept(summary(2)), 'GOAL_PROTOCOL_INVALID');
  });

  it('rejects any event after run.summary', () => {
    const v = new RunStreamValidator();
    v.accept(start());
    v.accept(summary(1));
    expectGoalError(
      () => v.accept(event(2, 'progress')),
      'GOAL_PROTOCOL_INVALID'
    );
  });

  it('tolerates an unknown nonterminal event type', () => {
    const v = new RunStreamValidator();
    v.accept(start());
    expect(() => v.accept(event(1, 'totally.unknown'))).not.toThrow();
    v.accept(summary(2));
    expect(v.snapshot.eventCount).toBe(3);
  });

  it('rejects an unknown terminal status', () => {
    const v = new RunStreamValidator();
    v.accept(start());
    expectGoalError(
      () => v.accept(summary(1, { status: 'awaiting-acceptance' })),
      'GOAL_PROTOCOL_INVALID'
    );
  });

  it.each([
    ['non-string', 12345],
    ['unparseable', 'not-a-date'],
    ['missing timezone/offset', '2026-01-01T00:00:00'],
    ['space instead of T', '2026-01-01 00:00:00Z'],
    [
      'impossible day (Feb 30 normalized by Date.parse)',
      '2026-02-30T00:00:00Z',
    ],
    ['Feb 29 in a non-leap year', '2026-02-29T00:00:00Z'],
    ['Feb 29 in a century non-leap year', '2100-02-29T00:00:00Z'],
    ['month 13', '2026-13-01T00:00:00Z'],
    ['month 0', '2026-00-10T00:00:00Z'],
    ['day 0', '2026-01-00T00:00:00Z'],
    ['day 31 in a 30-day month', '2026-04-31T00:00:00Z'],
    ['hour 24', '2026-01-01T24:00:00Z'],
    ['minute 60', '2026-01-01T00:60:00Z'],
    ['second 61', '2026-01-01T00:00:61Z'],
    ['offset hour 24', '2026-01-01T00:00:00+24:00'],
    ['offset minute 60', '2026-01-01T00:00:00+00:60'],
  ])('rejects an invalid timestamp: %s', (_label, timestamp) => {
    const v = new RunStreamValidator();
    expectGoalError(
      () => v.accept(start({}, { timestamp })),
      'GOAL_PROTOCOL_INVALID'
    );
  });

  it.each([
    ['UTC with fraction', '2026-01-01T00:00:00.123Z'],
    ['leap day in a leap year', '2024-02-29T23:59:59Z'],
    ['leap day in a 400-year', '2000-02-29T00:00:00Z'],
    ['leap second', '2026-06-30T23:59:60Z'],
    ['negative offset', '2026-01-01T00:00:00-07:00'],
    ['positive offset', '2026-12-31T23:59:59+13:45'],
  ])('accepts a strict RFC 3339 timestamp: %s', (_label, timestamp) => {
    const v = new RunStreamValidator();
    v.accept(start({}, { timestamp }));
    expect(v.snapshot.eventCount).toBe(1);
  });

  it('rejects an array payload', () => {
    const v = new RunStreamValidator();
    expectGoalError(
      () => v.accept(start({}, { payload: [] })),
      'GOAL_PROTOCOL_INVALID'
    );
  });

  it.each([
    ['missing goalText', { goalText: undefined }],
    ['non-finite costUsd', { costUsd: Number.POSITIVE_INFINITY }],
    ['negative costUsd', { costUsd: -1 }],
    ['non-integer replans', { replans: 1.5 }],
    ['negative reextractions', { reextractions: -1 }],
    ['non-array actions', { actions: 'nope' }],
    ['non-string reason', { reason: 42 }],
  ])('rejects a malformed summary field: %s', (_label, overrides) => {
    const v = new RunStreamValidator();
    v.accept(start());
    expectGoalError(
      () => v.accept(summary(1, overrides)),
      'GOAL_PROTOCOL_INVALID'
    );
  });

  it.each([
    ['missing actionId', { actionId: undefined }],
    ['invalid status', { status: 'pending' }],
    ['negative attempts', { attempts: -1 }],
    ['non-finite costUsd', { costUsd: Number.NaN }],
  ])('rejects a malformed summary action: %s', (_label, actionOverrides) => {
    const v = new RunStreamValidator();
    v.accept(start());
    expectGoalError(
      () =>
        v.accept(
          summary(1, {
            actions: [
              {
                actionId: 'a1',
                status: 'succeeded',
                attempts: 1,
                costUsd: 0,
                ...actionOverrides,
              },
            ],
          })
        ),
      'GOAL_PROTOCOL_INVALID'
    );
  });

  it('rejects a cancelled summary without a terminationReason', () => {
    const v = new RunStreamValidator();
    v.accept(start());
    expectGoalError(
      () => v.accept(summary(1, { status: 'cancelled' })),
      'GOAL_PROTOCOL_INVALID'
    );
  });

  it('rejects a cancelled summary with an invalid terminationReason', () => {
    const v = new RunStreamValidator();
    v.accept(start());
    expectGoalError(
      () =>
        v.accept(
          summary(1, { status: 'cancelled', terminationReason: 'bogus' })
        ),
      'GOAL_PROTOCOL_INVALID'
    );
  });

  it('rejects a non-cancelled summary that carries a terminationReason', () => {
    const v = new RunStreamValidator();
    v.accept(start());
    expectGoalError(
      () =>
        v.accept(
          summary(1, { status: 'succeeded', terminationReason: 'signal' })
        ),
      'GOAL_PROTOCOL_INVALID'
    );
  });

  it.each(['dod', 'reconfirm', 'acceptance'])(
    'accepts gate.required kind %s',
    (kind) => {
      const v = new RunStreamValidator();
      v.accept(start());
      expect(() => v.accept(event(1, 'gate.required', { kind }))).not.toThrow();
      expect(v.snapshot.gateKind).toBe(kind);
    }
  );

  it('rejects an invalid gate.required kind', () => {
    const v = new RunStreamValidator();
    v.accept(start());
    expectGoalError(
      () => v.accept(event(1, 'gate.required', { kind: 'other' })),
      'GOAL_PROTOCOL_INVALID'
    );
  });

  it('retains the first observed gate.required kind', () => {
    const v = new RunStreamValidator();
    v.accept(start());
    v.accept(event(1, 'gate.required', { kind: 'dod' }));
    v.accept(event(2, 'gate.required', { kind: 'reconfirm' }));
    expect(v.snapshot.gateKind).toBe('dod');
  });
});

describe('validateTerminalAgreement', () => {
  function stderrOf(code: string, message = 'diagnostic'): Buffer {
    return Buffer.from(`${JSON.stringify({ error: { code, message } })}\n`);
  }

  function succeededSummary(): ValidatedSummary {
    return {
      status: 'succeeded',
      goalText: 'g',
      costUsd: 0,
      replans: 0,
      reextractions: 0,
      actions: [],
      reason: 'done',
    };
  }

  function failedSummary(): ValidatedSummary {
    return {
      status: 'failed',
      goalText: 'g',
      costUsd: 0,
      replans: 0,
      reextractions: 0,
      actions: [],
      reason: 'deterministic stub failure',
    };
  }

  function budgetSummary(): ValidatedSummary {
    return {
      status: 'budget-exhausted',
      goalText: 'g',
      costUsd: 20,
      replans: 0,
      reextractions: 0,
      actions: [],
      reason: 'budget exhausted',
    };
  }

  function cancelledSummary(
    terminationReason: 'signal' | 'timeout' | 'gate-required'
  ): ValidatedSummary {
    return {
      status: 'cancelled',
      goalText: 'g',
      costUsd: 0,
      replans: 0,
      reextractions: 0,
      actions: [],
      reason: 'cancelled',
      terminationReason,
    };
  }

  it('classifies RUN_STDOUT_TRANSPORT_FAILED as transport ahead of any summary', () => {
    for (const summary of [
      succeededSummary(),
      failedSummary(),
      cancelledSummary('signal'),
    ]) {
      expectGoalError(
        () =>
          validateTerminalAgreement({
            exitCode: 1,
            signal: null,
            stderr: stderrOf('RUN_STDOUT_TRANSPORT_FAILED', 'drain timeout'),
            summary,
          }),
        'GOAL_PROTOCOL_TRANSPORT'
      );
    }
  });

  it('rejects exit 0 with a failed summary', () => {
    expectGoalError(
      () =>
        validateTerminalAgreement({
          exitCode: 0,
          signal: null,
          stderr: Buffer.alloc(0),
          summary: failedSummary(),
        }),
      'GOAL_PROTOCOL_INVALID'
    );
  });

  it('rejects stderr over the consumer stderr bound as transport', () => {
    const oversized = Buffer.concat([
      Buffer.from('{"error":{"code":"RUN_FAILED","message":"'),
      Buffer.alloc(CONSUMER_LIMITS.maxStderrBytes, 0x61),
      Buffer.from('"}}\n'),
    ]);
    expectGoalError(
      () =>
        validateTerminalAgreement({
          exitCode: 1,
          signal: null,
          stderr: oversized,
          summary: failedSummary(),
        }),
      'GOAL_PROTOCOL_TRANSPORT'
    );
  });

  it('succeeded: exit 0, empty stderr, no signal', () => {
    const outcome = validateTerminalAgreement({
      exitCode: 0,
      signal: null,
      stderr: Buffer.alloc(0),
      summary: succeededSummary(),
    });
    expect(outcome).toEqual({ kind: 'succeeded' });
  });

  it('failed: exit 1, RUN_FAILED stderr', () => {
    const outcome = validateTerminalAgreement({
      exitCode: 1,
      signal: null,
      stderr: stderrOf('RUN_FAILED', 'deterministic stub failure'),
      summary: failedSummary(),
    });
    expect(outcome).toMatchObject({
      kind: 'engine-terminal',
      code: 'GOAL_RUN_FAILED',
      engineCode: 'RUN_FAILED',
    });
  });

  it('budget-exhausted: exit 1, RUN_BUDGET_EXHAUSTED stderr', () => {
    const outcome = validateTerminalAgreement({
      exitCode: 1,
      signal: null,
      stderr: stderrOf('RUN_BUDGET_EXHAUSTED', 'budget exhausted'),
      summary: budgetSummary(),
    });
    expect(outcome).toMatchObject({
      kind: 'engine-terminal',
      code: 'GOAL_RUN_BUDGET_EXHAUSTED',
    });
  });

  it('cancelled/signal: exit 1, RUN_CANCELLED stderr', () => {
    const outcome = validateTerminalAgreement({
      exitCode: 1,
      signal: null,
      stderr: stderrOf('RUN_CANCELLED', 'cancelled'),
      summary: cancelledSummary('signal'),
    });
    expect(outcome).toMatchObject({
      kind: 'engine-terminal',
      code: 'GOAL_RUN_CANCELLED',
    });
  });

  it('cancelled/timeout: exit 1, RUN_TIMEOUT stderr', () => {
    const outcome = validateTerminalAgreement({
      exitCode: 1,
      signal: null,
      stderr: stderrOf('RUN_TIMEOUT', 'cancelled'),
      summary: cancelledSummary('timeout'),
    });
    expect(outcome).toMatchObject({
      kind: 'engine-terminal',
      code: 'GOAL_RUN_ENGINE_TIMEOUT',
    });
  });

  it('cancelled/gate-required: exit 1, RUN_GATE_REQUIRED stderr, observed gate', () => {
    const outcome = validateTerminalAgreement({
      exitCode: 1,
      signal: null,
      stderr: stderrOf('RUN_GATE_REQUIRED', 'cancelled'),
      summary: cancelledSummary('gate-required'),
      gateKind: 'dod',
    });
    expect(outcome).toMatchObject({
      kind: 'engine-terminal',
      code: 'GOAL_RUN_GATE_REQUIRED',
    });
  });

  it('rejects a signal exit even with an otherwise-agreeing summary', () => {
    expectGoalError(
      () =>
        validateTerminalAgreement({
          exitCode: null,
          signal: 'SIGTERM',
          stderr: Buffer.alloc(0),
          summary: succeededSummary(),
        }),
      'GOAL_PROTOCOL_INVALID'
    );
  });

  it('rejects succeeded with the wrong exit code', () => {
    expectGoalError(
      () =>
        validateTerminalAgreement({
          exitCode: 1,
          signal: null,
          stderr: Buffer.alloc(0),
          summary: succeededSummary(),
        }),
      'GOAL_PROTOCOL_INVALID'
    );
  });

  it('rejects non-empty stderr on success', () => {
    expectGoalError(
      () =>
        validateTerminalAgreement({
          exitCode: 0,
          signal: null,
          stderr: Buffer.from('unexpected\n'),
          summary: succeededSummary(),
        }),
      'GOAL_PROTOCOL_INVALID'
    );
  });

  it('rejects empty stderr on failure', () => {
    expectGoalError(
      () =>
        validateTerminalAgreement({
          exitCode: 1,
          signal: null,
          stderr: Buffer.alloc(0),
          summary: failedSummary(),
        }),
      'GOAL_PROTOCOL_INVALID'
    );
  });

  it('rejects multiline stderr on failure', () => {
    expectGoalError(
      () =>
        validateTerminalAgreement({
          exitCode: 1,
          signal: null,
          stderr: Buffer.concat([
            stderrOf('RUN_FAILED'),
            stderrOf('RUN_FAILED'),
          ]),
          summary: failedSummary(),
        }),
      'GOAL_PROTOCOL_INVALID'
    );
  });

  it('treats unterminated stderr as a transport failure', () => {
    expectGoalError(
      () =>
        validateTerminalAgreement({
          exitCode: 1,
          signal: null,
          stderr: Buffer.from(
            JSON.stringify({ error: { code: 'RUN_FAILED', message: 'x' } })
          ),
          summary: failedSummary(),
        }),
      'GOAL_PROTOCOL_TRANSPORT'
    );
  });

  it('rejects whitespace-only stderr on failure', () => {
    expectGoalError(
      () =>
        validateTerminalAgreement({
          exitCode: 1,
          signal: null,
          stderr: Buffer.from('   \n'),
          summary: failedSummary(),
        }),
      'GOAL_PROTOCOL_INVALID'
    );
  });

  it('rejects a stderr code that disagrees with the summary status', () => {
    expectGoalError(
      () =>
        validateTerminalAgreement({
          exitCode: 1,
          signal: null,
          stderr: stderrOf('RUN_BUDGET_EXHAUSTED'),
          summary: failedSummary(),
        }),
      'GOAL_PROTOCOL_INVALID'
    );
  });

  it('rejects gate-required with no observed gate.required kind', () => {
    expectGoalError(
      () =>
        validateTerminalAgreement({
          exitCode: 1,
          signal: null,
          stderr: stderrOf('RUN_GATE_REQUIRED'),
          summary: cancelledSummary('gate-required'),
        }),
      'GOAL_PROTOCOL_INVALID'
    );
  });
});

describe('classifyPreflightFailure', () => {
  function stderrOf(code: string, message = 'diagnostic'): Buffer {
    return Buffer.from(`${JSON.stringify({ error: { code, message } })}\n`);
  }

  it('classifies exit 2 + USAGE_ERROR as a usage error', () => {
    const err = classifyPreflightFailure({
      exitCode: 2,
      signal: null,
      stdout: Buffer.alloc(0),
      stderr: stderrOf('USAGE_ERROR', 'unknown flag --bogus'),
    });
    expect(err.code).toBe('GOAL_ENGINE_USAGE_ERROR');
    expect(err.message).toBe('unknown flag --bogus');
  });

  it('classifies exit 1 + a domain code as a failed engine call', () => {
    const err = classifyPreflightFailure({
      exitCode: 1,
      signal: null,
      stdout: Buffer.alloc(0),
      stderr: stderrOf('VALIDATION_FAILED', 'bad request'),
    });
    expect(err.code).toBe('GOAL_ENGINE_FAILED');
    expect(err.message).toBe('VALIDATION_FAILED: bad request');
  });

  it.each([
    [
      'non-empty stdout',
      {
        exitCode: 1,
        signal: null,
        stdout: Buffer.from('x'),
        stderr: stderrOf('RUN_FAILED'),
      },
    ],
    [
      'a signal exit',
      {
        exitCode: null,
        signal: 'SIGTERM',
        stdout: Buffer.alloc(0),
        stderr: stderrOf('RUN_FAILED'),
      },
    ],
    [
      'exit 2 with a non-USAGE_ERROR code',
      {
        exitCode: 2,
        signal: null,
        stdout: Buffer.alloc(0),
        stderr: stderrOf('VALIDATION_FAILED'),
      },
    ],
    [
      'exit 1 with USAGE_ERROR',
      {
        exitCode: 1,
        signal: null,
        stdout: Buffer.alloc(0),
        stderr: stderrOf('USAGE_ERROR'),
      },
    ],
    [
      'an unexpected exit code',
      {
        exitCode: 3,
        signal: null,
        stdout: Buffer.alloc(0),
        stderr: stderrOf('RUN_FAILED'),
      },
    ],
    [
      'stderr missing an error object',
      {
        exitCode: 1,
        signal: null,
        stdout: Buffer.alloc(0),
        stderr: Buffer.from('{}\n'),
      },
    ],
    [
      'stderr with non-string code/message',
      {
        exitCode: 1,
        signal: null,
        stdout: Buffer.alloc(0),
        stderr: Buffer.from('{"error":{"code":1,"message":2}}\n'),
      },
    ],
    [
      'empty stderr',
      {
        exitCode: 1,
        signal: null,
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
      },
    ],
  ])('classifies %s as protocol-invalid', (_label, input) => {
    const err = classifyPreflightFailure(
      input as {
        exitCode: number | null;
        signal: string | null;
        stdout: Buffer;
        stderr: Buffer;
      }
    );
    expect(err.code).toBe('GOAL_PROTOCOL_INVALID');
  });
});

describe('GoalEngineError diagnostics extras (errors.ts additive)', () => {
  it('caps bounded diagnostic strings at 200 characters', () => {
    const long = 'z'.repeat(500);
    const err = new GoalEngineError('GOAL_PROTOCOL_INVALID', 'x', {
      runId: long,
      terminalStatus: long,
      terminationReason: long,
      gateKind: long,
    });
    expect(err.runId).toHaveLength(200);
    expect(err.terminalStatus).toHaveLength(200);
    expect(err.terminationReason).toHaveLength(200);
    expect(err.gateKind).toHaveLength(200);
  });

  it('drops an out-of-range eventCount instead of throwing', () => {
    expect(
      new GoalEngineError('GOAL_PROTOCOL_INVALID', 'x', { eventCount: -1 })
        .eventCount
    ).toBeUndefined();
    expect(
      new GoalEngineError('GOAL_PROTOCOL_INVALID', 'x', { eventCount: 1.5 })
        .eventCount
    ).toBeUndefined();
    expect(
      new GoalEngineError('GOAL_PROTOCOL_INVALID', 'x', { eventCount: 3 })
        .eventCount
    ).toBe(3);
  });

  it('serializes only defined optional diagnostics in toJson()', () => {
    const err = new GoalEngineError('GOAL_RUN_CANCELLED', 'x', {
      runId: 'run-1',
      localCause: 'caller-cancelled',
    });
    const json = err.toJson();
    expect(json.runId).toBe('run-1');
    expect(json.localCause).toBe('caller-cancelled');
    expect(Reflect.has(json, 'gateKind')).toBe(false);
    expect(Reflect.has(json, 'eventCount')).toBe(false);
  });

  it.each<[GoalErrorCode, boolean]>([
    ['GOAL_PROTOCOL_INCOMPATIBLE', false],
    ['GOAL_PROTOCOL_INVALID', false],
    ['GOAL_PROTOCOL_TRANSPORT', true],
    ['GOAL_RUN_FAILED', false],
    ['GOAL_RUN_BUDGET_EXHAUSTED', false],
    ['GOAL_RUN_GATE_REQUIRED', false],
    ['GOAL_RUN_ENGINE_TIMEOUT', false],
    ['GOAL_RUN_CANCELLED', false],
    ['GOAL_RUN_DEADLINE_EXCEEDED', true],
  ])('%s sets retryable=%s', (code, expectedRetryable) => {
    const err = new GoalEngineError(code, 'x');
    expect(err.retryable).toBe(expectedRetryable);
    expect(typeof err.recoveryAction).toBe('string');
    expect(err.recoveryAction.length).toBeGreaterThan(0);
  });
});
