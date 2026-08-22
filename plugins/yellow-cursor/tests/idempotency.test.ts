import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AdapterError } from '../src/errors.js';
import { delegate, type RuntimeDeps } from '../src/runtime.js';
import { readIndex } from '../src/state.js';

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
    path.join(os.tmpdir(), 'yellow-cursor-idem-')
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

function baseArgs(overrides: Partial<Parameters<typeof delegate>[1]> = {}) {
  return {
    repoUrl: 'https://github.com/org/repo',
    prompt: 'do the thing',
    idempotencyKey: 'fixed-key',
    maxActive: 3,
    yes: true,
    dryRun: false,
    autoCreatePr: true,
    ...overrides,
  };
}

describe('duplicate idempotency key', () => {
  it('refuses a second delegate with the same key while the first is non-terminal, without touching the network', async () => {
    await delegate(deps, baseArgs());

    let listCalls = 0;
    adapter.listAgentsImpl = async () => {
      listCalls += 1;
      return { items: [] };
    };

    await expect(delegate(deps, baseArgs())).rejects.toMatchObject({
      appError: { code: 'CURSOR_DUPLICATE_LAUNCH' },
    });
    expect(listCalls).toBe(0);
  });

  it('allows a retry with the same key once the prior attempt reached a terminal state', async () => {
    adapter.sendImpl = async () => {
      throw new AdapterError('auth', 'bad key', { isRetryable: false });
    };
    await expect(delegate(deps, baseArgs())).rejects.toThrow();

    adapter.sendImpl = async (state) => ({
      id: 'run-retry',
      agentId: state.agentId,
      status: 'running',
      branches: [],
    });
    // A definite (non-ambiguous) failure marks the record 'error', which is terminal, so retrying is allowed.
    const result = await delegate(deps, baseArgs());
    expect(result.status).toBe('running');
  });
});

describe('unknown-outcome marking', () => {
  it('marks the state record unknown when send() fails ambiguously after create()', async () => {
    adapter.sendImpl = async () => {
      throw new AdapterError(
        'service_unavailable',
        'timeout talking to Cursor',
        { isRetryable: false }
      );
    };

    await expect(delegate(deps, baseArgs())).rejects.toMatchObject({
      appError: { code: 'CURSOR_UNKNOWN_OUTCOME' },
    });

    const { index } = await readIndex(deps.stateFilePath);
    expect(index['fixed-key']?.status).toBe('unknown');
    expect(index['fixed-key']?.agentId).toBeDefined();
  });

  it('a duplicate-launch check on an "unknown" record still refuses (unknown is non-terminal)', async () => {
    adapter.sendImpl = async () => {
      throw new AdapterError('service_unavailable', 'timeout', {
        isRetryable: false,
      });
    };
    await expect(delegate(deps, baseArgs())).rejects.toThrow();

    await expect(delegate(deps, baseArgs())).rejects.toMatchObject({
      appError: { code: 'CURSOR_DUPLICATE_LAUNCH' },
    });
  });
});

describe('reconcile by metadata', () => {
  it('carries the idempotency key as agent metadata so remote listing can find it later', async () => {
    const result = await delegate(deps, baseArgs());
    const info = await adapter.getAgent(result.agentId as string);
    expect(info.metadata['yellowIdempotencyKey']).toBe('fixed-key');
  });
});
