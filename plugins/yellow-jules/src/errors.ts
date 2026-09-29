/**
 * Stable app-level error codes for the yellow-jules CLI, plus the
 * transport-neutral adapter-error normalization boundary. This module has
 * zero dependency on `@google/jules-sdk` — sdk-adapter.ts is the only file
 * that classifies SDK error classes (by `instanceof`, most-derived first);
 * it constructs AdapterError instances (defined here), and this module maps
 * those to the JULES_* code table below by call phase.
 *
 * The code table and its default recovery actions are the contract's
 * "Error catalog" (docs/yellow-jules/contract-v1.md); call sites may
 * override `recoveryAction` with a more specific instruction.
 */

export type AdapterErrorKind =
  | 'auth'
  | 'rate-limited'
  | 'source-not-found'
  | 'not-found'
  | 'invalid-request'
  | 'server-error'
  | 'network'
  | 'invalid-state'
  | 'timeout'
  | 'malformed';

/**
 * Where the failing call sat relative to a mutating request: before any
 * POST was sent, a read, or after a POST was dispatched with no clear
 * rejection. Only 'after-dispatch' can produce JULES_UNKNOWN_OUTCOME (R16).
 */
export type CallPhase = 'pre-dispatch' | 'read' | 'after-dispatch';

export interface AdapterErrorOptions {
  readonly requestId?: string;
  readonly status?: number;
  readonly cause?: unknown;
}

export class AdapterError extends Error {
  readonly kind: AdapterErrorKind;
  readonly requestId: string | undefined;
  readonly status: number | undefined;

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
    this.status = options.status;
  }
}

export type AppErrorCode =
  | 'JULES_AUTH_FAILED'
  | 'JULES_INVALID_INPUT'
  | 'JULES_SOURCE_ACCESS'
  | 'JULES_RATE_LIMITED'
  | 'JULES_SERVICE_UNAVAILABLE'
  | 'JULES_NOT_FOUND'
  | 'JULES_MALFORMED_RESPONSE'
  | 'JULES_INVALID_STATE'
  | 'JULES_UNSUPPORTED_CAPABILITY'
  | 'JULES_UNKNOWN_OUTCOME'
  | 'JULES_JOURNAL_CORRUPT'
  | 'JULES_DUPLICATE_LAUNCH'
  | 'JULES_CONFIRMATION_REQUIRED'
  | 'JULES_AUTHORITY_DENIED'
  | 'JULES_GRANT_EXPIRED'
  | 'JULES_POLICY_DEVIATION'
  | 'JULES_DEADLINE_EXCEEDED'
  | 'JULES_STALE_LOCK'
  | 'JULES_NO_PROGRESS'
  | 'JULES_SDK_MISSING'
  | 'JULES_SDK_INTEGRITY'
  | 'JULES_DATA_DIR';

// replica:AppError:start
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
// replica:AppError:end

const CODE_TABLE: Record<AppErrorCode, CodeDefaults> = {
  JULES_AUTH_FAILED: {
    retryable: false,
    recoveryAction: 'Set JULES_API_KEY (401/403 or missing key), then retry.',
  },
  JULES_INVALID_INPUT: {
    retryable: false,
    recoveryAction: 'Fix the reported input or invocation and retry.',
  },
  JULES_SOURCE_ACCESS: {
    retryable: false,
    recoveryAction:
      'Connect the repository to Jules; sources are discovered, never synthesized.',
  },
  JULES_RATE_LIMITED: {
    retryable: true,
    recoveryAction:
      'Wait at least 60 s and retry; the runtime never retries a 429 itself.',
  },
  JULES_SERVICE_UNAVAILABLE: {
    retryable: true,
    recoveryAction: 'Retry later; this is a transient Jules service issue.',
  },
  JULES_NOT_FOUND: {
    retryable: false,
    recoveryAction: 'Verify the session or activity reference.',
  },
  JULES_MALFORMED_RESPONSE: {
    retryable: false,
    recoveryAction:
      'Report this; the Jules SDK response shape was unexpected. Re-verify the SDK pin with /jules:setup.',
  },
  JULES_INVALID_STATE: {
    retryable: false,
    recoveryAction:
      'The session is not awaiting approval, or its pending plan could not be completely re-read; run status.',
  },
  JULES_UNSUPPORTED_CAPABILITY: {
    retryable: false,
    recoveryAction:
      'This capability is not available on the Jules vendor contract; no retry will help.',
  },
  JULES_UNKNOWN_OUTCOME: {
    retryable: false,
    recoveryAction:
      'Run status --reconcile (a delegate), or status --session <ref> --reconcile (a reply or approve); never relaunch.',
  },
  JULES_JOURNAL_CORRUPT: {
    retryable: false,
    recoveryAction:
      'Reconcile state/journal.json by hand; writes are blocked until it parses.',
  },
  JULES_DUPLICATE_LAUNCH: {
    retryable: false,
    recoveryAction:
      'An unresolved operation exists for this repository and branch; run status --reconcile first.',
  },
  JULES_CONFIRMATION_REQUIRED: {
    retryable: false,
    recoveryAction:
      'Confirm through the command wrapper, or pass a grant written by authorize.',
  },
  JULES_AUTHORITY_DENIED: {
    retryable: false,
    recoveryAction:
      'The grant does not cover this operation, repository, branch, or limit.',
  },
  JULES_GRANT_EXPIRED: {
    retryable: false,
    recoveryAction:
      'The grant or deadline expired; the remote session may still run. Stop it from the Jules console, revoke the source connection, or rotate JULES_API_KEY.',
  },
  JULES_POLICY_DEVIATION: {
    retryable: false,
    recoveryAction:
      'A vendor PR, plan change, or repository mismatch was observed; reconcile before any further write.',
  },
  JULES_DEADLINE_EXCEEDED: {
    retryable: false,
    recoveryAction:
      'The operation deadline fired before any write was dispatched; retry with a larger --deadline-ms.',
  },
  JULES_STALE_LOCK: {
    retryable: false,
    recoveryAction:
      'A lock from a crashed process exists at state/.lock; inspect it and remove it by hand.',
  },
  JULES_NO_PROGRESS: {
    retryable: false,
    recoveryAction:
      'Two consecutive activity walks restarted without advancing; run status later, and re-verify the SDK pin if it recurs.',
  },
  JULES_SDK_MISSING: {
    retryable: false,
    recoveryAction: 'Run /jules:setup to install the pinned Jules SDK.',
  },
  JULES_SDK_INTEGRITY: {
    retryable: false,
    recoveryAction:
      'The SDK tarball, entry file, or storage binding failed verification; do not use it. Reinstall with /jules:setup.',
  },
  JULES_DATA_DIR: {
    retryable: false,
    recoveryAction:
      'Make the data directory owner-only (0700), owned by you, outside any git work tree and the plugin directory, with a writable sdk-scratch/.',
  },
};

