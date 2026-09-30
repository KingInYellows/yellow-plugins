import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { withReadRetry } from '../src/deadline.js';
import { AppErrorException } from '../src/errors.js';
import {
  installFetchGuard,
  type FetchGuardHandle,
} from '../src/fetch-guard.js';

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

describe('withReadRetry deadline cancellation', () => {
  let guard: FetchGuardHandle | undefined;
  let server: http.Server | undefined;
  afterEach(async () => {
    guard?.uninstall();
    guard = undefined;
    server?.closeAllConnections();
    await new Promise<void>((resolve) =>
      server ? server.close(() => resolve()) : resolve()
    );
    server = undefined;
  });

  it('aborts the in-flight request through the fetch guard when the deadline wins', async () => {
    let closed!: () => void;
    const connectionClosed = new Promise<void>((resolve) => {
      closed = resolve;
    });
    let sawRequest!: () => void;
    const requestSeen = new Promise<void>((resolve) => {
      sawRequest = resolve;
    });
    server = http.createServer((req) => {
      sawRequest();
      req.socket.on('close', closed);
      // never respond
    });
    await new Promise<void>((resolve) =>
      server!.listen(0, '127.0.0.1', () => resolve())
    );
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    guard = installFetchGuard({
      allowedOrigins: [origin],
      readTimeoutMs: 30_000,
    });

    const clock = new FakeClock();
    const started = Date.now();
    const err = await withReadRetry(() => fetch(`${origin}/hang`), {
      clock,
      deadline: { expiresAt: clock.now() + 200 },
    }).catch((e: unknown) => e);
    await requestSeen;
    await connectionClosed;

    expect(err).toBeInstanceOf(AppErrorException);
    expect((err as AppErrorException).appError.code).toBe(
      'JULES_DEADLINE_EXCEEDED'
    );
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
