import * as fs from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveJournalPath } from '../src/config.js';
import { controllerFilePath } from '../src/controller.js';
import {
  AdapterError,
  AppErrorException,
  MutationErrorException,
} from '../src/errors.js';
import { delegate, reply } from '../src/mutations.js';
import { status } from '../src/runtime.js';
import {
  claimOwnEchoes,
  ensureObservedRecord,
  hasUnreconciledDeviation,
  markOperation,
  messageDigest,
  readJournal,
  reserveOperation,
  takeSeq,
  updateJournal,
  updateSupervision,
} from '../src/state.js';
import { clearPause, superviseOnce } from '../src/supervise.js';
import {
  assertGrantLiveBeforeWrite,
  reserveUnderGrant,
  settleAccepted,
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
  setVendorState,
} from './support/grants.js';

const PROMPT = 'Implement the change described in the task.';

let h: GrantHarness;
let grantId: string;
let session: DelegatedSession;

beforeEach(async () => {
  h = makeHarness('correct');
  grantId = await createGrant(h, { maxActiveSessions: 3, maxTotalTasks: 10 });
  session = await delegateOk(h, grantId, { prompt: PROMPT });
  setVendorState(h, session.sessionResource, 'inProgress');
});
afterEach(() => {
  h.cleanup();
});

const sup = () => superviseOnce(h.deps, { session: session.localId, grantId });

async function owner() {
  return (await readJournal(h.dataDir)).operations[session.localRequestId];
}

/** A grant-backed reply that lands: reserve, dispatch stamp, accept. Nothing advances the clock. */
async function landReply(localRequestId: string, text: string): Promise<void> {
  const reservation = await reserveUnderGrant(h.deps, {
    grantId,
    ownerRequestId: session.localRequestId,
    authority: {
      repository: 'acme/widgets',
      sourceResource: 'sources/github/acme/widgets',
      branch: 'scratch/one',
      taskRef: 't1',
      operation: 'reply',
      correction: true,
    },
    reservation: {
      localRequestId,
      localId: `jl-${Buffer.from(localRequestId).toString('hex').padEnd(32, '0').slice(0, 32)}`,
      sessionResource: session.sessionResource,
      promptDigest: messageDigest(text),
    },
  });
  await assertGrantLiveBeforeWrite(h.deps, reservation, 'reconcile', 'empty');
  await settleAccepted(h.deps, reservation);
}

/** A grant-backed reply whose POST began but whose outcome is not proven. */
async function dispatchReply(
  localRequestId: string,
  text: string,
  finalStatus: 'reserved' | 'unknown-outcome'
): Promise<void> {
  const reservation = await reserveUnderGrant(h.deps, {
    grantId,
    ownerRequestId: session.localRequestId,
    authority: {
      repository: 'acme/widgets',
      sourceResource: 'sources/github/acme/widgets',
      branch: 'scratch/one',
      taskRef: 't1',
      operation: 'reply',
      correction: true,
    },
    reservation: {
      localRequestId,
      localId: `jl-${Buffer.from(localRequestId).toString('hex').padEnd(32, '0').slice(0, 32)}`,
      sessionResource: session.sessionResource,
      promptDigest: messageDigest(text),
    },
  });
  await assertGrantLiveBeforeWrite(h.deps, reservation, 'reconcile', 'empty');
  if (finalStatus === 'unknown-outcome') {
    await markOperation(h.dataDir, localRequestId, 'unknown-outcome');
  }
}

