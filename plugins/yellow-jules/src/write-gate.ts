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

import {
  type AuthorityDenial,
  type AuthorityRequest,
  type Charge,
  chargeGrant,
  evaluateAuthority,
  grantHasUnreconciledDeviation,
  loadGrants,
  releaseSlotInStore,
  requireGrant,
  updateGrant,
  writeGrants,
} from './authority.js';
import { type AuthorizeDeps, resolveControllerContext } from './authorize.js';
import { resolvePluginRoot } from './config.js';
import { assertControllerAuthority } from './controller.js';
import {
  type AdapterError,
  makeAppError,
  mapAdapterError,
  MutationErrorException,
  phaseOfWrite,
} from './errors.js';
import { nowFn } from './runtime-support.js';
import {
  applyReservation,
  markOperation,
  readJournal,
  type ReservationInput,
  withJournalLock,
  writeJournal,
} from './state.js';
import type {
  GrantOperation,
  GrantRecord,
  Journal,
  OperationRecord,
} from './types.js';

export interface GateRequest {
  readonly grantId: string;
  readonly authority: AuthorityRequest;
  readonly reservation: ReservationInput;
  readonly charge: Charge;
}

/** Vendor conditions that mean a session is no longer working (R39 `runningSessions`). */
const TERMINAL_CONDITIONS = new Set(['failed', 'remote-completed']);

function runningSessionsUnder(journal: Journal, grantId: string): string[] {
  return Object.values(journal.operations)
    .filter(
      (r) =>
        r.grantId === grantId &&
        r.kind === 'create' &&
        r.sessionResource !== undefined &&
        r.status !== 'failed' &&
        r.status !== 'rejected' &&
        !TERMINAL_CONDITIONS.has(r.condition ?? '')
    )
    .map((r) => r.sessionResource as string);
}

function denialError(
  denial: AuthorityDenial,
  grant: GrantRecord,
  journal: Journal,
  ids: { readonly localRequestId: string; readonly localId?: string }
): MutationErrorException {
  const context = {
    localRequestId: ids.localRequestId,
    ...(ids.localId !== undefined ? { localId: ids.localId } : {}),
  };
  if (denial.code === 'JULES_GRANT_EXPIRED') {
    const running = runningSessionsUnder(journal, grant.grantId);
    return new MutationErrorException(
      makeAppError(
        'JULES_GRANT_EXPIRED',
        `${denial.message}; ${running.length} remote session(s) under it may still be running`
      ),
      { ...context, details: { runningSessions: running } }
    );
  }
  if (denial.code === 'JULES_AUTHORITY_DENIED') {
    return new MutationErrorException(
      makeAppError('JULES_AUTHORITY_DENIED', denial.message, {
        recoveryAction:
          'The grant does not cover this call. List grants with authorize --list, or create a covering grant with authorize in a terminal.',
      }),
      context
    );
  }
  return new MutationErrorException(
    makeAppError(denial.code, denial.message),
    context
  );
}

