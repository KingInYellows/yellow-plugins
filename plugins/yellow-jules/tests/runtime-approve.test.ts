import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadGrants } from '../src/authority.js';
import {
  AdapterError,
  MutationErrorException,
  type AppErrorCode,
} from '../src/errors.js';
import { approve, delegate, type ApproveArgs } from '../src/mutations.js';
import { status } from '../src/runtime.js';
import { planDigest, readJournal, updateSupervision } from '../src/state.js';

import {
  addActivity,
  addPlan,
  addPlanNow,
  createGrant,
  delegateOk,
  reviewedDigestOf,
  type DelegatedSession,
  type GrantHarness,
  makeHarness,
  revokeAfterReservation,
  setVendorState,
} from './support/grants.js';

let h: GrantHarness;
let grantId: string;
let session: DelegatedSession;
let reviewedDigest: string;

beforeEach(async () => {
  h = makeHarness('correct');
  grantId = await createGrant(h, { maxActiveSessions: 3 });
  session = await delegateOk(h, grantId);
  addPlan(h, session.sessionResource, 'plan-1');
  // `status` is the only writer of the pending plan the approval compares against.
  await status(h.deps, { session: session.localId, reconcile: false });
  const plan = (await readJournal(h.dataDir)).operations[session.localRequestId]
    ?.pendingPlan;
  reviewedDigest = planDigest(plan!.planId, plan!.steps);
  h.adapter.calls.length = 0;
});
afterEach(() => {
  h.cleanup();
});

describe('a plan with hidden characters', () => {
  it('is refused by approve even with a matching digest', async () => {
    addActivity(h, session.sessionResource, {
      type: 'planGenerated',
      plan: {
        planId: 'plan-h',
        steps: [{ id: 'st-h', title: 'Do\u200b it', index: 0 }],
      },
    });
    setVendorState(h, session.sessionResource, 'awaitingPlanApproval');
    await status(h.deps, { session: session.localId, reconcile: false });
    const digest = await reviewedDigestOf(h, session.localRequestId);
    expect(
      await codeOf(() =>
        approve(h.deps, args({ planId: 'plan-h', expectPlanDigest: digest }))
      )
    ).toBe('JULES_INVALID_STATE');
    expect(h.adapter.writeCount()).toBe(0);
  });
});

/** Adds a teammate's message at the first activity read after the write was reserved. */
function teammateAfterReserve(kind: 'reply' | 'approve', text: string): void {
  const base = h.adapter.listActivitiesImpl;
  let injected = false;
  h.adapter.listActivitiesImpl = async (resource, options) => {
    if (!injected) {
      const reserved = Object.values(
        (await readJournal(h.dataDir)).operations
      ).some((r) => r.kind === kind && r.status === 'reserved');
      if (reserved) {
        injected = true;
        addActivity(h, session.sessionResource, {
          type: 'userMessaged',
          message: text,
        });
      }
    }
    return base(resource, options);
  };
}

