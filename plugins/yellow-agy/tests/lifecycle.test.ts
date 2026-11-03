import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { TurnOutcome } from '../src/classify';
import { AgyError } from '../src/errors';
import { buildGrant, putGrant } from '../src/grants';
import { createHostExec } from '../src/host-exec';
import type { Invocation } from '../src/invocation';
import type { LifecycleDeps } from '../src/lifecycle';
import { Lifecycle } from '../src/lifecycle';
import { readJournal, writeJournal } from '../src/state';
import { createWorktree } from '../src/worktree';

import { git, makeRepo, testEnv } from './helpers';

const PLAN = { summary: 'Add b.txt', steps: ['write b.txt'], risks: [] };

type Step = (inv: Invocation) => Partial<TurnOutcome> & { json?: unknown };

function harness(steps: Step[], extra: Partial<LifecycleDeps> = {}) {
  const { repo, root } = makeRepo();
  const calls: Invocation[] = [];
  let gates = 0;
  const deps: LifecycleDeps = {
    host: { kind: 'posix' },
    exec: createHostExec({ kind: 'posix' }, testEnv),
    dataDir: path.join(root, 'data'),
    worktreeRoot: path.join(root, 'worktrees'),
    schemaPath: path.join(root, 'schema', 'plan.schema.json'),
    baseEnv: testEnv,
    runTurn: async (inv, options) => {
      calls.push(inv);
      await options.onSpawn?.(process.pid);
      const step = steps.shift();
      if (step === undefined) throw new Error('unexpected turn');
      const { json, ...rest } = step(inv);
      return {
        exitCode: 0,
        signal: null,
        killedByDeadline: false,
        cancelled: false,
        stdout: json === undefined ? '' : JSON.stringify(json),
        stderr: '',
        ...rest,
      };
    },
    quotaGate: async () => {
      gates += 1;
    },
    allowCommands: [],
    sandboxVerified: false,
    printTimeoutSeconds: 60,
    deadlineMs: 90_000,
    newId: () => 't1',
    ...extra,
  };
  return { lc: new Lifecycle(deps), deps, repo, calls, gates: () => gates };
}

const planTurn: Step = () => ({
  json: {
    status: 'SUCCESS',
    conversation_id: 'c1',
    response: 'plan',
    structured_output: PLAN,
  },
});
const editTurn =
  (text: string): Step =>
  (inv) => {
    fs.writeFileSync(path.join(inv.cwd ?? '', 'b.txt'), text);
    return {
      json: { status: 'SUCCESS', conversation_id: 'c1', response: 'done' },
    };
  };

const delegateInput = (repo: string) => ({
  requestId: 'r1',
  branch: 'agy/t1',
  prompt: 'Add b.txt',
  repo,
  remote: 'origin',
  baseBranch: 'main',
});

