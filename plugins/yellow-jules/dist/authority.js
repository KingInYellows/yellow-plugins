"use strict";
/**
 * Grants (R30) and the pure runtime authority check (R31). A grant is a
 * bounded, expiring permission written only by the TTY-confirmed `authorize`
 * path into `state/grants.json`; the runtime can only narrow it (revoke,
 * charge counters, release slots), never widen it.
 *
 * `evaluateAuthority` is pure. The callers in mutations.ts run it, together
 * with `assertControllerAuthority`, the R36 lookup, `chargeGrant` and the
 * reservation write, as one critical section under the journal lock (R31).
 *
 * Counter rules (R31): reserved and unknown-outcome operations count against
 * the limits; `totalTasks` and corrective rounds never decrement;
 * `releaseGrant` frees only an active-session slot and is callable from the
 * reconcile, abandon, terminal-observation and clean-rejection paths, never
 * from a path whose outcome is unknown.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.GRANT_CEILINGS = exports.GRANT_DEFAULTS = void 0;
exports.emptyGrants = emptyGrants;
exports.emptyUsage = emptyUsage;
exports.loadGrants = loadGrants;
exports.writeGrants = writeGrants;
exports.isExpired = isExpired;
exports.evaluateAuthority = evaluateAuthority;
exports.grantHasUnreconciledDeviation = grantHasUnreconciledDeviation;
exports.chargeGrant = chargeGrant;
exports.releaseGrant = releaseGrant;
exports.updateGrant = updateGrant;
exports.requireGrant = requireGrant;
exports.listGrants = listGrants;
exports.revokeGrant = revokeGrant;
const crypto = __importStar(require("node:crypto"));
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const config_js_1 = require("./config.js");
const errors_js_1 = require("./errors.js");
const redact_js_1 = require("./redact.js");
const state_js_1 = require("./state.js");
const validate_js_1 = require("./validate.js");
/** R30 trial defaults. */
exports.GRANT_DEFAULTS = Object.freeze({
    maxActiveSessions: 1,
    maxTotalTasks: 3,
    maxCorrectiveRounds: 2,
    ttlMinutes: 120,
});
/** Documented ceilings (contract "Autonomy boundaries"); `authorize` refuses anything above them. */
exports.GRANT_CEILINGS = Object.freeze({
    maxActiveSessions: 3,
    maxTotalTasks: 10,
    maxCorrectiveRounds: 3,
    ttlMinutes: 24 * 60,
});
function emptyGrants() {
    return {
        version: 1,
        grants: Object.create(null),
    };
}
function emptyUsage() {
    return {
        activeSessionRefs: [],
        totalTasks: 0,
        correctiveRounds: Object.create(null),
    };
}
// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
const OPERATIONS = new Set(['create', 'reply', 'approve', 'collect']);
const GRANT_ID_RE = /^jg-[0-9a-f]{32}$/;
function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isPositiveInt(value) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}
function isNonNegativeInt(value) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
function isIsoTime(value) {
    return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}
