import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { nextRing } from '../src/activity-walk.js';
import { resolveJournalPath, resolveStateDir } from '../src/config.js';
import { AdapterError } from '../src/errors.js';
import { conditionOf, status } from '../src/runtime.js';
import {
  ensureObservedRecord,
  markOperation,
  readJournal,
  reserveOperation,
  upsertReadState,
} from '../src/state.js';
import type { AdapterActivity } from '../src/types.js';

import {
  FakeSdkAdapter,
  makeActivities,
  makeDeps,
  makeSession,
  resetActivitySeq,
} from './fake-sdk.js';
import { codeOfAsync } from './support/app-error.js';

vi.setConfig({ testTimeout: 30_000 });

const S = 'sessions/s1';
let dataDir: string;
let fake: FakeSdkAdapter;

beforeEach(async () => {
  dataDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'yellow-jules-status-')
  );
  fake = new FakeSdkAdapter();
  fake.sessions.set(S, makeSession());
  resetActivitySeq();
});

afterEach(async () => {
  await fs.promises.rm(dataDir, { recursive: true, force: true });
});

async function recordFor(sessionResource = S) {
  const journal = await readJournal(dataDir);
  return Object.values(journal.operations).find(
    (r) => r.sessionResource === sessionResource
  );
}

describe('condition mapping (R10)', () => {
  it.each([
    ['queued', 'starting'],
    ['planning', 'starting'],
    ['awaitingPlanApproval', 'awaiting-approval'],
    ['awaitingUserFeedback', 'awaiting-reply'],
    ['inProgress', 'working'],
    ['paused', 'paused'],
    ['failed', 'failed'],
    ['completed', 'remote-completed'],
    ['unspecified', 'needs-inspection'],
    ['SOMETHING_NEW', 'needs-inspection'],
    ['toString', 'needs-inspection'],
    ['__proto__', 'needs-inspection'],
  ])('%s -> %s', (state, condition) => {
    expect(conditionOf(state)).toBe(condition);
  });

  it('an unknown vendor state lands in needs-inspection end to end', async () => {
    fake.sessions.set(S, makeSession({ vendorState: 'unspecified' }));
    const result = await status(makeDeps(dataDir, fake), {
      session: S,
      reconcile: false,
    });
    expect(result.vendorState).toBe('unspecified');
    expect(result.condition).toBe('needs-inspection');
  });
});

describe('external sessions', () => {
  it('mints a local id on first sight and reuses it', async () => {
    const first = await status(makeDeps(dataDir, fake), {
      session: S,
      reconcile: false,
    });
    expect(first.localId).toMatch(/^jl-[0-9a-f]{32}$/);
    const record = await recordFor();
    expect(record?.origin).toBe('external');
    const second = await status(makeDeps(dataDir, fake), {
      session: first.localId,
      reconcile: false,
    });
    expect(second.localId).toBe(first.localId);
    expect(second.sessionResource).toBe(S);
  });

  it('an unknown local id is JULES_NOT_FOUND', async () => {
    await expect(
      codeOfAsync(() =>
        status(makeDeps(dataDir, fake), {
          session: `jl-${'0'.repeat(32)}`,
          reconcile: false,
        })
      )
    ).resolves.toBe('JULES_NOT_FOUND');
  });

  it('closes the adapter after the read', async () => {
    await status(makeDeps(dataDir, fake), { session: S, reconcile: false });
    expect(fake.closed).toBe(true);
  });

  it('strips the reconcile tag from the displayed title', async () => {
    fake.sessions.set(
      S,
      makeSession({ title: `[yellow:jl-${'a'.repeat(32)}] Do it` })
    );
    const result = await status(makeDeps(dataDir, fake), {
      session: S,
      reconcile: false,
    });
    expect(result.title).toBe('Do it');
  });
});

