import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppErrorException } from '../src/errors.js';
import {
  claimOwnEchoes,
  messageDigest,
  readJournal,
  updateJournal,
  updateSupervision,
  upsertReadState,
} from '../src/state.js';
import { clearPause } from '../src/supervise.js';
import {
  assertGrantLiveBeforeWrite,
  reserveUnderGrant,
  settleAccepted,
} from '../src/write-gate.js';

import {
  createGrant,
  delegateOk,
  type DelegatedSession,
  type GrantHarness,
  makeHarness,
} from './support/grants.js';

let h: GrantHarness;
let grantId: string;
let session: DelegatedSession;

beforeEach(async () => {
  h = makeHarness('correct');
  grantId = await createGrant(h, { maxActiveSessions: 3 });
  session = await delegateOk(h, grantId, { prompt: 'Do the task.' });
});
afterEach(() => {
  h.cleanup();
});

const iso = (offsetMs: number): string =>
  new Date(h.deps.clock.now() + offsetMs).toISOString();

async function owner() {
  return (await readJournal(h.dataDir)).operations[session.localRequestId];
}

describe('clear-pause requires a walk after every piece of pause evidence', () => {
  async function seed(walkAt: string): Promise<void> {
    await updateJournal(h.dataDir, (operations) => {
      const record = operations[session.localRequestId]!;
      operations[session.localRequestId] = {
        ...record,
        lastCompleteWalkAt: walkAt,
        supervision: {
          paused: { reason: 'partial-walk', observedAt: iso(-3_000) },
          // A status walk recorded an outside message AFTER the pause.
          outsideSeen: {
            activityId: 'activities/late',
            observedAt: iso(-1_000),
          },
        },
      };
    });
  }

  it('refuses a complete walk that postdates the pause but not the outside message', async () => {
    await seed(iso(-2_000));
    const err = await clearPause(h.deps, { session: session.localId }).catch(
      (e: unknown) => e
    );
    expect((err as AppErrorException).appError.code).toBe(
      'JULES_INVALID_STATE'
    );
    const record = await owner();
    expect(record?.supervision?.paused).toBeDefined();
    expect(record?.supervision?.outsideSeen).toBeDefined();
  });

  it('accepts a complete walk that postdates both', async () => {
    await seed(iso(500));
    const result = await clearPause(h.deps, { session: session.localId });
    expect(result).toMatchObject({ cleared: true });
    const record = await owner();
    expect(record?.supervision?.paused).toBeUndefined();
    expect(record?.supervision?.outsideSeen).toBeUndefined();
  });

  it('keeps the pause reason while using the newest evidence time', async () => {
    await seed(iso(-2_000));
    const err = (await clearPause(h.deps, { session: session.localId }).catch(
      (e: unknown) => e
    )) as AppErrorException;
    expect(err.appError.message).toContain('since the pause');
  });
});

describe('a message that a later write could explain is not its echo', () => {
  const digest = messageDigest('A different follow-up.');

  async function laterReply(): Promise<void> {
    const reservation = await reserveUnderGrant(h.deps, {
      grantId,
      ownerRequestId: session.localRequestId,
      authority: {
        repository: 'acme/widgets',
        sourceResource: 'sources/github/acme/widgets',
        branch: 'scratch/one',
        taskRef: 't1',
        operation: 'reply',
      },
      reservation: {
        localRequestId: 'reply-late',
        localId: `jl-${'e'.repeat(32)}`,
        sessionResource: session.sessionResource,
        promptDigest: digest,
      },
    });
    await assertGrantLiveBeforeWrite(h.deps, reservation, 'reconcile');
    await settleAccepted(h.deps, reservation);
  }

  it('a reply created after the walk began cannot claim a message the walk held', async () => {
    const walkStartedAt = iso(0);
    h.deps.clock.time += 60_000;
    await laterReply();
    // The teammate's message is a few seconds older than the reply's dispatch.
    const message = {
      activityId: 'activities/teammate',
      digest,
      createTime: iso(-5_000),
    };
    const pending: string[] = [];
    await claimOwnEchoes(
      h.dataDir,
      session.sessionResource,
      [message],
      {
        ownerRequestId: session.localRequestId,
        observedAt: iso(0),
        walkStartedAt,
      },
      pending
    );
    // Held for a later walk: neither consumed as an echo nor lost.
    expect(pending).toEqual(['activities/teammate']);
    const ops = (await readJournal(h.dataDir)).operations;
    expect(ops['reply-late']?.echoActivityId).toBeUndefined();
  });

  it('a later walk settles it against the now-existing write', async () => {
    h.deps.clock.time += 60_000;
    await laterReply();
    const pending: string[] = [];
    await claimOwnEchoes(
      h.dataDir,
      session.sessionResource,
      [{ activityId: 'activities/echo', digest, createTime: iso(1_000) }],
      {
        ownerRequestId: session.localRequestId,
        observedAt: iso(2_000),
        walkStartedAt: iso(1_500),
      },
      pending
    );
    expect(pending).toEqual([]);
    expect(
      (await readJournal(h.dataDir)).operations['reply-late']?.echoActivityId
    ).toBe('activities/echo');
  });
});

