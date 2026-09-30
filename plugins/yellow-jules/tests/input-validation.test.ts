import { describe, expect, it } from 'vitest';

import {
  extractTitleTag,
  mintLocalId,
  parseSessionRef,
  repoOfSourceResource,
  sourceResourceFor,
  validateActivityId,
  validateActivityResource,
  validateBaseCommitId,
  validateIdempotencyKey,
  validateLocalId,
  validatePageToken,
  validatePlanId,
  validatePositiveInt,
  validatePullRequestUrl,
  validateRef,
  validateRepoInput,
  validateRequestId,
  validateSessionDisplayUrl,
  validateSessionId,
  validateSessionResource,
  validateSourceResource,
  validateTaskRef,
} from '../src/validate.js';

import { codeOf } from './support/app-error.js';

const SOURCE = 'sources/github/acme/widgets';

describe('input vs response origin', () => {
  it('input failures are JULES_INVALID_INPUT, API-returned failures JULES_MALFORMED_RESPONSE', () => {
    expect(codeOf(() => validateSessionResource('bad', 'input'))).toBe(
      'JULES_INVALID_INPUT'
    );
    expect(codeOf(() => validateSessionResource('bad', 'response'))).toBe(
      'JULES_MALFORMED_RESPONSE'
    );
    expect(codeOf(() => validateActivityId('a/b'))).toBe(
      'JULES_MALFORMED_RESPONSE'
    );
    expect(codeOf(() => validateSessionId(42 as unknown as string))).toBe(
      'JULES_INVALID_INPUT'
    );
  });
});

describe('session, activity, and plan ids', () => {
  it('accepts the conservative id alphabet only', () => {
    expect(validateSessionId('314159_abc-XYZ')).toBe('314159_abc-XYZ');
    for (const bad of ['', 'a'.repeat(129), 'a/b', 'a.b', '..', 'a b', 'ä']) {
      expect(codeOf(() => validateSessionId(bad))).toBe('JULES_INVALID_INPUT');
    }
    expect(validatePlanId('plan-1')).toBe('plan-1');
    expect(codeOf(() => validatePlanId('plan 1'))).toBe(
      'JULES_MALFORMED_RESPONSE'
    );
  });

  it('session and activity resources are anchored', () => {
    expect(validateSessionResource('sessions/abc')).toBe('sessions/abc');
    for (const bad of [
      'sessions/',
      'sessions/a/b',
      'x/sessions/a',
      'sessions/a\n',
      'sessions/../x',
    ]) {
      expect(codeOf(() => validateSessionResource(bad))).toBe(
        'JULES_INVALID_INPUT'
      );
    }
    expect(validateActivityResource('sessions/s1/activities/a1')).toBe(
      'sessions/s1/activities/a1'
    );
    expect(
      codeOf(() => validateActivityResource('sessions/s1/activities/a1/x'))
    ).toBe('JULES_MALFORMED_RESPONSE');
  });
});

describe('source resource and --repo', () => {
  it('accepts GitHub owner/repo shapes including .github', () => {
    expect(validateRepoInput('acme/widgets')).toEqual({
      owner: 'acme',
      repo: 'widgets',
    });
    expect(validateRepoInput('acme/.github')).toEqual({
      owner: 'acme',
      repo: '.github',
    });
    expect(validateSourceResource(SOURCE)).toBe(SOURCE);
    expect(repoOfSourceResource(SOURCE)).toEqual({
      owner: 'acme',
      repo: 'widgets',
    });
    expect(sourceResourceFor({ owner: 'acme', repo: 'widgets' })).toBe(SOURCE);
  });

  it('rejects . and .. repos, bad owners, and extra segments', () => {
    for (const bad of [
      'acme/..',
      'acme/.',
      '-acme/x',
      'acme',
      'acme/x/y',
      'a'.repeat(40) + '/x',
      'acme/x y',
    ]) {
      expect(codeOf(() => validateRepoInput(bad))).toBe('JULES_INVALID_INPUT');
    }
    for (const bad of [
      'sources/github/acme/..',
      'sources/gitlab/acme/x',
      'sources/github/acme',
    ]) {
      expect(codeOf(() => validateSourceResource(bad))).toBe(
        'JULES_MALFORMED_RESPONSE'
      );
    }
  });
});

describe('baseCommitId', () => {
  it('accepts full sha1 and sha256 hex only', () => {
    expect(validateBaseCommitId('a'.repeat(40))).toBe('a'.repeat(40));
    expect(validateBaseCommitId('0'.repeat(64))).toBe('0'.repeat(64));
    for (const bad of [
      'a'.repeat(39),
      'A'.repeat(40),
      '-'.repeat(40),
      'a'.repeat(41),
      'HEAD',
    ]) {
      expect(codeOf(() => validateBaseCommitId(bad))).toBe(
        'JULES_MALFORMED_RESPONSE'
      );
    }
  });
});

