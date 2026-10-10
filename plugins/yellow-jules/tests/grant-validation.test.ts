import { describe, expect, it } from 'vitest';

import {
  branchMatchesPattern,
  mintGrantId,
  validateBranchPattern,
  validateControllerId,
  validateGrantId,
  validateOperations,
  validateOwnerLabel,
} from '../src/validate.js';

import { codeOf } from './support/app-error.js';

describe('validateGrantId / mintGrantId', () => {
  it('accepts jg-<32 hex> and rejects everything else', () => {
    expect(validateGrantId(mintGrantId())).toMatch(/^jg-[0-9a-f]{32}$/);
    for (const bad of [
      '',
      'jg-short',
      'jl-00000000000000000000000000000001',
      'jg-0000000000000000000000000000000G',
      'jg-000000000000000000000000000000012',
      42,
      undefined,
    ]) {
      expect(codeOf(() => validateGrantId(bad))).toBe('JULES_INVALID_INPUT');
    }
  });
});

describe('validateBranchPattern', () => {
  it('accepts an exact ref or a single trailing glob', () => {
    expect(validateBranchPattern('main')).toBe('main');
    expect(validateBranchPattern('scratch/one')).toBe('scratch/one');
    expect(validateBranchPattern('scratch/*')).toBe('scratch/*');
    expect(validateBranchPattern('feat-*')).toBe('feat-*');
  });

  it.each([
    '',
    '*',
    '*/x',
    'a*b',
    'a**',
    'a/*/*',
    '-x',
    '../x',
    'a b',
    'a;b',
    `${'a'.repeat(201)}`,
  ])('rejects %j', (bad) => {
    expect(codeOf(() => validateBranchPattern(bad))).toBe(
      'JULES_INVALID_INPUT'
    );
  });
});

describe('branchMatchesPattern', () => {
  it('exact patterns match only themselves; globs match by prefix', () => {
    expect(branchMatchesPattern('main', 'main')).toBe(true);
    expect(branchMatchesPattern('main', 'main2')).toBe(false);
    expect(branchMatchesPattern('scratch/*', 'scratch/a/b')).toBe(true);
    expect(branchMatchesPattern('scratch/*', 'scratch')).toBe(false);
    expect(branchMatchesPattern('scratch/*', 'xscratch/a')).toBe(false);
  });
});

describe('validateOperations', () => {
  it('parses a known, duplicate-free subset in order', () => {
    expect(validateOperations('create,reply,approve,collect')).toEqual([
      'create',
      'reply',
      'approve',
      'collect',
    ]);
    expect(validateOperations('collect')).toEqual(['collect']);
  });

  it.each(['', 'create,', 'delete', 'create,create', 'Create', 'create reply'])(
    'rejects %j',
    (bad) => {
      expect(codeOf(() => validateOperations(bad))).toBe('JULES_INVALID_INPUT');
    }
  );
});

describe('validateControllerId / validateOwnerLabel', () => {
  it('controller ids are filename-safe', () => {
    expect(validateControllerId('my-host.local_1')).toBe('my-host.local_1');
    for (const bad of [
      '',
      '.hidden',
      '../x',
      'a/b',
      'a b',
      '__proto__',
      'x'.repeat(64),
    ]) {
      expect(codeOf(() => validateControllerId(bad))).toBe(
        'JULES_INVALID_INPUT'
      );
    }
  });

  it('owner labels are bounded printable text', () => {
    expect(validateOwnerLabel('Jane D. <x>'.replace(/[<>]/g, ''))).toBeTruthy();
    for (const bad of ['', ' lead', 'a\nb', 'a'.repeat(65), '$(x)']) {
      expect(codeOf(() => validateOwnerLabel(bad))).toBe('JULES_INVALID_INPUT');
    }
  });
});
