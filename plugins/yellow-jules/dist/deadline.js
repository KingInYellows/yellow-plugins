"use strict";
/**
 * Absolute operation deadlines and the bounded read retry (R14, contract
 * "Ambiguous-outcome design"): reads retry at most twice, with exponential
 * backoff from 500 ms plus jitter, on 5xx and network errors only, and only
 * while the deadline leaves room. A 429 returns control immediately (the SDK
 * exposes no Retry-After). Writes never go through this helper.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.readAttemptSignal = exports.MIN_ATTEMPT_MS = exports.READ_BACKOFF_BASE_MS = exports.READ_RETRIES = exports.DEFAULT_MUTATION_DEADLINE_MS = exports.DEFAULT_COLLECT_DEADLINE_MS = exports.DEFAULT_READ_DEADLINE_MS = void 0;
exports.deadlineIn = deadlineIn;
exports.remainingMs = remainingMs;
exports.isExpired = isExpired;
exports.withReadRetry = withReadRetry;
const node_async_hooks_1 = require("node:async_hooks");
const errors_js_1 = require("./errors.js");
exports.DEFAULT_READ_DEADLINE_MS = 120_000;
exports.DEFAULT_COLLECT_DEADLINE_MS = 180_000;
/** `delegate`, `reply`, `approve`, and `supervise` (contract "Argument shapes"). */
exports.DEFAULT_MUTATION_DEADLINE_MS = 180_000;
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
/**
 * The abort signal of the read attempt currently in flight. The SDK calls
 * global `fetch` without a caller signal, so the fetch guard reads this store
 * (async context follows the SDK's promise chain) and folds the signal into
 * the request it dispatches.
 */
exports.readAttemptSignal = new node_async_hooks_1.AsyncLocalStorage();
function isRetryableRead(err) {
    return (err instanceof errors_js_1.AdapterError &&
        (err.kind === 'server-error' || err.kind === 'network'));
}
/**
 * Race one read attempt against the remaining deadline. When the timer wins,
 * the attempt's abort signal fires so the fetch guard cancels the in-flight
 * request (see `readAttemptSignal`).
 * The timer is a real one because the injected clock's sleep may be virtual.
 */
async function boundByDeadline(fn, options) {
    const remaining = remainingMs(options.clock, options.deadline);
    const expire = () => (0, errors_js_1.throwAppError)('JULES_DEADLINE_EXCEEDED', 'the operation deadline expired while a read was in flight', { recoveryAction: 'Retry with a larger --deadline-ms.' });
    if (remaining <= 0)
        return expire();
    let timer;
    const controller = new AbortController();
    const expired = new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
            try {
                controller.abort(new Error('operation deadline expired'));
                expire();
            }
            catch (err) {
                reject(err);
            }
        }, remaining);
    });
    // Started inside the try: a function that throws synchronously must still
    // clear the timer, or it would fire later as an unhandled rejection.
    try {
        const attempt = exports.readAttemptSignal.run(controller.signal, fn);
        // If the timer wins, the aborted attempt rejects later; swallow it.
        attempt.catch(() => undefined);
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
