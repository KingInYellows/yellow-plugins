/**
 * Process-local `globalThis.fetch` guard (contract "Network guard").
 *
 * The SDK's ApiClient calls global `fetch`, so this wrapper is where the
 * runtime pins the vendor origin and refuses redirects: `X-Goog-Api-Key` is
 * not among the headers `fetch` strips on a cross-origin redirect, so
 * following one would forward the credential. A refusal is thrown (never
 * returned), so it surfaces through the SDK's fetchWithTimeout as
 * JulesNetworkError and classifies as JULES_SERVICE_UNAVAILABLE before
 * dispatch or JULES_UNKNOWN_OUTCOME after a mutating POST.
 *
 * Installed exactly once per process, before `connect()`. The loopback
 * allowance exists only through test-seam.ts; it is never read from config,
 * env, or argv.
 */

import { readAttemptSignal } from './deadline.js';

export const VENDOR_ORIGIN = 'https://jules.googleapis.com';
export const READ_TIMEOUT_MS = 30_000;

export interface FetchGuardOptions {
  readonly allowedOrigins: readonly string[];
  readonly readTimeoutMs: number;
  readonly onPostDispatch?: (url: string, at: number) => void;
}

export interface FetchGuardHandle {
  /** Number of POST requests this guard let through. */
  postCount(): number;
  /** Test-only: restores the original fetch so a later test can install again. */
  uninstall(): void;
}

let installed = false;

export class FetchGuardRefusal extends Error {
  constructor(message: string) {
    super(`fetch guard: ${message}`);
    this.name = 'FetchGuardRefusal';
  }
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === '127.0.0.1';
}

function requestParts(
  input: unknown,
  init: RequestInit | undefined
): { url: string; method: string } {
  if (typeof input === 'string')
    return { url: input, method: (init?.method ?? 'GET').toUpperCase() };
  if (input instanceof URL)
    return { url: input.href, method: (init?.method ?? 'GET').toUpperCase() };
  if (input instanceof Request) {
    return {
      url: input.url,
      method: (init?.method ?? input.method).toUpperCase(),
    };
  }
  throw new FetchGuardRefusal('unsupported request input');
}

export function installFetchGuard(
  options: FetchGuardOptions
): FetchGuardHandle {
  if (installed) {
    throw new Error('fetch guard is already installed in this process');
  }
  const allowed = new Set(options.allowedOrigins.map((o) => new URL(o).origin));
  const original = globalThis.fetch;
  let posts = 0;

  const guarded: typeof fetch = async (input, init) => {
    const { url, method } = requestParts(input, init);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new FetchGuardRefusal('unparseable request URL');
    }
    if (!allowed.has(parsed.origin)) {
      throw new FetchGuardRefusal(
        `origin ${parsed.origin} is not the pinned vendor origin`
      );
    }
    if (parsed.protocol !== 'https:' && !isLoopbackHost(parsed.hostname)) {
      throw new FetchGuardRefusal(`non-https scheme ${parsed.protocol}`);
    }

    const signals: AbortSignal[] = [];
    if (init?.signal) signals.push(init.signal);
    if (input instanceof Request) signals.push(input.signal);
    const attemptSignal = readAttemptSignal.getStore();
    if (attemptSignal) signals.push(attemptSignal);
    if (method !== 'POST') {
      const timeout = new AbortController();
      const timer = setTimeout(
        () =>
          timeout.abort(
            new FetchGuardRefusal(
              `read timed out after ${options.readTimeoutMs} ms`
            )
          ),
        options.readTimeoutMs
      );
      timer.unref();
      signals.push(timeout.signal);
    }
    const nextInit: RequestInit = {
      ...init,
      redirect: 'manual',
      ...(signals.length > 0 ? { signal: AbortSignal.any(signals) } : {}),
    };

    if (method === 'POST') {
      posts += 1;
      options.onPostDispatch?.(parsed.href, Date.now());
    }
    const response = await original(
      input instanceof Request ? new Request(input, nextInit) : input,
      nextInit
    );
    if (response.status >= 300 && response.status < 400) {
      // Discard the body so the connection can be reused, then refuse.
      await response.body?.cancel().catch(() => undefined);
      throw new FetchGuardRefusal(`refused a ${response.status} redirect`);
    }
    return response;
  };

  globalThis.fetch = guarded;
  installed = true;
  return {
    postCount: () => posts,
    uninstall: () => {
      if (globalThis.fetch === guarded) globalThis.fetch = original;
      installed = false;
    },
  };
}
