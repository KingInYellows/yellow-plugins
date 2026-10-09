import * as fs from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadGrants, revokeGrant } from '../src/authority.js';
import { resolveJournalPath } from '../src/config.js';
import {
  AdapterError,
  AppErrorException,
  makeAppError,
  MutationErrorException,
  type AppErrorCode,
} from '../src/errors.js';
import { reply, type ReplyArgs } from '../src/mutations.js';
import { status } from '../src/runtime.js';
import { markOperation, messageDigest, readJournal } from '../src/state.js';

import {
  createGrant,
  delegateOk,
  type DelegatedSession,
  type GrantHarness,
  makeHarness,
  revokeAfterReservation,
  setVendorState,
} from './support/grants.js';

let h: GrantHarness;
let grantId: string;
let session: DelegatedSession;

beforeEach(async () => {
  h = makeHarness('correct');
  grantId = await createGrant(h, { maxActiveSessions: 3 });
  session = await delegateOk(h, grantId);
  h.adapter.calls.length = 0;
});
afterEach(() => {
  h.cleanup();
});

const MESSAGE = 'Please also update the changelog entry.';

function args(overrides: Partial<ReplyArgs> = {}): ReplyArgs {
  return {
    session: session.localId,
    message: MESSAGE,
    dryRun: false,
    correction: false,
    grantId,
    ...overrides,
  };
}

async function fails(
  run: () => Promise<unknown>
): Promise<MutationErrorException> {
  try {
    await run();
  } catch (err) {
    if (err instanceof MutationErrorException) return err;
    throw err;
  }
  throw new Error('expected a MutationErrorException');
}

async function codeOf(run: () => Promise<unknown>): Promise<AppErrorCode> {
  return (await fails(run)).appError.code;
}

describe('reply --dry-run', () => {
  it('does one info() read, sends nothing, and needs no grant', async () => {
    const result = await reply(
      h.deps,
      args({ dryRun: true, grantId: undefined })
    );
    expect(result).toMatchObject({
      operation: 'reply',
      sessionResource: session.sessionResource,
      sent: false,
      dryRun: true,
    });
    expect(h.adapter.callsTo('getSession')).toHaveLength(1);
    expect(h.adapter.writeCount()).toBe(0);
  });

  it('reports the scope a covering grant must match', async () => {
    const result = await reply(
      h.deps,
      args({ dryRun: true, grantId: undefined })
    );
    expect(result).toMatchObject({
      repository: 'acme/widgets',
      requestedBranch: 'scratch/one',
      taskRef: 't1',
    });
  });

  it('an unknown session is JULES_NOT_FOUND', async () => {
    expect(
      await codeOf(() =>
        reply(h.deps, args({ session: 'sessions/nope', dryRun: true }))
      )
    ).toBe('JULES_NOT_FOUND');
  });
});

describe('reply without a grant', () => {
  it('JULES_CONFIRMATION_REQUIRED names the reply authorize command; nothing is read or sent', async () => {
    const err = await fails(() => reply(h.deps, args({ grantId: undefined })));
    expect(err.appError.code).toBe('JULES_CONFIRMATION_REQUIRED');
    expect(err.appError.recoveryAction).toContain("--operations 'reply'");
    expect(err.appError.recoveryAction).toContain("--task-ref 't1'");
    expect(err.localRequestId).toMatch(/^jr-/);
    expect(h.adapter.calls).toEqual([]);
  });
});

