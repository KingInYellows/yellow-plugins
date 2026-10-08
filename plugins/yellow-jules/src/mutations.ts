/**
 * The mutating operations: `delegate`, `reply`, `approve`, and `abandon`.
 *
 * Shape of every real write: validate -> require `--grant-id` -> pre-write
 * reads -> the R31 authority critical section (`reserveUnderGrant`) -> ONE
 * POST, never retried -> settle the reservation. A failure after dispatch that
 * is not a clear rejection is JULES_UNKNOWN_OUTCOME with the reservation left
 * in place (R16): nothing here ever relaunches.
 *
 * Every failure envelope echoes `localRequestId` and `localId`
 * (`rethrowWithContext`), so a reservation can always be reconciled.
 */

import * as crypto from 'node:crypto';

import {
  STATUS_PAGE_SIZE,
  compareStamp,
  walkActivities,
  type WalkResult,
} from './activity-walk.js';
import {
  loadGrants,
  releaseGrant,
  updateGrant,
  writeGrants,
} from './authority.js';
import { assertControllerAuthority } from './controller.js';
import {
  DEFAULT_MUTATION_DEADLINE_MS,
  deadlineIn,
  isExpired,
  type Deadline,
} from './deadline.js';
import {
  AdapterError,
  AppErrorException,
  MutationErrorException,
  makeAppError,
  errorLabel,
  rethrowWithContext,
  throwAppError,
} from './errors.js';
import {
  type Attention,
  attentionOf,
  conditionOf,
  nowFn,
  prepare,
  read,
  resolveSessionResource,
  withAdapter,
  type WriteDeps,
  refuseInsideSupervisedSession,
  resolveControllerContext,
  confirmOwner,
  isTerminalCondition,
} from './runtime-support.js';
import {
  applyRetention,
  findBySessionResource,
  isOwningCreate,
  type OwningCreate,
  messageDigest,
  readJournal,
  recordDeviation,
  UNRESOLVED_STATUSES,
  withJournalLock,
  writeJournal,
} from './state.js';
import type { GrantsFile, OperationRecord, SdkAdapter } from './types.js';
import {
  mintLocalId,
  sourceResourceFor,
  validateGrantId,
  validatePlanId,
  validateRef,
  validateRepoInput,
  validateRequestId,
  validateTaskRef,
} from './validate.js';
import {
  confirmationRequired,
  reserveUnderGrant,
  settleAcceptedOrUnknown,
  settleExpiredBeforeWrite,
  settleFailure,
} from './write-gate.js';

const PROMPT_MAX_CHARS = 100_000;
const MESSAGE_MAX_CHARS = 32_000;
const TITLE_MAX_CHARS = 200;
const DERIVED_TITLE_CHARS = 60;
/** `approve`'s re-fetch is bounded by its time budget, not by the 20-page cap. */
const APPROVE_PAGE_CAP = 1000;
const APPROVE_REFETCH_SHARE = 0.4;

const DELEGATE_RECONCILE = 'Run status --reconcile; never relaunch (R16).';
const SESSION_RECONCILE =
  'Run status --session <ref> --reconcile; never resend.';

function mintRequestId(): string {
  return `jr-${crypto.randomBytes(16).toString('hex')}`;
}

function validateText(value: string, label: string, maxChars: number): string {
  if (value.trim().length === 0) {
    return throwAppError('JULES_INVALID_INPUT', `${label} must not be empty`);
  }
  if (value.length > maxChars) {
    return throwAppError(
      'JULES_INVALID_INPUT',
      `${label} must be at most ${maxChars} characters`
    );
  }
  return value;
}

function validateTitle(value: string): string {
  if (value.trim().length === 0 || value.length > TITLE_MAX_CHARS) {
    return throwAppError(
      'JULES_INVALID_INPUT',
      `--title must be 1-${TITLE_MAX_CHARS} characters`
    );
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(value)) {
    return throwAppError(
      'JULES_INVALID_INPUT',
      '--title must not contain control characters'
    );
  }
  if (value.toLowerCase().includes('[yellow:')) {
    return throwAppError(
      'JULES_INVALID_INPUT',
      '--title must not contain the reconcile tag "[yellow:"'
    );
  }
  return value;
}

