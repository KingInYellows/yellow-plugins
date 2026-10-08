/**
 * The mutating surface end to end (PR3, R31, R36, R38, R52): compiled CLI
 * processes against the loopback fake server, under a grant seeded through the
 * library's TTY-confirmed `authorizeCreate` (a real `/dev/tty` cannot exist in
 * CI, so the terminal is the in-memory fake from tests/support/grants.ts).
 *
 * What only a real process boundary can prove: two CLI processes racing for one
 * session slot create exactly one session (the file lock and the authority
 * critical section hold across processes), a copied data directory cannot
 * write, and a write whose response is lost is reconciled — never replayed.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { authorizeCreate } from '../src/authorize.js';
import { REAL_CLOCK } from '../src/runtime.js';

import {
  FakeJulesServer,
  restActivity,
  restSession,
} from './fake-http-server.js';
import { FakeSdkAdapter } from './fake-sdk.js';
import {
  buildPlugin,
  type BuiltPlugin,
  type CliRun,
  isolation,
  type Isolation,
  runCli,
} from './support/cli-harness.js';
import { fakeTty } from './support/grants.js';
import { createPathTraps, type PathTraps } from './support/path-traps.js';

vi.setConfig({ testTimeout: 120_000 });

let plugin: BuiltPlugin;
let traps: PathTraps;
let server: FakeJulesServer;
let iso: Isolation;
let isoRoot: string;
let controllerDir: string;

beforeAll(async () => {
  traps = createPathTraps();
  plugin = buildPlugin({ withWorkspaceSdk: true });
  server = new FakeJulesServer();
  const { baseUrl } = await server.start();
  isoRoot = fs.mkdtempSync(`${plugin.root}-iso-`);
  controllerDir = path.join(isoRoot, 'controller');
  iso = isolation(isoRoot, traps.pathValue, {
    YELLOW_JULES_TEST_BASE_URL: baseUrl,
    YELLOW_JULES_CONTROLLER_DIR: controllerDir,
  });
}, 180_000);

afterAll(async () => {
  await server?.stop();
  traps?.cleanup();
  for (const dir of [plugin?.root, isoRoot]) {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function cli(
  args: string[],
  env: NodeJS.ProcessEnv = iso.env
): Promise<CliRun> {
  return runCli(plugin.cli, args, { env, cwd: iso.cwd, timeoutMs: 300_000 });
}

function errorCode(r: CliRun): unknown {
  return (r.json['error'] as Record<string, unknown> | undefined)?.['code'];
}

/** A grant written through the real `authorizeCreate`, bound to this test's data and controller dirs. */
async function seedGrant(
  limits: { maxActiveSessions?: number; maxCorrectiveRounds?: number } = {}
): Promise<string> {
  const deps = {
    dataDir: iso.dataDir,
    clock: REAL_CLOCK,
    env: {},
    adapterFactory: async () => {
      const adapter = new FakeSdkAdapter();
      adapter.sources = [
        {
          sourceResource: 'sources/github/octo/repo',
          owner: 'octo',
          repo: 'repo',
        },
      ];
      return adapter;
    },
    pluginRoot: '/nonexistent-plugin-root',
    cwd: iso.cwd,
    controllerDir,
    openTty: fakeTty('correct').openTty,
  };
  const result = await authorizeCreate(deps, {
    repo: 'octo/repo',
    branch: 'scratch/*',
    taskRefs: ['t1'],
    operations: 'create,reply,approve,collect',
    owner: 'tester',
    maxTotalTasks: 10,
    ...limits,
  });
  return result.grantId;
}

function resetWorld(): void {
  server.reset();
  fs.rmSync(iso.dataDir, { recursive: true, force: true });
  fs.rmSync(controllerDir, { recursive: true, force: true });
}

const DELEGATE = [
  'delegate',
  '--repo',
  'octo/repo',
  '--task-ref',
  't1',
  '--prompt',
  'Implement the frobnicator exactly as the issue describes.',
];