describe('a held message keeps the time it was first read', () => {
  const digest = messageDigest('A different follow-up.');
  const reservationFor = (id: string) => ({
    grantId,
    ownerRequestId: session.localRequestId,
    authority: {
      repository: 'acme/widgets',
      sourceResource: 'sources/github/acme/widgets',
      branch: 'scratch/one',
      taskRef: 't1',
      operation: 'reply' as const,
    },
    reservation: {
      localRequestId: id,
      localId: `jl-${id === 'reply-before-read' ? 'd' : 'e'.repeat(1)}`.padEnd(
        35,
        id === 'reply-before-read' ? 'd' : 'e'
      ),
      sessionResource: session.sessionResource,
      promptDigest: digest,
    },
  });
  async function reply(id: string): Promise<void> {
    const reservation = await reserveUnderGrant(h.deps, reservationFor(id));
    await assertGrantLiveBeforeWrite(h.deps, reservation, 'reconcile');
    await settleAccepted(h.deps, reservation);
  }
  const seenOnce = (readAt: string, createTime: string) => ({
    activityId: 'activities/teammate',
    digest,
    createTime,
    observedAt: readAt,
  });

  it('a write dispatched after the first read cannot claim the message on a later walk', async () => {
    const t0 = iso(0);
    const message = seenOnce(t0, iso(-5_000));
    // Walk 1 reads the teammate message; the reply is dispatched during/after it.
    h.deps.clock.time += 10_000;
    await reply('reply-after-read');
    const pending1: string[] = [];
    await claimOwnEchoes(
      h.dataDir,
      session.sessionResource,
      [message],
      {
        ownerRequestId: session.localRequestId,
        observedAt: iso(0),
        walkStartedAt: t0,
      },
      pending1
    );
    expect(pending1).toEqual(['activities/teammate']);
    expect((await owner())?.supervision?.heldActivities).toEqual({
      'activities/teammate': t0,
    });
    // Walk 2 starts after the reply, which is therefore no longer post-walk.
    // The vendor's real echo is not visible yet, only the teammate's message.
    h.deps.clock.time += 20_000;
    const pending2: string[] = [];
    const outside = await claimOwnEchoes(
      h.dataDir,
      session.sessionResource,
      [{ ...message, observedAt: iso(0) }],
      {
        ownerRequestId: session.localRequestId,
        observedAt: iso(0),
        walkStartedAt: iso(-100),
      },
      pending2
    );
    expect(pending2).toEqual([]);
    expect(outside?.activityId).toBe('activities/teammate');
    const record = await owner();
    expect(record?.supervision?.outsideSeen?.activityId).toBe(
      'activities/teammate'
    );
    expect(record?.supervision?.heldActivities).toBeUndefined();
    expect(
      (await readJournal(h.dataDir)).operations['reply-after-read']
        ?.echoActivityId
    ).toBeUndefined();
  });

  it('a write stamped in the same millisecond as the first read cannot claim it', async () => {
    const t0 = iso(0);
    await reply('reply-after-read');
    const message = seenOnce(t0, iso(-5_000));
    // Seed the hold at exactly the reply's dispatch stamp.
    const dispatched = (await readJournal(h.dataDir)).operations[
      'reply-after-read'
    ]!.dispatchedAt!;
    await claimOwnEchoes(
      h.dataDir,
      session.sessionResource,
      [{ ...message, observedAt: dispatched }],
      {
        ownerRequestId: session.localRequestId,
        observedAt: dispatched,
        walkStartedAt: new Date(Date.parse(dispatched) - 1).toISOString(),
      },
      []
    );
    expect((await owner())?.supervision?.heldActivities).toEqual({
      'activities/teammate': dispatched,
    });
    h.deps.clock.time += 20_000;
    const outside = await claimOwnEchoes(
      h.dataDir,
      session.sessionResource,
      [{ ...message, observedAt: iso(0) }],
      { ownerRequestId: session.localRequestId, observedAt: iso(0) },
      []
    );
    expect(outside?.activityId).toBe('activities/teammate');
    expect(
      (await readJournal(h.dataDir)).operations['reply-after-read']
        ?.echoActivityId
    ).toBeUndefined();
  });

  it('a write dispatched before the first read can still claim it once settled', async () => {
    await reply('reply-before-read');
    h.deps.clock.time += 5_000;
    const readAt = iso(0);
    const message = seenOnce(readAt, iso(-1_000));
    const pending: string[] = [];
    // Held only because the walk began before the write finished settling.
    await claimOwnEchoes(
      h.dataDir,
      session.sessionResource,
      [message],
      {
        ownerRequestId: session.localRequestId,
        observedAt: readAt,
        walkStartedAt: iso(-10_000),
      },
      pending
    );
    h.deps.clock.time += 20_000;
    const later: string[] = [];
    const outside = await claimOwnEchoes(
      h.dataDir,
      session.sessionResource,
      [{ ...message, observedAt: iso(0) }],
      { ownerRequestId: session.localRequestId, observedAt: iso(0) },
      later
    );
    expect(later).toEqual([]);
    expect(outside).toBeUndefined();
    expect(
      (await readJournal(h.dataDir)).operations['reply-before-read']
        ?.echoActivityId
    ).toBe('activities/teammate');
    expect((await owner())?.supervision?.heldActivities).toBeUndefined();
  });

  it('keeps the first read time across further holds and a supervise patch', async () => {
    await reply('reply-before-read');
    h.deps.clock.time += 5_000;
    const t0 = iso(0);
    const message = seenOnce(t0, iso(-1_000));
    const mark = (walkStartedAt: string) => ({
      ownerRequestId: session.localRequestId,
      observedAt: iso(0),
      walkStartedAt,
    });
    // A partial walk holds a message that an earlier write could explain.
    const pending: string[] = [];
    await claimOwnEchoes(
      h.dataDir,
      session.sessionResource,
      [message],
      mark(iso(-100)),
      pending,
      false
    );
    expect(pending).toEqual(['activities/teammate']);
    await updateSupervision(
      h.dataDir,
      session.localRequestId,
      { backoff: null },
      () => new Date(h.deps.clock.now())
    );
    expect((await owner())?.supervision?.heldActivities).toEqual({
      'activities/teammate': t0,
    });
    // Held again by another partial walk: the stored time does not move.
    h.deps.clock.time += 20_000;
    await claimOwnEchoes(
      h.dataDir,
      session.sessionResource,
      [{ ...message, observedAt: iso(0) }],
      mark(iso(-100)),
      [],
      false
    );
    expect((await owner())?.supervision?.heldActivities).toEqual({
      'activities/teammate': t0,
    });
  });
});

