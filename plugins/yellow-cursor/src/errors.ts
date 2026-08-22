/**
 * Stable app-level error codes for the yellow-cursor CLI, plus the SDK-error
 * normalization boundary. This module has zero dependency on `@cursor/sdk` —
 * sdk-adapter.ts is the only file that imports the SDK and does `instanceof`
 * checks against its exported error classes; it constructs AdapterError
 * instances (defined here) after classifying, and this module maps those to
 * the stable CURSOR_* code table below.
 */

export type AdapterErrorKind =
  | 'auth'
  | 'rate_limited'
  | 'invalid_input'
  | 'repo_access'
  | 'agent_busy'
  | 'service_unavailable'
  | 'not_found'
  | 'malformed_response'
  | 'unknown';

export interface AdapterErrorOptions {
  readonly requestId?: string;
  readonly isRetryable?: boolean;
  readonly cause?: unknown;
}

export class AdapterError extends Error {
  readonly kind: AdapterErrorKind;
  readonly requestId: string | undefined;
  readonly isRetryable: boolean;

  constructor(
    kind: AdapterErrorKind,
    message: string,
    options: AdapterErrorOptions = {}
  ) {
    super(
      message,
      options.cause !== undefined ? { cause: options.cause } : undefined
    );
    this.name = 'AdapterError';
    this.kind = kind;
    this.requestId = options.requestId;
    this.isRetryable = options.isRetryable ?? false;
  }
}

export type AppErrorCode =
  | 'CURSOR_AUTH_FAILED'
  | 'CURSOR_REPO_ACCESS'
  | 'CURSOR_INVALID_INPUT'
  | 'CURSOR_AGENT_BUSY'
  | 'CURSOR_RATE_LIMITED'
  | 'CURSOR_SERVICE_UNAVAILABLE'
  | 'CURSOR_NOT_FOUND'
  | 'CURSOR_UNSUPPORTED_CAPABILITY'
  | 'CURSOR_MALFORMED_RESPONSE'
  | 'CURSOR_STATE_CORRUPT'
  | 'CURSOR_DUPLICATE_LAUNCH'
  | 'CURSOR_CONFIRMATION_REQUIRED'
  | 'CURSOR_SDK_MISSING'
  | 'CURSOR_NESTED_DELEGATION'
  | 'CURSOR_CONCURRENCY_LIMIT'
  | 'CURSOR_UNKNOWN_OUTCOME';

export interface AppError {
  readonly code: AppErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly requestId?: string;
  readonly recoveryAction: string;
}

interface CodeDefaults {
  readonly retryable: boolean;
  readonly recoveryAction: string;
}

