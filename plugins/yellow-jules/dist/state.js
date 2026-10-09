"use strict";
/**
 * Provider-local journal at <dataDir>/state/journal.json (R35-R38).
 *
 * Diverges from yellow-cursor's state.ts on purpose:
 * - a corrupt or unparseable journal throws JULES_JOURNAL_CORRUPT and is
 *   never renamed, replaced, or treated as empty (R37);
 * - a lock whose holder is dead on this host, or older than `staleMs`, fails
 *   loud with JULES_STALE_LOCK and is never taken over (R38).
 *
 * Every write is read-modify-write under the lock, atomic (temp file, fsync,
 * rename), 0600, and passes assertNoSecretShapedValues first. Keyed by
 * localRequestId; maps are built with Object.create(null) so caller-supplied
 * keys cannot reach the prototype.
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
exports.DEFAULT_LOCK_CONFIG = exports.UNRESOLVED_STATUSES = exports.TERMINAL_STATUSES = void 0;
exports.digestText = digestText;
exports.messageDigest = messageDigest;
exports.emptyJournal = emptyJournal;
exports.readJournal = readJournal;
exports.writeJournal = writeJournal;
exports.withJournalLock = withJournalLock;
exports.updateJournal = updateJournal;
exports.ownsSession = ownsSession;
exports.findBySessionResource = findBySessionResource;
exports.findByLocalId = findByLocalId;
exports.findUnresolvedOperations = findUnresolvedOperations;
exports.applyReservation = applyReservation;
exports.reserveOperation = reserveOperation;
exports.applyRetention = applyRetention;
exports.markOperation = markOperation;
exports.ensureObservedRecord = ensureObservedRecord;
exports.upsertReadState = upsertReadState;
exports.upsertArtifactResumeToken = upsertArtifactResumeToken;
exports.recordArtifacts = recordArtifacts;
exports.recordDeviation = recordDeviation;
exports.hasUnreconciledDeviation = hasUnreconciledDeviation;
exports.updateSupervision = updateSupervision;
exports.claimOwnEchoes = claimOwnEchoes;
exports.blocksRepairLaunch = blocksRepairLaunch;
exports.isOwningCreate = isOwningCreate;
const crypto = __importStar(require("node:crypto"));
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const activity_walk_js_1 = require("./activity-walk.js");
const config_js_1 = require("./config.js");
const errors_js_1 = require("./errors.js");
const redact_js_1 = require("./redact.js");
const shape_js_1 = require("./shape.js");
const validate_js_1 = require("./validate.js");
function digestText(text) {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}
/** Digest of a message for reply matching: the vendor may trim edge whitespace, so both sides are trimmed. */
function messageDigest(text) {
    return digestText(text.trim());
}
function emptyJournal() {
    return {
        version: 1,
        archiveVisibilityConfirmed: false,
        operations: Object.create(null),
    };
}
const KINDS = new Set([
    'create',
    'reply',
    'approve',
    'collect',
    'observe',
]);
const ORIGINS = new Set(['yellow', 'external']);
const STATUSES = new Set([
    'reserved',
    'accepted',
    'unknown-outcome',
    'reconciled',
    'rejected',
    'failed',
    'observed',
]);
/** Settled records drop their dedup ring and resume tokens (retention rule). */
exports.TERMINAL_STATUSES = new Set([
    'reconciled',
    'rejected',
    'failed',
]);
/** R36: only these block a new create for the same repository and branch. */
exports.UNRESOLVED_STATUSES = new Set([
    'reserved',
    'unknown-outcome',
]);
const OPTIONAL_STRING_FIELDS = [
    'sessionResource',
    'repository',
    'requestedBranch',
    'observedHead',
    'sourceResource',
    'taskRef',
    'grantId',
    'promptDigest',
    'echoActivityId',
    'observedPlanId',
    'vendorState',
    'condition',
    'lastActivityCreateTime',
    'lastActivityId',
    'lastCompleteWalkAt',
    'resumePageToken',
    'artifactResumePageToken',
    'abandonedAt',
    'abandonReason',
    'invalidatedBy',
    'dispatchedAt',
];
const ARTIFACT_KINDS = new Set(['patch', 'pr-ref', 'generated-file']);
const ARTIFACT_VERIFICATIONS = new Set([
    'unverified',
    'passed',
    'failed',
    'unavailable',
    'errored',
]);
/** Absent is fine; present must be a string. */
function hasOptionalStrings(value, fields) {
    return fields.every((f) => value[f] === undefined || typeof value[f] === 'string');
}
function isValidArtifact(value) {
    if (!(0, shape_js_1.isPlainObject)(value))
        return false;
    return (ARTIFACT_KINDS.has(value['kind']) &&
        typeof value['sessionResource'] === 'string' &&
        hasOptionalStrings(value, [
            'path',
            'sha256',
            'baseCommit',
            'prUrl',
            'vendorPath',
        ]) &&
        typeof value['secretShapedContent'] === 'boolean' &&
        typeof value['collectedAt'] === 'string' &&
        ARTIFACT_VERIFICATIONS.has(value['verification']));
}
function isValidDeviation(value) {
    if (!(0, shape_js_1.isPlainObject)(value))
        return false;
    return (value['kind'] === 'policy-deviation' &&
        typeof value['reason'] === 'string' &&
        hasOptionalStrings(value, ['prUrl']) &&
        typeof value['observedAt'] === 'string' &&
        typeof value['reconciled'] === 'boolean');
}
function isValidPlanStep(value) {
    if (!(0, shape_js_1.isPlainObject)(value))
        return false;
    return (typeof value['id'] === 'string' &&
        typeof value['title'] === 'string' &&
        hasOptionalStrings(value, ['description']) &&
        (0, shape_js_1.isNonNegativeInt)(value['index']));
}
function isValidPendingPlan(value) {
    if (!(0, shape_js_1.isPlainObject)(value))
        return false;
    return (typeof value['planId'] === 'string' &&
        typeof value['activityCreateTime'] === 'string' &&
        typeof value['activityId'] === 'string' &&
        Array.isArray(value['steps']) &&
        value['steps'].every(isValidPlanStep));
}
const RECONCILE_OUTCOMES = new Set([
    'bound',
    'released',
    'ambiguous-reconcile',
    'policy-deviation',
    'unknown-outcome',
    'not-reached',
]);
const DECISIONS = new Set([
    'no-change',
    'check-failed',
    'pass-aborted',
    'needs-plan-review',
    'needs-answer',
    'needs-verification',
    'escalate',
    'paused',
]);
function isValidLastReconcile(value) {
    if (!(0, shape_js_1.isPlainObject)(value))
        return false;
    return (RECONCILE_OUTCOMES.has(value['outcome']) &&
        hasOptionalStrings(value, ['reason']) &&
        typeof value['observedAt'] === 'string');
}
function isValidSupervision(value) {
    if (!(0, shape_js_1.isPlainObject)(value))
        return false;
    const { paused, backoff, lastDecision } = value;
    if (paused !== undefined &&
        !((0, shape_js_1.isPlainObject)(paused) &&
            typeof paused['reason'] === 'string' &&
            typeof paused['observedAt'] === 'string' &&
            hasOptionalStrings(paused, ['activityId'])))
        return false;
    if (backoff !== undefined &&
        !((0, shape_js_1.isPlainObject)(backoff) &&
            (0, shape_js_1.isNonNegativeInt)(backoff['failures']) &&
            typeof backoff['nextCheckAt'] === 'string'))
        return false;
    const outsideSeen = value['outsideSeen'];
    if (outsideSeen !== undefined &&
        !((0, shape_js_1.isPlainObject)(outsideSeen) &&
            typeof outsideSeen['activityId'] === 'string' &&
            typeof outsideSeen['observedAt'] === 'string'))
        return false;
    const evaluatedPlan = value['evaluatedPlan'];
    if (evaluatedPlan !== undefined &&
        !((0, shape_js_1.isPlainObject)(evaluatedPlan) &&
            typeof evaluatedPlan['planId'] === 'string' &&
            typeof evaluatedPlan['evaluatedAt'] === 'string'))
        return false;
    return (lastDecision === undefined ||
        ((0, shape_js_1.isPlainObject)(lastDecision) &&
            DECISIONS.has(lastDecision['decision']) &&
            typeof lastDecision['decidedAt'] === 'string'));
}
function isValidRecord(key, value) {
    if (!(0, shape_js_1.isPlainObject)(value))
        return false;
    if (value['localRequestId'] !== key)
        return false;
    if (typeof value['localId'] !== 'string' ||
        !/^jl-[0-9a-f]{32}$/.test(value['localId'])) {
        return false;
    }
    if (!KINDS.has(value['kind']))
        return false;
    if (!ORIGINS.has(value['origin']))
        return false;
    if (!STATUSES.has(value['status']))
        return false;
    for (const field of OPTIONAL_STRING_FIELDS) {
        if (value[field] !== undefined && typeof value[field] !== 'string')
            return false;
    }
    // Stored tokens go back to the vendor as query parameters: re-checked on load.
    for (const field of ['resumePageToken', 'artifactResumePageToken']) {
        if (value[field] !== undefined && !(0, validate_js_1.isValidPageToken)(value[field]))
            return false;
    }
    for (const field of ['autoPrRequested', 'correction']) {
        if (value[field] !== undefined && typeof value[field] !== 'boolean') {
            return false;
        }
    }
    if (!(0, shape_js_1.isStringArray)(value['recentActivityIds']))
        return false;
    if (!(0, shape_js_1.isNonNegativeInt)(value['activityCount']))
        return false;
    if (!(0, shape_js_1.isNonNegativeInt)(value['resumeRestartCount']))
        return false;
    if (value['artifactResumeRestartCount'] !== undefined &&
        !(0, shape_js_1.isNonNegativeInt)(value['artifactResumeRestartCount']))
        return false;
    if (!Array.isArray(value['artifacts']) ||
        !value['artifacts'].every(isValidArtifact))
        return false;
    if (!Array.isArray(value['deviations']) ||
        !value['deviations'].every(isValidDeviation))
        return false;
    if (value['pendingPlan'] !== undefined &&
        !isValidPendingPlan(value['pendingPlan']))
        return false;
    if (value['resumeApproval'] !== undefined &&
        !((0, shape_js_1.isPlainObject)(value['resumeApproval']) &&
            typeof value['resumeApproval']['createTime'] === 'string' &&
            typeof value['resumeApproval']['activityId'] === 'string'))
        return false;
    if (value['lastReconcile'] !== undefined &&
        !isValidLastReconcile(value['lastReconcile']))
        return false;
    if (value['supervision'] !== undefined &&
        !isValidSupervision(value['supervision']))
        return false;
    return (typeof value['createdAt'] === 'string' &&
        typeof value['updatedAt'] === 'string');
}
function parseJournal(raw) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return undefined;
    }
    if (!(0, shape_js_1.isPlainObject)(parsed))
        return undefined;
    if (parsed['version'] !== 1)
        return undefined;
    if (typeof parsed['archiveVisibilityConfirmed'] !== 'boolean')
        return undefined;
    const ops = parsed['operations'];
    if (!(0, shape_js_1.isPlainObject)(ops))
        return undefined;
    const operations = Object.create(null);
    for (const [key, record] of Object.entries(ops)) {
        if (!isValidRecord(key, record))
            return undefined;
        operations[key] = record;
    }
    return {
        version: 1,
        archiveVisibilityConfirmed: parsed['archiveVisibilityConfirmed'],
        operations,
    };
}
/**
 * Reads the journal. A missing file is an empty journal; anything that does
 * not parse into the expected shape throws JULES_JOURNAL_CORRUPT and leaves
 * the file byte-identical — read commands report it instead of degrading to
 * an empty id set (R37).
 */
