import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { status } from '../src/runtime.js';
import { readJournal } from '../src/state.js';

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
});
