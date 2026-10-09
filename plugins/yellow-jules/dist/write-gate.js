"use strict";
/**
 * The authority critical section and the settle helpers every real write
 * shares (`delegate`, `reply`, `approve`, and the writes `supervise` drives).
 *
 * `reserveUnderGrant` is R31's single critical section under the journal lock:
 * controller authority, grant lookup, authority evaluation, the R36
 * unresolved-operation lookup, the counter charge, and the reservation write.
 * Authority is therefore rechecked immediately before every write (R14), and
 * two concurrent calls against a one-session grant cannot both pass.
 *
 * Crash order: `grants.json` is written before `journal.json`. A crash between
 * the two leaves a charge with no reservation — a leaked slot, which can only
 * make the grant stricter — never a reservation the grant did not pay for.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.plainLaunchGrantIds = plainLaunchGrantIds;
exports.hasPlainLaunch = hasPlainLaunch;
exports.reserveUnderGrant = reserveUnderGrant;
exports.assertGrantLiveBeforeWrite = assertGrantLiveBeforeWrite;
exports.confirmationRequired = confirmationRequired;
exports.settleAccepted = settleAccepted;
exports.settleFailure = settleFailure;
exports.settleAcceptedOrUnknown = settleAcceptedOrUnknown;
exports.settleExpiredBeforeWrite = settleExpiredBeforeWrite;
exports.loadAuthorizedGrant = loadAuthorizedGrant;
const authority_js_1 = require("./authority.js");
const config_js_1 = require("./config.js");
const controller_js_1 = require("./controller.js");
const errors_js_1 = require("./errors.js");
const redact_js_1 = require("./redact.js");
const runtime_support_js_1 = require("./runtime-support.js");
const state_js_1 = require("./state.js");
/** Sessions under a grant that may still be running (R39 `runningSessions`). */
function runningSessionsUnder(journal, grantId) {
    return Object.values(journal.operations)
        .filter((r) => r.grantId === grantId &&
        r.kind === 'create' &&
        r.sessionResource !== undefined &&
        r.status !== 'failed' &&
        r.status !== 'rejected' &&
        !(0, runtime_support_js_1.isTerminalCondition)(r.condition))
        .map((r) => r.sessionResource);
}
/** The grants under which a plain (non-repair) launch of this task exists; a repair must run under one of them. */
function plainLaunchGrantIds(journal, taskRef) {
    const ids = new Set();
    for (const r of Object.values(journal.operations)) {
        if (r.grantId !== undefined &&
            hasPlainLaunch(journal, r.grantId, taskRef)) {
            ids.add(r.grantId);
        }
    }
    return [...ids].sort();
}
function hasPlainLaunch(journal, grantId, taskRef) {
    return Object.values(journal.operations).some((r) => r.kind === 'create' &&
        r.grantId === grantId &&
        r.taskRef === taskRef &&
        r.correction !== true &&
        r.status !== 'failed' &&
        r.status !== 'rejected');
}
function denialError(denial, grant, journal, ids) {
    const context = {
        localRequestId: ids.localRequestId,
        ...(ids.localId !== undefined ? { localId: ids.localId } : {}),
    };
    if (denial.code === 'JULES_GRANT_EXPIRED') {
        const running = runningSessionsUnder(journal, grant.grantId);
        return new errors_js_1.MutationErrorException((0, errors_js_1.makeAppError)('JULES_GRANT_EXPIRED', `${denial.message}; ${running.length} remote session(s) under it may still be running`), { ...context, details: { runningSessions: running } });
    }
    const details = { reason: denial.reason };
    if (denial.code === 'JULES_AUTHORITY_DENIED') {
        return new errors_js_1.MutationErrorException((0, errors_js_1.makeAppError)('JULES_AUTHORITY_DENIED', denial.message, {
            recoveryAction: 'The grant does not cover this call. List grants with authorize --list, or create a covering grant with authorize in a terminal.',
        }), { ...context, details });
    }
    if (denial.reason === 'active-sessions-exhausted') {
        return new errors_js_1.MutationErrorException((0, errors_js_1.makeAppError)(denial.code, denial.message, {
            recoveryAction: 'The grant has no free session slot. A slot frees when a session under it finishes or is reconciled: run status --reconcile, then retry. Write a new grant only if you need more concurrent sessions.',
        }), { ...context, details });
    }
    return new errors_js_1.MutationErrorException((0, errors_js_1.makeAppError)(denial.code, denial.message), {
        ...context,
        details,
    });
}
async function reserveUnderGrant(deps, gate) {
    const now = (0, runtime_support_js_1.nowFn)(deps);
    return (0, state_js_1.withJournalLock)(deps.dataDir, async () => {
        const journal = await (0, state_js_1.readJournal)(deps.dataDir);
        // A recorded request id is answered before the grant is judged, so an agent
        // that lost the reply to a launch that landed is not told to write a new grant.
        if (journal.operations[gate.reservation.localRequestId] !== undefined) {
            throw new errors_js_1.MutationErrorException((0, errors_js_1.makeAppError)('JULES_DUPLICATE_LAUNCH', `request id ${gate.reservation.localRequestId} is already recorded`, {
                recoveryAction: 'Run status --reconcile to see what that request did. A recorded request id is spent: retry with a new one only after confirming nothing was created.',
            }), {
                localRequestId: gate.reservation.localRequestId,
                ...(gate.reservation.localId !== undefined
                    ? { localId: gate.reservation.localId }
                    : {}),
            });
        }
        const { grants, grant } = loadAuthorizedGrant(deps, gate.grantId);
        const verdict = (0, authority_js_1.evaluateAuthority)(grant, gate.authority, now(), {
            unreconciledDeviation: (0, authority_js_1.grantHasUnreconciledDeviation)(journal, grant.grantId),
        });
        if (!verdict.ok) {
            throw denialError(verdict, grant, journal, {
                localRequestId: gate.reservation.localRequestId,
                ...(gate.reservation.localId !== undefined
                    ? { localId: gate.reservation.localId }
                    : {}),
            });
        }
        const owner = gate.ownerRequestId !== undefined
            ? journal.operations[gate.ownerRequestId]
            : undefined;
        const ids = {
            localRequestId: gate.reservation.localRequestId,
            ...(gate.reservation.localId !== undefined
                ? { localId: gate.reservation.localId }
                : {}),
        };
        // reply and approve act on a session this plugin created; a missing owner
        // must not turn the pause and deviation checks below into no-ops.
        if (gate.authority.operation !== 'create' && owner === undefined) {
            throw new errors_js_1.MutationErrorException((0, errors_js_1.makeAppError)('JULES_AUTHORITY_DENIED', 'the session this write targets has no owning launch record'), ids);
        }
        // A concurrent `status` may have recorded a terminal condition (and freed
        // the slot) after the caller's live read; a reply or approve would reopen it.
        if (gate.authority.operation !== 'create' &&
            owner !== undefined &&
            (0, runtime_support_js_1.isTerminalCondition)(owner.condition)) {
            throw new errors_js_1.MutationErrorException((0, errors_js_1.makeAppError)('JULES_INVALID_STATE', `the session is ${owner.condition}; a ${gate.authority.operation} does not reopen a finished session`, {
                recoveryAction: 'For a repair, run delegate with --correction and the same --task-ref.',
            }), ids);
        }
        if (owner?.supervision?.outsideSeen !== undefined) {
            throw new errors_js_1.MutationErrorException((0, errors_js_1.makeAppError)('JULES_SUPERVISION_PAUSED', `outside activity was recorded on ${owner.sessionResource ?? 'this session'}; no grant-backed write is allowed until supervise --clear-pause`), ids);
        }
        if (owner?.supervision?.paused !== undefined) {
            throw new errors_js_1.MutationErrorException((0, errors_js_1.makeAppError)('JULES_SUPERVISION_PAUSED', `supervision of ${owner.sessionResource ?? 'this session'} is paused (${owner.supervision.paused.reason}); no grant-backed write is allowed`), ids);
        }
        // R13: a deviation recorded on the SESSION blocks it under any grant, not
        // only the grant that created it.
        if (owner !== undefined && (0, state_js_1.hasUnreconciledDeviation)(owner)) {
            throw new errors_js_1.MutationErrorException((0, errors_js_1.makeAppError)('JULES_POLICY_DEVIATION', `${owner.sessionResource ?? 'this session'} has an unreconciled policy deviation`), ids);
        }
        // A repair creates a new session, so the owner pause is checked on the
        // task's earlier launches instead of an owner record.
        if (gate.authority.operation === 'create' &&
            gate.authority.correction === true &&
            Object.values(journal.operations).some((r) => r.kind === 'create' &&
                r.grantId === grant.grantId &&
                r.taskRef === gate.authority.taskRef &&
                (r.supervision?.paused !== undefined ||
                    r.supervision?.outsideSeen !== undefined))) {
            throw new errors_js_1.MutationErrorException((0, errors_js_1.makeAppError)('JULES_SUPERVISION_PAUSED', `a session for task ${gate.authority.taskRef ?? '(none)'} is paused or has unreviewed outside activity; no repair launch is allowed`), ids);
        }
        // A repair spends a corrective round, not a task, so it must follow a plain
        // launch of the same task under this grant; otherwise corrective rounds
        // would mint sessions for task refs that were never launched.
        if (gate.authority.operation === 'create' &&
            gate.authority.correction === true &&
            !hasPlainLaunch(journal, grant.grantId, gate.authority.taskRef)) {
            throw new errors_js_1.MutationErrorException((0, errors_js_1.makeAppError)('JULES_AUTHORITY_DENIED', `no earlier launch of task ${gate.authority.taskRef ?? '(none)'} under this grant; --correction repairs an existing task`, {
                recoveryAction: 'Launch the task without --correction first, or write a grant that covers a new task.',
            }), ids);
        }
        // R36 lookup + reservation (mutates the in-memory journal only).
        const { authority } = gate;
        const record = (0, state_js_1.applyReservation)(journal.operations, journal, {
            ...gate.reservation,
            kind: authority.operation,
            repository: authority.repository,
            requestedBranch: authority.branch,
            sourceResource: authority.sourceResource,
            ...(authority.taskRef !== undefined
                ? { taskRef: authority.taskRef }
                : {}),
            grantId: grant.grantId,
            ...(authority.operation === 'create' && authority.correction === true
                ? { correction: true }
                : {}),
        }, now);
        const charge = {
            operation: authority.operation,
            localRequestId: gate.reservation.localRequestId,
            ...(authority.taskRef !== undefined
                ? { taskRef: authority.taskRef }
                : {}),
            correction: authority.correction === true,
        };
        // Everything that can refuse the record runs before the charge, so a
        // rejected input never spends grant budget.
        (0, redact_js_1.assertNoSecretShapedValues)(record);
        (0, authority_js_1.writeGrants)(deps.dataDir, (0, authority_js_1.updateGrant)(grants, grant.grantId, (g) => (0, authority_js_1.chargeGrant)(g, charge)));
        try {
            await (0, state_js_1.writeJournal)(deps.dataDir, journal, [record.localRequestId]);
        }
        catch (err) {
            // Undo the charge while the lock is held; only a hard crash between the
            // two writes can leak a slot.
            try {
                (0, authority_js_1.writeGrants)(deps.dataDir, grants);
            }
            catch (undoError) {
                process.stderr.write(`warning: could not undo the grant charge after a failed reservation: ${(0, errors_js_1.errorLabel)(undoError)}\n`);
            }
            throw err;
        }
        return record;
    });
}
/**
 * The last check before a vendor POST: the grant may have been revoked or may
 * have expired since the reservation (a delegate does an SDK source read in
 * between). On failure nothing was sent, so the reservation settles as a clean
 * failure and, for a create, frees its slot. It also refuses a reply or approve
 * that outside activity invalidated after the reserve (`invalidatedBy`).
 * Revocation and outside activity are honoured up to this call; the remote
 * POST that follows cannot be made atomic with local state, so a revoke or an
 * outside message landing in that last window is not stopped.
 */
