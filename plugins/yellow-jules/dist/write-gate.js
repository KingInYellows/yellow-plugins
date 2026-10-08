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
exports.reserveUnderGrant = reserveUnderGrant;
exports.authorizeCommandFor = authorizeCommandFor;
exports.confirmationRequired = confirmationRequired;
exports.settleAccepted = settleAccepted;
exports.settleFailure = settleFailure;
exports.persistenceUnknown = persistenceUnknown;
const authority_js_1 = require("./authority.js");
const authorize_js_1 = require("./authorize.js");
const config_js_1 = require("./config.js");
const controller_js_1 = require("./controller.js");
const errors_js_1 = require("./errors.js");
const runtime_support_js_1 = require("./runtime-support.js");
const state_js_1 = require("./state.js");
/** Vendor conditions that mean a session is no longer working (R39 `runningSessions`). */
const TERMINAL_CONDITIONS = new Set(['failed', 'remote-completed']);
function runningSessionsUnder(journal, grantId) {
    return Object.values(journal.operations)
        .filter((r) => r.grantId === grantId &&
        r.kind === 'create' &&
        r.sessionResource !== undefined &&
        r.status !== 'failed' &&
        r.status !== 'rejected' &&
        !TERMINAL_CONDITIONS.has(r.condition ?? ''))
        .map((r) => r.sessionResource);
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
    if (denial.code === 'JULES_AUTHORITY_DENIED') {
        return new errors_js_1.MutationErrorException((0, errors_js_1.makeAppError)('JULES_AUTHORITY_DENIED', denial.message, {
            recoveryAction: 'The grant does not cover this call. List grants with authorize --list, or create a covering grant with authorize in a terminal.',
        }), context);
    }
    return new errors_js_1.MutationErrorException((0, errors_js_1.makeAppError)(denial.code, denial.message), context);
}
async function reserveUnderGrant(deps, gate) {
    const ctx = (0, authorize_js_1.resolveControllerContext)(deps);
    const now = (0, runtime_support_js_1.nowFn)(deps);
    return (0, state_js_1.withJournalLock)(deps.dataDir, async () => {
        const journal = await (0, state_js_1.readJournal)(deps.dataDir);
        const grants = (0, authority_js_1.loadGrants)(deps.dataDir);
        const grant = (0, authority_js_1.requireGrant)(grants, gate.grantId);
        (0, controller_js_1.assertControllerAuthority)(ctx.controllerDir, deps.dataDir, grant.epochRef);
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
        // R36 lookup + reservation (mutates the in-memory journal only).
        const record = (0, state_js_1.applyReservation)(journal.operations, journal, gate.reservation, now);
        (0, authority_js_1.writeGrants)(deps.dataDir, (0, authority_js_1.updateGrant)(grants, grant.grantId, (g) => (0, authority_js_1.chargeGrant)(g, gate.charge)));
        await (0, state_js_1.writeJournal)(deps.dataDir, journal);
        return record;
    });
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
        '<your-name>',
    ].join(' ');
}
/** R29: a real write without `--grant-id` names the exact `authorize` command. */
function confirmationRequired(command, ids) {
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
    const app = (0, errors_js_1.mapAdapterError)(error, (0, errors_js_1.phaseOfWrite)(error));
    const ids = {
        localRequestId: record.localRequestId,
        localId: record.localId,
    };
    if (app.code === 'JULES_UNKNOWN_OUTCOME') {
        const sessionResource = error.sessionResource ?? record.sessionResource;
        let journalRecorded = true;
        try {
            await (0, state_js_1.markOperation)(deps.dataDir, record.localRequestId, 'unknown-outcome', sessionResource !== undefined ? { sessionResource } : {}, (0, runtime_support_js_1.nowFn)(deps));
        }
        catch (markError) {
            // The record stays `reserved`, which is also unresolved. The outcome is
            // reported either way, with the failed bookkeeping made visible.
            journalRecorded = false;
            process.stderr.write(`warning: could not mark ${record.localRequestId} unknown-outcome: ${markError instanceof Error ? markError.name : 'error'}\n`);
        }
        throw new errors_js_1.MutationErrorException({ ...app, recoveryAction: options.reconcileHint }, {
            ...ids,
            details: {
                ...(sessionResource !== undefined ? { sessionResource } : {}),
                ...(journalRecorded ? {} : { journalRecorded: false }),
            },
        });
    }
    await (0, state_js_1.markOperation)(deps.dataDir, record.localRequestId, 'failed', {}, (0, runtime_support_js_1.nowFn)(deps));
    if (record.kind === 'create' && record.grantId !== undefined) {
        await (0, authority_js_1.releaseSlotInStore)(deps.dataDir, record.grantId, record.localRequestId, 'clean-rejection');
    }
    throw new errors_js_1.MutationErrorException(app, ids);
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
