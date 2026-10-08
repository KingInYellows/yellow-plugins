import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadGrants } from '../src/authority.js';
import { resolveJournalPath, resolveLockPath } from '../src/config.js';
import { controllerFilePath } from '../src/controller.js';
import {
  AdapterError,
  MutationErrorException,
  type AppErrorCode,
} from '../src/errors.js';
import { delegate, type DelegateArgs } from '../src/mutations.js';
import { readJournal } from '../src/state.js';

import {
  createGrant,
  type GrantHarness,
  makeHarness,
} from './support/grants.js';

let h: GrantHarness;
beforeEach(() => {
  h = makeHarness('correct');
  h.adapter.sources.push({
    sourceResource: 'sources/github/other/repo',
    owner: 'other',
    repo: 'repo',
  });
});
afterEach(() => {
  h.cleanup();
});

const PROMPT = 'Implement the frobnicator exactly as specified in the issue.';

function args(overrides: Partial<DelegateArgs> = {}): DelegateArgs {
  return {
    repo: 'acme/widgets',
    branch: 'scratch/one',
    prompt: PROMPT,
    taskRef: 't1',
    dryRun: false,
    correction: false,
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

describe('delegate --dry-run', () => {
  it('validates and reads the source, but reserves and posts nothing — and needs no grant', async () => {
    const result = await delegate(h.deps, args({ dryRun: true }));
    expect(result).toMatchObject({
      operation: 'delegate',
      dryRun: true,
      repository: 'acme/widgets',
      requestedBranch: 'scratch/one',
      sourceResource: 'sources/github/acme/widgets',
    });
    expect(result).not.toHaveProperty('sessionResource');
    expect(h.adapter.callsTo('getSource')).toHaveLength(1);
    expect(h.adapter.writeCount()).toBe(0);
    expect(Object.keys((await readJournal(h.dataDir)).operations)).toEqual([]);
  });
});

describe('delegate without a grant', () => {
  it('JULES_CONFIRMATION_REQUIRED names the exact authorize command, before any vendor call', async () => {
    const err = await fails(() => delegate(h.deps, args()));
    expect(err.appError.code).toBe('JULES_CONFIRMATION_REQUIRED');
    expect(err.appError.recoveryAction).toContain('authorize');
    expect(err.appError.recoveryAction).toContain("--repo 'acme/widgets'");
    expect(err.appError.recoveryAction).toContain("--branch 'scratch/one'");
    expect(err.appError.recoveryAction).toContain("--task-ref 't1'");
    expect(err.appError.recoveryAction).toContain("--operations 'create'");
    expect(err.localRequestId).toMatch(/^jr-/);
    expect(err.localId).toMatch(/^jl-[0-9a-f]{32}$/);
    expect(h.adapter.calls).toEqual([]);
    expect(h.tty.opened).toBe(0);
  });
});

describe('unauthorized writes', () => {
  it.each([
    [
      'an unknown grant id',
      async () => 'jg-ffffffffffffffffffffffffffffffff',
      {},
    ],
    ['the wrong repository', undefined, { repo: 'other/repo' }],
    ['the wrong branch', undefined, { branch: 'main' }],
    ['a task ref outside the grant', undefined, { taskRef: 't9' }],
  ])(
    '%s -> JULES_AUTHORITY_DENIED with no reservation and no POST',
    async (_label, grantOverride, patch) => {
      const grantId = grantOverride
        ? await grantOverride()
        : await createGrant(h);
      const a = { ...args({ grantId }), ...patch } as DelegateArgs;
      const err = await fails(() => delegate(h.deps, a));
      expect(err.appError.code).toBe('JULES_AUTHORITY_DENIED');
      expect(h.adapter.writeCount()).toBe(0);
      expect(Object.keys((await readJournal(h.dataDir)).operations)).toEqual(
        []
      );
    }
  );

  it('an operation the grant does not permit', async () => {
    const grantId = await createGrant(h, { operations: 'reply,collect' });
    expect(await codeOf(() => delegate(h.deps, args({ grantId })))).toBe(
      'JULES_AUTHORITY_DENIED'
    );
    expect(h.adapter.writeCount()).toBe(0);
  });

  it('a revoked grant', async () => {
    const grantId = await createGrant(h);
    const { revokeGrant } = await import('../src/authority.js');
    await revokeGrant(h.dataDir, grantId, new Date(h.deps.clock.now()));
    expect(await codeOf(() => delegate(h.deps, args({ grantId })))).toBe(
      'JULES_AUTHORITY_DENIED'
    );
  });
});

describe('a covered delegate', () => {
  it('reserves, posts once with a tagged title, binds the session, and charges the grant', async () => {
    const grantId = await createGrant(h);
    const result = await delegate(h.deps, args({ grantId }));
    expect(result).toMatchObject({
      operation: 'delegate',
      vendorState: 'queued',
      condition: 'starting',
      repository: 'acme/widgets',
      requestedBranch: 'scratch/one',
      sourceResource: 'sources/github/acme/widgets',
    });
    if (!('sessionResource' in result)) throw new Error('expected a session');

    const posts = h.adapter.callsTo('createSession');
    expect(posts).toHaveLength(1);
    const sent = posts[0]?.args[0] as { title: string; baseBranch: string };
    expect(sent.title.startsWith(`[yellow:${result.localId}] `)).toBe(true);
    expect(sent.baseBranch).toBe('scratch/one');

    const journal = await readJournal(h.dataDir);
    const record = journal.operations[result.localRequestId];
    expect(record).toMatchObject({
      kind: 'create',
      status: 'accepted',
      sessionResource: result.sessionResource,
      grantId,
      taskRef: 't1',
      autoPrRequested: false,
    });
    expect(record?.promptDigest).toMatch(/^[0-9a-f]{64}$/);
    // The prompt itself is never persisted.
    expect(
      fs.readFileSync(resolveJournalPath(h.dataDir), 'utf8')
    ).not.toContain('frobnicator');

    const grant = loadGrants(h.dataDir).grants[grantId];
    expect(grant?.usage.activeSessionRefs).toEqual([result.localRequestId]);
    expect(grant?.usage.totalTasks).toBe(1);
  });

  it('derives the title from the prompt, one line, and refuses a title with the reconcile tag', async () => {
    const grantId = await createGrant(h);
    await delegate(h.deps, args({ grantId, prompt: 'Line one\nLine two' }));
    const sent = h.adapter.callsTo('createSession')[0]?.args[0] as {
      title: string;
    };
    expect(sent.title).toMatch(
      /^\[yellow:jl-[0-9a-f]{32}\] Line one Line two$/
    );
    expect(
      await codeOf(() =>
        delegate(h.deps, args({ grantId, title: 'x [yellow:jl-abc] y' }))
      )
    ).toBe('JULES_INVALID_INPUT');
  });

  it('refuses to reuse a request id', async () => {
    const grantId = await createGrant(h, { maxActiveSessions: 3 });
    await delegate(h.deps, args({ grantId, requestId: 'same-req' }));
    expect(
      await codeOf(() =>
        delegate(
          h.deps,
          args({ grantId, requestId: 'same-req', branch: 'scratch/two' })
        )
      )
    ).toBe('JULES_DUPLICATE_LAUNCH');
    expect(h.adapter.callsTo('createSession')).toHaveLength(1);
  });

  it.each([
    ['an empty prompt', { prompt: '   ' }],
    ['a malformed branch', { branch: 'bad branch;rm' }],
    ['a malformed repo', { repo: 'nope' }],
    ['an oversized prompt', { prompt: 'x'.repeat(100_001) }],
  ])(
    '%s is JULES_INVALID_INPUT before any vendor call',
    async (_label, patch) => {
      const grantId = await createGrant(h);
      h.adapter.calls.length = 0;
      expect(
        await codeOf(() => delegate(h.deps, args({ grantId, ...patch })))
      ).toBe('JULES_INVALID_INPUT');
      expect(h.adapter.calls).toEqual([]);
    }
  );
});

describe('expired grants with remote work active (R39)', () => {
  it('refuses, lists the running sessions, names containment, and never claims termination', async () => {
    const grantId = await createGrant(h);
    const first = await delegate(h.deps, args({ grantId }));
    h.deps.clock.time += 3 * 60 * 60_000;

    const err = await fails(() =>
      delegate(h.deps, args({ grantId, branch: 'scratch/two' }))
    );
    expect(err.appError.code).toBe('JULES_GRANT_EXPIRED');
    expect(err.details).toEqual({
      runningSessions: [
        'sessionResource' in first ? first.sessionResource : undefined,
      ],
    });
    const text = `${err.appError.message} ${err.appError.recoveryAction}`;
    expect(text).not.toMatch(/terminated|stopped/i);
    expect(text).toMatch(/Jules console/);
    expect(text).toMatch(/source connection/i);
    expect(text).toMatch(/JULES_API_KEY/);
    expect(h.adapter.callsTo('createSession')).toHaveLength(1);
  });

  it('an expired grant with nothing running still reports an empty list', async () => {
    const grantId = await createGrant(h);
    h.deps.clock.time += 3 * 60 * 60_000;
    const err = await fails(() => delegate(h.deps, args({ grantId })));
    expect(err.appError.code).toBe('JULES_GRANT_EXPIRED');
    expect(err.details).toEqual({ runningSessions: [] });
  });
});

describe('task limits', () => {
  it('one active session: a second delegate is JULES_GRANT_EXHAUSTED', async () => {
    const grantId = await createGrant(h);
    await delegate(h.deps, args({ grantId }));
    expect(
      await codeOf(() =>
        delegate(h.deps, args({ grantId, branch: 'scratch/two' }))
      )
    ).toBe('JULES_GRANT_EXHAUSTED');
    expect(h.adapter.callsTo('createSession')).toHaveLength(1);
  });

  it('total tasks never decrement, even after the slot is released', async () => {
    const grantId = await createGrant(h, {
      maxActiveSessions: 3,
      maxTotalTasks: 2,
    });
    const first = await delegate(
      h.deps,
      args({ grantId, branch: 'scratch/a' })
    );
    await delegate(h.deps, args({ grantId, branch: 'scratch/b' }));
    // Both sessions finish remotely; the slots free up on observation (status), tasks stay spent.
    expect(first).toBeDefined();
    expect(
      await codeOf(() =>
        delegate(h.deps, args({ grantId, branch: 'scratch/c' }))
      )
    ).toBe('JULES_GRANT_EXHAUSTED');
    expect(h.adapter.callsTo('createSession')).toHaveLength(2);
  });

  it('a repair delegate spends corrective rounds, not tasks, and stops at the limit', async () => {
    const grantId = await createGrant(h, {
      maxActiveSessions: 3,
      maxTotalTasks: 1,
      maxCorrectiveRounds: 2,
    });
    await delegate(h.deps, args({ grantId, branch: 'scratch/a' }));
    await delegate(
      h.deps,
      args({ grantId, branch: 'scratch/a-fix1', correction: true })
    );
    await delegate(
      h.deps,
      args({ grantId, branch: 'scratch/a-fix2', correction: true })
    );
    expect(
      await codeOf(() =>
        delegate(
          h.deps,
          args({ grantId, branch: 'scratch/a-fix3', correction: true })
        )
      )
    ).toBe('JULES_GRANT_EXHAUSTED');
    const usage = loadGrants(h.dataDir).grants[grantId]?.usage;
    expect(usage?.totalTasks).toBe(1);
    expect(usage?.correctiveRounds['t1']).toBe(2);
    expect(h.adapter.callsTo('createSession')).toHaveLength(3);
  });

  it('a repair delegate needs an earlier plain launch of the same task under the grant', async () => {
    const grantId = await createGrant(h, { maxActiveSessions: 3 });
    expect(
      await codeOf(() => delegate(h.deps, args({ grantId, correction: true })))
    ).toBe('JULES_AUTHORITY_DENIED');
    expect(h.adapter.callsTo('createSession')).toHaveLength(0);
    expect(
      loadGrants(h.dataDir).grants[grantId]?.usage.correctiveRounds
    ).toEqual({});
    await delegate(h.deps, args({ grantId, branch: 'scratch/plain' }));
    await delegate(
      h.deps,
      args({ grantId, branch: 'scratch/fix', correction: true })
    );
    expect(h.adapter.callsTo('createSession')).toHaveLength(2);
  });

  it('a failed plain launch does not license a repair', async () => {
    const grantId = await createGrant(h, { maxActiveSessions: 3 });
    h.adapter.createSessionImpl = async () => {
      throw new AdapterError('invalid-request', 'rejected', {
        dispatched: true,
      });
    };
    await codeOf(() => delegate(h.deps, args({ grantId })));
    h.adapter.restoreWrites();
    expect(
      await codeOf(() =>
        delegate(
          h.deps,
          args({ grantId, branch: 'scratch/fix', correction: true })
        )
      )
    ).toBe('JULES_AUTHORITY_DENIED');
  });

  it('a delegate without a task ref is rejected before anything is reserved', async () => {
    const grantId = await createGrant(h);
    expect(
      await codeOf(() =>
        delegate(h.deps, args({ grantId, taskRef: undefined }))
      )
    ).toBe('JULES_INVALID_INPUT');
    expect(h.adapter.writeCount()).toBe(0);
  });

  it('--correction needs a task ref', async () => {
    const grantId = await createGrant(h);
    expect(
      await codeOf(() =>
        delegate(
          h.deps,
          args({ grantId, correction: true, taskRef: undefined })
        )
      )
    ).toBe('JULES_INVALID_INPUT');
  });
});

describe('ambiguous creation outcomes', () => {
  it.each([
    [
      'a dropped connection',
      new AdapterError('network', 'socket hang up', { dispatched: true }),
    ],
    [
      'a 503 after dispatch',
      new AdapterError('server-error', 'unavailable', {
        status: 503,
        dispatched: true,
      }),
    ],
    [
      'a 502 after dispatch',
      new AdapterError('server-error', 'bad gateway', {
        status: 502,
        dispatched: true,
      }),
    ],
    [
      'an invalid 2xx body',
      new AdapterError('malformed', 'bad json', { dispatched: true }),
    ],
    [
      'a timeout after dispatch',
      new AdapterError('timeout', 'timed out', { dispatched: true }),
    ],
  ])(
    '%s -> JULES_UNKNOWN_OUTCOME: reservation kept, charge kept, never replayed',
    async (_label, failure) => {
      const grantId = await createGrant(h, { maxActiveSessions: 3 });
      h.adapter.createSessionImpl = async () => {
        throw failure;
      };
      const err = await fails(() => delegate(h.deps, args({ grantId })));
      expect(err.appError.code).toBe('JULES_UNKNOWN_OUTCOME');
      expect(err.appError.recoveryAction).toContain('status --reconcile');
      expect(err.localRequestId).toBeDefined();

      // Exactly one outgoing create, ever.
      expect(h.adapter.callsTo('createSession')).toHaveLength(1);
      const record = (await readJournal(h.dataDir)).operations[
        err.localRequestId as string
      ];
      expect(record?.status).toBe('unknown-outcome');
      expect(loadGrants(h.dataDir).grants[grantId]?.usage).toMatchObject({
        activeSessionRefs: [err.localRequestId],
        totalTasks: 1,
      });

      // A relaunch for the same repository and branch is refused (R36); nothing is sent.
      expect(await codeOf(() => delegate(h.deps, args({ grantId })))).toBe(
        'JULES_DUPLICATE_LAUNCH'
      );
      expect(h.adapter.callsTo('createSession')).toHaveLength(1);
    }
  );

  it('keeps a session id the failure still carried', async () => {
    const grantId = await createGrant(h);
    h.adapter.createSessionImpl = async () => {
      throw new AdapterError('malformed', 'cannot decode', {
        dispatched: true,
        sessionResource: 'sessions/s777',
      });
    };
    const err = await fails(() => delegate(h.deps, args({ grantId })));
    expect(err.details).toMatchObject({ sessionResource: 'sessions/s777' });
    const record = (await readJournal(h.dataDir)).operations[
      err.localRequestId as string
    ];
    expect(record?.sessionResource).toBe('sessions/s777');
  });

  it.each([
    [
      'an invalid request (400)',
      new AdapterError('invalid-request', 'bad', {
        status: 400,
        dispatched: true,
      }),
      'JULES_INVALID_INPUT',
    ],
    [
      'rate limiting (429)',
      new AdapterError('rate-limited', 'slow down', {
        status: 429,
        dispatched: true,
      }),
      'JULES_RATE_LIMITED',
    ],
    [
      'an auth failure',
      new AdapterError('auth', 'no', { status: 403, dispatched: true }),
      'JULES_AUTH_FAILED',
    ],
  ] as const)(
    'a clear rejection after dispatch (%s) keeps its code, frees the guard and the slot',
    async (_label, failure, code) => {
      const grantId = await createGrant(h);
      h.adapter.createSessionImpl = async () => {
        throw failure;
      };
      const err = await fails(() => delegate(h.deps, args({ grantId })));
      expect(err.appError.code).toBe(code);
      const record = (await readJournal(h.dataDir)).operations[
        err.localRequestId as string
      ];
      expect(record?.status).toBe('failed');
      expect(
        loadGrants(h.dataDir).grants[grantId]?.usage.activeSessionRefs
      ).toEqual([]);

      // The guard and the slot are free again: a retry is allowed and posts a second time.
      h.adapter.restoreWrites();
      const retried = await delegate(h.deps, args({ grantId }));
      expect(retried).toHaveProperty('sessionResource');
      expect(h.adapter.callsTo('createSession')).toHaveLength(2);
    }
  );

  it('a failure before anything was dispatched maps like a read and frees the reservation', async () => {
    const grantId = await createGrant(h);
    h.adapter.createSessionImpl = async () => {
      throw new AdapterError('source-not-found', 'no source', {
        dispatched: false,
      });
    };
    const err = await fails(() => delegate(h.deps, args({ grantId })));
    expect(err.appError.code).toBe('JULES_SOURCE_ACCESS');
    const record = (await readJournal(h.dataDir)).operations[
      err.localRequestId as string
    ];
    expect(record?.status).toBe('failed');
  });

  it('a server error BEFORE dispatch is retryable service-unavailable, not an unknown outcome', async () => {
    const grantId = await createGrant(h);
    h.adapter.createSessionImpl = async () => {
      throw new AdapterError('server-error', 'source read failed', {
        status: 503,
        dispatched: false,
      });
    };
    const err = await fails(() => delegate(h.deps, args({ grantId })));
    expect(err.appError.code).toBe('JULES_SERVICE_UNAVAILABLE');
  });

  it('a non-adapter throw from the create call is, by construction, an unknown outcome', async () => {
    const grantId = await createGrant(h);
    h.adapter.createSessionImpl = async () => {
      throw new TypeError('boom');
    };
    expect(await codeOf(() => delegate(h.deps, args({ grantId })))).toBe(
      'JULES_UNKNOWN_OUTCOME'
    );
  });
});

describe('crash recovery', () => {
  it('a reservation left `reserved` blocks a duplicate create for the same repository and branch', async () => {
    const grantId = await createGrant(h, { maxActiveSessions: 3 });
    const { reserveUnderGrant } = await import('../src/write-gate.js');
    await reserveUnderGrant(h.deps, {
      grantId,
      authority: {
        repository: 'acme/widgets',
        sourceResource: 'sources/github/acme/widgets',
        branch: 'scratch/one',
        taskRef: 't1',
        operation: 'create',
      },
      reservation: { localRequestId: 'crashed-req' },
    });
    expect(await codeOf(() => delegate(h.deps, args({ grantId })))).toBe(
      'JULES_DUPLICATE_LAUNCH'
    );
    expect(h.adapter.writeCount()).toBe(0);
  });
});

describe('corrupt state blocks writes', () => {
  it('a corrupt journal -> JULES_JOURNAL_CORRUPT, untouched, no POST', async () => {
    const grantId = await createGrant(h);
    const file = resolveJournalPath(h.dataDir);
    fs.writeFileSync(file, '{not json', { mode: 0o600 });
    expect(await codeOf(() => delegate(h.deps, args({ grantId })))).toBe(
      'JULES_JOURNAL_CORRUPT'
    );
    expect(fs.readFileSync(file, 'utf8')).toBe('{not json');
    expect(h.adapter.writeCount()).toBe(0);
  });

  it('a corrupt grants file -> JULES_JOURNAL_CORRUPT, untouched, no POST', async () => {
    const grantId = await createGrant(h);
    const file = path.join(h.dataDir, 'state', 'grants.json');
    fs.writeFileSync(file, '{"version":1,"grants":[]}', { mode: 0o600 });
    expect(await codeOf(() => delegate(h.deps, args({ grantId })))).toBe(
      'JULES_JOURNAL_CORRUPT'
    );
    expect(fs.readFileSync(file, 'utf8')).toBe('{"version":1,"grants":[]}');
    expect(h.adapter.writeCount()).toBe(0);
  });
});

describe('stale lock on restart', () => {
  it('a lock held by a dead pid is JULES_STALE_LOCK, never taken over, and nothing is sent', async () => {
    const grantId = await createGrant(h);
    const lock = resolveLockPath(h.dataDir);
    fs.writeFileSync(
      lock,
      JSON.stringify({
        owner: 'dead',
        pid: 2_147_483_000,
        hostname: (await import('node:os')).hostname(),
        startedAt: Date.now(),
      }),
      { mode: 0o600 }
    );
    expect(await codeOf(() => delegate(h.deps, args({ grantId })))).toBe(
      'JULES_STALE_LOCK'
    );
    expect(fs.existsSync(lock)).toBe(true);
    expect(h.adapter.writeCount()).toBe(0);
  });
});

describe('controller binding (R38)', () => {
  it('a missing controller authority fails loud with zero requests', async () => {
    const grantId = await createGrant(h);
    fs.rmSync(controllerFilePath(h.controllerDir, 'testhost'));
    h.adapter.calls.length = 0;
    expect(await codeOf(() => delegate(h.deps, args({ grantId })))).toBe(
      'JULES_CONTROLLER_MISMATCH'
    );
    expect(h.adapter.writeCount()).toBe(0);
  });

  it('a grant bound to another host cannot write here, even at the same data path', async () => {
    const grantId = await createGrant(h);
    const deps = { ...h.deps, controllerId: 'otherhost' };
    expect(await codeOf(() => delegate(deps, args({ grantId })))).toBe(
      'JULES_CONTROLLER_MISMATCH'
    );
    expect(h.adapter.writeCount()).toBe(0);
  });

  it('a data dir copied to another path cannot write, even with a valid grant id', async () => {
    const grantId = await createGrant(h);
    const copy = path.join(path.dirname(h.dataDir), 'data-copy');
    fs.cpSync(h.dataDir, copy, { recursive: true });
    const deps = { ...h.deps, dataDir: copy };
    expect(await codeOf(() => delegate(deps, args({ grantId })))).toBe(
      'JULES_CONTROLLER_MISMATCH'
    );
    expect(h.adapter.writeCount()).toBe(0);
  });
});

describe('concurrency (R31)', () => {
  it('two concurrent delegates against a one-session grant: exactly one create', async () => {
    const grantId = await createGrant(h);
    const outcomes = await Promise.allSettled([
      delegate(
        h.deps,
        args({ grantId, requestId: 'conc-a', branch: 'scratch/a' })
      ),
      delegate(
        h.deps,
        args({ grantId, requestId: 'conc-b', branch: 'scratch/b' })
      ),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((o) => o.status === 'rejected');
    expect((rejected as PromiseRejectedResult).reason.appError.code).toBe(
      'JULES_GRANT_EXHAUSTED'
    );
    expect(h.adapter.callsTo('createSession')).toHaveLength(1);
    expect(loadGrants(h.dataDir).grants[grantId]?.usage.totalTasks).toBe(1);
  });

  it('a second delegate for the same repository and branch while the first POST is in flight is refused (R36)', async () => {
    const grantId = await createGrant(h, { maxActiveSessions: 3 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = h.adapter.createSessionImpl;
    h.adapter.createSessionImpl = async (input) => {
      await gate;
      return original(input);
    };
    const first = delegate(h.deps, args({ grantId, requestId: 'same-a' }));
    for (
      let i = 0;
      i < 200 && h.adapter.callsTo('createSession').length === 0;
      i += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(h.adapter.callsTo('createSession')).toHaveLength(1);

    expect(
      await codeOf(() =>
        delegate(h.deps, args({ grantId, requestId: 'same-b' }))
      )
    ).toBe('JULES_DUPLICATE_LAUNCH');
    release();
    await first;
    expect(h.adapter.callsTo('createSession')).toHaveLength(1);
  });
});

describe('deadline', () => {
  it('an expired deadline sends nothing and records nothing', async () => {
    const grantId = await createGrant(h);
    const err = await fails(() =>
      delegate(h.deps, args({ grantId, deadlineMs: 0 }))
    );
    expect(err.appError.code).toBe('JULES_DEADLINE_EXCEEDED');
    expect(h.adapter.writeCount()).toBe(0);
    expect(Object.keys((await readJournal(h.dataDir)).operations)).toEqual([]);
  });
});