async function readJournal(dataDir) {
    (0, config_js_1.ensureOwnerOnlyDir)((0, config_js_1.resolveStateDir)(dataDir));
    const journalPath = (0, config_js_1.resolveJournalPath)(dataDir);
    (0, config_js_1.assertOwnerOnlyFile)(journalPath);
    let raw;
    try {
        raw = await fs.promises.readFile(journalPath, 'utf8');
    }
    catch (err) {
        if (err.code === 'ENOENT')
            return emptyJournal();
        throw err;
    }
    const journal = parseJournal(raw);
    if (journal === undefined) {
        return (0, errors_js_1.throwAppError)('JULES_JOURNAL_CORRUPT', `${journalPath} does not parse as a yellow-jules journal; it was left untouched`);
    }
    return journal;
}
/** Atomic whole-file rewrite. Callers must hold the journal lock. */
async function writeJournal(dataDir, journal, 
/** Keys of the records that changed; when given, only those are secret-scanned. */
changedKeys) {
    const toScan = changedKeys === undefined
        ? Object.values(journal.operations)
        : changedKeys.flatMap((key) => {
            const record = journal.operations[key];
            return record === undefined ? [] : [record];
        });
    for (const record of toScan) {
        (0, redact_js_1.assertNoSecretShapedValues)(record);
    }
    const stateDir = (0, config_js_1.resolveStateDir)(dataDir);
    (0, config_js_1.ensureOwnerOnlyDir)(stateDir);
    const journalPath = (0, config_js_1.resolveJournalPath)(dataDir);
    (0, config_js_1.assertOwnerOnlyFile)(journalPath);
    const tmpPath = path.join(stateDir, `journal.json.tmp-${process.pid}-${crypto.randomUUID()}`);
    const data = `${JSON.stringify(journal, null, 2)}\n`;
    const handle = await fs.promises.open(tmpPath, 'wx', 0o600);
    try {
        await handle.writeFile(data, 'utf8');
        await handle.sync();
    }
    finally {
        await handle.close();
    }
    try {
        await fs.promises.chmod(tmpPath, 0o600);
        await fs.promises.rename(tmpPath, journalPath);
    }
    catch (err) {
        await fs.promises.unlink(tmpPath).catch(() => undefined);
        throw err;
    }
    await fs.promises.chmod(journalPath, 0o600);
}
exports.DEFAULT_LOCK_CONFIG = {
    staleMs: 60_000,
    timeoutMs: 15_000,
    pollMs: 50,
};
function parseLockOwner(raw) {
    try {
        const value = JSON.parse(raw);
        if (!(0, shape_js_1.isPlainObject)(value))
            return undefined;
        const { owner, pid, hostname, startedAt } = value;
        if (typeof owner !== 'string' || typeof hostname !== 'string')
            return undefined;
        if (typeof pid !== 'number' || typeof startedAt !== 'number')
            return undefined;
        return { owner, pid, hostname, startedAt };
    }
    catch {
        return undefined;
    }
}
function processIsDead(pid) {
    try {
        process.kill(pid, 0);
        return false;
    }
    catch (err) {
        return err.code === 'ESRCH';
    }
}
function staleLock(lockPath, why) {
    return (0, errors_js_1.throwAppError)('JULES_STALE_LOCK', `${lockPath}: ${why}; it was left in place`);
}
/**
 * `wx` (O_CREAT|O_EXCL) atomically fails if anything — including a symlink —
 * already occupies the path. The lock records owner token, pid, hostname,
 * and start time so a crashed holder can be recognized and reported.
 */