function delegateArgs(
  grantId: string,
  branch: string,
  extra: string[] = []
): string[] {
  return [...DELEGATE, '--branch', branch, '--grant-id', grantId, ...extra];
}

function journal(): Record<string, Record<string, unknown>> {
  const raw = fs.readFileSync(
    path.join(iso.dataDir, 'state', 'journal.json'),
    'utf8'
  );
  return (
    JSON.parse(raw) as { operations: Record<string, Record<string, unknown>> }
  ).operations;
}

beforeEach(() => {
  resetWorld();
});

describe('a covered delegate through the compiled CLI', () => {
  it('creates one session with plan approval required and auto-PR off, and prints one clean JSON line', async () => {
    const grantId = await seedGrant();
    const r = await cli(
      delegateArgs(grantId, 'scratch/one', ['--request-id', 'e2e-1'])
    );
    expect({ code: r.code, lines: r.stdoutLines, stderr: r.stderr }).toEqual({
      code: 0,
      lines: 1,
      stderr: '',
    });
    expect(r.json).toMatchObject({
      ok: true,
      operation: 'delegate',
      localRequestId: 'e2e-1',
      condition: 'starting',
      repository: 'octo/repo',
      requestedBranch: 'scratch/one',
    });
    expect(r.stdout).not.toContain('frobnicator');

    expect(server.mutatingCount).toBe(1);
    const post = server.bodiesTo('POST', /\/sessions$/)[0] as Record<
      string,
      unknown
    >;
    expect(post).toMatchObject({
      requirePlanApproval: true,
      automationMode: 'AUTOMATION_MODE_UNSPECIFIED',
      sourceContext: { githubRepoContext: { startingBranch: 'scratch/one' } },
    });
    expect(String(post['title'])).toMatch(/^\[yellow:jl-[0-9a-f]{32}\] /);
    expect(post).not.toHaveProperty('prompt');

    const record = journal()['e2e-1'];
    expect(record).toMatchObject({
      kind: 'create',
      status: 'accepted',
      grantId,
    });
    expect(JSON.stringify(journal())).not.toContain('frobnicator');
  });
});

describe('two CLI processes racing for one session slot (R31)', () => {
  it('create exactly one session: the other is JULES_GRANT_EXHAUSTED, and the server saw one POST', async () => {
    const grantId = await seedGrant({ maxActiveSessions: 1 });
    const [a, b] = await Promise.all([
      cli(delegateArgs(grantId, 'scratch/a', ['--request-id', 'race-a'])),
      cli(delegateArgs(grantId, 'scratch/b', ['--request-id', 'race-b'])),
    ]);
    const outcomes = [a, b];
    expect(outcomes.filter((r) => r.code === 0)).toHaveLength(1);
    const loser = outcomes.find((r) => r.code !== 0)!;
    expect(loser.code).toBe(1);
    expect(errorCode(loser)).toBe('JULES_GRANT_EXHAUSTED');
    expect(loser.stdoutLines).toBe(1);
    expect(server.postCount).toBe(1);
    expect(server.mutatingCount).toBe(1);
    expect(Object.keys(journal())).toHaveLength(1);
  });

  it('three processes against a three-session grant all succeed, each with its own session', async () => {
    const grantId = await seedGrant({ maxActiveSessions: 3 });
    const runs = await Promise.all(
      ['a', 'b', 'c'].map((n) =>
        cli(
          delegateArgs(grantId, `scratch/${n}`, ['--request-id', `three-${n}`])
        )
      )
    );
    expect(runs.map((r) => r.code)).toEqual([0, 0, 0]);
    expect(server.postCount).toBe(3);
    expect(new Set(runs.map((r) => r.json['sessionResource'])).size).toBe(3);
  });
});

