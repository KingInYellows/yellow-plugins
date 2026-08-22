import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  findByAgentId,
  findByIdempotencyKey,
  readIndex,
  throwIfQuarantined,
  upsertRecord,
  withStateLock,
  writeIndex,
  type AgentRecord,
} from '../src/state.js';
import { AppErrorException } from '../src/errors.js';

let tmpDir: string;
let stateFile: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'yellow-cursor-state-')
  );
  stateFile = path.join(tmpDir, 'state', 'agents.json');
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

function makeRecord(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    repository: 'https://github.com/org/repo',
    status: 'running',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    idempotencyKey: 'key-1',
    promptDigest: 'a'.repeat(64),
    ...overrides,
  };
}

describe('readIndex / writeIndex', () => {
  it('round-trips a record and keys the index by idempotencyKey', async () => {
    const record = makeRecord({ agentId: 'bc-abc' });
    await writeIndex(stateFile, { [record.idempotencyKey]: record });
    const { index, quarantined } = await readIndex(stateFile);
    expect(quarantined).toBe(false);
    expect(index['key-1']).toEqual(record);
    expect(findByIdempotencyKey(index, 'key-1')).toEqual(record);
    expect(findByAgentId(index, 'bc-abc')).toEqual(record);
  });

  it('returns an empty index when the file does not exist yet', async () => {
    const { index, quarantined } = await readIndex(stateFile);
    expect(index).toEqual({});
    expect(quarantined).toBe(false);
  });

  it('writes the state file and its directory with restrictive permissions', async () => {
    await writeIndex(stateFile, { k: makeRecord() });
    const fileMode = (await fs.promises.stat(stateFile)).mode & 0o777;
    const dirMode =
      (await fs.promises.stat(path.dirname(stateFile))).mode & 0o777;
    expect(fileMode).toBe(0o600);
    expect(dirMode).toBe(0o700);
  });

  it('writes atomically: readers never see a partially-written file', async () => {
    await writeIndex(stateFile, { a: makeRecord({ idempotencyKey: 'a' }) });
    // A second write should fully replace, never merge-corrupt, the file.
    await writeIndex(stateFile, { b: makeRecord({ idempotencyKey: 'b' }) });
    const { index } = await readIndex(stateFile);
    expect(Object.keys(index)).toEqual(['b']);
  });

  it('refuses to persist a record with a secret-shaped field', async () => {
    const record = makeRecord({ idempotencyKey: 'key-2' }) as AgentRecord & {
      apiKey?: string;
    };
    (record as Record<string, unknown>)['apiKey'] = 'whatever-value';
    await expect(
      writeIndex(stateFile, { 'key-2': record as AgentRecord })
    ).rejects.toThrow();
  });
});

describe('symlink rejection', () => {
  it('refuses to read through a symlinked state file', async () => {
    await fs.promises.mkdir(path.dirname(stateFile), { recursive: true });
    const realTarget = path.join(tmpDir, 'real-target.json');
    await fs.promises.writeFile(realTarget, '{}');
    await fs.promises.symlink(realTarget, stateFile);

    await expect(readIndex(stateFile)).rejects.toThrow(/symlink/);
  });

  it('refuses to write through a symlinked state file', async () => {
    await fs.promises.mkdir(path.dirname(stateFile), { recursive: true });
    const realTarget = path.join(tmpDir, 'real-target.json');
    await fs.promises.writeFile(realTarget, '{}');
    await fs.promises.symlink(realTarget, stateFile);

    await expect(writeIndex(stateFile, { k: makeRecord() })).rejects.toThrow(
      /symlink/
    );
  });

  it('refuses to operate through a symlinked state directory', async () => {
    const realDir = path.join(tmpDir, 'real-state-dir');
    await fs.promises.mkdir(realDir, { recursive: true });
    await fs.promises.symlink(realDir, path.dirname(stateFile));

    await expect(readIndex(stateFile)).rejects.toThrow(/symlink/);
  });
});