// replica:makeAppError:start
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
// replica:makeAppError:end

export const ALL_APP_ERROR_CODES: readonly AppErrorCode[] = Object.freeze(
  Object.keys(CODE_TABLE) as AppErrorCode[]
);

/** The contract's "Pre-dispatch or read" column. */
const KIND_TO_CODE: Record<AdapterErrorKind, AppErrorCode> = {
  auth: 'JULES_AUTH_FAILED',
  'rate-limited': 'JULES_RATE_LIMITED',
  'source-not-found': 'JULES_SOURCE_ACCESS',
  'not-found': 'JULES_NOT_FOUND',
  'invalid-request': 'JULES_INVALID_INPUT',
  'server-error': 'JULES_SERVICE_UNAVAILABLE',
  network: 'JULES_SERVICE_UNAVAILABLE',
  'invalid-state': 'JULES_INVALID_STATE',
  timeout: 'JULES_DEADLINE_EXCEEDED',
  malformed: 'JULES_MALFORMED_RESPONSE',
};

/**
 * The contract's "After dispatch" column: only a clear rejection keeps its
 * code. Everything else — including a kind added later — falls through to
 * JULES_UNKNOWN_OUTCOME (the default rule, R16), because a POST may have
 * been accepted and relaunching would duplicate it.
 */
const CLEAR_REJECTION_AFTER_DISPATCH: Partial<
  Record<AdapterErrorKind, AppErrorCode>
> = {
  auth: 'JULES_AUTH_FAILED',
  'rate-limited': 'JULES_RATE_LIMITED',
  'not-found': 'JULES_NOT_FOUND',
  'invalid-request': 'JULES_INVALID_INPUT',
  'invalid-state': 'JULES_INVALID_STATE',
};

export function mapAdapterError(err: AdapterError, phase: CallPhase): AppError {
  const code =
    phase === 'after-dispatch'
      ? (CLEAR_REJECTION_AFTER_DISPATCH[err.kind] ?? 'JULES_UNKNOWN_OUTCOME')
      : (KIND_TO_CODE[err.kind] ?? 'JULES_MALFORMED_RESPONSE');
  return makeAppError(code, err.message, {
    ...(err.requestId !== undefined ? { requestId: err.requestId } : {}),
  });
}

/**
 * Converts anything caught at a layer boundary into an AppError, without
 * ever leaking a raw stack trace into the value. An unclassified throw is
 * JULES_MALFORMED_RESPONSE before dispatch and JULES_UNKNOWN_OUTCOME after.
 */
export function toAppError(err: unknown, phase: CallPhase = 'read'): AppError {
  if (err instanceof AppErrorException) {
    return err.appError;
  }
  if (err instanceof AdapterError) {
    return mapAdapterError(err, phase);
  }
  const message = err instanceof Error ? err.message : String(err);
  return makeAppError(
    phase === 'after-dispatch'
      ? 'JULES_UNKNOWN_OUTCOME'
      : 'JULES_MALFORMED_RESPONSE',
    message
  );
}
