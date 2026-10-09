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
  grantIsExpired,
  loadGrants,
  releaseSlotInStore,
  requireGrant,
  updateGrant,
  writeGrants,
} from './authority.js';
import { resolvePluginRoot } from './config.js';
import { assertControllerAuthority } from './controller.js';
import {
  AdapterError,
  AppErrorException,
  errorLabel,
  makeAppError,
  mapAdapterError,
  MutationErrorException,
  phaseOfWrite,
} from './errors.js';
import { assertNoSecretShapedValues } from './redact.js';
import {
  isTerminalCondition,
  nowFn,
  type WriteDeps,
  resolveControllerContext,
} from './runtime-support.js';
import {
  applyReservation,
  hasUnreconciledDeviation,
  markOperation,
  readJournal,
  type ReservationInput,
  withJournalLock,
  writeJournal,
} from './state.js';
import type {
  GrantOperation,
  GrantRecord,
  GrantsFile,
  Journal,
  OperationRecord,
} from './types.js';

/** The writes that go through the authority critical section. */
export type GateOperation = 'create' | 'reply' | 'approve';

export interface GateRequest {
  /**
   * The create record that owns the session a `reply` or `approve` targets.
   * Its pause and deviation state is read from the fresh journal INSIDE the
   * critical section, so a pause recorded while the caller was re-reading a
   * plan still stops the write.
   */
  readonly ownerRequestId?: string;
  readonly grantId: string;
  /** The scope the grant must cover; the reservation and the charge are derived from it. */
  readonly authority: AuthorityRequest & { readonly operation: GateOperation };
  /** The ids and the per-operation extras the reservation records. */
  readonly reservation: Pick<
    ReservationInput,
    | 'localRequestId'
    | 'localId'
    | 'sessionResource'
    | 'autoPrRequested'
    | 'promptDigest'
    | 'observedPlanId'
  >;
}

/** Sessions under a grant that may still be running (R39 `runningSessions`). */
function runningSessionsUnder(journal: Journal, grantId: string): string[] {
  return Object.values(journal.operations)
    .filter(
      (r) =>
        r.grantId === grantId &&
        r.kind === 'create' &&
        r.sessionResource !== undefined &&
        r.status !== 'failed' &&
        r.status !== 'rejected' &&
        !isTerminalCondition(r.condition)
    )
    .map((r) => r.sessionResource as string);
}

/** The grants under which a plain (non-repair) launch of this task exists; a repair must run under one of them. */
export function plainLaunchGrantIds(
  journal: Journal,
  taskRef: string | undefined
): string[] {
  const ids = new Set<string>();
  for (const r of Object.values(journal.operations)) {
    if (r.grantId !== undefined && hasPlainLaunch(journal, r.grantId, taskRef)) {
      ids.add(r.grantId);
    }
  }
  return [...ids].sort();
}

export function hasPlainLaunch(
  journal: Journal,
  grantId: string,
  taskRef: string | undefined
): boolean {
  return Object.values(journal.operations).some(
    (r) =>
      r.kind === 'create' &&
      r.grantId === grantId &&
      r.taskRef === taskRef &&
      r.correction !== true &&
      r.status !== 'failed' &&
      r.status !== 'rejected'
  );
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
  const details = { reason: denial.reason };
  if (denial.code === 'JULES_AUTHORITY_DENIED') {
    return new MutationErrorException(
      makeAppError('JULES_AUTHORITY_DENIED', denial.message, {
        recoveryAction:
          'The grant does not cover this call. List grants with authorize --list, or create a covering grant with authorize in a terminal.',
      }),
      { ...context, details }
    );
  }
  if (denial.reason === 'active-sessions-exhausted') {
    return new MutationErrorException(
      makeAppError(denial.code, denial.message, {
        recoveryAction:
          'The grant has no free session slot. A slot frees when a session under it finishes or is reconciled: run status --reconcile, then retry. Write a new grant only if you need more concurrent sessions.',
      }),
      { ...context, details }
    );
  }
  return new MutationErrorException(makeAppError(denial.code, denial.message), {
    ...context,
    details,
  });
}

