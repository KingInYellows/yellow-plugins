/**
 * Live integration test for Ceramic.ai REST API.
 *
 * Gated behind RUN_LIVE=1 + CERAMIC_API_KEY. Skipped by default — the
 * default `pnpm test:integration` run uses --passWithNoTests, so this
 * file is inert unless an operator explicitly opts in:
 *
 *   RUN_LIVE=1 CERAMIC_API_KEY=... pnpm test:integration
 *
 * The test exists to give a single, repeatable smoke probe that the
 * Ceramic contract documented in RESEARCH/02-ceramic-capabilities.md
 * has not regressed. Ceramic is documented at $0.05 per 1,000 queries
 * (~$0.0001 per run), and the test issues one /search call.
 */

import { describe, it, expect } from 'vitest';

const RUN_LIVE = process.env.RUN_LIVE === '1';
const API_KEY = process.env.CERAMIC_API_KEY;

const describeLive =
  RUN_LIVE && API_KEY ? describe : describe.skip;

describeLive('ceramic.ai live REST contract', () => {
  it('returns the documented response shape for a known query', async () => {
    const response = await fetch('https://api.ceramic.ai/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: 'California rental laws' }),
      signal: AbortSignal.timeout(15_000),
    });

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      requestId: string;
      result: {
        results: Array<{ title: string; url: string; description: string }>;
        searchMetadata: { executionTime: number };
        totalResults: number;
      };
    };

    expect(typeof body.requestId).toBe('string');
    expect(body.requestId.length).toBeGreaterThan(0);
    expect(body.result.totalResults).toBeGreaterThan(0);
    expect(Array.isArray(body.result.results)).toBe(true);
    expect(body.result.results.length).toBeGreaterThan(0);

    const first = body.result.results[0]!;
    expect(typeof first.title).toBe('string');
    expect(first.title.length).toBeGreaterThan(0);
    expect(first.url).toMatch(/^https?:\/\//);
    expect(typeof first.description).toBe('string');
    expect(first.description.length).toBeGreaterThan(0);
    expect(typeof body.result.searchMetadata.executionTime).toBe('number');
  });

  it('rejects an invalid API key with 401 + Problem Details', async () => {
    // Documented at https://docs.ceramic.ai/api-reference/error-codes.md
    const response = await fetch('https://api.ceramic.ai/search', {
      method: 'POST',
      headers: {
        // Intentionally NOT prefixed `cer_sk` to avoid secret-scanner false
        // positives (TruffleHog/Gitleaks key off the prefix). Ceramic's auth
        // path returns 401 for any invalid bearer regardless of format.
        Authorization: 'Bearer invalid-test-key-xxxxxxxxxxxxxxxx',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: 'auth test' }),
      signal: AbortSignal.timeout(15_000),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toMatch(
      /application\/problem\+json/
    );
  });

  // Documented at https://docs.ceramic.ai/api-reference/error-codes.md
  it('rejects an unsupported parameter with the documented 400 shape', async () => {
    const response = await fetch('https://api.ceramic.ai/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt: 'wrong field name' }),
      signal: AbortSignal.timeout(15_000),
    });

    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toMatch(
      /application\/problem\+json/
    );

    const body = (await response.json()) as {
      title: string;
      status: number;
      detail: string;
      requestId: string;
      code: string;
    };
    expect(body.status).toBe(400);
    expect(body.code).toBe('unsupported_parameter');
  });

  it('returns numeric totalResults even on sparse queries', async () => {
    // Validates the response field the agent prose reads to decide fallback
    // (`result.totalResults < 3`). If Ceramic ever renames or omits this
    // field, the agents would silently fall through on every call. This test
    // asserts the field is present and numeric for a deliberately rare query.
    const response = await fetch('https://api.ceramic.ai/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: 'xqzqkjf9283 nonexistent topic phrase' }),
      signal: AbortSignal.timeout(15_000),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: { totalResults: number; results: unknown[] };
    };
    expect(typeof body.result.totalResults).toBe('number');
    expect(Array.isArray(body.result.results)).toBe(true);
  });
});
