/**
 * Terminal-session slot release shared by `status` and `status --reconcile`.
 * Kept out of authority.ts so callers reach `releaseSlotInStore` through the
 * module boundary.
 */
import { releaseSlotInStore } from './authority.js';
import { errorLabel } from './errors.js';

/** Vendor states after which a session no longer holds an active-session slot. */
export const TERMINAL_VENDOR_STATES: ReadonlySet<string> = new Set([
  'completed',
  'failed',
]);

/**
 * Releases the active-session slot of a create observed in a terminal vendor
 * state. Shared by `status` and `status --reconcile` so both free the slot the
 * same way. A failed release keeps the slot held, which only makes the grant
 * stricter; it is reported (return `true`) instead of thrown.
 */
export async function releaseTerminalSlot(
  dataDir: string,
  record: {
    readonly kind: string;
    readonly grantId?: string;
    readonly localRequestId: string;
  },
  vendorState: string | undefined
): Promise<boolean> {
  if (
    vendorState === undefined ||
    !TERMINAL_VENDOR_STATES.has(vendorState) ||
    record.kind !== 'create' ||
    record.grantId === undefined
  ) {
    return false;
  }
  try {
    await releaseSlotInStore(dataDir, record.grantId, record.localRequestId);
    return false;
  } catch (err) {
    process.stderr.write(
      `warning: could not release the grant slot of ${record.localRequestId}: ${errorLabel(err)}\n`
    );
    return true;
  }
}