async function acquireLock(lockPath, config) {
    const owner = crypto.randomUUID();
    const deadline = Date.now() + config.timeoutMs;
    for (;;) {
        try {
            const handle = await fs.promises.open(lockPath, 'wx', 0o600);
            // Stamped when the lock is actually taken, not when waiting began: a
            // process that waited 14 s must not look 14 s older than it is.
            const content = {
                owner,
                pid: process.pid,
                hostname: os.hostname(),
                startedAt: Date.now(),
            };
            try {
                await handle.writeFile(JSON.stringify(content));
            }
            catch (writeErr) {
                // Never leave an empty lock behind: the next process would read it as stale.
                await handle.close().catch(() => undefined);
                await fs.promises.unlink(lockPath).catch(() => undefined);
                throw writeErr;
            }
            await handle.close();
            return owner;
        }
        catch (err) {
            if (err.code !== 'EEXIST')
                throw err;
        }
        let raw;
        let mtimeMs;
        try {
            const stat = await fs.promises.lstat(lockPath);
            if (!stat.isFile())
                staleLock(lockPath, 'the lock is not a regular file');
            mtimeMs = stat.mtimeMs;
            raw = await fs.promises.readFile(lockPath, 'utf8');
        }
        catch (statErr) {
            if (statErr.code === 'ENOENT')
                continue;
            throw statErr;
        }
        const holder = parseLockOwner(raw);
        const startedAt = holder?.startedAt ?? mtimeMs;
        if (holder !== undefined &&
            holder.hostname === os.hostname() &&
            processIsDead(holder.pid)) {
            staleLock(lockPath, `held by pid ${holder.pid}, which is no longer running`);
        }
        if (Date.now() - startedAt > config.staleMs) {
            staleLock(lockPath, `held since ${new Date(startedAt).toISOString()}`);
        }
        if (Date.now() > deadline) {
            return (0, errors_js_1.throwAppError)('JULES_STALE_LOCK', `${lockPath} is held by another yellow-jules process`, {
                retryable: true,
                recoveryAction: 'Another yellow-jules process holds state/.lock; retry after it finishes. If no such process is running, inspect and remove the lock by hand.',
            });
        }
        await new Promise((resolve) => setTimeout(resolve, config.pollMs));
    }
}
async function releaseLock(lockPath, owner) {
    try {
        const holder = parseLockOwner(await fs.promises.readFile(lockPath, 'utf8'));
        if (holder?.owner === owner)
            await fs.promises.unlink(lockPath);
    }
    catch (err) {
        if (err.code !== 'ENOENT')
            throw err;
    }
}
/** Serializes read-modify-write cycles on the journal across processes sharing the data dir. */
async function withJournalLock(dataDir, fn, config = exports.DEFAULT_LOCK_CONFIG) {
    (0, config_js_1.ensureOwnerOnlyDir)((0, config_js_1.resolveStateDir)(dataDir));
    const lockPath = (0, config_js_1.resolveLockPath)(dataDir);
    const owner = await acquireLock(lockPath, config);
    try {
        return await fn();
    }
    finally {
        await releaseLock(lockPath, owner);
    }
}
/** Read, mutate, and write the journal as one critical section; returns the mutator's value. */
async function updateJournal(dataDir, mutate, config = exports.DEFAULT_LOCK_CONFIG) {
    return withJournalLock(dataDir, async () => {
        const journal = await readJournal(dataDir);
        // Change detection by reference, not by serializing the whole journal
        // twice: every record type is readonly and every mutator replaces a record
        // by assignment, so an untouched record keeps its identity.
        const before = new Map(Object.entries(journal.operations));
        const confirmed = journal.archiveVisibilityConfirmed;
        const result = mutate(journal.operations, journal);
        const changed = Object.entries(journal.operations)
            .filter(([key, record]) => before.get(key) !== record)
            .map(([key]) => key);
        const expectedCount = before.size + changed.filter((k) => !before.has(k)).length;
        const unchanged = changed.length === 0 &&
            expectedCount === Object.keys(journal.operations).length &&
            confirmed === journal.archiveVisibilityConfirmed;
        // A mutation that changed nothing skips the fsync'd rewrite; a write only
        // secret-scans the records it changed (the rest passed when written).
        if (!unchanged)
            await writeJournal(dataDir, journal, changed);
        return result;
    }, config);
}
function requireRecord(operations, localRequestId) {
    const record = operations[localRequestId];
    if (record === undefined) {
        return (0, errors_js_1.throwAppError)('JULES_NOT_FOUND', `no journal record for ${localRequestId}`);
    }
    return record;
}
// ---------------------------------------------------------------------------
// Lookups (pure)
// ---------------------------------------------------------------------------
/** Kinds that own a session's read-state; a `reply` or `approve` row only points at the session. */
function ownsSession(record) {
    return record.kind !== 'reply' && record.kind !== 'approve';
}
/** The create (or first-seen) record that owns the session; reply and approve rows never match. */
function findBySessionResource(journal, sessionResource) {
    return Object.values(journal.operations).find((r) => ownsSession(r) && r.sessionResource === sessionResource);
}
function findByLocalId(journal, localId) {
    return Object.values(journal.operations).find((r) => r.localId === localId);
}
/** R36: `reserved` or `unknown-outcome` creates for the same repository and branch (and task ref when given). */
function findUnresolvedOperations(journal, query) {
    return Object.values(journal.operations).filter((r) => r.kind === 'create' &&
        exports.UNRESOLVED_STATUSES.has(r.status) &&
        r.repository === query.repository &&
        r.requestedBranch === query.requestedBranch &&
        (query.taskRef === undefined || r.taskRef === query.taskRef));
}
// ---------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------
function baseRecord(fields, nowIso) {
    return {
        ...fields,
        recentActivityIds: [],
        activityCount: 0,
        resumeRestartCount: 0,
        artifacts: [],
        deviations: [],
        createdAt: nowIso,
        updatedAt: nowIso,
    };
}
/**
 * The pure core of the reservation (R36): refuses a recorded request id and,
 * for a create, any unresolved operation on the same repository and branch,
 * then adds the `reserved` record. Callers hold the journal lock;
 * `reserveOperation` wraps it for the one-file case and `write-gate.ts` runs it
 * inside the larger authority critical section (R31).
 */