const CODE_TABLE: Record<AppErrorCode, CodeDefaults> = {
  CURSOR_AUTH_FAILED: {
    retryable: false,
    recoveryAction:
      'Set CURSOR_API_KEY or run `cursor auth login`, then retry.',
  },
  CURSOR_REPO_ACCESS: {
    retryable: false,
    recoveryAction:
      "Connect the repository's source control integration in Cursor, then retry.",
  },
  CURSOR_INVALID_INPUT: {
    retryable: false,
    recoveryAction: 'Fix the reported input and retry.',
  },
  CURSOR_AGENT_BUSY: {
    retryable: true,
    recoveryAction: 'Wait for the current run to finish, then retry.',
  },
  CURSOR_RATE_LIMITED: {
    retryable: true,
    recoveryAction: 'Wait and retry with backoff.',
  },
  CURSOR_SERVICE_UNAVAILABLE: {
    retryable: true,
    recoveryAction: 'Retry later; this is a transient Cursor service issue.',
  },
  CURSOR_NOT_FOUND: {
    retryable: false,
    recoveryAction: 'Verify the id and retry.',
  },
  CURSOR_UNSUPPORTED_CAPABILITY: {
    retryable: false,
    recoveryAction:
      'This capability is not available for the current SDK/account; retrying will not help.',
  },
  CURSOR_MALFORMED_RESPONSE: {
    retryable: false,
    recoveryAction:
      'Retry; if this persists, report it — the SDK response shape may be unexpected.',
  },
  CURSOR_STATE_CORRUPT: {
    retryable: false,
    recoveryAction:
      'The corrupt local record was quarantined; run status --reconcile to rebuild it from remote state.',
  },
  CURSOR_DUPLICATE_LAUNCH: {
    retryable: false,
    recoveryAction:
      'An operation with this idempotency key is already in flight; run status instead of relaunching.',
  },
  CURSOR_CONFIRMATION_REQUIRED: {
    retryable: false,
    recoveryAction: 'Re-run with --yes to confirm this action.',
  },
  CURSOR_SDK_MISSING: {
    retryable: false,
    recoveryAction: 'Run /cursor:setup to install the Cursor SDK.',
  },
  CURSOR_NESTED_DELEGATION: {
    retryable: false,
    recoveryAction:
      'Refusing to delegate from inside a remote agent run; run this from a non-agent context.',
  },
  CURSOR_CONCURRENCY_LIMIT: {
    retryable: false,
    recoveryAction:
      'Wait for an active agent to finish, or raise --max-active.',
  },
  CURSOR_UNKNOWN_OUTCOME: {
    retryable: false,
    recoveryAction:
      'Outcome unknown after a network interruption; run status --reconcile to determine what happened.',
  },
};

export function makeAppError(
  code: AppErrorCode,
  message: string,
  overrides: Partial<
    Pick<AppError, 'retryable' | 'requestId' | 'recoveryAction'>
  > = {}
): AppError {
  const defaults = CODE_TABLE[code];
  return {
    code,
    message,
    retryable: overrides.retryable ?? defaults.retryable,
    recoveryAction: overrides.recoveryAction ?? defaults.recoveryAction,
    ...(overrides.requestId !== undefined
      ? { requestId: overrides.requestId }
      : {}),
  };
}

/** Thrown by any layer (validate.ts, state.ts, sdk-resolver.ts, runtime.ts) to carry a fully-formed AppError to cli.ts. */
export class AppErrorException extends Error {
  readonly appError: AppError;

  constructor(appError: AppError) {
    super(appError.message);
    this.name = 'AppErrorException';
    this.appError = appError;
  }
}

export function throwAppError(
  code: AppErrorCode,
  message: string,
  overrides: Partial<
    Pick<AppError, 'retryable' | 'requestId' | 'recoveryAction'>
  > = {}
): never {
  throw new AppErrorException(makeAppError(code, message, overrides));
}

const KIND_TO_CODE: Record<AdapterErrorKind, AppErrorCode> = {
  auth: 'CURSOR_AUTH_FAILED',
  rate_limited: 'CURSOR_RATE_LIMITED',
  invalid_input: 'CURSOR_INVALID_INPUT',
  repo_access: 'CURSOR_REPO_ACCESS',
  agent_busy: 'CURSOR_AGENT_BUSY',
  service_unavailable: 'CURSOR_SERVICE_UNAVAILABLE',
  not_found: 'CURSOR_NOT_FOUND',
  malformed_response: 'CURSOR_MALFORMED_RESPONSE',
  unknown: 'CURSOR_MALFORMED_RESPONSE',
};

export function mapAdapterError(err: AdapterError): AppError {
  const code = KIND_TO_CODE[err.kind];
  return makeAppError(code, err.message, {
    retryable: err.isRetryable,
    ...(err.requestId !== undefined ? { requestId: err.requestId } : {}),
  });
}

/** Converts anything caught at a layer boundary into an AppError, without ever leaking a raw stack trace into the value. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppErrorException) {
    return err.appError;
  }
  if (err instanceof AdapterError) {
    return mapAdapterError(err);
  }
  const message = err instanceof Error ? err.message : String(err);
  return makeAppError('CURSOR_MALFORMED_RESPONSE', message);
}
