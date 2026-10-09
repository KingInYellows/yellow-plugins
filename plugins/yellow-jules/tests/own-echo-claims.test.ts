import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { status } from '../src/runtime.js';
import { claimOwnEchoes, messageDigest, readJournal } from '../src/state.js';
import {
  assertGrantLiveBeforeWrite,
  reserveUnderGrant,
  settleAccepted,
} from '../src/write-gate.js';

import {
  addActivity,
  createGrant,
  delegateOk,
  type GrantHarness,
  makeHarness,
  setVendorState,
} from './support/grants.js';

let h: GrantHarness;

beforeEach(() => {
  h = makeHarness('correct');
});
afterEach(() => {
  h.cleanup();
});

async function outsideSeen(localRequestId: string): Promise<boolean> {
  const record = (await readJournal(h.dataDir)).operations[localRequestId];
  return record?.supervision?.outsideSeen !== undefined;
}

describe('each dispatched message explains at most one vendor activity', () => {
  it('the echo of the prompt is own; an identical later message is outside', async () => {
    const grantId = await createGrant(h, { maxActiveSessions: 3 });
    const session = await delegateOk(h, grantId, { prompt: 'Do the task.' });
    setVendorState(h, session.sessionResource, 'inProgress');
    const read = () =>
      status(h.deps, { session: session.localId, reconcile: false });

    // The create landed strictly before this walk starts.
    h.deps.clock.time += 1;
    addActivity(h, session.sessionResource, {
      type: 'userMessaged',
      message: 'Do the task.',
      originator: 'user',
    });
    await read();
    expect(await outsideSeen(session.localRequestId)).toBe(false);
    const claimed = (await readJournal(h.dataDir)).operations[
      session.localRequestId
    ]?.echoActivityId;
    expect(claimed).toBeDefined();

    // A teammate later sends the same text: the one echo is already spent.
    addActivity(h, session.sessionResource, {
      type: 'userMessaged',
      message: 'Do the task.',
      originator: 'user',
    });
    await read();
    expect(await outsideSeen(session.localRequestId)).toBe(true);
    // The first claim is unchanged.
    expect(
      (await readJournal(h.dataDir)).operations[session.localRequestId]
        ?.echoActivityId
    ).toBe(claimed);
  });

  it('a create sequenced before the walk claims its echo even when the clock has not moved', async () => {
    const grantId = await createGrant(h, { maxActiveSessions: 3 });
    const session = await delegateOk(h, grantId, { prompt: 'Do the task.' });
    setVendorState(h, session.sessionResource, 'inProgress');
    // No clock advance: the create and the walk share a millisecond, but the
    // journal sequence proves the create came first, so the echo is its own.
    addActivity(h, session.sessionResource, {
      type: 'userMessaged',
      message: 'Do the task.',
      originator: 'user',
    });
    await status(h.deps, { session: session.localId, reconcile: false });
    expect(
      (await readJournal(h.dataDir)).operations[session.localRequestId]
        ?.echoActivityId
    ).toBeDefined();
    expect(await outsideSeen(session.localRequestId)).toBe(false);
  });

  it('an identical message older than the dispatch is outside, not the echo', async () => {
    const grantId = await createGrant(h, { maxActiveSessions: 3 });
    const session = await delegateOk(h, grantId, { prompt: 'Do the task.' });
    setVendorState(h, session.sessionResource, 'inProgress');
    addActivity(h, session.sessionResource, {
      type: 'userMessaged',
      message: 'Do the task.',
      originator: 'user',
      createTime: new Date(h.deps.clock.now() - 10 * 60_000).toISOString(),
    });
    await status(h.deps, { session: session.localId, reconcile: false });
    expect(await outsideSeen(session.localRequestId)).toBe(true);
    expect(
      (await readJournal(h.dataDir)).operations[session.localRequestId]
        ?.echoActivityId
    ).toBeUndefined();
  });

  it('two identical messages in one batch explain only one', async () => {
    const grantId = await createGrant(h, { maxActiveSessions: 3 });
    const session = await delegateOk(h, grantId, { prompt: 'Do the task.' });
    setVendorState(h, session.sessionResource, 'inProgress');
    h.deps.clock.time += 1;
    for (let i = 0; i < 2; i += 1) {
      addActivity(h, session.sessionResource, {
        type: 'userMessaged',
        message: 'Do the task.',
        originator: 'user',
      });
    }
    await status(h.deps, { session: session.localId, reconcile: false });
    expect(await outsideSeen(session.localRequestId)).toBe(true);
  });

  it('classifying an outside message and recording outsideSeen is one journal update', async () => {
    const grantId = await createGrant(h, { maxActiveSessions: 3 });
    const session = await delegateOk(h, grantId, { prompt: 'Do the task.' });
    const outside = await claimOwnEchoes(
      h.dataDir,
      session.sessionResource,
      [{ activityId: 'activities/x1', digest: 'not-ours' }],
      {
        ownerRequestId: session.localRequestId,
        observedAt: '2026-09-29T12:00:00.000Z',
      }
    );
    expect(outside?.activityId).toBe('activities/x1');
    // No second step ran: the marker is already in the journal.
    const record = (await readJournal(h.dataDir)).operations[
      session.localRequestId
    ];
    expect(record?.supervision?.outsideSeen).toMatchObject({
      activityId: 'activities/x1',
      observedAt: '2026-09-29T12:00:00.000Z',
    });
    expect(record?.supervision?.outsideSeen?.observedSeq).toBeGreaterThan(0);
  });
});