function isStringArray(value) {
    return Array.isArray(value) && value.every((v) => typeof v === 'string');
}
function parseUsage(value) {
    if (!isPlainObject(value))
        return undefined;
    const { activeSessionRefs, totalTasks, correctiveRounds } = value;
    if (!isStringArray(activeSessionRefs) || !isNonNegativeInt(totalTasks))
        return undefined;
    if (!isPlainObject(correctiveRounds))
        return undefined;
    const rounds = Object.create(null);
    for (const [taskRef, n] of Object.entries(correctiveRounds)) {
        if (!isNonNegativeInt(n))
            return undefined;
        rounds[taskRef] = n;
    }
    return { activeSessionRefs, totalTasks, correctiveRounds: rounds };
}
function parseGrant(key, value) {
    if (!isPlainObject(value))
        return undefined;
    const v = value;
    if (v['grantId'] !== key || !GRANT_ID_RE.test(key))
        return undefined;
    const epochRef = v['epochRef'];
    if (!isPlainObject(epochRef) ||
        typeof epochRef['controllerId'] !== 'string' ||
        !isPositiveInt(epochRef['epoch']))
        return undefined;
    const usage = parseUsage(v['usage']);
    if (usage === undefined)
        return undefined;
    const operations = v['operations'];
    const taskRefs = v['taskRefs'];
    if (typeof v['repository'] !== 'string' ||
        typeof v['sourceResource'] !== 'string' ||
        typeof v['branchPattern'] !== 'string' ||
        !isStringArray(taskRefs) ||
        !isStringArray(operations) ||
        operations.length === 0 ||
        !operations.every((op) => OPERATIONS.has(op)) ||
        !isPositiveInt(v['maxActiveSessions']) ||
        !isPositiveInt(v['maxTotalTasks']) ||
        !isNonNegativeInt(v['maxCorrectiveRounds']) ||
        !isIsoTime(v['expiresAt']) ||
        !isIsoTime(v['createdAt']) ||
        typeof v['owner'] !== 'string' ||
        typeof v['controllerId'] !== 'string' ||
        (v['revokedAt'] !== undefined && !isIsoTime(v['revokedAt'])))
        return undefined;
    return {
        grantId: key,
        repository: v['repository'],
        sourceResource: v['sourceResource'],
        branchPattern: v['branchPattern'],
        taskRefs,
        operations: operations,
        maxActiveSessions: v['maxActiveSessions'],
        maxTotalTasks: v['maxTotalTasks'],
        maxCorrectiveRounds: v['maxCorrectiveRounds'],
        expiresAt: v['expiresAt'],
        createdAt: v['createdAt'],
        owner: v['owner'],
        controllerId: v['controllerId'],
        epochRef: {
            controllerId: epochRef['controllerId'],
            epoch: epochRef['epoch'],
        },
        ...(typeof v['revokedAt'] === 'string'
            ? { revokedAt: v['revokedAt'] }
            : {}),
        usage,
    };
}
function parseGrants(raw) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return undefined;
    }
    if (!isPlainObject(parsed) || parsed['version'] !== 1)
        return undefined;
    const grantsValue = parsed['grants'];
    if (!isPlainObject(grantsValue))
        return undefined;
    const grants = Object.create(null);
    for (const [key, record] of Object.entries(grantsValue)) {
        const grant = parseGrant(key, record);
        if (grant === undefined)
            return undefined;
        grants[key] = grant;
    }
    return { version: 1, grants };
}
/**
 * Reads `state/grants.json`. A missing file is no grants; anything that does
 * not parse into the expected shape throws `JULES_JOURNAL_CORRUPT` and leaves
 * the file untouched — a corrupt grants file is never treated as empty.
 */
function loadGrants(dataDir) {
    (0, config_js_1.ensureOwnerOnlyDir)((0, config_js_1.resolveStateDir)(dataDir));
    const file = (0, config_js_1.resolveGrantsPath)(dataDir);
    (0, config_js_1.assertOwnerOnlyFile)(file);
    let raw;
    try {
        raw = fs.readFileSync(file, 'utf8');
    }
    catch (err) {
        if (err.code === 'ENOENT')
            return emptyGrants();
        throw err;
    }
    const grants = parseGrants(raw);
    if (grants === undefined) {
        return (0, errors_js_1.throwAppError)('JULES_JOURNAL_CORRUPT', `${file} does not parse as a yellow-jules grants file; it was left untouched`, {
            recoveryAction: 'Inspect state/grants.json by hand; writes are blocked until it parses. Create a new grant with authorize once it is repaired or removed.',
        });
    }
    return grants;
}
/** Atomic whole-file rewrite (temp, fsync, rename, 0600). Callers hold the journal lock. */
function writeGrants(dataDir, grants) {
    (0, redact_js_1.assertNoSecretShapedValues)(grants);
    const stateDir = (0, config_js_1.resolveStateDir)(dataDir);
    (0, config_js_1.ensureOwnerOnlyDir)(stateDir);
    const file = (0, config_js_1.resolveGrantsPath)(dataDir);
    (0, config_js_1.assertOwnerOnlyFile)(file);
    const tmp = path.join(stateDir, `grants.json.tmp-${process.pid}-${crypto.randomUUID()}`);
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try {
        fs.writeFileSync(fd, `${JSON.stringify(grants, null, 2)}\n`, 'utf8');
        fs.fsyncSync(fd);
    }
    finally {
        fs.closeSync(fd);
    }
    try {
        fs.chmodSync(tmp, 0o600);
        fs.renameSync(tmp, file);
    }
    catch (err) {
        fs.rmSync(tmp, { force: true });
        throw err;
    }
    fs.chmodSync(file, 0o600);
}
function deny(code, reason, message) {
    return { ok: false, code, reason, message };
}
function isExpired(grant, now) {
    return now.getTime() >= Date.parse(grant.expiresAt);
}
/**
 * Denial order (each step is checked only if the previous passed):
 * revoked, expired, repository/source, branch, task ref, operation, limits,
 * then an unreconciled policy deviation under the grant (R13).
 */
