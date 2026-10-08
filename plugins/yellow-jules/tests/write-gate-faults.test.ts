import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loadGrants,
  releaseSlotInStore,
  writeGrants,
} from '../src/authority.js';
import { AdapterError, MutationErrorException } from '../src/errors.js';
import {
  abandon,
  delegate,
  reply,
  type DelegateArgs,
} from '../src/mutations.js';
import { status } from '../src/runtime.js';
import {
  markOperation,
  readJournal,
  withJournalLock,
  writeJournal,
} from '../src/state.js';
import { superviseOnce } from '../src/supervise.js';
import { reserveUnderGrant } from '../src/write-gate.js';

import {
  addActivity,
  createGrant,
  delegateOk,
  type GrantHarness,
  makeHarness,
  setVendorState,
} from './support/grants.js';

// Wrap the real implementations so a single call can be made to fail.
vi.mock('../src/state.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/state.js')>();
  return {
    ...actual,
    writeJournal: vi.fn(actual.writeJournal),
    markOperation: vi.fn(actual.markOperation),
  };
});
vi.mock('../src/authority.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/authority.js')>();
  return {
    ...actual,
    releaseSlotInStore: vi.fn(actual.releaseSlotInStore),
    writeGrants: vi.fn(actual.writeGrants),
  };
});

let h: GrantHarness;
let grantId: string;

beforeEach(async () => {
  vi.mocked(writeJournal).mockClear();
  vi.mocked(markOperation).mockClear();
  vi.mocked(releaseSlotInStore).mockClear();
  vi.mocked(writeGrants).mockClear();
  h = makeHarness('correct');
  grantId = await createGrant(h, { maxActiveSessions: 1, maxTotalTasks: 5 });
});
afterEach(() => {
  h.cleanup();
});

function args(overrides: Partial<DelegateArgs> = {}): DelegateArgs {
  return {
    repo: 'acme/widgets',
    branch: 'scratch/one',
    prompt: 'Implement the change described in the task.',
    taskRef: 't1',
    dryRun: false,
    correction: false,
    grantId,
    ...overrides,
  };
}

async function failure(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  throw new Error('expected a failure');
}

function usage() {
  return loadGrants(h.dataDir).grants[grantId]?.usage;
}

describe('the reservation is all-or-nothing', () => {
  it('a failed journal write undoes the grant charge, so nothing leaks', async () => {
    vi.mocked(writeJournal).mockRejectedValueOnce(new Error('disk full'));
    await expect(delegate(h.deps, args())).rejects.toThrow('disk full');
    expect(usage()?.totalTasks).toBe(0);
    expect(usage()?.activeSessionRefs).toEqual([]);
    expect(h.adapter.writeCount()).toBe(0);
    // The slot is free again.
    await expect(delegate(h.deps, args())).resolves.toMatchObject({
      operation: 'delegate',
    });
  });

  it('a secret-shaped branch is refused before the grant is charged', async () => {
    const err = await failure(() =>
      delegate(h.deps, args({ branch: 'scratch/key-AAAAAAAAAAAAAAAAAAAA' }))
    );
    expect(err).toBeInstanceOf(Error);
    expect(usage()?.totalTasks).toBe(0);
    expect(usage()?.activeSessionRefs).toEqual([]);
    expect(h.adapter.writeCount()).toBe(0);
  });

  it('a recorded request id is answered as a duplicate before the grant is judged', async () => {
    await delegate(h.deps, args({ requestId: 'dup-1' }));
    // The one-session grant is now full; the old id must still be named.
    const err = (await failure(() =>
      delegate(h.deps, args({ requestId: 'dup-1', branch: 'scratch/two' }))
    )) as MutationErrorException;
    expect(err.appError.code).toBe('JULES_DUPLICATE_LAUNCH');
    expect(err.localRequestId).toBe('dup-1');
  });

  it('a reply or approve with no owning launch cannot slip past the pause checks', async () => {
    const err = (await failure(() =>
      reserveUnderGrant(h.deps, {
        grantId,
        authority: {
          repository: 'acme/widgets',
          sourceResource: 'sources/github/acme/widgets',
          branch: 'scratch/one',
          taskRef: 't1',
          operation: 'reply',
        },
        reservation: { localRequestId: 'no-owner' },
      })
    )) as MutationErrorException;
    expect(err.appError.code).toBe('JULES_AUTHORITY_DENIED');
    expect(usage()?.totalTasks).toBe(0);
  });
});

describe('settling a clean rejection', () => {
  beforeEach(() => {
    h.adapter.createSessionImpl = async () => {
      throw new AdapterError('invalid-request', 'rejected', {
        dispatched: true,
      });
    };
  });

  it('keeps the vendor verdict when the failed-mark cannot be written', async () => {
    vi.mocked(markOperation).mockRejectedValueOnce(new Error('locked'));
    const err = (await failure(() =>
      delegate(h.deps, args({ requestId: 'rej-1' }))
    )) as MutationErrorException;
    expect(err.appError.code).toBe('JULES_INVALID_INPUT');
    expect(err.details).toMatchObject({ journalRecorded: false });
    expect((await readJournal(h.dataDir)).operations['rej-1']?.status).toBe(
      'reserved'
    );
  });

  it('reports a held slot when only the slot release fails', async () => {
    vi.mocked(releaseSlotInStore).mockRejectedValueOnce(new Error('locked'));
    const err = (await failure(() =>
      delegate(h.deps, args({ requestId: 'rej-2' }))
    )) as MutationErrorException;
    expect(err.appError.code).toBe('JULES_INVALID_INPUT');
    expect(err.details).toMatchObject({ slotReleased: false });
    expect(err.details).not.toHaveProperty('journalRecorded');
    expect((await readJournal(h.dataDir)).operations['rej-2']?.status).toBe(
      'failed'
    );
    expect(usage()?.activeSessionRefs).toEqual(['rej-2']);
  });
});

