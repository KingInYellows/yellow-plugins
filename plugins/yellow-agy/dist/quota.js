"use strict";
/**
 * The quota gate (contract-v0 "Quota gate"). Before every model turn it runs
 * `agy -p /usage --output-format json`, which makes no model call, under the
 * same profile as the turn it guards. `/usage` updates late, so turns from
 * the last 15 minutes are subtracted from what it reports.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.UNKNOWN_TURN_COST = exports.QUOTA_WINDOW_MS = void 0;
exports.lowestRemaining = lowestRemaining;
exports.recentCost = recentCost;
exports.quotaGate = quotaGate;
const errors_1 = require("./errors");
const invocation_1 = require("./invocation");
const profiles_1 = require("./profiles");
const state_1 = require("./state");
exports.QUOTA_WINDOW_MS = 15 * 60 * 1000;
/** Percentage points charged for a recent turn whose cost is unknown. */
exports.UNKNOWN_TURN_COST = 2;
const PROBE_DEADLINE_MS = 60_000;
const MAX_DEPTH = 6;
const REMAINING_KEY = /remaining/i;
/**
 * The lowest remaining fraction (0..1) of any bucket in `/usage` JSON, or
 * undefined when the output has none. Every numeric field whose key names a
 * remaining amount counts: a fraction as is, a 0-100 value under a key that
 * says percent as a percentage. Anything else is ignored, so an unknown
 * shape finds nothing and the gate fails closed.
 */
function lowestRemaining(stdout) {
    let value;
    try {
        value = JSON.parse(stdout.trim());
    }
    catch {
        return undefined;
    }
    let lowest;
    const visit = (v, depth) => {
        if (depth > MAX_DEPTH || v === null || typeof v !== 'object')
            return;
        for (const [key, child] of Object.entries(v)) {
            if (typeof child === 'number' && REMAINING_KEY.test(key)) {
                const fraction = /percent|pct/i.test(key) ? child / 100 : child;
                if (Number.isFinite(fraction) && fraction >= 0 && fraction <= 1) {
                    lowest = lowest === undefined ? fraction : Math.min(lowest, fraction);
                }
            }
            else {
                visit(child, depth + 1);
            }
        }
    };
    visit(value, 0);
    return lowest;
}
/** Percentage points the journal's recent turns are assumed to have used. */
function recentCost(j, now = Date.now()) {
    return (0, state_1.recentUsage)(j, exports.QUOTA_WINDOW_MS, now).reduce((sum, u) => sum + (u.cost ?? exports.UNKNOWN_TURN_COST), 0);
}
/** The Lifecycle `quotaGate` dep: refuses with AGY_QUOTA_LOW or AGY_QUOTA_UNKNOWN. */
function quotaGate(deps) {
    return async (profile, journal) => {
        const inv = (0, invocation_1.buildInvocation)(deps.host, (0, profiles_1.usageArgs)(profile), {
            cwd: deps.cwd,
            baseEnv: deps.baseEnv,
            filterDrivers: await deps.filterDrivers(),
        });
        let outcome;
        try {
            outcome = await deps.runTurn(inv, { deadlineMs: PROBE_DEADLINE_MS });
        }
        catch (err) {
            throw new errors_1.AgyError('AGY_QUOTA_UNKNOWN', `agy -p /usage could not run: ${String(err)}`);
        }
        const remaining = outcome.exitCode === 0 ? lowestRemaining(outcome.stdout) : undefined;
        if (remaining === undefined) {
            throw new errors_1.AgyError('AGY_QUOTA_UNKNOWN', outcome.exitCode === 0
                ? 'agy -p /usage printed no remaining quota this version understands'
                : `agy -p /usage exited ${String(outcome.exitCode)}`);
        }
        const percent = remaining * 100 - recentCost(journal, (deps.now ?? Date.now)());
        if (percent < deps.minQuotaPercent) {
            throw new errors_1.AgyError('AGY_QUOTA_LOW', `about ${Math.max(0, Math.floor(percent))}% of the AI Pro quota is left; the grant needs ${deps.minQuotaPercent}%`);
        }
    };
}
