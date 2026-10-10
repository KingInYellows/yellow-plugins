/**
 * Test helpers for the grant, controller, and TTY layers: an in-memory TTY
 * that answers the runtime's challenge (correctly or not), grant builders, and
 * deps wired to throwaway data and controller directories.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  emptyUsage,
  loadGrants,
  updateGrant,
  writeGrants,
} from '../../src/authority.js';
import { type AuthorizeDeps, authorizeCreate } from '../../src/authorize.js';
import { resolveJournalPath } from '../../src/config.js';
import { delegate, type DelegateArgs } from '../../src/mutations.js';
import { planDigest, readJournal } from '../../src/state.js';
import type { OpenTty, TtyHandle } from '../../src/tty-confirm.js';
import type { AdapterActivity, GrantRecord } from '../../src/types.js';
import { FakeSdkAdapter, makeDeps } from '../fake-sdk.js';

export type TtyMode = 'correct' | 'wrong' | 'eof' | 'timeout' | 'no-tty';

export interface FakeTty {
  readonly openTty: OpenTty;
  /** Everything the runtime wrote to the terminal. */
  readonly written: string[];
  opened: number;
}

/** A terminal that reads the challenge off the prompt and answers per `mode`. */
export function fakeTty(mode: TtyMode = 'correct'): FakeTty {
  const written: string[] = [];
  const state: FakeTty = {
    written,
    opened: 0,
    openTty: () => {
      state.opened += 1;
      if (mode === 'no-tty') {
        const err = new Error(
          'no controlling terminal'
        ) as NodeJS.ErrnoException;
        err.code = 'ENXIO';
        throw err;
      }
      const handle: TtyHandle = {
        write: (text) => {
          written.push(text);
        },
        readLine: async () => {
          // The newest prompt carries the live challenge.
          const matches = [
            ...written.join('').matchAll(/Type ([A-Z0-9]{6}) to confirm/g),
          ];
          const code = matches[matches.length - 1]?.[1];
          if (mode === 'timeout') throw new Error('timeout');
          if (mode === 'eof') return null;
          if (mode === 'wrong') return code === 'AAAAAA' ? 'BBBBBB' : 'AAAAAA';
          return code ?? '';
        },
        close: () => undefined,
      };
      return handle;
    },
  };
  return state;
}

export interface GrantHarness {
  readonly dataDir: string;
  readonly controllerDir: string;
  readonly adapter: FakeSdkAdapter;
  readonly tty: FakeTty;
  readonly deps: AuthorizeDeps & {
    clock: ReturnType<typeof makeDeps>['clock'];
  };
  cleanup(): void;
}

