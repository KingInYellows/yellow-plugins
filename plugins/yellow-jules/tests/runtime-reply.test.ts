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
      assertGrantLiveBeforeWrite(h.deps, reservation, 'reconcile')
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
      assertGrantLiveBeforeWrite(h.deps, reservation, 'reconcile')
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
      assertGrantLiveBeforeWrite(h.deps, reservation, 'reconcile')
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
      assertGrantLiveBeforeWrite(h.deps, reservation, 'reconcile')
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
      assertGrantLiveBeforeWrite(h.deps, reservation, 'reconcile')
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
      assertGrantLiveBeforeWrite(h.deps, reservation, 'reconcile')
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
    await assertGrantLiveBeforeWrite(h.deps, reservation, 'reconcile');
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
    await assertGrantLiveBeforeWrite(h.deps, reservation, 'reconcile');
    await settleAccepted(h.deps, reservation);
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
      await assertGrantLiveBeforeWrite(h.deps, reservation, 'reconcile');
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
      assertGrantLiveBeforeWrite(h.deps, reservation, 'reconcile')
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
      assertGrantLiveBeforeWrite(h.deps, reservation, 'reconcile')
    ).rejects.toMatchObject({ appError: { code: 'JULES_SUPERVISION_PAUSED' } });
    expect(h.adapter.callsTo('createSession')).toHaveLength(0);
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