describe('a copied data directory cannot write (R38)', () => {
  it('fails with JULES_CONTROLLER_MISMATCH and sends nothing', async () => {
    const grantId = await seedGrant();
    const copy = path.join(isoRoot, 'data-copy');
    fs.cpSync(iso.dataDir, copy, { recursive: true });
    const before = server.log.length;
    const r = await cli(delegateArgs(grantId, 'scratch/one'), {
      ...iso.env,
      YELLOW_JULES_DATA_DIR: copy,
    });
    expect(r.code).toBe(1);
    expect(errorCode(r)).toBe('JULES_CONTROLLER_MISMATCH');
    expect(server.log.length).toBe(before + 1); // the dry source read only; no POST
    expect(server.mutatingCount).toBe(0);
    fs.rmSync(copy, { recursive: true, force: true });
  });

  it('a controller file removed from the host fails loud for the original too', async () => {
    const grantId = await seedGrant();
    fs.rmSync(controllerDir, { recursive: true, force: true });
    const r = await cli(delegateArgs(grantId, 'scratch/one'));
    expect(r.code).toBe(1);
    expect(errorCode(r)).toBe('JULES_CONTROLLER_MISMATCH');
    expect(server.mutatingCount).toBe(0);
  });
});

describe('a lost response is reconciled, never replayed (R16, R36)', () => {
  it('the vendor accepted the create but the connection dropped: unknown outcome, one POST, then reconcile binds it', async () => {
    const grantId = await seedGrant({ maxActiveSessions: 3 });
    server.inject('POST', /\/sessions$/, 'drop-after-accept');
    const r = await cli(
      delegateArgs(grantId, 'scratch/one', ['--request-id', 'lost-1'])
    );
    expect(r.code).toBe(1);
    expect(errorCode(r)).toBe('JULES_UNKNOWN_OUTCOME');
    expect(r.json['localRequestId']).toBe('lost-1');
    expect(r.json['localId']).toMatch(/^jl-[0-9a-f]{32}$/);
    expect(server.postCount).toBe(1);
    expect(journal()['lost-1']?.['status']).toBe('unknown-outcome');
    expect(server.state.sessions.size).toBe(1);

    // A relaunch is refused locally; the server is not asked.
    const again = await cli(
      delegateArgs(grantId, 'scratch/one', ['--request-id', 'lost-2'])
    );
    expect(errorCode(again)).toBe('JULES_DUPLICATE_LAUNCH');
    expect(server.postCount).toBe(1);

    const reconciled = await cli(['status', '--reconcile']);
    expect(reconciled.code).toBe(0);
    expect(reconciled.json['reconciled']).toEqual([
      expect.objectContaining({ localRequestId: 'lost-1', outcome: 'bound' }),
    ]);
    expect(journal()['lost-1']).toMatchObject({ status: 'accepted' });
    expect(server.postCount).toBe(1);
  });

  it('the connection dropped before the vendor saw it: unknown outcome, and reconcile cannot free it without archive visibility', async () => {
    const grantId = await seedGrant({ maxActiveSessions: 3 });
    server.inject('POST', /\/sessions$/, 'drop-before-accept');
    const r = await cli(
      delegateArgs(grantId, 'scratch/one', ['--request-id', 'lost-3'])
    );
    expect(errorCode(r)).toBe('JULES_UNKNOWN_OUTCOME');
    expect(server.state.sessions.size).toBe(0);

    const reconciled = await cli(['status', '--reconcile']);
    expect(reconciled.json['reconciled']).toEqual([
      expect.objectContaining({
        localRequestId: 'lost-3',
        outcome: 'ambiguous-reconcile',
        reason: 'archive-visibility-unverified',
      }),
    ]);
    expect(journal()['lost-3']?.['status']).toBe('unknown-outcome');
    expect(server.postCount).toBe(1);
  });

  it.each([
    ['http-429', 'JULES_RATE_LIMITED'],
    ['http-503', 'JULES_UNKNOWN_OUTCOME'],
    ['http-504', 'JULES_UNKNOWN_OUTCOME'],
    ['invalid-2xx', 'JULES_UNKNOWN_OUTCOME'],
  ] as const)(
    'a %s on the create POST is %s with exactly one POST',
    async (failure, code) => {
      const grantId = await seedGrant({ maxActiveSessions: 3 });
      server.inject('POST', /\/sessions$/, failure);
      const r = await cli(delegateArgs(grantId, 'scratch/one'));
      expect(errorCode(r)).toBe(code);
      expect(server.postCount).toBe(1);
    }
  );
});

