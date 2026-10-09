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
const errors_js_1 = require("./errors.js");
/** Vendor states after which a session no longer holds an active-session slot. */
exports.TERMINAL_VENDOR_STATES = new Set([
    'completed',
    'failed',
]);
/**
 * Releases the active-session slot of a create observed in a terminal vendor
 * state. Shared by `status` and `status --reconcile` so both free the slot the
 * same way. A failed release keeps the slot held, which only makes the grant
 * stricter; it is reported (return `true`) instead of thrown.
 */
async function releaseTerminalSlot(dataDir, record, vendorState) {
    if (vendorState === undefined ||
        !exports.TERMINAL_VENDOR_STATES.has(vendorState) ||
        record.kind !== 'create' ||
        record.grantId === undefined) {
        return false;
    }
    try {
        await (0, authority_js_1.releaseSlotInStore)(dataDir, record.grantId, record.localRequestId);
        return false;
    }
    catch (err) {
        process.stderr.write(`warning: could not release the grant slot of ${record.localRequestId}: ${(0, errors_js_1.errorLabel)(err)}\n`);
        return true;
    }
}
