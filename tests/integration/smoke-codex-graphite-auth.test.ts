import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const { classify } = createRequire(import.meta.url)(
  resolve(__dirname, '../../scripts/smoke-codex-graphite-auth.js')
);
describe('Graphite authentication prerequisite classification', () => {
  it('accepts positive account and repository access without retaining identity', () => {
    expect(
      classify('{"status":"ok","githubLogin":"private-identity"}')
    ).toEqual({
      observedStatus: 'ok',
      authenticated: true,
      repositoryAccess: true,
    });
  });
  it('separates account authentication from repository authorization', () => {
    expect(classify('{"status":"no_repo_access"}')).toEqual({
      observedStatus: 'no_repo_access',
      authenticated: true,
      repositoryAccess: false,
    });
  });
  it.each(['no_token', 'invalid_token'])(
    'does not infer authentication from %s',
    (status) => {
      expect(classify(JSON.stringify({ status })).authenticated).toBe(false);
    }
  );
  it('rejects missing, unsupported and ambiguous responses', () => {
    expect(() => classify('{"authStatus":"unsupported"}')).toThrow();
    expect(() => classify('{"status":"ok"}\n{"status":"no_token"}')).toThrow();
  });
});
