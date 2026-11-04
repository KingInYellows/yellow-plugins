import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Grant } from '../src/grants';
import {
  authorizeRequest,
  branchMatches,
  buildGrant,
  putGrant,
  revokeGrant,
  validateBranchPattern,
} from '../src/grants';
import type { Journal, Task } from '../src/state';
import { readJournal, writeJournal } from '../src/state';

import { tmpDir } from './helpers';

const NOW = new Date('2026-11-03T00:00:00Z');
const EMPTY: Journal = { version: 1, tasks: {}, requests: {}, usage: [] };

function grant(extra: Partial<Grant> = {}): Grant {
  return {
    ...buildGrant(
      {
        repo: '/r',
        branchPattern: 'agy/*',
        operations: 'create,approve,reply',
      },
      NOW
    ),
    ...extra,
  };
}

function task(g: Grant, extra: Partial<Task> = {}): Task {
  return {
    localId: 't1',
    branch: 'agy/x',
    repo: '/r',
    worktree: '/w/t1',
    base: 'a'.repeat(40),
    state: 'PLAN_PENDING',
    approved: false,
    correctiveRounds: 0,
    requiresAttention: false,
    grantId: g.grantId,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...extra,
  };
}

const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
    return undefined;
  } catch (err) {
    return (err as { code?: string }).code;
  }
};

describe('grants', () => {
  it('validates a new grant and applies defaults', () => {
    const g = grant();
    expect(g.grantId).toMatch(/^ag-[0-9a-f]{32}$/);
    expect(g.maxTotalTasks).toBe(3);
    expect(g.minQuotaPercent).toBe(10);
    expect(Date.parse(g.expiresAt) - NOW.getTime()).toBe(120 * 60_000);
    const bad = (input: Record<string, unknown>) =>
      code(() =>
        buildGrant(
          {
            repo: '/r',
            branchPattern: 'agy/*',
            operations: 'create',
            ...input,
          },
          NOW
        )
      );
    expect(bad({ operations: 'create,push' })).toBe('AGY_INVALID_INPUT');
    expect(bad({ operations: 'create,create' })).toBe('AGY_INVALID_INPUT');
    expect(bad({ maxTotalTasks: 11 })).toBe('AGY_INVALID_INPUT');
    expect(bad({ ttlMinutes: 0 })).toBe('AGY_INVALID_INPUT');
    expect(bad({ minQuotaPercent: 101 })).toBe('AGY_INVALID_INPUT');
    expect(bad({ allowCommands: ['git status'] })).toBe('AGY_INVALID_INPUT');
  });

  it('branch patterns are exact or one trailing star', () => {
    expect(validateBranchPattern('agy/*')).toBe('agy/*');
    expect(validateBranchPattern('agy/fix-1')).toBe('agy/fix-1');
    for (const p of ['*', 'a*b', 'agy/**', '-x', 'a..b*'])
      expect(code(() => validateBranchPattern(p))).toBe('AGY_INVALID_INPUT');
    expect(branchMatches('agy/*', 'agy/x')).toBe(true);
    expect(branchMatches('agy/*', 'main')).toBe(false);
    expect(branchMatches('agy/x', 'agy/xy')).toBe(false);
  });

  it('checks in order and charges a create', () => {
    const g = grant();
    const j = putGrant(EMPTY, g);
    const req = { op: 'delegate' as const, repo: '/r', branch: 'agy/x' };
    const charged = authorizeRequest(j, g.grantId, req, NOW);
    expect(charged.grants?.[g.grantId]?.totalTasks).toBe(1);
    expect(
      code(() => authorizeRequest(j, 'ag-' + '0'.repeat(32), req, NOW))
    ).toBe('AGY_AUTHORITY_DENIED');
    expect(
      code(() => authorizeRequest(j, g.grantId, { ...req, repo: '/o' }, NOW))
    ).toBe('AGY_AUTHORITY_DENIED');
    expect(
      code(() =>
        authorizeRequest(j, g.grantId, { ...req, branch: 'main' }, NOW)
      )
    ).toBe('AGY_AUTHORITY_DENIED');
    expect(
      code(() =>
        authorizeRequest(j, g.grantId, req, new Date(Date.parse(g.expiresAt)))
      )
    ).toBe('AGY_GRANT_EXPIRED');
    expect(
      code(() =>
        authorizeRequest(revokeGrant(j, g.grantId, NOW), g.grantId, req, NOW)
      )
    ).toBe('AGY_AUTHORITY_DENIED');
    const full = putGrant(EMPTY, { ...g, totalTasks: 3 });
    expect(code(() => authorizeRequest(full, g.grantId, req, NOW))).toBe(
      'AGY_GRANT_EXHAUSTED'
    );
    // collect isn't in this grant.
    expect(
      code(() =>
        authorizeRequest(
          j,
          g.grantId,
          { op: 'collect', repo: '/r', branch: 'agy/x', task: task(g) },
          NOW
        )
      )
    ).toBe('AGY_AUTHORITY_DENIED');
  });

  it('a task stays with its grant, and corrections are capped per task', () => {
    const g = grant();
    const other = grant();
    const j = putGrant(putGrant(EMPTY, g), other);
    const base = { op: 'reply' as const, repo: '/r', branch: 'agy/x' };
    expect(
      code(() =>
        authorizeRequest(j, other.grantId, { ...base, task: task(g) }, NOW)
      )
    ).toBe('AGY_AUTHORITY_DENIED');
    const used = task(g, { correctiveRounds: 2 });
    expect(authorizeRequest(j, g.grantId, { ...base, task: used }, NOW)).toBe(
      j
    );
    expect(
      code(() =>
        authorizeRequest(
          j,
          g.grantId,
          { ...base, task: used, correction: true },
          NOW
        )
      )
    ).toBe('AGY_GRANT_EXHAUSTED');
  });

  it('round-trips through the journal and refuses a damaged grant', () => {
    const dir = path.join(tmpDir('yellow-agy-grants-'), 'data');
    const g = grant();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeJournal(dir, putGrant(EMPTY, g));
    expect(readJournal(dir).grants?.[g.grantId]).toEqual(g);
    for (const bad of [
      { operations: ['push' as never] },
      { branchPattern: '*' },
      { maxTotalTasks: 11 },
      { maxCorrectiveRounds: 4 },
      { maxTotalTasks: 0 },
      { expiresAt: new Date(NOW.getTime() + 25 * 3600_000).toISOString() },
    ]) {
      writeJournal(dir, putGrant(EMPTY, { ...g, ...bad }));
      expect(code(() => readJournal(dir))).toBe('AGY_INTERNAL');
    }
  });
});