describe('corrupt-file quarantine', () => {
  it('quarantines unparseable JSON and continues with an empty index', async () => {
    await fs.promises.mkdir(path.dirname(stateFile), { recursive: true });
    await fs.promises.writeFile(stateFile, 'not { valid json');

    const { index, quarantined, quarantinePath } = await readIndex(stateFile);
    expect(quarantined).toBe(true);
    expect(index).toEqual({});
    expect(quarantinePath).toBeDefined();
    expect(fs.existsSync(quarantinePath as string)).toBe(true);
    expect(fs.existsSync(stateFile)).toBe(false);
  });

  it('quarantines a structurally-invalid index and continues', async () => {
    await fs.promises.mkdir(path.dirname(stateFile), { recursive: true });
    await fs.promises.writeFile(
      stateFile,
      JSON.stringify({ k: { status: 'running' } })
    );

    const { index, quarantined } = await readIndex(stateFile);
    expect(quarantined).toBe(true);
    expect(index).toEqual({});
  });

  it('allows a normal write immediately after a quarantine', async () => {
    await fs.promises.mkdir(path.dirname(stateFile), { recursive: true });
    await fs.promises.writeFile(stateFile, 'garbage');
    await readIndex(stateFile);

    await upsertRecord(stateFile, makeRecord({ idempotencyKey: 'fresh' }));
    const { index } = await readIndex(stateFile);
    expect(index['fresh']).toBeDefined();
  });

  it('throwIfQuarantined surfaces CURSOR_STATE_CORRUPT instead of silent empty index', async () => {
    await fs.promises.mkdir(path.dirname(stateFile), { recursive: true });
    await fs.promises.writeFile(stateFile, 'garbage');
    const result = await readIndex(stateFile);
    expect(() => throwIfQuarantined(result)).toThrow(AppErrorException);
    try {
      throwIfQuarantined(result);
    } catch (err) {
      expect(err).toBeInstanceOf(AppErrorException);
      expect((err as AppErrorException).appError.code).toBe(
        'CURSOR_STATE_CORRUPT'
      );
    }
  });
});

describe('concurrency locking', () => {
  it('serializes concurrent upsertRecord read-modify-write cycles so no update is lost', async () => {
    const keys = Array.from({ length: 15 }, (_, i) => `concurrent-${i}`);
    await Promise.all(
      keys.map((key) =>
        upsertRecord(stateFile, makeRecord({ idempotencyKey: key }))
      )
    );

    const { index } = await readIndex(stateFile);
    for (const key of keys) {
      expect(index[key]).toBeDefined();
    }
    expect(Object.keys(index)).toHaveLength(keys.length);
  });

  it('a fresh (non-stale) lock blocks a second acquirer until the first releases', async () => {
    const order: string[] = [];
    const release = async (): Promise<void> => {
      order.push('first-released');
    };

    const firstHeld = withStateLock(
      stateFile,
      async () => {
        order.push('first-acquired');
        await new Promise((resolve) => setTimeout(resolve, 100));
        await release();
      },
      { staleMs: 10_000, timeoutMs: 5_000, pollMs: 10 }
    );
    // Give the first lock a moment to actually acquire before starting the second.
    await new Promise((resolve) => setTimeout(resolve, 20));

    const second = withStateLock(
      stateFile,
      async () => {
        order.push('second-acquired');
      },
      { staleMs: 10_000, timeoutMs: 5_000, pollMs: 10 }
    );

    await Promise.all([firstHeld, second]);
    expect(order).toEqual([
      'first-acquired',
      'first-released',
      'second-acquired',
    ]);
  });

  it('times out acquiring a lock that is held and not yet stale', async () => {
    const holdForever = withStateLock(
      stateFile,
      () => new Promise(() => {}), // never resolves — holds the lock for the test's duration
      { staleMs: 10_000, timeoutMs: 5_000, pollMs: 10 }
    );
    // Swallow the eventual unhandled rejection this generates at test teardown; not the assertion under test.
    holdForever.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 20));

    await expect(
      withStateLock(stateFile, async () => 'unreachable', {
        staleMs: 10_000,
        timeoutMs: 100,
        pollMs: 10,
      })
    ).rejects.toThrow(/timed out acquiring state lock/);
  });

  it('takes over a stale lock left behind by a crashed process instead of hanging', async () => {
    await fs.promises.mkdir(path.dirname(stateFile), { recursive: true });
    const lockPath = path.join(path.dirname(stateFile), '.agents.json.lock');
    await fs.promises.writeFile(lockPath, 'some-other-process-owner-token');
    const staleTime = new Date(Date.now() - 60_000);
    await fs.promises.utimes(lockPath, staleTime, staleTime);

    const result = await withStateLock(stateFile, async () => 'done', {
      staleMs: 50,
      timeoutMs: 2_000,
      pollMs: 10,
    });

    expect(result).toBe('done');
    // The stale lock file itself is gone (taken over, then released) — a
    // subsequent normal upsert isn't blocked behind the abandoned owner.
    expect(fs.existsSync(lockPath)).toBe(false);

    await upsertRecord(stateFile, makeRecord({ idempotencyKey: 'took-over' }));
    const { index } = await readIndex(stateFile);
    expect(index['took-over']).toBeDefined();
  });
});
