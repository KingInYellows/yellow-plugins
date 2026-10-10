"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TERMINAL_VENDOR_STATES = void 0;
exports.releaseTerminalSlot = releaseTerminalSlot;
/**
 * Terminal-session slot release shared by `status` and `status --reconcile`.
 * Kept out of authority.ts so callers reach `releaseSlotInStore` through the
 * module boundary.
 */
const authority_js_1 = require("./authority.js");
const controller_js_1 = require("./controller.js");
const errors_js_1 = require("./errors.js");
const runtime_support_js_1 = require("./runtime-support.js");
/** Vendor states after which a session no longer holds an active-session slot. */
exports.TERMINAL_VENDOR_STATES = new Set([
    'completed',
    'failed',
]);
/**
 * Releases the active-session slot of a create observed in a terminal vendor
 * state. Shared by `status` and `status --reconcile` so both free the slot the
 * same way. A failed release keeps the slot held, which only makes the grant
 * stricter; it is reported (`stuck`) instead of thrown. Only the grant's
 * controller rewrites grants.json: on any other host the release is `skipped`
 * (checked under the journal lock) and status stays read-only.
 */
async function releaseTerminalSlot(deps, record, vendorState) {
    if (vendorState === undefined ||
        !exports.TERMINAL_VENDOR_STATES.has(vendorState) ||
        record.kind !== 'create' ||
        record.grantId === undefined) {
        return undefined;
    }
    try {
        const ctx = (0, runtime_support_js_1.resolveControllerContext)(deps);
        await (0, authority_js_1.releaseSlotInStore)(deps.dataDir, record.grantId, record.localRequestId, (grant) => (0, controller_js_1.assertControllerAuthority)(ctx.controllerDir, deps.dataDir, grant.epochRef, ctx.controllerId));
        return undefined;
    }
    catch (err) {
        if (err instanceof errors_js_1.AppErrorException &&
            err.appError.code === 'JULES_CONTROLLER_MISMATCH') {
            process.stderr.write(`note: left the grant slot of ${record.localRequestId} held: this host is not the grant's controller (${err.appError.message})\n`);
            return 'skipped';
        }
        process.stderr.write(`warning: could not release the grant slot of ${record.localRequestId}: ${(0, errors_js_1.errorLabel)(err)}\n`);
        return 'stuck';
    }
}