/** Tag first, so vendor-side truncation cannot strip it (contract `delegate`). */
function vendorTitle(
  localId: string,
  title: string | undefined,
  prompt: string
): string {
  const base = (title ?? prompt.slice(0, DERIVED_TITLE_CHARS * 2))
    .replace(/\s+/g, ' ')
    .replace(/\[yellow:/gi, '[yellow-')
    .trim()
    .slice(0, title !== undefined ? TITLE_MAX_CHARS : DERIVED_TITLE_CHARS)
    .trim();
  return `[yellow:${localId}] ${base.length > 0 ? base : 'yellow-jules task'}`;
}

type Ids = { readonly localRequestId: string; readonly localId: string };

/** A write failure that is not already an AdapterError is, by construction, after dispatch. */
function asWriteError(err: unknown): AdapterError | AppErrorException {
  if (err instanceof AdapterError || err instanceof AppErrorException) {
    return err;
  }
  return new AdapterError(
    'malformed',
    err instanceof Error ? err.message : String(err),
    { cause: err, dispatched: true }
  );
}

function expiredBeforeWrite(): never {
  return throwAppError(
    'JULES_DEADLINE_EXCEEDED',
    'the operation deadline expired before any write was dispatched',
    {
      recoveryAction: 'Nothing was sent. Retry with a larger --deadline-ms.',
    }
  );
}

// ---------------------------------------------------------------------------
// delegate
// ---------------------------------------------------------------------------

export interface DelegateArgs {
  readonly repo: string;
  readonly branch: string;
  readonly prompt: string;
  readonly title?: string;
  readonly taskRef?: string;
  readonly requestId?: string;
  readonly dryRun: boolean;
  readonly grantId?: string;
  /** A repair task (R44): spends a corrective round on `--task-ref` instead of a task. */
  readonly correction: boolean;
  readonly deadlineMs?: number;
}

export interface DelegateResult extends Attention {
  readonly operation: 'delegate';
  readonly localRequestId: string;
  readonly localId: string;
  readonly sessionResource: string;
  /** The state at creation; not re-read. `status` reports the live state. */
  readonly vendorState: string;
  readonly condition: string;
  readonly repository: string;
  readonly requestedBranch: string;
  readonly sourceResource: string;
}

export interface DelegateDryRunResult {
  readonly operation: 'delegate';
  readonly localRequestId: string;
  /** Informational: nothing is reserved, so a real run mints its own. */
  readonly localId: string;
  readonly repository: string;
  readonly requestedBranch: string;
  readonly sourceResource: string;
  readonly taskRef?: string;
  readonly dryRun: true;
}

export async function delegate(
  deps: WriteDeps,
  args: DelegateArgs
): Promise<DelegateResult | DelegateDryRunResult> {
  const localRequestId =
    args.requestId !== undefined
      ? validateRequestId(args.requestId)
      : mintRequestId();
  const localId = mintLocalId();
  try {
    return await delegateInner(deps, args, { localRequestId, localId });
  } catch (err) {
    return rethrowWithContext(err, { localRequestId, localId });
  }
}

async function delegateInner(
  deps: WriteDeps,
  args: DelegateArgs,
  ids: Ids
): Promise<DelegateResult | DelegateDryRunResult> {
  const repo = validateRepoInput(args.repo);
  const repository = `${repo.owner}/${repo.repo}`;
  const branch = validateRef(args.branch);
  const prompt = validateText(args.prompt, '--prompt', PROMPT_MAX_CHARS);
  const title =
    args.title !== undefined ? validateTitle(args.title) : undefined;
  const taskRef =
    args.taskRef !== undefined ? validateTaskRef(args.taskRef) : undefined;
  if (taskRef === undefined) {
    throwAppError(
      'JULES_INVALID_INPUT',
      args.correction
        ? '--correction needs the --task-ref of the task being repaired (R44)'
        : 'a delegate needs --task-ref: grants cover named tasks only'
    );
  }
  prepare(deps);
  const deadline = deadlineIn(
    deps.clock,
    args.deadlineMs ?? DEFAULT_MUTATION_DEADLINE_MS
  );
  const sourceResource = sourceResourceFor(repo);

  if (!args.dryRun && args.grantId === undefined) {
    throw confirmationRequired(
      deps,
      {
        operation: 'create',
        repository,
        requestedBranch: branch,
        ...(taskRef !== undefined ? { taskRef } : {}),
      },
      ids
    );
  }
  const grantId =
    args.grantId !== undefined ? validateGrantId(args.grantId) : undefined;

  return withAdapter(deps, async (adapter) => {
    // R17: the source is discovered, never synthesized.
    const source = await read(deps, deadline, () =>
      adapter.getSource(repo.owner, repo.repo)
    );
    if (source.sourceResource !== sourceResource) {
      return throwAppError(
        'JULES_SOURCE_ACCESS',
        'the discovered source does not match the requested repository'
      );
    }
    if (args.dryRun || grantId === undefined) {
      return {
        operation: 'delegate' as const,
        localRequestId: ids.localRequestId,
        localId: ids.localId,
        repository,
        requestedBranch: branch,
        sourceResource,
        ...(taskRef !== undefined ? { taskRef } : {}),
        dryRun: true as const,
      };
    }
    if (isExpired(deps.clock, deadline)) return expiredBeforeWrite();

    const reservation = await reserveUnderGrant(deps, {
      grantId,
      authority: {
        repository,
        sourceResource,
        branch,
        ...(taskRef !== undefined ? { taskRef } : {}),
        operation: 'create',
        correction: args.correction,
      },
      reservation: {
        localRequestId: ids.localRequestId,
        localId: ids.localId,
        autoPrRequested: false,
        promptDigest: messageDigest(prompt),
      },
    });

    if (isExpired(deps.clock, deadline)) {
      return settleExpiredBeforeWrite(deps, reservation, DELEGATE_RECONCILE);
    }

    let created;
    try {
      created = await adapter.createSession({
        prompt,
        owner: repo.owner,
        repo: repo.repo,
        baseBranch: branch,
        title: vendorTitle(ids.localId, title, prompt),
      });
    } catch (err) {
      return settleFailure(deps, reservation, asWriteError(err), {
        reconcileHint: DELEGATE_RECONCILE,
      });
    }

    const vendorState = 'queued';
    await settleAcceptedOrUnknown(
      deps,
      reservation,
      {
        sessionResource: created.sessionResource,
        vendorState,
        condition: conditionOf(vendorState),
      },
      { what: 'session created', reconcileHint: DELEGATE_RECONCILE }
    );
    return {
      operation: 'delegate' as const,
      localRequestId: ids.localRequestId,
      localId: ids.localId,
      sessionResource: created.sessionResource,
      vendorState,
      condition: conditionOf(vendorState),
      repository,
      requestedBranch: branch,
      sourceResource,
    };
  });
}

// ---------------------------------------------------------------------------
// shared: the session a reply or approve targets
// ---------------------------------------------------------------------------

interface SessionTarget {
  readonly sessionResource: string;
  /** The yellow-created record that owns the session; its repo, branch and task scope the grant. */
  readonly owner: OperationRecord | undefined;
}

async function resolveTarget(
  deps: WriteDeps,
  sessionRef: string
): Promise<SessionTarget> {
  const journal = await readJournal(deps.dataDir);
  const sessionResource = resolveSessionResource(journal, sessionRef);
  return {
    sessionResource,
    owner: findBySessionResource(journal, sessionResource),
  };
}

/** Grants cover sessions created through this plugin; anything else has no repo, branch or task to match. */
function requireOwner(target: SessionTarget, ids: Ids): OwningCreate {
  if (!isOwningCreate(target.owner)) {
    throw new MutationErrorException(
      makeAppError(
        'JULES_AUTHORITY_DENIED',
        `${target.sessionResource} was not created through this plugin, so no grant can cover it`,
        {
          recoveryAction:
            'Grants cover sessions created by delegate. Act on this session in the Jules console.',
        }
      ),
      ids
    );
  }
  return target.owner;
}

// ---------------------------------------------------------------------------
// reply
// ---------------------------------------------------------------------------

export interface ReplyArgs {
  readonly session: string;
  readonly message: string;
  readonly requestId?: string;
  readonly dryRun: boolean;
  readonly grantId?: string;
  /** A corrective message (R44): spends one corrective round on the session's task. */
  readonly correction: boolean;
  readonly deadlineMs?: number;
}

export interface ReplyResult {
  readonly operation: 'reply';
  readonly localRequestId: string;
  readonly localId: string;
  readonly sessionResource: string;
  readonly sent: boolean;
  readonly dryRun?: true;
  /** Dry run only: the scope a covering grant must match. */
  readonly repository?: string;
  readonly requestedBranch?: string;
  readonly taskRef?: string;
}

/** The repository, branch and task a grant must cover, when this plugin created the session. */
function scopeOf(target: SessionTarget): {
  repository?: string;
  requestedBranch?: string;
  taskRef?: string;
} {
  const owner = target.owner;
  return {
    ...(owner?.repository !== undefined
      ? { repository: owner.repository }
      : {}),
    ...(owner?.requestedBranch !== undefined
      ? { requestedBranch: owner.requestedBranch }
      : {}),
    ...(owner?.taskRef !== undefined ? { taskRef: owner.taskRef } : {}),
  };
}

export async function reply(
  deps: WriteDeps,
  args: ReplyArgs
): Promise<ReplyResult> {
  const localRequestId =
    args.requestId !== undefined
      ? validateRequestId(args.requestId)
      : mintRequestId();
  const localId = mintLocalId();
  try {
    return await replyInner(deps, args, { localRequestId, localId });
  } catch (err) {
    return rethrowWithContext(err, { localRequestId, localId });
  }
}

async function replyInner(
  deps: WriteDeps,
  args: ReplyArgs,
  ids: Ids
): Promise<ReplyResult> {
  const message = validateText(args.message, '--message', MESSAGE_MAX_CHARS);
  prepare(deps);
  const deadline = deadlineIn(
    deps.clock,
    args.deadlineMs ?? DEFAULT_MUTATION_DEADLINE_MS
  );
  const target = await resolveTarget(deps, args.session);

  if (!args.dryRun && args.grantId === undefined) {
    throw confirmationRequired(
      deps,
      { operation: 'reply', ...scopeOf(target) },
      ids
    );
  }

  return withAdapter(deps, async (adapter) => {
    if (args.dryRun) {
      await read(deps, deadline, () =>
        adapter.getSession(target.sessionResource)
      );
      return {
        operation: 'reply' as const,
        localRequestId: ids.localRequestId,
        localId: ids.localId,
        sessionResource: target.sessionResource,
        sent: false,
        dryRun: true as const,
        ...scopeOf(target),
      };
    }
    const grantId = validateGrantId(args.grantId);
    const owner = requireOwner(target, ids);
    // A reply to a finished session would reopen it, past the active-session
    // limit that freed its slot. A repair is a new delegate instead.
    if (isTerminalCondition(owner.condition)) {
      throw new MutationErrorException(
        makeAppError(
          'JULES_INVALID_STATE',
          `the session is ${owner.condition}; a reply does not reopen a finished session`,
          {
            recoveryAction:
              'For a repair, run delegate with --correction and the same --task-ref.',
          }
        ),
        ids
      );
    }
    if (isExpired(deps.clock, deadline)) return expiredBeforeWrite();

    const reservation = await reserveUnderGrant(deps, {
      grantId,
      ownerRequestId: owner.localRequestId,
      authority: {
        repository: owner.repository,
        sourceResource: owner.sourceResource,
        branch: owner.requestedBranch,
        ...(owner.taskRef !== undefined ? { taskRef: owner.taskRef } : {}),
        operation: 'reply',
        correction: args.correction,
      },
      reservation: {
        localRequestId: ids.localRequestId,
        localId: ids.localId,
        sessionResource: target.sessionResource,
        promptDigest: messageDigest(message),
      },
    });

    if (isExpired(deps.clock, deadline)) {
      return settleExpiredBeforeWrite(deps, reservation, SESSION_RECONCILE);
    }
    try {
      await adapter.sendMessage(target.sessionResource, message);
    } catch (err) {
      return settleFailure(deps, reservation, asWriteError(err), {
        reconcileHint: SESSION_RECONCILE,
      });
    }
    await settleAcceptedOrUnknown(
      deps,
      reservation,
      { sessionResource: target.sessionResource },
      { what: 'message sent', reconcileHint: SESSION_RECONCILE }
    );
    return {
      operation: 'reply' as const,
      localRequestId: ids.localRequestId,
      localId: ids.localId,
      sessionResource: target.sessionResource,
      sent: true,
    };
  });
}

// ---------------------------------------------------------------------------
// approve
// ---------------------------------------------------------------------------

export interface ApproveArgs {
  readonly session: string;
  readonly planId: string;
  readonly requestId?: string;
  readonly dryRun: boolean;
  readonly grantId?: string;
  readonly deadlineMs?: number;
}

export interface ApproveDryRunResult extends Attention {
  readonly operation: 'approve';
  readonly localRequestId: string;
  readonly localId: string;
  readonly sessionResource: string;
  readonly dryRun: true;
  /** The plan id a confirmation binds to. */
  readonly observedPlanId: string;
  /** The scope a covering grant must match. */
  readonly repository?: string;
  readonly requestedBranch?: string;
  readonly taskRef?: string;
}

export interface ApproveResult extends Attention {
  readonly operation: 'approve';
  readonly localRequestId: string;
  readonly localId: string;
  readonly sessionResource: string;
  readonly approvedPlanId: string;
  readonly observedPlanIdAfter: string | null;
  readonly verificationDeferred: boolean;
  readonly verification: {
    readonly pages: number;
    readonly partialPagination: boolean;
  };
  readonly policyDeviation?: true;
}

function incompleteRefetch(walk: WalkResult): never {
  const cause =
    walk.stopReason === 'unmapped'
      ? 'an activity the SDK mapper cannot parse'
      : walk.stopReason === 'page-failure'
        ? 'a page failure'
        : 'the time or page budget';
  const recoveryAction =
    walk.stopReason === 'unmapped'
      ? 'Re-verify the SDK pin with /jules:setup; a larger deadline will not help.'
      : walk.stopReason === 'page-failure'
        ? 'Retry; if it repeats, run status.'
        : 'Retry with a larger --deadline-ms.';
  return throwAppError(
    'JULES_INVALID_STATE',
    `the pending plan could not be completely re-read (${cause}); nothing was approved`,
    { recoveryAction }
  );
}

/**
 * R34. The vendor's approve endpoint takes NO plan id: it approves whatever
 * plan is pending when the POST lands. Comparing `--plan-id` with a fresh,
 * complete re-fetch immediately before the POST therefore narrows the race but
 * cannot close it — compare-and-approve is not atomic. The post-POST re-read
 * records a deviation (R34) when the plan that was actually approved differs.
 */
export async function approve(
  deps: WriteDeps,
  args: ApproveArgs
): Promise<ApproveResult | ApproveDryRunResult> {
  const localRequestId =
    args.requestId !== undefined
      ? validateRequestId(args.requestId)
      : mintRequestId();
  const localId = mintLocalId();
  try {
    return await approveInner(deps, args, { localRequestId, localId });
  } catch (err) {
    return rethrowWithContext(err, { localRequestId, localId });
  }
}

async function approveInner(
  deps: WriteDeps,
  args: ApproveArgs,
  ids: Ids
): Promise<ApproveResult | ApproveDryRunResult> {
  const planId = validatePlanId(args.planId, 'input');
  prepare(deps);
  const totalMs = args.deadlineMs ?? DEFAULT_MUTATION_DEADLINE_MS;
  const deadline = deadlineIn(deps.clock, totalMs);
  const target = await resolveTarget(deps, args.session);

  if (!args.dryRun && args.grantId === undefined) {
    throw confirmationRequired(
      deps,
      { operation: 'approve', ...scopeOf(target) },
      ids
    );
  }
  const pending = target.owner?.pendingPlan;
  if (pending === undefined) {
    return throwAppError(
      'JULES_INVALID_STATE',
      'no pending plan is recorded for this session',
      { recoveryAction: 'Run status for this session, then retry.' }
    );
  }
  const start = {
    kind: 'watermark' as const,
    createTime: pending.activityCreateTime,
    activityId: pending.activityId,
  };

  return withAdapter(deps, async (adapter) => {
    const session = await read(deps, deadline, () =>
      adapter.getSession(target.sessionResource)
    );
    if (session.vendorState !== 'awaitingPlanApproval') {
      return throwAppError(
        'JULES_INVALID_STATE',
        `the session is ${conditionOf(session.vendorState)}, not awaiting plan approval`
      );
    }
    // A real call re-fetches inside 40% of the deadline; a dry run may use it all.
    const refetchDeadline: Deadline = args.dryRun
      ? deadline
      : deadlineIn(deps.clock, Math.floor(totalMs * APPROVE_REFETCH_SHARE));
    const refetch = await walkActivities({
      adapter,
      sessionResource: target.sessionResource,
      pageSize: STATUS_PAGE_SIZE,
      start,
      clock: deps.clock,
      deadline: refetchDeadline,
      pageCap: APPROVE_PAGE_CAP,
    });
    if (!refetch.complete) return incompleteRefetch(refetch);
    const newest = refetch.pendingPlan;
    if (newest === null || newest === undefined) {
      return throwAppError(
        'JULES_INVALID_STATE',
        'the vendor shows no pending plan for this session',
        { recoveryAction: 'Run status for this session, then retry.' }
      );
    }

    if (args.dryRun) {
      const changed = newest.planId !== planId;
      return {
        operation: 'approve' as const,
        localRequestId: ids.localRequestId,
        localId: ids.localId,
        sessionResource: target.sessionResource,
        dryRun: true as const,
        observedPlanId: newest.planId,
        ...scopeOf(target),
        ...attentionOf(changed ? ['planChanged'] : []),
      };
    }
    if (newest.planId !== planId) {
      return throwAppError(
        'JULES_POLICY_DEVIATION',
        'the newest pending plan differs from the evaluated --plan-id; nothing was approved',
        {
          recoveryAction:
            'Run status, evaluate the new plan, and approve that plan id.',
        }
      );
    }

    const grantId = validateGrantId(args.grantId);
    const owner = requireOwner(target, ids);
    if (isExpired(deps.clock, deadline)) return expiredBeforeWrite();

    const reservation = await reserveUnderGrant(deps, {
      grantId,
      ownerRequestId: owner.localRequestId,
      authority: {
        repository: owner.repository,
        sourceResource: owner.sourceResource,
        branch: owner.requestedBranch,
        ...(owner.taskRef !== undefined ? { taskRef: owner.taskRef } : {}),
        operation: 'approve',
      },
      reservation: {
        localRequestId: ids.localRequestId,
        localId: ids.localId,
        sessionResource: target.sessionResource,
        observedPlanId: planId,
      },
    });

    if (isExpired(deps.clock, deadline)) {
      return settleExpiredBeforeWrite(deps, reservation, SESSION_RECONCILE);
    }

    try {
      await adapter.approvePlan(target.sessionResource);
    } catch (err) {
      return settleFailure(deps, reservation, asWriteError(err), {
        reconcileHint: SESSION_RECONCILE,
      });
    }
    await settleAcceptedOrUnknown(
      deps,
      reservation,
      { sessionResource: target.sessionResource },
      { what: 'plan approved', reconcileHint: SESSION_RECONCILE }
    );

    // The POST was answered 2xx. Everything below is verification and can never
    // turn the success into a failure envelope.
    const verified = await verifyApproval(
      deps,
      adapter,
      target.sessionResource,
      start,
      deadline
    );
    let deviated = false;
    let deviationUnrecorded = false;
    if (
      verified.observedPlanIdAfter !== null &&
      verified.observedPlanIdAfter !== planId &&
      target.owner !== undefined
    ) {
      deviated = true;
      try {
        await recordDeviation(
          deps.dataDir,
          target.owner.localRequestId,
          {
            kind: 'policy-deviation',
            reason:
              'the plan approved by the vendor differs from the plan evaluated before approval',
          },
          nowFn(deps)
        );
      } catch (err) {
        // The approval already happened; never turn it into a failure envelope.
        // The deviation is still reported, with the missed bookkeeping flagged.
        deviationUnrecorded = true;
        process.stderr.write(
          `warning: plan approved but the deviation could not be recorded: ${errorLabel(
            err
          )}\n`
        );
      }
    }
    return {
      operation: 'approve' as const,
      localRequestId: ids.localRequestId,
      localId: ids.localId,
      sessionResource: target.sessionResource,
      approvedPlanId: planId,
      observedPlanIdAfter: verified.observedPlanIdAfter,
      verificationDeferred: verified.deferred,
      verification: {
        pages: verified.pages,
        partialPagination: verified.partial,
      },
      ...(deviated ? { policyDeviation: true as const } : {}),
      ...attentionOf([
        ...(verified.deferred ? ['verificationDeferred'] : []),
        ...(deviated ? ['policyDeviation'] : []),
        ...(deviationUnrecorded ? ['deviationUnrecorded'] : []),
      ]),
    };
  });
}

interface Verification {
  readonly observedPlanIdAfter: string | null;
  readonly deferred: boolean;
  readonly partial: boolean;
  readonly pages: number;
}

/** Post-POST re-read from the same start: which plan did the vendor record as approved? */
async function verifyApproval(
  deps: WriteDeps,
  adapter: SdkAdapter,
  sessionResource: string,
  start: {
    readonly kind: 'watermark';
    readonly createTime: string;
    readonly activityId: string;
  },
  deadline: Deadline
): Promise<Verification> {
  let approvedPlanId: string | undefined;
  let approvedStamp: { createTime: string; activityId: string } | undefined;
  try {
    const walk = await walkActivities({
      adapter,
      sessionResource,
      pageSize: STATUS_PAGE_SIZE,
      start,
      clock: deps.clock,
      deadline,
      pageCap: APPROVE_PAGE_CAP,
      onActivity: (activity) => {
        if (
          activity.type === 'planApproved' &&
          activity.approvedPlanId !== undefined &&
          compareStamp(activity, start) > 0 &&
          (approvedStamp === undefined ||
            compareStamp(activity, approvedStamp) > 0)
        ) {
          approvedStamp = {
            createTime: activity.createTime,
            activityId: activity.activityId,
          };
          approvedPlanId = activity.approvedPlanId;
        }
      },
    });
    const observed = approvedPlanId ?? null;
    return {
      observedPlanIdAfter: observed,
      // A partial read, or a complete one that has not yet seen the approval, cannot confirm.
      deferred: !walk.complete || observed === null,
      partial: walk.partialPagination,
      pages: walk.pages,
    };
  } catch (err) {
    // The approval already happened: whatever broke here, verification is
    // deferred, never a failure envelope. The label says why.
    process.stderr.write(
      `warning: plan approved but verification could not complete: ${errorLabel(err)}\n`
    );
    return {
      observedPlanIdAfter: null,
      deferred: true,
      partial: true,
      pages: 0,
    };
  }
}

// ---------------------------------------------------------------------------
// abandon
// ---------------------------------------------------------------------------

export interface AbandonArgs {
  readonly requestId: string;
}

export interface AbandonResult {
  readonly operation: 'abandon';
  readonly localRequestId: string;
  readonly localId: string;
  readonly abandoned: true;
  readonly released: {
    readonly grantId?: string;
    readonly slotReleased: boolean;
  };
}

function abandonable(
  record: OperationRecord | undefined,
  id: string
): OperationRecord {
  if (record === undefined) {
    return throwAppError('JULES_NOT_FOUND', `no journal record for ${id}`);
  }
  const outcome = record.lastReconcile?.outcome;
  // A reply or approve has no sessions walk to settle it: a complete walk that
  // finds no match leaves `unknown-outcome` for good, so that outcome qualifies
  // for it (a create is settled by `released`, never by this).
  const stuck =
    (record.kind === 'reply' || record.kind === 'approve') &&
    outcome === 'unknown-outcome';
  if (
    !UNRESOLVED_STATUSES.has(record.status) ||
    (outcome !== 'ambiguous-reconcile' && outcome !== 'not-reached' && !stuck)
  ) {
    return throwAppError(
      'JULES_INVALID_STATE',
      `${id} cannot be abandoned: only an unresolved operation whose last reconcile was ambiguous-reconcile or not-reached (or, for a reply or approve, unknown-outcome) qualifies`,
      { recoveryAction: 'Run status --reconcile first.' }
    );
  }
  return record;
}

/**
 * Marks a reservation reconcile could not settle terminal `failed` (R36's
 * escape hatch). It widens effective authority — it frees the repository and
 * branch guard and an active-session slot — so it is TTY-confirmed, never
 * grant-confirmed.
 */
export async function abandon(
  deps: WriteDeps,
  args: AbandonArgs
): Promise<AbandonResult> {
  refuseInsideSupervisedSession(deps.env, 'abandon');
  const requestId = validateRequestId(args.requestId);
  prepare(deps);
  const first = abandonable(
    (await readJournal(deps.dataDir)).operations[requestId],
    requestId
  );
  const reason = [
    first.lastReconcile?.outcome ?? 'unresolved',
    ...(first.lastReconcile?.reason !== undefined
      ? [first.lastReconcile.reason]
      : []),
  ].join(': ');

  await confirmOwner(
    deps,
    [
      'yellow-jules: ABANDON OPERATION',
      `  request id:  ${first.localRequestId}`,
      `  kind:        ${first.kind}`,
      `  repository:  ${first.repository ?? '(none)'}`,
      `  branch:      ${first.requestedBranch ?? '(none)'}`,
      `  reconcile:   ${reason}`,
      '',
      'The vendor may still hold a session for this operation. Abandoning frees the',
      'repository/branch guard and the grant slot so a new delegate can run.',
    ].join('\n')
  );

  const ctx = resolveControllerContext(deps);
  return withJournalLock(deps.dataDir, async () => {
    const journal = await readJournal(deps.dataDir);
    // Re-check under the lock: the record may have been reconciled while the owner typed.
    const record = abandonable(journal.operations[requestId], requestId);
    // Every check that can refuse runs BEFORE the first write, so a refusal
    // leaves the record exactly as it was. A grant that no longer exists holds
    // no slot, but one that does must still be bound to this controller.
    let grants: GrantsFile | undefined;
    let grantId: string | undefined;
    if (record.kind === 'create' && record.grantId !== undefined) {
      const loaded = loadGrants(deps.dataDir);
      const grant = loaded.grants[record.grantId];
      if (grant !== undefined) {
        assertControllerAuthority(
          ctx.controllerDir,
          deps.dataDir,
          grant.epochRef,
          ctx.controllerId
        );
        if (grant.usage.activeSessionRefs.includes(record.localRequestId)) {
          grants = loaded;
          grantId = grant.grantId;
        }
      }
    }
    const now = nowFn(deps)().toISOString();
    journal.operations[requestId] = applyRetention({
      ...record,
      status: 'failed',
      abandonedAt: now,
      abandonReason: reason,
      updatedAt: now,
    });
    await writeJournal(deps.dataDir, journal, [requestId]);
    // Journal first: a crash before the next line leaks a slot, which only
    // makes the grant stricter.
    let slotReleased = false;
    if (grants !== undefined && grantId !== undefined) {
      try {
        writeGrants(
          deps.dataDir,
          updateGrant(grants, grantId, (g) =>
            releaseGrant(g, record.localRequestId)
          )
        );
        slotReleased = true;
      } catch (err) {
        // The abandon already took effect; report it with the slot still held
        // instead of an error a retry could not act on.
        process.stderr.write(
          `warning: abandoned ${record.localRequestId} but could not release its grant slot: ${errorLabel(err)}\n`
        );
      }
    }
    return {
      operation: 'abandon' as const,
      localRequestId: record.localRequestId,
      localId: record.localId,
      abandoned: true as const,
      released: {
        ...(record.grantId !== undefined ? { grantId: record.grantId } : {}),
        slotReleased,
      },
    };
  });
}
