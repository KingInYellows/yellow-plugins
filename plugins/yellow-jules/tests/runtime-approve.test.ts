import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadGrants } from '../src/authority.js';
import {
  AdapterError,
  MutationErrorException,
  type AppErrorCode,
} from '../src/errors.js';
import { approve, delegate, type ApproveArgs } from '../src/mutations.js';
import { status } from '../src/runtime.js';
import { readJournal, updateSupervision } from '../src/state.js';

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

let h: GrantHarness;
let grantId: string;
let session: DelegatedSession;

beforeEach(async () => {
  h = makeHarness('correct');
  grantId = await createGrant(h, { maxActiveSessions: 3 });
  session = await delegateOk(h, grantId);
  addPlan(h, session.sessionResource, 'plan-1');
  // `status` is the only writer of the pending plan the approval compares against.
  await status(h.deps, { session: session.localId, reconcile: false });
  h.adapter.calls.length = 0;
});
afterEach(() => {
  h.cleanup();
});

function args(overrides: Partial<ApproveArgs> = {}): ApproveArgs {
  return {
    session: session.localId,
    planId: 'plan-1',
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
