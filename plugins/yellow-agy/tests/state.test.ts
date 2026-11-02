import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  dataDir,
  readJournal,
  recentUsage,
  updateJournal,
  withLock,
  writeJournal,
} from '../src/state';

import { tmpDir } from './helpers';

describe('state', () => {
  it('picks YELLOW_AGY_DATA_DIR, then the XDG state dir', () => {
    expect(dataDir({ YELLOW_AGY_DATA_DIR: '/x/y' })).toBe('/x/y');
    if (process.platform !== 'win32') {
      expect(dataDir({ XDG_STATE_HOME: '/s' })).toBe('/s/yellow-agy');
    }
  });

  it('starts empty and round-trips atomically with owner-only modes', async () => {
    const dir = path.join(tmpDir('agy-state-'), 'data');
    expect(readJournal(dir).tasks).toEqual({});
    await updateJournal(dir, (j) => ({
      journal: {
        ...j,
        usage: [{ at: new Date().toISOString(), localId: 'a', requestId: 'r' }],
      },
      result: undefined,
    }));
    expect(readJournal(dir).usage).toHaveLength(1);
    if (process.platform !== 'win32') {
      expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
      expect(fs.statSync(path.join(dir, 'journal.json')).mode & 0o777).toBe(
        0o600
      );
    }
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('drops usage older than a day and filters a window', () => {
    const dir = tmpDir('agy-state-');
    const old = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const recent = new Date(Date.now() - 60_000).toISOString();
    writeJournal(dir, {
      version: 1,
      tasks: {},
      requests: {},
      usage: [
        { at: old, localId: 'a', requestId: '1' },
        { at: recent, localId: 'a', requestId: '2' },
      ],
    });
    const j = readJournal(dir);
    expect(j.usage.map((u) => u.requestId)).toEqual(['2']);
    expect(recentUsage(j, 30_000)).toEqual([]);
    expect(recentUsage(j, 15 * 60_000)).toHaveLength(1);
  });

  it('serializes lock holders and breaks a lock whose pid is dead', async () => {
    const dir = tmpDir('agy-state-');
    const order: string[] = [];
    await Promise.all([
      withLock(dir, async () => {
        order.push('a1');
        await new Promise((r) => setTimeout(r, 50));
        order.push('a2');
      }),
      withLock(dir, () => {
        order.push('b');
      }),
    ]);
    expect(order.indexOf('b') === 0 || order.indexOf('b') === 2).toBe(true);
    fs.writeFileSync(path.join(dir, 'journal.lock'), '999999999\n');
    await expect(withLock(dir, () => 'ok', { timeoutMs: 500 })).resolves.toBe(
      'ok'
    );
  });

  it('times out with AGY_BUSY while a live pid holds the lock', async () => {
    const dir = tmpDir('agy-state-');
    fs.writeFileSync(path.join(dir, 'journal.lock'), `${process.pid}\n`);
    await expect(
      withLock(dir, () => 'x', { timeoutMs: 100 })
    ).rejects.toMatchObject({
      code: 'AGY_BUSY',
    });
  });

  it('refuses a journal it cannot parse', () => {
    const dir = tmpDir('agy-state-');
    fs.writeFileSync(path.join(dir, 'journal.json'), '{not json');
    expect(() => readJournal(dir)).toThrow(/not valid JSON/);
  });
});