describe('a 2xx whose journal record cannot be written', () => {
  it('is an unknown outcome that names the session, never a failure to retry', async () => {
    vi.mocked(markOperation).mockRejectedValueOnce(new Error('locked'));
    const err = (await failure(() =>
      delegate(h.deps, args())
    )) as MutationErrorException;
    expect(err.appError.code).toBe('JULES_UNKNOWN_OUTCOME');
    expect(err.details?.['sessionResource']).toBeDefined();
    expect(h.adapter.callsTo('createSession')).toHaveLength(1);
  });
});

describe('outside activity blocks grant-backed writes', () => {
  async function sessionWithOutsideMessage() {
    const wide = await createGrant(h, {
      maxActiveSessions: 3,
      maxCorrectiveRounds: 2,
    });
    const session = await delegateOk(h, wide, { branch: 'scratch/o' });
    addActivity(h, session.sessionResource, {
      type: 'userMessaged',
      message: 'someone else typed this',
    });
    // A plain status records it; no supervise pass has run.
    await status(h.deps, { session: session.localId, reconcile: false });
    return { wide, session };
  }

  it('a reply is refused until the pause is cleared', async () => {
    const { wide, session } = await sessionWithOutsideMessage();
    const err = (await failure(() =>
      reply(h.deps, {
        session: session.localId,
        message: 'carry on',
        dryRun: false,
        correction: false,
        grantId: wide,
      })
    )) as MutationErrorException;
    expect(err.appError.code).toBe('JULES_SUPERVISION_PAUSED');
  });

  it('a repair launch for that task is refused too', async () => {
    const { wide } = await sessionWithOutsideMessage();
    const err = (await failure(() =>
      delegate(
        h.deps,
        args({ grantId: wide, branch: 'scratch/fix', correction: true })
      )
    )) as MutationErrorException;
    expect(err.appError.code).toBe('JULES_SUPERVISION_PAUSED');
  });
});

describe('supervise without a grant', () => {
  it('answers with the authorize command for the session, not a usage error', async () => {
    const wide = await createGrant(h, { maxActiveSessions: 3 });
    const session = await delegateOk(h, wide, { branch: 'scratch/s' });
    const err = (await failure(() =>
      superviseOnce(h.deps, { session: session.localId })
    )) as MutationErrorException;
    expect(err.appError.code).toBe('JULES_CONFIRMATION_REQUIRED');
    expect(err.appError.recoveryAction).toContain('collect,reply,approve');
    expect(err.appError.recoveryAction).toContain('YOUR_NAME');
  });
});

async function strand(requestId: string): Promise<void> {
  h.adapter.createSessionImpl = async () => {
    throw new AdapterError('network', 'reset', { dispatched: true });
  };
  await failure(() => delegate(h.deps, args({ requestId })));
  h.adapter.restoreWrites();
}

describe('abandon when the grant file cannot be written', () => {
  it('still reports the abandon, with the slot flagged as held', async () => {
    await strand('stuck-1');
    await status(h.deps, { reconcile: true });
    vi.mocked(writeGrants).mockImplementationOnce(() => {
      throw new Error('read-only');
    });
    const result = await abandon(h.deps, { requestId: 'stuck-1' });
    expect(result.abandoned).toBe(true);
    expect(result.released.slotReleased).toBe(false);
    expect((await readJournal(h.dataDir)).operations['stuck-1']?.status).toBe(
      'failed'
    );
    expect(usage()?.activeSessionRefs).toEqual(['stuck-1']);
  });
});

describe('reconcile releasing a create whose slot cannot be freed', () => {
  it('flags the stuck slot instead of hiding it in the reason text', async () => {
    await strand('stuck-2');
    await withJournalLock(h.dataDir, async () => {
      const journal = await readJournal(h.dataDir);
      await writeJournal(h.dataDir, {
        ...journal,
        archiveVisibilityConfirmed: true,
      });
    });
    vi.mocked(releaseSlotInStore).mockRejectedValueOnce(new Error('locked'));
    const result = await status(h.deps, { reconcile: true });
    expect(result.reconciled).toEqual([
      expect.objectContaining({
        localRequestId: 'stuck-2',
        outcome: 'released',
        slotStuck: true,
      }),
    ]);
    expect(result.requiresAttention).toBe(true);
    expect(result.attention).toContain('reconciled:slotStuck');
    expect(usage()?.activeSessionRefs).toEqual(['stuck-2']);
  });
});

describe('status on a finished session when the slot cannot be released', () => {
  it('still reads the session and flags the held slot', async () => {
    const wide = await createGrant(h, { maxActiveSessions: 3 });
    const session = await delegateOk(h, wide, { branch: 'scratch/done' });
    setVendorState(h, session.sessionResource, 'completed');
    vi.mocked(releaseSlotInStore).mockRejectedValueOnce(new Error('locked'));
    const result = await status(h.deps, {
      session: session.localId,
      reconcile: false,
    });
    expect(result.requiresAttention).toBe(true);
    expect(result.attention).toContain('slotStuck');
  });
});
