/**
 * The wall-clock budget of one CLI call. Every `/agy:*` wrapper runs the CLI
 * under a 600 s Bash timeout, and a call killed by it never settles its task
 * or prints its envelope (recovery then treats it as a dead run). So the CLI
 * counts from process start and fits each stage inside what is left: host
 * commands (git, mkdir, tee, rm) are capped, a turn's print timeout is
 * shortened, and a turn that cannot get at least MIN_TURN_SECONDS is refused
 * before it starts.
 *
 * Until a turn spawns, host commands also leave room for the smallest turn
 * (`reserveMs`), so a slow git call fails on its own (and the caller releases
 * the reservation, refunding the task or round) instead of eating the turn.
 */

import { AgyError } from './errors';
import { DEFAULT_GRACE_MS } from './process';

/** The wrappers' Bash timeout. */
export const WRAPPER_BUDGET_MS = 600_000;
/** Held back for settling the task, writing the journal and printing JSON. */
export const SETTLE_MS = 15_000;
/** The shortest turn worth starting; also the print-timeout floor. */
export const MIN_TURN_SECONDS = 60;

export interface TurnTiming {
  readonly printTimeoutSeconds: number;
  readonly deadlineMs: number;
}

export class Budget {
  /** Kept free for a turn that has not spawned yet. */
  reserveMs = 0;

  constructor(
    private readonly elapsedMs: () => number,
    private readonly totalMs: number = WRAPPER_BUDGET_MS
  ) {}

  /** What is left before the settle allowance. */
  remainingMs(): number {
    return this.totalMs - SETTLE_MS - this.elapsedMs();
  }

  /** The timeout a host command gets: `wanted`, cut to what is left. */
  hostTimeoutMs(wanted: number): number {
    const left = this.remainingMs() - this.reserveMs;
    if (left < 1_000) {
      throw new AgyError(
        'AGY_BUDGET',
        `no time left in the ${this.totalMs / 1000} s command budget for another host command`
      );
    }
    return Math.min(wanted, left);
  }

  /**
   * The print timeout and deadline a turn gets now: the configured print
   * timeout, shortened so the turn, its deadline slack and the kill grace
   * still end inside the budget. Undefined when that is under
   * MIN_TURN_SECONDS.
   */
  turnTiming(
    printTimeoutSeconds: number,
    slackMs: number
  ): TurnTiming | undefined {
    const fits = Math.floor(
      (this.remainingMs() - slackMs - DEFAULT_GRACE_MS) / 1000
    );
    const s = Math.min(printTimeoutSeconds, fits);
    if (s < MIN_TURN_SECONDS) return undefined;
    return { printTimeoutSeconds: s, deadlineMs: s * 1000 + slackMs };
  }

  /** What the smallest turn needs, for `reserveMs`. */
  static minTurnMs(slackMs: number): number {
    return MIN_TURN_SECONDS * 1000 + slackMs + DEFAULT_GRACE_MS;
  }
}
