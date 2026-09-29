"use strict";
/**
 * Absolute operation deadlines and the bounded read retry (R14, contract
 * "Ambiguous-outcome design"): reads retry at most twice, with exponential
 * backoff from 500 ms plus jitter, on 5xx and network errors only, and only
 * while the deadline leaves room. A 429 returns control immediately (the SDK
 * exposes no Retry-After). Writes never go through this helper.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIN_ATTEMPT_MS = exports.READ_BACKOFF_BASE_MS = exports.READ_RETRIES = exports.DEFAULT_COLLECT_DEADLINE_MS = exports.DEFAULT_READ_DEADLINE_MS = void 0;
exports.deadlineIn = deadlineIn;
exports.remainingMs = remainingMs;
exports.isExpired = isExpired;
exports.withReadRetry = withReadRetry;
const errors_js_1 = require("./errors.js");
exports.DEFAULT_READ_DEADLINE_MS = 120_000;
exports.DEFAULT_COLLECT_DEADLINE_MS = 180_000;
exports.READ_RETRIES = 2;
exports.READ_BACKOFF_BASE_MS = 500;
exports.MIN_ATTEMPT_MS = 5_000;
function deadlineIn(clock, ms) {
    return { expiresAt: clock.now() + ms };
}
function remainingMs(clock, deadline) {
    return deadline.expiresAt - clock.now();
}
function isExpired(clock, deadline) {
    return remainingMs(clock, deadline) <= 0;
}
function isRetryableRead(err) {
    return (err instanceof errors_js_1.AdapterError &&
        (err.kind === 'server-error' || err.kind === 'network'));
}
/**
 * Race one read attempt against the remaining deadline. The underlying request
 * is not cancelled (deferred follow-up); the caller just stops waiting for it.
 * The timer is a real one because the injected clock's sleep may be virtual.
 */
async function boundByDeadline(fn, options) {
    const remaining = remainingMs(options.clock, options.deadline);
    const expire = () => (0, errors_js_1.throwAppError)('JULES_DEADLINE_EXCEEDED', 'the operation deadline expired while a read was in flight', { recoveryAction: 'Retry with a larger --deadline-ms.' });
    if (remaining <= 0)
        return expire();
    let timer;
    const expired = new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
            try {
                expire();
            }
            catch (err) {
                reject(err);
            }
        }, remaining);
    });
    const attempt = fn();
    // If the timer wins, the abandoned attempt may reject later; swallow it.
    attempt.catch(() => undefined);
    try {
        return await Promise.race([attempt, expired]);
    }
    finally {
        clearTimeout(timer);
    }
}
async function withReadRetry(fn, options) {
    const random = options.random ?? Math.random;
    for (let attempt = 0;; attempt += 1) {
        try {
            return await boundByDeadline(fn, options);
        }
        catch (err) {
            if (attempt >= exports.READ_RETRIES || !isRetryableRead(err))
                throw err;
            const delay = exports.READ_BACKOFF_BASE_MS * 2 ** attempt +
                Math.floor(random() * exports.READ_BACKOFF_BASE_MS);
            // Retry only when the deadline still leaves room for a useful attempt
            // after the backoff; a retry that cannot finish only overshoots it.
            if (remainingMs(options.clock, options.deadline) <=
                delay + exports.MIN_ATTEMPT_MS)
                throw err;
            await options.clock.sleep(delay);
        }
    }
}
