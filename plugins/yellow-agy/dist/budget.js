"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.Budget = exports.MIN_TURN_SECONDS = exports.SETTLE_MS = exports.WRAPPER_BUDGET_MS = void 0;
const errors_1 = require("./errors");
const process_1 = require("./process");
/** The wrappers' Bash timeout. */
exports.WRAPPER_BUDGET_MS = 600_000;
/** Held back for settling the task, writing the journal and printing JSON. */
exports.SETTLE_MS = 15_000;
/** The shortest turn worth starting; also the print-timeout floor. */
exports.MIN_TURN_SECONDS = 60;
class Budget {
    elapsedMs;
    totalMs;
    /** Kept free for a turn that has not spawned yet. */
    reserveMs = 0;
    constructor(elapsedMs, totalMs = exports.WRAPPER_BUDGET_MS) {
        this.elapsedMs = elapsedMs;
        this.totalMs = totalMs;
    }
    /** What is left before the settle allowance. */
    remainingMs() {
        return this.totalMs - exports.SETTLE_MS - this.elapsedMs();
    }
    /** The timeout a host command gets: `wanted`, cut to what is left. */
    hostTimeoutMs(wanted) {
        const left = this.remainingMs() - this.reserveMs;
        if (left < 1_000) {
            throw new errors_1.AgyError('AGY_BUDGET', `no time left in the ${this.totalMs / 1000} s command budget for another host command`);
        }
        return Math.min(wanted, left);
    }
    /**
     * The print timeout and deadline a turn gets now: the configured print
     * timeout, shortened so the turn, its deadline slack and the kill grace
     * still end inside the budget. Undefined when that is under
     * MIN_TURN_SECONDS.
     */
    turnTiming(printTimeoutSeconds, slackMs) {
        const fits = Math.floor((this.remainingMs() - slackMs - process_1.DEFAULT_GRACE_MS) / 1000);
        const s = Math.min(printTimeoutSeconds, fits);
        if (s < exports.MIN_TURN_SECONDS)
            return undefined;
        return { printTimeoutSeconds: s, deadlineMs: s * 1000 + slackMs };
    }
    /** What the smallest turn needs, for `reserveMs`. */
    static minTurnMs(slackMs) {
        return exports.MIN_TURN_SECONDS * 1000 + slackMs + process_1.DEFAULT_GRACE_MS;
    }
}
exports.Budget = Budget;
