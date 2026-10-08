"use strict";
/**
 * Stable app-level error codes for the yellow-jules CLI, plus the
 * transport-neutral adapter-error normalization boundary. This module has
 * zero dependency on the Jules SDK — sdk-adapter.ts is the only file
 * that classifies SDK error classes (by `instanceof`, most-derived first);
 * it constructs AdapterError instances (defined here), and this module maps
 * those to the JULES_* code table below by call phase.
 *
 * The code table and its default recovery actions are the contract's
 * "Error catalog" (docs/yellow-jules/contract-v1.md); call sites may
 * override `recoveryAction` with a more specific instruction.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_APP_ERROR_CODES = exports.AppErrorException = exports.AdapterError = void 0;
exports.makeAppError = makeAppError;
exports.throwAppError = throwAppError;
exports.mapAdapterError = mapAdapterError;
exports.toAppError = toAppError;
class AdapterError extends Error {
    kind;
    requestId;
    status;
    constructor(kind, message, options = {}) {
        super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
        this.name = 'AdapterError';
        this.kind = kind;
        this.requestId = options.requestId;
        this.status = options.status;
    }
}
exports.AdapterError = AdapterError;
// replica:AppError:end
const CODE_TABLE = {
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
        recoveryAction: 'Connect the repository to Jules; sources are discovered, never synthesized.',
    },
    JULES_RATE_LIMITED: {
        retryable: true,
        recoveryAction: 'Wait at least 60 s and retry; the runtime never retries a 429 itself.',
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
        recoveryAction: 'Report this; the Jules SDK response shape was unexpected. Re-verify the SDK pin with /jules:setup.',
    },
    JULES_INVALID_STATE: {
        retryable: false,
        recoveryAction: 'The session is not awaiting approval, or its pending plan could not be completely re-read; run status.',
    },
    JULES_UNSUPPORTED_CAPABILITY: {
        retryable: false,
        recoveryAction: 'This capability is not available on the Jules vendor contract; no retry will help.',
    },
    JULES_UNKNOWN_OUTCOME: {
        retryable: false,
        recoveryAction: 'Run status --reconcile (a delegate), or status --session <ref> --reconcile (a reply or approve); never relaunch.',
    },
    JULES_JOURNAL_CORRUPT: {
        retryable: false,
        recoveryAction: 'Reconcile state/journal.json by hand; writes are blocked until it parses.',
    },
    JULES_DUPLICATE_LAUNCH: {
        retryable: false,
        recoveryAction: 'An unresolved operation exists for this repository and branch; run status --reconcile first.',
    },
    JULES_CONFIRMATION_REQUIRED: {
        retryable: false,
        recoveryAction: 'Pass --grant-id from a grant written by authorize, or run the authorize command yourself in a terminal on the controller host.',
    },
    JULES_AUTHORITY_DENIED: {
        retryable: false,
        recoveryAction: 'The grant does not cover this operation, repository, branch, or limit.',
    },
    JULES_GRANT_EXPIRED: {
        retryable: false,
        recoveryAction: 'The grant expired; remote work may still run and expiry does not stop it. Contain it out of band: stop the session from the Jules console, revoke the source connection, or rotate JULES_API_KEY.',
    },
    JULES_POLICY_DEVIATION: {
        retryable: false,
        recoveryAction: 'A vendor PR, plan change, or repository mismatch was observed; reconcile before any further write.',
    },
    JULES_DEADLINE_EXCEEDED: {
        retryable: false,
        recoveryAction: 'The operation deadline fired before any write was dispatched; retry with a larger --deadline-ms.',
    },
    JULES_STALE_LOCK: {
        retryable: false,
        recoveryAction: 'A lock from a crashed process exists at state/.lock; inspect it and remove it by hand.',
    },
    JULES_NO_PROGRESS: {
        retryable: false,
        recoveryAction: 'Two consecutive activity walks restarted without advancing; run status later, and re-verify the SDK pin if it recurs.',
    },
    JULES_SDK_MISSING: {
        retryable: false,
        recoveryAction: 'Run /jules:setup to install the pinned Jules SDK.',
    },
    JULES_SDK_INTEGRITY: {
        retryable: false,
        recoveryAction: 'The SDK tarball, entry file, or storage binding failed verification; do not use it. Reinstall with /jules:setup.',
    },
    JULES_DATA_DIR: {
        retryable: false,
        recoveryAction: 'Make the data directory owner-only (0700), owned by you, outside any git work tree and the plugin directory, with a writable sdk-scratch/.',
    },
    JULES_CONTROLLER_MISMATCH: {
        retryable: false,
        recoveryAction: 'This data directory is not the authorized controller copy; follow the handoff procedure in the plugin CLAUDE.md.',
    },
    JULES_GRANT_EXHAUSTED: {
        retryable: false,
        recoveryAction: 'Create a new grant with authorize.',
    },
    JULES_SUPERVISION_PAUSED: {
        retryable: false,
        recoveryAction: 'Inspect the session, then run supervise --clear-pause in a terminal.',
    },
};
// replica:makeAppError:start
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
// replica:makeAppError:end
exports.ALL_APP_ERROR_CODES = Object.freeze(Object.keys(CODE_TABLE));
/** The contract's "Pre-dispatch or read" column. */
const KIND_TO_CODE = {
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
const CLEAR_REJECTION_AFTER_DISPATCH = {
    auth: 'JULES_AUTH_FAILED',
    'rate-limited': 'JULES_RATE_LIMITED',
    'not-found': 'JULES_NOT_FOUND',
    'invalid-request': 'JULES_INVALID_INPUT',
    'invalid-state': 'JULES_INVALID_STATE',
};
function mapAdapterError(err, phase) {
    const code = phase === 'after-dispatch'
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
function toAppError(err, phase = 'read') {
    if (err instanceof AppErrorException) {
        return err.appError;
    }
    if (err instanceof AdapterError) {
        return mapAdapterError(err, phase);
    }
    const message = err instanceof Error ? err.message : String(err);
    return makeAppError(phase === 'after-dispatch'
        ? 'JULES_UNKNOWN_OUTCOME'
        : 'JULES_MALFORMED_RESPONSE', message);
}