describe('activity paging and the watermark', () => {
  it('walks every page, counts new activities, and advances the watermark on a complete walk', async () => {
    fake.activities.set(S, makeActivities(120));
    const result = await status(makeDeps(dataDir, fake), {
      session: S,
      reconcile: false,
    });
    expect(result.activities).toMatchObject({
      processed: 120,
      new: 120,
      pages: 3,
      partialPagination: false,
    });
    expect(result.requiresAttention).toBeUndefined();
    const record = await recordFor();
    expect(record?.lastActivityId).toBe('a0120');
    expect(record?.activityCount).toBe(120);
    expect(record?.resumePageToken).toBeUndefined();
  });

  it('a later walk sends the watermark filter and counts nothing twice', async () => {
    fake.activities.set(S, makeActivities(60));
    await status(makeDeps(dataDir, fake), { session: S, reconcile: false });
    fake.calls.length = 0;
    const again = await status(makeDeps(dataDir, fake), {
      session: S,
      reconcile: false,
    });
    const first = fake.callsTo('listActivities')[0]?.args[1] as {
      filter?: string;
    };
    // Newest activity is 00:01:00; the filter re-reads the 5-minute overlap window below it.
    expect(first.filter).toBe('create_time>"2026-08-31T23:56:00.000Z"');
    expect(again.activities?.new).toBe(0);
    expect((await recordFor())?.activityCount).toBe(60);
  });

  it('counts duplicate activity ids across pages once', async () => {
    const [a1, a2, a3] = makeActivities(3) as [
      AdapterActivity,
      AdapterActivity,
      AdapterActivity,
    ];
    fake.listActivitiesImpl = async (_s, o) =>
      o.pageToken === undefined
        ? { activities: [a1, a2], nextPageToken: 'p2' }
        : { activities: [a2, a3] };
    const result = await status(makeDeps(dataDir, fake), {
      session: S,
      reconcile: false,
    });
    expect(result.activities).toMatchObject({
      processed: 4,
      new: 3,
      pages: 2,
      partialPagination: false,
    });
  });

  it('a filtered 400 is retried once unfiltered', async () => {
    fake.activities.set(S, makeActivities(5));
    await status(makeDeps(dataDir, fake), { session: S, reconcile: false });
    const base = fake.listActivitiesImpl;
    fake.listActivitiesImpl = async (s, o) => {
      if (o.filter !== undefined)
        throw new AdapterError('invalid-request', 'bad filter', {
          status: 400,
        });
      return base(s, o);
    };
    fake.calls.length = 0;
    const result = await status(makeDeps(dataDir, fake), {
      session: S,
      reconcile: false,
    });
    const calls = fake
      .callsTo('listActivities')
      .map((c) => c.args[1] as { filter?: string });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.filter).toBeDefined();
    expect(calls[1]?.filter).toBeUndefined();
    expect(result.activities?.partialPagination).toBe(false);
  });
});

describe('partial pagination never manufactures an end (R18)', () => {
  it('stops at a page failure after bounded retries and records a resume token', async () => {
    fake.activities.set(S, makeActivities(120));
    const base = fake.listActivitiesImpl;
    fake.listActivitiesImpl = async (s, o) => {
      if (o.pageToken === 'p50') throw new AdapterError('network', 'reset');
      return base(s, o);
    };
    const result = await status(makeDeps(dataDir, fake), {
      session: S,
      reconcile: false,
    });
    expect(result.activities).toMatchObject({
      pages: 1,
      partialPagination: true,
      resumePageToken: 'p50',
    });
    expect(result.requiresAttention).toBe(true);
    expect(result.attention).toContain('partialPagination');
    // 1 good page + 3 attempts at the failing page (2 retries).
    expect(fake.callsTo('listActivities')).toHaveLength(4);
    const record = await recordFor();
    expect(record?.lastActivityId).toBeUndefined();
    expect(record?.resumePageToken).toBe('p50');

    // The next status resumes from the token and completes.
    fake.listActivitiesImpl = base;
    fake.calls.length = 0;
    const resumed = await status(makeDeps(dataDir, fake), {
      session: S,
      reconcile: false,
    });
    expect(
      (fake.callsTo('listActivities')[0]?.args[1] as { pageToken?: string })
        .pageToken
    ).toBe('p50');
    expect(resumed.activities?.partialPagination).toBe(false);
    expect((await recordFor())?.lastActivityId).toBe('a0120');
    expect((await recordFor())?.resumePageToken).toBeUndefined();
  });

  it('never retries a 429 page', async () => {
    fake.listActivitiesImpl = async () => {
      throw new AdapterError('rate-limited', '429', { status: 429 });
    };
    const result = await status(makeDeps(dataDir, fake), {
      session: S,
      reconcile: false,
    });
    expect(result.activities?.partialPagination).toBe(true);
    expect(fake.callsTo('listActivities')).toHaveLength(1);
  });

  it('stops at the 20-page cap', async () => {
    fake.activities.set(S, makeActivities(1050));
    const result = await status(makeDeps(dataDir, fake), {
      session: S,
      reconcile: false,
    });
    expect(result.activities).toMatchObject({
      pages: 20,
      processed: 1000,
      partialPagination: true,
      resumePageToken: 'p1000',
    });
  });

  it('stops at the deadline', async () => {
    fake.activities.set(S, makeActivities(200));
    const deps = makeDeps(dataDir, fake);
    const base = fake.listActivitiesImpl;
    fake.listActivitiesImpl = async (s, o) => {
      deps.clock.time += 40_000;
      return base(s, o);
    };
    const result = await status(deps, {
      session: S,
      reconcile: false,
      deadlineMs: 100_000,
    });
    expect(result.activities?.partialPagination).toBe(true);
    expect(result.activities?.pages).toBe(3);
  });

  it('stops on an activity the SDK mapper cannot parse', async () => {
    fake.activities.set(S, makeActivities(60));
    const base = fake.listActivitiesImpl;
    fake.listActivitiesImpl = async (s, o) =>
      o.pageToken === 'p50'
        ? { activities: [], unmappedActivity: true }
        : base(s, o);
    const result = await status(makeDeps(dataDir, fake), {
      session: S,
      reconcile: false,
    });
    expect(result.activities).toMatchObject({
      partialPagination: true,
      unmappedActivity: true,
    });
    expect(result.attention).toEqual(
      expect.arrayContaining(['partialPagination', 'unmappedActivity'])
    );
  });
});

