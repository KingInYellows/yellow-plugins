import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

// Fault injection: upsertReadState throws once (a crash between the walk and
// the watermark write). Everything else is the real state module.
const fault = vi.hoisted(() => ({ armed: false }));
vi.mock('../src/state.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/state.js')>();
  return {
    ...real,
    upsertReadState: (...args: Parameters<typeof real.upsertReadState>) => {
      if (fault.armed) {
        fault.armed = false;
        return Promise.reject(new Error('injected read-state failure'));
      }
      return real.upsertReadState(...args);
    },
  };
});

let h: GrantHarness;

beforeEach(() => {
  h = makeHarness('correct');
});

afterEach(() => {
  fault.armed = false;
  h.cleanup();
});

describe('status records outside activity before advancing the watermark', () => {
  it('a failure while persisting read state still leaves outsideSeen set', async () => {
    const grantId = await createGrant(h, { maxActiveSessions: 3 });
    const session = await delegateOk(h, grantId, { prompt: 'Do the task.' });
    setVendorState(h, session.sessionResource, 'inProgress');
    addActivity(h, session.sessionResource, {
      type: 'userMessaged',
      message: 'actually use postgres instead',
      originator: 'user',
    });
    fault.armed = true;
    await expect(
      status(h.deps, { session: session.localId, reconcile: false })
    ).rejects.toThrow('injected read-state failure');

    const record = (await readJournal(h.dataDir)).operations[
      session.localRequestId
    ];
    expect(record?.supervision?.outsideSeen).toBeDefined();
    // The watermark did not advance, so the message is still re-detectable.
    expect(record?.watermark).toBeUndefined();
  });
});
