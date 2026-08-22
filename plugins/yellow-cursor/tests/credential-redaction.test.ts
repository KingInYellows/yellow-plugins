import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  assertNoSecretShapedValues,
  redact,
  redactDeep,
} from '../src/redact.js';

// Built at runtime by concatenation, never as a literal, so nothing that looks like a real key is committed.
function fakeKey(): string {
  return ['sk', '-', 'test', 'abcdef0123456789abcdef0123456789'].join('');
}

describe('redact', () => {
  const original = process.env['CURSOR_API_KEY'];

  afterEach(() => {
    if (original === undefined) delete process.env['CURSOR_API_KEY'];
    else process.env['CURSOR_API_KEY'] = original;
  });

  it('redacts the live CURSOR_API_KEY value wherever it appears', () => {
    const secret = fakeKey();
    process.env['CURSOR_API_KEY'] = secret;
    const out = redact(
      `about to call the SDK with key=${secret} in the payload`
    );
    expect(out).not.toContain(secret);
    expect(out).toContain('***REDACTED***');
  });

  it('redacts Authorization headers', () => {
    // Token assembled at runtime so no committed line ever contains a
    // credential-shaped literal (keeps secret scanners quiet and honest).
    const token = ['abcdefghijklm', 'nopqrstuvwxyz', '012345'].join('');
    const out = redact(`Authorization: Bearer ${token}`);
    expect(out.toLowerCase()).not.toContain(
      `bearer ${token.slice(0, 26)}`.toLowerCase()
    );
    expect(out).toContain('***REDACTED***');
  });

  it('redacts apiKey-shaped fields', () => {
    const secret = fakeKey();
    const out = redact(`{"apiKey":"${secret}"}`);
    expect(out).not.toContain(secret);
  });

  it('leaves agent ids and run ids untouched', () => {
    const text =
      'agentId=bc-41d32f40-3b15-454d-a580-ad62a664204a runId=run-00000001';
    expect(redact(text)).toBe(text);
  });
});

describe('assertNoSecretShapedValues', () => {
  it('throws on a field named apiKey/token/secret/password/prompt regardless of value', () => {
    expect(() => assertNoSecretShapedValues({ apiKey: 'anything' })).toThrow();
    expect(() => assertNoSecretShapedValues({ token: 'anything' })).toThrow();
    expect(() => assertNoSecretShapedValues({ secret: 'anything' })).toThrow();
    expect(() =>
      assertNoSecretShapedValues({ password: 'anything' })
    ).toThrow();
    expect(() =>
      assertNoSecretShapedValues({ prompt: 'the raw prompt text' })
    ).toThrow();
  });

  it('throws on a secret-shaped string value even under an innocuous field name', () => {
    const secret = fakeKey();
    expect(() => assertNoSecretShapedValues({ notes: secret })).toThrow();
  });

  it('does not throw on ordinary state fields', () => {
    expect(() =>
      assertNoSecretShapedValues({
        agentId: 'bc-abc123',
        repository: 'https://github.com/org/repo',
        status: 'running',
        promptDigest: 'a'.repeat(64),
      })
    ).not.toThrow();
  });

  it('recurses into nested objects and arrays', () => {
    expect(() =>
      assertNoSecretShapedValues({ nested: { deeper: { apiKey: 'x' } } })
    ).toThrow();
    expect(() =>
      assertNoSecretShapedValues({ list: [{ token: 'x' }] })
    ).toThrow();
  });
});

describe('redactDeep', () => {
  const original = process.env['CURSOR_API_KEY'];
  beforeEach(() => {
    delete process.env['CURSOR_API_KEY'];
  });
  afterEach(() => {
    if (original === undefined) delete process.env['CURSOR_API_KEY'];
    else process.env['CURSOR_API_KEY'] = original;
  });

  it('redacts string leaves inside nested structures', () => {
    const secret = fakeKey();
    process.env['CURSOR_API_KEY'] = secret;
    const out = redactDeep({ a: { b: [secret, 'fine'] } }) as {
      a: { b: string[] };
    };
    expect(out.a.b[0]).not.toContain(secret);
    expect(out.a.b[1]).toBe('fine');
  });
});
