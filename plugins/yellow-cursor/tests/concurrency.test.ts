import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { delegate, type RuntimeDeps } from '../src/runtime.js';

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
    path.join(os.tmpdir(), 'yellow-cursor-concurrency-')
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

const REPO = 'https://github.com/org/repo';

describe('--max-active enforcement', () => {
  it('refuses to launch when active agents for the repo already meet the max', async () => {
    adapter.listAgentsImpl = async () => ({
      items: [
        {
          agentId: 'bc-1',
          name: 'a',
          summary: '',
          status: 'running',
          archived: false,
          metadata: {},
          repository: REPO,
        },
        {
          agentId: 'bc-2',
          name: 'a',
          summary: '',
          status: 'running',
          archived: false,
          metadata: {},
          repository: REPO,
        },
      ],
    });

    await expect(
      delegate(deps, {
        repoUrl: REPO,
        prompt: 'go',
        idempotencyKey: 'over-limit',
        maxActive: 2,
        yes: true,
        dryRun: false,
        autoCreatePr: true,
      })
    ).rejects.toMatchObject({ appError: { code: 'CURSOR_CONCURRENCY_LIMIT' } });
  });

  it('only counts running agents for the SAME repository', async () => {
    adapter.listAgentsImpl = async () => ({
      items: [
        {
          agentId: 'bc-1',
          name: 'a',
          summary: '',
          status: 'running',
          archived: false,
          metadata: {},
          repository: 'https://github.com/org/other',
        },
        {
          agentId: 'bc-2',
          name: 'a',
          summary: '',
          status: 'finished',
          archived: false,
          metadata: {},
          repository: REPO,
        },
      ],
    });

    const result = await delegate(deps, {
      repoUrl: REPO,
      prompt: 'go',
      idempotencyKey: 'under-limit',
      maxActive: 1,
      yes: true,
      dryRun: false,
      autoCreatePr: true,
    });
    expect(result.status).toBe('running');
  });

  it('allows launch when under the limit', async () => {
    adapter.listAgentsImpl = async () => ({ items: [] });
    const result = await delegate(deps, {
      repoUrl: REPO,
      prompt: 'go',
      idempotencyKey: 'ok-key',
      maxActive: 3,
      yes: true,
      dryRun: false,
      autoCreatePr: true,
    });
    expect(result.status).toBe('running');
  });

  it('counts a local pending-launch reservation toward max-active under the lock', async () => {
    adapter.listAgentsImpl = async () => ({ items: [] });
    const { upsertRecord } = await import('../src/state.js');
    await upsertRecord(deps.stateFilePath, {
      repository: REPO,
      status: 'pending-launch',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      idempotencyKey: 'other-in-flight',
    });

    await expect(
      delegate(deps, {
        repoUrl: REPO,
        prompt: 'go',
        idempotencyKey: 'new-key',
        maxActive: 1,
        yes: true,
        dryRun: false,
        autoCreatePr: true,
      })
    ).rejects.toMatchObject({ appError: { code: 'CURSOR_CONCURRENCY_LIMIT' } });
  });
});

describe('nested-delegation guard', () => {
  it('refuses to delegate when YELLOW_REMOTE_AGENT_CONTEXT is set, without touching the network', async () => {
    deps = { ...deps, env: { YELLOW_REMOTE_AGENT_CONTEXT: '1' } };
    let listCalled = false;
    adapter.listAgentsImpl = async () => {
      listCalled = true;
      return { items: [] };
    };
    let createCalled = false;
    adapter.createImpl = async () => {
      createCalled = true;
      throw new Error('should not be reached');
    };

    await expect(
      delegate(deps, {
        repoUrl: REPO,
        prompt: 'go',
        idempotencyKey: 'nested-key',
        maxActive: 3,
        yes: true,
        dryRun: false,
        autoCreatePr: true,
      })
    ).rejects.toMatchObject({ appError: { code: 'CURSOR_NESTED_DELEGATION' } });

    expect(listCalled).toBe(false);
    expect(createCalled).toBe(false);
  });

  it('refuses a nested follow-up too', async () => {
    deps = { ...deps, env: { YELLOW_REMOTE_AGENT_CONTEXT: '1' } };
    const { followUp } = await import('../src/runtime.js');
    await expect(
      followUp(deps, {
        agentId: 'bc-00000000-0000-0000-0000-000000000000',
        prompt: 'go',
        yes: true,
        idempotencyKey: 'k',
      })
    ).rejects.toMatchObject({ appError: { code: 'CURSOR_NESTED_DELEGATION' } });
  });
});