function args(overrides: Partial<ApproveArgs> = {}): ApproveArgs {
  return {
    session: session.localId,
    planId: 'plan-1',
    expectPlanDigest: reviewedDigest,
    dryRun: false,
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

/** The vendor records a `planApproved` for `planId` when the POST lands. */
function approvalLands(planId: string): void {
  h.adapter.approvePlanImpl = async (sessionResource) => {
    addActivity(h, sessionResource, {
      type: 'planApproved',
      approvedPlanId: planId,
    });
  };
}

describe('a teammate message between the reserve and the floor read', () => {
  it('refuses the approve, records outside activity, and sends nothing', async () => {
    teammateAfterReserve('approve', 'hold on, do not approve this');
    const err = await fails(() => approve(h.deps, args()));
    expect(err.appError.code).toBe('JULES_SUPERVISION_PAUSED');
    expect(h.adapter.callsTo('approvePlan')).toHaveLength(0);
    const ops = (await readJournal(h.dataDir)).operations;
    expect(ops[session.localRequestId]?.supervision?.outsideSeen).toBeDefined();
    expect(ops[err.localRequestId as string]?.dispatchedAt).toBeUndefined();
  });
});

describe('approve --dry-run (the R34 re-fetch)', () => {
  it('returns the plan id a confirmation binds to and sends nothing', async () => {
    const result = await approve(
      h.deps,
      args({ dryRun: true, grantId: undefined })
    );
    expect(result).toMatchObject({
      operation: 'approve',
      dryRun: true,
      observedPlanId: 'plan-1',
      sessionResource: session.sessionResource,
      repository: 'acme/widgets',
      requestedBranch: 'scratch/one',
      taskRef: 't1',
    });
    expect(result).not.toHaveProperty('approvedPlanId');
    expect(result).not.toHaveProperty('verificationDeferred');
    expect(h.adapter.callsTo('getSession')).toHaveLength(1);
    expect(h.adapter.callsTo('listActivities').length).toBeGreaterThan(0);
    expect(h.adapter.writeCount()).toBe(0);
  });

  it('flags a changed plan instead of failing, so the wrapper can stop', async () => {
    addPlan(h, session.sessionResource, 'plan-2');
    const result = await approve(h.deps, args({ dryRun: true }));
    expect(result).toMatchObject({
      observedPlanId: 'plan-2',
      requiresAttention: true,
      attention: ['planChanged'],
    });
  });

  it('a session not awaiting approval is JULES_INVALID_STATE', async () => {
    setVendorState(h, session.sessionResource, 'inProgress');
    expect(await codeOf(() => approve(h.deps, args({ dryRun: true })))).toBe(
      'JULES_INVALID_STATE'
    );
  });

  it('no pending plan in the journal is JULES_INVALID_STATE with the run-status recovery', async () => {
    const fresh = await delegateOk(h, grantId, { branch: 'scratch/two' });
    const err = await fails(() =>
      approve(h.deps, args({ session: fresh.localId, dryRun: true }))
    );
    expect(err.appError.code).toBe('JULES_INVALID_STATE');
    expect(err.appError.recoveryAction).toContain('status');
  });
});

describe('approve without authority', () => {
  it('no grant -> JULES_CONFIRMATION_REQUIRED naming the approve command; nothing sent', async () => {
    const err = await fails(() =>
      approve(h.deps, args({ grantId: undefined }))
    );
    expect(err.appError.code).toBe('JULES_CONFIRMATION_REQUIRED');
    expect(err.appError.recoveryAction).toContain("--operations 'approve'");
    expect(h.adapter.calls).toEqual([]);
  });

  it('a grant without approve', async () => {
    const other = await createGrant(h, { operations: 'create,reply' });
    expect(await codeOf(() => approve(h.deps, args({ grantId: other })))).toBe(
      'JULES_AUTHORITY_DENIED'
    );
    expect(h.adapter.writeCount()).toBe(0);
  });

  it('an expired grant', async () => {
    h.deps.clock.time += 3 * 60 * 60_000;
    expect(await codeOf(() => approve(h.deps, args()))).toBe(
      'JULES_GRANT_EXPIRED'
    );
    expect(h.adapter.writeCount()).toBe(0);
  });
});

describe('an approval against the evaluated plan', () => {
  it('approves once and confirms the plan the vendor recorded', async () => {
    approvalLands('plan-1');
    const result = await approve(h.deps, args());
    expect(result).toMatchObject({
      operation: 'approve',
      approvedPlanId: 'plan-1',
      observedPlanIdAfter: 'plan-1',
      verificationDeferred: false,
      verification: { partialPagination: false },
    });
    expect(result).not.toHaveProperty('policyDeviation');
    expect(h.adapter.callsTo('approvePlan')).toHaveLength(1);
    const record = (await readJournal(h.dataDir)).operations[
      result.localRequestId
    ];
    expect(record).toMatchObject({
      kind: 'approve',
      status: 'accepted',
      observedPlanId: 'plan-1',
      grantId,
    });
  });

  it('spends no slot, task, or round', async () => {
    approvalLands('plan-1');
    const before = loadGrants(h.dataDir).grants[grantId]?.usage;
    await approve(h.deps, args());
    expect(loadGrants(h.dataDir).grants[grantId]?.usage).toEqual(before);
  });
});

describe('stale plan observations', () => {
  it('a newer plan appeared since --plan-id was evaluated: JULES_POLICY_DEVIATION, no POST', async () => {
    addPlan(h, session.sessionResource, 'plan-2');
    const err = await fails(() => approve(h.deps, args()));
    expect(err.appError.code).toBe('JULES_POLICY_DEVIATION');
    expect(err.appError.recoveryAction).toContain('status');
    expect(h.adapter.writeCount()).toBe(0);
  });

  it('a user message after the reviewed plan that is not our echo refuses the approval', async () => {
    h.deps.clock.time += 1_000;
    addActivity(h, session.sessionResource, {
      type: 'userMessaged',
      message: 'Actually, drop the migration step.',
    });
    const err = await fails(() => approve(h.deps, args()));
    expect(err.appError.code).toBe('JULES_INVALID_STATE');
    expect(h.adapter.writeCount()).toBe(0);
  });

  it('a user message after the reviewed plan flags a dry run as planChanged', async () => {
    h.deps.clock.time += 1_000;
    addActivity(h, session.sessionResource, {
      type: 'userMessaged',
      message: 'Actually, drop the migration step.',
    });
    const dry = await approve(
      h.deps,
      args({ dryRun: true, grantId: undefined })
    );
    expect(dry.attention).toContain('planChanged');
  });

  it('a same-id plan replacement between the re-read and the POST is a deviation', async () => {
    h.adapter.approvePlanImpl = async (sessionResource) => {
      h.deps.clock.time += 1_000;
      addActivity(h, sessionResource, {
        type: 'planGenerated',
        plan: {
          planId: 'plan-1',
          steps: [
            { id: 'st-swapped', title: 'Delete the repository', index: 0 },
          ],
        },
      });
      h.deps.clock.time += 1_000;
      addActivity(h, sessionResource, {
        type: 'planApproved',
        approvedPlanId: 'plan-1',
      });
    };
    const result = await approve(h.deps, args());
    expect(result).toMatchObject({
      observedPlanIdAfter: 'plan-1',
      policyDeviation: true,
    });
    expect(result.attention).toContain('policyDeviation');
  });

  it('an approval at the reviewed plan createTime with a lower opaque id is unordered evidence, not discarded', async () => {
    const pending = (await readJournal(h.dataDir)).operations[
      session.localRequestId
    ]?.pendingPlan;
    const stamp = pending!.activityCreateTime;
    h.adapter.approvePlanImpl = async (sessionResource) => {
      // A same-id replacement and the approval, both at the reviewed plan's
      // own time; the approval's id sorts BEFORE the plan's.
      addActivity(h, sessionResource, {
        type: 'planGenerated',
        activityId: 'zzz-replacement',
        createTime: stamp,
        plan: {
          planId: 'plan-1',
          steps: [
            { id: 'st-swapped', title: 'Delete the repository', index: 0 },
          ],
        },
      });
      addActivity(h, sessionResource, {
        type: 'planApproved',
        activityId: '000-approval',
        approvedPlanId: 'plan-1',
        createTime: stamp,
      });
    };
    const result = await approve(h.deps, args());
    expect(result).toMatchObject({
      observedPlanIdAfter: 'plan-1',
      policyDeviation: true,
    });
  });

  it('a user message at the same createTime as the reviewed plan, with a lower id, refuses the approval', async () => {
    const owner = (await readJournal(h.dataDir)).operations[
      session.localRequestId
    ];
    addActivity(h, session.sessionResource, {
      type: 'userMessaged',
      activityId: 'a-low-user',
      createTime: owner!.pendingPlan!.activityCreateTime,
      message: 'Actually, drop the migration step.',
    });
    const err = await fails(() => approve(h.deps, args()));
    expect(err.appError.code).toBe('JULES_INVALID_STATE');
    expect(h.adapter.writeCount()).toBe(0);
  });

  it('two differing plans at the newest createTime are ambiguous: refused with no POST', async () => {
    const owner = (await readJournal(h.dataDir)).operations[
      session.localRequestId
    ];
    // Same id, other steps, same time, lower activity id than the reviewed plan.
    addActivity(h, session.sessionResource, {
      type: 'planGenerated',
      activityId: 'a-low-plan',
      createTime: owner!.pendingPlan!.activityCreateTime,
      plan: {
        planId: 'plan-1',
        steps: [{ id: 'st-swapped', title: 'Delete the repository', index: 0 }],
      },
    });
    const err = await fails(() => approve(h.deps, args()));
    expect(err.appError.code).toBe('JULES_POLICY_DEVIATION');
    expect(h.adapter.writeCount()).toBe(0);
    const dry = await approve(
      h.deps,
      args({ dryRun: true, grantId: undefined })
    );
    expect(dry.attention).toContain('planChanged');
  });

  it('an equal-time pair of plans generated before the approval is flagged after the POST', async () => {
    const owner = (await readJournal(h.dataDir)).operations[
      session.localRequestId
    ];
    const reviewed = owner!.pendingPlan!;
    h.adapter.approvePlanImpl = async (sessionResource) => {
      h.deps.clock.time += 1_000;
      const createTime = new Date(h.deps.clock.now()).toISOString();
      // The higher id carries the reviewed steps, so an id-order tie-break
      // would pick it and call the approval unchanged.
      addActivity(h, sessionResource, {
        type: 'planGenerated',
        activityId: 'a-low-plan',
        createTime,
        plan: {
          planId: 'plan-1',
          steps: [
            { id: 'st-swapped', title: 'Delete the repository', index: 0 },
          ],
        },
      });
      addActivity(h, sessionResource, {
        type: 'planGenerated',
        activityId: 'z-high-plan',
        createTime,
        plan: { planId: reviewed.planId, steps: [...reviewed.steps] },
      });
      h.deps.clock.time += 1_000;
      addActivity(h, sessionResource, {
        type: 'planApproved',
        approvedPlanId: 'plan-1',
      });
    };
    const result = await approve(h.deps, args());
    expect(result).toMatchObject({ policyDeviation: true });
  });

  it('a replacement plan stamped at the approval time is flagged after the POST', async () => {
    h.adapter.approvePlanImpl = async (sessionResource) => {
      h.deps.clock.time += 1_000;
      const createTime = new Date(h.deps.clock.now()).toISOString();
      // The replacement's id sorts after the approval's, so a stamp comparison
      // would drop it and leave the reviewed plan as the one approved.
      addActivity(h, sessionResource, {
        type: 'planGenerated',
        activityId: 'z-high-plan',
        createTime,
        plan: {
          planId: 'plan-1',
          steps: [
            { id: 'st-swapped', title: 'Delete the repository', index: 0 },
          ],
        },
      });
      addActivity(h, sessionResource, {
        type: 'planApproved',
        activityId: 'a-low-approval',
        createTime,
        approvedPlanId: 'plan-1',
      });
    };
    const result = await approve(h.deps, args());
    expect(result).toMatchObject({ policyDeviation: true });
  });

  it('a post-approve mismatch records a deviation, flags it, and blocks further writes under the grant', async () => {
    // The vendor approved a different plan than the one evaluated.
    approvalLands('plan-9');
    const result = await approve(h.deps, args());
    expect(result).toMatchObject({
      approvedPlanId: 'plan-1',
      observedPlanIdAfter: 'plan-9',
      policyDeviation: true,
      requiresAttention: true,
    });
    expect(result.attention).toContain('policyDeviation');

    const owner = (await readJournal(h.dataDir)).operations[
      session.localRequestId
    ];
    expect(owner?.deviations).toHaveLength(1);
    expect(owner?.deviations[0]).toMatchObject({
      kind: 'policy-deviation',
      reconciled: false,
    });

    // R13: the unreconciled deviation stops delegation under the grant.
    expect(
      await codeOf(() =>
        delegate(h.deps, {
          repo: 'acme/widgets',
          branch: 'scratch/three',
          prompt: 'another task',
          taskRef: 't1',
          dryRun: false,
          correction: false,
          grantId,
        })
      )
    ).toBe('JULES_POLICY_DEVIATION');
  });
});

describe('an incomplete pre-POST re-fetch fails closed with a cause-split recovery', () => {
  it('a page failure -> retry; if it repeats, run status', async () => {
    h.adapter.listActivitiesImpl = async () => {
      throw new AdapterError('server-error', 'boom', { status: 503 });
    };
    const err = await fails(() => approve(h.deps, args()));
    expect(err.appError.code).toBe('JULES_INVALID_STATE');
    expect(err.appError.recoveryAction).toMatch(
      /Retry; if it repeats, run status/
    );
    expect(h.adapter.writeCount()).toBe(0);
  });

  it('an unmappable activity -> re-verify the SDK pin; a larger deadline will not help', async () => {
    h.adapter.listActivitiesImpl = async () => ({
      activities: [],
      unmappedActivity: true,
    });
    const err = await fails(() => approve(h.deps, args()));
    expect(err.appError.code).toBe('JULES_INVALID_STATE');
    expect(err.appError.recoveryAction).toContain('/jules:setup');
    expect(err.appError.recoveryAction).toContain(
      'larger deadline will not help'
    );
    expect(h.adapter.writeCount()).toBe(0);
  });

  it('the time budget runs out -> retry with a larger --deadline-ms', async () => {
    h.adapter.listActivitiesImpl = async () => {
      h.deps.clock.time += 10 * 60_000;
      return { activities: [], nextPageToken: 'p1' };
    };
    const err = await fails(() =>
      approve(h.deps, args({ deadlineMs: 60_000 }))
    );
    expect(err.appError.code).toBe('JULES_INVALID_STATE');
    expect(err.appError.recoveryAction).toContain('--deadline-ms');
    expect(h.adapter.writeCount()).toBe(0);
  });

  it('a long session is bounded by time, not by the 20-page cap', async () => {
    // 25 pages of 50 filler activities, then the plan: a page cap of 20 would never reach it.
    approvalLands('plan-1');
    const filler = Array.from({ length: 25 * 50 }, (_, i) => ({
      activityId: `f${String(i).padStart(5, '0')}`,
      createTime: new Date(
        Date.parse('2026-09-29T11:30:00Z') + i
      ).toISOString(),
      type: 'progressUpdated',
      artifacts: [],
    }));
    const existing = h.adapter.activities.get(session.sessionResource) ?? [];
    h.adapter.activities.set(session.sessionResource, [...existing, ...filler]);
    const result = await approve(h.deps, args());
    expect(result).toMatchObject({ approvedPlanId: 'plan-1' });
    expect(h.adapter.callsTo('approvePlan')).toHaveLength(1);
  });
});

describe('checks that must hold at the moment of the write (inside the critical section)', () => {
  it('a pause recorded while the plan is being re-read still stops the approval', async () => {
    const original = h.adapter.listActivitiesImpl;
    h.adapter.listActivitiesImpl = async (resource, options) => {
      // The owner's supervision pauses the session mid re-read.
      await updateSupervision(h.dataDir, session.localRequestId, {
        paused: {
          reason: 'outside-user-message',
          observedAt: new Date().toISOString(),
        },
      });
      return original(resource, options);
    };
    const err = await fails(() => approve(h.deps, args()));
    expect(err.appError.code).toBe('JULES_SUPERVISION_PAUSED');
    expect(h.adapter.writeCount()).toBe(0);
  });

  it('observed steering is rejected even when the cached pause is cleared before the reservation', async () => {
    await updateSupervision(h.dataDir, session.localRequestId, {
      paused: {
        reason: 'outside-user-message',
        observedAt: new Date().toISOString(),
      },
    });
    const original = h.adapter.listActivitiesImpl;
    h.adapter.listActivitiesImpl = async (resource, options) => {
      // The owner clears the pause after the target was resolved; steering is visible.
      await updateSupervision(h.dataDir, session.localRequestId, {
        paused: null,
      });
      h.deps.clock.time += 1_000;
      addActivity(h, session.sessionResource, {
        type: 'userMessaged',
        message: 'Actually, drop the migration step.',
      });
      return original(resource, options);
    };
    const err = await fails(() => approve(h.deps, args()));
    expect(['JULES_SUPERVISION_PAUSED', 'JULES_INVALID_STATE']).toContain(
      err.appError.code
    );
    expect(h.adapter.writeCount()).toBe(0);
  });

  it('a deviation recorded on the session blocks it under a DIFFERENT grant too', async () => {
    approvalLands('plan-9');
    await approve(h.deps, args()); // approves a different plan than evaluated -> deviation
    const other = await createGrant(h, { maxActiveSessions: 3 });
    h.deps.clock.time += 1_000;
    addPlanNow(h, session.sessionResource, 'plan-3');
    await status(h.deps, { session: session.localId, reconcile: false });
    const err = await fails(() =>
      approve(h.deps, args({ grantId: other, planId: 'plan-3' }))
    );
    expect(err.appError.code).toBe('JULES_POLICY_DEVIATION');
  });
});

describe('the reviewed plan digest', () => {
  function rewritePlanText(): void {
    addActivity(h, session.sessionResource, {
      type: 'planGenerated',
      plan: {
        planId: 'plan-1',
        steps: [{ id: 'st-x', title: 'Something else entirely', index: 0 }],
      },
    });
    setVendorState(h, session.sessionResource, 'awaitingPlanApproval');
  }

  it('refuses a plan whose text changed under the same id, and sends nothing', async () => {
    rewritePlanText();
    const err = await fails(() => approve(h.deps, args()));
    expect(err.appError.code).toBe('JULES_POLICY_DEVIATION');
    expect(h.adapter.writeCount()).toBe(0);
  });

  it('refuses a plan whose review text was redacted, even with the digest of what was shown', async () => {
    addActivity(h, session.sessionResource, {
      type: 'planGenerated',
      plan: {
        planId: 'plan-1',
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
    const shown = await reviewedDigestOf(h, session.localRequestId);
    h.adapter.calls.length = 0;
    const err = await fails(() =>
      approve(h.deps, args({ expectPlanDigest: shown }))
    );
    expect(err.appError.code).toBe('JULES_INVALID_STATE');
    expect(h.adapter.writeCount()).toBe(0);
  });

  it('a real approve without the digest is refused before any vendor call', async () => {
    const err = await fails(() =>
      approve(h.deps, args({ expectPlanDigest: undefined }))
    );
    expect(err.appError.code).toBe('JULES_INVALID_INPUT');
    expect(h.adapter.calls).toEqual([]);
  });

  it('a malformed digest is refused', async () => {
    expect(
      await codeOf(() => approve(h.deps, args({ expectPlanDigest: 'none' })))
    ).toBe('JULES_INVALID_INPUT');
    expect(h.adapter.writeCount()).toBe(0);
  });

  it('a dry run flags a changed text as planChanged', async () => {
    rewritePlanText();
    expect(await approve(h.deps, args({ dryRun: true }))).toMatchObject({
      attention: ['planChanged'],
    });
  });
});

describe('a grant revoked between the reservation and the POST', () => {
  it('sends nothing and settles the reservation failed', async () => {
    const hook = revokeAfterReservation(h, grantId);
    const err = await fails(() => approve(h.deps, args()));
    expect(hook.fired()).toBe(true);
    expect(err.appError.code).toBe('JULES_AUTHORITY_DENIED');
    expect(h.adapter.callsTo('approvePlan')).toHaveLength(0);
    const record = (await readJournal(h.dataDir)).operations[
      err.localRequestId as string
    ];
    expect(record?.status).toBe('failed');
  });
});

describe('a partial post-POST re-read', () => {
  it('is still a success: ok, verificationDeferred, observedPlanIdAfter null', async () => {
    h.adapter.approvePlanImpl = async () => {
      // From here on every activity page fails.
      h.adapter.listActivitiesImpl = async () => {
        throw new AdapterError('server-error', 'boom', { status: 503 });
      };
    };
    const result = await approve(h.deps, args());
    expect(result).toMatchObject({
      approvedPlanId: 'plan-1',
      observedPlanIdAfter: null,
      verificationDeferred: true,
      verification: { partialPagination: true },
      requiresAttention: true,
    });
    expect(h.adapter.callsTo('approvePlan')).toHaveLength(1);
  });

  it('a complete read that has not yet seen the approval is also deferred', async () => {
    const result = await approve(h.deps, args());
    expect(result).toMatchObject({
      observedPlanIdAfter: null,
      verificationDeferred: true,
      verification: { partialPagination: false },
    });
  });
});

describe('ambiguous approve outcomes', () => {
  it('a dropped connection after dispatch -> JULES_UNKNOWN_OUTCOME, one POST, no replay', async () => {
    h.adapter.approvePlanImpl = async () => {
      throw new AdapterError('network', 'reset', { dispatched: true });
    };
    const err = await fails(() => approve(h.deps, args()));
    expect(err.appError.code).toBe('JULES_UNKNOWN_OUTCOME');
    expect(h.adapter.callsTo('approvePlan')).toHaveLength(1);
    const record = (await readJournal(h.dataDir)).operations[
      err.localRequestId as string
    ];
    expect(record?.status).toBe('unknown-outcome');
    expect(record?.observedPlanId).toBe('plan-1');
  });

  it('a 409 after dispatch is a clear rejection, mapped to JULES_INVALID_INPUT', async () => {
    h.adapter.approvePlanImpl = async () => {
      throw new AdapterError('invalid-request', 'conflict', {
        status: 409,
        dispatched: true,
      });
    };
    expect(await codeOf(() => approve(h.deps, args()))).toBe(
      'JULES_INVALID_INPUT'
    );
  });
});
