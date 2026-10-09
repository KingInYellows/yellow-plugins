import * as fs from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadGrants } from '../src/authority.js';
import { authorizeTakeOver } from '../src/authorize.js';
import { resolveGrantsPath } from '../src/config.js';
import { controllerFilePath } from '../src/controller.js';
import { AdapterError, AppErrorException } from '../src/errors.js';
import { approve, delegate, reply } from '../src/mutations.js';
import { approvedPlanVerdict } from '../src/reconcile.js';
import { status } from '../src/runtime.js';
import {
  ensureObservedRecord,
  readJournal,
  updateJournal,
  updateSupervision,
  withJournalLock,
  writeJournal,
} from '../src/state.js';
import type { AdapterSession } from '../src/types.js';
import { reserveUnderGrant } from '../src/write-gate.js';

import { makeSession } from './fake-sdk.js';
import {
  addActivity,
  addPlan,
  createGrant,
  delegateOk,
  reviewedDigestOf,
  type GrantHarness,
  makeHarness,
  setVendorState,
} from './support/grants.js';

let h: GrantHarness;
let grantId: string;

beforeEach(async () => {
  h = makeHarness('correct');
  grantId = await createGrant(h, { maxActiveSessions: 3, maxTotalTasks: 10 });
});
afterEach(() => {
  h.cleanup();
});

/** The vendor accepted the create, but the response was lost: the session exists, the CLI saw a drop. */
async function lostResponse(
  branch: string,
  requestId: string,
  vendorCreates = true
): Promise<void> {
  h.adapter.createSessionImpl = async (input) => {
    if (vendorCreates) await h.adapter.defaultCreateSessionImpl(input);
    throw new AdapterError('network', 'connection reset', { dispatched: true });
  };
  await expect(
    delegate(h.deps, {
      repo: 'acme/widgets',
      branch,
      prompt: 'do it',
      taskRef: 't1',
      dryRun: false,
      correction: false,
      grantId,
      requestId,
    })
  ).rejects.toBeInstanceOf(AppErrorException);
  h.adapter.restoreWrites();
}

async function confirmArchiveVisibility(): Promise<void> {
  await withJournalLock(h.dataDir, async () => {
    const journal = await readJournal(h.dataDir);
    await writeJournal(h.dataDir, {
      ...journal,
      archiveVisibilityConfirmed: true,
    });
  });
}

