import { describe, expect, it } from 'vitest';

import { redact, scanSecretShapes } from '../src/redact';

describe('redact', () => {
  it('masks the whole PEM private-key block', () => {
    const pem =
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEabc\ndef==\n-----END RSA PRIVATE KEY-----';
    const out = redact(`before\n${pem}\nafter`);
    expect(out).not.toContain('MIIEabc');
    expect(out).not.toContain('def==');
    expect(out).toContain('before');
    expect(out).toContain('after');
    // An unterminated block is masked to the end.
    expect(redact('-----BEGIN PRIVATE KEY-----\nsecretbody')).not.toContain(
      'secretbody'
    );
  });

  it('masks Authorization credentials under any scheme', () => {
    for (const header of [
      'Authorization: Basic dXNlcjpwYXNz',
      'authorization: Token abcdef123456',
      'Authorization: rawtokenvalue',
      'Authorization: Bearer abc.def',
    ]) {
      const out = redact(header);
      expect(out, header).toBe('authorization: ***REDACTED***');
      expect(scanSecretShapes(header), header).toBe(true);
    }
    // The next line is not swallowed.
    expect(redact('Authorization: Basic\nnext')).toContain('next');
  });
});
