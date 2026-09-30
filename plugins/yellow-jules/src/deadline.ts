/**
 * Absolute operation deadlines and the bounded read retry (R14, contract
 * "Ambiguous-outcome design"): reads retry at most twice, with exponential
 * backoff from 500 ms plus jitter, on 5xx and network errors only, and only
 * while the deadline leaves room. A 429 returns control immediately (the SDK
 * exposes no Retry-After). Writes never go through this helper.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import { AdapterError, throwAppError } from './errors.js';
import type { Clock } from './types.js';

export const DEFAULT_READ_DEADLINE_MS = 120_000;
export const DEFAULT_COLLECT_DEADLINE_MS = 180_000;
export const READ_RETRIES = 2;
export const READ_BACKOFF_BASE_MS = 500;
export const MIN_ATTEMPT_MS = 5_000;

export interface Deadline {
  readonly expiresAt: number;
}

export function deadlineIn(clock: Clock, ms: number): Deadline {
  return { expiresAt: clock.now() + ms };
}

export function remainingMs(clock: Clock, deadline: Deadline): number {
  return deadline.expiresAt - clock.now();
}

export function isExpired(clock: Clock, deadline: Deadline): boolean {
  return remainingMs(clock, deadline) <= 0;
}

/**
 * The abort signal of the read attempt currently in flight. The SDK calls
 * global `fetch` without a caller signal, so the fetch guard reads this store
 * (async context follows the SDK's promise chain) and folds the signal into
 * the request it dispatches.
 */
export const readAttemptSignal = new AsyncLocalStorage<AbortSignal>();

function isRetryableRead(err: unknown): boolean {
  return (
    err instanceof AdapterError &&
    (err.kind === 'server-error' || err.kind === 'network')
  );
}

export interface ReadRetryOptions {
  readonly clock: Clock;
  readonly deadline: Deadline;
  readonly random?: () => number;
}

/**
 * Race one read attempt against the remaining deadline. When the timer wins,
 * the attempt's abort signal fires so the fetch guard cancels the in-flight
 * request (see `readAttemptSignal`).
 * The timer is a real one because the injected clock's sleep may be virtual.
 */
async function boundByDeadline<T>(
  fn: () => Promise<T>,
  options: ReadRetryOptions
): Promise<T> {
  const remaining = remainingMs(options.clock, options.deadline);
  const expire = (): never =>
    throwAppError(
      'JULES_DEADLINE_EXCEEDED',
      'the operation deadline expired while a read was in flight',
      { recoveryAction: 'Retry with a larger --deadline-ms.' }
    );
  if (remaining <= 0) return expire();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      try {
        controller.abort(new Error('operation deadline expired'));
        expire();
      } catch (err) {
        reject(err);
      }
    }, remaining);
  });
  const attempt = readAttemptSignal.run(controller.signal, fn);
  // If the timer wins, the aborted attempt rejects later; swallow it.
  attempt.catch(() => undefined);
  try {
    return await Promise.race([attempt, expired]);
  } finally {
    clearTimeout(timer);
  }
}

export async function withReadRetry<T>(
  fn: () => Promise<T>,
  options: ReadRetryOptions
): Promise<T> {
  const random = options.random ?? Math.random;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await boundByDeadline(fn, options);
    } catch (err) {
      if (attempt >= READ_RETRIES || !isRetryableRead(err)) throw err;
      const delay =
        READ_BACKOFF_BASE_MS * 2 ** attempt +
        Math.floor(random() * READ_BACKOFF_BASE_MS);
      // Retry only when the deadline still leaves room for a useful attempt
      // after the backoff; a retry that cannot finish only overshoots it.
      if (
        remainingMs(options.clock, options.deadline) <=
        delay + MIN_ATTEMPT_MS
      )
        throw err;
      await options.clock.sleep(delay);
    }
  }
}
