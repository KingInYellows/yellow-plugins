import * as fs from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadGrants, revokeGrant } from '../src/authority.js';
import { resolveJournalPath } from '../src/config.js';
import {
  AdapterError,
  AppErrorException,
  makeAppError,
  MutationErrorException,
  type AppErrorCode,
} from '../src/errors.js';
import { reply, type ReplyArgs } from '../src/mutations.js';
import { status } from '../src/runtime.js';
import {
  claimOwnEchoes,
  markOperation,
  messageDigest,
  planDigest,
  readJournal,
  recordDeviation,
  updateJournal,
} from '../src/state.js';
import {
  assertGrantLiveBeforeWrite,
  reserveUnderGrant,
  settleAccepted,
  settleFailure,
} from '../src/write-gate.js';

import {
  addActivity,
  addPlan,
  addPlanNow,
  createGrant,
  delegateOk,
  type DelegatedSession,
  type GrantHarness,
  makeHarness,
  revokeAfterReservation,
  setVendorState,
} from './support/grants.js';

let h: GrantHarness;
let grantId: string;
let session: DelegatedSession;

beforeEach(async () => {
  h = makeHarness('correct');
  grantId = await createGrant(h, { maxActiveSessions: 3 });
  session = await delegateOk(h, grantId);
  h.adapter.calls.length = 0;
});
afterEach(() => {
  h.cleanup();
});

const MESSAGE = 'Please also update the changelog entry.';

function args(overrides: Partial<ReplyArgs> = {}): ReplyArgs {
  return {
    session: session.localId,
    message: MESSAGE,
    dryRun: false,
    correction: false,
    grantId,
    ...overrides,
  };
}

async function fails(
  run: () => Promise<unknown>
): Promise<MutationErrorException> {
  try {
    await run();
  } catch (err) {
    if (err instanceof MutationErrorException) return err;
    throw err;
  }
  throw new Error('expected a MutationErrorException');
}

async function codeOf(run: () => Promise<unknown>): Promise<AppErrorCode> {
  return (await fails(run)).appError.code;
}

/** Runs `inject` at the first activity read after the write was reserved. */
function afterReserve(kind: 'reply' | 'approve', inject: () => void): void {
  const base = h.adapter.listActivitiesImpl;
  let injected = false;
  h.adapter.listActivitiesImpl = async (resource, options) => {
    if (!injected) {
      const reserved = Object.values(
        (await readJournal(h.dataDir)).operations
      ).some((r) => r.kind === kind && r.status === 'reserved');
      if (reserved) {
        injected = true;
        inject();
      }
    }
    return base(resource, options);
  };
}

/** Adds a teammate's message at the first activity read after the write was reserved. */
function teammateAfterReserve(kind: 'reply' | 'approve', text: string): void {
  afterReserve(kind, () => {
    addActivity(h, session.sessionResource, {
      type: 'userMessaged',
      message: text,
    });
  });
}

describe('reply --dry-run', () => {
  it('does one info() read, sends nothing, and needs no grant', async () => {
    const result = await reply(
      h.deps,
      args({ dryRun: true, grantId: undefined })
    );
    expect(result).toMatchObject({
      operation: 'reply',
      sessionResource: session.sessionResource,
      sent: false,
      dryRun: true,
    });
    expect(h.adapter.callsTo('getSession')).toHaveLength(1);
    expect(h.adapter.writeCount()).toBe(0);
  });

  it('reports the scope a covering grant must match', async () => {
    const result = await reply(
      h.deps,
      args({ dryRun: true, grantId: undefined })
    );
    expect(result).toMatchObject({
      repository: 'acme/widgets',
      requestedBranch: 'scratch/one',
      taskRef: 't1',
    });
  });

  it('an unknown session is JULES_NOT_FOUND', async () => {
    expect(
      await codeOf(() =>
        reply(h.deps, args({ session: 'sessions/nope', dryRun: true }))
      )
    ).toBe('JULES_NOT_FOUND');
  });
});

describe('reply without a grant', () => {
  it('JULES_CONFIRMATION_REQUIRED names the reply authorize command; nothing is read or sent', async () => {
    const err = await fails(() => reply(h.deps, args({ grantId: undefined })));
    expect(err.appError.code).toBe('JULES_CONFIRMATION_REQUIRED');
    expect(err.appError.recoveryAction).toContain("--operations 'reply'");
    expect(err.appError.recoveryAction).toContain("--task-ref 't1'");
    expect(err.localRequestId).toMatch(/^jr-/);
    expect(h.adapter.calls).toEqual([]);
  });
});

describe('unauthorized replies', () => {
  it('a grant without the reply operation', async () => {
    const other = await createGrant(h, { operations: 'create,collect' });
    expect(await codeOf(() => reply(h.deps, args({ grantId: other })))).toBe(
      'JULES_AUTHORITY_DENIED'
    );
    expect(h.adapter.writeCount()).toBe(0);
  });

  it('a grant for a different branch scope', async () => {
    const other = await createGrant(h, { branch: 'elsewhere/*' });
    expect(await codeOf(() => reply(h.deps, args({ grantId: other })))).toBe(
      'JULES_AUTHORITY_DENIED'
    );
  });

  it('a session this plugin did not create has no repo, branch or task to cover', async () => {
    h.adapter.sessions.set('sessions/ext1', {
      ...(h.adapter.sessions.get(session.sessionResource) as object),
      sessionResource: 'sessions/ext1',
    } as never);
    expect(
      await codeOf(() => reply(h.deps, args({ session: 'sessions/ext1' })))
    ).toBe('JULES_AUTHORITY_DENIED');
    expect(h.adapter.writeCount()).toBe(0);
  });

  it('a revoked grant', async () => {
    await revokeGrant(h.dataDir, grantId, new Date(h.deps.clock.now()));
    expect(await codeOf(() => reply(h.deps, args()))).toBe(
      'JULES_AUTHORITY_DENIED'
    );
  });

  it('an expired grant -> JULES_GRANT_EXPIRED with the running session and containment', async () => {
    h.deps.clock.time += 3 * 60 * 60_000;
    const err = await fails(() => reply(h.deps, args()));
    expect(err.appError.code).toBe('JULES_GRANT_EXPIRED');
    expect(err.details).toEqual({ runningSessions: [session.sessionResource] });
    expect(
      `${err.appError.message} ${err.appError.recoveryAction}`
    ).not.toMatch(/terminated|stopped/i);
    expect(h.adapter.writeCount()).toBe(0);
  });
});

