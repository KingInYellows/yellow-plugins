import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AdapterError, toAppError } from '../src/errors.js';
import {
  archive,
  cancel,
  delegate,
  followUp,
  list,
  unarchive,
  type RuntimeDeps,
} from '../src/runtime.js';

import {
  FakeSdkAdapter,
  makeFakeClock,
  resetFakeSdkSequence,
} from './fake-sdk.js';

let tmpDir: string;
let deps: RuntimeDeps;
let adapter: FakeSdkAdapter;

beforeEach(async () => {
  resetFakeSdkSequence();
  tmpDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'yellow-cursor-lifecycle-')
  );
  adapter = new FakeSdkAdapter();
  deps = {
    adapter,
    dataDir: tmpDir,
    stateFilePath: path.join(tmpDir, 'state', 'agents.json'),
    clock: makeFakeClock(),
    env: {},
  };
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

describe('create-lazy / send-real semantics', () => {
  it('never returns ok-shaped success when create() succeeds but send() fails', async () => {
    let createCalled = false;
    adapter.createImpl = async (options) => {
      createCalled = true;
      const state = {
        agentId: 'bc-lazy-created',
        name: 'agent',
        summary: '',
        status: 'running' as const,
        archived: false,
        metadata: { yellowIdempotencyKey: options.idempotencyKey },
        createdAt: new Date().toISOString(),
        runs: new Map(),
        repository: options.repoUrl,
      };
      adapter.agents.set(state.agentId, state);
      return state;
    };
    adapter.sendImpl = async () => {
      throw new AdapterError('auth', 'Invalid User API Key', {
        isRetryable: false,
      });
    };

    let caught: unknown;
    try {
      await delegate(deps, {
        repoUrl: 'https://github.com/org/repo',
        prompt: 'do it',
        idempotencyKey: 'lazy-key',
        maxActive: 3,
        yes: true,
        dryRun: false,
        autoCreatePr: true,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    // A definite (non-ambiguous) adapter failure propagates as the raw AdapterError — cli.ts's
    // toAppError() boundary is what normalizes it, so assert through that same conversion here.
    expect(toAppError(caught).code).toBe('CURSOR_AUTH_FAILED');

    expect(createCalled).toBe(true);
    // The agent WAS minted server-side even though the operation is reported as a failure.
    expect(adapter.agents.has('bc-lazy-created')).toBe(true);
  });
});

describe('cancel TOCTOU re-fetch', () => {
  it('re-fetches the run immediately before cancelling and reports idempotent success on an already-terminal run', async () => {
    const handle = await adapter.createAgent({
      repoUrl: 'https://github.com/org/repo',
      autoCreatePR: true,
      idempotencyKey: 'k1',
    });
    const run = await handle.send('go', { idempotencyKey: 'k1' });
    const state = adapter.agents.get(handle.agentId);
    state?.runs.set(run.id, { ...run, status: 'finished' });

    let cancelCalled = false;
    adapter.cancelRunImpl = async () => {
      cancelCalled = true;
    };

    const result = await cancel(deps, {
      runId: run.id,
      agentId: handle.agentId,
      yes: true,
    });
    expect(result.alreadyTerminal).toBe(true);
    expect(result.status).toBe('finished');
    expect(cancelCalled).toBe(false);
  });

  it('cancels an active run and reports the post-cancel status', async () => {
    const handle = await adapter.createAgent({
      repoUrl: 'https://github.com/org/repo',
      autoCreatePR: true,
      idempotencyKey: 'k2',
    });
    const run = await handle.send('go', { idempotencyKey: 'k2' });

    const result = await cancel(deps, {
      runId: run.id,
      agentId: handle.agentId,
      yes: true,
    });
    expect(result.alreadyTerminal).toBe(false);
    expect(result.status).toBe('cancelled');
  });
});

describe('archive / unarchive idempotency', () => {
  it('archive on an already-archived agent is an idempotent success, not a re-archive call', async () => {
    const handle = await adapter.createAgent({
      repoUrl: 'https://github.com/org/repo',
      autoCreatePR: true,
      idempotencyKey: 'k3',
    });
    const state = adapter.agents.get(handle.agentId);
    if (state) state.status = 'finished';
    await archive(deps, { agentId: handle.agentId, yes: true, force: false });

    let archiveCalled = false;
    adapter.archiveAgentImpl = async () => {
      archiveCalled = true;
    };
    const result = await archive(deps, {
      agentId: handle.agentId,
      yes: true,
      force: false,
    });
    expect(result.alreadyInState).toBe(true);
    expect(archiveCalled).toBe(false);
  });

  it('unarchive on a not-archived agent is an idempotent success', async () => {
    const handle = await adapter.createAgent({
      repoUrl: 'https://github.com/org/repo',
      autoCreatePR: true,
      idempotencyKey: 'k4',
    });
    const result = await unarchive(deps, {
      agentId: handle.agentId,
      yes: true,
    });
    expect(result.alreadyInState).toBe(true);
  });

  it('refuses to archive an agent with an active run unless --force is passed', async () => {
    const handle = await adapter.createAgent({
      repoUrl: 'https://github.com/org/repo',
      autoCreatePR: true,
      idempotencyKey: 'k5',
    });
    await handle.send('go', { idempotencyKey: 'k5' });

    await expect(
      archive(deps, { agentId: handle.agentId, yes: true, force: false })
    ).rejects.toMatchObject({
      appError: { code: 'CURSOR_AGENT_BUSY' },
    });

    const result = await archive(deps, {
      agentId: handle.agentId,
      yes: true,
      force: true,
    });
    expect(result.alreadyInState).toBe(false);
  });
});

describe('follow-up re-fetches agent state before sending', () => {
  it('refuses a follow-up on an archived agent', async () => {
    const handle = await adapter.createAgent({
      repoUrl: 'https://github.com/org/repo',
      autoCreatePR: true,
      idempotencyKey: 'k6',
    });
    const state = adapter.agents.get(handle.agentId);
    if (state) state.status = 'finished';
    await archive(deps, { agentId: handle.agentId, yes: true, force: false });

    await expect(
      followUp(deps, {
        agentId: handle.agentId,
        prompt: 'more work',
        yes: true,
        idempotencyKey: 'follow-1',
      })
    ).rejects.toMatchObject({ appError: { code: 'CURSOR_INVALID_INPUT' } });
  });
});

describe('canonical agent-id resolution (live-verified server behavior)', () => {
  // The real SDK mints a client-side PROVISIONAL id in Agent.create(); the
  // server assigns the CANONICAL id at the first send(). Live-verified
  // 2026-08-22: Agent.get/getRun 404'd the provisional id while the agent
  // existed under a different id, discoverable via the run's agentId and via
  // metadata.yellowIdempotencyKey on the cloud agent list.
  const delegateArgs = {
    repoUrl: 'https://github.com/org/repo',
    prompt: 'do it',
    idempotencyKey: 'canon-key',
    maxActive: 3,
    yes: true,
    dryRun: false,
    autoCreatePr: true,
  };

  it('prefers the send() run agentId when it differs from the provisional handle id', async () => {
    adapter.sendImpl = async (state) => {
      const run = {
        id: 'run-canon-1',
        agentId: 'bc-server-canonical-0001',
        status: 'running' as const,
        branches: [],
      };
      state.runs.set(run.id, run);
      return run;
    };

    const result = await delegate(deps, delegateArgs);
    expect(result.agentId).toBe('bc-server-canonical-0001');
  });

  it('reconciles through the metadata idempotency marker when the run echoes the provisional id', async () => {
    adapter.sendImpl = async (state) => {
      const run = {
        id: 'run-canon-2',
        // Server unhelpfully echoes the provisional id on the run.
        agentId: state.agentId,
        status: 'running' as const,
        branches: [],
      };
      state.runs.set(run.id, run);
      return run;
    };
    adapter.listAgentsImpl = async () => ({
      items: [
        {
          agentId: 'bc-other-agent-0000',
          name: 'other',
          summary: '',
          archived: false,
          metadata: { yellowIdempotencyKey: 'someone-else' },
        },
        {
          agentId: 'bc-server-canonical-0002',
          name: 'ours',
          summary: '',
          archived: false,
          metadata: { yellowIdempotencyKey: 'canon-key' },
        },
      ],
    });

    const result = await delegate(deps, delegateArgs);
    expect(result.agentId).toBe('bc-server-canonical-0002');
  });

  it('returns CURSOR_UNKNOWN_OUTCOME when reconciliation cannot resolve a canonical id', async () => {
    adapter.sendImpl = async (state) => {
      const run = {
        id: 'run-canon-3',
        agentId: state.agentId,
        status: 'running' as const,
        branches: [],
      };
      state.runs.set(run.id, run);
      return run;
    };
    adapter.listAgentsImpl = async () => ({
      items: [
        {
          agentId: 'bc-unrelated-agent-0000',
          name: 'other',
          summary: '',
          archived: false,
          metadata: { yellowIdempotencyKey: 'someone-else' },
        },
      ],
    });

    await expect(delegate(deps, delegateArgs)).rejects.toMatchObject({
      appError: { code: 'CURSOR_UNKNOWN_OUTCOME' },
    });
  });
});

describe('archive hides an agent from the default listing', () => {
  const LIVE_ID = 'bc-00000000-0000-0000-0000-000000001111';
  const ARCHIVED_ID = 'bc-00000000-0000-0000-0000-000000002222';

  function seedAgent(agentId: string, archived: boolean): void {
    adapter.agents.set(agentId, {
      agentId,
      name: agentId,
      summary: '',
      status: 'finished',
      archived,
      metadata: {},
      repository: 'https://github.com/org/repo',
      createdAt: '2026-08-22T00:00:00.000Z',
      runs: new Map(),
    });
  }

  it('omits archived agents unless --archived is requested', async () => {
    seedAgent(LIVE_ID, false);
    seedAgent(ARCHIVED_ID, true);

    const defaultList = await list(deps, {});
    expect(defaultList.items.map((i) => i.agentId)).toEqual([LIVE_ID]);
    expect(adapter.listAgentsCalls.at(-1)?.includeArchived).toBe(false);

    const withArchived = await list(deps, { archived: true });
    expect(withArchived.items.map((i) => i.agentId).sort()).toEqual(
      [ARCHIVED_ID, LIVE_ID].sort()
    );
    expect(adapter.listAgentsCalls.at(-1)?.includeArchived).toBe(true);
  });

  it('drops the agent from the default listing after archive() succeeds', async () => {
    seedAgent(LIVE_ID, false);

    await archive(deps, {
      agentId: LIVE_ID,
      yes: true,
      force: false,
    });

    const after = await list(deps, {});
    expect(after.items).toHaveLength(0);
  });
});