describe('resume-token restarts and JULES_NO_PROGRESS', () => {
  it('a rejected token restarts from the fallback, and a second consecutive restart fails', async () => {
    fake.activities.set(S, makeActivities(120));
    const rec = await ensureObservedRecord(dataDir, S);
    await upsertReadState(dataDir, rec.localRequestId, {
      resumePageToken: 'bad',
    });
    const base = fake.listActivitiesImpl;
    const rejected = new Set(['bad']);
    fake.listActivitiesImpl = async (s, o) => {
      if (o.pageToken !== undefined && rejected.has(o.pageToken)) {
        throw new AdapterError('invalid-request', 'bad token', { status: 400 });
      }
      if (o.pageToken === 'p50') throw new AdapterError('network', 'reset');
      return base(s, o);
    };

    const first = await status(makeDeps(dataDir, fake), {
      session: S,
      reconcile: false,
    });
    expect(first.activities?.partialPagination).toBe(true);
    expect((await recordFor())?.resumeRestartCount).toBe(1);
    expect((await recordFor())?.resumePageToken).toBe('p50');

    rejected.add('p50');
    await expect(
      codeOfAsync(() =>
        status(makeDeps(dataDir, fake), { session: S, reconcile: false })
      )
    ).resolves.toBe('JULES_NO_PROGRESS');
    expect((await recordFor())?.resumePageToken).toBeUndefined();
  });

  it('a resumed walk that finds nothing new discards the token', async () => {
    const acts = makeActivities(10);
    fake.activities.set(S, acts);
    const rec = await ensureObservedRecord(dataDir, S);
    await upsertReadState(dataDir, rec.localRequestId, {
      resumePageToken: 'p0',
      watermark: {
        createTime: acts[9]!.createTime,
        activityId: acts[9]!.activityId,
      },
      recentActivityIds: acts.map((a) => a.activityId),
    });
    const result = await status(makeDeps(dataDir, fake), {
      session: S,
      reconcile: false,
    });
    expect(result.activities?.new).toBe(0);
    const record = await recordFor();
    expect(record?.resumeRestartCount).toBe(1);
    expect(record?.resumePageToken).toBeUndefined();
  });

  it('a walk that makes progress resets the restart count', async () => {
    fake.activities.set(S, makeActivities(5));
    const rec = await ensureObservedRecord(dataDir, S);
    await upsertReadState(dataDir, rec.localRequestId, {
      resumeRestartCount: 1,
    });
    await status(makeDeps(dataDir, fake), { session: S, reconcile: false });
    expect((await recordFor())?.resumeRestartCount).toBe(0);
  });
});

