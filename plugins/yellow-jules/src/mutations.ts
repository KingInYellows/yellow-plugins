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
import { HIDDEN_CHARS_RE, redact, redactDeep } from './redact.js';
import {
  type Attention,
  attentionOf,
  conditionOf,
  nowFn,
  prepare,
  read,
  resolveSessionResource,
  withMutationAdapter,
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
  planDigest,
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
  assertGrantLiveBeforeWrite,
  type VendorFloor,
  plainLaunchGrantIds,
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
  /**
   * With `requestId`: advance past earlier attempts that ended in a clean
   * `failed` record (no session was created) by suffixing `.a<N>`, N = prior
   * failed attempts + 1. A reserved, accepted, unknown-outcome or otherwise
   * non-failed record still collides, so the same in-flight attempt is never
   * relaunched.
   */
  readonly retryFailed?: boolean;
  readonly deadlineMs?: number;
}

/** Cap on chained retries so a runaway journal cannot grow the id without bound. */
const MAX_RETRY_ATTEMPTS = 50;

async function nextAttemptRequestId(
  deps: WriteDeps,
  base: string
): Promise<string> {
  // Location rules first: reading the journal creates the state directory.
  prepare(deps);
  const { operations } = await readJournal(deps.dataDir);
  let candidate = base;
  for (let attempt = 2; attempt <= MAX_RETRY_ATTEMPTS; attempt += 1) {
    const record = operations[candidate];
    if (
      record === undefined ||
      record.kind !== 'create' ||
      record.status !== 'failed' ||
      record.sessionResource !== undefined
    ) {
      break;
    }
    candidate = `${base}.a${attempt}`;
  }
  return validateRequestId(candidate);
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
  /** For a `--correction` dry run: the grants that own a plain launch of this task; a repair runs under one of them. */
  readonly launchGrantIds?: readonly string[];
  readonly dryRun: true;
}

