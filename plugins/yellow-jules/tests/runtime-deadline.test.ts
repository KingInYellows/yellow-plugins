import { describe, expect, it } from 'vitest';

import { withReadRetry } from '../src/deadline.js';
import { AppErrorException } from '../src/errors.js';

import { FakeClock } from './fake-sdk.js';

describe('withReadRetry deadline bound', () => {
  it('surfaces JULES_DEADLINE_EXCEEDED promptly when a slow read outlives the deadline', async () => {
    const clock = new FakeClock();
    const started = Date.now();
    const err = await withReadRetry(() => new Promise<never>(() => undefined), {
      clock,
      deadline: { expiresAt: clock.now() + 20 },
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppErrorException);
    expect((err as AppErrorException).appError.code).toBe(
      'JULES_DEADLINE_EXCEEDED'
    );
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('returns the value when the read wins', async () => {
    const clock = new FakeClock();
    const value = await withReadRetry(async () => 'ok', {
      clock,
      deadline: { expiresAt: clock.now() + 60_000 },
    });
    expect(value).toBe('ok');
  });
});