function applyReservation(operations, journal, input, now = () => new Date()) {
    (0, validate_js_1.validateRequestId)(input.localRequestId);
    if (operations[input.localRequestId] !== undefined) {
        return (0, errors_js_1.throwAppError)('JULES_DUPLICATE_LAUNCH', `request id ${input.localRequestId} is already recorded`, {
            recoveryAction: 'Run status --reconcile; never reuse a request id for a new operation.',
        });
    }
    if (input.kind === 'create') {
        if (input.repository === undefined || input.requestedBranch === undefined) {
            return (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', 'a create reservation needs a repository and branch');
        }
        const unresolved = findUnresolvedOperations(journal, {
            repository: input.repository,
            requestedBranch: input.requestedBranch,
            ...(input.taskRef !== undefined ? { taskRef: input.taskRef } : {}),
        });
        if (unresolved.length > 0) {
            return (0, errors_js_1.throwAppError)('JULES_DUPLICATE_LAUNCH', `unresolved operation ${unresolved[0]?.localRequestId ?? ''} exists for ${input.repository} ${input.requestedBranch}`);
        }
    }
    const { localId, ...rest } = input;
    const record = {
        ...baseRecord({
            localRequestId: input.localRequestId,
            localId: localId ?? (0, validate_js_1.mintLocalId)(),
            kind: input.kind,
            origin: 'yellow',
            status: 'reserved',
        }, now().toISOString()),
        ...rest,
    };
    operations[input.localRequestId] = record;
    return record;
}
/**
 * Reservation-first write (R36): the unresolved-operation lookup and the
 * reservation are one critical section, so two concurrent creates for the
 * same repository and branch cannot both reserve.
 */
async function reserveOperation(dataDir, input, now = () => new Date(), config = exports.DEFAULT_LOCK_CONFIG) {
    (0, validate_js_1.validateRequestId)(input.localRequestId);
    return updateJournal(dataDir, (operations, journal) => applyReservation(operations, journal, input, now), config);
}
/** Retention: once terminal, the dedup ring and both resume tokens are dropped. */
function applyRetention(record) {
    if (!exports.TERMINAL_STATUSES.has(record.status))
        return record;
    const { resumePageToken: _r, artifactResumePageToken: _a, resumeApproval: _p, ...rest } = record;
    return { ...rest, recentActivityIds: [] };
}
async function markOperation(dataDir, localRequestId, status, extra = {}, now = () => new Date(), config = exports.DEFAULT_LOCK_CONFIG) {
    return updateJournal(dataDir, (operations) => {
        const next = applyRetention({
            ...requireRecord(operations, localRequestId),
            ...extra,
            status,
            updatedAt: now().toISOString(),
        });
        operations[localRequestId] = next;
        return next;
    }, config);
}
/**
 * First sight of a session with no journal row (it was created outside
 * yellow, or by another copy of this data): mint a local id and record it with
 * `origin: "external"`. Returns the existing record when one is bound.
 */
async function ensureObservedRecord(dataDir, sessionResource, now = () => new Date(), config = exports.DEFAULT_LOCK_CONFIG) {
    return updateJournal(dataDir, (operations, journal) => {
        const existing = findBySessionResource(journal, sessionResource);
        if (existing !== undefined)
            return existing;
        const localId = (0, validate_js_1.mintLocalId)();
        const record = {
            ...baseRecord({
                localRequestId: `observe:${localId}`,
                localId,
                kind: 'observe',
                origin: 'external',
                status: 'observed',
            }, now().toISOString()),
            sessionResource,
        };
        operations[record.localRequestId] = record;
        return record;
    }, config);
}
/**
 * Activity read-state. Only the `status` path calls this (contract
 * "Activity walk": status is the sole writer of the watermark, resume token,
 * and dedup ring; approve and collect walks only read them).
 */
async function upsertReadState(dataDir, localRequestId, update, now = () => new Date(), config = exports.DEFAULT_LOCK_CONFIG) {
    return updateJournal(dataDir, (operations) => {
        const current = requireRecord(operations, localRequestId);
        const { resumePageToken: _drop, pendingPlan: _dropPlan, resumeApproval: _dropApproval, ...base } = current;
        const resumePageToken = update.resumePageToken === undefined
            ? current.resumePageToken
            : (update.resumePageToken ?? undefined);
        let resumeApproval = update.resumeApproval === undefined
            ? current.resumeApproval
            : (update.resumeApproval ?? undefined);
        const rebase = update.rebase;
        let pendingPlan = update.pendingPlan === undefined
            ? current.pendingPlan
            : (update.pendingPlan ?? undefined);
        let watermark = update.watermark;
        let recentActivityIds = update.recentActivityIds ?? current.recentActivityIds;
        let activityCountDelta = update.activityCountDelta ?? 0;
        if (rebase !== undefined) {
            // A stored approval has no reader without a resume token: it is
            // dropped with the token. Otherwise keep the newest stamp, so an older
            // walk cannot clear (or replace) a newer approval a concurrent status
            // stored since the snapshot.
            const freshApproval = current.resumeApproval;
            if (resumePageToken === undefined) {
                resumeApproval = undefined;
            }
            else if (update.resumeApproval === null) {
                resumeApproval =
                    freshApproval !== undefined &&
                        (rebase.approval === undefined ||
                            (0, activity_walk_js_1.compareStamp)(freshApproval, rebase.approval) > 0)
                        ? freshApproval
                        : undefined;
            }
            else if (update.resumeApproval !== undefined &&
                freshApproval !== undefined &&
                (0, activity_walk_js_1.compareStamp)(update.resumeApproval, freshApproval) <= 0) {
                resumeApproval = freshApproval;
            }
            const fresh = current.pendingPlan;
            if (update.pendingPlan === undefined) {
                pendingPlan = fresh;
            }
            else if (update.pendingPlan === null) {
                // Approval seen against the snapshot's plan: it must not clear a
                // different (newer) plan a concurrent update stored since.
                pendingPlan =
                    fresh === undefined ||
                        fresh.activityId === rebase.pendingPlan?.activityId
                        ? undefined
                        : fresh;
            }
            else if (fresh !== undefined) {
                const newer = (0, activity_walk_js_1.compareStamp)({
                    createTime: update.pendingPlan.activityCreateTime,
                    activityId: update.pendingPlan.activityId,
                }, {
                    createTime: fresh.activityCreateTime,
                    activityId: fresh.activityId,
                }) > 0;
                pendingPlan = newer ? update.pendingPlan : fresh;
            }
            else if (current.lastActivityCreateTime !== undefined &&
                current.lastActivityId !== undefined &&
                (0, activity_walk_js_1.compareStamp)({
                    createTime: update.pendingPlan.activityCreateTime,
                    activityId: update.pendingPlan.activityId,
                }, {
                    createTime: current.lastActivityCreateTime,
                    activityId: current.lastActivityId,
                }) <= 0) {
                // No plan is stored, and a concurrent walk already advanced past
                // this one: it saw the plan and its approval, so do not resurrect it.
                pendingPlan = undefined;
            }
            if (watermark !== undefined &&
                current.lastActivityCreateTime !== undefined &&
                current.lastActivityId !== undefined &&
                (0, activity_walk_js_1.compareStamp)(watermark, {
                    createTime: current.lastActivityCreateTime,
                    activityId: current.lastActivityId,
                }) <= 0) {
                watermark = undefined;
            }
            if (update.recentActivityIds !== undefined) {
                const base = new Set(rebase.ring);
                const merged = new Set(update.recentActivityIds);
                const concurrent = current.recentActivityIds.filter((id) => !base.has(id) && !merged.has(id));
                recentActivityIds = [...concurrent, ...merged].slice(-activity_walk_js_1.DEDUP_RING_CAP);
            }
            if (update.newActivityIds !== undefined) {
                const known = new Set(current.recentActivityIds);
                activityCountDelta = update.newActivityIds.filter((id) => !known.has(id)).length;
            }
        }
        const next = applyRetention({
            ...base,
            ...(update.vendorState !== undefined
                ? { vendorState: update.vendorState }
                : {}),
            ...(update.condition !== undefined
                ? { condition: update.condition }
                : {}),
            ...(watermark !== undefined
                ? {
                    lastActivityCreateTime: watermark.createTime,
                    lastActivityId: watermark.activityId,
                }
                : {}),
            ...(update.completeWalkAt !== undefined
                ? { lastCompleteWalkAt: update.completeWalkAt }
                : {}),
            ...(resumePageToken !== undefined ? { resumePageToken } : {}),
            ...(resumeApproval !== undefined ? { resumeApproval } : {}),
            ...(pendingPlan !== undefined ? { pendingPlan } : {}),
            recentActivityIds,
            activityCount: current.activityCount + activityCountDelta,
            resumeRestartCount: update.resumeRestartCount ?? current.resumeRestartCount,
            updatedAt: now().toISOString(),
        });
        operations[localRequestId] = next;
        return next;
    }, config);
}
/**
 * The read-state fields `collect` owns. `null` clears the token; `restartCount`
 * (when given) replaces the artifact restart guard counter.
 */
async function upsertArtifactResumeToken(dataDir, localRequestId, token, now = () => new Date(), config = exports.DEFAULT_LOCK_CONFIG, restartCount) {
    return updateJournal(dataDir, (operations) => {
        const current = requireRecord(operations, localRequestId);
        if ((current.artifactResumePageToken ?? null) === token &&
            (restartCount === undefined ||
                (current.artifactResumeRestartCount ?? 0) === restartCount))
            return current;
        const { artifactResumePageToken: _drop, ...rest } = current;
        const next = applyRetention({
            ...rest,
            ...(token !== null ? { artifactResumePageToken: token } : {}),
            ...(restartCount !== undefined
                ? { artifactResumeRestartCount: restartCount }
                : {}),
            updatedAt: now().toISOString(),
        });
        operations[localRequestId] = next;
        return next;
    }, config);
}
/** Content identity: the same bytes (or the same PR) are one artifact wherever they were staged. */
function artifactKey(a) {
    return a.kind === 'pr-ref'
        ? `pr-ref:${a.prUrl ?? ''}`
        : `${a.kind}:${a.sha256 ?? ''}:${a.vendorPath ?? ''}`;
}
/**
 * Artifact provenance with digests (R35), written only by `collect`. An
 * artifact already recorded keeps its `verification` value — only the R43
 * verification step (PR4) may change it.
 */
async function recordArtifacts(dataDir, localRequestId, artifacts, now = () => new Date(), config = exports.DEFAULT_LOCK_CONFIG) {
    return updateJournal(dataDir, (operations) => {
        const current = requireRecord(operations, localRequestId);
        const known = new Set(current.artifacts.map(artifactKey));
        const added = artifacts.filter((a) => !known.has(artifactKey(a)));
        if (added.length === 0)
            return current;
        const next = {
            ...current,
            artifacts: [...current.artifacts, ...added],
            updatedAt: now().toISOString(),
        };
        operations[localRequestId] = next;
        return next;
    }, config);
}
/** R13: record a policy deviation once per distinct reason + PR reference. */
async function recordDeviation(dataDir, localRequestId, deviation, now = () => new Date(), config = exports.DEFAULT_LOCK_CONFIG) {
    return updateJournal(dataDir, (operations) => {
        const current = requireRecord(operations, localRequestId);
        const duplicate = current.deviations.some((d) => d.reason === deviation.reason && d.prUrl === deviation.prUrl);
        if (duplicate)
            return current;
        const nowIso = now().toISOString();
        const next = {
            ...current,
            deviations: [
                ...current.deviations,
                { ...deviation, observedAt: nowIso, reconciled: false },
            ],
            updatedAt: nowIso,
        };
        operations[localRequestId] = next;
        return next;
    }, config);
}
function hasUnreconciledDeviation(record) {
    return record.deviations.some((d) => !d.reconciled);
}
/** `undefined` keeps the stored value, `null` clears it, anything else sets it. */
function keep(key, previous, patch) {
    const value = patch === undefined ? previous : (patch ?? undefined);
    return value === undefined ? {} : { [key]: value };
}
/** Merges a patch into the session's supervision state; written by `supervise` and, for `outsideSeen`, by `status` (R32, R33). */
async function updateSupervision(dataDir, localRequestId, patch, now = () => new Date(), config = exports.DEFAULT_LOCK_CONFIG) {
    return updateJournal(dataDir, (operations) => {
        const current = requireRecord(operations, localRequestId);
        const previous = current.supervision ?? {};
        // `undefined` keeps the stored value, `null` clears it, anything else sets it.
        const next = {
            ...keep('paused', previous.paused, patch.paused),
            ...keep('backoff', previous.backoff, patch.backoff),
            ...keep('lastDecision', previous.lastDecision, patch.lastDecision),
            ...keep('outsideSeen', previous.outsideSeen, patch.outsideSeen),
            ...keep('evaluatedPlan', previous.evaluatedPlan, patch.evaluatedPlan),
        };
        const updated = {
            ...current,
            supervision: next,
            updatedAt: now().toISOString(),
        };
        operations[localRequestId] = updated;
        return updated;
    }, config);
}
/**
 * Splits new user messages into this plugin's own echoes and outside ones. Each
 * landed reply or create explains at most ONE vendor activity (its echo), so a
 * teammate later repeating an earlier prompt verbatim is not mistaken for the
 * plugin: the first matching activity claims the operation's `echoActivityId`,
 * and further matches have no operation left to explain them. A rewalk of an
 * already-claimed activity stays own. With `mark`, the first outside message is
 * also recorded as the owner's `outsideSeen` under the same journal lock; later outside
 * messages replace the marker, so a pending `--clear-pause` confirmation for the older one fails. A message that only a dispatched write
 * still in flight could explain is reported in `pendingOut` and neither claimed nor
 * classified, so the caller leaves it for a later walk. A cleanly rejected or released write never
 * landed and claims nothing; an abandoned one might have, so it can.
 */
async function claimOwnEchoes(dataDir, sessionResource, messages, mark, pendingOut, config = exports.DEFAULT_LOCK_CONFIG) {
    return updateJournal(dataDir, (operations) => {
        const landed = Object.values(operations).filter((record) => {
            const neverLanded = (record.status === 'failed' && record.abandonedAt === undefined) ||
                record.status === 'rejected';
            return (record.sessionResource === sessionResource &&
                (record.kind === 'reply' || record.kind === 'create') &&
                record.promptDigest !== undefined &&
                !neverLanded &&
                // A reservation whose POST has not begun cannot have produced an echo.
                !(record.status === 'reserved' && record.dispatchedAt === undefined));
        });
        const nowMs = Date.parse(mark?.observedAt ?? new Date().toISOString());
        // A dispatched write that has not settled and is still inside its settle
        // window; past it the existing unknown-outcome rules apply.
        const inFlight = (r) => r.status === 'reserved' &&
            r.dispatchedAt !== undefined &&
            nowMs - Date.parse(r.dispatchedAt) < activity_walk_js_1.RESERVATION_SETTLE_MS;
        const claimed = new Set(landed.flatMap((r) => r.echoActivityId !== undefined ? [r.echoActivityId] : []));
        let outside;
        let newestOutside;
        for (const message of messages) {
            if (claimed.has(message.activityId))
                continue;
            const sent = message.createTime && Date.parse(message.createTime);
            const matches = (r) => r.echoActivityId === undefined &&
                r.promptDigest === message.digest &&
                // A message older than the record's dispatch cannot be its echo.
                !(typeof sent === 'number' &&
                    !Number.isNaN(sent) &&
                    r.dispatchedAt !== undefined &&
                    sent < Date.parse(r.dispatchedAt) - activity_walk_js_1.DISPATCH_SKEW_MS);
            const slot = landed.find((r) => matches(r) && !inFlight(r));
            if (slot === undefined && landed.some((r) => matches(r))) {
                // Only a dispatched write whose outcome is unknown could explain it:
                // `dispatchedAt` proves the POST began, not that it landed. Leave the
                // message unclassified; the caller must not consume it yet.
                pendingOut?.push(message.activityId);
                continue;
            }
            if (slot === undefined) {
                outside ??= message;
                newestOutside = message;
                continue;
            }
            claimed.add(message.activityId);
            operations[slot.localRequestId] = {
                ...slot,
                echoActivityId: message.activityId,
            };
            // `landed` holds the replaced record; keep it current for later matches.
            landed[landed.indexOf(slot)] = operations[slot.localRequestId];
        }
        // The marker is written in this same critical section: a reserve cannot
        // slip between classifying the message and recording that it was seen.
        const owner = mark !== undefined ? operations[mark.ownerRequestId] : undefined;
        // Outside evidence that is newer than the stored marker replaces it: a
        // `--clear-pause` confirmed against the older id must then be refused.
        const stored = owner?.supervision?.outsideSeen;
        const evidence = stored === undefined
            ? outside
            : newestOutside !== undefined &&
                newestOutside.activityId !== stored.activityId
                ? newestOutside
                : undefined;
        if (evidence !== undefined && mark !== undefined && owner !== undefined) {
            operations[mark.ownerRequestId] = {
                ...owner,
                supervision: {
                    ...(owner.supervision ?? {}),
                    outsideSeen: {
                        activityId: evidence.activityId,
                        observedAt: mark.observedAt,
                    },
                },
                updatedAt: mark.observedAt,
            };
            // Reservations already written for this session (a reply or approve
            // between its reserve and its POST) were gated before the outside
            // activity was seen; the pre-POST re-check reads this flag and refuses.
            for (const r of Object.values(operations)) {
                if (r.status === 'reserved' &&
                    (r.kind === 'reply' || r.kind === 'approve') &&
                    r.sessionResource === sessionResource &&
                    r.invalidatedBy === undefined) {
                    operations[r.localRequestId] = {
                        ...r,
                        invalidatedBy: 'outside-activity',
                        updatedAt: mark.observedAt,
                    };
                }
            }
        }
        return outside;
    }, config);
}
/**
 * An earlier launch of this task under this grant that blocks a repair launch:
 * it is paused or carries unreviewed outside activity. One predicate for the
 * pre-reservation gate and the pre-POST re-check.
 */
function blocksRepairLaunch(record, grantId, taskRef) {
    return (record.kind === 'create' &&
        record.grantId === grantId &&
        record.taskRef === taskRef &&
        (record.supervision?.paused !== undefined ||
            record.supervision?.outsideSeen !== undefined));
}
function isOwningCreate(record) {
    return (record !== undefined &&
        record.kind === 'create' &&
        record.repository !== undefined &&
        record.requestedBranch !== undefined &&
        record.sourceResource !== undefined);
}