describe('reply, approve and supervise through the compiled CLI', () => {
  async function delegated(
    grantId: string
  ): Promise<{ localId: string; id: string }> {
    const r = await cli(
      delegateArgs(grantId, 'scratch/one', ['--request-id', 'flow-1'])
    );
    expect(r.code).toBe(0);
    const resource = String(r.json['sessionResource']);
    return {
      localId: String(r.json['localId']),
      id: resource.replace('sessions/', ''),
    };
  }

  it('reply sends one message; approve re-reads the plan, then approves once; supervise decides without writing', async () => {
    const grantId = await seedGrant({ maxActiveSessions: 3 });
    const { localId, id } = await delegated(grantId);

    // The vendor shows a pending plan and waits for approval.
    server.state.sessions.set(id, {
      ...(server.state.sessions.get(id) as Record<string, unknown>),
      state: 'AWAITING_PLAN_APPROVAL',
    });
    server.state.activities.set(id, [
      restActivity(id, 'act-1', '2026-09-10T00:00:01Z', {
        planGenerated: {
          plan: {
            id: 'plan-1',
            steps: [{ id: 'st-1', title: 'Add the frobnicator', index: 0 }],
          },
        },
      }),
    ]);
    const posts = server.postCount;

    // supervise: reads, decides, writes nothing to the vendor.
    const sup = await cli([
      'supervise',
      '--session',
      localId,
      '--grant-id',
      grantId,
    ]);
    expect(sup.code).toBe(0);
    expect(sup.json).toMatchObject({
      ok: true,
      operation: 'supervise',
      decision: 'needs-plan-review',
      observedPlanId: 'plan-1',
      allowedActions: ['approve', 'reply'],
    });
    expect(
      String((sup.json['fenced'] as Record<string, string>)['plan'])
    ).toContain('Add the frobnicator');
    expect(server.postCount).toBe(posts);

    // reply: one non-blocking POST.
    const rep = await cli([
      'reply',
      '--session',
      localId,
      '--message',
      'please keep the change small',
      '--grant-id',
      grantId,
    ]);
    expect(rep.json).toMatchObject({ ok: true, sent: true });
    expect(server.postCount).toBe(posts + 1);
    expect(server.paths().at(-1)).toBe(
      `POST /v1alpha/sessions/${id}:sendMessage`
    );

    // approve: dry-run re-fetch, then the single approve POST.
    const dry = await cli([
      'approve',
      '--session',
      localId,
      '--plan-id',
      'plan-1',
      '--dry-run',
    ]);
    expect(dry.json).toMatchObject({
      ok: true,
      dryRun: true,
      observedPlanId: 'plan-1',
    });
    expect(server.postCount).toBe(posts + 1);

    const approved = await cli([
      'approve',
      '--session',
      localId,
      '--plan-id',
      'plan-1',
      '--grant-id',
      grantId,
    ]);
    expect(approved.json).toMatchObject({
      ok: true,
      approvedPlanId: 'plan-1',
      verificationDeferred: true,
    });
    expect(server.postCount).toBe(posts + 2);
    expect(server.paths().at(-1)).not.toContain('sendMessage');
    expect(server.log.some((l) => /cancel|pause|resume/.test(l.path))).toBe(
      false
    );
  });

  it('approve refuses when a newer plan appeared than the one evaluated, and sends nothing', async () => {
    const grantId = await seedGrant({ maxActiveSessions: 3 });
    const { localId, id } = await delegated(grantId);
    server.state.sessions.set(id, {
      ...(server.state.sessions.get(id) as Record<string, unknown>),
      state: 'AWAITING_PLAN_APPROVAL',
    });
    const plan = (planId: string, at: string) =>
      restActivity(id, `act-${planId}`, at, {
        planGenerated: {
          plan: { id: planId, steps: [{ id: 's', title: 't', index: 0 }] },
        },
      });
    server.state.activities.set(id, [plan('plan-1', '2026-09-10T00:00:01Z')]);
    await cli(['status', '--session', localId]);
    server.state.activities.set(id, [
      plan('plan-1', '2026-09-10T00:00:01Z'),
      plan('plan-2', '2026-09-10T00:00:09Z'),
    ]);
    const posts = server.postCount;
    const r = await cli([
      'approve',
      '--session',
      localId,
      '--plan-id',
      'plan-1',
      '--grant-id',
      grantId,
    ]);
    expect(r.code).toBe(1);
    expect(errorCode(r)).toBe('JULES_POLICY_DEVIATION');
    expect(server.postCount).toBe(posts);
  });
});

