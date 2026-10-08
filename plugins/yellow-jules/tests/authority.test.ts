import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  chargeGrant,
  emptyGrants,
  evaluateAuthority,
  GRANT_CEILINGS,
  GRANT_DEFAULTS,
  grantHasUnreconciledDeviation,
  listGrants,
  loadGrants,
  releaseGrant,
  revokeGrant,
  writeGrants,
} from '../src/authority.js';
import { resolveGrantsPath } from '../src/config.js';
import { emptyJournal } from '../src/state.js';
import type { OperationRecord } from '../src/types.js';

import { codeOfAsync } from './support/app-error.js';
import { makeGrant, NOW } from './support/grants.js';

const REQUEST = {
  repository: 'acme/widgets',
  sourceResource: 'sources/github/acme/widgets',
  branch: 'scratch/one',
  taskRef: 't1',
  operation: 'create' as const,
};
const CLEAN = { unreconciledDeviation: false };

describe('evaluateAuthority ordering', () => {
  it('allows a covered request', () => {
    expect(evaluateAuthority(makeGrant(), REQUEST, NOW, CLEAN)).toEqual({
      ok: true,
    });
  });

  it('revoked is checked first, even when everything else would also fail', () => {
    const grant = makeGrant({
      revokedAt: '2026-09-29T11:00:00.000Z',
      expiresAt: '2026-09-29T10:00:00.000Z',
    });
    const verdict = evaluateAuthority(
      grant,
      { ...REQUEST, repository: 'other/repo' },
      NOW,
      CLEAN
    );
    expect(verdict).toMatchObject({ ok: false, reason: 'revoked' });
  });

  it('expired -> JULES_GRANT_EXPIRED, checked before scope', () => {
    const verdict = evaluateAuthority(
      makeGrant({ expiresAt: '2026-09-29T11:59:59.000Z' }),
      { ...REQUEST, repository: 'other/repo' },
      NOW,
      CLEAN
    );
    expect(verdict).toMatchObject({
      ok: false,
      code: 'JULES_GRANT_EXPIRED',
      reason: 'expired',
    });
  });

  it('expiry is inclusive of the expiry instant', () => {
    const verdict = evaluateAuthority(
      makeGrant({ expiresAt: NOW.toISOString() }),
      REQUEST,
      NOW,
      CLEAN
    );
    expect(verdict).toMatchObject({ ok: false, reason: 'expired' });
  });

  it('repository or source mismatch', () => {
    expect(
      evaluateAuthority(
        makeGrant(),
        { ...REQUEST, repository: 'other/repo' },
        NOW,
        CLEAN
      )
    ).toMatchObject({ ok: false, reason: 'repository-mismatch' });
    expect(
      evaluateAuthority(
        makeGrant(),
        { ...REQUEST, sourceResource: 'sources/github/other/repo' },
        NOW,
        CLEAN
      )
    ).toMatchObject({ ok: false, reason: 'repository-mismatch' });
  });

  it('branch outside the pattern; exact refs and trailing globs', () => {
    expect(
      evaluateAuthority(makeGrant(), { ...REQUEST, branch: 'main' }, NOW, CLEAN)
    ).toMatchObject({ ok: false, reason: 'branch-outside-pattern' });
    const exact = makeGrant({ branchPattern: 'scratch/one' });
    expect(evaluateAuthority(exact, REQUEST, NOW, CLEAN).ok).toBe(true);
    expect(
      evaluateAuthority(
        exact,
        { ...REQUEST, branch: 'scratch/one2' },
        NOW,
        CLEAN
      ).ok
    ).toBe(false);
  });

  it('task ref outside the grant, or missing', () => {
    expect(
      evaluateAuthority(makeGrant(), { ...REQUEST, taskRef: 't9' }, NOW, CLEAN)
    ).toMatchObject({ ok: false, reason: 'task-ref-outside-grant' });
    const { taskRef: _omit, ...noTask } = REQUEST;
    expect(evaluateAuthority(makeGrant(), noTask, NOW, CLEAN)).toMatchObject({
      ok: false,
      reason: 'task-ref-outside-grant',
    });
  });

  it('operation not permitted', () => {
    const grant = makeGrant({ operations: ['collect'] });
    expect(evaluateAuthority(grant, REQUEST, NOW, CLEAN)).toMatchObject({
      ok: false,
      reason: 'operation-not-permitted',
    });
  });

  it('active-session, total-task and corrective-round limits are JULES_GRANT_EXHAUSTED', () => {
    const active = chargeGrant(makeGrant(), {
      operation: 'create',
      localRequestId: 'r1',
      taskRef: 't1',
    });
    expect(evaluateAuthority(active, REQUEST, NOW, CLEAN)).toMatchObject({
      ok: false,
      code: 'JULES_GRANT_EXHAUSTED',
      reason: 'active-sessions-exhausted',
    });

    const tasks = makeGrant({
      maxActiveSessions: 3,
      maxTotalTasks: 1,
      usage: { ...makeGrant().usage, totalTasks: 1 },
    });
    expect(evaluateAuthority(tasks, REQUEST, NOW, CLEAN)).toMatchObject({
      ok: false,
      code: 'JULES_GRANT_EXHAUSTED',
      reason: 'total-tasks-exhausted',
    });

    const rounds = makeGrant({
      maxCorrectiveRounds: 1,
      usage: {
        ...makeGrant().usage,
        correctiveRounds: Object.assign(Object.create(null), { t1: 1 }),
      },
    });
    expect(
      evaluateAuthority(
        rounds,
        { ...REQUEST, operation: 'reply', correction: true },
        NOW,
        CLEAN
      )
    ).toMatchObject({
      ok: false,
      code: 'JULES_GRANT_EXHAUSTED',
      reason: 'corrective-rounds-exhausted',
    });
    // A plain (non-corrective) reply is not limited by rounds.
    expect(
      evaluateAuthority(rounds, { ...REQUEST, operation: 'reply' }, NOW, CLEAN)
        .ok
    ).toBe(true);
  });

  it('a repair create is limited by rounds, not by total tasks', () => {
    const grant = makeGrant({
      maxTotalTasks: 1,
      usage: { ...makeGrant().usage, totalTasks: 1 },
    });
    expect(
      evaluateAuthority(grant, { ...REQUEST, correction: true }, NOW, CLEAN).ok
    ).toBe(true);
  });

  it('an unreconciled policy deviation under the grant is checked last', () => {
    expect(
      evaluateAuthority(makeGrant(), REQUEST, NOW, {
        unreconciledDeviation: true,
      })
    ).toMatchObject({
      ok: false,
      code: 'JULES_POLICY_DEVIATION',
      reason: 'unreconciled-policy-deviation',
    });
    // An earlier failure outranks it.
    expect(
      evaluateAuthority(makeGrant(), { ...REQUEST, branch: 'main' }, NOW, {
        unreconciledDeviation: true,
      })
    ).toMatchObject({ reason: 'branch-outside-pattern' });
  });
});