function evaluateAuthority(grant, request, now, context) {
    if (grant.revokedAt !== undefined) {
        return deny('JULES_AUTHORITY_DENIED', 'revoked', `grant ${grant.grantId} was revoked`);
    }
    if (isExpired(grant, now)) {
        return deny('JULES_GRANT_EXPIRED', 'expired', `grant ${grant.grantId} expired at ${grant.expiresAt}`);
    }
    if (request.repository !== grant.repository ||
        request.sourceResource !== grant.sourceResource) {
        return deny('JULES_AUTHORITY_DENIED', 'repository-mismatch', `grant ${grant.grantId} does not cover ${request.repository}`);
    }
    if (!(0, validate_js_1.branchMatchesPattern)(grant.branchPattern, request.branch)) {
        return deny('JULES_AUTHORITY_DENIED', 'branch-outside-pattern', `grant ${grant.grantId} does not cover branch ${request.branch}`);
    }
    if (request.taskRef === undefined ||
        !grant.taskRefs.includes(request.taskRef)) {
        return deny('JULES_AUTHORITY_DENIED', 'task-ref-outside-grant', `grant ${grant.grantId} does not cover task ref ${request.taskRef ?? '(none)'}`);
    }
    if (!grant.operations.includes(request.operation)) {
        return deny('JULES_AUTHORITY_DENIED', 'operation-not-permitted', `grant ${grant.grantId} does not permit ${request.operation}`);
    }
    const limit = limitDenial(grant, request);
    if (limit !== undefined)
        return limit;
    if (context.unreconciledDeviation) {
        return deny('JULES_POLICY_DEVIATION', 'unreconciled-policy-deviation', `a session under grant ${grant.grantId} has an unreconciled policy deviation`);
    }
    return { ok: true };
}
function limitDenial(grant, request) {
    const usage = grant.usage;
    const rounds = request.taskRef !== undefined
        ? (usage.correctiveRounds[request.taskRef] ?? 0)
        : 0;
    if (request.operation === 'create') {
        if (usage.activeSessionRefs.length >= grant.maxActiveSessions) {
            return deny('JULES_GRANT_EXHAUSTED', 'active-sessions-exhausted', `grant ${grant.grantId} allows ${grant.maxActiveSessions} active session(s)`);
        }
        if (request.correction !== true &&
            usage.totalTasks >= grant.maxTotalTasks) {
            return deny('JULES_GRANT_EXHAUSTED', 'total-tasks-exhausted', `grant ${grant.grantId} allows ${grant.maxTotalTasks} task(s) in total`);
        }
    }
    if (request.correction === true &&
        (request.operation === 'create' || request.operation === 'reply') &&
        rounds >= grant.maxCorrectiveRounds) {
        return deny('JULES_GRANT_EXHAUSTED', 'corrective-rounds-exhausted', `grant ${grant.grantId} allows ${grant.maxCorrectiveRounds} corrective round(s) per task`);
    }
    return undefined;
}
/** R13: any record under this grant that carries an unreconciled policy deviation. */
function grantHasUnreconciledDeviation(journal, grantId) {
    return Object.values(journal.operations).some((r) => r.grantId === grantId && (0, state_js_1.hasUnreconciledDeviation)(r));
}
function withRounds(usage, taskRef) {
    const rounds = Object.create(null);
    for (const [key, n] of Object.entries(usage.correctiveRounds))
        rounds[key] = n;
    rounds[taskRef] = (rounds[taskRef] ?? 0) + 1;
    return rounds;
}
/**
 * A `create` takes an active-session slot (held until the session is observed
 * terminal, or a reconcile/abandon/clean-rejection releases it) and, unless it
 * is a repair, one task; a repair `create` and a corrective `reply` spend one
 * corrective round on their task ref instead.
 */
