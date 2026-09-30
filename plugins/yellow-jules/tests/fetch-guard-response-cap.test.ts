import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import {
  installFetchGuard,
  ResponseTooLarge,
  type FetchGuardHandle,
} from '../src/fetch-guard.js';
import { toAdapterError, type SdkErrorClasses } from '../src/sdk-adapter.js';

let server: http.Server | undefined;
let guard: FetchGuardHandle | undefined;

afterEach(async () => {
  guard?.uninstall();
  guard = undefined;
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
});

async function start(body: string, chunked: boolean): Promise<string> {
  server = http.createServer((_req, res) => {
    if (chunked) res.writeHead(200, { 'content-type': 'application/json' });
    else
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      });
    res.end(body);
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  guard = installFetchGuard({
    allowedOrigins: [origin],
    readTimeoutMs: 30_000,
    maxResponseBytes: 1024,
  });
  return origin;
}

describe('per-response body cap', () => {
  it('passes a body within the cap', async () => {
    const origin = await start('{"ok":true}', false);
    expect(await (await fetch(`${origin}/x`)).json()).toEqual({ ok: true });
  });

  it('refuses an oversized declared content-length', async () => {
    const origin = await start('x'.repeat(4096), false);
    await expect(fetch(`${origin}/x`)).rejects.toBeInstanceOf(ResponseTooLarge);
  });

  it('errors the stream of an oversized chunked body', async () => {
    const origin = await start('x'.repeat(4096), true);
    const res = await fetch(`${origin}/x`);
    await expect(res.text()).rejects.toBeInstanceOf(ResponseTooLarge);
  });

  it('classifies a wrapped ResponseTooLarge as malformed', () => {
    class Net extends Error {}
    const sdk = { JulesNetworkError: Net } as unknown as SdkErrorClasses;
    const wrapped = new Net('fetch failed', { cause: new ResponseTooLarge(1) });
    expect(toAdapterError(sdk, wrapped).kind).toBe('malformed');
  });
});