export async function reserveUnderGrant(
  deps: AuthorizeDeps,
  gate: GateRequest
): Promise<OperationRecord> {
  const ctx = resolveControllerContext(deps);
  const now = nowFn(deps);
  return withJournalLock(deps.dataDir, async () => {
    const journal = await readJournal(deps.dataDir);
    const grants = loadGrants(deps.dataDir);
    const grant = requireGrant(grants, gate.grantId);
    assertControllerAuthority(ctx.controllerDir, deps.dataDir, grant.epochRef);
    const verdict = evaluateAuthority(grant, gate.authority, now(), {
      unreconciledDeviation: grantHasUnreconciledDeviation(
        journal,
        grant.grantId
      ),
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
    const record = applyReservation(
      journal.operations,
      journal,
      gate.reservation,
      now
    );
    writeGrants(
      deps.dataDir,
      updateGrant(grants, grant.grantId, (g) => chargeGrant(g, gate.charge))
    );
    await writeJournal(deps.dataDir, journal);
    return record;
  });
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The exact terminal command a caller without a grant must run. Every value
 * was validated against an allowlist before it reaches here.
 */
export function authorizeCommandFor(parts: {
  readonly repository: string;
  readonly branch: string;
  readonly taskRef?: string;
  readonly operations: readonly GrantOperation[];
  readonly pluginRoot?: string;
}): string {
  const cli = `${parts.pluginRoot ?? resolvePluginRoot()}/dist/cli.js`;
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
export function confirmationRequired(
  command: string,
  ids: { readonly localRequestId: string; readonly localId?: string }
): MutationErrorException {
  return new MutationErrorException(
    makeAppError(
      'JULES_CONFIRMATION_REQUIRED',
      'a real write needs --grant-id from a grant written by authorize; none was given',
      {
        recoveryAction: `Run this yourself in a terminal on the controller host, then retry with --grant-id: ${command}`,
      }
    ),
    ids
  );
}

export async function settleAccepted(
  deps: AuthorizeDeps,
  record: OperationRecord,
  extra: Partial<
    Pick<OperationRecord, 'sessionResource' | 'vendorState' | 'condition'>
  > = {}
): Promise<OperationRecord> {
  return markOperation(
    deps.dataDir,
    record.localRequestId,
    'accepted',
    extra,
    nowFn(deps)
  );
}

export interface SettleOptions {
  /** `reply` / `approve` unknown outcomes reconcile on their own session. */
  readonly reconcileHint: string;
}

/**
 * A failed write. After dispatch only a clear rejection keeps its code; any
 * other failure is JULES_UNKNOWN_OUTCOME with the reservation left in place and
 * any known session id preserved (R16). A clean rejection (or a failure before
 * anything was sent) marks the reservation terminal `failed`, which frees the
 * R36 guard and — for a create — the active-session slot; tasks and corrective
 * rounds stay spent. Always throws.
 */
export async function settleFailure(
  deps: AuthorizeDeps,
  record: OperationRecord,
  error: AdapterError,
  options: SettleOptions
): Promise<never> {
  const app = mapAdapterError(error, phaseOfWrite(error));
  const ids = {
    localRequestId: record.localRequestId,
    localId: record.localId,
  };
  if (app.code === 'JULES_UNKNOWN_OUTCOME') {
    const sessionResource = error.sessionResource ?? record.sessionResource;
    let journalRecorded = true;
    try {
      await markOperation(
        deps.dataDir,
        record.localRequestId,
        'unknown-outcome',
        sessionResource !== undefined ? { sessionResource } : {},
        nowFn(deps)
      );
    } catch (markError) {
      // The record stays `reserved`, which is also unresolved. The outcome is
      // reported either way, with the failed bookkeeping made visible.
      journalRecorded = false;
      process.stderr.write(
        `warning: could not mark ${record.localRequestId} unknown-outcome: ${
          markError instanceof Error ? markError.name : 'error'
        }\n`
      );
    }
    throw new MutationErrorException(
      { ...app, recoveryAction: options.reconcileHint },
      {
        ...ids,
        details: {
          ...(sessionResource !== undefined ? { sessionResource } : {}),
          ...(journalRecorded ? {} : { journalRecorded: false }),
        },
      }
    );
  }
  await markOperation(
    deps.dataDir,
    record.localRequestId,
    'failed',
    {},
    nowFn(deps)
  );
  if (record.kind === 'create' && record.grantId !== undefined) {
    await releaseSlotInStore(
      deps.dataDir,
      record.grantId,
      record.localRequestId,
      'clean-rejection'
    );
  }
  throw new MutationErrorException(app, ids);
}

/** Journal persistence failed after a 2xx: the write happened, the record did not land (R16). */
export function persistenceUnknown(
  record: OperationRecord,
  sessionResource: string | undefined,
  reconcileHint: string
): MutationErrorException {
  return new MutationErrorException(
    makeAppError(
      'JULES_UNKNOWN_OUTCOME',
      'the vendor accepted the write but the local journal could not record it',
      { recoveryAction: reconcileHint }
    ),
    {
      localRequestId: record.localRequestId,
      localId: record.localId,
      ...(sessionResource !== undefined
        ? { details: { sessionResource } }
        : {}),
    }
  );
}
