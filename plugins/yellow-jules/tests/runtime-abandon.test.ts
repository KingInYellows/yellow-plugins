import * as fs from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadGrants } from '../src/authority.js';
import { ACTIVE_GRANT_ENV } from '../src/authorize.js';
import { controllerFilePath } from '../src/controller.js';
import {
  AdapterError,
  AppErrorException,
  type AppErrorCode,
} from '../src/errors.js';
import { abandon, delegate } from '../src/mutations.js';
import { status } from '../src/runtime.js';
import { readJournal } from '../src/state.js';

import {
  createGrant,
  type GrantHarness,
  makeHarness,
} from './support/grants.js';

let h: GrantHarness;
let grantId: string;
let requestId: string;

async function codeOf(run: () => Promise<unknown>): Promise<AppErrorCode> {
  try {
    await run();
  } catch (err) {
    if (err instanceof AppErrorException) return err.appError.code;
    throw err;
  }
  throw new Error('expected an AppErrorException');
}

/** A create whose POST was dropped after dispatch and that the vendor never listed. */
async function strandedCreate(): Promise<string> {
  h.adapter.createSessionImpl = async () => {
    throw new AdapterError('network', 'reset', { dispatched: true });
  };
  try {
    await delegate(h.deps, {
      repo: 'acme/widgets',
      branch: 'scratch/one',
      prompt: 'do it',
      taskRef: 't1',
      dryRun: false,
      correction: false,
      grantId,
      requestId: 'stranded-req',
    });
  } catch (err) {
    if (!(err instanceof AppErrorException)) throw err;
  }
  return 'stranded-req';
}

beforeEach(async () => {
  h = makeHarness('correct');
  grantId = await createGrant(h);
  requestId = await strandedCreate();
});
afterEach(() => {
  h.cleanup();
});

describe('abandon', () => {
  it('before a reconcile said ambiguous or not-reached it is JULES_INVALID_STATE', async () => {
    const opened = h.tty.opened;
    expect(await codeOf(() => abandon(h.deps, { requestId }))).toBe(
      'JULES_INVALID_STATE'
    );
    // Rejected before any terminal prompt.
    expect(h.tty.opened).toBe(opened);
  });

  it('an unknown request id is JULES_NOT_FOUND', async () => {
    expect(await codeOf(() => abandon(h.deps, { requestId: 'nope' }))).toBe(
      'JULES_NOT_FOUND'
    );
  });

  it('after an ambiguous reconcile, a typed challenge marks it failed and frees the guard and the slot', async () => {
    const reconciled = await status(h.deps, { reconcile: true });
    expect(reconciled.reconciled).toEqual([
      expect.objectContaining({
        localRequestId: requestId,
        outcome: 'ambiguous-reconcile',
        reason: 'archive-visibility-unverified',
      }),
    ]);
    expect(
      loadGrants(h.dataDir).grants[grantId]?.usage.activeSessionRefs
    ).toEqual([requestId]);

    const result = await abandon(h.deps, { requestId });
    expect(result).toMatchObject({
      operation: 'abandon',
      localRequestId: requestId,
      abandoned: true,
      released: { grantId, slotReleased: true },
    });

    const record = (await readJournal(h.dataDir)).operations[requestId];
    expect(record?.status).toBe('failed');
    expect(record?.abandonedAt).toBeDefined();
    expect(record?.abandonReason).toBe(
      'ambiguous-reconcile: archive-visibility-unverified'
    );
    const usage = loadGrants(h.dataDir).grants[grantId]?.usage;
    expect(usage?.activeSessionRefs).toEqual([]);
    // The task stays spent.
    expect(usage?.totalTasks).toBe(1);

    // The guard is free: the same repository and branch can be delegated again.
    h.adapter.restoreWrites();
    const again = await delegate(h.deps, {
      repo: 'acme/widgets',
      branch: 'scratch/one',
      prompt: 'do it again',
      taskRef: 't1',
      dryRun: false,
      correction: false,
      grantId,
    });
    expect(again).toHaveProperty('sessionResource');
  });

  it('prints the request id, repository, branch and outcome on the terminal', async () => {
    await status(h.deps, { reconcile: true });
    await abandon(h.deps, { requestId });
    const prompt = h.tty.written.join('');
    expect(prompt).toContain(requestId);
    expect(prompt).toContain('acme/widgets');
    expect(prompt).toContain('scratch/one');
    expect(prompt).toContain('archive-visibility-unverified');
  });

  it('without a terminal it changes nothing', async () => {
    await status(h.deps, { reconcile: true });
    const noTty = { ...h.deps, openTty: makeHarness('no-tty').tty.openTty };
    expect(await codeOf(() => abandon(noTty, { requestId }))).toBe(
      'JULES_CONFIRMATION_REQUIRED'
    );
    expect((await readJournal(h.dataDir)).operations[requestId]?.status).toBe(
      'unknown-outcome'
    );
  });

  it.each(['wrong', 'eof', 'timeout'] as const)(
    'a %s answer changes nothing',
    async (mode) => {
      await status(h.deps, { reconcile: true });
      const bad = { ...h.deps, openTty: makeHarness(mode).tty.openTty };
      await expect(abandon(bad, { requestId })).rejects.toBeInstanceOf(
        AppErrorException
      );
      expect((await readJournal(h.dataDir)).operations[requestId]?.status).toBe(
        'unknown-outcome'
      );
      expect(
        loadGrants(h.dataDir).grants[grantId]?.usage.activeSessionRefs
      ).toEqual([requestId]);
    }
  );

  it('refuses inside a supervised session', async () => {
    await status(h.deps, { reconcile: true });
    const deps = {
      ...h.deps,
      env: { ...h.deps.env, [ACTIVE_GRANT_ENV]: grantId },
    };
    expect(await codeOf(() => abandon(deps, { requestId }))).toBe(
      'JULES_AUTHORITY_DENIED'
    );
  });

  it('a controller mismatch refuses BEFORE any write: the record stays unresolved and the slot stays held', async () => {
    await status(h.deps, { reconcile: true });
    fs.rmSync(controllerFilePath(h.controllerDir, 'testhost'));
    expect(await codeOf(() => abandon(h.deps, { requestId }))).toBe(
      'JULES_CONTROLLER_MISMATCH'
    );
    const record = (await readJournal(h.dataDir)).operations[requestId];
    expect(record?.status).toBe('unknown-outcome');
    expect(record?.abandonedAt).toBeUndefined();
    expect(
      loadGrants(h.dataDir).grants[grantId]?.usage.activeSessionRefs
    ).toEqual([requestId]);
  });

  it('a record that was already settled is not abandonable', async () => {
    await status(h.deps, { reconcile: true });
    await abandon(h.deps, { requestId });
    expect(await codeOf(() => abandon(h.deps, { requestId }))).toBe(
      'JULES_INVALID_STATE'
    );
  });
});
