/**
 * The quota gate (contract-v0 "Quota gate"). Before every model turn it runs
 * `agy -p /usage --output-format json`, which makes no model call, under the
 * same profile as the turn it guards. `/usage` updates late, so turns from
 * the last 15 minutes are subtracted from what it reports.
 */

import type { TurnOutcome } from './classify';
import { AgyError } from './errors';
import type { Host, Invocation } from './invocation';
import { buildInvocation } from './invocation';
import type { RunOptions } from './process';
import type { TurnProfile } from './profiles';
import { usageArgs } from './profiles';
import type { Journal } from './state';
import { recentUsage } from './state';

export const QUOTA_WINDOW_MS = 15 * 60 * 1000;
/** Percentage points charged for a recent turn whose cost is unknown. */
export const UNKNOWN_TURN_COST = 2;
const PROBE_DEADLINE_MS = 60_000;
const MAX_DEPTH = 6;

const REMAINING_KEY = /remaining/i;

/**
 * The lowest remaining fraction (0..1) of any bucket in `/usage` JSON, or
 * undefined when the output has none. Every numeric field whose key names a
 * remaining amount counts: a fraction as is, a 0-100 value under a key that
 * says percent as a percentage. A remaining value outside that range makes
 * the whole output unknown, and an unknown shape finds nothing, so the gate
 * fails closed either way.
 */
export function lowestRemaining(stdout: string): number | undefined {
  let value: unknown;
  try {
    value = JSON.parse(stdout.trim());
  } catch {
    return undefined;
  }
  let lowest: number | undefined;
  let unreadable = false;
  const visit = (v: unknown, depth: number): void => {
    if (depth > MAX_DEPTH || v === null || typeof v !== 'object') return;
    for (const [key, child] of Object.entries(v)) {
      if (typeof child === 'number' && REMAINING_KEY.test(key)) {
        const fraction = /percent|pct/i.test(key) ? child / 100 : child;
        if (Number.isFinite(fraction) && fraction >= 0 && fraction <= 1) {
          lowest = lowest === undefined ? fraction : Math.min(lowest, fraction);
        } else {
          // A bucket this version can't read could be the empty one.
          unreadable = true;
        }
      } else if (
        REMAINING_KEY.test(key) &&
        (child === null || typeof child !== 'object')
      ) {
        // null, a string or a boolean where a remaining amount belongs.
        unreadable = true;
      } else {
        visit(child, depth + 1);
      }
    }
  };
  visit(value, 0);
  return unreadable ? undefined : lowest;
}

/** Percentage points the journal's recent turns are assumed to have used. */
export function recentCost(j: Journal, now: number = Date.now()): number {
  return recentUsage(j, QUOTA_WINDOW_MS, now).reduce(
    (sum, u) =>
      sum +
      (typeof u.cost === 'number' && Number.isFinite(u.cost) && u.cost >= 0
        ? u.cost
        : UNKNOWN_TURN_COST),
    0
  );
}

export interface QuotaGateDeps {
  readonly host: Host;
  /** Where the probe runs: the repo, in the filesystem agy runs in. */
  readonly cwd: string;
  readonly baseEnv: Readonly<Record<string, string | undefined>>;
  readonly filterDrivers: () => Promise<readonly string[]>;
  readonly minQuotaPercent: number;
  readonly runTurn: (
    inv: Invocation,
    options: RunOptions
  ) => Promise<TurnOutcome>;
  readonly now?: () => number;
}

/** The Lifecycle `quotaGate` dep: refuses with AGY_QUOTA_LOW or AGY_QUOTA_UNKNOWN. */
export function quotaGate(
  deps: QuotaGateDeps
): (profile: TurnProfile, journal: Journal) => Promise<void> {
  return async (profile, journal) => {
    const inv = buildInvocation(deps.host, usageArgs(profile), {
      cwd: deps.cwd,
      baseEnv: deps.baseEnv,
      filterDrivers: await deps.filterDrivers(),
    });
    let outcome: TurnOutcome;
    try {
      outcome = await deps.runTurn(inv, { deadlineMs: PROBE_DEADLINE_MS });
    } catch (err) {
      throw new AgyError(
        'AGY_QUOTA_UNKNOWN',
        `agy -p /usage could not run: ${String(err)}`
      );
    }
    // Only a probe that exited 0 on its own counts; a killed one's output
    // may be partial.
    const clean =
      outcome.exitCode === 0 &&
      outcome.signal === null &&
      !outcome.killedByDeadline &&
      !outcome.cancelled;
    const remaining = clean ? lowestRemaining(outcome.stdout) : undefined;
    if (remaining === undefined) {
      throw new AgyError(
        'AGY_QUOTA_UNKNOWN',
        clean
          ? 'agy -p /usage printed no remaining quota this version understands'
          : outcome.killedByDeadline || outcome.cancelled
            ? 'agy -p /usage did not finish'
            : `agy -p /usage exited ${String(outcome.exitCode ?? outcome.signal)}`
      );
    }
    const percent =
      remaining * 100 - recentCost(journal, (deps.now ?? Date.now)());
    if (percent < deps.minQuotaPercent) {
      throw new AgyError(
        'AGY_QUOTA_LOW',
        `about ${Math.max(0, Math.floor(percent))}% of the AI Pro quota is left; the grant needs ${deps.minQuotaPercent}%`
      );
    }
  };
}