async function assertGrantLiveBeforeWrite(deps, record, reconcileHint) {
    let failure;
    try {
        const { grant } = loadAuthorizedGrant(deps, record.grantId ?? '');
        if (grant.revokedAt !== undefined) {
            failure = new errors_js_1.AppErrorException((0, errors_js_1.makeAppError)('JULES_AUTHORITY_DENIED', `grant ${grant.grantId} was revoked before the write; nothing was sent`));
        }
        else if ((0, authority_js_1.grantIsExpired)(grant, (0, runtime_support_js_1.nowFn)(deps)())) {
            failure = new errors_js_1.AppErrorException((0, errors_js_1.makeAppError)('JULES_GRANT_EXPIRED', `grant ${grant.grantId} expired at ${grant.expiresAt} before the write; nothing was sent`));
        }
        else {
            // Outside activity recorded after the reserve invalidates this record.
            const fresh = (await (0, state_js_1.readJournal)(deps.dataDir)).operations[record.localRequestId];
            if (fresh?.invalidatedBy !== undefined) {
                failure = new errors_js_1.AppErrorException((0, errors_js_1.makeAppError)('JULES_SUPERVISION_PAUSED', `outside activity was recorded on ${record.sessionResource ?? 'this session'} after the write was reserved; nothing was sent`));
            }
        }
    }
    catch (err) {
        if (!(err instanceof errors_js_1.AppErrorException))
            throw err;
        failure = err;
    }
    if (failure !== undefined) {
        await settleFailure(deps, record, failure, { reconcileHint });
    }
}
function shellQuote(value) {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}
/**
 * The exact terminal command a caller without a grant must run. Every value
 * was validated against an allowlist before it reaches here.
 */
