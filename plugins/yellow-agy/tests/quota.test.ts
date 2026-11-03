import { describe, expect, it } from 'vitest';

import type { TurnOutcome } from '../src/classify';
import type { Invocation } from '../src/invocation';
import { readOnlyProfile } from '../src/profiles';
import { lowestRemaining, quotaGate, recentCost } from '../src/quota';
import type { Journal } from '../src/state';

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
  it('reads the lowest remaining fraction of any bucket', () => {
    expect(
      lowestRemaining(
        JSON.stringify({
          buckets: [
            { model: 'a', remainingFraction: 0.8 },
            { model: 'b', remainingFraction: 0.3 },
          ],
        })
      )
    ).toBe(0.3);
    expect(lowestRemaining(JSON.stringify({ remaining_percent: 42 }))).toBe(
      0.42
    );
    expect(lowestRemaining(JSON.stringify({ used: 0.5 }))).toBeUndefined();
    expect(lowestRemaining(JSON.stringify({ remaining: 7 }))).toBeUndefined();
    expect(lowestRemaining('not json')).toBeUndefined();
    // One unreadable bucket makes the whole output unknown.
    expect(
      lowestRemaining(
        JSON.stringify({
          buckets: [{ remainingFraction: 0.8 }, { remainingFraction: -1 }],
        })
      )
    ).toBeUndefined();
    for (const bad of [null, '0.5', true]) {
      expect(
        lowestRemaining(
          JSON.stringify({
            buckets: [{ remainingFraction: 0.8 }, { remainingFraction: bad }],
          })
        )
      ).toBeUndefined();
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
    const good = JSON.stringify({ remainingFraction: 0.9 });
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
    const ok = gate(JSON.stringify({ remainingFraction: 0.5 }));
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
        gate(JSON.stringify({ remainingFraction: 0.13 })).run(
          profile,
          journal([{ min: 2 }, { min: 3 }])
        )
      )
    ).toBe('AGY_QUOTA_LOW');
    expect(await code(gate('{}').run(profile, journal([])))).toBe(
      'AGY_QUOTA_UNKNOWN'
    );
    expect(
      await code(
        gate(JSON.stringify({ remainingFraction: 0.9 }), 1).run(
          profile,
          journal([])
        )
      )
    ).toBe('AGY_QUOTA_UNKNOWN');
  });
});