function chargeGrant(grant, charge) {
    let usage = grant.usage;
    if (charge.operation === 'create') {
        usage = {
            ...usage,
            activeSessionRefs: usage.activeSessionRefs.includes(charge.localRequestId)
                ? usage.activeSessionRefs
                : [...usage.activeSessionRefs, charge.localRequestId],
            ...(charge.correction === true
                ? {}
                : { totalTasks: usage.totalTasks + 1 }),
        };
    }
    if (charge.correction === true && charge.taskRef !== undefined) {
        usage = {
            ...usage,
            correctiveRounds: withRounds(usage, charge.taskRef),
        };
    }
    return { ...grant, usage };
}
/** Frees an active-session slot only; tasks and corrective rounds are spent for good. */
function releaseGrant(grant, localRequestId, _reason) {
    if (!grant.usage.activeSessionRefs.includes(localRequestId))
        return grant;
    return {
        ...grant,
        usage: {
            ...grant.usage,
            activeSessionRefs: grant.usage.activeSessionRefs.filter((ref) => ref !== localRequestId),
        },
    };
}
/** Applies `fn` to one stored grant and returns the file; callers write it under the lock. */
function updateGrant(file, grantId, fn) {
    const grant = file.grants[grantId];
    if (grant === undefined) {
        return (0, errors_js_1.throwAppError)('JULES_NOT_FOUND', `no grant ${grantId}`);
    }
    const grants = Object.create(null);
    for (const [id, g] of Object.entries(file.grants))
        grants[id] = g;
    grants[grantId] = fn(grant);
    return { version: 1, grants };
}
function requireGrant(file, grantId) {
    (0, validate_js_1.validateGrantId)(grantId);
    const grant = file.grants[grantId];
    if (grant === undefined) {
        return (0, errors_js_1.throwAppError)('JULES_AUTHORITY_DENIED', `no grant ${grantId} exists on this host`, {
            recoveryAction: 'List grants with authorize --list, or create one with authorize in a terminal.',
        });
    }
    return grant;
}
function listGrants(dataDir, now) {
    const file = loadGrants(dataDir);
    return Object.values(file.grants).map((grant) => ({
        ...grant,
        expired: isExpired(grant, now),
        revoked: grant.revokedAt !== undefined,
    }));
}
async function revokeGrant(dataDir, grantId, now) {
    (0, validate_js_1.validateGrantId)(grantId);
    return (0, state_js_1.withJournalLock)(dataDir, async () => {
        const file = loadGrants(dataDir);
        const grant = file.grants[grantId];
        if (grant === undefined) {
            return (0, errors_js_1.throwAppError)('JULES_NOT_FOUND', `no grant ${grantId}`, {
                recoveryAction: 'List grants with authorize --list.',
            });
        }
        if (grant.revokedAt !== undefined) {
            return { grantId, revokedAt: grant.revokedAt };
        }
        const revokedAt = now.toISOString();
        writeGrants(dataDir, updateGrant(file, grantId, (g) => ({ ...g, revokedAt })));
        return { grantId, revokedAt };
    });
}