describe('unauthorized replies', () => {
  it('a grant without the reply operation', async () => {
    const other = await createGrant(h, { operations: 'create,collect' });
    expect(await codeOf(() => reply(h.deps, args({ grantId: other })))).toBe(
      'JULES_AUTHORITY_DENIED'
    );
    expect(h.adapter.writeCount()).toBe(0);
  });

  it('a grant for a different branch scope', async () => {
    const other = await createGrant(h, { branch: 'elsewhere/*' });
    expect(await codeOf(() => reply(h.deps, args({ grantId: other })))).toBe(
      'JULES_AUTHORITY_DENIED'
    );
  });

  it('a session this plugin did not create has no repo, branch or task to cover', async () => {
    h.adapter.sessions.set('sessions/ext1', {
      ...(h.adapter.sessions.get(session.sessionResource) as object),
      sessionResource: 'sessions/ext1',
    } as never);
    expect(
      await codeOf(() => reply(h.deps, args({ session: 'sessions/ext1' })))
    ).toBe('JULES_AUTHORITY_DENIED');
    expect(h.adapter.writeCount()).toBe(0);
  });

  it('a revoked grant', async () => {
    await revokeGrant(h.dataDir, grantId, new Date(h.deps.clock.now()));
    expect(await codeOf(() => reply(h.deps, args()))).toBe(
      'JULES_AUTHORITY_DENIED'
    );
  });

  it('an expired grant -> JULES_GRANT_EXPIRED with the running session and containment', async () => {
    h.deps.clock.time += 3 * 60 * 60_000;
    const err = await fails(() => reply(h.deps, args()));
    expect(err.appError.code).toBe('JULES_GRANT_EXPIRED');
    expect(err.details).toEqual({ runningSessions: [session.sessionResource] });
    expect(
      `${err.appError.message} ${err.appError.recoveryAction}`
    ).not.toMatch(/terminated|stopped/i);
    expect(h.adapter.writeCount()).toBe(0);
  });
});

describe('a covered reply', () => {
  it('sends exactly one message, records a digest, and never persists the text', async () => {
    const result = await reply(h.deps, args());
    expect(result).toMatchObject({
      operation: 'reply',
      sessionResource: session.sessionResource,
      sent: true,
    });
    expect(h.adapter.callsTo('sendMessage')).toEqual([
      { method: 'sendMessage', args: [session.sessionResource, MESSAGE] },
    ]);
    const record = (await readJournal(h.dataDir)).operations[
      result.localRequestId
    ];
    expect(record).toMatchObject({
      kind: 'reply',
      status: 'accepted',
      sessionResource: session.sessionResource,
      grantId,
      promptDigest: messageDigest(MESSAGE),
    });
    expect(
      fs.readFileSync(resolveJournalPath(h.dataDir), 'utf8')
    ).not.toContain('changelog');
  });

  it('a plain reply spends no slot, task, or round', async () => {
    const before = loadGrants(h.dataDir).grants[grantId]?.usage;
    await reply(h.deps, args());
    expect(loadGrants(h.dataDir).grants[grantId]?.usage).toEqual(before);
  });

  it('a reply row never takes over the session lookup from its create row', async () => {
    await reply(h.deps, args());
    const { findBySessionResource } = await import('../src/state.js');
    const owner = findBySessionResource(
      await readJournal(h.dataDir),
      session.sessionResource
    );
    expect(owner?.kind).toBe('create');
  });
});

describe('corrective replies (R44)', () => {
  it('spend a round on the task ref and stop at the limit', async () => {
    const tight = await createGrant(h, {
      maxActiveSessions: 3,
      maxCorrectiveRounds: 1,
    });
    await reply(h.deps, args({ grantId: tight, correction: true }));
    expect(
      loadGrants(h.dataDir).grants[tight]?.usage.correctiveRounds['t1']
    ).toBe(1);
    expect(
      await codeOf(() =>
        reply(h.deps, args({ grantId: tight, correction: true }))
      )
    ).toBe('JULES_GRANT_EXHAUSTED');
    expect(h.adapter.callsTo('sendMessage')).toHaveLength(1);
    // A non-corrective reply is still allowed.
    await reply(h.deps, args({ grantId: tight }));
    expect(h.adapter.callsTo('sendMessage')).toHaveLength(2);
  });
});

describe('replies and finished sessions', () => {
  it('a reply to a finished session is refused: it would reopen the session past its freed slot', async () => {
    setVendorState(h, session.sessionResource, 'completed');
    await status(h.deps, { session: session.localId, reconcile: false });
    const err = await fails(() => reply(h.deps, args()));
    expect(err.appError.code).toBe('JULES_INVALID_STATE');
    expect(err.appError.recoveryAction).toContain('--correction');
    expect(h.adapter.writeCount()).toBe(0);
  });

  it('a session that finished since the last status is refused on the live state, not the stale journal', async () => {
    // No status call: the journal still says the session is working.
    setVendorState(h, session.sessionResource, 'completed');
    const err = await fails(() => reply(h.deps, args()));
    expect(err.appError.code).toBe('JULES_INVALID_STATE');
    expect(h.adapter.callsTo('sendMessage')).toHaveLength(0);
    expect(h.adapter.writeCount()).toBe(0);
  });
});

