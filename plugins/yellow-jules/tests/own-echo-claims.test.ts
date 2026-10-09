import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { status } from '../src/runtime.js';
import { claimOwnEchoes, readJournal } from '../src/state.js';

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
    expect(record?.supervision?.outsideSeen).toEqual({
      activityId: 'activities/x1',
      observedAt: '2026-09-29T12:00:00.000Z',
    });
  });
});