describe('a covered reply', () => {
  it('sends exactly one message, records a digest, and never persists the text', async () => {
    const result = await reply(h.deps, args());
    expect(result).toMatchObject({
      operation: 'reply',
      sessionResource: session.sessionResource,
      sent: true,
    });
    expect(h.adapter.callsTo('sendMessage')).toEqual([
      { method: 'sendMessage', args: [session.sessionResource, MESSAGE] },
    ]);
    const record = (await readJournal(h.dataDir)).operations[
      result.localRequestId
    ];
    expect(record).toMatchObject({
      kind: 'reply',
      status: 'accepted',
      sessionResource: session.sessionResource,
      grantId,
      promptDigest: messageDigest(MESSAGE),
    });
    expect(
      fs.readFileSync(resolveJournalPath(h.dataDir), 'utf8')
    ).not.toContain('changelog');
  });

  it('a plain reply spends no slot, task, or round', async () => {
    const before = loadGrants(h.dataDir).grants[grantId]?.usage;
    await reply(h.deps, args());
    expect(loadGrants(h.dataDir).grants[grantId]?.usage).toEqual(before);
  });

  it('a reply row never takes over the session lookup from its create row', async () => {
    await reply(h.deps, args());
    const { findBySessionResource } = await import('../src/state.js');
    const owner = findBySessionResource(
      await readJournal(h.dataDir),
      session.sessionResource
    );
    expect(owner?.kind).toBe('create');
  });
});

describe('corrective replies (R44)', () => {
  it('spend a round on the task ref and stop at the limit', async () => {
    const tight = await createGrant(h, {
      maxActiveSessions: 3,
      maxCorrectiveRounds: 1,
    });
    await reply(h.deps, args({ grantId: tight, correction: true }));
    expect(
      loadGrants(h.dataDir).grants[tight]?.usage.correctiveRounds['t1']
    ).toBe(1);
    expect(
      await codeOf(() =>
        reply(h.deps, args({ grantId: tight, correction: true }))
      )
    ).toBe('JULES_GRANT_EXHAUSTED');
    expect(h.adapter.callsTo('sendMessage')).toHaveLength(1);
    // A non-corrective reply is still allowed.
    await reply(h.deps, args({ grantId: tight }));
    expect(h.adapter.callsTo('sendMessage')).toHaveLength(2);
  });
});

describe('replies and finished sessions', () => {
  it('a reply to a finished session is refused: it would reopen the session past its freed slot', async () => {
    setVendorState(h, session.sessionResource, 'completed');
    await status(h.deps, { session: session.localId, reconcile: false });
    const err = await fails(() => reply(h.deps, args()));
    expect(err.appError.code).toBe('JULES_INVALID_STATE');
    expect(err.appError.recoveryAction).toContain('--correction');
    expect(h.adapter.writeCount()).toBe(0);
  });

  it('a session that finished since the last status is refused on the live state, not the stale journal', async () => {
    // No status call: the journal still says the session is working.
    setVendorState(h, session.sessionResource, 'completed');
    const err = await fails(() => reply(h.deps, args()));
    expect(err.appError.code).toBe('JULES_INVALID_STATE');
    expect(h.adapter.callsTo('sendMessage')).toHaveLength(0);
    expect(h.adapter.writeCount()).toBe(0);
  });
});

describe('our own integrity verdicts on the write path are not flattened', () => {
  it('a pre-dispatch integrity failure keeps its code and frees the reservation', async () => {
    h.adapter.sendMessageImpl = async () => {
      throw new AppErrorException(
        makeAppError('JULES_SDK_INTEGRITY', 'storage binding failed')
      );
    };
    const err = await fails(() => reply(h.deps, args()));
    expect(err.appError.code).toBe('JULES_SDK_INTEGRITY');
    const record = (await readJournal(h.dataDir)).operations[
      err.localRequestId as string
    ];
    expect(record?.status).toBe('failed');
  });
});

describe('a scratch-tripwire failure at adapter close after dispatch', () => {
  function closeViolates(): void {
    h.adapter.close = async () => {
      throw new AppErrorException(
        makeAppError('JULES_SDK_INTEGRITY', 'scratch tripwire fired')
      );
    };
  }

  it('keeps the settled success and reports the violation', async () => {
    closeViolates();
    const result = (await reply(h.deps, args())) as unknown as Record<
      string,
      unknown
    >;
    expect(result['sent']).toBe(true);
    expect(result['requiresAttention']).toBe(true);
    expect(result['attention']).toContain('adapterCleanupViolation');
    expect(result['cleanupViolation']).toBe('scratch tripwire fired');
    expect(h.adapter.callsTo('sendMessage')).toHaveLength(1);
  });

  it('keeps JULES_UNKNOWN_OUTCOME instead of presenting an integrity failure', async () => {
    closeViolates();
    h.adapter.sendMessageImpl = async () => {
      throw new AdapterError('network', 'reset', { dispatched: true });
    };
    const err = await fails(() => reply(h.deps, args()));
    expect(err.appError.code).toBe('JULES_UNKNOWN_OUTCOME');
    expect(h.adapter.callsTo('sendMessage')).toHaveLength(1);
  });
});

describe('ambiguous reply outcomes', () => {
  it.each([
    [
      'a dropped connection',
      new AdapterError('network', 'reset', { dispatched: true }),
    ],
    [
      'a 504 after dispatch',
      new AdapterError('server-error', 'gateway timeout', {
        status: 504,
        dispatched: true,
      }),
    ],
    [
      'an invalid 2xx body',
      new AdapterError('malformed', 'garbled', { dispatched: true }),
    ],
  ])(
    '%s -> JULES_UNKNOWN_OUTCOME, one outgoing call, no replay',
    async (_label, failure) => {
      h.adapter.sendMessageImpl = async () => {
        throw failure;
      };
      const err = await fails(() => reply(h.deps, args()));
      expect(err.appError.code).toBe('JULES_UNKNOWN_OUTCOME');
      expect(err.appError.recoveryAction).toContain('status --session');
      expect(h.adapter.callsTo('sendMessage')).toHaveLength(1);
      const record = (await readJournal(h.dataDir)).operations[
        err.localRequestId as string
      ];
      expect(record?.status).toBe('unknown-outcome');
      expect(record?.sessionResource).toBe(session.sessionResource);
    }
  );

  it('a clear 404 after dispatch keeps its code and marks the reservation failed', async () => {
    h.adapter.sendMessageImpl = async () => {
      throw new AdapterError('not-found', 'gone', {
        status: 404,
        dispatched: true,
      });
    };
    const err = await fails(() => reply(h.deps, args()));
    expect(err.appError.code).toBe('JULES_NOT_FOUND');
    const record = (await readJournal(h.dataDir)).operations[
      err.localRequestId as string
    ];
    expect(record?.status).toBe('failed');
  });
});