describe('dedup ring', () => {
  it('overflowing the 1000-id ring reports dedupWindowExceeded', async () => {
    fake.activities.set(S, makeActivities(60));
    const rec = await ensureObservedRecord(dataDir, S);
    await upsertReadState(dataDir, rec.localRequestId, {
      recentActivityIds: Array.from({ length: 990 }, (_, i) => `old${i}`),
    });
    const base = fake.listActivitiesImpl;
    fake.listActivitiesImpl = async (s, o) => {
      if (o.pageToken === 'p50') throw new AdapterError('network', 'reset');
      return base(s, o);
    };
    const result = await status(makeDeps(dataDir, fake), {
      session: S,
      reconcile: false,
    });
    expect(result.activities?.dedupWindowExceeded).toBe(true);
    expect(result.attention).toContain('dedupWindowExceeded');
    expect((await recordFor())?.recentActivityIds).toHaveLength(1000);
  });

  it('a complete walk keeps only ids inside the 5-minute overlap window below the newest', () => {
    const seen = [
      { activityId: 'old', createTime: '2026-09-01T00:00:00Z' },
      { activityId: 'edge', createTime: '2026-09-01T00:05:00Z' },
      { activityId: 'new', createTime: '2026-09-01T00:10:00Z' },
    ];
    const out = nextRing([], {
      complete: true,
      seen,
      newest: { createTime: '2026-09-01T00:10:00Z', activityId: 'new' },
      newIds: [],
    });
    expect(out).toEqual({ ring: ['edge', 'new'], dedupWindowExceeded: false });
  });
});

describe('pendingPlan', () => {
  const plan = (
    id: string,
    createOffset: number,
    activityId: string
  ): AdapterActivity => ({
    activityId,
    createTime: new Date(
      Date.parse('2026-09-01T00:00:00Z') + createOffset * 1000
    ).toISOString(),
    type: 'planGenerated',
    plan: { planId: id, steps: [{ id: 'st1', title: 'Step', index: 0 }] },
    artifacts: [],
  });

  it('the newest planGenerated wins and a later planApproved clears it', async () => {
    fake.activities.set(S, [plan('p1', 1, 'x1'), plan('p2', 2, 'x2')]);
    const first = await status(makeDeps(dataDir, fake), {
      session: S,
      reconcile: false,
    });
    expect(first.pendingPlan?.planId).toBe('p2');

    fake.activities.set(S, [
      plan('p1', 1, 'x1'),
      plan('p2', 2, 'x2'),
      {
        activityId: 'x3',
        createTime: '2026-09-01T00:00:03.000Z',
        type: 'planApproved',
        approvedPlanId: 'p2',
        artifacts: [],
      },
    ]);
    const second = await status(makeDeps(dataDir, fake), {
      session: S,
      reconcile: false,
    });
    expect(second.pendingPlan).toBeUndefined();
    expect((await recordFor())?.pendingPlan).toBeUndefined();
  });

  it('an older planApproved never clears a newer plan, and an empty delta keeps it', async () => {
    fake.activities.set(S, [
      {
        activityId: 'x0',
        createTime: '2026-09-01T00:00:00.500Z',
        type: 'planApproved',
        approvedPlanId: 'p0',
        artifacts: [],
      },
      plan('p1', 1, 'x1'),
    ]);
    const first = await status(makeDeps(dataDir, fake), {
      session: S,
      reconcile: false,
    });
    expect(first.pendingPlan?.planId).toBe('p1');
    const second = await status(makeDeps(dataDir, fake), {
      session: S,
      reconcile: false,
    });
    expect(second.pendingPlan?.planId).toBe('p1');
  });
});

