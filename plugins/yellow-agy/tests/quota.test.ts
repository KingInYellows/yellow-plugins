import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { TurnOutcome } from '../src/classify';
import type { Invocation } from '../src/invocation';
import { readOnlyProfile } from '../src/profiles';
import { lowestRemaining, quotaGate, recentCost } from '../src/quota';
import type { Journal } from '../src/state';

const FIXTURE = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'usage-1.4.12.json'),
  'utf8'
);

/** agy 1.4.12 `/usage` JSON with one group per list of bucket fractions. */
function usage(...groups: unknown[][]): string {
  return JSON.stringify({
    status: 'SUCCESS',
    command: {
      name: 'usage',
      data: {
        groups: groups.map((fractions, g) => ({
          name: `g${g}`,
          buckets: fractions.map((f, b) => ({
            id: `b${b}`,
            remaining_fraction: f,
          })),
        })),
      },
    },
  });
}

const NOW = Date.parse('2026-11-03T01:00:00Z');
const at = (minutesAgo: number) =>
  new Date(NOW - minutesAgo * 60_000).toISOString();

function journal(entries: { min: number; cost?: number }[]): Journal {
  return {
    version: 1,
    tasks: {},
    requests: {},
    usage: entries.map((e, i) => ({
      at: at(e.min),
      localId: 't1',
      requestId: `r${i}`,
      ...(e.cost === undefined ? {} : { cost: e.cost }),
    })),
  };
}

function gate(
  stdout: string,
  exitCode: number | null = 0,
  minQuotaPercent = 10,
  extra: Partial<TurnOutcome> = {}
) {
  const calls: Invocation[] = [];
  const run = quotaGate({
    host: { kind: 'posix' },
    cwd: '/r',
    baseEnv: {},
    filterDrivers: async () => [],
    minQuotaPercent,
    now: () => NOW,
    runTurn: async (inv): Promise<TurnOutcome> => {
      calls.push(inv);
      return {
        exitCode,
        signal: null,
        killedByDeadline: false,
        cancelled: false,
        stdout,
        stderr: '',
        ...extra,
      };
    },
  });
  return { run, calls };
}

async function code(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (err) {
    return (err as { code?: string }).code;
  }
}

describe('quota gate', () => {
  it('reads the lowest bucket of the captured agy 1.4.12 output', () => {
    expect(lowestRemaining(FIXTURE)).toBe(0.971563994884491);
    expect(lowestRemaining(usage([1, 0.8], [0.3]))).toBe(0.3);
    expect(lowestRemaining(usage([0]))).toBe(0);
  });

  it('treats any other shape as unknown', () => {
    const fixture = JSON.parse(FIXTURE) as Record<string, unknown>;
    for (const bad of [
      'not json',
      '{}',
      JSON.stringify({ ...fixture, status: 'ERROR' }),
      JSON.stringify({ ...fixture, command: { name: 'help', data: {} } }),
      usage(),
      usage([0.8], []),
      usage([0.8, -1]),
      usage([0.8, 1.5]),
      usage([0.8, null]),
      usage([0.8, '0.5']),
      usage([0.8, true]),
      // The old guess at the shape no longer counts.
      JSON.stringify({ buckets: [{ remainingFraction: 0.8 }] }),
    ]) {
      expect(lowestRemaining(bad)).toBeUndefined();
    }
  });

  it('charges a malformed or negative cost as unknown', () => {
    const j = journal([
      { min: 1, cost: -50 },
      { min: 2, cost: Number.NaN },
    ]);
    expect(recentCost(j, NOW)).toBe(4);
  });

  it('fails closed when the probe throws or is killed', async () => {
    const profile = readOnlyProfile();
    const good = usage([0.9]);
    for (const extra of [
      { killedByDeadline: true },
      { cancelled: true },
      { signal: 'SIGKILL' },
    ]) {
      expect(
        await code(gate(good, 0, 10, extra).run(profile, journal([])))
      ).toBe('AGY_QUOTA_UNKNOWN');
    }
    expect(
      await code(
        gate(good, null, 10, { killedByDeadline: true }).run(
          profile,
          journal([])
        )
      )
    ).toBe('AGY_QUOTA_UNKNOWN');
    const throwing = quotaGate({
      host: { kind: 'posix' },
      cwd: '/r',
      baseEnv: {},
      filterDrivers: async () => [],
      minQuotaPercent: 10,
      runTurn: async () => {
        throw new Error('spawn failed');
      },
    });
    expect(await code(throwing(profile, journal([])))).toBe(
      'AGY_QUOTA_UNKNOWN'
    );
  });

  it('subtracts recent turns, 2 points each when the cost is unknown', () => {
    expect(
      recentCost(journal([{ min: 1 }, { min: 5, cost: 4 }, { min: 30 }]), NOW)
    ).toBe(6);
  });

  it('runs /usage under the turn profile and refuses low or unknown quota', async () => {
    const profile = readOnlyProfile();
    const ok = gate(usage([0.5]));
    await ok.run(profile, journal([]));
    expect(ok.calls[0]?.args.slice(0, 4)).toEqual([
      '-p',
      '/usage',
      '--output-format',
      'json',
    ]);
    expect(ok.calls[0]?.args).toContain(profile.settings);
    // 13% reported, minus two unknown turns: 9% < 10%.
    expect(
      await code(
        gate(usage([0.13])).run(profile, journal([{ min: 2 }, { min: 3 }]))
      )
    ).toBe('AGY_QUOTA_LOW');
    expect(await code(gate('{}').run(profile, journal([])))).toBe(
      'AGY_QUOTA_UNKNOWN'
    );
    expect(await code(gate(usage([0.9]), 1).run(profile, journal([])))).toBe(
      'AGY_QUOTA_UNKNOWN'
    );
  });
});
