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
/**
 * The lowest `remaining_fraction` (0..1) across every bucket of every group in
 * agy's `/usage` JSON (shape captured from agy 1.4.12:
 * `{status:"SUCCESS", command:{name:"usage", data:{groups:[{buckets:[
 * {remaining_fraction}]}]}}}`), or undefined when the output doesn't have that
 * shape. A group with no buckets, or a bucket whose fraction is missing or
 * outside 0..1, makes the whole output unknown, so the gate fails closed. The
 * lowest bucket counts whichever model the turn uses, because agy picks it.
 */
function lowestRemaining(stdout) {
    let value;
    try {
        value = JSON.parse(stdout.trim());
    }
    catch {
        return undefined;
    }
    const obj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
        ? v
        : undefined;
    const root = obj(value);
    const command = obj(root?.['command']);
    const groups = obj(command?.['data'])?.['groups'];
    if (root?.['status'] !== 'SUCCESS' ||
        command?.['name'] !== 'usage' ||
        !Array.isArray(groups) ||
        groups.length === 0) {
        return undefined;
    }
    let lowest = Infinity;
    for (const group of groups) {
        const buckets = obj(group)?.['buckets'];
        if (!Array.isArray(buckets) || buckets.length === 0)
            return undefined;
        for (const bucket of buckets) {
            const f = obj(bucket)?.['remaining_fraction'];
            if (typeof f !== 'number' || !Number.isFinite(f) || f < 0 || f > 1) {
                return undefined;
            }
            lowest = Math.min(lowest, f);
        }
    }
    return lowest;
}
/** Percentage points the journal's recent turns are assumed to have used. */
function recentCost(j, now = Date.now()) {
    return (0, state_1.recentUsage)(j, exports.QUOTA_WINDOW_MS, now).reduce((sum, u) => sum +
        (typeof u.cost === 'number' && Number.isFinite(u.cost) && u.cost >= 0
            ? u.cost
            : exports.UNKNOWN_TURN_COST), 0);
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
        // Only a probe that exited 0 on its own counts; a killed one's output
        // may be partial.
        const clean = outcome.exitCode === 0 &&
            outcome.signal === null &&
            !outcome.killedByDeadline &&
            !outcome.cancelled;
        const remaining = clean ? lowestRemaining(outcome.stdout) : undefined;
        if (remaining === undefined) {
            throw new errors_1.AgyError('AGY_QUOTA_UNKNOWN', clean
                ? 'agy -p /usage printed no remaining quota this version understands'
                : outcome.killedByDeadline || outcome.cancelled
                    ? 'agy -p /usage did not finish'
                    : `agy -p /usage exited ${String(outcome.exitCode ?? outcome.signal)}`);
        }
        const percent = remaining * 100 - recentCost(journal, (deps.now ?? Date.now)());
        if (percent < deps.minQuotaPercent) {
            throw new errors_1.AgyError('AGY_QUOTA_LOW', `about ${Math.max(0, Math.floor(percent))}% of the AI Pro quota is left; the grant needs ${deps.minQuotaPercent}%`);
        }
    };
}