describe('journal sequence', () => {
  it('stamps create and dispatch strictly in order, even on a frozen clock', async () => {
    await landReply('rep1', 'first');
    await landReply('rep2', 'second');
    const ops = (await readJournal(h.dataDir)).operations;
    const [create, r1, r2] = [
      ops[session.localRequestId]!,
      ops['rep1']!,
      ops['rep2']!,
    ];
    expect(r1.createdAt).toBe(r2.createdAt);
    const order = [
      create.createSeq,
      create.dispatchSeq,
      r1.createSeq,
      r1.dispatchSeq,
      r2.createSeq,
      r2.dispatchSeq,
    ];
    expect(order.every((n) => typeof n === 'number')).toBe(true);
    expect([...order].sort((a, b) => (a as number) - (b as number))).toEqual(
      order
    );
    expect(new Set(order).size).toBe(order.length);
  });

  it('takeSeq hands out strictly increasing values', async () => {
    const a = await takeSeq(h.dataDir);
    const b = await takeSeq(h.dataDir);
    expect(b).toBeGreaterThan(a);
  });

  it('a journal written before sequences still loads and then orders new events', async () => {
    const file = resolveJournalPath(h.dataDir);
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<
      string,
      unknown
    >;
    delete raw['seq'];
    for (const record of Object.values(
      raw['operations'] as Record<string, Record<string, unknown>>
    )) {
      delete record['createSeq'];
      delete record['dispatchSeq'];
    }
    fs.writeFileSync(file, JSON.stringify(raw), { mode: 0o600 });
    const legacy = await owner();
    expect(legacy?.createSeq).toBeUndefined();
    expect(await takeSeq(h.dataDir)).toBe(1);
  });
});

