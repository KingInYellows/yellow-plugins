import { describe, expect, it } from 'vitest';

import { STATUS_PAGE_SIZE, walkActivities } from '../src/activity-walk.js';
import { deadlineIn } from '../src/deadline.js';
import type { AdapterActivity } from '../src/types.js';

import { FakeClock, FakeSdkAdapter } from './fake-sdk.js';

const SESSION = 'sessions/s1';
const STAMP = '2026-09-29T11:00:00.000Z';

async function walkWith(approval: {
  createTime: string;
  activityId: string;
  approvedPlanId?: string;
}) {
  const adapter = new FakeSdkAdapter();
  const plan: AdapterActivity = {
    activityId: 'aaa-plan',
    createTime: STAMP,
    type: 'planGenerated',
    plan: {
      planId: 'plan-1',
      steps: [{ id: 'st-1', title: 'Work', index: 0 }],
    },
    artifacts: [],
  };
  adapter.activities.set(SESSION, [plan]);
  const clock = new FakeClock();
  return walkActivities({
    adapter,
    sessionResource: SESSION,
    pageSize: STATUS_PAGE_SIZE,
    start: { kind: 'session-start' },
    clock,
    deadline: deadlineIn(clock, 60_000),
    approval,
  });
}

describe('approvals at one createTime that name different plans', () => {
  it('decide nothing: the plan stays pending and ambiguous whatever the ids', async () => {
    const adapter = new FakeSdkAdapter();
    adapter.activities.set(SESSION, [
      {
        activityId: 'mmm-plan',
        createTime: STAMP,
        type: 'planGenerated',
        plan: { planId: 'plan-1', steps: [{ id: 's', title: 'W', index: 0 }] },
        artifacts: [],
      },
      {
        activityId: 'aaa-approval',
        createTime: STAMP,
        type: 'planApproved',
        approvedPlanId: 'plan-1',
        artifacts: [],
      },
      {
        activityId: 'zzz-approval',
        createTime: STAMP,
        type: 'planApproved',
        approvedPlanId: 'plan-0',
        artifacts: [],
      },
    ]);
    const clock = new FakeClock();
    const walk = await walkActivities({
      adapter,
      sessionResource: SESSION,
      pageSize: STATUS_PAGE_SIZE,
      start: { kind: 'session-start' },
      clock,
      deadline: deadlineIn(clock, 60_000),
    });
    expect(walk.pendingPlan).toMatchObject({
      planId: 'plan-1',
      ambiguous: true,
    });
  });
});

describe('a resumed walk keeps the approved plan id of its stored approval', () => {
  it('an equal-time approval that names the plan clears it', async () => {
    const walk = await walkWith({
      createTime: STAMP,
      activityId: 'zzz-approval',
      approvedPlanId: 'plan-1',
    });
    expect(walk.pendingPlan).toBeNull();
    expect(walk.latestApproval).toMatchObject({ approvedPlanId: 'plan-1' });
  });

  it('a marker without the plan id (older journals) keeps the plan pending and ambiguous', async () => {
    const walk = await walkWith({
      createTime: STAMP,
      activityId: 'zzz-approval',
    });
    expect(walk.pendingPlan).toMatchObject({
      planId: 'plan-1',
      ambiguous: true,
    });
  });

  it('an equal-time approval naming another plan keeps the plan pending and ambiguous', async () => {
    const walk = await walkWith({
      createTime: STAMP,
      activityId: 'zzz-approval',
      approvedPlanId: 'plan-0',
    });
    expect(walk.pendingPlan).toMatchObject({ ambiguous: true });
  });
});
