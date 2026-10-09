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
    expect(record?.lastActivityId).toBeUndefined();
    expect(record?.lastActivityCreateTime).toBeUndefined();
  });
});

describe('status classifies unseen messages that sort at or before the watermark', () => {
  it('an equal-timestamp message with a lower opaque id still sets outsideSeen', async () => {
    const grantId = await createGrant(h, { maxActiveSessions: 3 });
    const session = await delegateOk(h, grantId, { prompt: 'Do the task.' });
    setVendorState(h, session.sessionResource, 'inProgress');
    const stamp = '2030-01-01T00:00:00.000Z';
    addActivity(h, session.sessionResource, {
      type: 'agentMessaged',
      message: 'working',
      originator: 'agent',
      activityId: 'zzz-agent',
      createTime: stamp,
    });
    await status(h.deps, { session: session.localId, reconcile: false });
    let record = (await readJournal(h.dataDir)).operations[
      session.localRequestId
    ];
    expect(record?.lastActivityId).toBe('zzz-agent');
    expect(record?.supervision?.outsideSeen).toBeUndefined();

    // Becomes visible late: same timestamp, lexicographically lower id.
    addActivity(h, session.sessionResource, {
      type: 'userMessaged',
      message: 'actually use postgres instead',
      originator: 'user',
      activityId: 'aaa-user',
      createTime: stamp,
    });
    await status(h.deps, { session: session.localId, reconcile: false });
    record = (await readJournal(h.dataDir)).operations[session.localRequestId];
    expect(record?.supervision?.outsideSeen?.activityId).toBe('aaa-user');
  });

  it('a second outside message at the marker time with a lower id refreshes the marker', async () => {
    const grantId = await createGrant(h, { maxActiveSessions: 3 });
    const session = await delegateOk(h, grantId, { prompt: 'Do the task.' });
    setVendorState(h, session.sessionResource, 'inProgress');
    const stamp = '2030-01-01T00:00:00.000Z';
    addActivity(h, session.sessionResource, {
      type: 'userMessaged',
      message: 'use postgres',
      originator: 'user',
      activityId: 'zzz-user',
      createTime: stamp,
    });
    await status(h.deps, { session: session.localId, reconcile: false });
    let record = (await readJournal(h.dataDir)).operations[
      session.localRequestId
    ];
    expect(record?.supervision?.outsideSeen?.activityId).toBe('zzz-user');

    addActivity(h, session.sessionResource, {
      type: 'userMessaged',
      message: 'and drop the migration',
      originator: 'user',
      activityId: 'aaa-user',
      createTime: stamp,
    });
    await status(h.deps, { session: session.localId, reconcile: false });
    record = (await readJournal(h.dataDir)).operations[session.localRequestId];
    expect(record?.supervision?.outsideSeen?.activityId).toBe('aaa-user');
  });

  it('several outside messages tied on the newest createTime are all kept in the marker', async () => {
    const grantId = await createGrant(h, { maxActiveSessions: 3 });
    const session = await delegateOk(h, grantId, { prompt: 'Do the task.' });
    setVendorState(h, session.sessionResource, 'inProgress');
    const stamp = '2030-01-01T00:00:00.000Z';
    for (const id of ['mmm-user', 'zzz-user', 'aaa-user']) {
      addActivity(h, session.sessionResource, {
        type: 'userMessaged',
        message: `steer ${id}`,
        originator: 'user',
        activityId: id,
        createTime: stamp,
      });
    }
    await status(h.deps, { session: session.localId, reconcile: false });
    let record = (await readJournal(h.dataDir)).operations[
      session.localRequestId
    ];
    const marker = record?.supervision?.outsideSeen;
    expect(marker?.activityId).toBe('zzz-user');
    expect(marker?.alsoActivityIds).toEqual(['aaa-user', 'mmm-user']);

    // A later walk finding another tie at the same time widens the marker.
    addActivity(h, session.sessionResource, {
      type: 'userMessaged',
      message: 'steer bbb-user',
      originator: 'user',
      activityId: 'bbb-user',
      createTime: stamp,
    });
    await status(h.deps, { session: session.localId, reconcile: false });
    record = (await readJournal(h.dataDir)).operations[session.localRequestId];
    const widened = record?.supervision?.outsideSeen;
    const all = [widened?.activityId, ...(widened?.alsoActivityIds ?? [])];
    expect(all.sort()).toEqual([
      'aaa-user',
      'bbb-user',
      'mmm-user',
      'zzz-user',
    ]);
  });

  it('an already-seen message is not reclassified after the watermark passes it', async () => {
    const grantId = await createGrant(h, { maxActiveSessions: 3 });
    const session = await delegateOk(h, grantId, { prompt: 'Do the task.' });
    setVendorState(h, session.sessionResource, 'inProgress');
    const stamp = '2030-01-01T00:00:00.000Z';
    addActivity(h, session.sessionResource, {
      type: 'agentMessaged',
      message: 'working',
      originator: 'agent',
      activityId: 'zzz-agent',
      createTime: stamp,
    });
    await status(h.deps, { session: session.localId, reconcile: false });
    await status(h.deps, { session: session.localId, reconcile: false });
    const record = (await readJournal(h.dataDir)).operations[
      session.localRequestId
    ];
    expect(record?.supervision?.outsideSeen).toBeUndefined();
  });
});
