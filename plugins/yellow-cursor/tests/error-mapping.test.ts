import { describe, expect, it } from 'vitest';

import {
  AdapterError,
  mapAdapterError,
  type AdapterErrorKind,
  type AppErrorCode,
} from '../src/errors.js';

const CASES: ReadonlyArray<{
  kind: AdapterErrorKind;
  code: AppErrorCode;
  retryable: boolean;
}> = [
  { kind: 'auth', code: 'CURSOR_AUTH_FAILED', retryable: false },
  { kind: 'rate_limited', code: 'CURSOR_RATE_LIMITED', retryable: true },
  { kind: 'invalid_input', code: 'CURSOR_INVALID_INPUT', retryable: false },
  { kind: 'repo_access', code: 'CURSOR_REPO_ACCESS', retryable: false },
  { kind: 'agent_busy', code: 'CURSOR_AGENT_BUSY', retryable: false },
  {
    kind: 'service_unavailable',
    code: 'CURSOR_SERVICE_UNAVAILABLE',
    retryable: true,
  },
  { kind: 'not_found', code: 'CURSOR_NOT_FOUND', retryable: false },
  {
    kind: 'malformed_response',
    code: 'CURSOR_MALFORMED_RESPONSE',
    retryable: false,
  },
  { kind: 'unknown', code: 'CURSOR_MALFORMED_RESPONSE', retryable: false },
];

describe('mapAdapterError', () => {
  for (const { kind, code, retryable } of CASES) {
    it(`maps AdapterError kind "${kind}" to ${code}`, () => {
      const err = new AdapterError(kind, `${kind} failed`, {
        isRetryable: retryable,
        requestId: 'req-1',
      });
      const appError = mapAdapterError(err);
      expect(appError.code).toBe(code);
      expect(appError.retryable).toBe(retryable);
      expect(appError.requestId).toBe('req-1');
      expect(appError.recoveryAction.length).toBeGreaterThan(0);
    });
  }

  it('every mapped code carries a non-empty recoveryAction even without an explicit override', () => {
    const err = new AdapterError('service_unavailable', 'transient');
    const appError = mapAdapterError(err);
    expect(appError.recoveryAction).toMatch(/retry/i);
  });

  it('preserves the isRetryable flag actually observed on the error, not just the kind default', () => {
    const nonRetryableNetwork = new AdapterError(
      'service_unavailable',
      'permanent-looking network failure',
      {
        isRetryable: false,
      }
    );
    expect(mapAdapterError(nonRetryableNetwork).retryable).toBe(false);
  });
});
