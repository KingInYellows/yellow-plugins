"use strict";
/**
 * Grants (contract-v0 "Output envelope … grants"): bounded, expiring
 * permissions that only `authorize` writes, after the owner types a code on
 * the terminal. They live in the journal, so a check and its charge happen
 * in the same locked write as the reservation they cover. The runtime only
 * narrows a grant (charge, revoke); it never widens one.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GRANT_ID_RE = exports.GRANT_CEILINGS = exports.GRANT_DEFAULTS = exports.GRANT_OPS = void 0;
exports.mintGrantId = mintGrantId;
exports.validateGrantId = validateGrantId;
exports.validateBranchPattern = validateBranchPattern;
exports.branchMatches = branchMatches;
exports.validateOperations = validateOperations;
exports.boundedInt = boundedInt;
exports.buildGrant = buildGrant;
exports.isGrant = isGrant;
exports.grants = grants;
exports.requireGrant = requireGrant;
exports.putGrant = putGrant;
exports.grantExpired = grantExpired;
exports.grantOpFor = grantOpFor;
exports.authorizeRequest = authorizeRequest;
exports.listGrants = listGrants;
exports.revokeGrant = revokeGrant;
exports.grantSummary = grantSummary;
const node_crypto_1 = require("node:crypto");
const errors_1 = require("./errors");
const profiles_1 = require("./profiles");
const worktree_1 = require("./worktree");
exports.GRANT_OPS = [
    'create',
    'approve',
    'reply',
    'collect',
];
exports.GRANT_DEFAULTS = Object.freeze({
    maxTotalTasks: 3,
    maxCorrectiveRounds: 2,
    ttlMinutes: 120,
    minQuotaPercent: 10,
});
exports.GRANT_CEILINGS = Object.freeze({
    maxTotalTasks: 10,
    maxCorrectiveRounds: 3,
    ttlMinutes: 24 * 60,
});
exports.GRANT_ID_RE = /^ag-[0-9a-f]{32}$/;
const BRANCH_PATTERN_MAX = 200;
function mintGrantId() {
    return `ag-${(0, node_crypto_1.randomBytes)(16).toString('hex')}`;
}
function validateGrantId(value) {
    if (!exports.GRANT_ID_RE.test(value)) {
        throw new errors_1.AgyError('AGY_INVALID_INPUT', `invalid grant id ${JSON.stringify(value)}`);
    }
    return value;
}
/**
 * An exact branch name, or a branch-name prefix with one trailing `*`. The
 * glob is never mid-name, so matching is a prefix test.
 */
function validateBranchPattern(input) {
    if (input.length === 0 || input.length > BRANCH_PATTERN_MAX) {
        throw new errors_1.AgyError('AGY_INVALID_INPUT', `branch pattern must be 1-${BRANCH_PATTERN_MAX} characters`);
    }
    const star = input.indexOf('*');
    if (star === -1)
        return (0, worktree_1.validateBranchName)(input);
    if (star !== input.length - 1) {
        throw new errors_1.AgyError('AGY_INVALID_INPUT', 'a branch pattern allows one trailing "*" only');
    }
    const prefix = input.slice(0, -1);
    if (prefix.length === 0) {
        throw new errors_1.AgyError('AGY_INVALID_INPUT', 'the branch pattern "*" matches every branch and is refused');
    }
    // `agy/` is a fine prefix; check it as the branch it starts.
    (0, worktree_1.validateBranchName)(prefix.endsWith('/') ? `${prefix}x` : prefix);
    return input;
}
function branchMatches(pattern, branch) {
    return pattern.endsWith('*')
        ? branch.startsWith(pattern.slice(0, -1))
        : pattern === branch;
}
function validateOperations(input) {
    const out = [];
    for (const raw of input.split(',')) {
        const op = exports.GRANT_OPS.find((o) => o === raw.trim());
        if (op === undefined) {
            throw new errors_1.AgyError('AGY_INVALID_INPUT', `operations must be a comma-separated subset of ${exports.GRANT_OPS.join(', ')}`);
        }
        if (out.includes(op)) {
            throw new errors_1.AgyError('AGY_INVALID_INPUT', `operation ${op} is listed more than once`);
        }
        out.push(op);
    }
    return out;
}
function boundedInt(value, fallback, min, max, label) {
    const n = value ?? fallback;
    if (!Number.isInteger(n) || n < min || n > max) {
        throw new errors_1.AgyError('AGY_INVALID_INPUT', `${label} must be an integer from ${min} to ${max}`);
    }
    return n;
}
/** Validates every field; throws before anything is shown or written. */
function buildGrant(input, now) {
    const ttl = boundedInt(input.ttlMinutes, exports.GRANT_DEFAULTS.ttlMinutes, 1, exports.GRANT_CEILINGS.ttlMinutes, 'ttl minutes');
    return {
        grantId: mintGrantId(),
        repo: input.repo,
        branchPattern: validateBranchPattern(input.branchPattern),
        operations: validateOperations(input.operations),
        allowCommands: (input.allowCommands ?? []).map(profiles_1.validateAllowCommand),
        minQuotaPercent: boundedInt(input.minQuotaPercent, exports.GRANT_DEFAULTS.minQuotaPercent, 0, 100, 'min quota percent'),
        maxTotalTasks: boundedInt(input.maxTotalTasks, exports.GRANT_DEFAULTS.maxTotalTasks, 1, exports.GRANT_CEILINGS.maxTotalTasks, 'max total tasks'),
        maxCorrectiveRounds: boundedInt(input.maxCorrectiveRounds, exports.GRANT_DEFAULTS.maxCorrectiveRounds, 0, exports.GRANT_CEILINGS.maxCorrectiveRounds, 'max corrective rounds'),
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + ttl * 60_000).toISOString(),
        totalTasks: 0,
    };
}
function isIso(v) {
    return typeof v === 'string' && !Number.isNaN(Date.parse(v));
}
function isCount(v) {
    return Number.isInteger(v) && v >= 0;
}
/** A stored grant's shape check; anything else makes the journal unreadable. */
function isGrant(key, v) {
    if (v === null || typeof v !== 'object' || Array.isArray(v))
        return false;
    const g = v;
    const ops = g['operations'];
    const cmds = g['allowCommands'];
    return (g['grantId'] === key &&
        exports.GRANT_ID_RE.test(key) &&
        typeof g['repo'] === 'string' &&
        typeof g['branchPattern'] === 'string' &&
        Array.isArray(ops) &&
        ops.length > 0 &&
        ops.every((o) => exports.GRANT_OPS.includes(o)) &&
        Array.isArray(cmds) &&
        cmds.every((c) => typeof c === 'string') &&
        isCount(g['minQuotaPercent']) &&
        g['minQuotaPercent'] <= 100 &&
        isCount(g['maxTotalTasks']) &&
        isCount(g['maxCorrectiveRounds']) &&
        isCount(g['totalTasks']) &&
        isIso(g['createdAt']) &&
        isIso(g['expiresAt']) &&
        (g['revokedAt'] === undefined || isIso(g['revokedAt'])));
}
function own(rec, key) {
    return Object.prototype.hasOwnProperty.call(rec, key) ? rec[key] : undefined;
}
function grants(j) {
    return j.grants ?? {};
}
function requireGrant(j, grantId) {
    const grant = own(grants(j), validateGrantId(grantId));
    if (grant === undefined) {
        throw new errors_1.AgyError('AGY_AUTHORITY_DENIED', `no grant ${grantId}`);
    }
    return grant;
}
function putGrant(j, grant) {
    return { ...j, grants: { ...grants(j), [grant.grantId]: grant } };
}
function grantExpired(grant, now) {
    return now.getTime() >= Date.parse(grant.expiresAt);
}
/** Which grant operation a lifecycle operation needs; abandon needs none. */
function grantOpFor(op) {
    switch (op) {
        case 'delegate':
            return 'create';
        case 'abandon':
            return undefined;
        default:
            return op;
    }
}
/**
 * Checks `request` against `grantId` and returns the journal with the
 * grant charged. Order: missing, revoked, expired, repo, branch, operation,
 * limits. Runs inside the reservation's locked write.
 */