describe('outside markers only move forward', () => {
  const older = {
    activityId: 'activities/a-older',
    digest: 'x-older',
    createTime: '2026-09-29T11:00:00.000Z',
  };
  const newer = {
    activityId: 'activities/b-newer',
    digest: 'x-newer',
    createTime: '2026-09-29T11:30:00.000Z',
  };
  const mark = (observedAt: string) => ({
    ownerRequestId: session.localRequestId,
    observedAt,
  });

  it('a delayed walk that saw only the older message leaves the newer marker', async () => {
    await claimOwnEchoes(
      h.dataDir,
      session.sessionResource,
      [newer],
      mark('2026-09-29T12:00:00.000Z')
    );
    await claimOwnEchoes(
      h.dataDir,
      session.sessionResource,
      [older],
      mark('2026-09-29T12:00:05.000Z')
    );
    expect((await owner())?.supervision?.outsideSeen).toEqual({
      activityId: newer.activityId,
      observedAt: '2026-09-29T12:00:00.000Z',
      createTime: newer.createTime,
    });
  });

  it('a newer message replaces an older marker and keeps its stamp', async () => {
    await claimOwnEchoes(
      h.dataDir,
      session.sessionResource,
      [older],
      mark('2026-09-29T12:00:00.000Z')
    );
    await claimOwnEchoes(
      h.dataDir,
      session.sessionResource,
      [newer],
      mark('2026-09-29T12:00:05.000Z')
    );
    expect((await owner())?.supervision?.outsideSeen).toMatchObject({
      activityId: newer.activityId,
      createTime: newer.createTime,
    });
  });

  it('rewalking the stored message does not refresh the marker', async () => {
    await claimOwnEchoes(
      h.dataDir,
      session.sessionResource,
      [newer],
      mark('2026-09-29T12:00:00.000Z')
    );
    await claimOwnEchoes(
      h.dataDir,
      session.sessionResource,
      [newer],
      mark('2026-09-29T12:05:00.000Z')
    );
    expect((await owner())?.supervision?.outsideSeen?.observedAt).toBe(
      '2026-09-29T12:00:00.000Z'
    );
  });

  it('a marker written before stamps were kept yields to any stamped message', async () => {
    await updateJournal(h.dataDir, (operations) => {
      const record = operations[session.localRequestId]!;
      operations[session.localRequestId] = {
        ...record,
        supervision: {
          outsideSeen: {
            activityId: 'activities/legacy',
            observedAt: '2026-09-29T10:00:00.000Z',
          },
        },
      };
    });
    await claimOwnEchoes(
      h.dataDir,
      session.sessionResource,
      [older],
      mark('2026-09-29T12:00:00.000Z')
    );
    expect((await owner())?.supervision?.outsideSeen?.activityId).toBe(
      older.activityId
    );
  });

  it('updateSupervision never replaces a later pause, decision or marker with an earlier one', async () => {
    await updateSupervision(h.dataDir, session.localRequestId, {
      paused: { reason: 'new', observedAt: '2026-09-29T12:00:00.000Z' },
      lastDecision: {
        decision: 'paused',
        decidedAt: '2026-09-29T12:00:00.000Z',
      },
      outsideSeen: {
        activityId: 'activities/b-newer',
        observedAt: '2026-09-29T12:00:00.000Z',
        createTime: newer.createTime,
      },
    });
    await updateSupervision(h.dataDir, session.localRequestId, {
      paused: { reason: 'old', observedAt: '2026-09-29T11:00:00.000Z' },
      lastDecision: {
        decision: 'no-change',
        decidedAt: '2026-09-29T11:00:00.000Z',
      },
      outsideSeen: {
        activityId: 'activities/a-older',
        observedAt: '2026-09-29T12:01:00.000Z',
        createTime: older.createTime,
      },
    });
    const state = (await owner())?.supervision;
    expect(state?.paused?.reason).toBe('new');
    expect(state?.lastDecision?.decision).toBe('paused');
    expect(state?.outsideSeen?.activityId).toBe('activities/b-newer');
  });

  it('an older pass finishing last neither clears nor replaces a newer evaluated plan', async () => {
    const plan = (planId: string) => ({
      planId,
      evaluatedAt: '2026-09-29T12:00:00.000Z',
    });
    // Newer pass (started 12:00) evaluated plan P.
    await updateSupervision(h.dataDir, session.localRequestId, {
      evaluatedPlan: plan('plan-P'),
      passStartedAt: '2026-09-29T12:00:00.000Z',
    });
    // Stale pass (started 11:00) saw `working` and finishes last: must not clear.
    await updateSupervision(h.dataDir, session.localRequestId, {
      evaluatedPlan: null,
      passStartedAt: '2026-09-29T11:00:00.000Z',
    });
    expect((await owner())?.supervision?.evaluatedPlan?.planId).toBe('plan-P');
    // Stale pass that saw an older plan must not replace it.
    await updateSupervision(h.dataDir, session.localRequestId, {
      evaluatedPlan: plan('plan-OLD'),
      passStartedAt: '2026-09-29T11:30:00.000Z',
    });
    expect((await owner())?.supervision?.evaluatedPlan?.planId).toBe('plan-P');
    // Same start (order unknown) fails closed: the stored value stays.
    await updateSupervision(h.dataDir, session.localRequestId, {
      evaluatedPlan: null,
      passStartedAt: '2026-09-29T12:00:00.000Z',
    });
    expect((await owner())?.supervision?.evaluatedPlan?.planId).toBe('plan-P');
    // A genuinely later pass still replaces and clears.
    await updateSupervision(h.dataDir, session.localRequestId, {
      evaluatedPlan: plan('plan-Q'),
      passStartedAt: '2026-09-29T12:05:00.000Z',
    });
    expect((await owner())?.supervision?.evaluatedPlan?.planId).toBe('plan-Q');
    await updateSupervision(h.dataDir, session.localRequestId, {
      evaluatedPlan: null,
      passStartedAt: '2026-09-29T12:06:00.000Z',
    });
    expect((await owner())?.supervision?.evaluatedPlan).toBeUndefined();
  });

  it('a delayed older complete-walk stamp does not pull lastCompleteWalkAt back', async () => {
    await upsertReadState(h.dataDir, session.localRequestId, {
      completeWalkAt: '2026-09-29T12:00:00.000Z',
    });
    await upsertReadState(h.dataDir, session.localRequestId, {
      completeWalkAt: '2026-09-29T11:00:00.000Z',
    });
    expect((await owner())?.lastCompleteWalkAt).toBe(
      '2026-09-29T12:00:00.000Z'
    );
  });
});