export function makeHarness(ttyMode: TtyMode = 'correct'): GrantHarness {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yellow-jules-grant-'));
  const dataDir = path.join(root, 'data');
  const controllerDir = path.join(root, 'controller');
  const adapter = new FakeSdkAdapter();
  const tty = fakeTty(ttyMode);
  const deps = {
    ...makeDeps(dataDir, adapter),
    cwd: root,
    controllerDir,
    controllerId: 'testhost',
    openTty: tty.openTty,
  } as GrantHarness['deps'];
  return {
    dataDir,
    controllerDir,
    adapter,
    tty,
    deps,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

export const NOW = new Date('2026-09-29T12:00:00Z');

export function makeGrant(overrides: Partial<GrantRecord> = {}): GrantRecord {
  return {
    grantId: 'jg-00000000000000000000000000000001',
    repository: 'acme/widgets',
    sourceResource: 'sources/github/acme/widgets',
    branchPattern: 'scratch/*',
    taskRefs: ['t1'],
    operations: ['create', 'reply', 'approve', 'collect'],
    maxActiveSessions: 1,
    maxTotalTasks: 3,
    maxCorrectiveRounds: 2,
    expiresAt: '2026-09-29T14:00:00.000Z',
    createdAt: '2026-09-29T12:00:00.000Z',
    owner: 'tester',
    controllerId: 'testhost',
    epochRef: { controllerId: 'testhost', epoch: 1 },
    usage: emptyUsage(),
    ...overrides,
  };
}

/** Creates a real grant through the TTY-confirmed path and returns its id. */
export async function createGrant(
  harness: GrantHarness,
  overrides: Partial<Parameters<typeof authorizeCreate>[1]> = {}
): Promise<string> {
  const result = await authorizeCreate(harness.deps, {
    repo: 'acme/widgets',
    branch: 'scratch/*',
    taskRefs: ['t1'],
    operations: 'create,reply,approve,collect',
    owner: 'tester',
    ...overrides,
  });
  return result.grantId;
}

// ---------------------------------------------------------------------------
// Session scenario helpers
// ---------------------------------------------------------------------------

export interface DelegatedSession {
  readonly sessionResource: string;
  readonly localId: string;
  readonly localRequestId: string;
}

/** A real delegate under `grantId`; the fake registers the session as `queued`. */
export async function delegateOk(
  harness: GrantHarness,
  grantId: string,
  overrides: Partial<DelegateArgs> = {}
): Promise<DelegatedSession> {
  const result = await delegate(harness.deps, {
    repo: 'acme/widgets',
    branch: 'scratch/one',
    prompt: 'Implement the change described in the task.',
    taskRef: 't1',
    dryRun: false,
    correction: false,
    grantId,
    ...overrides,
  });
  if (!('sessionResource' in result)) throw new Error('expected a session');
  return {
    sessionResource: result.sessionResource,
    localId: result.localId,
    localRequestId: result.localRequestId,
  };
}

let planSeq = 0;

/**
 * Adds a `planGenerated` activity to the fake and puts the session in the
 * given state, newer than anything already there.
 */
/** The digest of the plan `status` last recorded as pending for the session. */
export async function reviewedDigestOf(
  harness: GrantHarness,
  localRequestId: string
): Promise<string> {
  const plan = (await readJournal(harness.dataDir)).operations[localRequestId]
    ?.pendingPlan;
  if (plan === undefined) throw new Error('no pending plan recorded');
  return planDigest(plan.planId, plan.steps);
}

export function addPlan(
  harness: GrantHarness,
  sessionResource: string,
  planId: string,
  state = 'awaitingPlanApproval'
): AdapterActivity {
  planSeq += 1;
  const activity: AdapterActivity = {
    activityId: `plan${String(planSeq).padStart(4, '0')}`,
    createTime: new Date(
      Date.parse('2026-09-29T11:00:00Z') + planSeq * 1000
    ).toISOString(),
    type: 'planGenerated',
    plan: {
      planId,
      steps: [{ id: `st-${planSeq}`, title: 'Do the work', index: 0 }],
    },
    artifacts: [],
  };
  const list = harness.adapter.activities.get(sessionResource) ?? [];
  harness.adapter.activities.set(sessionResource, [...list, activity]);
  const session = harness.adapter.sessions.get(sessionResource);
  if (session !== undefined) {
    harness.adapter.sessions.set(sessionResource, {
      ...session,
      vendorState: state,
    });
  }
  return activity;
}

export function addActivity(
  harness: GrantHarness,
  sessionResource: string,
  activity: Partial<AdapterActivity> & { type: string }
): AdapterActivity {
  planSeq += 1;
  const full: AdapterActivity = {
    activityId: `act${String(planSeq).padStart(4, '0')}`,
    createTime: new Date(harness.deps.clock.now()).toISOString(),
    artifacts: [],
    ...activity,
  };
  const list = harness.adapter.activities.get(sessionResource) ?? [];
  harness.adapter.activities.set(sessionResource, [...list, full]);
  return full;
}

export function setVendorState(
  harness: GrantHarness,
  sessionResource: string,
  vendorState: string
): void {
  const session = harness.adapter.sessions.get(sessionResource);
  if (session === undefined) throw new Error(`no ${sessionResource}`);
  harness.adapter.sessions.set(sessionResource, { ...session, vendorState });
}

/**
 * A plan that arrives NOW (the fake clock), after anything already read:
 * real activities arrive in time order, which `addPlan`'s fixed stamps do not.
 */
export function addPlanNow(
  harness: GrantHarness,
  sessionResource: string,
  planId: string
): AdapterActivity {
  const activity = addActivity(harness, sessionResource, {
    type: 'planGenerated',
    plan: {
      planId,
      steps: [{ id: `st-${planId}`, title: 'Do the work', index: 0 }],
    },
  });
  setVendorState(harness, sessionResource, 'awaitingPlanApproval');
  return activity;
}

/**
 * Revokes the grant (synchronously, on disk) the first time the clock is read
 * after a reservation has landed in the journal: the window between the
 * reservation and the vendor POST.
 */
export function revokeAfterReservation(
  harness: GrantHarness,
  grantId: string
): { fired: () => boolean } {
  let fired = false;
  const realNow = harness.deps.clock.now.bind(harness.deps.clock);
  harness.deps.clock.now = () => {
    if (!fired) {
      const journalPath = resolveJournalPath(harness.dataDir);
      if (
        fs.existsSync(journalPath) &&
        fs.readFileSync(journalPath, 'utf8').includes('"reserved"')
      ) {
        fired = true;
        const file = loadGrants(harness.dataDir);
        writeGrants(
          harness.dataDir,
          updateGrant(file, grantId, (g) => ({
            ...g,
            revokedAt: new Date(realNow()).toISOString(),
          }))
        );
      }
    }
    return realNow();
  };
  return { fired: () => fired };
}