describe('policy deviation (R13)', () => {
  const pr = {
    type: 'pullRequest' as const,
    url: 'https://github.com/acme/widgets/pull/7',
    title: 'PR',
    description: 'd',
  };

  it('a vendor PR on a create that requested autoPr: false is recorded and flagged', async () => {
    await reserveOperation(dataDir, {
      localRequestId: 'req-1',
      kind: 'create',
      repository: 'acme/widgets',
      requestedBranch: 'main',
      sourceResource: 'sources/github/acme/widgets',
      autoPrRequested: false,
    });
    await markOperation(dataDir, 'req-1', 'accepted', { sessionResource: S });
    fake.sessions.set(S, makeSession({ outputs: [pr] }));
    const result = await status(makeDeps(dataDir, fake), {
      session: S,
      reconcile: false,
    });
    expect(result.policyDeviation).toBe(true);
    expect(result.attention).toContain('policyDeviation');
    const record = (await readJournal(dataDir)).operations['req-1'];
    expect(record?.deviations).toHaveLength(1);
    expect(record?.deviations[0]?.prUrl).toBe(
      'https://github.com/acme/widgets/pull/7'
    );
  });

  it('an external session with a vendor PR is not a deviation', async () => {
    fake.sessions.set(S, makeSession({ outputs: [pr] }));
    const result = await status(makeDeps(dataDir, fake), {
      session: S,
      reconcile: false,
    });
    expect(result.policyDeviation).toBeUndefined();
    expect(result.outputs).toEqual([
      { type: 'pullRequest', prUrl: pr.url, title: 'PR', external: true },
    ]);
  });

  it('a PR URL for another repository is never rendered as a link', async () => {
    fake.sessions.set(
      S,
      makeSession({
        outputs: [{ ...pr, url: 'https://github.com/evil/widgets/pull/7' }],
      })
    );
    const result = await status(makeDeps(dataDir, fake), {
      session: S,
      reconcile: false,
    });
    expect(result.outputs).toEqual([
      { type: 'pullRequest', title: 'PR', external: true },
    ]);
  });
});

describe('--reconcile in PR2', () => {
  it('returns an empty reconciled list with no reservations', async () => {
    const result = await status(makeDeps(dataDir, fake), { reconcile: true });
    expect(result).toEqual({ operation: 'status', reconciled: [] });
    expect(fake.calls).toEqual([]);
  });

  it('reports a planted reservation as not-reached rather than ignoring it', async () => {
    await reserveOperation(dataDir, {
      localRequestId: 'req-1',
      kind: 'create',
      repository: 'acme/widgets',
      requestedBranch: 'main',
    });
    const result = await status(makeDeps(dataDir, fake), { reconcile: true });
    expect(result.reconciled).toEqual([
      expect.objectContaining({
        localRequestId: 'req-1',
        outcome: 'not-reached',
      }),
    ]);
    expect(result.attention).toEqual(['reconciled:not-reached']);
  });

  it('requires --session unless --reconcile is given', async () => {
    await expect(
      codeOfAsync(() => status(makeDeps(dataDir, fake), { reconcile: false }))
    ).resolves.toBe('JULES_INVALID_INPUT');
  });
});

describe('journal corruption and read errors', () => {
  it('a corrupt journal is JULES_JOURNAL_CORRUPT, never an empty id set (R37)', async () => {
    fs.mkdirSync(resolveStateDir(dataDir), { recursive: true, mode: 0o700 });
    fs.writeFileSync(resolveJournalPath(dataDir), '{broken', { mode: 0o600 });
    await expect(
      codeOfAsync(() =>
        status(makeDeps(dataDir, fake), { session: S, reconcile: false })
      )
    ).resolves.toBe('JULES_JOURNAL_CORRUPT');
    expect(fake.calls).toEqual([]);
  });

  it.each([
    [
      new AdapterError('not-found', '404', { status: 404 }),
      'JULES_NOT_FOUND',
      1,
    ],
    [
      new AdapterError('rate-limited', '429', { status: 429 }),
      'JULES_RATE_LIMITED',
      1,
    ],
    [
      new AdapterError('server-error', '503', { status: 503 }),
      'JULES_SERVICE_UNAVAILABLE',
      3,
    ],
    [new AdapterError('auth', '401', { status: 401 }), 'JULES_AUTH_FAILED', 1],
  ])('getSession %s -> %s after %i attempt(s)', async (err, code, attempts) => {
    fake.getSessionImpl = async () => {
      throw err;
    };
    await expect(
      codeOfAsync(() =>
        status(makeDeps(dataDir, fake), { session: S, reconcile: false })
      )
    ).resolves.toBe(code);
    expect(fake.callsTo('getSession')).toHaveLength(attempts);
    expect(fake.closed).toBe(true);
  });
});
