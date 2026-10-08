import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resolveJournalPath,
  resolveLockPath,
  resolveStateDir,
} from '../src/config.js';
import { AppErrorException } from '../src/errors.js';
import {
  digestText,
  emptyJournal,
  ensureObservedRecord,
  findByLocalId,
  findBySessionResource,
  findUnresolvedOperations,
  markOperation,
  readJournal,
  recordDeviation,
  reserveOperation,
  upsertArtifactResumeToken,
  upsertReadState,
  withJournalLock,
  writeJournal,
  type LockConfig,
} from '../src/state.js';

import { codeOfAsync } from './support/app-error.js';

// Every journal write fsyncs; under parallel test files on slow disks (WSL) a
// multi-write test can exceed the 5 s default without anything being wrong.
vi.setConfig({ testTimeout: 30_000 });

let dataDir: string;
const FAST_LOCK: LockConfig = { staleMs: 60_000, timeoutMs: 300, pollMs: 10 };

beforeEach(async () => {
  dataDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'yellow-jules-state-')
  );
});

afterEach(async () => {
  await fs.promises.rm(dataDir, { recursive: true, force: true });
});

function createInput(
  localRequestId: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    localRequestId,
    kind: 'create' as const,
    repository: 'acme/widgets',
    requestedBranch: 'main',
    sourceResource: 'sources/github/acme/widgets',
    autoPrRequested: false,
    promptDigest: digestText('do the thing'),
    ...overrides,
  };
}

