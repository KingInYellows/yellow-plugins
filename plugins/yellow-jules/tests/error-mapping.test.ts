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
import {
  classifyAdapterError,
  type SdkModule,
  toAdapterError,
} from '../src/sdk-adapter.js';

describe('code table', () => {
  it('holds exactly the 26 contract codes, each with a recovery action', () => {
    expect(ALL_APP_ERROR_CODES).toHaveLength(26);
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

// The real pinned SDK's error classes, loaded from the workspace install.
const sdk = (await import('@google/jules-sdk')) as unknown as SdkModule;

describe('classifyAdapterError: every SDK class by phase (contract table)', () => {
  const S = 'https://jules.googleapis.com/v1alpha/sessions';
  const SRC = 'https://jules.googleapis.com/v1alpha/sources/github/a/b';
  const rows: ReadonlyArray<
    [string, () => unknown, AppErrorCode, AppErrorCode]
  > = [
    [
      'MissingApiKeyError',
      () => new sdk.MissingApiKeyError(),
      'JULES_AUTH_FAILED',
      'JULES_AUTH_FAILED',
    ],
    [
      'JulesAuthenticationError 401',
      () => new sdk.JulesAuthenticationError(S, 401, 'Unauthorized'),
      'JULES_AUTH_FAILED',
      'JULES_AUTH_FAILED',
    ],
    [
      'JulesAuthenticationError 403',
      () => new sdk.JulesAuthenticationError(S, 403, 'Forbidden'),
      'JULES_AUTH_FAILED',
      'JULES_AUTH_FAILED',
    ],
    [
      'JulesRateLimitError',
      () => new sdk.JulesRateLimitError(S, 429, 'Too Many'),
      'JULES_RATE_LIMITED',
      'JULES_RATE_LIMITED',
    ],
    [
      'SourceNotFoundError',
      () => new sdk.SourceNotFoundError('a/b'),
      'JULES_SOURCE_ACCESS',
      'JULES_UNKNOWN_OUTCOME',
    ],
    [
      'JulesApiError 404 on /sources',
      () => new sdk.JulesApiError(SRC, 404, 'Not Found'),
      'JULES_SOURCE_ACCESS',
      'JULES_UNKNOWN_OUTCOME',
    ],
    [
      'JulesApiError 404 on /sessions',
      () => new sdk.JulesApiError(`${S}/x`, 404, 'Not Found'),
      'JULES_NOT_FOUND',
      'JULES_NOT_FOUND',
    ],
    [
      'JulesApiError 400',
      () => new sdk.JulesApiError(S, 400, 'Bad'),
      'JULES_INVALID_INPUT',
      'JULES_INVALID_INPUT',
    ],
    [
      'JulesApiError 409',
      () => new sdk.JulesApiError(S, 409, 'Conflict'),
      'JULES_INVALID_INPUT',
      'JULES_INVALID_INPUT',
    ],
    [
      'JulesApiError 422',
      () => new sdk.JulesApiError(S, 422, 'Unprocessable'),
      'JULES_INVALID_INPUT',
      'JULES_INVALID_INPUT',
    ],
    [
      'JulesApiError 500',
      () => new sdk.JulesApiError(S, 500, 'ISE'),
      'JULES_SERVICE_UNAVAILABLE',
      'JULES_UNKNOWN_OUTCOME',
    ],
    [
      'JulesApiError 503',
      () => new sdk.JulesApiError(S, 503, 'Unavailable'),
      'JULES_SERVICE_UNAVAILABLE',
      'JULES_UNKNOWN_OUTCOME',
    ],
    [
      'JulesNetworkError',
      () => new sdk.JulesNetworkError(S),
      'JULES_SERVICE_UNAVAILABLE',
      'JULES_UNKNOWN_OUTCOME',
    ],
    [
      'InvalidStateError',
      () => new sdk.InvalidStateError('nope'),
      'JULES_INVALID_STATE',
      'JULES_INVALID_STATE',
    ],
    [
      'TimeoutError',
      () => new sdk.TimeoutError('slow'),
      'JULES_DEADLINE_EXCEEDED',
      'JULES_UNKNOWN_OUTCOME',
    ],
    [
      'SyncInProgressError',
      () => new sdk.SyncInProgressError(),
      'JULES_MALFORMED_RESPONSE',
      'JULES_UNKNOWN_OUTCOME',
    ],
    [
      'AutomatedSessionFailedError',
      () => new sdk.AutomatedSessionFailedError('x'),
      'JULES_MALFORMED_RESPONSE',
      'JULES_UNKNOWN_OUTCOME',
    ],
    [
      'JulesError',
      () => new sdk.JulesError('x'),
      'JULES_MALFORMED_RESPONSE',
      'JULES_UNKNOWN_OUTCOME',
    ],
    [
      'mapper Error',
      () => new Error('Unknown activity type'),
      'JULES_MALFORMED_RESPONSE',
      'JULES_UNKNOWN_OUTCOME',
    ],
  ];

  it.each(rows)('%s', (_name, make, before, after) => {
    expect(classifyAdapterError(sdk, make(), 'pre-dispatch').code).toBe(before);
    expect(classifyAdapterError(sdk, make(), 'read').code).toBe(before);
    expect(classifyAdapterError(sdk, make(), 'after-dispatch').code).toBe(
      after
    );
  });

  it('classifies a 429 as rate-limited although it is also a JulesApiError (most-derived first)', () => {
    const err = new sdk.JulesRateLimitError(S, 429, 'Too Many');
    expect(err).toBeInstanceOf(sdk.JulesApiError);
    expect(toAdapterError(sdk, err).kind).toBe('rate-limited');
  });

  it.each([
    ['a dropped fetch', () => new TypeError('fetch failed')],
    [
      'an aborted request',
      () => Object.assign(new Error('aborted'), { name: 'AbortError' }),
    ],
    [
      'a wrapped socket reset',
      () =>
        new Error('wrapped', {
          cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }),
        }),
    ],
  ])('classifies %s as a network failure, not a malformed body', (_n, make) => {
    expect(toAdapterError(sdk, make()).kind).toBe('network');
  });

  it('still calls an unrecognised error malformed', () => {
    expect(toAdapterError(sdk, new Error('mapper broke')).kind).toBe(
      'malformed'
    );
  });

  it('redacts and truncates vendor error text', () => {
    process.env['JULES_API_KEY'] = 'live-key-for-redaction-test';
    try {
      const err = new sdk.JulesApiError(
        S,
        500,
        'ISE',
        `body live-key-for-redaction-test ${'x'.repeat(2000)}`
      );
      const message = classifyAdapterError(sdk, err, 'read').message;
      expect(message).not.toContain('live-key-for-redaction-test');
      expect(Buffer.byteLength(message)).toBeLessThan(600);
    } finally {
      delete process.env['JULES_API_KEY'];
    }
  });
});