export async function reserveUnderGrant(
  deps: WriteDeps,
  gate: GateRequest
): Promise<OperationRecord> {
  const now = nowFn(deps);
  return withJournalLock(deps.dataDir, async () => {
    const journal = await readJournal(deps.dataDir);
    // A recorded request id is answered before the grant is judged, so an agent
    // that lost the reply to a launch that landed is not told to write a new grant.
    if (journal.operations[gate.reservation.localRequestId] !== undefined) {
      throw new MutationErrorException(
        makeAppError(
          'JULES_DUPLICATE_LAUNCH',
          `request id ${gate.reservation.localRequestId} is already recorded`,
          {
            recoveryAction:
              'Run status --reconcile to see what that request did. A recorded request id is spent: retry with a new one only after confirming nothing was created.',
          }
        ),
        {
          localRequestId: gate.reservation.localRequestId,
          ...(gate.reservation.localId !== undefined
            ? { localId: gate.reservation.localId }
            : {}),
        }
      );
    }
    const { grants, grant } = loadAuthorizedGrant(deps, gate.grantId);
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
    const owner =
      gate.ownerRequestId !== undefined
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
      throw new MutationErrorException(
        makeAppError(
          'JULES_AUTHORITY_DENIED',
          'the session this write targets has no owning launch record'
        ),
        ids
      );
    }
    // A concurrent `status` may have recorded a terminal condition (and freed
    // the slot) after the caller's live read; a reply or approve would reopen it.
    if (
      gate.authority.operation !== 'create' &&
      owner !== undefined &&
      isTerminalCondition(owner.condition)
    ) {
      throw new MutationErrorException(
        makeAppError(
          'JULES_INVALID_STATE',
          `the session is ${owner.condition}; a ${gate.authority.operation} does not reopen a finished session`,
          {
            recoveryAction:
              'For a repair, run delegate with --correction and the same --task-ref.',
          }
        ),
        ids
      );
    }
    if (owner?.supervision?.outsideSeen !== undefined) {
      throw new MutationErrorException(
        makeAppError(
          'JULES_SUPERVISION_PAUSED',
          `outside activity was recorded on ${owner.sessionResource ?? 'this session'}; no grant-backed write is allowed until supervise --clear-pause`
        ),
        ids
      );
    }
    if (owner?.supervision?.paused !== undefined) {
      throw new MutationErrorException(
        makeAppError(
          'JULES_SUPERVISION_PAUSED',
          `supervision of ${owner.sessionResource ?? 'this session'} is paused (${owner.supervision.paused.reason}); no grant-backed write is allowed`
        ),
        ids
      );
    }
    // R13: a deviation recorded on the SESSION blocks it under any grant, not
    // only the grant that created it.
    if (owner !== undefined && hasUnreconciledDeviation(owner)) {
      throw new MutationErrorException(
        makeAppError(
          'JULES_POLICY_DEVIATION',
          `${owner.sessionResource ?? 'this session'} has an unreconciled policy deviation`
        ),
        ids
      );
    }
    // A repair creates a new session, so the owner pause is checked on the
    // task's earlier launches instead of an owner record.
    if (
      gate.authority.operation === 'create' &&
      gate.authority.correction === true &&
      Object.values(journal.operations).some(
        (r) =>
          r.kind === 'create' &&
          r.grantId === grant.grantId &&
          r.taskRef === gate.authority.taskRef &&
          (r.supervision?.paused !== undefined ||
            r.supervision?.outsideSeen !== undefined)
      )
    ) {
      throw new MutationErrorException(
        makeAppError(
          'JULES_SUPERVISION_PAUSED',
          `a session for task ${gate.authority.taskRef ?? '(none)'} is paused or has unreviewed outside activity; no repair launch is allowed`
        ),
        ids
      );
    }
    // A repair spends a corrective round, not a task, so it must follow a plain
    // launch of the same task under this grant; otherwise corrective rounds
    // would mint sessions for task refs that were never launched.
    if (
      gate.authority.operation === 'create' &&
      gate.authority.correction === true &&
      !hasPlainLaunch(journal, grant.grantId, gate.authority.taskRef)
    ) {
      throw new MutationErrorException(
        makeAppError(
          'JULES_AUTHORITY_DENIED',
          `no earlier launch of task ${gate.authority.taskRef ?? '(none)'} under this grant; --correction repairs an existing task`,
          {
            recoveryAction:
              'Launch the task without --correction first, or write a grant that covers a new task.',
          }
        ),
        ids
      );
    }
    // R36 lookup + reservation (mutates the in-memory journal only).
    const { authority } = gate;
    const record = applyReservation(
      journal.operations,
      journal,
      {
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
      },
      now
    );
    const charge: Charge = {
      operation: authority.operation,
      localRequestId: gate.reservation.localRequestId,
      ...(authority.taskRef !== undefined
        ? { taskRef: authority.taskRef }
        : {}),
      correction: authority.correction === true,
    };
    // Everything that can refuse the record runs before the charge, so a
    // rejected input never spends grant budget.
    assertNoSecretShapedValues(record);
    writeGrants(
      deps.dataDir,
      updateGrant(grants, grant.grantId, (g) => chargeGrant(g, charge))
    );
    try {
      await writeJournal(deps.dataDir, journal, [record.localRequestId]);
    } catch (err) {
      // Undo the charge while the lock is held; only a hard crash between the
      // two writes can leak a slot.
      try {
        writeGrants(deps.dataDir, grants);
      } catch (undoError) {
        process.stderr.write(
          `warning: could not undo the grant charge after a failed reservation: ${errorLabel(undoError)}\n`
        );
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
 * failure and, for a create, frees its slot.
 */
export async function assertGrantLiveBeforeWrite(
  deps: WriteDeps,
  record: OperationRecord,
  reconcileHint: string
): Promise<void> {
  let failure: AppErrorException | undefined;
  try {
    const { grant } = loadAuthorizedGrant(deps, record.grantId ?? '');
    if (grant.revokedAt !== undefined) {
      failure = new AppErrorException(
        makeAppError(
          'JULES_AUTHORITY_DENIED',
          `grant ${grant.grantId} was revoked before the write; nothing was sent`
        )
      );
    } else if (grantIsExpired(grant, nowFn(deps)())) {
      failure = new AppErrorException(
        makeAppError(
          'JULES_GRANT_EXPIRED',
          `grant ${grant.grantId} expired at ${grant.expiresAt} before the write; nothing was sent`
        )
      );
    }
  } catch (err) {
    if (!(err instanceof AppErrorException)) throw err;
    failure = err;
  }
  if (failure !== undefined) {
    await settleFailure(deps, record, failure, { reconcileHint });
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The exact terminal command a caller without a grant must run. Every value
 * was validated against an allowlist before it reaches here.
 */
function authorizeCommandFor(parts: {
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
    'YOUR_NAME',
  ].join(' ');
}

/** R29: a real write without `--grant-id` names the exact `authorize` command. */
export function confirmationRequired(
  deps: Pick<WriteDeps, 'pluginRoot'>,
  scope: {
    readonly operation?: GrantOperation;
    /** The operations the printed grant should cover; defaults to `operation`. */
    readonly operations?: readonly GrantOperation[];
    readonly repository?: string;
    readonly requestedBranch?: string;
    readonly taskRef?: string;
  },
  ids: { readonly localRequestId: string; readonly localId?: string }
): MutationErrorException {
  const command = authorizeCommandFor({
    repository: scope.repository ?? '<owner/repo>',
    branch: scope.requestedBranch ?? '<branch>',
    ...(scope.taskRef !== undefined ? { taskRef: scope.taskRef } : {}),
    operations: scope.operations ?? (scope.operation ? [scope.operation] : []),
    ...(deps.pluginRoot !== undefined ? { pluginRoot: deps.pluginRoot } : {}),
  });
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
  deps: WriteDeps,
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
  deps: WriteDeps,
  record: OperationRecord,
  error: AdapterError | AppErrorException,
  options: SettleOptions
): Promise<never> {
  // An AppErrorException is our own verdict (an integrity or allowlist check
  // that ran before anything was sent), already in its final form.
  const app =
    error instanceof AppErrorException
      ? error.appError
      : mapAdapterError(error, phaseOfWrite(error));
  const ids = {
    localRequestId: record.localRequestId,
    localId: record.localId,
  };
  if (app.code === 'JULES_UNKNOWN_OUTCOME') {
    const sessionResource =
      (error instanceof AdapterError ? error.sessionResource : undefined) ??
      record.sessionResource;
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
        `warning: could not mark ${record.localRequestId} unknown-outcome: ${errorLabel(
          markError
        )}\n`
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
  // The vendor's verdict must reach the caller even when the bookkeeping fails.
  // Marking the record and freeing the slot are separate steps with separate
  // failure modes, and the envelope says which one did not land.
  const details: Record<string, unknown> = {};
  let marked = true;
  try {
    await markOperation(
      deps.dataDir,
      record.localRequestId,
      'failed',
      {},
      nowFn(deps)
    );
  } catch (markError) {
    // The record stays `reserved`, which reconcile still resolves.
    marked = false;
    details['journalRecorded'] = false;
    process.stderr.write(
      `warning: could not mark ${record.localRequestId} failed after a rejection: ${errorLabel(markError)}\n`
    );
  }
  if (marked && record.kind === 'create' && record.grantId !== undefined) {
    try {
      await releaseSlotInStore(
        deps.dataDir,
        record.grantId,
        record.localRequestId
      );
    } catch (releaseError) {
      // The record is `failed`, so nothing will retry this: the slot stays held.
      details['slotReleased'] = false;
      process.stderr.write(
        `warning: could not release the grant slot of ${record.localRequestId}: ${errorLabel(releaseError)}\n`
      );
    }
  }
  throw new MutationErrorException(
    Object.keys(details).length > 0
      ? {
          ...app,
          recoveryAction: `${app.recoveryAction} The local bookkeeping did not complete (see details); revoke and rewrite the grant to reclaim a held slot.`,
        }
      : app,
    Object.keys(details).length > 0 ? { ...ids, details } : ids
  );
}

/** Journal persistence failed after a 2xx: the write happened, the record did not land (R16). */
function persistenceUnknown(
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

/**
 * The write was accepted (2xx). Record it; if the local journal write fails the
 * write still happened, so report an unknown outcome — never a failure (R16).
 */
export async function settleAcceptedOrUnknown(
  deps: WriteDeps,
  record: OperationRecord,
  extra: Partial<
    Pick<OperationRecord, 'sessionResource' | 'vendorState' | 'condition'>
  >,
  options: { readonly what: string; readonly reconcileHint: string }
): Promise<void> {
  try {
    await settleAccepted(deps, record, extra);
  } catch (err) {
    process.stderr.write(
      `warning: ${options.what} but the journal write failed: ${errorLabel(
        err
      )}\n`
    );
    throw persistenceUnknown(
      record,
      extra.sessionResource ?? record.sessionResource,
      options.reconcileHint
    );
  }
}

/** Reserved but the deadline passed before anything was sent: a clean failure that frees the guard. */
export function settleExpiredBeforeWrite(
  deps: WriteDeps,
  record: OperationRecord,
  reconcileHint: string
): Promise<never> {
  return settleFailure(
    deps,
    record,
    new AdapterError('timeout', 'deadline expired before the write', {
      dispatched: false,
    }),
    { reconcileHint }
  );
}

/** Grant lookup bound to this controller (R38): every write path starts here. */
export function loadAuthorizedGrant(
  deps: WriteDeps,
  grantId: string
): { readonly grants: GrantsFile; readonly grant: GrantRecord } {
  const ctx = resolveControllerContext(deps);
  const grants = loadGrants(deps.dataDir);
  const grant = requireGrant(grants, grantId);
  assertControllerAuthority(
    ctx.controllerDir,
    deps.dataDir,
    grant.epochRef,
    ctx.controllerId
  );
  return { grants, grant };
}
