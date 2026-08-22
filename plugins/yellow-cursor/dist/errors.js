"use strict";
/**
 * Stable app-level error codes for the yellow-cursor CLI, plus the SDK-error
 * normalization boundary. This module has zero dependency on `@cursor/sdk` —
 * sdk-adapter.ts is the only file that imports the SDK and does `instanceof`
 * checks against its exported error classes; it constructs AdapterError
 * instances (defined here) after classifying, and this module maps those to
 * the stable CURSOR_* code table below.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppErrorException = exports.AdapterError = void 0;
exports.makeAppError = makeAppError;
exports.throwAppError = throwAppError;
exports.mapAdapterError = mapAdapterError;
exports.toAppError = toAppError;
class AdapterError extends Error {
    kind;
    requestId;
    isRetryable;
    constructor(kind, message, options = {}) {
        super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
        this.name = 'AdapterError';
        this.kind = kind;
        this.requestId = options.requestId;
        this.isRetryable = options.isRetryable ?? false;
    }
}
exports.AdapterError = AdapterError;
const CODE_TABLE = {
    CURSOR_AUTH_FAILED: {
        retryable: false,
        recoveryAction: 'Set CURSOR_API_KEY or run `cursor auth login`, then retry.',
    },
    CURSOR_REPO_ACCESS: {
        retryable: false,
        recoveryAction: "Connect the repository's source control integration in Cursor, then retry.",
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
        recoveryAction: 'This capability is not available for the current SDK/account; retrying will not help.',
    },
    CURSOR_MALFORMED_RESPONSE: {
        retryable: false,
        recoveryAction: 'Retry; if this persists, report it — the SDK response shape may be unexpected.',
    },
    CURSOR_STATE_CORRUPT: {
        retryable: false,
        recoveryAction: 'The corrupt local record was quarantined; run status --reconcile to rebuild it from remote state.',
    },
    CURSOR_DUPLICATE_LAUNCH: {
        retryable: false,
        recoveryAction: 'An operation with this idempotency key is already in flight; run status instead of relaunching.',
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
        recoveryAction: 'Refusing to delegate from inside a remote agent run; run this from a non-agent context.',
    },
    CURSOR_CONCURRENCY_LIMIT: {
        retryable: false,
        recoveryAction: 'Wait for an active agent to finish, or raise --max-active.',
    },
    CURSOR_UNKNOWN_OUTCOME: {
        retryable: false,
        recoveryAction: 'Outcome unknown after a network interruption; run status --reconcile to determine what happened.',
    },
};
function makeAppError(code, message, overrides = {}) {
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
class AppErrorException extends Error {
    appError;
    constructor(appError) {
        super(appError.message);
        this.name = 'AppErrorException';
        this.appError = appError;
    }
}
exports.AppErrorException = AppErrorException;
function throwAppError(code, message, overrides = {}) {
    throw new AppErrorException(makeAppError(code, message, overrides));
}
const KIND_TO_CODE = {
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
function mapAdapterError(err) {
    const code = KIND_TO_CODE[err.kind];
    return makeAppError(code, err.message, {
        retryable: err.isRetryable,
        ...(err.requestId !== undefined ? { requestId: err.requestId } : {}),
    });
}
/** Converts anything caught at a layer boundary into an AppError, without ever leaking a raw stack trace into the value. */
function toAppError(err) {
    if (err instanceof AppErrorException) {
        return err.appError;
    }
    if (err instanceof AdapterError) {
        return mapAdapterError(err);
    }
    const message = err instanceof Error ? err.message : String(err);
    return makeAppError('CURSOR_MALFORMED_RESPONSE', message);
}
