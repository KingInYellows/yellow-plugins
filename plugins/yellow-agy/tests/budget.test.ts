import { describe, expect, it } from 'vitest';

import { Budget, MIN_TURN_SECONDS, SETTLE_MS } from '../src/budget';

describe('Budget', () => {
  const at = (ms: number): Budget => new Budget(() => ms);

  it('counts down from 600 s less the settle allowance', () => {
    expect(at(0).remainingMs()).toBe(600_000 - SETTLE_MS);
    expect(at(100_000).remainingMs()).toBe(500_000 - SETTLE_MS);
  });

  it('gives a turn the configured print timeout while it fits', () => {
    expect(at(10_000).turnTiming(420, 30_000)).toEqual({
      printTimeoutSeconds: 420,
      deadlineMs: 450_000,
    });
  });

  it('shortens the turn so turn, slack and kill grace end inside the budget', () => {
    // 585 - 200 - 30 - 10 = 345
    expect(at(200_000).turnTiming(420, 30_000)).toEqual({
      printTimeoutSeconds: 345,
      deadlineMs: 375_000,
    });
  });

  it('refuses a turn shorter than the minimum', () => {
    const minimumFits = 600_000 - SETTLE_MS - 40_000 - MIN_TURN_SECONDS * 1000;
    expect(at(minimumFits).turnTiming(420, 30_000)?.printTimeoutSeconds).toBe(
      MIN_TURN_SECONDS
    );
    expect(at(minimumFits + 1_000).turnTiming(420, 30_000)).toBeUndefined();
  });

  it('caps host commands to what is left, minus the reserve', () => {
    const b = at(500_000);
    expect(b.hostTimeoutMs(120_000)).toBe(85_000);
    b.reserveMs = Budget.minTurnMs(30_000);
    expect(() => b.hostTimeoutMs(120_000)).toThrow(
      expect.objectContaining({ code: 'AGY_BUDGET' })
    );
    b.reserveMs = 0;
    expect(at(0).hostTimeoutMs(120_000)).toBe(120_000);
  });
});