function authorizeCommandFor(parts) {
    const cli = `${parts.pluginRoot ?? (0, config_js_1.resolvePluginRoot)()}/dist/cli.js`;
    return [
        'node',
        shellQuote(cli),
        'authorize',
        '--repo',
        shellQuote(parts.repository),
        '--branch',
        shellQuote(parts.branch),
        '--task-ref',
        shellQuote(parts.taskRef ?? '<task-ref>'),
        '--operations',
        shellQuote(parts.operations.join(',')),
        '--owner',
        'YOUR_NAME',
    ].join(' ');
}
/** R29: a real write without `--grant-id` names the exact `authorize` command. */
function confirmationRequired(deps, scope, ids) {
    const command = authorizeCommandFor({
        repository: scope.repository ?? '<owner/repo>',
        branch: scope.requestedBranch ?? '<branch>',
        ...(scope.taskRef !== undefined ? { taskRef: scope.taskRef } : {}),
        operations: scope.operations ?? (scope.operation ? [scope.operation] : []),
        ...(deps.pluginRoot !== undefined ? { pluginRoot: deps.pluginRoot } : {}),
    });
    return new errors_js_1.MutationErrorException((0, errors_js_1.makeAppError)('JULES_CONFIRMATION_REQUIRED', 'a real write needs --grant-id from a grant written by authorize; none was given', {
        recoveryAction: `Run this yourself in a terminal on the controller host, then retry with --grant-id: ${command}`,
    }), ids);
}
async function settleAccepted(deps, record, extra = {}) {
    return (0, state_js_1.markOperation)(deps.dataDir, record.localRequestId, 'accepted', extra, (0, runtime_support_js_1.nowFn)(deps));
}
/**
 * A failed write. After dispatch only a clear rejection keeps its code; any
 * other failure is JULES_UNKNOWN_OUTCOME with the reservation left in place and
 * any known session id preserved (R16). A clean rejection (or a failure before
 * anything was sent) marks the reservation terminal `failed`, which frees the
 * R36 guard and — for a create — the active-session slot; tasks and corrective
 * rounds stay spent. Always throws.
 */