describe('delegate reservations: one shared sessions walk', () => {
  it('a create bound to an already-finished session frees its slot in the same run', async () => {
    await lostResponse('scratch/done', 'lost-done');
    const [listed] = [...h.adapter.sessions.values()];
    h.adapter.calls.length = 0;
    setVendorState(h, listed!.sessionResource, 'completed');
    const result = await status(h.deps, { reconcile: true });

    expect(result.reconciled).toEqual([
      expect.objectContaining({
        localRequestId: 'lost-done',
        outcome: 'bound',
      }),
    ]);
    expect(
      loadGrants(h.dataDir).grants[grantId]?.usage.activeSessionRefs
    ).toEqual([]);
  });

  it('binds a tagged match with the reserved repository and branch', async () => {
    await lostResponse('scratch/a', 'lost-a');
    h.adapter.calls.length = 0;
    const result = await status(h.deps, { reconcile: true });

    expect(result.reconciled).toEqual([
      expect.objectContaining({
        localRequestId: 'lost-a',
        kind: 'create',
        outcome: 'bound',
        sessionResource: expect.stringMatching(/^sessions\/s\d+$/),
      }),
    ]);
    const record = (await readJournal(h.dataDir)).operations['lost-a'];
    expect(record?.status).toBe('accepted');
    expect(record?.sessionResource).toBe(
      result.reconciled?.[0]?.sessionResource
    );
    expect(record?.lastReconcile?.outcome).toBe('bound');
    // A bound create keeps its active-session charge.
    expect(
      loadGrants(h.dataDir).grants[grantId]?.usage.activeSessionRefs
    ).toEqual(['lost-a']);
    // One walk of sessions; activities are never read per candidate.
    expect(h.adapter.callsTo('listSessions')).toHaveLength(1);
    expect(h.adapter.callsTo('listActivities')).toEqual([]);
  });

  it('resolves several reservations with ONE sessions walk', async () => {
    await lostResponse('scratch/a', 'lost-a');
    await lostResponse('scratch/b', 'lost-b');
    h.adapter.calls.length = 0;
    const result = await status(h.deps, { reconcile: true });
    expect(result.reconciled?.map((r) => r.outcome)).toEqual([
      'bound',
      'bound',
    ]);
    expect(h.adapter.callsTo('listSessions')).toHaveLength(1);
  });

  it('a later status of the bound session finds it by its journal row, not a duplicate', async () => {
    await lostResponse('scratch/a', 'lost-a');
    const reconciled = await status(h.deps, { reconcile: true });
    const sessionResource = reconciled.reconciled?.[0]
      ?.sessionResource as string;
    const observed = await status(h.deps, {
      session: sessionResource,
      reconcile: false,
    });
    expect(observed.localId).toBe(
      (await readJournal(h.dataDir)).operations['lost-a']?.localId
    );
    const rows = Object.values((await readJournal(h.dataDir)).operations);
    expect(
      rows.filter((r) => r.sessionResource === sessionResource)
    ).toHaveLength(1);
  });

  it('released: a complete walk with no candidate, once archive visibility is confirmed', async () => {
    await lostResponse('scratch/a', 'lost-a', false);
    await confirmArchiveVisibility();
    const result = await status(h.deps, { reconcile: true });
    expect(result.reconciled).toEqual([
      expect.objectContaining({
        localRequestId: 'lost-a',
        outcome: 'released',
      }),
    ]);
    expect((await readJournal(h.dataDir)).operations['lost-a']?.status).toBe(
      'failed'
    );
    expect(
      loadGrants(h.dataDir).grants[grantId]?.usage.activeSessionRefs
    ).toEqual([]);
    // The guard is free again.
    await expect(
      delegate(h.deps, {
        repo: 'acme/widgets',
        branch: 'scratch/a',
        prompt: 'retry',
        taskRef: 't1',
        dryRun: false,
        correction: false,
        grantId,
      })
    ).resolves.toHaveProperty('sessionResource');
  });

  it('a controller clock more than 5 minutes ahead of the service clock still finds the tagged session', async () => {
    await lostResponse('scratch/a', 'lost-a');
    await confirmArchiveVisibility();
    const record = (await readJournal(h.dataDir)).operations['lost-a'];
    const [resource, vendor] = [...h.adapter.sessions.entries()][0] ?? [];
    // The service stamped the session 10 minutes before the controller's
    // reservation time: the controller clock runs ahead.
    h.adapter.sessions.set(resource as string, {
      ...(vendor as AdapterSession),
      createTime: new Date(
        Date.parse(record?.createdAt as string) - 10 * 60_000
      ).toISOString(),
    });
    // A vendor that honours a create_time filter hides the session from a
    // filter derived from the controller clock.
    const all = h.adapter.listSessionsImpl;
    h.adapter.listSessionsImpl = async (options) => {
      const page = await all({ ...options, pageSize: 1000 });
      const m = /create_time > "([^"]+)"/.exec(options.filter ?? '');
      return {
        sessions: page.sessions.filter(
          (x) =>
            m === null ||
            Date.parse(x.createTime ?? '') > Date.parse(m[1] as string)
        ),
      };
    };
    const result = await status(h.deps, { reconcile: true });
    expect(result.reconciled).toEqual([
      expect.objectContaining({ localRequestId: 'lost-a', outcome: 'bound' }),
    ]);
    expect(h.adapter.callsTo('listSessions')[0]?.args[0]).not.toHaveProperty(
      'filter'
    );
  });

  it('absence of evidence never releases while archive visibility is unverified', async () => {
    await lostResponse('scratch/a', 'lost-a', false);
    const result = await status(h.deps, { reconcile: true });
    expect(result.reconciled?.[0]).toMatchObject({
      outcome: 'ambiguous-reconcile',
      reason: 'archive-visibility-unverified',
    });
    expect((await readJournal(h.dataDir)).operations['lost-a']?.status).toBe(
      'unknown-outcome'
    );
  });

  it('an untagged session already observed by status stays a candidate for the lost create', async () => {
    await lostResponse('scratch/a', 'lost-a', false);
    await confirmArchiveVisibility();
    h.adapter.sessions.set(
      'sessions/other1',
      makeSession({
        sessionResource: 'sessions/other1',
        title: 'trimmed title',
        sourceResource: 'sources/github/acme/widgets',
        startingBranch: 'scratch/a',
        createTime: new Date(h.deps.clock.now()).toISOString(),
      })
    );
    await ensureObservedRecord(h.dataDir, 'sessions/other1');
    const result = await status(h.deps, { reconcile: true });
    expect(result.reconciled?.[0]).toMatchObject({
      outcome: 'ambiguous-reconcile',
      reason: 'untagged-candidate',
    });
    expect((await readJournal(h.dataDir)).operations['lost-a']?.status).toBe(
      'unknown-outcome'
    );
  });

  it('an untagged same-source, same-branch session in the window is ambiguous (title trimming)', async () => {
    await lostResponse('scratch/a', 'lost-a', false);
    await confirmArchiveVisibility();
    h.adapter.sessions.set(
      'sessions/other1',
      makeSession({
        sessionResource: 'sessions/other1',
        title: 'trimmed title',
        sourceResource: 'sources/github/acme/widgets',
        startingBranch: 'scratch/a',
        createTime: new Date(h.deps.clock.now()).toISOString(),
      })
    );
    const result = await status(h.deps, { reconcile: true });
    expect(result.reconciled?.[0]).toMatchObject({
      outcome: 'ambiguous-reconcile',
      reason: 'untagged-candidate',
    });
    expect((await readJournal(h.dataDir)).operations['lost-a']?.status).toBe(
      'unknown-outcome'
    );
  });

  it('an unowned same-repo/branch session stamped before the reservation keeps the create ambiguous, never released (no cross-clock floor)', async () => {
    await lostResponse('scratch/a', 'lost-a');
    await confirmArchiveVisibility();
    const record = (await readJournal(h.dataDir)).operations['lost-a'];
    const [resource, vendor] = [...h.adapter.sessions.entries()][0] ?? [];
    // The controller clock runs more than 5 minutes ahead of the service's, and
    // the vendor dropped the title tag: the stamp lies before any local floor.
    h.adapter.sessions.set(resource as string, {
      ...(vendor as AdapterSession),
      title: 'trimmed title',
      createTime: new Date(
        Date.parse(record?.createdAt as string) - 10 * 60_000
      ).toISOString(),
    });
    const result = await status(h.deps, { reconcile: true });
    expect(result.reconciled?.[0]).toMatchObject({
      outcome: 'ambiguous-reconcile',
      reason: 'untagged-candidate',
    });
    expect((await readJournal(h.dataDir)).operations['lost-a']?.status).toBe(
      'unknown-outcome'
    );
  });

  it('more than one tagged candidate is ambiguous', async () => {
    await lostResponse('scratch/a', 'lost-a');
    const localId = (await readJournal(h.dataDir)).operations['lost-a']
      ?.localId;
    const twin: AdapterSession = makeSession({
      sessionResource: 'sessions/twin',
      title: `[yellow:${localId}] twin`,
      sourceResource: 'sources/github/acme/widgets',
      startingBranch: 'scratch/a',
    });
    h.adapter.sessions.set('sessions/twin', twin);
    const result = await status(h.deps, { reconcile: true });
    expect(result.reconciled?.[0]).toMatchObject({
      outcome: 'ambiguous-reconcile',
      reason: 'multiple-candidates',
    });
    expect((await readJournal(h.dataDir)).operations['lost-a']?.status).toBe(
      'unknown-outcome'
    );
  });

  it('a tagged session on another branch is a policy deviation that stops delegation under the grant', async () => {
    await lostResponse('scratch/a', 'lost-a');
    for (const [id, s] of h.adapter.sessions) {
      h.adapter.sessions.set(id, { ...s, startingBranch: 'main' });
    }
    const result = await status(h.deps, { reconcile: true });
    expect(result.reconciled?.[0]).toMatchObject({
      outcome: 'policy-deviation',
      reason: 'repository-or-branch-mismatch',
    });
    expect(result.attention).toEqual(['reconciled:policy-deviation']);
    expect(result.policyDeviation).toBe(true);
    const record = (await readJournal(h.dataDir)).operations['lost-a'];
    expect(record?.deviations).toHaveLength(1);
    expect(record?.status).toBe('unknown-outcome');

    await expect(
      delegate(h.deps, {
        repo: 'acme/widgets',
        branch: 'scratch/zzz',
        prompt: 'x',
        taskRef: 't1',
        dryRun: false,
        correction: false,
        grantId,
      })
    ).rejects.toMatchObject({ appError: { code: 'JULES_POLICY_DEVIATION' } });
  });

  it('a walk stopped by the page cap is not-reached and leaves the reservation in place', async () => {
    await lostResponse('scratch/a', 'lost-a');
    // Push the tagged session beyond 5 pages of 100 by prepending filler.
    const tagged = [...h.adapter.sessions.entries()];
    h.adapter.sessions.clear();
    for (let i = 0; i < 520; i += 1) {
      h.adapter.sessions.set(
        `sessions/filler${i}`,
        makeSession({
          sessionResource: `sessions/filler${i}`,
          title: `filler ${i}`,
          sourceResource: 'sources/github/other/repo',
        })
      );
    }
    for (const [k, v] of tagged) h.adapter.sessions.set(k, v);
    const result = await status(h.deps, { reconcile: true });
    expect(result.reconciled?.[0]).toMatchObject({ outcome: 'not-reached' });
    expect(h.adapter.callsTo('listSessions')).toHaveLength(5);
    expect((await readJournal(h.dataDir)).operations['lost-a']?.status).toBe(
      'unknown-outcome'
    );
  });

  it('a deadline that fires mid-walk is not-reached, never released', async () => {
    await lostResponse('scratch/a', 'lost-a', false);
    await confirmArchiveVisibility();
    h.adapter.listSessionsImpl = async () => {
      h.deps.clock.time += 10 * 60_000;
      return { sessions: [], nextPageToken: 'p1' };
    };
    const result = await status(h.deps, {
      reconcile: true,
      deadlineMs: 60_000,
    });
    expect(result.reconciled?.[0]?.outcome).toBe('not-reached');
    expect((await readJournal(h.dataDir)).operations['lost-a']?.status).toBe(
      'unknown-outcome'
    );
  });

  it('a page failure is not-reached; an auth failure fails the whole reconcile', async () => {
    await lostResponse('scratch/a', 'lost-a');
    h.adapter.listSessionsImpl = async () => {
      throw new AdapterError('server-error', 'boom', { status: 503 });
    };
    const result = await status(h.deps, { reconcile: true });
    expect(result.reconciled?.[0]?.outcome).toBe('not-reached');

    h.adapter.listSessionsImpl = async () => {
      throw new AdapterError('auth', 'no', { status: 401 });
    };
    await expect(status(h.deps, { reconcile: true })).rejects.toMatchObject({
      appError: { code: 'JULES_AUTH_FAILED' },
    });
  });

  it('with nothing outstanding it never touches the vendor', async () => {
    const result = await status(h.deps, { reconcile: true });
    expect(result.reconciled).toEqual([]);
    expect(h.adapter.callsTo('listSessions')).toEqual([]);
  });
});

