import { describe, expect, it } from 'vitest';

import {
  ALL_APP_ERROR_CODES,
  AdapterError,
  type AdapterErrorKind,
  AppErrorException,
  type AppErrorCode,
  makeAppError,
  mapAdapterError,
  toAppError,
} from '../src/errors.js';

describe('code table', () => {
  it('holds exactly the 22 contract codes, each with a recovery action', () => {
    expect(ALL_APP_ERROR_CODES).toHaveLength(22);
    for (const code of ALL_APP_ERROR_CODES) {
      expect(code).toMatch(/^JULES_[A-Z_]+$/);
      expect(makeAppError(code, 'm').recoveryAction.length).toBeGreaterThan(0);
    }
  });

  it('only rate-limit and service-unavailable are retryable by default', () => {
    const retryable = ALL_APP_ERROR_CODES.filter(
      (c) => makeAppError(c, 'm').retryable
    );
    expect(retryable.sort()).toEqual([
      'JULES_RATE_LIMITED',
      'JULES_SERVICE_UNAVAILABLE',
    ]);
  });

  it('a call site may override recoveryAction and carries requestId', () => {
    const err = makeAppError('JULES_INVALID_STATE', 'm', {
      recoveryAction: 'run status',
      requestId: 'r1',
    });
    expect(err).toEqual({
      code: 'JULES_INVALID_STATE',
      message: 'm',
      retryable: false,
      recoveryAction: 'run status',
      requestId: 'r1',
    });
  });
});

// Contract "Error catalog": SDK class rows, expressed as the adapter kinds sdk-adapter.ts classifies them into.
const TABLE: ReadonlyArray<[AdapterErrorKind, AppErrorCode, AppErrorCode]> = [
  ['auth', 'JULES_AUTH_FAILED', 'JULES_AUTH_FAILED'],
  ['rate-limited', 'JULES_RATE_LIMITED', 'JULES_RATE_LIMITED'],
  ['source-not-found', 'JULES_SOURCE_ACCESS', 'JULES_UNKNOWN_OUTCOME'],
  ['not-found', 'JULES_NOT_FOUND', 'JULES_NOT_FOUND'],
  ['invalid-request', 'JULES_INVALID_INPUT', 'JULES_INVALID_INPUT'],
  ['server-error', 'JULES_SERVICE_UNAVAILABLE', 'JULES_UNKNOWN_OUTCOME'],
  ['network', 'JULES_SERVICE_UNAVAILABLE', 'JULES_UNKNOWN_OUTCOME'],
  ['invalid-state', 'JULES_INVALID_STATE', 'JULES_INVALID_STATE'],
  ['timeout', 'JULES_DEADLINE_EXCEEDED', 'JULES_UNKNOWN_OUTCOME'],
  ['malformed', 'JULES_MALFORMED_RESPONSE', 'JULES_UNKNOWN_OUTCOME'],
];

describe('mapAdapterError by phase', () => {
  it.each(TABLE)(
    '%s -> %s before dispatch or on a read, %s after dispatch',
    (kind, before, after) => {
      const err = new AdapterError(kind, 'boom', { requestId: 'req-9' });
      expect(mapAdapterError(err, 'pre-dispatch').code).toBe(before);
      expect(mapAdapterError(err, 'read').code).toBe(before);
      expect(mapAdapterError(err, 'after-dispatch').code).toBe(after);
      expect(mapAdapterError(err, 'read').requestId).toBe('req-9');
    }
  );

  it('default rule: an unrecognized kind after dispatch is JULES_UNKNOWN_OUTCOME', () => {
    const err = new AdapterError(
      'future-kind' as AdapterErrorKind,
      'new SDK class'
    );
    expect(mapAdapterError(err, 'after-dispatch').code).toBe(
      'JULES_UNKNOWN_OUTCOME'
    );
    expect(mapAdapterError(err, 'pre-dispatch').code).toBe(
      'JULES_MALFORMED_RESPONSE'
    );
  });
});

describe('toAppError', () => {
  it('passes an AppErrorException through unchanged', () => {
    const app = makeAppError('JULES_JOURNAL_CORRUPT', 'bad');
    expect(toAppError(new AppErrorException(app), 'after-dispatch')).toBe(app);
  });

  it('maps a non-SDK throw by phase', () => {
    expect(toAppError(new Error('x'), 'read').code).toBe(
      'JULES_MALFORMED_RESPONSE'
    );
    expect(toAppError(new Error('x'), 'pre-dispatch').code).toBe(
      'JULES_MALFORMED_RESPONSE'
    );
    expect(toAppError('string throw', 'after-dispatch').code).toBe(
      'JULES_UNKNOWN_OUTCOME'
    );
  });

  it('never carries a stack trace in the value', () => {
    const app = toAppError(new Error('x'));
    expect(JSON.stringify(app)).not.toContain('at ');
  });
});