describe('one invocation, several adapters (the fetch guard installs once)', () => {
  it('status --session --reconcile with an unresolved reply reconciles, then reads the session, in one process', async () => {
    const grantId = await seedGrant({ maxActiveSessions: 3 });
    const created = await cli(
      delegateArgs(grantId, 'scratch/one', ['--request-id', 'multi-1'])
    );
    expect(created.code).toBe(0);
    const localId = String(created.json['localId']);

    server.inject('POST', /:sendMessage$/, 'drop-after-accept');
    const sent = await cli([
      'reply',
      '--session',
      localId,
      '--message',
      'please keep it small',
      '--grant-id',
      grantId,
      '--request-id',
      'multi-reply',
    ]);
    expect(errorCode(sent)).toBe('JULES_UNKNOWN_OUTCOME');

    // reconcile opens one adapter, the session read opens another.
    const r = await cli(['status', '--session', localId, '--reconcile']);
    expect(r.code).toBe(0);
    expect(r.json['reconciled']).toEqual([
      expect.objectContaining({ localRequestId: 'multi-reply', kind: 'reply' }),
    ]);
    expect(r.json['sessionResource']).toBe(created.json['sessionResource']);
  });

  it('supervise on a finished session stages artifacts (status, then collect) in one process', async () => {
    const grantId = await seedGrant({ maxActiveSessions: 3 });
    const created = await cli(delegateArgs(grantId, 'scratch/one'));
    expect(created.code).toBe(0);
    const id = String(created.json['sessionResource']).replace('sessions/', '');
    server.state.sessions.set(id, {
      ...(server.state.sessions.get(id) as Record<string, unknown>),
      state: 'COMPLETED',
    });
    // The session's own first message, as the vendor echoes it.
    server.state.activities.set(id, [
      restActivity(id, 'act-1', new Date().toISOString(), {
        userMessaged: {
          userMessage:
            'Implement the frobnicator exactly as the issue describes.',
        },
      }),
    ]);
    const r = await cli([
      'supervise',
      '--session',
      String(created.json['localId']),
      '--grant-id',
      grantId,
    ]);
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({
      ok: true,
      decision: 'needs-verification',
      verification: 'unavailable',
    });
  });
});

describe('isolation', () => {
  it('nothing was written into the working directory, and no trapped tool ran', () => {
    expect(fs.readdirSync(iso.cwd)).toEqual([]);
    expect(traps.entries()).toEqual([]);
  });

  it('the fake session shape is untouched by these tests (sanity)', () => {
    expect(restSession('x').name).toBe('sessions/x');
  });
});