describe('invalid input', () => {
  it.each([
    ['an empty message', { message: '  ' }],
    ['an oversized message', { message: 'x'.repeat(32_001) }],
    ['a malformed session ref', { session: 'not a ref' }],
  ])(
    '%s is JULES_INVALID_INPUT before any vendor call',
    async (_label, patch) => {
      expect(await codeOf(() => reply(h.deps, args(patch)))).toBe(
        'JULES_INVALID_INPUT'
      );
      expect(h.adapter.calls).toEqual([]);
    }
  );
});

describe('races inside the write gate', () => {
  it('a grant revoked between the reservation and the POST sends nothing and settles failed', async () => {
    const hook = revokeAfterReservation(h, grantId);
    const err = await fails(() => reply(h.deps, args()));
    expect(hook.fired()).toBe(true);
    expect(err.appError.code).toBe('JULES_AUTHORITY_DENIED');
    expect(h.adapter.callsTo('sendMessage')).toHaveLength(0);
    const record = (await readJournal(h.dataDir)).operations[
      err.localRequestId as string
    ];
    expect(record?.status).toBe('failed');
  });

  it('a failed pre-dispatch activity read refuses the write: nothing is sent and the record never dispatches', async () => {
    h.adapter.listActivitiesImpl = async () => {
      throw new AdapterError('server-error', 'boom', { status: 503 });
    };
    const err = await fails(() => reply(h.deps, args()));
    expect(err.appError.code).toBe('JULES_SERVICE_UNAVAILABLE');
    expect(err.appError.retryable).toBe(true);
    expect(h.adapter.callsTo('sendMessage')).toHaveLength(0);
    const record = (await readJournal(h.dataDir)).operations[
      err.localRequestId as string
    ];
    expect(record?.status).toBe('failed');
    expect(record?.dispatchedAt).toBeUndefined();
  });

  it("a teammate's message arriving between the reserve and the floor read refuses the reply and records outside activity", async () => {
    teammateAfterReserve('reply', 'please stop and do something else');
    const err = await fails(() => reply(h.deps, args()));
    expect(err.appError.code).toBe('JULES_SUPERVISION_PAUSED');
    expect(h.adapter.callsTo('sendMessage')).toHaveLength(0);
    const ops = (await readJournal(h.dataDir)).operations;
    expect(ops[session.localRequestId]?.supervision?.outsideSeen).toBeDefined();
    expect(ops[err.localRequestId as string]?.status).toBe('failed');
    expect(ops[err.localRequestId as string]?.dispatchedAt).toBeUndefined();
  });

  it('outside activity marked after the reserve invalidates the record; dispatch is refused with no adapter call', async () => {
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
        localRequestId: 'reply-race-1',
        localId: `jl-${'a'.repeat(32)}`,
        sessionResource: session.sessionResource,
        promptDigest: messageDigest(MESSAGE),
      },
    });
    expect(reservation.status).toBe('reserved');
    await claimOwnEchoes(
      h.dataDir,
      session.sessionResource,
      [{ activityId: 'act-outside', digest: messageDigest('someone else') }],
      {
        ownerRequestId: session.localRequestId,
        observedAt: new Date(h.deps.clock.now()).toISOString(),
      }
    );
    const marked = (await readJournal(h.dataDir)).operations['reply-race-1'];
    expect(marked?.invalidatedBy).toBe('outside-activity');
    await expect(
      assertGrantLiveBeforeWrite(h.deps, reservation, 'reconcile', 'empty')
    ).rejects.toMatchObject({
      appError: { code: 'JULES_SUPERVISION_PAUSED' },
    });
    expect(h.adapter.callsTo('sendMessage')).toHaveLength(0);
    expect(
      (await readJournal(h.dataDir)).operations['reply-race-1']?.status
    ).toBe('failed');
  });

  const replyGate = (id: string, correction?: boolean) => ({
    grantId,
    ownerRequestId: session.localRequestId,
    authority: {
      repository: 'acme/widgets',
      sourceResource: 'sources/github/acme/widgets',
      branch: 'scratch/one',
      taskRef: 't1',
      operation: 'reply' as const,
      ...(correction !== undefined ? { correction } : {}),
    },
    reservation: {
      localRequestId: id,
      localId: `jl-${'b'.repeat(32)}`,
      sessionResource: session.sessionResource,
      promptDigest: messageDigest(MESSAGE),
    },
  });

  it("a teammate repeating the reserved text is outside activity, not the undispatched reply's echo", async () => {
    const reservation = await reserveUnderGrant(
      h.deps,
      replyGate('reply-echo-1')
    );
    // The reservation has not reached its POST, so it cannot have produced this activity.
    const outside = await claimOwnEchoes(
      h.dataDir,
      session.sessionResource,
      [{ activityId: 'act-teammate', digest: messageDigest(MESSAGE) }],
      {
        ownerRequestId: session.localRequestId,
        observedAt: new Date(h.deps.clock.now()).toISOString(),
      }
    );
    expect(outside?.activityId).toBe('act-teammate');
    const journal = await readJournal(h.dataDir);
    expect(journal.operations['reply-echo-1']?.echoActivityId).toBeUndefined();
    expect(journal.operations['reply-echo-1']?.invalidatedBy).toBe(
      'outside-activity'
    );
    await expect(
      assertGrantLiveBeforeWrite(h.deps, reservation, 'reconcile', 'empty')
    ).rejects.toMatchObject({ appError: { code: 'JULES_SUPERVISION_PAUSED' } });
    expect(h.adapter.callsTo('sendMessage')).toHaveLength(0);
  });

  it('a supervision pause recorded after the reserve refuses at the final check', async () => {
    const reservation = await reserveUnderGrant(
      h.deps,
      replyGate('reply-pause-1')
    );
    await updateJournal(h.dataDir, (operations) => {
      const owner = operations[session.localRequestId]!;
      operations[session.localRequestId] = {
        ...owner,
        supervision: {
          paused: {
            reason: 'plan-changed-after-evaluation',
            observedAt: new Date(h.deps.clock.now()).toISOString(),
          },
        },
      };
    });
    await expect(
      assertGrantLiveBeforeWrite(h.deps, reservation, 'reconcile', 'empty')
    ).rejects.toMatchObject({ appError: { code: 'JULES_SUPERVISION_PAUSED' } });
    const record = (await readJournal(h.dataDir)).operations['reply-pause-1'];
    expect(record?.dispatchedAt).toBeUndefined();
    expect(record?.status).toBe('failed');
    expect(h.adapter.callsTo('sendMessage')).toHaveLength(0);
  });

  it('a policy deviation recorded after the reserve refuses at the final check', async () => {
    const reservation = await reserveUnderGrant(
      h.deps,
      replyGate('reply-dev-1')
    );
    await recordDeviation(h.dataDir, session.localRequestId, {
      kind: 'policy-deviation',
      reason: 'vendor opened a pull request',
    });
    await expect(
      assertGrantLiveBeforeWrite(h.deps, reservation, 'reconcile', 'empty')
    ).rejects.toMatchObject({ appError: { code: 'JULES_POLICY_DEVIATION' } });
    const record = (await readJournal(h.dataDir)).operations['reply-dev-1'];
    expect(record?.dispatchedAt).toBeUndefined();
    expect(record?.status).toBe('failed');
    expect(h.adapter.callsTo('sendMessage')).toHaveLength(0);
  });

  it('a reservation abandoned before the final check is not dispatched', async () => {
    const reservation = await reserveUnderGrant(
      h.deps,
      replyGate('reply-abandoned-1')
    );
    await updateJournal(h.dataDir, (operations) => {
      const record = operations['reply-abandoned-1']!;
      operations['reply-abandoned-1'] = {
        ...record,
        status: 'failed',
        abandonedAt: new Date(h.deps.clock.now()).toISOString(),
      };
    });
    await expect(
      assertGrantLiveBeforeWrite(h.deps, reservation, 'reconcile', 'empty')
    ).rejects.toMatchObject({ appError: { code: 'JULES_INVALID_STATE' } });
    const record = (await readJournal(h.dataDir)).operations[
      'reply-abandoned-1'
    ];
    expect(record?.dispatchedAt).toBeUndefined();
    expect(record?.abandonedAt).toBeDefined();
    expect(h.adapter.callsTo('sendMessage')).toHaveLength(0);
  });

  it('a revoke that lands before the locked final check refuses and leaves no dispatch stamp', async () => {
    const reservation = await reserveUnderGrant(
      h.deps,
      replyGate('reply-revoke-1')
    );
    await revokeGrant(h.dataDir, grantId, new Date(h.deps.clock.now()));
    await expect(
      assertGrantLiveBeforeWrite(h.deps, reservation, 'reconcile', 'empty')
    ).rejects.toMatchObject({ appError: { code: 'JULES_AUTHORITY_DENIED' } });
    const record = (await readJournal(h.dataDir)).operations['reply-revoke-1'];
    expect(record?.dispatchedAt).toBeUndefined();
    expect(record?.status).toBe('failed');
    expect(h.adapter.callsTo('sendMessage')).toHaveLength(0);
  });

  it('a complete walk is stamped with its start, so a pause recorded mid-walk postdates it', async () => {
    setVendorState(h, session.sessionResource, 'inProgress');
    addActivity(h, session.sessionResource, {
      type: 'agentMessaged',
      message: 'progress',
    });
    const start = h.deps.clock.now();
    await status(h.deps, {
      session: session.localId,
      reconcile: false,
      // The walk is slow: time passes while it reads.
      observer: () => {
        h.deps.clock.time += 10_000;
      },
    });
    const pausedAt = new Date(start + 5_000).toISOString();
    const stamp = (await readJournal(h.dataDir)).operations[
      session.localRequestId
    ]?.lastCompleteWalkAt;
    expect(stamp).toBeDefined();
    expect(Date.parse(stamp!)).toBeLessThanOrEqual(Date.parse(pausedAt));
  });

  it('a settled dispatched reply claims its own echo', async () => {
    const reservation = await reserveUnderGrant(
      h.deps,
      replyGate('reply-echo-2')
    );
    await assertGrantLiveBeforeWrite(h.deps, reservation, 'reconcile', 'empty');
    await settleAccepted(h.deps, reservation);
    const outside = await claimOwnEchoes(
      h.dataDir,
      session.sessionResource,
      [{ activityId: 'act-own', digest: messageDigest(MESSAGE) }],
      {
        ownerRequestId: session.localRequestId,
        observedAt: new Date(h.deps.clock.now()).toISOString(),
      }
    );
    expect(outside).toBeUndefined();
    expect(
      (await readJournal(h.dataDir)).operations['reply-echo-2']?.echoActivityId
    ).toBe('act-own');
  });

  it('a partial walk holds a same-digest message instead of claiming it as the echo', async () => {
    const reservation = await reserveUnderGrant(
      h.deps,
      replyGate('reply-partial-1')
    );
    await assertGrantLiveBeforeWrite(h.deps, reservation, 'reconcile', 'empty');
    await settleAccepted(h.deps, reservation);
    // The message is read after the dispatch, never in the same millisecond.
    h.deps.clock.time += 1_000;
    const mark = {
      ownerRequestId: session.localRequestId,
      observedAt: new Date(h.deps.clock.now()).toISOString(),
    };
    const message = {
      activityId: 'act-teammate',
      digest: messageDigest(MESSAGE),
    };
    const held: string[] = [];
    await claimOwnEchoes(
      h.dataDir,
      session.sessionResource,
      [message],
      mark,
      held,
      false
    );
    expect(held).toEqual(['act-teammate']);
    expect(
      (await readJournal(h.dataDir)).operations['reply-partial-1']
        ?.echoActivityId
    ).toBeUndefined();
    // A complete walk then classifies it normally.
    await claimOwnEchoes(
      h.dataDir,
      session.sessionResource,
      [message],
      mark,
      [],
      true
    );
    expect(
      (await readJournal(h.dataDir)).operations['reply-partial-1']
        ?.echoActivityId
    ).toBe('act-teammate');
  });

  describe('a message matching a dispatched reply whose outcome is unknown', () => {
    const readStatus = () =>
      status(h.deps, { session: session.localId, reconcile: false });
    const owner = async () =>
      (await readJournal(h.dataDir)).operations[session.localRequestId];

    async function dispatchedReplyWithMatchingMessage(id: string) {
      const reservation = await reserveUnderGrant(h.deps, replyGate(id));
      await assertGrantLiveBeforeWrite(
        h.deps,
        reservation,
        'reconcile',
        'empty'
      );
      // The echo is read after the dispatch, never in the same millisecond.
      h.deps.clock.time += 1_000;
      setVendorState(h, session.sessionResource, 'inProgress');
      const activity = addActivity(h, session.sessionResource, {
        type: 'userMessaged',
        message: MESSAGE,
        originator: 'user',
      });
      return { reservation, activity };
    }

    it('is held, not claimed, and the walk does not move past it', async () => {
      const { activity } = await dispatchedReplyWithMatchingMessage('pend-1');
      const before = await owner();
      await readStatus();
      const after = await owner();
      const journal = await readJournal(h.dataDir);
      expect(journal.operations['pend-1']?.echoActivityId).toBeUndefined();
      expect(after?.supervision?.outsideSeen).toBeUndefined();
      expect(after?.lastActivityId).toBe(before?.lastActivityId);
      expect(after?.recentActivityIds).not.toContain(activity.activityId);
    });

    it('does not stamp the walk complete while it holds a message, so an older pause cannot be cleared over it', async () => {
      const { reservation } =
        await dispatchedReplyWithMatchingMessage('pend-stamp');
      await readStatus();
      expect((await owner())?.lastCompleteWalkAt).toBeUndefined();
      await expect(
        settleFailure(
          h.deps,
          reservation,
          new AdapterError('not-found', 'gone', {
            status: 404,
            dispatched: true,
          }),
          { reconcileHint: 'reconcile' }
        )
      ).rejects.toBeInstanceOf(MutationErrorException);
      await readStatus();
      expect((await owner())?.lastCompleteWalkAt).toBeDefined();
    });

    it('a clean rejection then makes the next walk record it as outside activity', async () => {
      const { reservation } =
        await dispatchedReplyWithMatchingMessage('pend-2');
      await readStatus();
      await expect(
        settleFailure(
          h.deps,
          reservation,
          new AdapterError('not-found', 'gone', {
            status: 404,
            dispatched: true,
          }),
          { reconcileHint: 'reconcile' }
        )
      ).rejects.toBeInstanceOf(MutationErrorException);
      await readStatus();
      expect((await owner())?.supervision?.outsideSeen).toBeDefined();
      expect(
        (await readJournal(h.dataDir)).operations['pend-2']?.echoActivityId
      ).toBeUndefined();
    });

    it('an accepted reply then claims it as its own echo on the next walk', async () => {
      const { reservation, activity } =
        await dispatchedReplyWithMatchingMessage('pend-3');
      await readStatus();
      await settleAccepted(h.deps, reservation);
      await readStatus();
      expect((await owner())?.supervision?.outsideSeen).toBeUndefined();
      expect(
        (await readJournal(h.dataDir)).operations['pend-3']?.echoActivityId
      ).toBe(activity.activityId);
    });

    it('one echo plus an identical teammate message does not credit the unresolved write', async () => {
      // A settled reply and an unresolved one share the text; the walk holds two
      // such messages. Which is whose is unknowable, so the unresolved write
      // gets no landing evidence and the surplus is possible outside activity.
      const a = await reserveUnderGrant(h.deps, replyGate('pend-a'));
      await assertGrantLiveBeforeWrite(h.deps, a, 'reconcile', 'empty');
      await settleAccepted(h.deps, a);
      h.deps.clock.time += 1_000;
      const b = await reserveUnderGrant(h.deps, replyGate('pend-b'));
      await assertGrantLiveBeforeWrite(h.deps, b, 'reconcile', 'empty');
      h.deps.clock.time += 1_000;
      setVendorState(h, session.sessionResource, 'inProgress');
      // Distinct vendor times: which echo is the settled write's is decided by
      // time, never by opaque id.
      for (const [i, activityId] of ['act-m1', 'act-m2'].entries()) {
        addActivity(h, session.sessionResource, {
          type: 'userMessaged',
          message: MESSAGE,
          originator: 'user',
          activityId,
          createTime: new Date(h.deps.clock.now() + i * 1_000).toISOString(),
        });
      }
      h.deps.clock.time += 10 * 60_000;
      await readStatus();
      const journal = await readJournal(h.dataDir);
      expect(journal.operations['pend-a']?.echoActivityId).toBe('act-m1');
      expect(journal.operations['pend-b']?.echoActivityId).toBeUndefined();
      expect((await owner())?.supervision?.outsideSeen).toBeDefined();

      expect(journal.operations['pend-b']?.echoAmbiguous).toBe(true);

      // A walk that does not advance past the surplus (the read state is lost)
      // re-reads both messages; the settled write already has its echo, so the
      // unresolved write is the only match left. It must still get nothing.
      await updateJournal(h.dataDir, (operations) => {
        const o = operations[session.localRequestId]!;
        const { lastActivityId: _a, lastActivityCreateTime: _b, ...rest } = o;
        operations[session.localRequestId] = { ...rest, recentActivityIds: [] };
      });
      await readStatus();
      const again = await readJournal(h.dataDir);
      expect(again.operations['pend-a']?.echoActivityId).toBe('act-m1');
      expect(again.operations['pend-b']?.echoActivityId).toBeUndefined();
      expect((await owner())?.supervision?.outsideSeen).toBeDefined();
    });

    it('equal vendor times cannot be ordered by opaque id: the settled write gets no echo either', async () => {
      const a = await reserveUnderGrant(h.deps, replyGate('pend-t1'));
      await assertGrantLiveBeforeWrite(h.deps, a, 'reconcile', 'empty');
      await settleAccepted(h.deps, a);
      h.deps.clock.time += 1_000;
      const b = await reserveUnderGrant(h.deps, replyGate('pend-t2'));
      await assertGrantLiveBeforeWrite(h.deps, b, 'reconcile', 'empty');
      h.deps.clock.time += 1_000;
      setVendorState(h, session.sessionResource, 'inProgress');
      const createTime = new Date(h.deps.clock.now()).toISOString();
      for (const activityId of ['act-t1', 'act-t2']) {
        addActivity(h, session.sessionResource, {
          type: 'userMessaged',
          message: MESSAGE,
          originator: 'user',
          activityId,
          createTime,
        });
      }
      h.deps.clock.time += 10 * 60_000;
      await readStatus();
      const journal = await readJournal(h.dataDir);
      expect(journal.operations['pend-t1']?.echoActivityId).toBeUndefined();
      expect(journal.operations['pend-t2']?.echoActivityId).toBeUndefined();
      expect((await owner())?.supervision?.outsideSeen).toBeDefined();
    });

    it('a write dispatched after the walk began is not marked echo-ambiguous by the batch', async () => {
      const a = await reserveUnderGrant(h.deps, replyGate('pend-a2'));
      await assertGrantLiveBeforeWrite(h.deps, a, 'reconcile', 'empty');
      await settleAccepted(h.deps, a);
      h.deps.clock.time += 1_000;
      setVendorState(h, session.sessionResource, 'inProgress');
      for (const activityId of ['act-n1', 'act-n2']) {
        addActivity(h, session.sessionResource, {
          type: 'userMessaged',
          message: MESSAGE,
          originator: 'user',
          activityId,
        });
      }
      h.deps.clock.time += 1_000;
      // B is reserved and dispatched while the walk is reading: it cannot own
      // messages the walk had already started to read.
      const original = h.adapter.listActivitiesImpl;
      let raced = false;
      h.adapter.listActivitiesImpl = async (resource, options) => {
        if (!raced) {
          raced = true;
          const b = await reserveUnderGrant(h.deps, replyGate('pend-b2'));
          await assertGrantLiveBeforeWrite(h.deps, b, 'reconcile', 'empty');
        }
        return original(resource, options);
      };
      await readStatus();
      const journal = await readJournal(h.dataDir);
      expect(raced).toBe(true);
      expect(journal.operations['pend-b2']?.echoAmbiguous).toBeUndefined();
    });

    it('a reservation stuck past its settle window no longer holds the walk', async () => {
      await dispatchedReplyWithMatchingMessage('pend-4');
      h.deps.clock.time += 10 * 60_000;
      await readStatus();
      expect(
        (await readJournal(h.dataDir)).operations['pend-4']?.echoActivityId
      ).toBeDefined();
    });
  });

  describe('--expect-activity-id and --expect-question-digest', () => {
    const QUESTION = 'Which database should I use?';
    const code = async (run: () => Promise<unknown>) =>
      (await fails(run)).appError.code;

    function ask(text = QUESTION) {
      setVendorState(h, session.sessionResource, 'awaitingUserFeedback');
      return addActivity(h, session.sessionResource, {
        type: 'agentMessaged',
        message: text,
      });
    }

    it('sends when the session still awaits the question the pass showed', async () => {
      const q = ask();
      const result = await reply(
        h.deps,
        args({
          expectActivityId: q.activityId,
          expectQuestionDigest: messageDigest(QUESTION),
        })
      );
      expect(result.sent).toBe(true);
      expect(h.adapter.callsTo('sendMessage')).toHaveLength(1);
    });

    it('refuses when a newer question appears between the reserve and the floor read', async () => {
      const q = ask();
      afterReserve('reply', () => {
        h.deps.clock.time += 1_000;
        ask('Actually, which cache should I use?');
      });
      const err = await fails(() =>
        reply(
          h.deps,
          args({
            expectActivityId: q.activityId,
            expectQuestionDigest: messageDigest(QUESTION),
          })
        )
      );
      expect(err.appError.code).toBe('JULES_QUESTION_CHANGED');
      expect(h.adapter.callsTo('sendMessage')).toHaveLength(0);
      expect(
        (await readJournal(h.dataDir)).operations[err.localRequestId as string]
          ?.dispatchedAt
      ).toBeUndefined();
    });

    it('refuses when a user message sits at the same createTime as the question', async () => {
      const q = ask();
      addActivity(h, session.sessionResource, {
        type: 'userMessaged',
        activityId: 'a-low-user',
        createTime: q.createTime,
        message: 'Use sqlite.',
      });
      expect(
        await code(() =>
          reply(
            h.deps,
            args({
              expectActivityId: q.activityId,
              expectQuestionDigest: messageDigest(QUESTION),
            })
          )
        )
      ).toBe('JULES_QUESTION_CHANGED');
      expect(h.adapter.callsTo('sendMessage')).toHaveLength(0);
    });

    it('refuses when two different questions share the newest createTime', async () => {
      const q = ask();
      addActivity(h, session.sessionResource, {
        type: 'agentMessaged',
        activityId: 'a-low-question',
        createTime: q.createTime,
        message: 'Which cloud should I use?',
      });
      expect(
        await code(() =>
          reply(
            h.deps,
            args({
              expectActivityId: q.activityId,
              expectQuestionDigest: messageDigest(QUESTION),
            })
          )
        )
      ).toBe('JULES_QUESTION_CHANGED');
      expect(h.adapter.callsTo('sendMessage')).toHaveLength(0);
    });

    it('refuses when a newer agent message replaced the question', async () => {
      const q = ask();
      h.deps.clock.time += 1_000;
      addActivity(h, session.sessionResource, {
        type: 'agentMessaged',
        message: 'Never mind, which cloud?',
        createTime: new Date(h.deps.clock.now()).toISOString(),
      });
      expect(
        await code(() =>
          reply(
            h.deps,
            args({
              expectActivityId: q.activityId,
              expectQuestionDigest: messageDigest(QUESTION),
            })
          )
        )
      ).toBe('JULES_QUESTION_CHANGED');
      expect(h.adapter.callsTo('sendMessage')).toHaveLength(0);
    });

    it('refuses when the session no longer awaits a reply', async () => {
      const q = ask();
      setVendorState(h, session.sessionResource, 'inProgress');
      expect(
        await code(() =>
          reply(
            h.deps,
            args({
              expectActivityId: q.activityId,
              expectQuestionDigest: messageDigest(QUESTION),
            })
          )
        )
      ).toBe('JULES_QUESTION_CHANGED');
      expect(h.adapter.callsTo('sendMessage')).toHaveLength(0);
    });

    it('refuses when the question text differs from the digest', async () => {
      const q = ask();
      expect(
        await code(() =>
          reply(
            h.deps,
            args({
              expectActivityId: q.activityId,
              expectQuestionDigest: messageDigest('something else'),
            })
          )
        )
      ).toBe('JULES_QUESTION_CHANGED');
      expect(h.adapter.callsTo('sendMessage')).toHaveLength(0);
    });

    it('refuses when a user message follows the question and is not our echo', async () => {
      const q = ask();
      h.deps.clock.time += 1_000;
      addActivity(h, session.sessionResource, {
        type: 'userMessaged',
        message: 'Use Postgres.',
        createTime: new Date(h.deps.clock.now()).toISOString(),
      });
      expect(
        await code(() =>
          reply(
            h.deps,
            args({
              expectActivityId: q.activityId,
              expectQuestionDigest: messageDigest(QUESTION),
            })
          )
        )
      ).toBe('JULES_QUESTION_CHANGED');
      expect(h.adapter.callsTo('sendMessage')).toHaveLength(0);
    });

    it("an echo claimed in another session does not hide this session's user message", async () => {
      const q = ask();
      h.deps.clock.time += 1_000;
      const outside = addActivity(h, session.sessionResource, {
        type: 'userMessaged',
        message: 'Use Postgres.',
        createTime: new Date(h.deps.clock.now()).toISOString(),
      });
      // Activity ids carry no session: another session claimed the same id.
      await updateJournal(h.dataDir, (operations) => {
        const base = Object.values(operations)[0]!;
        operations['other-session-reply'] = {
          ...base,
          localRequestId: 'other-session-reply',
          localId: `jl-${'d'.repeat(32)}`,
          kind: 'reply',
          status: 'accepted',
          sessionResource: 'sessions/other999',
          echoActivityId: outside.activityId,
        };
      });
      expect(
        await code(() =>
          reply(
            h.deps,
            args({
              expectActivityId: q.activityId,
              expectQuestionDigest: messageDigest(QUESTION),
            })
          )
        )
      ).toBe('JULES_QUESTION_CHANGED');
      expect(h.adapter.callsTo('sendMessage')).toHaveLength(0);
    });

    it('refuses an expected id that is not the newest question', async () => {
      ask();
      expect(
        await code(() =>
          reply(
            h.deps,
            args({
              expectActivityId: 'activities/not-it',
              expectQuestionDigest: messageDigest(QUESTION),
            })
          )
        )
      ).toBe('JULES_QUESTION_CHANGED');
    });

    it('refuses a question whose text redaction altered, even with the digest of the raw text', async () => {
      const raw = 'Use key AIzaSyA1234567890abcdefghijk for the call?';
      const q = ask(raw);
      const writes = h.adapter.writeCount();
      expect(
        await code(() =>
          reply(
            h.deps,
            args({
              expectActivityId: q.activityId,
              expectQuestionDigest: messageDigest(raw),
            })
          )
        )
      ).toBe('JULES_INVALID_STATE');
      expect(h.adapter.writeCount()).toBe(writes);
    });

    it('needs both values', async () => {
      const q = ask();
      expect(
        await code(() =>
          reply(h.deps, args({ expectActivityId: q.activityId }))
        )
      ).toBe('JULES_INVALID_INPUT');
      expect(
        await code(() =>
          reply(h.deps, args({ expectQuestionDigest: messageDigest(QUESTION) }))
        )
      ).toBe('JULES_INVALID_INPUT');
    });

    it('a plain reply needs neither', async () => {
      ask();
      expect((await reply(h.deps, args())).sent).toBe(true);
    });

    describe('--reply-kind', () => {
      it('question without the question pair is refused, even for a vendor id spelled none', async () => {
        ask();
        const calls = h.adapter.writeCount();
        for (const extra of [
          {},
          { expectPlanId: 'plan-1', expectPlanDigest: 'a'.repeat(64) },
        ]) {
          expect(
            await code(() =>
              reply(h.deps, args({ replyKind: 'question', ...extra }))
            )
          ).toBe('JULES_INVALID_INPUT');
        }
        expect(h.adapter.writeCount()).toBe(calls);
      });

      it('question with the pair sends, including an activity id spelled none', async () => {
        const q = ask();
        const result = await reply(
          h.deps,
          args({
            replyKind: 'question',
            expectActivityId: q.activityId,
            expectQuestionDigest: messageDigest(QUESTION),
          })
        );
        expect(result.sent).toBe(true);
      });

      it('other refuses any expectation and plan refuses a missing one', async () => {
        const q = ask();
        expect(
          await code(() =>
            reply(
              h.deps,
              args({
                replyKind: 'other',
                expectActivityId: q.activityId,
                expectQuestionDigest: messageDigest(QUESTION),
              })
            )
          )
        ).toBe('JULES_INVALID_INPUT');
        expect(
          await code(() => reply(h.deps, args({ replyKind: 'plan' })))
        ).toBe('JULES_INVALID_INPUT');
        expect((await reply(h.deps, args({ replyKind: 'other' }))).sent).toBe(
          true
        );
      });
    });
  });

  describe('--expect-plan-id and --expect-plan-digest', () => {
    const code = async (run: () => Promise<unknown>) =>
      (await fails(run)).appError.code;

    async function reviewed(planId = 'plan-1') {
      addPlan(h, session.sessionResource, planId);
      await status(h.deps, { session: session.localId, reconcile: false });
      const plan = (await readJournal(h.dataDir)).operations[
        session.localRequestId
      ]?.pendingPlan;
      return {
        expectPlanId: plan!.planId,
        expectPlanDigest: planDigest(plan!.planId, plan!.steps),
      };
    }

    it('sends while the reviewed plan is still pending', async () => {
      const expected = await reviewed();
      expect((await reply(h.deps, args(expected))).sent).toBe(true);
    });

    it('refuses when a replacement plan arrived', async () => {
      const expected = await reviewed();
      h.deps.clock.time += 1_000;
      addPlanNow(h, session.sessionResource, 'plan-2');
      expect(await code(() => reply(h.deps, args(expected)))).toBe(
        'JULES_QUESTION_CHANGED'
      );
      expect(h.adapter.callsTo('sendMessage')).toHaveLength(0);
    });

    it('refuses when a different plan appears between the reserve and the floor read', async () => {
      const expected = await reviewed();
      afterReserve('reply', () => {
        h.deps.clock.time += 1_000;
        addPlanNow(h, session.sessionResource, 'plan-2');
      });
      const err = await fails(() =>
        reply(h.deps, args({ ...expected, replyKind: 'plan' }))
      );
      expect(err.appError.code).toBe('JULES_QUESTION_CHANGED');
      expect(h.adapter.callsTo('sendMessage')).toHaveLength(0);
      const record = (await readJournal(h.dataDir)).operations[
        err.localRequestId as string
      ];
      expect(record?.status).toBe('failed');
      expect(record?.dispatchedAt).toBeUndefined();
    });

    it('refuses when a teammate message follows the reviewed plan', async () => {
      const expected = await reviewed();
      h.deps.clock.time += 1_000;
      addActivity(h, session.sessionResource, {
        type: 'userMessaged',
        message: 'Skip the migration step.',
      });
      expect(await code(() => reply(h.deps, args(expected)))).toBe(
        'JULES_QUESTION_CHANGED'
      );
      expect(h.adapter.callsTo('sendMessage')).toHaveLength(0);
    });

    it('refuses when two differing plans share the newest createTime', async () => {
      const expected = await reviewed();
      const plan = (await readJournal(h.dataDir)).operations[
        session.localRequestId
      ]?.pendingPlan;
      addActivity(h, session.sessionResource, {
        type: 'planGenerated',
        activityId: 'a-low-plan',
        createTime: plan!.activityCreateTime,
        plan: {
          planId: expected.expectPlanId,
          steps: [
            { id: 'st-swapped', title: 'Delete the repository', index: 0 },
          ],
        },
      });
      expect(await code(() => reply(h.deps, args(expected)))).toBe(
        'JULES_QUESTION_CHANGED'
      );
      expect(h.adapter.callsTo('sendMessage')).toHaveLength(0);
    });

    it('refuses when the digest does not match the pending plan', async () => {
      const expected = await reviewed();
      expect(
        await code(() =>
          reply(h.deps, args({ ...expected, expectPlanDigest: 'f'.repeat(64) }))
        )
      ).toBe('JULES_QUESTION_CHANGED');
      expect(h.adapter.callsTo('sendMessage')).toHaveLength(0);
    });

    it('refuses when the session no longer awaits plan approval', async () => {
      const expected = await reviewed();
      setVendorState(h, session.sessionResource, 'inProgress');
      expect(await code(() => reply(h.deps, args(expected)))).toBe(
        'JULES_QUESTION_CHANGED'
      );
    });

    it('refuses a plan whose review text was redacted, even with the digest of what was shown', async () => {
      addActivity(h, session.sessionResource, {
        type: 'planGenerated',
        plan: {
          planId: 'plan-k',
          steps: [
            {
              id: 'st-k',
              title: 'Call the API with AIzaSyA1234567890abcdefghijk',
              index: 0,
            },
          ],
        },
      });
      setVendorState(h, session.sessionResource, 'awaitingPlanApproval');
      await status(h.deps, { session: session.localId, reconcile: false });
      const plan = (await readJournal(h.dataDir)).operations[
        session.localRequestId
      ]?.pendingPlan;
      const writes = h.adapter.writeCount();
      expect(
        await code(() =>
          reply(
            h.deps,
            args({
              expectPlanId: plan!.planId,
              expectPlanDigest: planDigest(plan!.planId, plan!.steps),
            })
          )
        )
      ).toBe('JULES_INVALID_STATE');
      expect(h.adapter.writeCount()).toBe(writes);
    });

    it('needs both values and cannot be combined with a question', async () => {
      const expected = await reviewed();
      expect(
        await code(() =>
          reply(h.deps, args({ expectPlanId: expected.expectPlanId }))
        )
      ).toBe('JULES_INVALID_INPUT');
      expect(
        await code(() =>
          reply(
            h.deps,
            args({
              ...expected,
              expectActivityId: 'a',
              expectQuestionDigest: 'a'.repeat(64),
            })
          )
        )
      ).toBe('JULES_INVALID_INPUT');
    });
  });

  it('an owner that finished after the reserve refuses the reply at the final check', async () => {
    const reservation = await reserveUnderGrant(
      h.deps,
      replyGate('reply-term-1')
    );
    await markOperation(
      h.dataDir,
      session.localRequestId,
      'accepted',
      { condition: 'remote-completed' },
      () => new Date(h.deps.clock.now())
    );
    await expect(
      assertGrantLiveBeforeWrite(h.deps, reservation, 'reconcile', 'empty')
    ).rejects.toMatchObject({ appError: { code: 'JULES_INVALID_STATE' } });
    expect(h.adapter.callsTo('sendMessage')).toHaveLength(0);
    expect(
      (await readJournal(h.dataDir)).operations['reply-term-1']?.status
    ).toBe('failed');
  });

  it('a reserved repair launch is refused when outside activity lands on an earlier launch of its task', async () => {
    const repairGrant = await createGrant(h, {
      maxActiveSessions: 3,
      maxCorrectiveRounds: 2,
    });
    const earlier = await delegateOk(h, repairGrant, { branch: 'scratch/one' });
    h.adapter.calls.length = 0;
    const reservation = await reserveUnderGrant(h.deps, {
      grantId: repairGrant,
      authority: {
        repository: 'acme/widgets',
        sourceResource: 'sources/github/acme/widgets',
        branch: 'scratch/one',
        taskRef: 't1',
        operation: 'create',
        correction: true,
      },
      reservation: {
        localRequestId: 'repair-race-1',
        localId: `jl-${'c'.repeat(32)}`,
        autoPrRequested: false,
        promptDigest: messageDigest('repair'),
      },
    });
    await claimOwnEchoes(
      h.dataDir,
      earlier.sessionResource,
      [{ activityId: 'act-out', digest: messageDigest('someone else') }],
      {
        ownerRequestId: earlier.localRequestId,
        observedAt: new Date(h.deps.clock.now()).toISOString(),
      }
    );
    await expect(
      assertGrantLiveBeforeWrite(h.deps, reservation, 'reconcile', 'empty')
    ).rejects.toMatchObject({ appError: { code: 'JULES_SUPERVISION_PAUSED' } });
    expect(h.adapter.callsTo('createSession')).toHaveLength(0);
  });

  describe('a repair launch needs a landed plain launch of its task', () => {
    const scope = (correction: boolean) => ({
      repository: 'acme/widgets',
      sourceResource: 'sources/github/acme/widgets',
      branch: correction ? 'scratch/one-fix' : 'scratch/one',
      taskRef: 't-repair',
      operation: 'create' as const,
      correction,
    });
    const reserve = (
      grantId: string,
      correction: boolean,
      id: string,
      char: string
    ) =>
      reserveUnderGrant(h.deps, {
        grantId,
        authority: scope(correction),
        reservation: {
          localRequestId: id,
          localId: `jl-${char.repeat(32)}`,
          autoPrRequested: false,
          promptDigest: messageDigest(id),
        },
      });

    it('an undispatched plain reservation does not qualify', async () => {
      const g = await createGrant(h, {
        maxActiveSessions: 3,
        maxCorrectiveRounds: 2,
        taskRefs: ['t-repair'],
      });
      await reserve(g, false, 'plain-pending', 'd');
      await expect(reserve(g, true, 'repair-early', 'e')).rejects.toMatchObject(
        { appError: { code: 'JULES_AUTHORITY_DENIED' } }
      );
    });

    it('the plain launch is rechecked before the repair POST', async () => {
      const g = await createGrant(h, {
        maxActiveSessions: 3,
        maxCorrectiveRounds: 2,
        taskRefs: ['t-repair'],
      });
      await reserve(g, false, 'plain-landed', 'd');
      await markOperation(
        h.dataDir,
        'plain-landed',
        'accepted',
        { sessionResource: 'sessions/plain' },
        () => new Date(h.deps.clock.now())
      );
      const repair = await reserve(g, true, 'repair-ok', 'e');
      await markOperation(
        h.dataDir,
        'plain-landed',
        'failed',
        {},
        () => new Date(h.deps.clock.now())
      );
      await expect(
        assertGrantLiveBeforeWrite(h.deps, repair, 'reconcile', 'empty')
      ).rejects.toMatchObject({ appError: { code: 'JULES_AUTHORITY_DENIED' } });
    });
  });

  it('a terminal condition recorded after the live read is refused inside the gate', async () => {
    const real = h.adapter.getSessionImpl;
    h.adapter.getSessionImpl = async (resource) => {
      const live = await real(resource);
      // A concurrent status records the terminal condition after this read.
      await markOperation(
        h.dataDir,
        session.localRequestId,
        'accepted',
        { condition: 'remote-completed' },
        () => new Date(h.deps.clock.now())
      );
      return live;
    };
    const err = await fails(() => reply(h.deps, args()));
    expect(err.appError.code).toBe('JULES_INVALID_STATE');
    expect(h.adapter.callsTo('sendMessage')).toHaveLength(0);
    expect(h.adapter.writeCount()).toBe(0);
  });
});