describe('our own integrity verdicts on the write path are not flattened', () => {
  it('a pre-dispatch integrity failure keeps its code and frees the reservation', async () => {
    h.adapter.sendMessageImpl = async () => {
      throw new AppErrorException(
        makeAppError('JULES_SDK_INTEGRITY', 'storage binding failed')
      );
    };
    const err = await fails(() => reply(h.deps, args()));
    expect(err.appError.code).toBe('JULES_SDK_INTEGRITY');
    const record = (await readJournal(h.dataDir)).operations[
      err.localRequestId as string
    ];
    expect(record?.status).toBe('failed');
  });
});

describe('ambiguous reply outcomes', () => {
  it.each([
    [
      'a dropped connection',
      new AdapterError('network', 'reset', { dispatched: true }),
    ],
    [
      'a 504 after dispatch',
      new AdapterError('server-error', 'gateway timeout', {
        status: 504,
        dispatched: true,
      }),
    ],
    [
      'an invalid 2xx body',
      new AdapterError('malformed', 'garbled', { dispatched: true }),
    ],
  ])(
    '%s -> JULES_UNKNOWN_OUTCOME, one outgoing call, no replay',
    async (_label, failure) => {
      h.adapter.sendMessageImpl = async () => {
        throw failure;
      };
      const err = await fails(() => reply(h.deps, args()));
      expect(err.appError.code).toBe('JULES_UNKNOWN_OUTCOME');
      expect(err.appError.recoveryAction).toContain('status --session');
      expect(h.adapter.callsTo('sendMessage')).toHaveLength(1);
      const record = (await readJournal(h.dataDir)).operations[
        err.localRequestId as string
      ];
      expect(record?.status).toBe('unknown-outcome');
      expect(record?.sessionResource).toBe(session.sessionResource);
    }
  );

  it('a clear 404 after dispatch keeps its code and marks the reservation failed', async () => {
    h.adapter.sendMessageImpl = async () => {
      throw new AdapterError('not-found', 'gone', {
        status: 404,
        dispatched: true,
      });
    };
    const err = await fails(() => reply(h.deps, args()));
    expect(err.appError.code).toBe('JULES_NOT_FOUND');
    const record = (await readJournal(h.dataDir)).operations[
      err.localRequestId as string
    ];
    expect(record?.status).toBe('failed');
  });
});

describe('invalid input', () => {
  it.each([
    ['an empty message', { message: '  ' }],
    ['an oversized message', { message: 'x'.repeat(32_001) }],
    ['a malformed session ref', { session: 'not a ref' }],
  ])(
    '%s is JULES_INVALID_INPUT before any vendor call',
    async (_label, patch) => {
      expect(await codeOf(() => reply(h.deps, args(patch)))).toBe(
        'JULES_INVALID_INPUT'
      );
      expect(h.adapter.calls).toEqual([]);
    }
  );
});

describe('races inside the write gate', () => {
  it('a grant revoked between the reservation and the POST sends nothing and settles failed', async () => {
    const hook = revokeAfterReservation(h, grantId);
    const err = await fails(() => reply(h.deps, args()));
    expect(hook.fired()).toBe(true);
    expect(err.appError.code).toBe('JULES_AUTHORITY_DENIED');
    expect(h.adapter.callsTo('sendMessage')).toHaveLength(0);
    const record = (await readJournal(h.dataDir)).operations[
      err.localRequestId as string
    ];
    expect(record?.status).toBe('failed');
  });

  it('a terminal condition recorded after the live read is refused inside the gate', async () => {
    const real = h.adapter.getSessionImpl;
    h.adapter.getSessionImpl = async (resource) => {
      const live = await real(resource);
      // A concurrent status records the terminal condition after this read.
      await markOperation(
        h.dataDir,
        session.localRequestId,
        'accepted',
        { condition: 'remote-completed' },
        () => new Date(h.deps.clock.now())
      );
      return live;
    };
    const err = await fails(() => reply(h.deps, args()));
    expect(err.appError.code).toBe('JULES_INVALID_STATE');
    expect(h.adapter.callsTo('sendMessage')).toHaveLength(0);
    expect(h.adapter.writeCount()).toBe(0);
  });
});