describe('readJournal / writeJournal', () => {
  it('returns an empty journal when none exists', async () => {
    const journal = await readJournal(dataDir);
    expect(journal.version).toBe(1);
    expect(journal.archiveVisibilityConfirmed).toBe(false);
    expect(Object.keys(journal.operations)).toEqual([]);
    expect(Object.getPrototypeOf(journal.operations)).toBeNull();
  });

  it('round-trips a reservation with 0700 state dir and 0600 file', async () => {
    const record = await reserveOperation(dataDir, createInput('req-1'));
    expect(record.status).toBe('reserved');
    expect(record.origin).toBe('yellow');
    expect(record.localId).toMatch(/^jl-[0-9a-f]{32}$/);
    const journal = await readJournal(dataDir);
    expect(journal.operations['req-1']).toEqual(record);
    expect(Object.getPrototypeOf(journal.operations)).toBeNull();
    expect(findByLocalId(journal, record.localId)).toEqual(record);
    if (process.platform !== 'win32') {
      expect(fs.statSync(resolveStateDir(dataDir)).mode & 0o777).toBe(0o700);
      expect(fs.statSync(resolveJournalPath(dataDir)).mode & 0o777).toBe(0o600);
    }
    // No temp files left behind.
    expect(
      fs
        .readdirSync(resolveStateDir(dataDir))
        .filter((f) => f.includes('.tmp-'))
    ).toEqual([]);
  });

  it('refuses to persist a raw prompt or secret-shaped value', async () => {
    await expect(
      withJournalLock(dataDir, async () => {
        const journal = emptyJournal();
        (journal.operations as Record<string, unknown>)['x'] = {
          prompt: 'raw',
        };
        await writeJournal(dataDir, journal);
      })
    ).rejects.toThrow(/refusing to persist/);
  });

  it('a __proto__ key in the file cannot reach the prototype', async () => {
    fs.mkdirSync(resolveStateDir(dataDir), { mode: 0o700 });
    fs.writeFileSync(
      resolveJournalPath(dataDir),
      '{"version":1,"archiveVisibilityConfirmed":false,"operations":{"__proto__":{"polluted":true}}}',
      { mode: 0o600 }
    );
    await expect(codeOfAsync(() => readJournal(dataDir))).resolves.toBe(
      'JULES_JOURNAL_CORRUPT'
    );
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

describe('corrupt journal (R37)', () => {
  it.each([
    ['unparseable JSON', '{not json'],
    [
      'wrong version',
      '{"version":2,"archiveVisibilityConfirmed":false,"operations":{}}',
    ],
    [
      'bad record',
      '{"version":1,"archiveVisibilityConfirmed":false,"operations":{"a":{"localRequestId":"b"}}}',
    ],
    ['empty file', ''],
  ])(
    '%s blocks reads and writes and is left byte-identical',
    async (_label, content) => {
      fs.mkdirSync(resolveStateDir(dataDir), { mode: 0o700 });
      fs.writeFileSync(resolveJournalPath(dataDir), content, { mode: 0o600 });
      await expect(codeOfAsync(() => readJournal(dataDir))).resolves.toBe(
        'JULES_JOURNAL_CORRUPT'
      );
      await expect(
        codeOfAsync(() => reserveOperation(dataDir, createInput('req-1')))
      ).resolves.toBe('JULES_JOURNAL_CORRUPT');
      expect(fs.readFileSync(resolveJournalPath(dataDir), 'utf8')).toBe(
        content
      );
      expect(fs.readdirSync(resolveStateDir(dataDir)).sort()).toEqual([
        'journal.json',
      ]);
    }
  );
});

describe('stored resume tokens', () => {
  it('a token outside the page-token allowlist makes the journal corrupt, not trusted', async () => {
    const rec = await ensureObservedRecord(dataDir, 'sessions/s1');
    const raw = JSON.parse(
      fs.readFileSync(resolveJournalPath(dataDir), 'utf8')
    );
    raw.operations[rec.localRequestId].resumePageToken = '../../etc';
    fs.writeFileSync(resolveJournalPath(dataDir), JSON.stringify(raw), {
      mode: 0o600,
    });
    await expect(codeOfAsync(() => readJournal(dataDir))).resolves.toBe(
      'JULES_JOURNAL_CORRUPT'
    );
  });
});

describe('nested journal records', () => {
  const validArtifact = {
    kind: 'patch',
    sessionResource: 'sessions/s1',
    path: 'a/patch.diff',
    sha256: 'a'.repeat(64),
    secretShapedContent: false,
    collectedAt: '2026-01-01T00:00:00Z',
    verification: 'unverified',
  };
  const validDeviation = {
    kind: 'policy-deviation',
    reason: 'r',
    observedAt: '2026-01-01T00:00:00Z',
    reconciled: false,
  };
  const validPlan = {
    planId: 'p1',
    steps: [{ id: 's1', title: 't', index: 0 }],
    activityCreateTime: '2026-01-01T00:00:00Z',
    activityId: 'a1',
  };

  async function loadWith(patch: Record<string, unknown>) {
    const rec = await ensureObservedRecord(dataDir, 'sessions/s1');
    const raw = JSON.parse(
      fs.readFileSync(resolveJournalPath(dataDir), 'utf8')
    );
    Object.assign(raw.operations[rec.localRequestId], patch);
    fs.writeFileSync(resolveJournalPath(dataDir), JSON.stringify(raw), {
      mode: 0o600,
    });
    return rec.localRequestId;
  }

  it('a journal with well-formed nested records still loads', async () => {
    const id = await loadWith({
      artifacts: [validArtifact],
      deviations: [validDeviation, { ...validDeviation, prUrl: 'u' }],
      pendingPlan: validPlan,
      artifactResumeRestartCount: 1,
    });
    const journal = await readJournal(dataDir);
    expect(journal.operations[id]?.deviations).toHaveLength(2);
  });

  it.each([
    ['empty deviation', { deviations: [{}] }],
    [
      'deviation with wrong reconciled type',
      { deviations: [{ ...validDeviation, reconciled: 'no' }] },
    ],
    [
      'deviation with wrong prUrl type',
      { deviations: [{ ...validDeviation, prUrl: 5 }] },
    ],
    ['empty artifact', { artifacts: [{}] }],
    [
      'artifact with unknown verification',
      { artifacts: [{ ...validArtifact, verification: 'maybe' }] },
    ],
    [
      'artifact missing collectedAt',
      { artifacts: [{ ...validArtifact, collectedAt: undefined }] },
    ],
    [
      'pending plan with a malformed step',
      { pendingPlan: { ...validPlan, steps: [{}] } },
    ],
  ])('%s is JULES_JOURNAL_CORRUPT', async (_label, patch) => {
    await loadWith(patch);
    await expect(codeOfAsync(() => readJournal(dataDir))).resolves.toBe(
      'JULES_JOURNAL_CORRUPT'
    );
  });
});

describe('withJournalLock', () => {
  it('serializes concurrent read-modify-write cycles (no lost updates)', async () => {
    const writers = Array.from({ length: 15 }, (_, i) =>
      reserveOperation(
        dataDir,
        createInput(`req-${i}`, { requestedBranch: `b-${i}` }),
        undefined,
        {
          staleMs: 60_000,
          timeoutMs: 15_000,
          pollMs: 5,
        }
      )
    );
    await Promise.all(writers);
    const journal = await readJournal(dataDir);
    expect(Object.keys(journal.operations)).toHaveLength(15);
    expect(fs.existsSync(resolveLockPath(dataDir))).toBe(false);
  });

  it('releases the lock when the critical section throws', async () => {
    await expect(
      withJournalLock(dataDir, async () => {
        throw new Error('inside');
      })
    ).rejects.toThrow('inside');
    expect(fs.existsSync(resolveLockPath(dataDir))).toBe(false);
  });

  function plantLock(content: object): string {
    fs.mkdirSync(resolveStateDir(dataDir), { recursive: true, mode: 0o700 });
    const raw = JSON.stringify(content);
    fs.writeFileSync(resolveLockPath(dataDir), raw, { mode: 0o600 });
    return raw;
  }

  it('fails loud on a lock whose holder pid is dead, and leaves it in place (R38)', async () => {
    const child = spawnSync(process.execPath, ['-e', ''], { stdio: 'ignore' });
    const raw = plantLock({
      owner: 'o',
      pid: child.pid,
      hostname: os.hostname(),
      startedAt: Date.now(),
    });
    await expect(
      codeOfAsync(() => withJournalLock(dataDir, async () => 1, FAST_LOCK))
    ).resolves.toBe('JULES_STALE_LOCK');
    expect(fs.readFileSync(resolveLockPath(dataDir), 'utf8')).toBe(raw);
  });

  it('fails loud on a lock older than staleMs, and leaves it in place', async () => {
    const raw = plantLock({
      owner: 'o',
      pid: process.pid,
      hostname: 'other-host',
      startedAt: Date.now() - 120_000,
    });
    await expect(
      codeOfAsync(() => withJournalLock(dataDir, async () => 1, FAST_LOCK))
    ).resolves.toBe('JULES_STALE_LOCK');
    expect(fs.readFileSync(resolveLockPath(dataDir), 'utf8')).toBe(raw);
  });

  it('gives up after a bounded wait on a live holder, retryable', async () => {
    plantLock({
      owner: 'o',
      pid: process.pid,
      hostname: os.hostname(),
      startedAt: Date.now(),
    });
    try {
      await withJournalLock(dataDir, async () => 1, FAST_LOCK);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AppErrorException);
      const app = (err as AppErrorException).appError;
      expect(app.code).toBe('JULES_STALE_LOCK');
      expect(app.retryable).toBe(true);
    }
    expect(fs.existsSync(resolveLockPath(dataDir))).toBe(true);
  });
});

describe('reservations and the R36 lookup', () => {
  it('refuses a second create for the same repository and branch while one is unresolved', async () => {
    await reserveOperation(dataDir, createInput('req-1'));
    await expect(
      codeOfAsync(() => reserveOperation(dataDir, createInput('req-2')))
    ).resolves.toBe('JULES_DUPLICATE_LAUNCH');
    await markOperation(dataDir, 'req-1', 'unknown-outcome');
    await expect(
      codeOfAsync(() => reserveOperation(dataDir, createInput('req-2')))
    ).resolves.toBe('JULES_DUPLICATE_LAUNCH');
    await markOperation(dataDir, 'req-1', 'failed');
    await expect(
      reserveOperation(dataDir, createInput('req-2'))
    ).resolves.toMatchObject({ status: 'reserved' });
  });

  it('refuses a reused request id', async () => {
    await reserveOperation(dataDir, createInput('req-1'));
    await markOperation(dataDir, 'req-1', 'failed');
    await expect(
      codeOfAsync(() => reserveOperation(dataDir, createInput('req-1')))
    ).resolves.toBe('JULES_DUPLICATE_LAUNCH');
  });

  it('findUnresolvedOperations matches repository, branch, and task ref', async () => {
    await reserveOperation(dataDir, createInput('req-1', { taskRef: 'T-1' }));
    await reserveOperation(
      dataDir,
      createInput('req-2', { requestedBranch: 'dev' })
    );
    const journal = await readJournal(dataDir);
    expect(
      findUnresolvedOperations(journal, {
        repository: 'acme/widgets',
        requestedBranch: 'main',
      }).map((r) => r.localRequestId)
    ).toEqual(['req-1']);
    expect(
      findUnresolvedOperations(journal, {
        repository: 'acme/widgets',
        requestedBranch: 'main',
        taskRef: 'T-2',
      })
    ).toEqual([]);
    expect(
      findUnresolvedOperations(journal, {
        repository: 'acme/other',
        requestedBranch: 'main',
      })
    ).toEqual([]);
  });

  it('rejects a prototype-named request id before touching the journal', async () => {
    await expect(
      codeOfAsync(() => reserveOperation(dataDir, createInput('__proto__')))
    ).resolves.toBe('JULES_INVALID_INPUT');
    expect(fs.existsSync(resolveJournalPath(dataDir))).toBe(false);
  });
});

describe('read-state, external records, deviations, retention', () => {
  it('mints one external record per session', async () => {
    const a = await ensureObservedRecord(dataDir, 'sessions/s1');
    const b = await ensureObservedRecord(dataDir, 'sessions/s1');
    expect(a).toEqual(b);
    expect(a.origin).toBe('external');
    expect(a.kind).toBe('observe');
    expect(a.status).toBe('observed');
    const journal = await readJournal(dataDir);
    expect(findBySessionResource(journal, 'sessions/s1')?.localId).toBe(
      a.localId
    );
  });

  it('upsertReadState advances watermark, sets and clears the resume token and pending plan', async () => {
    const rec = await ensureObservedRecord(dataDir, 'sessions/s1');
    let next = await upsertReadState(dataDir, rec.localRequestId, {
      vendorState: 'inProgress',
      condition: 'working',
      resumePageToken: 'tok1',
      recentActivityIds: ['a1'],
      activityCountDelta: 1,
      pendingPlan: {
        planId: 'p1',
        steps: [],
        activityCreateTime: '2026-01-01T00:00:00Z',
        activityId: 'a1',
      },
    });
    expect(next.resumePageToken).toBe('tok1');
    expect(next.lastActivityId).toBeUndefined();
    expect(next.pendingPlan?.planId).toBe('p1');
    next = await upsertReadState(dataDir, rec.localRequestId, {
      watermark: { createTime: '2026-01-01T00:01:00Z', activityId: 'a2' },
      resumePageToken: null,
      pendingPlan: null,
      activityCountDelta: 1,
    });
    expect(next.resumePageToken).toBeUndefined();
    expect(next.pendingPlan).toBeUndefined();
    expect(next.lastActivityId).toBe('a2');
    expect(next.activityCount).toBe(2);
    expect(next.recentActivityIds).toEqual(['a1']);
  });

  it('rebases overlapping status updates computed from one snapshot', async () => {
    const rec = await ensureObservedRecord(dataDir, 'sessions/s1');
    const rebase = { ring: [] as string[] };
    const w1 = { createTime: '2026-01-01T00:01:00Z', activityId: 'a2' };
    const w2 = { createTime: '2026-01-01T00:02:00Z', activityId: 'a3' };
    const plan = (id: string, createTime: string) => ({
      planId: `p-${id}`,
      steps: [],
      activityCreateTime: createTime,
      activityId: id,
    });
    // Newer walk lands first, then an older walk from the same snapshot.
    await upsertReadState(dataDir, rec.localRequestId, {
      watermark: w2,
      recentActivityIds: ['a1', 'a2', 'a3'],
      activityCountDelta: 3,
      newActivityIds: ['a1', 'a2', 'a3'],
      pendingPlan: plan('a3', w2.createTime),
      rebase,
    });
    const next = await upsertReadState(dataDir, rec.localRequestId, {
      watermark: w1,
      recentActivityIds: ['a1', 'a2'],
      activityCountDelta: 2,
      newActivityIds: ['a1', 'a2'],
      pendingPlan: plan('a2', w1.createTime),
      rebase,
    });
    expect(next.activityCount).toBe(3);
    expect(next.lastActivityId).toBe('a3');
    expect(next.recentActivityIds).toEqual(
      expect.arrayContaining(['a1', 'a2', 'a3'])
    );
    expect(next.pendingPlan?.activityId).toBe('a3');

    // A stale approval from the old snapshot does not clear the newer plan.
    const cleared = await upsertReadState(dataDir, rec.localRequestId, {
      pendingPlan: null,
      rebase: { ring: [], pendingPlan: plan('a2', w1.createTime) },
    });
    expect(cleared.pendingPlan?.activityId).toBe('a3');
  });

  it('rebases resumeApproval so a stale walk keeps a newer stored approval', async () => {
    const rec = await ensureObservedRecord(dataDir, 'sessions/s1');
    const older = { createTime: '2026-01-01T00:01:00Z', activityId: 'a2' };
    const newer = { createTime: '2026-01-01T00:02:00Z', activityId: 'a3' };
    // A concurrent status stored the newer approval with a resume token.
    await upsertReadState(dataDir, rec.localRequestId, {
      resumePageToken: 'tok-new',
      resumeApproval: newer,
    });
    // A stale walk (snapshot had no approval) clears it but keeps a token.
    const kept = await upsertReadState(dataDir, rec.localRequestId, {
      resumePageToken: 'tok-old',
      resumeApproval: null,
      rebase: { ring: [] },
    });
    expect(kept.resumeApproval).toEqual(newer);
    // A stale walk carrying an older approval does not replace the newer one.
    const stale = await upsertReadState(dataDir, rec.localRequestId, {
      resumePageToken: 'tok-old',
      resumeApproval: older,
      rebase: { ring: [] },
    });
    expect(stale.resumeApproval).toEqual(newer);
    // The snapshot's own approval, cleared by its walk, is not resurrected.
    const cleared = await upsertReadState(dataDir, rec.localRequestId, {
      resumePageToken: 'tok-x',
      resumeApproval: null,
      rebase: { ring: [], approval: newer },
    });
    expect(cleared.resumeApproval).toBeUndefined();
    // A completed walk drops the approval with the token.
    await upsertReadState(dataDir, rec.localRequestId, {
      resumePageToken: 'tok-y',
      resumeApproval: newer,
    });
    const done = await upsertReadState(dataDir, rec.localRequestId, {
      resumePageToken: null,
      resumeApproval: null,
      rebase: { ring: [] },
    });
    expect(done.resumePageToken).toBeUndefined();
    expect(done.resumeApproval).toBeUndefined();
  });

  it('a stale status update does not resurrect an approved plan', async () => {
    const rec = await ensureObservedRecord(dataDir, 'sessions/s1');
    const rebase = { ring: [] as string[] };
    const planStamp = { createTime: '2026-01-01T00:01:00Z', activityId: 'a1' };
    const plan = {
      planId: 'p-a1',
      steps: [],
      activityCreateTime: planStamp.createTime,
      activityId: planStamp.activityId,
    };
    // The newer walk saw the plan and then its approval, so it cleared it.
    await upsertReadState(dataDir, rec.localRequestId, {
      watermark: { createTime: '2026-01-01T00:02:00Z', activityId: 'a2' },
      recentActivityIds: ['a1', 'a2'],
      newActivityIds: ['a1', 'a2'],
      pendingPlan: null,
      rebase,
    });
    // The older walk from the same snapshot saw only the plan.
    const next = await upsertReadState(dataDir, rec.localRequestId, {
      watermark: planStamp,
      recentActivityIds: ['a1'],
      newActivityIds: ['a1'],
      pendingPlan: plan,
      rebase,
    });
    expect(next.pendingPlan).toBeUndefined();
    expect(next.lastActivityId).toBe('a2');
    expect(next.activityCount).toBe(2);
  });

  it('collect owns only artifactResumePageToken', async () => {
    const rec = await ensureObservedRecord(dataDir, 'sessions/s1');
    let next = await upsertArtifactResumeToken(
      dataDir,
      rec.localRequestId,
      'at1'
    );
    expect(next.artifactResumePageToken).toBe('at1');
    expect(next.resumePageToken).toBeUndefined();
    next = await upsertArtifactResumeToken(dataDir, rec.localRequestId, null);
    expect(next.artifactResumePageToken).toBeUndefined();
  });

  it('records a deviation once per reason and PR reference', async () => {
    const rec = await ensureObservedRecord(dataDir, 'sessions/s1');
    const dev = {
      kind: 'policy-deviation' as const,
      reason: 'vendor-pr',
      prUrl: 'https://github.com/acme/widgets/pull/1',
    };
    await recordDeviation(dataDir, rec.localRequestId, dev);
    const next = await recordDeviation(dataDir, rec.localRequestId, dev);
    expect(next.deviations).toHaveLength(1);
    expect(next.deviations[0]?.reconciled).toBe(false);
  });

  it('drops the dedup ring and both resume tokens once a record is terminal', async () => {
    await reserveOperation(dataDir, createInput('req-1'));
    await upsertReadState(dataDir, 'req-1', {
      resumePageToken: 'tok',
      recentActivityIds: ['a1', 'a2'],
    });
    await upsertArtifactResumeToken(dataDir, 'req-1', 'at');
    const settled = await markOperation(dataDir, 'req-1', 'reconciled');
    expect(settled.recentActivityIds).toEqual([]);
    expect(settled.resumePageToken).toBeUndefined();
    expect(settled.artifactResumePageToken).toBeUndefined();
  });

  it('writers on an unknown record fail with JULES_NOT_FOUND', async () => {
    await expect(
      codeOfAsync(() => markOperation(dataDir, 'nope', 'failed'))
    ).resolves.toBe('JULES_NOT_FOUND');
  });
});

describe('updateJournal change detection', () => {
  it('a mutation that replaces nothing does not rewrite the file', async () => {
    await reserveOperation(dataDir, createInput('req-a'));
    const file = resolveJournalPath(dataDir);
    const before = fs.statSync(file, { bigint: true }).mtimeNs;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const { updateJournal } = await import('../src/state.js');
    await updateJournal(dataDir, () => undefined);
    expect(fs.statSync(file, { bigint: true }).mtimeNs).toBe(before);
  });

  it('replacing, adding, or deleting a record is written', async () => {
    const { updateJournal } = await import('../src/state.js');
    await reserveOperation(dataDir, createInput('req-a'));
    await reserveOperation(
      dataDir,
      createInput('req-b', { requestedBranch: 'other' })
    );
    await updateJournal(dataDir, (operations) => {
      delete operations['req-a'];
    });
    expect(Object.keys((await readJournal(dataDir)).operations)).toEqual([
      'req-b',
    ]);

    await updateJournal(dataDir, (operations) => {
      const record = operations['req-b'];
      if (record !== undefined)
        operations['req-b'] = { ...record, condition: 'working' };
    });
    expect((await readJournal(dataDir)).operations['req-b']?.condition).toBe(
      'working'
    );
  });

  it('only a changed record is secret-scanned: a secret-shaped change is still refused', async () => {
    const { updateJournal } = await import('../src/state.js');
    await reserveOperation(dataDir, createInput('req-a'));
    await expect(
      updateJournal(dataDir, (operations) => {
        const record = operations['req-a'];
        if (record !== undefined)
          operations['req-a'] = {
            ...record,
            condition: 'Bearer abcdefghijklmnop',
          };
      })
    ).rejects.toThrow(/secret-shaped/);
  });
});
