import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveJournalPath, resolveStateDir } from '../src/config.js';
import { list } from '../src/runtime.js';
import { ensureObservedRecord, reserveOperation } from '../src/state.js';

import { FakeSdkAdapter, makeDeps, makeSession } from './fake-sdk.js';
import { codeOfAsync } from './support/app-error.js';

vi.setConfig({ testTimeout: 30_000 });

let dataDir: string;
let fake: FakeSdkAdapter;
const TAGGED = `jl-${'c'.repeat(32)}`;

beforeEach(async () => {
  dataDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'yellow-jules-list-')
  );
  fake = new FakeSdkAdapter();
  fake.sessions.set(
    'sessions/s1',
    makeSession({
      sessionResource: 'sessions/s1',
      title: `[yellow:${TAGGED}] Tagged task`,
    })
  );
  fake.sessions.set(
    'sessions/s2',
    makeSession({
      sessionResource: 'sessions/s2',
      vendorState: 'completed',
      title: 'Plain',
    })
  );
  fake.sessions.set(
    'sessions/s3',
    makeSession({ sessionResource: 'sessions/s3', vendorState: 'weird' })
  );
});

afterEach(async () => {
  await fs.promises.rm(dataDir, { recursive: true, force: true });
});

describe('list', () => {
  it('reads exactly one sessions page and no activities', async () => {
    const result = await list(makeDeps(dataDir, fake), {});
    expect(fake.callsTo('listSessions')).toHaveLength(1);
    expect(fake.callsTo('listActivities')).toHaveLength(0);
    expect(fake.callsTo('getSession')).toHaveLength(0);
    expect(fake.callsTo('listSessions')[0]?.args[0]).toEqual({ pageSize: 20 });
    expect(result.sessions).toHaveLength(3);
    expect(fake.closed).toBe(true);
  });

  it('strips the tag from titles but never trusts it as a local id on its own', async () => {
    const result = await list(makeDeps(dataDir, fake), {});
    expect(result.sessions[0]).toMatchObject({
      title: 'Tagged task',
      condition: 'working',
    });
    // The tag is vendor-writable: an unbound claim is not surfaced.
    expect(result.sessions[0]).not.toHaveProperty('localId');
    expect(result.sessions[1]).toMatchObject({
      title: 'Plain',
      condition: 'remote-completed',
    });
    expect(result.sessions[1]).not.toHaveProperty('localId');
    expect(result.sessions[2]?.condition).toBe('needs-inspection');
  });

  it('prefers the journal-bound local id', async () => {
    const rec = await ensureObservedRecord(dataDir, 'sessions/s2');
    const result = await list(makeDeps(dataDir, fake), {});
    expect(result.sessions[1]?.localId).toBe(rec.localId);
  });

  it('journalOnly is page-scoped: rows whose session is not on this page', async () => {
    const onPage = await ensureObservedRecord(dataDir, 'sessions/s1');
    const offPage = await ensureObservedRecord(dataDir, 'sessions/s3');
    await reserveOperation(dataDir, {
      localRequestId: 'req-1',
      kind: 'create',
      repository: 'acme/widgets',
      requestedBranch: 'main',
    });
    const result = await list(makeDeps(dataDir, fake), { limit: 2 });
    expect(result.sessions.map((s) => s.sessionResource)).toEqual([
      'sessions/s1',
      'sessions/s2',
    ]);
    expect(result.nextPageToken).toBe('p2');
    const localIds = result.journalOnly.map((r) => r.localId);
    expect(localIds).toContain(offPage.localId);
    expect(localIds).not.toContain(onPage.localId);
    expect(
      result.journalOnly.find((r) => r.sessionResource === undefined)?.condition
    ).toBe('reserved');
  });

  it('passes a validated page token and refuses a malformed one', async () => {
    await list(makeDeps(dataDir, fake), { pageToken: 'p1', limit: 1 });
    expect(fake.callsTo('listSessions')[0]?.args[0]).toEqual({
      pageSize: 1,
      pageToken: 'p1',
    });
    await expect(
      codeOfAsync(() => list(makeDeps(dataDir, fake), { pageToken: '../x' }))
    ).resolves.toBe('JULES_INVALID_INPUT');
  });

  it('a malformed vendor page token is JULES_MALFORMED_RESPONSE', async () => {
    fake.listSessionsImpl = async () => ({
      sessions: [],
      nextPageToken: 'a/b',
    });
    await expect(
      codeOfAsync(() => list(makeDeps(dataDir, fake), {}))
    ).resolves.toBe('JULES_MALFORMED_RESPONSE');
  });

  it('a corrupt journal is reported, not degraded to an empty set (R37)', async () => {
    fs.mkdirSync(resolveStateDir(dataDir), { recursive: true, mode: 0o700 });
    fs.writeFileSync(resolveJournalPath(dataDir), 'not json', { mode: 0o600 });
    await expect(
      codeOfAsync(() => list(makeDeps(dataDir, fake), {}))
    ).resolves.toBe('JULES_JOURNAL_CORRUPT');
    expect(fake.calls).toEqual([]);
  });
});