function authorizeRequest(j, grantId, request, now) {
    const grant = requireGrant(j, grantId);
    if (grant.revokedAt !== undefined) {
        throw new errors_1.AgyError('AGY_AUTHORITY_DENIED', `grant ${grantId} was revoked`);
    }
    if (grantExpired(grant, now)) {
        throw new errors_1.AgyError('AGY_GRANT_EXPIRED', `grant ${grantId} expired at ${grant.expiresAt}`);
    }
    if (request.repo !== grant.repo) {
        throw new errors_1.AgyError('AGY_AUTHORITY_DENIED', `grant ${grantId} does not cover ${request.repo}`);
    }
    if (!branchMatches(grant.branchPattern, request.branch)) {
        throw new errors_1.AgyError('AGY_AUTHORITY_DENIED', `grant ${grantId} does not cover branch ${request.branch}`);
    }
    if (request.task !== undefined && request.task.grantId !== grantId) {
        throw new errors_1.AgyError('AGY_AUTHORITY_DENIED', `task ${request.task.localId} was created under another grant`);
    }
    const op = grantOpFor(request.op);
    if (op !== undefined && !grant.operations.includes(op)) {
        throw new errors_1.AgyError('AGY_AUTHORITY_DENIED', `grant ${grantId} does not permit ${op}`);
    }
    if (op === 'create') {
        if (grant.totalTasks >= grant.maxTotalTasks) {
            throw new errors_1.AgyError('AGY_GRANT_EXHAUSTED', `grant ${grantId} allows ${grant.maxTotalTasks} task(s) in total`);
        }
        return putGrant(j, { ...grant, totalTasks: grant.totalTasks + 1 });
    }
    if (request.correction === true &&
        (request.task?.correctiveRounds ?? 0) >= grant.maxCorrectiveRounds) {
        throw new errors_1.AgyError('AGY_GRANT_EXHAUSTED', `grant ${grantId} allows ${grant.maxCorrectiveRounds} corrective round(s) per task`);
    }
    return j;
}
function listGrants(j, now) {
    return Object.values(grants(j)).map((g) => ({
        ...g,
        expired: grantExpired(g, now),
        revoked: g.revokedAt !== undefined,
    }));
}
/** Revoking only narrows authority, so it needs no terminal. */
function revokeGrant(j, grantId, now) {
    const grant = requireGrant(j, grantId);
    if (grant.revokedAt !== undefined)
        return j;
    return putGrant(j, { ...grant, revokedAt: now.toISOString() });
}
/** The owner-facing summary printed on the terminal before confirming. */
function grantSummary(grant) {
    return [
        'yellow-agy: create a grant',
        `  repo:               ${grant.repo}`,
        `  branches:           ${grant.branchPattern}`,
        `  operations:         ${grant.operations.join(', ')}`,
        `  allowed commands:   ${grant.allowCommands.length === 0 ? '(none)' : grant.allowCommands.join('; ')}`,
        `  min quota percent:  ${grant.minQuotaPercent}`,
        `  max tasks:          ${grant.maxTotalTasks}`,
        `  corrective rounds:  ${grant.maxCorrectiveRounds} per task`,
        `  expires:            ${grant.expiresAt}`,
    ].join('\n');
}