describe('identical text from a create and a later reply, newest first', () => {
  it('each echo goes to the write that precedes it, not to journal order', async () => {
    const grantId = await createGrant(h, { maxActiveSessions: 3 });
    const session = await delegateOk(h, grantId, { prompt: 'Do the task.' });
    const createSent = h.deps.clock.now();
    h.deps.clock.time += 5 * 60_000;
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
        localRequestId: 'reply-same-text',
        localId: `jl-${'d'.repeat(32)}`,
        sessionResource: session.sessionResource,
        promptDigest: messageDigest('Do the task.'),
      },
    });
    await assertGrantLiveBeforeWrite(h.deps, reservation, 'reconcile');
    await settleAccepted(h.deps, reservation);
    const digest = messageDigest('Do the task.');
    const outside = await claimOwnEchoes(
      h.dataDir,
      session.sessionResource,
      [
        {
          activityId: 'act-reply',
          digest,
          createTime: new Date(h.deps.clock.now() + 1_000).toISOString(),
        },
        {
          activityId: 'act-create',
          digest,
          createTime: new Date(createSent + 1_000).toISOString(),
        },
      ],
      {
        ownerRequestId: session.localRequestId,
        observedAt: new Date(h.deps.clock.now()).toISOString(),
      }
    );
    expect(outside).toBeUndefined();
    const ops = (await readJournal(h.dataDir)).operations;
    expect(ops['reply-same-text']?.echoActivityId).toBe('act-reply');
    expect(ops[session.localRequestId]?.echoActivityId).toBe('act-create');
  });
});

describe('the newest outside message is chosen by stamp, not traversal order', () => {
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
  const mark = (ownerRequestId: string) => ({
    ownerRequestId,
    observedAt: '2026-09-29T12:00:00.000Z',
  });

  for (const [label, order] of [
    ['newest first', [newer, older]],
    ['oldest first', [older, newer]],
  ] as const) {
    it(`records and returns the newer message (${label})`, async () => {
      const grantId = await createGrant(h, { maxActiveSessions: 3 });
      const session = await delegateOk(h, grantId, { prompt: 'Do the task.' });
      const outside = await claimOwnEchoes(
        h.dataDir,
        session.sessionResource,
        order,
        mark(session.localRequestId)
      );
      expect(outside?.activityId).toBe(newer.activityId);
      const record = (await readJournal(h.dataDir)).operations[
        session.localRequestId
      ];
      expect(record?.supervision?.outsideSeen?.activityId).toBe(
        newer.activityId
      );
    });

    it(`replaces an older stored marker with the newer message (${label})`, async () => {
      const grantId = await createGrant(h, { maxActiveSessions: 3 });
      const session = await delegateOk(h, grantId, { prompt: 'Do the task.' });
      await claimOwnEchoes(
        h.dataDir,
        session.sessionResource,
        [older],
        mark(session.localRequestId)
      );
      await claimOwnEchoes(
        h.dataDir,
        session.sessionResource,
        order,
        mark(session.localRequestId)
      );
      const record = (await readJournal(h.dataDir)).operations[
        session.localRequestId
      ];
      expect(record?.supervision?.outsideSeen?.activityId).toBe(
        newer.activityId
      );
    });
  }

  it('equal timestamps break on activity id', async () => {
    const grantId = await createGrant(h, { maxActiveSessions: 3 });
    const session = await delegateOk(h, grantId, { prompt: 'Do the task.' });
    const t = '2026-09-29T11:00:00.000Z';
    for (const order of [
      [
        { activityId: 'activities/m', digest: 'a', createTime: t },
        { activityId: 'activities/z', digest: 'b', createTime: t },
      ],
      [
        { activityId: 'activities/z', digest: 'b', createTime: t },
        { activityId: 'activities/m', digest: 'a', createTime: t },
      ],
    ]) {
      const outside = await claimOwnEchoes(
        h.dataDir,
        session.sessionResource,
        order,
        mark(session.localRequestId)
      );
      expect(outside?.activityId).toBe('activities/z');
    }
  });
});