describe('supervise: a reply "since the evaluation" must be proven to follow it', () => {
  // No clock advance between the evaluation and the reply: their ISO stamps tie.
  beforeEach(() => {
    h.deps.clock.time += 1;
    addActivity(h, session.sessionResource, {
      type: 'userMessaged',
      message: PROMPT,
      originator: 'user',
    });
  });

  it('a reply dispatched after the evaluation, same millisecond, explains a plan change', async () => {
    addPlan(h, session.sessionResource, 'plan-1');
    expect((await sup()).decision).toBe('needs-plan-review');
    await landReply('rep-after', 'please restructure the plan');
    h.deps.clock.time += 1_000;
    // The reply's echo (vendor clock) precedes the replacement plan.
    addActivity(h, session.sessionResource, {
      type: 'userMessaged',
      message: 'please restructure the plan',
      originator: 'user',
    });
    h.deps.clock.time += 1_000;
    addPlanNow(h, session.sessionResource, 'plan-2');
    const result = await sup();
    expect(result.decision).toBe('needs-plan-review');
    expect(result.reason).not.toBe('plan-changed-after-evaluation');
  });

  it.each(['reserved', 'unknown-outcome'] as const)(
    'a dispatched reply left %s (landing unproven) does not hide a plan swap',
    async (finalStatus) => {
      addPlan(h, session.sessionResource, 'plan-1');
      expect((await sup()).decision).toBe('needs-plan-review');
      await dispatchReply(
        'rep-unproven',
        'please restructure the plan',
        finalStatus
      );
      h.deps.clock.time += 1_000;
      addPlanNow(h, session.sessionResource, 'plan-2');
      expect(await sup()).toMatchObject({
        decision: 'paused',
        reason: 'plan-changed-after-evaluation',
      });
    }
  );

  it('an unknown-outcome reply whose echo was claimed is landing evidence and explains a plan change', async () => {
    addPlan(h, session.sessionResource, 'plan-1');
    expect((await sup()).decision).toBe('needs-plan-review');
    await dispatchReply(
      'rep-echoed',
      'please restructure the plan',
      'unknown-outcome'
    );
    await updateJournal(h.dataDir, (operations) => {
      operations['rep-echoed'] = {
        ...operations['rep-echoed']!,
        echoActivityId: 'act-echo',
        echoCreateTime: new Date(h.deps.clock.now()).toISOString(),
      };
    });
    h.deps.clock.time += 1_000;
    addPlanNow(h, session.sessionResource, 'plan-2');
    const result = await sup();
    expect(result.decision).toBe('needs-plan-review');
    expect(result.reason).not.toBe('plan-changed-after-evaluation');
  });

  it('two unknown-outcome replies with one matching message: neither is credited, so a swap still pauses', async () => {
    addPlan(h, session.sessionResource, 'plan-1');
    expect((await sup()).decision).toBe('needs-plan-review');
    await dispatchReply(
      'rep-x',
      'please restructure the plan',
      'unknown-outcome'
    );
    await dispatchReply(
      'rep-y',
      'please restructure the plan',
      'unknown-outcome'
    );
    h.deps.clock.time += 1_000;
    addActivity(h, session.sessionResource, {
      type: 'userMessaged',
      message: 'please restructure the plan',
      originator: 'user',
    });
    await status(h.deps, { session: session.localId, reconcile: false });
    const ops = (await readJournal(h.dataDir)).operations;
    expect(ops['rep-x']?.echoActivityId).toBeUndefined();
    expect(ops['rep-y']?.echoActivityId).toBeUndefined();
    h.deps.clock.time += 1_000;
    addPlanNow(h, session.sessionResource, 'plan-2');
    expect(await sup()).toMatchObject({
      decision: 'paused',
      reason: 'plan-changed-after-evaluation',
    });
  });

  it('a reply dispatched before the evaluation, same millisecond, does not hide a plan swap', async () => {
    addPlan(h, session.sessionResource, 'plan-1');
    await landReply('rep-before', 'please restructure the plan');
    expect((await sup()).decision).toBe('needs-plan-review');
    h.deps.clock.time += 1_000;
    addPlanNow(h, session.sessionResource, 'plan-2');
    expect(await sup()).toMatchObject({
      decision: 'paused',
      reason: 'plan-changed-after-evaluation',
    });
  });

  it('an evaluation stored without a sequence cannot prove any reply followed it', async () => {
    addPlan(h, session.sessionResource, 'plan-1');
    expect((await sup()).decision).toBe('needs-plan-review');
    await landReply('rep-legacy', 'please restructure the plan');
    await updateJournal(h.dataDir, (operations) => {
      const record = operations[session.localRequestId]!;
      const { evaluatedSeq: _drop, ...evaluatedPlan } =
        record.supervision!.evaluatedPlan!;
      operations[session.localRequestId] = {
        ...record,
        supervision: { ...record.supervision, evaluatedPlan },
      };
    });
    h.deps.clock.time += 1_000;
    addPlanNow(h, session.sessionResource, 'plan-2');
    expect(await sup()).toMatchObject({
      decision: 'paused',
      reason: 'plan-changed-after-evaluation',
    });
  });

  it('a reply from before sequences cannot suppress the pause', async () => {
    addPlan(h, session.sessionResource, 'plan-1');
    expect((await sup()).decision).toBe('needs-plan-review');
    await landReply('rep-old', 'please restructure the plan');
    await updateJournal(h.dataDir, (operations) => {
      const {
        createSeq: _c,
        dispatchSeq: _d,
        ...rest
      } = operations['rep-old']!;
      operations['rep-old'] = rest;
    });
    h.deps.clock.time += 1_000;
    addPlanNow(h, session.sessionResource, 'plan-2');
    expect(await sup()).toMatchObject({
      decision: 'paused',
      reason: 'plan-changed-after-evaluation',
    });
  });
});