async function settleFailure(deps, record, error, options) {
    // An AppErrorException is our own verdict (an integrity or allowlist check
    // that ran before anything was sent), already in its final form.
    const app = error instanceof errors_js_1.AppErrorException
        ? error.appError
        : (0, errors_js_1.mapAdapterError)(error, (0, errors_js_1.phaseOfWrite)(error));
    const ids = {
        localRequestId: record.localRequestId,
        localId: record.localId,
    };
    if (app.code === 'JULES_UNKNOWN_OUTCOME') {
        const sessionResource = (error instanceof errors_js_1.AdapterError ? error.sessionResource : undefined) ??
            record.sessionResource;
        let journalRecorded = true;
        try {
            await (0, state_js_1.markOperation)(deps.dataDir, record.localRequestId, 'unknown-outcome', sessionResource !== undefined ? { sessionResource } : {}, (0, runtime_support_js_1.nowFn)(deps));
        }
        catch (markError) {
            // The record stays `reserved`, which is also unresolved. The outcome is
            // reported either way, with the failed bookkeeping made visible.
            journalRecorded = false;
            process.stderr.write(`warning: could not mark ${record.localRequestId} unknown-outcome: ${(0, errors_js_1.errorLabel)(markError)}\n`);
        }
        throw new errors_js_1.MutationErrorException({ ...app, recoveryAction: options.reconcileHint }, {
            ...ids,
            details: {
                ...(sessionResource !== undefined ? { sessionResource } : {}),
                ...(journalRecorded ? {} : { journalRecorded: false }),
            },
        });
    }
    // The vendor's verdict must reach the caller even when the bookkeeping fails.
    // Marking the record and freeing the slot are separate steps with separate
    // failure modes, and the envelope says which one did not land.
    const details = {};
    let marked = true;
    try {
        await (0, state_js_1.markOperation)(deps.dataDir, record.localRequestId, 'failed', {}, (0, runtime_support_js_1.nowFn)(deps));
    }
    catch (markError) {
        // The record stays `reserved`, which reconcile still resolves.
        marked = false;
        details['journalRecorded'] = false;
        process.stderr.write(`warning: could not mark ${record.localRequestId} failed after a rejection: ${(0, errors_js_1.errorLabel)(markError)}\n`);
    }
    if (marked && record.kind === 'create' && record.grantId !== undefined) {
        try {
            await (0, authority_js_1.releaseSlotInStore)(deps.dataDir, record.grantId, record.localRequestId);
        }
        catch (releaseError) {
            // The record is `failed`, so nothing will retry this: the slot stays held.
            details['slotReleased'] = false;
            process.stderr.write(`warning: could not release the grant slot of ${record.localRequestId}: ${(0, errors_js_1.errorLabel)(releaseError)}\n`);
        }
    }
    throw new errors_js_1.MutationErrorException(Object.keys(details).length > 0
        ? {
            ...app,
            recoveryAction: `${app.recoveryAction} The local bookkeeping did not complete (see details); revoke and rewrite the grant to reclaim a held slot.`,
        }
        : app, Object.keys(details).length > 0 ? { ...ids, details } : ids);
}
/** Journal persistence failed after a 2xx: the write happened, the record did not land (R16). */
function persistenceUnknown(record, sessionResource, reconcileHint) {
    return new errors_js_1.MutationErrorException((0, errors_js_1.makeAppError)('JULES_UNKNOWN_OUTCOME', 'the vendor accepted the write but the local journal could not record it', { recoveryAction: reconcileHint }), {
        localRequestId: record.localRequestId,
        localId: record.localId,
        ...(sessionResource !== undefined
            ? { details: { sessionResource } }
            : {}),
    });
}
/**
 * The write was accepted (2xx). Record it; if the local journal write fails the
 * write still happened, so report an unknown outcome — never a failure (R16).
 */
async function settleAcceptedOrUnknown(deps, record, extra, options) {
    try {
        await settleAccepted(deps, record, extra);
    }
    catch (err) {
        process.stderr.write(`warning: ${options.what} but the journal write failed: ${(0, errors_js_1.errorLabel)(err)}\n`);
        throw persistenceUnknown(record, extra.sessionResource ?? record.sessionResource, options.reconcileHint);
    }
}
/** Reserved but the deadline passed before anything was sent: a clean failure that frees the guard. */
function settleExpiredBeforeWrite(deps, record, reconcileHint) {
    return settleFailure(deps, record, new errors_js_1.AdapterError('timeout', 'deadline expired before the write', {
        dispatched: false,
    }), { reconcileHint });
}
/** Grant lookup bound to this controller (R38): every write path starts here. */
function loadAuthorizedGrant(deps, grantId) {
    const ctx = (0, runtime_support_js_1.resolveControllerContext)(deps);
    const grants = (0, authority_js_1.loadGrants)(deps.dataDir);
    const grant = (0, authority_js_1.requireGrant)(grants, grantId);
    (0, controller_js_1.assertControllerAuthority)(ctx.controllerDir, deps.dataDir, grant.epochRef, ctx.controllerId);
    return { grants, grant };
}