describe('validatePullRequestUrl (parse-then-compare)', () => {
  it('accepts a PR on the session source', () => {
    expect(
      validatePullRequestUrl('https://github.com/acme/widgets/pull/42', SOURCE)
    ).toEqual({
      valid: true,
      url: 'https://github.com/acme/widgets/pull/42',
      number: 42,
    });
  });

  it.each([
    ['owner mismatch', 'https://github.com/evil/widgets/pull/1'],
    ['repo mismatch', 'https://github.com/acme/gadgets/pull/1'],
    ['http', 'http://github.com/acme/widgets/pull/1'],
    ['other host', 'https://github.com.evil.test/acme/widgets/pull/1'],
    ['userinfo', 'https://x@github.com/acme/widgets/pull/1'],
    ['not a pull path', 'https://github.com/acme/widgets/issues/1'],
    ['trailing segment', 'https://github.com/acme/widgets/pull/1/files'],
    ['query', 'https://github.com/acme/widgets/pull/1?x=1'],
    ['not a url', 'not a url'],
  ])('reports %s as invalid', (_label, url) => {
    expect(validatePullRequestUrl(url, SOURCE).valid).toBe(false);
  });

  it('reports a non-string as invalid', () => {
    expect(validatePullRequestUrl(undefined, SOURCE).valid).toBe(false);
  });
});

describe('display URL, page tokens, local ids, title tags', () => {
  it('keeps only https session URLs', () => {
    expect(
      validateSessionDisplayUrl('https://jules.google.com/session/1')
    ).toBe('https://jules.google.com/session/1');
    expect(validateSessionDisplayUrl('javascript:alert(1)')).toBeUndefined();
    expect(validateSessionDisplayUrl('http://x')).toBeUndefined();
    expect(validateSessionDisplayUrl(3)).toBeUndefined();
  });

  it('page tokens are query-safe and never . or ..', () => {
    expect(validatePageToken('1712345678901234567')).toBe(
      '1712345678901234567'
    );
    expect(validatePageToken('abc=_-.')).toBe('abc=_-.');
    for (const bad of ['.', '..', 'a/b', 'a&b', '', 'x'.repeat(513)]) {
      expect(codeOf(() => validatePageToken(bad))).toBe('JULES_INVALID_INPUT');
    }
  });

  it('minted local ids match the local-id pattern', () => {
    const id = mintLocalId();
    expect(id).toMatch(/^jl-[0-9a-f]{32}$/);
    expect(validateLocalId(id)).toBe(id);
    expect(mintLocalId()).not.toBe(id);
    expect(codeOf(() => validateLocalId('jl-XYZ'))).toBe('JULES_INVALID_INPUT');
  });

  it('extracts the title tag only when anchored at the start', () => {
    const id = `jl-${'a'.repeat(32)}`;
    expect(extractTitleTag(`[yellow:${id}] Fix the bug`)).toEqual({
      localId: id,
      title: 'Fix the bug',
    });
    expect(extractTitleTag(`[yellow:${id}]`)).toEqual({
      localId: id,
      title: '',
    });
    expect(extractTitleTag(`Fix [yellow:${id}] the bug`)).toEqual({
      title: `Fix [yellow:${id}] the bug`,
    });
    expect(extractTitleTag(`[yellow:${id}]x`)).toEqual({
      title: `[yellow:${id}]x`,
    });
    expect(extractTitleTag(' [yellow:' + id + '] x')).toEqual({
      title: ' [yellow:' + id + '] x',
    });
  });

  it('parses --session as a local id or a session resource', () => {
    const id = `jl-${'b'.repeat(32)}`;
    expect(parseSessionRef(id)).toEqual({ kind: 'local', localId: id });
    expect(parseSessionRef('sessions/abc')).toEqual({
      kind: 'resource',
      sessionResource: 'sessions/abc',
    });
    expect(codeOf(() => parseSessionRef('abc'))).toBe('JULES_INVALID_INPUT');
  });
});

describe('request ids, task refs, refs, and integers', () => {
  it('rejects prototype keys as request ids and task refs', () => {
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      expect(codeOf(() => validateRequestId(key))).toBe('JULES_INVALID_INPUT');
      expect(codeOf(() => validateTaskRef(key))).toBe('JULES_INVALID_INPUT');
    }
    expect(validateRequestId('req:1.2-3')).toBe('req:1.2-3');
    expect(codeOf(() => validateRequestId('a b'))).toBe('JULES_INVALID_INPUT');
    expect(codeOf(() => validateRequestId('x'.repeat(201)))).toBe(
      'JULES_INVALID_INPUT'
    );
  });

  it('validateIdempotencyKey keeps the yellow-cursor rule', () => {
    expect(validateIdempotencyKey('k-1')).toBe('k-1');
    expect(codeOf(() => validateIdempotencyKey('k 1'))).toBe(
      'JULES_INVALID_INPUT'
    );
  });

  it('validateRef keeps the yellow-cursor git ref rules', () => {
    expect(validateRef('feature/x')).toBe('feature/x');
    for (const bad of [
      '',
      '-x',
      '/x',
      'x/',
      'x.lock',
      'a..b',
      'a//b',
      'a b',
      'a;b',
      'a$b',
      'a\u0001b',
    ]) {
      expect(codeOf(() => validateRef(bad))).toBe('JULES_INVALID_INPUT');
    }
  });

  it('validatePositiveInt bounds and rejects non-integers', () => {
    expect(validatePositiveInt('20', '--limit', 1, 100)).toBe(20);
    for (const bad of ['0', '101', '1.5', '-1', 'x', '']) {
      expect(codeOf(() => validatePositiveInt(bad, '--limit', 1, 100))).toBe(
        'JULES_INVALID_INPUT'
      );
    }
  });
});