describe('Lifecycle', () => {
  it('delegate plans read-only, approve implements, collect writes patches', async () => {
    const h = harness([planTurn, editTurn('hello\n')]);
    const d = await h.lc.delegate(delegateInput(h.repo));
    expect(d).toMatchObject({
      ok: true,
      state: 'PLAN_PENDING',
      conversationId: 'c1',
      plan: PLAN,
    });
    expect(h.calls[0]?.args).toContain('--json-schema');
    expect(h.calls[0]?.args).not.toContain('accept-edits');
    expect(
      JSON.parse(fs.readFileSync(h.deps.schemaPath, 'utf8')).required
    ).toEqual(['summary', 'steps', 'risks']);

    const a = await h.lc.approve({ requestId: 'r2', localId: 't1' });
    expect(a).toMatchObject({
      ok: true,
      state: 'IMPLEMENTED',
      requiresAttention: false,
    });
    expect(h.calls[1]?.args).toEqual(
      expect.arrayContaining(['--conversation', 'c1', '--mode', 'accept-edits'])
    );
    expect(h.gates()).toBe(2);
    const wt = path.join(h.deps.worktreeRoot, 't1');
    expect(git(wt, 'for-each-ref', 'refs/yellow-agy/')).toBe('');

    const c = await h.lc.collect('t1');
    expect(c.secretShapedContent).toBe(false);
    expect(fs.readFileSync(c.uncommittedPatch ?? '', 'utf8')).toContain(
      '+hello'
    );
    expect(readJournal(h.deps.dataDir).activeRun).toBeUndefined();
  });

  it('replays a finished request id without a new turn', async () => {
    const h = harness([planTurn]);
    const first = await h.lc.delegate(delegateInput(h.repo));
    const again = await h.lc.delegate(delegateInput(h.repo));
    expect(again).toEqual(first);
    expect(h.calls).toHaveLength(1);
  });

  it('a plan-pending reply is read-only; a correction replaces the plan', async () => {
    const better = { ...PLAN, summary: 'Better' };
    const h = harness([
      planTurn,
      () => ({
        json: { status: 'SUCCESS', conversation_id: 'c1', response: 'ok' },
      }),
      () => ({
        json: {
          status: 'SUCCESS',
          conversation_id: 'c1',
          structured_output: better,
        },
      }),
    ]);
    await h.lc.delegate(delegateInput(h.repo));
    const r = await h.lc.reply({
      requestId: 'r2',
      localId: 't1',
      message: 'why?',
    });
    expect(r).toMatchObject({ state: 'PLAN_PENDING', plan: PLAN });
    expect(h.calls[1]?.args).not.toContain('--json-schema');
    expect(h.calls[1]?.args).not.toContain('accept-edits');
    const c = await h.lc.reply({
      requestId: 'r3',
      localId: 't1',
      message: 'redo',
      correction: true,
    });
    expect(c).toMatchObject({ state: 'PLAN_PENDING', plan: better });
    expect(h.calls[2]?.args).toContain('--json-schema');
    expect(h.lc.status('t1')[0]?.correctiveRounds).toBe(1);
  });

  it('a timed-out implement turn needs --keep-partial or --reset-partial', async () => {
    const h = harness([
      planTurn,
      (inv) => {
        fs.writeFileSync(path.join(inv.cwd ?? '', 'b.txt'), 'half\n');
        return {
          killedByDeadline: true,
          json: { status: 'SUCCESS', conversation_id: 'c1' },
        };
      },
      editTurn('whole\n'),
    ]);
    await h.lc.delegate(delegateInput(h.repo));
    const a = await h.lc.approve({ requestId: 'r2', localId: 't1' });
    expect(a).toMatchObject({
      ok: false,
      code: 'AGY_TIMEOUT',
      state: 'TIMED_OUT',
      requiresAttention: true,
    });
    const wt = path.join(h.deps.worktreeRoot, 't1');
    expect(fs.existsSync(path.join(wt, 'b.txt'))).toBe(true);

    await expect(
      h.lc.reply({ requestId: 'r3', localId: 't1', message: 'go on' })
    ).rejects.toMatchObject({
      code: 'AGY_WORKTREE',
    });
    // The refusal released the claim and the request id.
    expect(readJournal(h.deps.dataDir).activeRun).toBeUndefined();
    const r = await h.lc.reply({
      requestId: 'r3',
      localId: 't1',
      message: 'go on',
      resetPartial: true,
    });
    expect(r).toMatchObject({ state: 'IMPLEMENTED' });
    expect(fs.readFileSync(path.join(wt, 'b.txt'), 'utf8')).toBe('whole\n');
  });

  it('reset-partial restores the pre-turn worktree', async () => {
    const h = harness([
      planTurn,
      (inv) => {
        fs.writeFileSync(path.join(inv.cwd ?? '', 'b.txt'), 'half\n');
        return { cancelled: true, signal: 'SIGTERM', exitCode: null };
      },
      (inv) => {
        expect(fs.existsSync(path.join(inv.cwd ?? '', 'b.txt'))).toBe(false);
        return { json: { status: 'SUCCESS', conversation_id: 'c1' } };
      },
    ]);
    await h.lc.delegate(delegateInput(h.repo));
    expect(
      await h.lc.approve({ requestId: 'r2', localId: 't1' })
    ).toMatchObject({ state: 'INTERRUPTED' });
    await h.lc.reply({
      requestId: 'r3',
      localId: 't1',
      message: 'retry',
      resetPartial: true,
    });
    expect(h.calls).toHaveLength(3);
  });

  it('a denied action is reported with requiresAttention', async () => {
    const h = harness([
      planTurn,
      () => ({
        json: {
          status: 'SUCCESS',
          conversation_id: 'c1',
          denied_actions: [{ tool: 'run', command: 'npm i' }],
        },
      }),
    ]);
    await h.lc.delegate(delegateInput(h.repo));
    const a = await h.lc.approve({ requestId: 'r2', localId: 't1' });
    expect(a).toMatchObject({
      ok: true,
      state: 'DENIED',
      requiresAttention: true,
    });
    expect(a.deniedActions).toHaveLength(1);
  });

  it('a NEEDS_INPUT line surfaces the question', async () => {
    const h = harness([
      planTurn,
      () => ({
        json: {
          status: 'SUCCESS',
          conversation_id: 'c1',
          response: 'stuck\nNEEDS_INPUT: which file?',
        },
      }),
    ]);
    await h.lc.delegate(delegateInput(h.repo));
    const a = await h.lc.approve({ requestId: 'r2', localId: 't1' });
    expect(a).toMatchObject({
      state: 'IMPLEMENTED',
      requiresAttention: true,
      question: 'which file?',
    });
    // The implement prompt asks for the marker.
    expect(h.calls[1]?.args.some((a) => a.includes('NEEDS_INPUT:'))).toBe(true);
  });

  it('a failed delegate turn leaves a FAILED task with its worktree', async () => {
    const h = harness([
      () => ({
        exitCode: 3,
        stderr: 'model exploded',
        json: { status: 'ERROR' },
      }),
    ]);
    const d = await h.lc.delegate(delegateInput(h.repo));
    expect(d).toMatchObject({
      ok: false,
      code: 'AGY_MODEL_ERROR',
      state: 'FAILED',
    });
    expect(fs.existsSync(path.join(h.deps.worktreeRoot, 't1'))).toBe(true);
  });

  it('a quota refusal leaves no worktree, branch or request behind', async () => {
    const h = harness([], {
      quotaGate: async () => {
        throw new AgyError('AGY_QUOTA_LOW', 'low');
      },
    });
    await expect(h.lc.delegate(delegateInput(h.repo))).rejects.toMatchObject({
      code: 'AGY_QUOTA_LOW',
    });
    const j = readJournal(h.deps.dataDir);
    expect(j.requests).toEqual({});
    expect(j.activeRun).toBeUndefined();
    expect(fs.existsSync(path.join(h.deps.worktreeRoot, 't1'))).toBe(false);
    expect(git(h.repo, 'branch', '--list', 'agy/t1')).toBe('');
  });

  it('refuses a second run while one is live, and settles a dead claim', async () => {
    const h = harness([planTurn], { isAlive: (pid) => pid === 4242 });
    const dir = h.deps.dataDir;
    fs.mkdirSync(dir, { recursive: true });
    const live = {
      requestId: 'x',
      op: 'reply' as const,
      localId: 'other',
      ownerPid: 4242,
      startedAt: new Date().toISOString(),
    };
    writeJournal(dir, {
      version: 1,
      tasks: {},
      requests: {},
      usage: [],
      activeRun: live,
    });
    await expect(h.lc.delegate(delegateInput(h.repo))).rejects.toMatchObject({
      code: 'AGY_BUSY',
    });
    writeJournal(dir, {
      version: 1,
      tasks: {},
      requests: {},
      usage: [],
      activeRun: { ...live, ownerPid: 1111 },
    });
    await expect(h.lc.delegate(delegateInput(h.repo))).resolves.toMatchObject({
      state: 'PLAN_PENDING',
    });
  });

  it('a dead claim whose agy child started still counts against the quota', async () => {
    const h = harness([planTurn], { isAlive: () => false });
    const dir = h.deps.dataDir;
    fs.mkdirSync(dir, { recursive: true });
    writeJournal(dir, {
      version: 1,
      tasks: {},
      requests: {},
      usage: [],
      activeRun: {
        requestId: 'x',
        op: 'reply',
        localId: 'other',
        ownerPid: 1111,
        childPid: 2222,
        startedAt: new Date().toISOString(),
      },
    });
    await h.lc.delegate(delegateInput(h.repo));
    expect(readJournal(dir).usage.map((u) => u.requestId)).toContain('x');
  });

  it('a crash between creating the worktree and recording its base leaks no branch', async () => {
    const h = harness([planTurn], { isAlive: () => false });
    const dir = h.deps.dataDir;
    fs.mkdirSync(dir, { recursive: true });
    const worktree = path.join(h.deps.worktreeRoot, 't0');
    await createWorktree(h.deps.exec, {
      repo: h.repo,
      worktree,
      branch: 'agy/t0',
      remote: 'origin',
      baseBranch: 'main',
    });
    const at = new Date().toISOString();
    writeJournal(dir, {
      version: 1,
      tasks: {},
      requests: {
        r0: {
          requestId: 'r0',
          op: 'delegate',
          localId: 't0',
          status: 'pending',
          outcome: { worktree, branch: 'agy/t0', repo: h.repo },
          at,
        },
      },
      usage: [],
      activeRun: {
        requestId: 'r0',
        op: 'delegate',
        localId: 't0',
        ownerPid: 1111,
        startedAt: at,
      },
    });
    await h.lc.delegate(delegateInput(h.repo));
    expect(fs.existsSync(worktree)).toBe(false);
    expect(git(h.repo, 'branch', '--list', 'agy/t0')).toBe('');
    expect(readJournal(dir).requests['r0']?.outcome).toMatchObject({
      code: 'AGY_INTERRUPTED',
    });
  });

  it('a refused implement profile releases the claim', async () => {
    const h = harness([planTurn], {
      allowCommands: ['pnpm test'],
      sandboxVerified: false,
    });
    await h.lc.delegate(delegateInput(h.repo));
    await expect(
      h.lc.approve({ requestId: 'r2', localId: 't1' })
    ).rejects.toMatchObject({ code: 'AGY_SETTINGS' });
    const j = readJournal(h.deps.dataDir);
    expect(j.activeRun).toBeUndefined();
    expect(j.requests['r2']).toBeUndefined();
    await expect(
      h.lc.abandon({ requestId: 'r3', localId: 't1' })
    ).resolves.toMatchObject({ state: 'ABANDONED' });
  });

  it('a quota refusal leaves partial edits unresolved', async () => {
    let refuse = false;
    const h = harness(
      [
        planTurn,
        () => ({ cancelled: true, signal: 'SIGTERM', exitCode: null }),
      ],
      {
        quotaGate: async () => {
          if (refuse) throw new AgyError('AGY_QUOTA', 'quota');
        },
      }
    );
    await h.lc.delegate(delegateInput(h.repo));
    await h.lc.approve({ requestId: 'r2', localId: 't1' });
    refuse = true;
    await expect(
      h.lc.reply({
        requestId: 'r3',
        localId: 't1',
        message: 'retry',
        resetPartial: true,
      })
    ).rejects.toMatchObject({ code: 'AGY_QUOTA' });
    expect(readJournal(h.deps.dataDir).tasks['t1']?.partial).toBeDefined();
  });

  it('a timed-out plan turn fails with AGY_TIMEOUT', async () => {
    const h = harness([
      () => ({
        killedByDeadline: true,
        json: {
          status: 'SUCCESS',
          conversation_id: 'c1',
          structured_output: PLAN,
        },
      }),
    ]);
    expect(await h.lc.delegate(delegateInput(h.repo))).toMatchObject({
      ok: false,
      code: 'AGY_TIMEOUT',
      state: 'FAILED',
    });
  });

  it('redacts secret-shaped text in the stored plan', async () => {
    const secret = 'sk-' + 'a'.repeat(24);
    const h = harness([
      () => ({
        json: {
          status: 'SUCCESS',
          conversation_id: 'c1',
          structured_output: { ...PLAN, steps: [`use ${secret}`] },
        },
      }),
    ]);
    await h.lc.delegate(delegateInput(h.repo));
    const text = fs.readFileSync(
      path.join(h.deps.dataDir, 'journal.json'),
      'utf8'
    );
    expect(text).not.toContain(secret);
    const plan = readJournal(h.deps.dataDir).tasks['t1']?.plan as
      | { steps: string[] }
      | undefined;
    expect(plan?.steps[0]).toContain('REDACTED');
  });

  it('collect refuses while any run is live', async () => {
    const h = harness([planTurn], { isAlive: (pid) => pid === 4242 });
    await h.lc.delegate(delegateInput(h.repo));
    const j = readJournal(h.deps.dataDir);
    writeJournal(h.deps.dataDir, {
      ...j,
      activeRun: {
        requestId: 'x',
        op: 'reply',
        localId: 'other',
        ownerPid: 4242,
        startedAt: new Date().toISOString(),
      },
    });
    await expect(h.lc.collect('t1')).rejects.toMatchObject({
      code: 'AGY_BUSY',
    });
    writeJournal(h.deps.dataDir, j);
    await expect(h.lc.collect('t1')).resolves.toMatchObject({
      localId: 't1',
    });
    expect(readJournal(h.deps.dataDir).activeRun).toBeUndefined();
  });

  it('an abandon interrupted after removing the worktree settles as ABANDONED', async () => {
    const h = harness([planTurn], { isAlive: () => false });
    await h.lc.delegate(delegateInput(h.repo));
    const wt = path.join(h.deps.worktreeRoot, 't1');
    git(h.repo, 'worktree', 'remove', '--force', wt);
    const j = readJournal(h.deps.dataDir);
    const at = new Date().toISOString();
    writeJournal(h.deps.dataDir, {
      ...j,
      requests: {
        ...j.requests,
        a1: {
          requestId: 'a1',
          op: 'abandon',
          localId: 't1',
          status: 'pending',
          at,
        },
      },
      activeRun: {
        requestId: 'a1',
        op: 'abandon',
        localId: 't1',
        ownerPid: 1111,
        startedAt: at,
      },
    });
    expect(h.lc.status('t1')[0]?.state).toBe('PLAN_PENDING');
    await expect(h.lc.collect('t1')).rejects.toMatchObject({
      code: 'AGY_INVALID_INPUT',
    });
    expect(readJournal(h.deps.dataDir).tasks['t1']?.state).toBe('ABANDONED');
    expect(readJournal(h.deps.dataDir).requests['a1']?.status).toBe('done');
  });

  it('refuses an invalid prompt before creating a branch, and records no usage', async () => {
    const h = harness([]);
    await expect(
      h.lc.delegate({ ...delegateInput(h.repo), prompt: '--settings=x' })
    ).rejects.toMatchObject({ code: 'AGY_INVALID_INPUT' });
    expect(git(h.repo, 'branch', '--list', 'agy/t1')).toBe('');
    expect(fs.existsSync(path.join(h.deps.worktreeRoot, 't1'))).toBe(false);
    const j = readJournal(h.deps.dataDir);
    expect(j.usage).toEqual([]);
    expect(j.activeRun).toBeUndefined();
  });

  it('records usage only for turns that spawned', async () => {
    const h = harness([planTurn]);
    await h.lc.delegate(delegateInput(h.repo));
    expect(readJournal(h.deps.dataDir).usage).toHaveLength(1);
  });

  it('abandon collects, removes the worktree and keeps the branch', async () => {
    const h = harness([planTurn, editTurn('x\n')]);
    await h.lc.delegate(delegateInput(h.repo));
    await h.lc.approve({ requestId: 'r2', localId: 't1' });
    const out = await h.lc.abandon({ requestId: 'r3', localId: 't1' });
    expect(out.state).toBe('ABANDONED');
    expect(fs.existsSync(path.join(h.deps.worktreeRoot, 't1'))).toBe(false);
    expect(git(h.repo, 'branch', '--list', 'agy/t1').trim()).toBe('agy/t1');
    expect(
      fs.readFileSync(
        path.join(h.deps.dataDir, 'artifacts', 't1', 'uncommitted.patch'),
        'utf8'
      )
    ).toContain('+x');
  });

  it('abandon removes a patch whose edits were reverted after collect', async () => {
    const h = harness([planTurn, editTurn('x\n')]);
    await h.lc.delegate(delegateInput(h.repo));
    await h.lc.approve({ requestId: 'r2', localId: 't1' });
    const c = await h.lc.collect('t1');
    expect(c.uncommittedPatch).toBeDefined();
    fs.rmSync(path.join(h.deps.worktreeRoot, 't1', 'b.txt'));
    await h.lc.abandon({ requestId: 'r3', localId: 't1' });
    const dir = path.join(h.deps.dataDir, 'artifacts', 't1');
    expect(fs.existsSync(path.join(dir, 'uncommitted.patch'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'commits.patch'))).toBe(false);
  });

  it('a correction with no valid plan drops the old one and blocks approve', async () => {
    const h = harness([
      planTurn,
      () => ({
        json: { status: 'SUCCESS', conversation_id: 'c1', response: 'hmm' },
      }),
    ]);
    await h.lc.delegate(delegateInput(h.repo));
    const c = await h.lc.reply({
      requestId: 'r2',
      localId: 't1',
      message: 'redo',
      correction: true,
    });
    expect(c).toMatchObject({ state: 'PLAN_PENDING', requiresAttention: true });
    expect(c).not.toHaveProperty('plan');
    await expect(
      h.lc.approve({ requestId: 'r3', localId: 't1' })
    ).rejects.toMatchObject({ code: 'AGY_INVALID_INPUT' });
    expect(h.calls).toHaveLength(2);
  });

  it('flags secret-shaped content in collected patches', async () => {
    const h = harness([
      planTurn,
      editTurn('key = AIzaSyA1234567890abcdefghijklmnop\n'),
    ]);
    await h.lc.delegate(delegateInput(h.repo));
    await h.lc.approve({ requestId: 'r2', localId: 't1' });
    const c = await h.lc.collect('t1');
    expect(c).toMatchObject({
      secretShapedContent: true,
      requiresAttention: true,
    });
  });

  it('refuses an invalid implement reply before snapshotting or claiming', async () => {
    const h = harness([planTurn, editTurn('x\n')]);
    await h.lc.delegate(delegateInput(h.repo));
    await h.lc.approve({ requestId: 'r2', localId: 't1' });
    await expect(
      h.lc.reply({ requestId: 'r3', localId: 't1', message: '--settings=x' })
    ).rejects.toMatchObject({ code: 'AGY_INVALID_INPUT' });
    expect(h.calls).toHaveLength(2);
    const j = readJournal(h.deps.dataDir);
    expect(j.activeRun).toBeUndefined();
    expect(j.requests['r3']).toBeUndefined();
    expect(j.tasks['t1']?.state).toBe('IMPLEMENTED');
  });

  it('approve needs a valid plan', async () => {
    const h = harness([
      () => ({
        json: { status: 'SUCCESS', conversation_id: 'c1', response: 'no plan' },
      }),
    ]);
    const d = await h.lc.delegate(delegateInput(h.repo));
    expect(d.requiresAttention).toBe(true);
    await expect(
      h.lc.approve({ requestId: 'r2', localId: 't1' })
    ).rejects.toMatchObject({ code: 'AGY_INVALID_INPUT' });
  });

  describe('under a grant', () => {
    function granted(steps: Step[], extra: Partial<LifecycleDeps> = {}) {
      const now = new Date();
      const h0 = harness([]);
      const g = buildGrant(
        {
          repo: h0.repo,
          branchPattern: 'agy/*',
          operations: 'create,approve,reply,collect',
          maxTotalTasks: 1,
        },
        now
      );
      const h = harness(steps, { grantId: g.grantId, ...extra });
      fs.mkdirSync(h.deps.dataDir, { recursive: true, mode: 0o700 });
      writeJournal(
        h.deps.dataDir,
        putGrant(
          { version: 1, tasks: {}, requests: {}, usage: [] },
          { ...g, repo: h.repo }
        )
      );
      return { h, g };
    }

    it('charges a task, records the grant, and refuses past the limit', async () => {
      const { h, g } = granted([planTurn]);
      await h.lc.delegate(delegateInput(h.repo));
      const j = readJournal(h.deps.dataDir);
      expect(j.grants?.[g.grantId]?.totalTasks).toBe(1);
      expect(j.tasks['t1']?.grantId).toBe(g.grantId);
      await expect(
        h.lc.delegate({ ...delegateInput(h.repo), requestId: 'r9' })
      ).rejects.toMatchObject({ code: 'AGY_GRANT_EXHAUSTED' });
      await expect(
        h.lc.delegate({
          ...delegateInput(h.repo),
          requestId: 'r8',
          branch: 'main2',
        })
      ).rejects.toMatchObject({ code: 'AGY_AUTHORITY_DENIED' });
    });

    it('gives the task back when the quota gate refuses', async () => {
      const { h, g } = granted([], {
        quotaGate: async () => {
          throw new AgyError('AGY_QUOTA_LOW', 'low');
        },
      });
      await expect(h.lc.delegate(delegateInput(h.repo))).rejects.toMatchObject({
        code: 'AGY_QUOTA_LOW',
      });
      const j = readJournal(h.deps.dataDir);
      expect(j.grants?.[g.grantId]?.totalTasks).toBe(0);
      expect(j.activeRun).toBeUndefined();
    });

    it('a delegate that died before its turn gives the task back', async () => {
      const { h, g } = granted([], { isAlive: () => false });
      const j = readJournal(h.deps.dataDir);
      writeJournal(h.deps.dataDir, {
        ...putGrant(j, { ...g, repo: h.repo, totalTasks: 1 }),
        requests: {
          x: {
            requestId: 'x',
            op: 'delegate',
            localId: 'gone',
            status: 'pending',
            outcome: { grantId: g.grantId },
            at: new Date().toISOString(),
          },
        },
        activeRun: {
          requestId: 'x',
          op: 'delegate',
          localId: 'gone',
          ownerPid: 1111,
          startedAt: new Date().toISOString(),
        },
      });
      await h.lc.recover();
      const after = readJournal(h.deps.dataDir);
      expect(after.grants?.[g.grantId]?.totalTasks).toBe(0);
      expect(after.activeRun).toBeUndefined();
    });

    it('abandon still works once the grant has expired', async () => {
      const { h, g } = granted([planTurn]);
      await h.lc.delegate(delegateInput(h.repo));
      const later = new Lifecycle({
        ...h.deps,
        now: () => new Date(Date.parse(g.expiresAt) + 1),
      });
      await expect(
        later.approve({ requestId: 'r2', localId: 't1' })
      ).rejects.toMatchObject({ code: 'AGY_GRANT_EXPIRED' });
      const out = await later.abandon({ requestId: 'r3', localId: 't1' });
      expect(out.state).toBe('ABANDONED');
    });
  });
});