describe('evaluated-plan pass ordering by sequence', () => {
  const at = '2026-09-29T12:00:00.000Z';
  const plan = (planId: string) => ({ planId, evaluatedAt: at });

  it('the later pass wins when both start in the same millisecond', async () => {
    await updateSupervision(h.dataDir, session.localRequestId, {
      evaluatedPlan: plan('plan-P'),
      passStartedAt: at,
      passSeq: 10,
    });
    // An earlier pass (lower sequence) finishing last neither replaces nor clears.
    await updateSupervision(h.dataDir, session.localRequestId, {
      evaluatedPlan: null,
      passStartedAt: at,
      passSeq: 9,
    });
    expect((await owner())?.supervision?.evaluatedPlan?.planId).toBe('plan-P');
    // A later pass sharing the millisecond still replaces and clears.
    await updateSupervision(h.dataDir, session.localRequestId, {
      evaluatedPlan: plan('plan-Q'),
      passStartedAt: at,
      passSeq: 11,
    });
    expect((await owner())?.supervision?.evaluatedPlan?.planId).toBe('plan-Q');
    await updateSupervision(h.dataDir, session.localRequestId, {
      evaluatedPlan: null,
      passStartedAt: at,
      passSeq: 12,
    });
    expect((await owner())?.supervision?.evaluatedPlan).toBeUndefined();
  });

  it('a stored pass without a sequence falls back to the timestamp, where a tie keeps the stored plan', async () => {
    await updateSupervision(h.dataDir, session.localRequestId, {
      evaluatedPlan: plan('plan-P'),
      passStartedAt: at,
    });
    await updateSupervision(h.dataDir, session.localRequestId, {
      evaluatedPlan: null,
      passStartedAt: at,
      passSeq: 99,
    });
    expect((await owner())?.supervision?.evaluatedPlan?.planId).toBe('plan-P');
  });
});

describe('own-echo claims order writes by sequence', () => {
  const text = 'a follow-up';
  const digest = messageDigest(text);
  const message = { activityId: 'activities/m1', digest };

  it('a write sequenced before the walk claims, even with identical timestamps', async () => {
    await landReply('rep-a', text);
    const walkSeq = await takeSeq(h.dataDir);
    const pending: string[] = [];
    const claimed = await claimOwnEchoes(
      h.dataDir,
      session.sessionResource,
      [message],
      {
        ownerRequestId: session.localRequestId,
        observedAt: new Date(h.deps.clock.now()).toISOString(),
        walkStartedAt: new Date(h.deps.clock.now()).toISOString(),
        walkSeq,
      },
      pending
    );
    expect(claimed).toBeUndefined();
    expect(pending).toEqual([]);
    const ops = (await readJournal(h.dataDir)).operations;
    expect(ops['rep-a']?.echoActivityId).toBe('activities/m1');
  });

  it('a write sequenced after the walk started cannot claim, even with identical timestamps', async () => {
    const walkSeq = await takeSeq(h.dataDir);
    await landReply('rep-b', text);
    const pending: string[] = [];
    await claimOwnEchoes(
      h.dataDir,
      session.sessionResource,
      [message],
      {
        ownerRequestId: session.localRequestId,
        observedAt: new Date(h.deps.clock.now()).toISOString(),
        walkStartedAt: new Date(h.deps.clock.now()).toISOString(),
        walkSeq,
      },
      pending
    );
    expect(pending).toEqual(['activities/m1']);
    const ops = (await readJournal(h.dataDir)).operations;
    expect(ops['rep-b']?.echoActivityId).toBeUndefined();
  });

  async function seedHeld(firstReadSeq: number): Promise<void> {
    const at = new Date(h.deps.clock.now()).toISOString();
    await updateJournal(h.dataDir, (operations) => {
      const record = operations[session.localRequestId]!;
      operations[session.localRequestId] = {
        ...record,
        supervision: {
          ...record.supervision,
          heldActivities: { 'activities/m1': at },
          heldSeqs: { 'activities/m1': firstReadSeq },
        },
      };
    });
  }

  async function laterWalk(): Promise<string[]> {
    const walkSeq = await takeSeq(h.dataDir);
    const pending: string[] = [];
    const iso = new Date(h.deps.clock.now()).toISOString();
    await claimOwnEchoes(
      h.dataDir,
      session.sessionResource,
      [message],
      {
        ownerRequestId: session.localRequestId,
        observedAt: iso,
        walkStartedAt: iso,
        walkSeq,
      },
      pending
    );
    return pending;
  }

  it('a write made before the message was first read can be its echo (same millisecond)', async () => {
    await landReply('rep-c', text);
    await seedHeld(await takeSeq(h.dataDir));
    await laterWalk();
    const ops = (await readJournal(h.dataDir)).operations;
    expect(ops['rep-c']?.echoActivityId).toBe('activities/m1');
  });

  it('a write made after the message was first read cannot be its echo (same millisecond)', async () => {
    await seedHeld(await takeSeq(h.dataDir));
    await landReply('rep-d', text);
    await laterWalk();
    const ops = (await readJournal(h.dataDir)).operations;
    expect(ops['rep-d']?.echoActivityId).toBeUndefined();
    expect((await owner())?.supervision?.outsideSeen?.activityId).toBe(
      'activities/m1'
    );
  });

  it('a hold written without a sequence treats a same-millisecond write as after the first read', async () => {
    await landReply('rep-e', text);
    await updateJournal(h.dataDir, (operations) => {
      const record = operations[session.localRequestId]!;
      operations[session.localRequestId] = {
        ...record,
        supervision: {
          heldActivities: {
            'activities/m1': new Date(h.deps.clock.now()).toISOString(),
          },
        },
      };
    });
    await laterWalk();
    const ops = (await readJournal(h.dataDir)).operations;
    expect(ops['rep-e']?.echoActivityId).toBeUndefined();
  });
});