describe('a reservation from an earlier controller epoch', () => {
  it('is aged from the take-over on the new host clock, not from its own createdAt', async () => {
    const session = await delegateOk(h, grantId);
    await reserveUnderGrant(h.deps, {
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
        localRequestId: 'old-epoch-reply',
        localId: `jl-${'c'.repeat(32)}`,
        sessionResource: session.sessionResource,
        promptDigest: 'd'.repeat(64),
      },
    });
    // The new host's clock runs well ahead of the old host's: by its own
    // createdAt the reservation is long settled.
    h.deps.clock.time += 30 * 60_000;
    await authorizeTakeOver(h.deps);
    const first = await status(h.deps, {
      session: session.localId,
      reconcile: true,
    });
    expect(first.reconciled).toEqual([
      expect.objectContaining({
        localRequestId: 'old-epoch-reply',
        outcome: 'not-reached',
        reason: expect.stringContaining('in flight'),
      }),
    ]);
    // Once the settle interval has elapsed from the take-over it is resolved.
    h.deps.clock.time += 270_000;
    const later = await status(h.deps, {
      session: session.localId,
      reconcile: true,
    });
    expect(later.reconciled?.[0]?.reason ?? '').not.toContain('in flight');
  });
});

describe('reply and approve reservations resolve on their own session', () => {
  /** Classifies the session's existing user messages and clears the pause: a write never dispatches over an unclassified one. */
  async function observePrior(session: {
    localId: string;
    localRequestId: string;
  }) {
    await status(h.deps, { session: session.localId, reconcile: false });
    await updateSupervision(h.dataDir, session.localRequestId, {
      outsideSeen: null,
    });
  }

  async function strandedReply(message: string, requestId: string) {
    const session = await delegateOk(h, grantId);
    await strand(session, message, requestId);
    return session;
  }

  async function strand(
    session: { localId: string },
    message: string,
    requestId: string
  ) {
    h.adapter.sendMessageImpl = async () => {
      throw new AdapterError('network', 'reset', { dispatched: true });
    };
    await expect(
      reply(h.deps, {
        session: session.localId,
        message,
        dryRun: false,
        correction: false,
        grantId,
        requestId,
      })
    ).rejects.toBeInstanceOf(AppErrorException);
    h.adapter.calls.length = 0;
  }

  it('a userMessaged activity whose digest matches binds it — and sessions are never walked', async () => {
    const session = await strandedReply('exact words', 'reply-1');
    addActivity(h, session.sessionResource, {
      type: 'userMessaged',
      message: 'exact words',
    });
    const result = await status(h.deps, {
      session: session.localId,
      reconcile: true,
    });
    expect(result.reconciled).toEqual([
      expect.objectContaining({
        localRequestId: 'reply-1',
        kind: 'reply',
        outcome: 'bound',
      }),
    ]);
    expect((await readJournal(h.dataDir)).operations['reply-1']?.status).toBe(
      'accepted'
    );
    expect(h.adapter.callsTo('listSessions')).toEqual([]);
    expect(h.adapter.callsTo('getSession').length).toBeGreaterThan(0);
  });

  it('an echo already claimed by a settled reply is not bound to a later unknown-outcome reply', async () => {
    const session = await delegateOk(h, grantId);
    await reply(h.deps, {
      session: session.localId,
      message: 'same words',
      dryRun: false,
      correction: false,
      grantId,
      requestId: 'reply-1',
    });
    addActivity(h, session.sessionResource, {
      type: 'userMessaged',
      message: 'same words',
    });
    // A plain status claims that echo for the settled reply.
    await status(h.deps, { session: session.localId, reconcile: false });
    expect(
      (await readJournal(h.dataDir)).operations['reply-1']?.echoActivityId
    ).toBeDefined();

    h.deps.clock.time += 5_000;
    h.adapter.sendMessageImpl = async () => {
      throw new AdapterError('network', 'reset', { dispatched: true });
    };
    await expect(
      reply(h.deps, {
        session: session.localId,
        message: 'same words',
        dryRun: false,
        correction: false,
        grantId,
        requestId: 'reply-2',
      })
    ).rejects.toBeInstanceOf(AppErrorException);

    const result = await status(h.deps, {
      session: session.localId,
      reconcile: true,
    });
    expect(
      result.reconciled?.find((r) => r.localRequestId === 'reply-2')
    ).toMatchObject({ outcome: 'unknown-outcome' });
    expect((await readJournal(h.dataDir)).operations['reply-2']?.status).toBe(
      'unknown-outcome'
    );
  });

  it('an unknown-outcome reply whose echo a plain status already claimed is resolved as landed by reconcile', async () => {
    const session = await delegateOk(h, grantId);
    h.adapter.sendMessageImpl = async () => {
      throw new AdapterError('network', 'reset', { dispatched: true });
    };
    await expect(
      reply(h.deps, {
        session: session.localId,
        message: 'lost words',
        dryRun: false,
        correction: false,
        grantId,
        requestId: 'reply-1',
      })
    ).rejects.toBeInstanceOf(AppErrorException);
    expect((await readJournal(h.dataDir)).operations['reply-1']?.status).toBe(
      'unknown-outcome'
    );
    h.deps.clock.time += 1_000;
    const echo = addActivity(h, session.sessionResource, {
      type: 'userMessaged',
      message: 'lost words',
    });
    // A plain status records the echo against the unresolved reply.
    await status(h.deps, { session: session.localId, reconcile: false });
    expect(
      (await readJournal(h.dataDir)).operations['reply-1']?.echoActivityId
    ).toBe(echo.activityId);

    const result = await status(h.deps, {
      session: session.localId,
      reconcile: true,
    });
    expect(
      result.reconciled?.find((r) => r.localRequestId === 'reply-1')
    ).toMatchObject({ outcome: 'bound' });
    const record = (await readJournal(h.dataDir)).operations['reply-1'];
    expect(record?.status).toBe('accepted');
    expect(record?.echoActivityId).toBe(echo.activityId);
  });

  it('an echo that may belong to a settled same-text reply is not bound to an unknown-outcome one', async () => {
    const session = await delegateOk(h, grantId);
    await reply(h.deps, {
      session: session.localId,
      message: 'same words',
      dryRun: false,
      correction: false,
      grantId,
      requestId: 'reply-a',
    });
    expect(
      (await readJournal(h.dataDir)).operations['reply-a']?.echoActivityId
    ).toBeUndefined();
    h.deps.clock.time += 5_000;
    h.adapter.sendMessageImpl = async () => {
      throw new AdapterError('network', 'reset', { dispatched: true });
    };
    await expect(
      reply(h.deps, {
        session: session.localId,
        message: 'same words',
        dryRun: false,
        correction: false,
        grantId,
        requestId: 'reply-b',
      })
    ).rejects.toBeInstanceOf(AppErrorException);
    h.deps.clock.time += 1_000;
    // The only echo first appears now, during the reconcile run: it may be A's.
    addActivity(h, session.sessionResource, {
      type: 'userMessaged',
      message: 'same words',
    });
    const result = await status(h.deps, {
      session: session.localId,
      reconcile: true,
    });
    expect(
      result.reconciled?.find((r) => r.localRequestId === 'reply-b')
    ).toMatchObject({ outcome: 'ambiguous-reconcile' });
    const ops = (await readJournal(h.dataDir)).operations;
    expect(ops['reply-b']?.status).toBe('unknown-outcome');
    expect(ops['reply-b']?.echoActivityId).toBeUndefined();
  });

  it('an echo id claimed in another session does not block binding here', async () => {
    const session = await strandedReply('exact words', 'reply-1');
    // Activity ids carry no session: another session's reply claimed this id.
    await updateJournal(h.dataDir, (operations) => {
      const base = operations['reply-1']!;
      operations['other-session-reply'] = {
        ...base,
        localRequestId: 'other-session-reply',
        localId: `jl-${'e'.repeat(32)}`,
        status: 'accepted',
        sessionResource: 'sessions/other999',
        echoActivityId: 'act-shared-id',
      };
    });
    addActivity(h, session.sessionResource, {
      activityId: 'act-shared-id',
      type: 'userMessaged',
      message: 'exact words',
    });
    const result = await status(h.deps, {
      session: session.localId,
      reconcile: true,
    });
    expect(
      result.reconciled?.find((r) => r.localRequestId === 'reply-1')
    ).toMatchObject({ outcome: 'bound' });
  });

  it('a sessionless reconcile that binds a reply persists the echo it matched', async () => {
    const session = await strandedReply('exact words', 'reply-1');
    const echo = addActivity(h, session.sessionResource, {
      type: 'userMessaged',
      message: 'exact words',
    });
    const result = await status(h.deps, { reconcile: true });
    expect(
      result.reconciled?.find((r) => r.localRequestId === 'reply-1')
    ).toMatchObject({ outcome: 'bound' });
    expect(
      (await readJournal(h.dataDir)).operations['reply-1']?.echoActivityId
    ).toBe(echo.activityId);
  });

  it('a digest that matches after trimming edge whitespace still binds', async () => {
    const session = await strandedReply('padded', 'reply-1');
    addActivity(h, session.sessionResource, {
      type: 'userMessaged',
      message: '  padded\n',
    });
    const result = await status(h.deps, {
      session: session.localId,
      reconcile: true,
    });
    expect(result.reconciled?.[0]?.outcome).toBe('bound');
  });

  it('a complete walk with no match leaves unknown-outcome — it never releases a reply', async () => {
    const session = await strandedReply('never arrived', 'reply-1');
    addActivity(h, session.sessionResource, {
      type: 'userMessaged',
      message: 'something else',
    });
    const result = await status(h.deps, {
      session: session.localId,
      reconcile: true,
    });
    expect(result.reconciled?.[0]).toMatchObject({
      outcome: 'unknown-outcome',
    });
    expect((await readJournal(h.dataDir)).operations['reply-1']?.status).toBe(
      'unknown-outcome'
    );
  });

  it('two matching activities are ambiguous', async () => {
    const session = await strandedReply('twice', 'reply-1');
    addActivity(h, session.sessionResource, {
      type: 'userMessaged',
      message: 'twice',
    });
    addActivity(h, session.sessionResource, {
      type: 'userMessaged',
      message: 'twice',
    });
    const result = await status(h.deps, {
      session: session.localId,
      reconcile: true,
    });
    expect(result.reconciled?.[0]).toMatchObject({
      outcome: 'ambiguous-reconcile',
      reason: 'multiple-candidates',
    });
  });

  it('two unresolved replies with one digest never both bind to a single activity', async () => {
    const session = await strandedReply('same words', 'reply-1');
    h.adapter.sendMessageImpl = async () => {
      throw new AdapterError('network', 'reset', { dispatched: true });
    };
    await expect(
      reply(h.deps, {
        session: session.localId,
        message: 'same words',
        dryRun: false,
        correction: false,
        grantId,
        requestId: 'reply-2',
      })
    ).rejects.toBeInstanceOf(AppErrorException);
    addActivity(h, session.sessionResource, {
      type: 'userMessaged',
      message: 'same words',
    });
    const result = await status(h.deps, {
      session: session.localId,
      reconcile: true,
    });
    const outcomes = Object.fromEntries(
      (result.reconciled ?? []).map((r) => [r.localRequestId, r.outcome])
    );
    expect(outcomes).toEqual({
      'reply-1': 'ambiguous-reconcile',
      'reply-2': 'ambiguous-reconcile',
    });
    const ops = (await readJournal(h.dataDir)).operations;
    expect(ops['reply-1']?.status).toBe('unknown-outcome');
    expect(ops['reply-2']?.status).toBe('unknown-outcome');
  });

  it('an older matching send is a prior send, never this one', async () => {
    const session = await delegateOk(h, grantId);
    addActivity(h, session.sessionResource, {
      type: 'userMessaged',
      message: 'repeat me',
      createTime: new Date(h.deps.clock.now() - 60 * 60_000).toISOString(),
    });
    await observePrior(session);
    await strand(session, 'repeat me', 'reply-1');
    // The prior message is older than the pre-dispatch floor: not an echo.
    expect(
      (await readJournal(h.dataDir)).operations['reply-1']
        ?.vendorFloorCreateTime
    ).toBeDefined();
    const result = await status(h.deps, {
      session: session.localId,
      reconcile: true,
    });
    expect(result.reconciled?.[0]?.outcome).toBe('unknown-outcome');
  });

  it('a teammate message the controller clock calls later is not bound when the vendor clock runs ahead', async () => {
    const session = await delegateOk(h, grantId);
    // Two minutes ahead of the controller: after dispatchedAt, before the POST.
    const teammate = addActivity(h, session.sessionResource, {
      type: 'userMessaged',
      message: 'same words',
      createTime: new Date(h.deps.clock.now() + 120_000).toISOString(),
    });
    await observePrior(session);
    await strand(session, 'same words', 'reply-1');
    const floor = (await readJournal(h.dataDir)).operations['reply-1'];
    expect(floor?.vendorFloorActivityId).toBe(teammate.activityId);
    const result = await status(h.deps, {
      session: session.localId,
      reconcile: true,
    });
    expect(result.reconciled?.[0]?.outcome).toBe('unknown-outcome');
    expect((await readJournal(h.dataDir)).operations['reply-1']?.status).toBe(
      'unknown-outcome'
    );
  });

  it('an echo strictly newer than the pre-dispatch activity binds (the common path)', async () => {
    const session = await delegateOk(h, grantId);
    const prior = addActivity(h, session.sessionResource, {
      type: 'userMessaged',
      message: 'unrelated',
      createTime: new Date(h.deps.clock.now() + 1_000).toISOString(),
    });
    await observePrior(session);
    await strand(session, 'same words', 'reply-1');
    const echo = addActivity(h, session.sessionResource, {
      type: 'userMessaged',
      message: 'same words',
      createTime: new Date(Date.parse(prior.createTime) + 1_000).toISOString(),
    });
    const result = await status(h.deps, {
      session: session.localId,
      reconcile: true,
    });
    expect(result.reconciled?.[0]?.outcome).toBe('bound');
    expect(
      (await readJournal(h.dataDir)).operations['reply-1']?.echoActivityId
    ).toBe(echo.activityId);
  });

  it('a match at the same createTime as the pre-dispatch activity cannot be ordered and stays ambiguous', async () => {
    const session = await delegateOk(h, grantId);
    const prior = addActivity(h, session.sessionResource, {
      type: 'userMessaged',
      message: 'unrelated',
      createTime: new Date(h.deps.clock.now() + 1_000).toISOString(),
    });
    await observePrior(session);
    await strand(session, 'same words', 'reply-1');
    addActivity(h, session.sessionResource, {
      type: 'userMessaged',
      message: 'same words',
      createTime: prior.createTime,
    });
    const result = await status(h.deps, {
      session: session.localId,
      reconcile: true,
    });
    expect(result.reconciled?.[0]).toMatchObject({
      outcome: 'ambiguous-reconcile',
      reason: 'dispatch-time-unknown',
    });
  });

  it('a matching message just after the dispatch binds', async () => {
    const session = await strandedReply('same words', 'reply-1');
    addActivity(h, session.sessionResource, {
      type: 'userMessaged',
      message: 'same words',
      createTime: new Date(h.deps.clock.now() + 1_000).toISOString(),
    });
    const result = await status(h.deps, {
      session: session.localId,
      reconcile: true,
    });
    expect(result.reconciled?.[0]?.outcome).toBe('bound');
  });

  it('a reply with no vendor floor is never bound — a match is ambiguous', async () => {
    const session = await strandedReply('legacy words', 'reply-1');
    await updateJournal(h.dataDir, (operations) => {
      const {
        vendorFloorEmpty: _e,
        vendorFloorCreateTime: _c,
        vendorFloorActivityId: _a,
        ...rest
      } = operations['reply-1']!;
      operations['reply-1'] = rest;
    });
    addActivity(h, session.sessionResource, {
      type: 'userMessaged',
      message: 'legacy words',
    });
    const result = await status(h.deps, {
      session: session.localId,
      reconcile: true,
    });
    expect(result.reconciled?.[0]).toMatchObject({
      outcome: 'ambiguous-reconcile',
      reason: 'dispatch-time-unknown',
    });
    expect(
      (await readJournal(h.dataDir)).operations['reply-1']?.status
    ).not.toBe('accepted');
  });

  it('a partial walk is not-reached', async () => {
    const session = await strandedReply('maybe', 'reply-1');
    h.adapter.listActivitiesImpl = async () => {
      throw new AdapterError('server-error', 'boom', { status: 503 });
    };
    const result = await status(h.deps, {
      session: session.localId,
      reconcile: true,
    });
    expect(result.reconciled?.[0]?.outcome).toBe('not-reached');
  });

  it('a reply bound by reconcile persists its echo createTime beside the id', async () => {
    const session = await strandedReply('carry my time', 'reply-1');
    const echo = addActivity(h, session.sessionResource, {
      type: 'userMessaged',
      message: 'carry my time',
      createTime: new Date(h.deps.clock.now() + 5_000).toISOString(),
    });
    await status(h.deps, { session: session.localId, reconcile: true });
    const record = (await readJournal(h.dataDir)).operations['reply-1'];
    expect(record?.echoActivityId).toBe(echo.activityId);
    expect(record?.echoCreateTime).toBe(echo.createTime);
  });

  async function strandedApprove() {
    const session = await delegateOk(h, grantId);
    addPlan(h, session.sessionResource, 'plan-1');
    await status(h.deps, { session: session.localId, reconcile: false });
    h.adapter.approvePlanImpl = async () => {
      throw new AdapterError('network', 'reset', { dispatched: true });
    };
    await expect(
      approve(h.deps, {
        session: session.localId,
        planId: 'plan-1',
        expectPlanDigest: await reviewedDigestOf(h, session.localRequestId),
        dryRun: false,
        grantId,
        requestId: 'approve-1',
      })
    ).rejects.toBeInstanceOf(AppErrorException);
    return session;
  }

  it('an approve whose lost response landed on a same-id replacement plan binds but records a deviation', async () => {
    const session = await strandedApprove();
    const now = h.deps.clock.now();
    addActivity(h, session.sessionResource, {
      type: 'planGenerated',
      createTime: new Date(now + 1_000).toISOString(),
      plan: {
        planId: 'plan-1',
        steps: [{ id: 'st-x', title: 'Entirely different work', index: 0 }],
      },
    });
    addActivity(h, session.sessionResource, {
      type: 'planApproved',
      approvedPlanId: 'plan-1',
      createTime: new Date(now + 2_000).toISOString(),
    });
    await status(h.deps, { session: session.localId, reconcile: true });
    const ops = (await readJournal(h.dataDir)).operations;
    expect(ops['approve-1']?.status).toBe('accepted');
    expect(ops[session.localRequestId]?.deviations).toEqual([
      expect.objectContaining({
        kind: 'policy-deviation',
        reconciled: false,
      }),
    ]);
  });

  it('a sessionless reconcile reports the changed-plan approve as a policy deviation needing attention', async () => {
    const session = await strandedApprove();
    const now = h.deps.clock.now();
    addActivity(h, session.sessionResource, {
      type: 'planGenerated',
      createTime: new Date(now + 1_000).toISOString(),
      plan: {
        planId: 'plan-1',
        steps: [{ id: 'st-x', title: 'Entirely different work', index: 0 }],
      },
    });
    addActivity(h, session.sessionResource, {
      type: 'planApproved',
      approvedPlanId: 'plan-1',
      createTime: new Date(now + 2_000).toISOString(),
    });
    const result = await status(h.deps, { reconcile: true });
    expect(result.reconciled?.[0]).toMatchObject({
      localRequestId: 'approve-1',
      outcome: 'bound',
      policyDeviation: true,
    });
    expect(result.policyDeviation).toBe(true);
    expect(result.requiresAttention).toBe(true);
    expect(result.attention).toContain('reconciled:policyDeviation');
  });

  it('an approval naming a different plan after a lost approve response binds as a changed-plan deviation', async () => {
    const session = await strandedApprove();
    const now = h.deps.clock.now();
    addActivity(h, session.sessionResource, {
      type: 'planGenerated',
      createTime: new Date(now + 1_000).toISOString(),
      plan: {
        planId: 'plan-2',
        steps: [{ id: 'st-2', title: 'Replacement', index: 0 }],
      },
    });
    addActivity(h, session.sessionResource, {
      type: 'planApproved',
      approvedPlanId: 'plan-2',
      createTime: new Date(now + 2_000).toISOString(),
    });
    const result = await status(h.deps, {
      session: session.localId,
      reconcile: true,
    });
    expect(result.reconciled?.[0]).toMatchObject({
      localRequestId: 'approve-1',
      outcome: 'bound',
      policyDeviation: true,
    });
    const ops = (await readJournal(h.dataDir)).operations;
    expect(ops[session.localRequestId]?.deviations).toHaveLength(1);
  });

  it('two approvals of other plans after a lost approve response stay ambiguous and block the session', async () => {
    const session = await strandedApprove();
    const now = h.deps.clock.now();
    for (const [i, planId] of ['plan-2', 'plan-3'].entries()) {
      addActivity(h, session.sessionResource, {
        type: 'planApproved',
        approvedPlanId: planId,
        createTime: new Date(now + 1_000 + i * 1_000).toISOString(),
      });
    }
    const result = await status(h.deps, {
      session: session.localId,
      reconcile: true,
    });
    expect(result.reconciled?.[0]).toMatchObject({
      localRequestId: 'approve-1',
      outcome: 'ambiguous-reconcile',
      reason: 'approval-of-another-plan',
    });
    const ops = (await readJournal(h.dataDir)).operations;
    expect(ops['approve-1']?.status).toBe('unknown-outcome');
    expect(ops[session.localRequestId]?.deviations).toHaveLength(1);
  });

  it('an unordered same-plan match plus a later approval of another plan is ambiguous and still records a blocking deviation', async () => {
    const session = await strandedApprove();
    const floor = (await readJournal(h.dataDir)).operations['approve-1']
      ?.vendorFloorCreateTime;
    expect(floor).toBeDefined();
    // Tied with the vendor floor: cannot be ordered against the dispatch.
    addActivity(h, session.sessionResource, {
      type: 'planApproved',
      approvedPlanId: 'plan-1',
      createTime: floor,
    });
    addActivity(h, session.sessionResource, {
      type: 'planApproved',
      approvedPlanId: 'plan-2',
      createTime: new Date(Date.parse(floor!) + 5_000).toISOString(),
    });
    const result = await status(h.deps, {
      session: session.localId,
      reconcile: true,
    });
    expect(result.reconciled?.[0]).toMatchObject({
      outcome: 'ambiguous-reconcile',
    });
    const ops = (await readJournal(h.dataDir)).operations;
    expect(ops[session.localRequestId]?.deviations).toHaveLength(1);
  });

  it('one foreign approval cannot resolve two unresolved approves, and a bound one persists the consumed activity', async () => {
    const session = await strandedApprove();
    h.adapter.approvePlanImpl = async () => {
      throw new AdapterError('network', 'reset', { dispatched: true });
    };
    await expect(
      approve(h.deps, {
        session: session.localId,
        planId: 'plan-1',
        expectPlanDigest: await reviewedDigestOf(h, session.localRequestId),
        dryRun: false,
        grantId,
        requestId: 'approve-2',
      })
    ).rejects.toBeInstanceOf(AppErrorException);
    const floor = (await readJournal(h.dataDir)).operations['approve-2']
      ?.vendorFloorCreateTime;
    addActivity(h, session.sessionResource, {
      type: 'planApproved',
      approvedPlanId: 'plan-2',
      createTime: new Date(Date.parse(floor!) + 5_000).toISOString(),
    });
    const result = await status(h.deps, {
      session: session.localId,
      reconcile: true,
    });
    const outcomes = Object.fromEntries(
      (result.reconciled ?? []).map((r) => [r.localRequestId, r.outcome])
    );
    expect(outcomes).toEqual({
      'approve-1': 'ambiguous-reconcile',
      'approve-2': 'ambiguous-reconcile',
    });
  });

  it('a foreign approval that binds a single approve is persisted as its consumed activity', async () => {
    const session = await strandedApprove();
    const floor = (await readJournal(h.dataDir)).operations['approve-1']
      ?.vendorFloorCreateTime;
    const consumed = addActivity(h, session.sessionResource, {
      type: 'planApproved',
      approvedPlanId: 'plan-2',
      createTime: new Date(Date.parse(floor!) + 5_000).toISOString(),
    });
    await status(h.deps, { session: session.localId, reconcile: true });
    expect(
      (await readJournal(h.dataDir)).operations['approve-1']?.echoActivityId
    ).toBe(consumed.activityId);
  });

  it('an approve that landed on the reviewed plan binds without a deviation', async () => {
    const session = await strandedApprove();
    addActivity(h, session.sessionResource, {
      type: 'planApproved',
      approvedPlanId: 'plan-1',
      createTime: new Date(h.deps.clock.now() + 2_000).toISOString(),
    });
    await status(h.deps, { session: session.localId, reconcile: true });
    const ops = (await readJournal(h.dataDir)).operations;
    expect(ops['approve-1']?.status).toBe('accepted');
    expect(ops[session.localRequestId]?.deviations).toEqual([]);
  });

  it('approvedPlanVerdict leaves an unreadable preceding plan ambiguous', () => {
    const t = '2026-01-01T00:00:10.000Z';
    const plan = (time: string, digest: string) => ({
      createTime: time,
      activityId: `p-${digest}`,
      digest,
    });
    expect(approvedPlanVerdict([], t, 'd1', true)).toBe('unreadable');
    expect(
      approvedPlanVerdict(
        [plan('2026-01-01T00:00:01.000Z', 'd1')],
        t,
        'd1',
        false
      )
    ).toBe('unreadable');
    expect(
      approvedPlanVerdict(
        [plan('2026-01-01T00:00:01.000Z', 'd1')],
        undefined,
        'd1',
        true
      )
    ).toBe('unreadable');
    expect(approvedPlanVerdict([plan(t, 'd1')], t, 'd1', true)).toBe(
      'unreadable'
    );
    expect(
      approvedPlanVerdict(
        [plan('2026-01-01T00:00:01.000Z', 'd1')],
        t,
        'd1',
        true
      )
    ).toBe('same');
    expect(
      approvedPlanVerdict(
        [plan('2026-01-01T00:00:01.000Z', 'd2')],
        t,
        'd1',
        true
      )
    ).toBe('changed');
  });

  it('an approve is bound by a planApproved for the reserved plan id', async () => {
    const session = await delegateOk(h, grantId);
    addPlan(h, session.sessionResource, 'plan-1');
    await status(h.deps, { session: session.localId, reconcile: false });
    h.adapter.approvePlanImpl = async () => {
      throw new AdapterError('network', 'reset', { dispatched: true });
    };
    await expect(
      approve(h.deps, {
        session: session.localId,
        planId: 'plan-1',
        expectPlanDigest: await reviewedDigestOf(h, session.localRequestId),
        dryRun: false,
        grantId,
        requestId: 'approve-1',
      })
    ).rejects.toBeInstanceOf(AppErrorException);

    addActivity(h, session.sessionResource, {
      type: 'planApproved',
      approvedPlanId: 'plan-1',
    });
    const result = await status(h.deps, {
      session: session.localId,
      reconcile: true,
    });
    expect(result.reconciled).toEqual([
      expect.objectContaining({
        localRequestId: 'approve-1',
        kind: 'approve',
        outcome: 'bound',
      }),
    ]);
  });

  it('a planApproved that may belong to a settled approval of the same plan is not bound to an unknown-outcome one', async () => {
    const session = await delegateOk(h, grantId);
    addPlan(h, session.sessionResource, 'plan-1');
    await status(h.deps, { session: session.localId, reconcile: false });
    const digest = await reviewedDigestOf(h, session.localRequestId);
    const call = (requestId: string) =>
      approve(h.deps, {
        session: session.localId,
        planId: 'plan-1',
        expectPlanDigest: digest,
        dryRun: false,
        grantId,
        requestId,
      });
    await call('approve-a');
    expect((await readJournal(h.dataDir)).operations['approve-a']?.status).toBe(
      'accepted'
    );
    h.deps.clock.time += 1_000;
    h.adapter.approvePlanImpl = async () => {
      throw new AdapterError('network', 'reset', { dispatched: true });
    };
    await expect(call('approve-b')).rejects.toBeInstanceOf(AppErrorException);
    h.deps.clock.time += 1_000;
    // One planApproved: it may belong entirely to the first approval.
    addActivity(h, session.sessionResource, {
      type: 'planApproved',
      approvedPlanId: 'plan-1',
    });
    const result = await status(h.deps, {
      session: session.localId,
      reconcile: true,
    });
    expect(
      result.reconciled?.find((r) => r.localRequestId === 'approve-b')
    ).toMatchObject({ outcome: 'ambiguous-reconcile' });
    expect((await readJournal(h.dataDir)).operations['approve-b']?.status).toBe(
      'unknown-outcome'
    );
  });

  it('--session narrows the reconcile to that session', async () => {
    const a = await strandedReply('for a', 'reply-a');
    addActivity(h, a.sessionResource, {
      type: 'userMessaged',
      message: 'for a',
    });
    await lostResponse('scratch/z', 'lost-z', false);
    const result = await status(h.deps, {
      session: a.localId,
      reconcile: true,
    });
    expect(result.reconciled?.map((r) => r.localRequestId)).toEqual([
      'reply-a',
    ]);
    expect((await readJournal(h.dataDir)).operations['lost-z']?.status).toBe(
      'unknown-outcome'
    );
  });
});

