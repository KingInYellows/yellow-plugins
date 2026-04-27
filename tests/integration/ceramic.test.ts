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
    expect(first.url).toMatch(/^https?:\/\//);
    expect(typeof first.description).toBe('string');
    expect(typeof body.result.searchMetadata.executionTime).toBe('number');
  });

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
});

describe.skipIf(RUN_LIVE && API_KEY)('ceramic.ai live REST contract (skipped)', () => {
  it('skip placeholder — set RUN_LIVE=1 and CERAMIC_API_KEY to run', () => {
    expect(true).toBe(true);
  });
});