describe('clear-pause orders the walk against the pause by sequence', () => {
  const at = '2026-09-29T12:00:00.000Z';

  async function seed(
    pauseSeq: number | undefined,
    walkSeq: number | undefined
  ) {
    await updateJournal(h.dataDir, (operations) => {
      const record = operations[session.localRequestId]!;
      operations[session.localRequestId] = {
        ...record,
        lastCompleteWalkAt: at,
        ...(walkSeq !== undefined ? { lastCompleteWalkSeq: walkSeq } : {}),
        supervision: {
          paused: {
            reason: 'partial-walk',
            observedAt: at,
            ...(pauseSeq !== undefined ? { observedSeq: pauseSeq } : {}),
          },
        },
      };
    });
  }

  it('accepts a walk that began after the pause when both share a millisecond', async () => {
    await seed(5, 6);
    await expect(
      clearPause(h.deps, { session: session.localId })
    ).resolves.toMatchObject({ cleared: true });
  });

  it.each(['missing', 'stale-epoch'] as const)(
    "refuses to clear a pause without this host's controller authority (%s)",
    async (mode) => {
      await seed(5, 6);
      const file = controllerFilePath(h.controllerDir, 'testhost');
      if (mode === 'missing') {
        fs.rmSync(file);
      } else {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as {
          epoch: number;
        };
        fs.writeFileSync(
          file,
          JSON.stringify({ ...raw, epoch: raw.epoch + 1 })
        );
      }
      const err = (await clearPause(h.deps, {
        session: session.localId,
      }).catch((e: unknown) => e)) as AppErrorException;
      expect(err.appError.code).toBe('JULES_CONTROLLER_MISMATCH');
      expect((await owner())?.supervision?.paused).toBeDefined();
    }
  );

  it('refuses a walk that began before the pause when both share a millisecond', async () => {
    await seed(6, 5);
    const err = (await clearPause(h.deps, { session: session.localId }).catch(
      (e: unknown) => e
    )) as AppErrorException;
    expect(err.appError.code).toBe('JULES_INVALID_STATE');
    expect((await owner())?.supervision?.paused).toBeDefined();
  });

  it('refuses a walk stamped before sequences for a pause that has one', async () => {
    await seed(6, undefined);
    const err = (await clearPause(h.deps, { session: session.localId }).catch(
      (e: unknown) => e
    )) as AppErrorException;
    expect(err.appError.code).toBe('JULES_INVALID_STATE');
  });

  it('a pause from before sequences still clears on a strictly later walk', async () => {
    await seed(undefined, 6);
    await updateJournal(h.dataDir, (operations) => {
      const record = operations[session.localRequestId]!;
      operations[session.localRequestId] = {
        ...record,
        lastCompleteWalkAt: '2026-09-29T12:00:01.000Z',
      };
    });
    await expect(
      clearPause(h.deps, { session: session.localId })
    ).resolves.toMatchObject({ cleared: true });
  });

  it('a status walk records its own sequence', async () => {
    await status(h.deps, { session: session.localId, reconcile: false });
    expect((await owner())?.lastCompleteWalkSeq).toBeGreaterThan(0);
  });
});