describe('ceilings and defaults', () => {
  it('match the documented values', () => {
    expect(GRANT_DEFAULTS).toEqual({
      maxActiveSessions: 1,
      maxTotalTasks: 3,
      maxCorrectiveRounds: 2,
      ttlMinutes: 120,
    });
    expect(GRANT_CEILINGS).toEqual({
      maxActiveSessions: 3,
      maxTotalTasks: 10,
      maxCorrectiveRounds: 3,
      ttlMinutes: 1440,
    });
  });
});

describe('chargeGrant / releaseGrant', () => {
  it('a create takes a slot and a task; the original is not mutated', () => {
    const grant = makeGrant();
    const charged = chargeGrant(grant, {
      operation: 'create',
      localRequestId: 'r1',
      taskRef: 't1',
    });
    expect(charged.usage.activeSessionRefs).toEqual(['r1']);
    expect(charged.usage.totalTasks).toBe(1);
    expect(grant.usage.activeSessionRefs).toEqual([]);
  });

  it('charging the same request twice does not double-count the slot', () => {
    let grant = makeGrant();
    for (let i = 0; i < 2; i += 1) {
      grant = chargeGrant(grant, {
        operation: 'create',
        localRequestId: 'r1',
        taskRef: 't1',
      });
    }
    expect(grant.usage.activeSessionRefs).toEqual(['r1']);
  });

  it('a repair create spends a corrective round instead of a task', () => {
    const charged = chargeGrant(makeGrant(), {
      operation: 'create',
      localRequestId: 'r2',
      taskRef: 't1',
      correction: true,
    });
    expect(charged.usage.totalTasks).toBe(0);
    expect(charged.usage.correctiveRounds['t1']).toBe(1);
    expect(Object.getPrototypeOf(charged.usage.correctiveRounds)).toBeNull();
  });

  it('a corrective reply spends a round and no slot; a plain reply spends nothing', () => {
    const corrective = chargeGrant(makeGrant(), {
      operation: 'reply',
      localRequestId: 'r3',
      taskRef: 't1',
      correction: true,
    });
    expect(corrective.usage.correctiveRounds['t1']).toBe(1);
    expect(corrective.usage.activeSessionRefs).toEqual([]);
    const plain = chargeGrant(makeGrant(), {
      operation: 'reply',
      localRequestId: 'r4',
      taskRef: 't1',
    });
    expect(plain.usage).toEqual(makeGrant().usage);
  });

  it('release frees the slot only: tasks and rounds never decrement', () => {
    const charged = chargeGrant(makeGrant(), {
      operation: 'create',
      localRequestId: 'r1',
      taskRef: 't1',
    });
    const released = releaseGrant(charged, 'r1', 'reconcile-released');
    expect(released.usage.activeSessionRefs).toEqual([]);
    expect(released.usage.totalTasks).toBe(1);
  });

  it('releasing an unknown request is a no-op', () => {
    const grant = makeGrant();
    expect(releaseGrant(grant, 'nope', 'abandon')).toBe(grant);
  });
});