describe('active-session slots follow the vendor state', () => {
  it('observing a terminal vendor state frees the slot; tasks stay spent', async () => {
    const session = await delegateOk(h, grantId);
    expect(
      loadGrants(h.dataDir).grants[grantId]?.usage.activeSessionRefs
    ).toHaveLength(1);

    await status(h.deps, { session: session.localId, reconcile: false });
    expect(
      loadGrants(h.dataDir).grants[grantId]?.usage.activeSessionRefs
    ).toHaveLength(1);

    setVendorState(h, session.sessionResource, 'completed');
    await status(h.deps, { session: session.localId, reconcile: false });
    const usage = loadGrants(h.dataDir).grants[grantId]?.usage;
    expect(usage?.activeSessionRefs).toEqual([]);
    expect(usage?.totalTasks).toBe(1);
  });

  it('a host without the controller authority leaves the slot held and status still succeeds', async () => {
    const session = await delegateOk(h, grantId);
    setVendorState(h, session.sessionResource, 'completed');
    fs.rmSync(controllerFilePath(h.controllerDir, 'testhost'));
    const before = fs.readFileSync(resolveGrantsPath(h.dataDir), 'utf8');
    const result = await status(h.deps, {
      session: session.localId,
      reconcile: false,
    });
    expect(result.attention).toContain('slotReleaseSkipped');
    expect(fs.readFileSync(resolveGrantsPath(h.dataDir), 'utf8')).toBe(before);
    expect(
      loadGrants(h.dataDir).grants[grantId]?.usage.activeSessionRefs
    ).toHaveLength(1);
  });

  it('the reconcile release path skips the slot on a host without controller authority', async () => {
    await lostResponse('scratch/done', 'lost-done');
    const [listed] = [...h.adapter.sessions.values()];
    setVendorState(h, listed!.sessionResource, 'completed');
    fs.rmSync(controllerFilePath(h.controllerDir, 'testhost'));
    const result = await status(h.deps, { reconcile: true });
    expect(result.reconciled?.[0]).toMatchObject({
      localRequestId: 'lost-done',
      outcome: 'bound',
      slotReleaseSkipped: true,
    });
    expect(
      loadGrants(h.dataDir).grants[grantId]?.usage.activeSessionRefs
    ).toHaveLength(1);
  });

  it('a failed session frees its slot too, and repeating the observation is harmless', async () => {
    const session = await delegateOk(h, grantId);
    setVendorState(h, session.sessionResource, 'failed');
    await status(h.deps, { session: session.localId, reconcile: false });
    await status(h.deps, { session: session.localId, reconcile: false });
    expect(
      loadGrants(h.dataDir).grants[grantId]?.usage.activeSessionRefs
    ).toEqual([]);
  });
});
