import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadGrants } from '../src/authority.js';
import { authorizeRevoke, authorizeTakeOver } from '../src/authorize.js';
import { canonicalPath, resolveLockPath } from '../src/config.js';
import {
  controllerLockPath,
  readControllerAuthority,
} from '../src/controller.js';
import { status } from '../src/runtime.js';
import { withControllerLock } from '../src/state.js';
import { reserveUnderGrant } from '../src/write-gate.js';

import { codeOfAsync } from './support/app-error.js';
import {
  createGrant,
  delegateOk,
  type GrantHarness,
  makeHarness,
} from './support/grants.js';

// Two data directories on one host that share a controller id share one
// authority file (CLAUDE-182). `b` starts as a copy of `a`'s data directory.
let a: GrantHarness;
let b: GrantHarness;
let grantId: string;

beforeEach(async () => {
  a = makeHarness('correct');
  grantId = await createGrant(a, { maxActiveSessions: 3, maxTotalTasks: 10 });
  const other = makeHarness('correct');
  fs.cpSync(a.dataDir, other.dataDir, { recursive: true });
  b = {
    ...other,
    controllerDir: a.controllerDir,
    deps: { ...other.deps, controllerDir: a.controllerDir },
  };
});
afterEach(() => {
  a.cleanup();
  b.cleanup();
});

function authority() {
  const found = readControllerAuthority(a.controllerDir, 'testhost');
  if (found === undefined) throw new Error('no controller authority');
  return found;
}

/** A lock file whose holder pid has exited, as a crashed writer leaves it. */
function plantDeadControllerLock(): string {
  const child = spawnSync(process.execPath, ['-e', '']);
  const lock = controllerLockPath(a.controllerDir, 'testhost');
  fs.writeFileSync(
    lock,
    JSON.stringify({
      owner: 'crashed',
      pid: child.pid,
      hostname: os.hostname(),
      startedAt: Date.now(),
    }),
    { mode: 0o600 }
  );
  return lock;
}

describe('the controller-wide lock', () => {
  it('serializes concurrent take-overs of two data directories, so neither rolls the other back', async () => {
    const results = await Promise.allSettled([
      authorizeTakeOver(a.deps),
      authorizeTakeOver(b.deps),
    ]);
    const epochs = results.map((r) =>
      r.status === 'fulfilled' ? r.value.epoch : r.reason
    );
    expect([...epochs].sort()).toEqual([2, 3]);
    const winner = results.find(
      (r) => r.status === 'fulfilled' && r.value.epoch === 3
    );
    expect(authority()).toMatchObject({
      epoch: 3,
      dataDir:
        winner?.status === 'fulfilled' ? winner.value.dataDir : undefined,
    });
  });

  it('a take-over of another data directory waits for a write that holds the lock', async () => {
    const lock = controllerLockPath(a.controllerDir, 'testhost');
    let takeOver: Promise<unknown> | undefined;
    await withControllerLock(a.dataDir, lock, async () => {
      takeOver = authorizeTakeOver(b.deps);
      // The take-over holds b's journal lock before it tries the controller
      // lock, so wait for that; a fixed sleep would pass vacuously if the
      // take-over had not started yet.
      const journalLock = resolveLockPath(b.dataDir);
      const deadline = Date.now() + 5_000;
      while (!fs.existsSync(journalLock)) {
        if (Date.now() > deadline) throw new Error('take-over never started');
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      // Give it a few lock polls (50 ms each) to get past a held lock if it could.
      await new Promise((resolve) => setTimeout(resolve, 200));
      // Still inside a's critical section: the authority has not moved.
      expect(authority()).toMatchObject({
        epoch: 1,
        dataDir: canonicalPath(a.dataDir),
      });
    });
    await takeOver;
    expect(authority()).toMatchObject({
      epoch: 2,
      dataDir: canonicalPath(b.dataDir),
    });
    expect(fs.existsSync(lock)).toBe(false);
  });

  it('a grant-backed write fails loud on a lock a crashed writer left', async () => {
    const lock = plantDeadControllerLock();
    expect(await codeOfAsync(() => authorizeRevoke(a.deps, grantId))).toBe(
      'JULES_STALE_LOCK'
    );
    expect(loadGrants(a.dataDir).grants[grantId]?.revokedAt).toBeUndefined();
    expect(fs.existsSync(lock)).toBe(true);
  });

  it('reserving under a grant takes the lock', async () => {
    const session = await delegateOk(a, grantId);
    plantDeadControllerLock();
    expect(
      await codeOfAsync(() =>
        reserveUnderGrant(a.deps, {
          grantId,
          ownerRequestId: session.localRequestId,
          authority: {
            repository: 'acme/widgets',
            sourceResource: 'sources/github/acme/widgets',
            branch: 'scratch/one',
            taskRef: 't1',
            operation: 'reply',
          },
          reservation: {
            localRequestId: 'locked-reply',
            localId: `jl-${'e'.repeat(32)}`,
            sessionResource: session.sessionResource,
            promptDigest: 'd'.repeat(64),
          },
        })
      )
    ).toBe('JULES_STALE_LOCK');
  });

  it('reconcile persistence takes the lock before it settles anything', async () => {
    const session = await delegateOk(a, grantId);
    await reserveUnderGrant(a.deps, {
      grantId,
      ownerRequestId: session.localRequestId,
      authority: {
        repository: 'acme/widgets',
        sourceResource: 'sources/github/acme/widgets',
        branch: 'scratch/one',
        taskRef: 't1',
        operation: 'reply',
      },
      reservation: {
        localRequestId: 'pending-reply',
        localId: `jl-${'f'.repeat(32)}`,
        sessionResource: session.sessionResource,
        promptDigest: 'd'.repeat(64),
      },
    });
    plantDeadControllerLock();
    a.deps.clock.time += 60 * 60_000;
    expect(await codeOfAsync(() => status(a.deps, { reconcile: true }))).toBe(
      'JULES_STALE_LOCK'
    );
  });
});