describe('binding a create to a session an observe row already owns', () => {
  const badPr = {
    type: 'pullRequest' as const,
    url: 'https://github.com/evil/other/pull/9',
    title: 'PR',
    description: 'd',
  };

  /** The vendor made the session but the create's response was lost; a raw-resource status then observed it. */
  async function lostThenObserved(): Promise<{
    sessionResource: string;
    observedLocalId: string;
  }> {
    const before = new Set(h.adapter.sessions.keys());
    h.adapter.createSessionImpl = async (input) => {
      await h.adapter.defaultCreateSessionImpl(input);
      throw new AdapterError('network', 'connection reset', {
        dispatched: true,
      });
    };
    await delegate(h.deps, {
      repo: 'acme/widgets',
      branch: 'scratch/lost',
      prompt: 'do it',
      taskRef: 't1',
      dryRun: false,
      correction: false,
      grantId,
      requestId: 'lost-1',
    }).catch(() => undefined);
    h.adapter.restoreWrites();
    const sessionResource = [...h.adapter.sessions.keys()].find(
      (k) => !before.has(k)
    ) as string;
    const vendor = h.adapter.sessions.get(sessionResource)!;
    h.adapter.sessions.set(sessionResource, { ...vendor, outputs: [badPr] });
    const observed = await status(h.deps, {
      session: sessionResource,
      reconcile: false,
    });
    return { sessionResource, observedLocalId: observed.localId as string };
  }

  it('folds the observed deviation into the create and retires the observe row', async () => {
    const { sessionResource, observedLocalId } = await lostThenObserved();
    const observed = (await readJournal(h.dataDir)).operations;
    const observeRow = Object.values(observed).find(
      (r) => r.kind === 'observe' && r.sessionResource === sessionResource
    );
    expect(observeRow?.localId).toBe(observedLocalId);
    expect(observeRow?.deviations.length).toBeGreaterThan(0);

    const result = await status(h.deps, { reconcile: true });
    expect(result.reconciled).toEqual([
      expect.objectContaining({ localRequestId: 'lost-1', outcome: 'bound' }),
    ]);
    const ops = (await readJournal(h.dataDir)).operations;
    const create = ops['lost-1']!;
    expect(create.status).toBe('accepted');
    expect(hasUnreconciledDeviation(create)).toBe(true);
    // One owner: the observe row is gone.
    expect(
      Object.values(ops).filter(
        (r) => r.kind !== 'reply' && r.sessionResource === sessionResource
      )
    ).toHaveLength(1);

    // The write gate sees the deviation on the (only) owner.
    const err = await reply(h.deps, {
      session: sessionResource,
      message: 'carry on',
      dryRun: false,
      correction: false,
      grantId,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MutationErrorException);
    expect((err as MutationErrorException).appError.code).toBe(
      'JULES_POLICY_DEVIATION'
    );
  });

  it('takes the more restrictive supervision marker and keeps an unreconciled deviation', async () => {
    const { sessionResource } = await lostThenObserved();
    await updateJournal(h.dataDir, (operations) => {
      const row = Object.values(operations).find(
        (r) => r.kind === 'observe' && r.sessionResource === sessionResource
      )!;
      operations[row.localRequestId] = {
        ...row,
        supervision: {
          paused: {
            reason: 'partial-walk',
            observedAt: '2026-09-29T12:00:00.000Z',
          },
        },
        deviations: row.deviations.map((d) => ({ ...d, reconciled: true })),
      };
      const create = operations['lost-1']!;
      operations['lost-1'] = {
        ...create,
        deviations: row.deviations.map((d) => ({ ...d, reconciled: false })),
      };
    });
    await status(h.deps, { reconcile: true });
    const create = (await readJournal(h.dataDir)).operations['lost-1']!;
    expect(create.supervision?.paused?.reason).toBe('partial-walk');
    expect(create.deviations).toHaveLength(1);
    expect(create.deviations[0]?.reconciled).toBe(false);
  });

  it('does not carry the observed read cursors onto the create', async () => {
    const { sessionResource } = await lostThenObserved();
    await updateJournal(h.dataDir, (operations) => {
      const row = Object.values(operations).find(
        (r) => r.kind === 'observe' && r.sessionResource === sessionResource
      )!;
      operations[row.localRequestId] = {
        ...row,
        lastActivityId: 'act-far',
        lastActivityCreateTime: '2030-01-01T00:00:00.000Z',
        lastCompleteWalkAt: '2030-01-01T00:00:00.000Z',
        recentActivityIds: ['act-far'],
      };
    });
    await status(h.deps, { reconcile: true });
    const create = (await readJournal(h.dataDir)).operations['lost-1']!;
    expect(create.lastActivityId).toBeUndefined();
    expect(create.lastCompleteWalkAt).toBeUndefined();
    expect(create.recentActivityIds).toEqual([]);
  });

  it('leaves the create unresolved when another create already owns the session', async () => {
    const { sessionResource } = await lostThenObserved();
    // Replace the observe row by a second create that owns the session.
    await updateJournal(h.dataDir, (operations) => {
      for (const r of Object.values(operations)) {
        if (r.kind === 'observe') delete operations[r.localRequestId];
      }
    });
    await reserveOperation(h.dataDir, {
      localRequestId: 'other-create',
      kind: 'create',
      repository: 'acme/widgets',
      requestedBranch: 'scratch/other',
      sourceResource: 'sources/github/acme/widgets',
    });
    await markOperation(h.dataDir, 'other-create', 'accepted', {
      sessionResource,
    });
    const result = await status(h.deps, { reconcile: true });
    expect(result.reconciled).toEqual([
      expect.objectContaining({
        localRequestId: 'lost-1',
        outcome: 'ambiguous-reconcile',
        reason: 'session-already-owned',
      }),
    ]);
    const lost = (await readJournal(h.dataDir)).operations['lost-1']!;
    expect(lost.sessionResource).toBeUndefined();
    expect(lost.status).not.toBe('accepted');
  });

  it('markOperation folds an observe owner when it binds a create to the session', async () => {
    const sessionResource = 'sessions/pre-observed';
    const observed = await ensureObservedRecord(h.dataDir, sessionResource);
    await updateJournal(h.dataDir, (operations) => {
      operations[observed.localRequestId] = {
        ...observed,
        deviations: [
          {
            kind: 'policy-deviation',
            reason: 'pull request URL failed validation',
            observedAt: '2026-09-29T12:00:00.000Z',
            reconciled: false,
          },
        ],
      };
    });
    await reserveOperation(h.dataDir, {
      localRequestId: 'bind-me',
      kind: 'create',
      repository: 'acme/widgets',
      requestedBranch: 'scratch/bind',
      sourceResource: 'sources/github/acme/widgets',
    });
    const bound = await markOperation(h.dataDir, 'bind-me', 'accepted', {
      sessionResource,
    });
    expect(bound.deviations).toHaveLength(1);
    const ops = (await readJournal(h.dataDir)).operations;
    expect(ops[observed.localRequestId]).toBeUndefined();
  });
});