describe('grantHasUnreconciledDeviation', () => {
  it('finds a deviation only on records under that grant', () => {
    const journal = emptyJournal();
    const base = {
      localRequestId: 'r1',
      localId: 'jl-00000000000000000000000000000001',
      kind: 'create',
      origin: 'yellow',
      status: 'accepted',
      grantId: 'jg-00000000000000000000000000000001',
      recentActivityIds: [],
      activityCount: 0,
      resumeRestartCount: 0,
      artifacts: [],
      deviations: [
        {
          kind: 'policy-deviation',
          reason: 'x',
          observedAt: 'now',
          reconciled: false,
        },
      ],
      createdAt: 'now',
      updatedAt: 'now',
    } as unknown as OperationRecord;
    journal.operations['r1'] = base;
    expect(
      grantHasUnreconciledDeviation(
        journal,
        'jg-00000000000000000000000000000001'
      )
    ).toBe(true);
    expect(
      grantHasUnreconciledDeviation(
        journal,
        'jg-00000000000000000000000000000002'
      )
    ).toBe(false);
  });
});

describe('grants file', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yellow-jules-grants-'));
  });
  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('a missing file is no grants', () => {
    expect(Object.keys(loadGrants(dataDir).grants)).toEqual([]);
  });

  it('round-trips with 0600 and null-prototype maps', () => {
    const file = emptyGrants();
    const grant = chargeGrant(makeGrant(), {
      operation: 'create',
      localRequestId: 'r1',
      taskRef: 't1',
      correction: true,
    });
    file.grants[grant.grantId] = grant;
    writeGrants(dataDir, file);
    expect(fs.statSync(resolveGrantsPath(dataDir)).mode & 0o777).toBe(0o600);
    const back = loadGrants(dataDir);
    expect(back.grants[grant.grantId]).toEqual(grant);
    expect(Object.getPrototypeOf(back.grants)).toBeNull();
    expect(
      Object.getPrototypeOf(back.grants[grant.grantId]?.usage.correctiveRounds)
    ).toBeNull();
  });

  it.each([
    ['not json', '{nope'],
    ['wrong version', JSON.stringify({ version: 2, grants: {} })],
    ['grants not an object', JSON.stringify({ version: 1, grants: [] })],
    [
      'key/grantId mismatch',
      JSON.stringify({
        version: 1,
        grants: { 'jg-00000000000000000000000000000009': makeGrant() },
      }),
    ],
    [
      'unknown operation',
      JSON.stringify({
        version: 1,
        grants: {
          [makeGrant().grantId]: { ...makeGrant(), operations: ['delete'] },
        },
      }),
    ],
    [
      'negative counter',
      JSON.stringify({
        version: 1,
        grants: {
          [makeGrant().grantId]: {
            ...makeGrant(),
            usage: {
              activeSessionRefs: [],
              totalTasks: -1,
              correctiveRounds: {},
            },
          },
        },
      }),
    ],
  ])(
    'a corrupt grants file (%s) is JULES_JOURNAL_CORRUPT and is left untouched',
    async (_label, raw) => {
      fs.mkdirSync(path.join(dataDir, 'state'), {
        recursive: true,
        mode: 0o700,
      });
      const file = resolveGrantsPath(dataDir);
      fs.writeFileSync(file, raw, { mode: 0o600 });
      expect(await codeOfAsync(async () => loadGrants(dataDir))).toBe(
        'JULES_JOURNAL_CORRUPT'
      );
      expect(fs.readFileSync(file, 'utf8')).toBe(raw);
    }
  );

  it('a group-writable grants file is refused', async () => {
    fs.mkdirSync(path.join(dataDir, 'state'), { recursive: true, mode: 0o700 });
    const file = resolveGrantsPath(dataDir);
    fs.writeFileSync(file, '{}', { mode: 0o666 });
    fs.chmodSync(file, 0o666);
    expect(await codeOfAsync(async () => loadGrants(dataDir))).toBe(
      'JULES_DATA_DIR'
    );
  });

  it('revoke needs no terminal, is idempotent, and list reports revoked/expired', async () => {
    const file = emptyGrants();
    const live = makeGrant();
    const old = makeGrant({
      grantId: 'jg-00000000000000000000000000000002',
      expiresAt: '2026-09-29T00:00:00.000Z',
    });
    file.grants[live.grantId] = live;
    file.grants[old.grantId] = old;
    writeGrants(dataDir, file);

    const first = await revokeGrant(dataDir, live.grantId, NOW);
    const again = await revokeGrant(
      dataDir,
      live.grantId,
      new Date('2027-01-01')
    );
    expect(again.revokedAt).toBe(first.revokedAt);

    const views = listGrants(dataDir, NOW);
    const byId = Object.fromEntries(views.map((v) => [v.grantId, v]));
    expect(byId[live.grantId]).toMatchObject({ revoked: true, expired: false });
    expect(byId[old.grantId]).toMatchObject({ revoked: false, expired: true });
  });

  it('revoking an unknown grant is JULES_NOT_FOUND', async () => {
    expect(
      await codeOfAsync(() =>
        revokeGrant(dataDir, 'jg-ffffffffffffffffffffffffffffffff', NOW)
      )
    ).toBe('JULES_NOT_FOUND');
  });
});
