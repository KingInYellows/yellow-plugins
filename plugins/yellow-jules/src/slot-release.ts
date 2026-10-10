/**
 * Terminal-session slot release shared by `status` and `status --reconcile`.
 * Kept out of authority.ts so callers reach `releaseSlotInStore` through the
 * module boundary.
 */
import { releaseSlotInStore } from './authority.js';
import { assertControllerAuthority } from './controller.js';
import { AppErrorException, errorLabel } from './errors.js';
import { resolveControllerContext, type WriteDeps } from './runtime-support.js';

/** Vendor states after which a session no longer holds an active-session slot. */
export const TERMINAL_VENDOR_STATES: ReadonlySet<string> = new Set([
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
export async function releaseTerminalSlot(
  deps: Pick<
    WriteDeps,
    'dataDir' | 'env' | 'controllerDir' | 'controllerId' | 'clock'
  >,
  record: {
    readonly kind: string;
    readonly grantId?: string;
    readonly localRequestId: string;
  },
  vendorState: string | undefined
): Promise<'stuck' | 'skipped' | undefined> {
  if (
    vendorState === undefined ||
    !TERMINAL_VENDOR_STATES.has(vendorState) ||
    record.kind !== 'create' ||
    record.grantId === undefined
  ) {
    return undefined;
  }
  try {
    const ctx = resolveControllerContext(deps);
    await releaseSlotInStore(
      deps.dataDir,
      record.grantId,
      record.localRequestId,
      (grant) =>
        assertControllerAuthority(
          ctx.controllerDir,
          deps.dataDir,
          grant.epochRef,
          ctx.controllerId
        )
    );
    return undefined;
  } catch (err) {
    if (
      err instanceof AppErrorException &&
      err.appError.code === 'JULES_CONTROLLER_MISMATCH'
    ) {
      process.stderr.write(
        `note: left the grant slot of ${record.localRequestId} held: this host is not the grant's controller (${err.appError.message})\n`
      );
      return 'skipped';
    }
    process.stderr.write(
      `warning: could not release the grant slot of ${record.localRequestId}: ${errorLabel(err)}\n`
    );
    return 'stuck';
  }
}