export async function delegate(
  deps: WriteDeps,
  args: DelegateArgs
): Promise<DelegateResult | DelegateDryRunResult> {
  const requested =
    args.requestId !== undefined
      ? validateRequestId(args.requestId)
      : undefined;
  const localRequestId =
    requested === undefined
      ? mintRequestId()
      : args.retryFailed === true
        ? await nextAttemptRequestId(deps, requested)
        : requested;
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

  return withMutationAdapter(deps, async (adapter) => {
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
        ...(args.correction
          ? {
              launchGrantIds: plainLaunchGrantIds(
                await readJournal(deps.dataDir),
                taskRef
              ),
            }
          : {}),
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

    await assertGrantLiveBeforeWrite(deps, reservation, DELEGATE_RECONCILE);
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
  /**
   * Both or neither. The reply is refused with `JULES_QUESTION_CHANGED` unless
   * the session still awaits a reply and its newest agent message has this
   * activity id and message digest (the `supervise` `needs-answer` values).
   */
  readonly expectActivityId?: string;
  readonly expectQuestionDigest?: string;
  /**
   * Both or neither, and not with the question pair. Same refusal, for a reply
   * written while a plan is under review (the `needs-plan-review` values).
   */
  readonly expectPlanId?: string;
  readonly expectPlanDigest?: string;
  /**
   * What the caller says this reply answers. `question` and `plan` require the
   * matching expectation pair (a supervised reply must not drop it); `other`
   * refuses any expectation. Absent: the pairs are optional, as for a direct
   * reply.
   */
  readonly replyKind?: 'question' | 'plan' | 'other';
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

function validateExpectedQuestion(
  args: Pick<ReplyArgs, 'expectActivityId' | 'expectQuestionDigest'>
): { readonly activityId: string; readonly digest: string } | undefined {
  const { expectActivityId: id, expectQuestionDigest: digest } = args;
  if (id === undefined && digest === undefined) return undefined;
  if (id === undefined || digest === undefined) {
    return throwAppError(
      'JULES_INVALID_INPUT',
      '--expect-activity-id and --expect-question-digest must be given together'
    );
  }
  const hasControl = [...id].some((c) => {
    const code = c.charCodeAt(0);
    return code < 32 || code === 127;
  });
  if (id.length === 0 || id.length > 512 || hasControl) {
    return throwAppError(
      'JULES_INVALID_INPUT',
      '--expect-activity-id must be a non-empty activity id'
    );
  }
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    return throwAppError(
      'JULES_INVALID_INPUT',
      '--expect-question-digest must be 64 lowercase hex characters'
    );
  }
  return { activityId: id, digest };
}

/**
 * Refuses a reply unless the session still awaits one and its newest agent
 * message is the question the caller evaluated. A fresh, complete read right
 * before the reservation: like approve's plan check it narrows the race but the
 * POST cannot be made atomic with it.
 */
async function assertQuestionStillOpen(
  deps: WriteDeps,
  adapter: SdkAdapter,
  sessionResource: string,
  liveCondition: string,
  expected: { readonly activityId: string; readonly digest: string },
  deadline: Deadline
): Promise<void> {
  const changed = (why: string): never =>
    throwAppError('JULES_QUESTION_CHANGED', `${why}; nothing was sent`);
  if (liveCondition !== 'awaiting-reply') {
    return changed(`the session is ${liveCondition}, not awaiting a reply`);
  }
  let newest:
    | { activityId: string; createTime: string; message?: string }
    | undefined;
  const userMessages: Array<{ activityId: string; createTime: string }> = [];
  const agentMessages: Array<{ createTime: string; digest: string }> = [];
  const walk = await walkActivities({
    adapter,
    sessionResource,
    pageSize: STATUS_PAGE_SIZE,
    start: { kind: 'session-start' },
    clock: deps.clock,
    deadline,
    pageCap: APPROVE_PAGE_CAP,
    onActivity: (activity) => {
      if (activity.type === 'userMessaged') {
        userMessages.push({
          activityId: activity.activityId,
          createTime: activity.createTime,
        });
      }
      if (activity.type === 'agentMessaged') {
        agentMessages.push({
          createTime: activity.createTime,
          digest: messageDigest(activity.message ?? ''),
        });
      }
      if (
        activity.type === 'agentMessaged' &&
        (newest === undefined || compareStamp(activity, newest) > 0)
      ) {
        newest = {
          activityId: activity.activityId,
          createTime: activity.createTime,
          ...(activity.message !== undefined
            ? { message: activity.message }
            : {}),
        };
      }
    },
  });
  if (!walk.complete) {
    return throwAppError(
      'JULES_INVALID_STATE',
      'the session activity could not be completely re-read; nothing was sent',
      { recoveryAction: 'Retry with a larger --deadline-ms.' }
    );
  }
  if (newestPlanAmbiguous(agentMessages)) {
    return changed(
      'two different questions share the newest timestamp, so the current one cannot be told'
    );
  }
  const current = newest as
    | { activityId: string; createTime: string; message?: string }
    | undefined;
  // The review saw the redacted question; an answer to text redaction hid
  // cannot be bound to what was shown.
  if (
    current?.message !== undefined &&
    redact(current.message) !== current.message
  ) {
    throwAppError(
      'JULES_INVALID_STATE',
      'the pending question contains credential-shaped text that is redacted from the review; it cannot be answered unseen. Nothing was sent',
      {
        recoveryAction:
          'Read the question in the Jules console and answer it there.',
      }
    );
  }
  if (
    current === undefined ||
    current.message === undefined ||
    current.activityId !== expected.activityId ||
    messageDigest(current.message) !== expected.digest
  ) {
    return changed('the session no longer awaits the question the pass showed');
  }
  if (
    await hasUnclaimedUserMessage(deps, sessionResource, userMessages, current)
  ) {
    return changed(
      'a user message arrived after the question and was not sent by this plugin'
    );
  }
}

/**
 * True when a user message newer than `after` is not one of this plugin's
 * claimed echoes: someone else is steering the session. A complete re-read does
 * not classify it, so the write fails closed and the next `status` records it.
 */
async function hasUnclaimedUserMessage(
  deps: WriteDeps,
  sessionResource: string,
  userMessages: ReadonlyArray<{ activityId: string; createTime: string }>,
  after: { activityId: string; createTime: string }
): Promise<boolean> {
  const claimed = new Set(
    // Activity ids carry no session, so only this session's claims count.
    Object.values((await readJournal(deps.dataDir)).operations).flatMap((r) =>
      r.echoActivityId !== undefined && r.sessionResource === sessionResource
        ? [r.echoActivityId]
        : []
    )
  );
  // Freshness check: opaque activity ids carry no order, so a message at the
  // same createTime as `after` may be later. Equal time counts as after.
  return userMessages.some(
    (u) => !claimed.has(u.activityId) && !stampBefore(u, after)
  );
}

/** Strictly earlier by createTime alone; equal time is never "before". */
function stampBefore(
  a: { readonly createTime: string },
  b: { readonly createTime: string }
): boolean {
  return (
    compareStamp(
      { createTime: a.createTime, activityId: '' },
      { createTime: b.createTime, activityId: '' }
    ) < 0
  );
}

/** Refusal when the pre-dispatch floor could not be read: nothing was sent. */
function floorUnreadable(): AppErrorException {
  return new AppErrorException(
    makeAppError(
      'JULES_SERVICE_UNAVAILABLE',
      "the session's activity could not be completely read before the write, so its echo could never be ordered; nothing was sent",
      { recoveryAction: 'Retry the write; no request was dispatched.' }
    )
  );
}

/**
 * Reads the session's newest activity right before a reply or approve is sent,
 * so a later echo can be ordered against the dispatch on the vendor's clock
 * alone. Starts from the owner's stored status watermark when there is one. A
 * failed or partial read yields no floor, and the caller refuses the write
 * before the POST rather than send one whose echo could never bind.
 */
async function readVendorFloor(
  deps: WriteDeps,
  adapter: SdkAdapter,
  sessionResource: string,
  owner: OperationRecord,
  deadline: Deadline
): Promise<VendorFloor | undefined> {
  const stored =
    owner.lastActivityCreateTime !== undefined &&
    owner.lastActivityId !== undefined
      ? {
          createTime: owner.lastActivityCreateTime,
          activityId: owner.lastActivityId,
        }
      : undefined;
  try {
    const walk = await walkActivities({
      adapter,
      sessionResource,
      pageSize: STATUS_PAGE_SIZE,
      start:
        stored !== undefined
          ? { kind: 'watermark' as const, ...stored }
          : { kind: 'session-start' as const },
      clock: deps.clock,
      deadline,
      pageCap: APPROVE_PAGE_CAP,
    });
    if (!walk.complete) return undefined;
    const newest =
      walk.newest !== undefined &&
      (stored === undefined || compareStamp(walk.newest, stored) > 0)
        ? walk.newest
        : stored;
    return newest ?? 'empty';
  } catch {
    return undefined;
  }
}

/**
 * True when more than one plan with differing digests shares the newest
 * createTime: which one is current is unknowable from opaque ids, so the
 * caller refuses rather than pick one by id order.
 */
function newestPlanAmbiguous(
  plans: ReadonlyArray<{ createTime: string; digest: string }>
): boolean {
  let newest: { createTime: string } | undefined;
  for (const p of plans) {
    if (newest === undefined || stampBefore(newest, p)) newest = p;
  }
  if (newest === undefined) return false;
  const top = newest;
  return (
    new Set(plans.filter((p) => !stampBefore(p, top)).map((p) => p.digest))
      .size > 1
  );
}

function validateExpectedPlan(
  args: Pick<ReplyArgs, 'expectPlanId' | 'expectPlanDigest'>,
  haveQuestion: boolean
): { readonly planId: string; readonly digest: string } | undefined {
  const { expectPlanId: id, expectPlanDigest: digest } = args;
  if (id === undefined && digest === undefined) return undefined;
  if (id === undefined || digest === undefined) {
    return throwAppError(
      'JULES_INVALID_INPUT',
      '--expect-plan-id and --expect-plan-digest must be given together'
    );
  }
  if (haveQuestion) {
    return throwAppError(
      'JULES_INVALID_INPUT',
      'a reply expects either a question or a plan, not both'
    );
  }
  const planId = validatePlanId(id, 'input');
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    return throwAppError(
      'JULES_INVALID_INPUT',
      '--expect-plan-digest must be 64 lowercase hex characters'
    );
  }
  return { planId, digest };
}

/**
 * Refuses a reply unless the session still awaits plan approval and its newest
 * pending plan is the one the caller reviewed (id and digest). Same shape and
 * the same race limit as `assertQuestionStillOpen`.
 */
async function assertPlanStillPending(
  deps: WriteDeps,
  adapter: SdkAdapter,
  target: {
    readonly sessionResource: string;
    readonly owner?: OperationRecord;
  },
  liveCondition: string,
  expected: { readonly planId: string; readonly digest: string },
  deadline: Deadline
): Promise<void> {
  const changed = (why: string): never =>
    throwAppError('JULES_QUESTION_CHANGED', `${why}; nothing was sent`);
  if (liveCondition !== 'awaiting-approval') {
    return changed(
      `the session is ${liveCondition}, not awaiting plan approval`
    );
  }
  const pending = target.owner?.pendingPlan;
  if (pending === undefined) {
    return changed('no pending plan is recorded for this session');
  }
  const userMessages: Array<{ activityId: string; createTime: string }> = [];
  const plans: Array<{ createTime: string; digest: string }> = [];
  const walk = await walkActivities({
    adapter,
    sessionResource: target.sessionResource,
    pageSize: STATUS_PAGE_SIZE,
    start: {
      kind: 'watermark' as const,
      createTime: pending.activityCreateTime,
      activityId: pending.activityId,
    },
    clock: deps.clock,
    deadline,
    pageCap: APPROVE_PAGE_CAP,
    onActivity: (activity) => {
      if (activity.type === 'userMessaged') {
        userMessages.push({
          activityId: activity.activityId,
          createTime: activity.createTime,
        });
      }
      if (activity.type === 'planGenerated' && activity.plan !== undefined) {
        plans.push({
          createTime: activity.createTime,
          digest: planDigest(
            activity.plan.planId,
            redactDeep({ steps: activity.plan.steps }).steps
          ),
        });
      }
    },
  });
  if (!walk.complete) return incompleteRefetch(walk);
  if (newestPlanAmbiguous(plans)) {
    return changed(
      'two different plans share the newest timestamp, so the current one cannot be told'
    );
  }
  const current = walk.pendingPlan;
  if (current !== null && current !== undefined) assertPlanReviewable(current);
  if (
    current === null ||
    current === undefined ||
    current.planId !== expected.planId ||
    planDigest(current.planId, redactDeep(current).steps) !== expected.digest
  ) {
    return changed('the session no longer has the plan the pass showed');
  }
  if (
    await hasUnclaimedUserMessage(deps, target.sessionResource, userMessages, {
      activityId: current.activityId,
      createTime: current.activityCreateTime,
    })
  ) {
    return changed(
      'a user message arrived after the reviewed plan and was not sent by this plugin'
    );
  }
}

/**
 * Redaction hides part of a plan from the review, and the plan digest hashes the
 * redacted text, so plans differing only in the hidden value would share a
 * digest. A plan redaction changed cannot be approved or replied to unseen.
 */
function assertPlanReviewable(plan: unknown): void {
  const steps = (plan as { steps?: ReadonlyArray<Record<string, unknown>> })
    .steps;
  const hidden = (steps ?? []).some((step) =>
    [step['title'], step['description']].some(
      (text) => typeof text === 'string' && HIDDEN_CHARS_RE.test(text)
    )
  );
  if (hidden) {
    throwAppError(
      'JULES_INVALID_STATE',
      'the pending plan contains hidden characters (control, bidi or zero-width) that the review would replace; it cannot be acted on unseen. Nothing was sent',
      {
        recoveryAction:
          'Review this plan in the Jules console, or ask for a plan without hidden characters.',
      }
    );
  }
  if (JSON.stringify(redactDeep(plan)) !== JSON.stringify(plan)) {
    throwAppError(
      'JULES_INVALID_STATE',
      'the pending plan contains credential-shaped text that is redacted from the review; it cannot be acted on unseen. Nothing was sent',
      {
        recoveryAction:
          'Review this plan in the Jules console, or ask for a plan without credentials.',
      }
    );
  }
}

function validateReplyKind(
  kind: ReplyArgs['replyKind'],
  question: unknown,
  plan: unknown
): void {
  if (kind === undefined) return;
  const bad = (m: string): never => throwAppError('JULES_INVALID_INPUT', m);
  if (kind === 'question' && question === undefined) {
    bad(
      '--reply-kind question requires --expect-activity-id and --expect-question-digest'
    );
  }
  if (kind === 'plan' && plan === undefined) {
    bad('--reply-kind plan requires --expect-plan-id and --expect-plan-digest');
  }
  if (kind === 'question' && plan !== undefined) {
    bad('--reply-kind question cannot carry a plan expectation');
  }
  if (kind === 'plan' && question !== undefined) {
    bad('--reply-kind plan cannot carry a question expectation');
  }
  if (kind === 'other' && (question !== undefined || plan !== undefined)) {
    bad('--reply-kind other cannot carry an expectation');
  }
}

async function replyInner(
  deps: WriteDeps,
  args: ReplyArgs,
  ids: Ids
): Promise<ReplyResult> {
  const message = validateText(args.message, '--message', MESSAGE_MAX_CHARS);
  const expectQuestion = validateExpectedQuestion(args);
  const expectPlan = validateExpectedPlan(args, expectQuestion !== undefined);
  validateReplyKind(args.replyKind, expectQuestion, expectPlan);
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

  return withMutationAdapter(deps, async (adapter) => {
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
    // limit that freed its slot. The journal's condition is the last status
    // call's, so read the live session right before reserving. A repair is a
    // new delegate instead.
    const live = await read(deps, deadline, () =>
      adapter.getSession(target.sessionResource)
    );
    const liveCondition = conditionOf(live.vendorState);
    if (isTerminalCondition(liveCondition)) {
      throw new MutationErrorException(
        makeAppError(
          'JULES_INVALID_STATE',
          `the session is ${liveCondition}; a reply does not reopen a finished session`,
          {
            recoveryAction:
              'For a repair, run delegate with --correction and the same --task-ref.',
          }
        ),
        ids
      );
    }
    if (expectQuestion !== undefined) {
      await assertQuestionStillOpen(
        deps,
        adapter,
        target.sessionResource,
        liveCondition,
        expectQuestion,
        deadline
      );
    }
    if (expectPlan !== undefined) {
      await assertPlanStillPending(
        deps,
        adapter,
        target,
        liveCondition,
        expectPlan,
        deadline
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
    const replyFloor = await readVendorFloor(
      deps,
      adapter,
      target.sessionResource,
      owner,
      deadline
    );
    if (isExpired(deps.clock, deadline)) {
      return settleExpiredBeforeWrite(deps, reservation, SESSION_RECONCILE);
    }
    if (replyFloor === undefined) {
      return settleFailure(deps, reservation, floorUnreadable(), {
        reconcileHint: SESSION_RECONCILE,
      });
    }
    await assertGrantLiveBeforeWrite(
      deps,
      reservation,
      SESSION_RECONCILE,
      replyFloor
    );
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
  /**
   * Digest of the plan the caller reviewed (`planDigest` of its id and steps).
   * Required for a real approve: the final pre-POST re-read refuses with
   * `JULES_POLICY_DEVIATION` unless the newest plan has this digest, so a plan
   * whose text changed under the same id is never approved. Optional on a dry
   * run, where a mismatch is reported as `planChanged`.
   */
  readonly expectPlanDigest?: string;
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
  if (
    args.expectPlanDigest !== undefined &&
    !/^[0-9a-f]{64}$/.test(args.expectPlanDigest)
  ) {
    throwAppError(
      'JULES_INVALID_INPUT',
      '--expect-plan-digest must be 64 lowercase hex characters'
    );
  }
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
  if (!args.dryRun && args.expectPlanDigest === undefined) {
    throwAppError(
      'JULES_INVALID_INPUT',
      'approve requires --expect-plan-digest: the sha256 of the plan you reviewed'
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

  return withMutationAdapter(deps, async (adapter) => {
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
    const userMessages: Array<{ activityId: string; createTime: string }> = [];
    const plans: Array<{ createTime: string; digest: string }> = [];
    const refetch = await walkActivities({
      adapter,
      sessionResource: target.sessionResource,
      pageSize: STATUS_PAGE_SIZE,
      start,
      clock: deps.clock,
      deadline: refetchDeadline,
      pageCap: APPROVE_PAGE_CAP,
      onActivity: (activity) => {
        if (activity.type === 'userMessaged') {
          userMessages.push({
            activityId: activity.activityId,
            createTime: activity.createTime,
          });
        }
        if (activity.type === 'planGenerated' && activity.plan !== undefined) {
          plans.push({
            createTime: activity.createTime,
            digest: planDigest(
              activity.plan.planId,
              redactDeep({ steps: activity.plan.steps }).steps
            ),
          });
        }
      },
    });
    if (!refetch.complete) return incompleteRefetch(refetch);
    const ambiguous = newestPlanAmbiguous(plans);
    const steered = await hasUnclaimedUserMessage(
      deps,
      target.sessionResource,
      userMessages,
      start
    );
    const newest = refetch.pendingPlan;
    if (newest === null || newest === undefined) {
      return throwAppError(
        'JULES_INVALID_STATE',
        'the vendor shows no pending plan for this session',
        { recoveryAction: 'Run status for this session, then retry.' }
      );
    }

    if (args.dryRun) {
      const changed =
        ambiguous ||
        newest.planId !== planId ||
        (args.expectPlanDigest !== undefined &&
          planDigest(newest.planId, redactDeep(newest).steps) !==
            args.expectPlanDigest);
      return {
        operation: 'approve' as const,
        localRequestId: ids.localRequestId,
        localId: ids.localId,
        sessionResource: target.sessionResource,
        dryRun: true as const,
        observedPlanId: newest.planId,
        ...scopeOf(target),
        ...attentionOf(changed || steered ? ['planChanged'] : []),
      };
    }
    // A user message after the reviewed plan that this plugin did not send may
    // have changed what the plan means; the re-read does not classify it.
    // Rejected whatever the cached pause state says: the owner may clear that
    // pause between resolving the target and the reservation. A session that
    // already records outside activity gets the more specific code.
    if (steered) {
      const alreadyPaused =
        target.owner?.supervision?.paused !== undefined ||
        target.owner?.supervision?.outsideSeen !== undefined;
      return alreadyPaused
        ? throwAppError(
            'JULES_SUPERVISION_PAUSED',
            'outside activity was recorded on this session; no grant-backed write is allowed until supervise --clear-pause'
          )
        : throwAppError(
            'JULES_INVALID_STATE',
            'a user message arrived after the reviewed plan and was not sent by this plugin; nothing was approved',
            {
              recoveryAction:
                'Run status to record it, read the session, then evaluate the plan again.',
            }
          );
    }
    assertPlanReviewable(newest);
    if (ambiguous) {
      return throwAppError(
        'JULES_POLICY_DEVIATION',
        'two different plans share the newest timestamp, so the current plan cannot be told; nothing was approved',
        {
          recoveryAction:
            'Run status, evaluate the plans in the Jules console, and approve once one is clearly newest.',
        }
      );
    }
    if (
      newest.planId !== planId ||
      planDigest(newest.planId, redactDeep(newest).steps) !==
        args.expectPlanDigest
    ) {
      return throwAppError(
        'JULES_POLICY_DEVIATION',
        'the newest pending plan differs from the reviewed plan (id or digest); nothing was approved',
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
        ...(args.expectPlanDigest !== undefined
          ? { observedPlanDigest: args.expectPlanDigest }
          : {}),
      },
    });

    if (isExpired(deps.clock, deadline)) {
      return settleExpiredBeforeWrite(deps, reservation, SESSION_RECONCILE);
    }

    const approveFloor = await readVendorFloor(
      deps,
      adapter,
      target.sessionResource,
      owner,
      deadline
    );
    if (isExpired(deps.clock, deadline)) {
      return settleExpiredBeforeWrite(deps, reservation, SESSION_RECONCILE);
    }
    if (approveFloor === undefined) {
      return settleFailure(deps, reservation, floorUnreadable(), {
        reconcileHint: SESSION_RECONCILE,
      });
    }
    await assertGrantLiveBeforeWrite(
      deps,
      reservation,
      SESSION_RECONCILE,
      approveFloor
    );
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
      deadline,
      args.expectPlanDigest
    );
    let deviated = false;
    let deviationUnrecorded = false;
    if (
      ((verified.observedPlanIdAfter !== null &&
        verified.observedPlanIdAfter !== planId) ||
        verified.planChanged) &&
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
  /** The plan generated just before the approval has other steps than the reviewed digest (same id or not). */
  readonly planChanged: boolean;
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
  deadline: Deadline,
  expectedDigest?: string
): Promise<Verification> {
  const generated: Array<{
    createTime: string;
    activityId: string;
    digest: string;
  }> = [];
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
        if (activity.type === 'planGenerated' && activity.plan !== undefined) {
          generated.push({
            createTime: activity.createTime,
            activityId: activity.activityId,
            digest: planDigest(
              activity.plan.planId,
              redactDeep({ steps: activity.plan.steps }).steps
            ),
          });
        }
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
    // The plan the vendor approved is the newest one generated before the
    // approval. The same id with other steps is a replacement under the
    // reviewed id, which the id comparison alone cannot see.
    const stamp = approvedStamp as
      | { createTime: string; activityId: string }
      | undefined;
    const candidates =
      stamp === undefined
        ? []
        : generated.filter((g) => compareStamp(g, stamp) < 0);
    const before = [...candidates].sort((a, b) => compareStamp(b, a))[0];
    // Equal-time plans with differing digests: the approved one is unknowable.
    // A plan stamped at the approval's own time is unordered against it (the
    // ids are opaque), so one that differs from the reviewed digest counts.
    const atApproval =
      stamp === undefined
        ? []
        : generated.filter(
            (g) => !stampBefore(g, stamp) && !stampBefore(stamp, g)
          );
    const ambiguous =
      newestPlanAmbiguous(candidates) ||
      (expectedDigest !== undefined &&
        atApproval.some((g) => g.digest !== expectedDigest));
    return {
      observedPlanIdAfter: observed,
      planChanged:
        ambiguous ||
        (before !== undefined &&
          expectedDigest !== undefined &&
          before.digest !== expectedDigest),
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
      planChanged: false,
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
    if (record.grantId !== undefined) {
      const loaded = loadGrants(deps.dataDir);
      const grant = loaded.grants[record.grantId];
      if (grant !== undefined) {
        assertControllerAuthority(
          ctx.controllerDir,
          deps.dataDir,
          grant.epochRef,
          ctx.controllerId
        );
        if (
          record.kind === 'create' &&
          grant.usage.activeSessionRefs.includes(record.localRequestId)
        ) {
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
