/**
 * `supervise` — ONE bounded pass of the R33 supervision loop. It observes the
 * session through `status` (the only writer of read-state), classifies what it
 * saw into exactly one decision, persists the small supervision state, and
 * returns. It never loops, never sleeps, and never writes to the vendor itself:
 * the calling session acts on `allowedActions` through `reply` / `approve` /
 * `delegate --correction` under the same grant, at most one per pass.
 *
 * Pausing (R32): outside activity — a `userMessaged` whose digest matches none
 * of this plugin's own messages, a plan that changed under an evaluation with
 * no reply of ours in between, or a partial walk that leaves outside activity
 * undetermined — pauses the session. A pause blocks every later grant-backed
 * `reply` or `approve` on the session, and a repair `delegate` for its task
 * (JULES_SUPERVISION_PAUSED), until `--clear-pause`, which is TTY-confirmed
 * because it widens effective authority. Outside activity that `status` merely
 * recorded blocks those writes the same way.
 *
 * Verification (R43) ships in PR4: a completed session reports
 * `verification: "unavailable"`, and the only verdicts offered are a repair
 * delegate or escalation — never acceptance.
 */

import { compareStamp } from './activity-walk.js';
import { evaluateScope, grantHasUnreconciledDeviation } from './authority.js';
import {
  DEFAULT_MUTATION_DEADLINE_MS,
  deadlineIn,
  isExpired,
  remainingMs,
} from './deadline.js';
import { AppErrorException, makeAppError, throwAppError } from './errors.js';
import { fenceAltersText, fenceUntrusted } from './redact.js';
import {
  type Attention,
  attentionOf,
  nowFn,
  prepare,
  resolveSessionResource,
  type WriteDeps,
  refuseInsideSupervisedSession,
  confirmOwner,
  isTerminalCondition,
} from './runtime-support.js';
import { collect, status, type StatusResult } from './runtime.js';
import {
  findBySessionResource,
  isOwningCreate,
  messageDigest,
  type OwningCreate,
  readJournal,
  updateJournal,
  updateSupervision,
  type SupervisionPatch,
} from './state.js';
import type {
  AdapterActivity,
  GrantOperation,
  GrantRecord,
  Journal,
  OperationRecord,
  SupervisionDecision,
} from './types.js';
import { validateGrantId } from './validate.js';
import {
  confirmationRequired,
  hasPlainLaunch,
  loadAuthorizedGrant,
} from './write-gate.js';

const BACKOFF_BASE_SECONDS = 60;
export const BACKOFF_CAP_SECONDS = 3600;
const STARTING_CHECK_SECONDS = 120;
const WORKING_CHECK_SECONDS = 600;
const AFTER_ACTING_SECONDS = 120;
const HUMAN_WAIT_SECONDS = 3600;
const ABORTED_RETRY_SECONDS = 60;
const FENCED_MESSAGE_CHARS = 500;
/** A bound question is fenced in full up to this many characters; longer is not bound. */
const BOUND_QUESTION_MAX_CHARS = 20_000;
const FENCED_MESSAGE_COUNT = 3;

type ActivityView = Pick<
  AdapterActivity,
  'activityId' | 'createTime' | 'type' | 'message'
> & { readonly planId?: string };

function viewOf(a: AdapterActivity): ActivityView {
  return {
    activityId: a.activityId,
    createTime: a.createTime,
    type: a.type,
    ...(a.message !== undefined ? { message: a.message } : {}),
    ...(a.plan !== undefined ? { planId: a.plan.planId } : {}),
  };
}

const waitForHuman: NextCheck = {
  afterSeconds: HUMAN_WAIT_SECONDS,
  reason: 'waiting for a human',
};

export type AllowedAction =
  | 'approve'
  | 'reply'
  | 'repair-delegate'
  | 'escalate';

export interface SuperviseArgs {
  readonly session: string;
  /** Required to run a pass; absent, the call answers with the `authorize` command to run. */
  readonly grantId?: string;
  readonly deadlineMs?: number;
}

export interface NextCheck {
  readonly afterSeconds: number;
  readonly reason: string;
}

export interface SuperviseResult extends Attention {
  readonly operation: 'supervise';
  readonly localId: string;
  readonly sessionResource: string;
  readonly decision: SupervisionDecision;
  /** Machine-readable cause of `escalate`, `paused`, and `check-failed`. */
  readonly reason?: string;
  readonly condition?: string;
  readonly vendorState?: string;
  readonly nextCheck: NextCheck;
  readonly allowedActions: readonly AllowedAction[];
  readonly correctiveRoundsLeft: number;
  readonly repository: string;
  readonly requestedBranch: string;
  readonly taskRef?: string;
  readonly observedPlanId?: string;
  /** `needs-answer`: the question's activity id and message digest; `reply --expect-activity-id/--expect-question-digest` verify them. */
  readonly observedActivityId?: string;
  readonly observedQuestionDigest?: string;
  /** `needs-verification`, and `escalate` with `corrective-rounds-exhausted`; R43 tooling ships in PR4. */
  readonly verification?: 'unavailable';
  readonly artifacts?: {
    readonly noSupportedArtifact: boolean;
    readonly partialStaging: boolean;
    readonly items: ReadonlyArray<{
      readonly kind: string;
      readonly path?: string;
      readonly sha256?: string;
      readonly secretShapedContent: boolean;
    }>;
  };
  /** All vendor-writable text, inside the untrusted-content fence (R33). */
  readonly fenced: {
    readonly plan?: string;
    readonly question?: string;
    readonly activities?: string;
  };
  readonly pause?: { readonly reason: string; readonly observedAt: string };
}

function owns(journal: Journal, sessionResource: string): OwningCreate {
  const owner = findBySessionResource(journal, sessionResource);
  if (!isOwningCreate(owner)) {
    return throwAppError(
      'JULES_AUTHORITY_DENIED',
      `${sessionResource} was not created through this plugin, so no grant covers it`,
      {
        recoveryAction:
          'Supervision covers sessions created by delegate. Act on this session in the Jules console.',
      }
    );
  }
  return owner;
}

function correctiveRoundsLeft(grant: GrantRecord, taskRef?: string): number {
  const used =
    taskRef !== undefined ? (grant.usage.correctiveRounds[taskRef] ?? 0) : 0;
  return Math.max(0, grant.maxCorrectiveRounds - used);
}

function permits(grant: GrantRecord, op: GrantOperation): boolean {
  return grant.operations.includes(op);
}

function truncate(text: string): string {
  return text.length > FENCED_MESSAGE_CHARS
    ? `${text.slice(0, FENCED_MESSAGE_CHARS)}…[truncated]`
    : text;
}

function planText(plan: NonNullable<StatusResult['pendingPlan']>): string {
  return plan.steps
    .map(
      (step) =>
        `${step.index + 1}. ${step.title}${
          step.description !== undefined ? `: ${step.description}` : ''
        }`
    )
    .join('\n');
}

function backoffSeconds(failures: number): number {
  return Math.min(
    BACKOFF_BASE_SECONDS * 2 ** Math.max(0, failures - 1),
    BACKOFF_CAP_SECONDS
  );
}

/** Failures a pass maps to `check-failed`: transient vendor, network, or credential trouble. */
const CHECK_FAILED_CODES = new Set([
  'JULES_SERVICE_UNAVAILABLE',
  'JULES_AUTH_FAILED',
  'JULES_RATE_LIMITED',
  'JULES_NO_PROGRESS',
  'JULES_MALFORMED_RESPONSE',
]);

export async function superviseOnce(
  deps: WriteDeps,
  args: SuperviseArgs
): Promise<SuperviseResult> {
  const suppliedGrantId =
    args.grantId !== undefined ? validateGrantId(args.grantId) : undefined;
  prepare(deps);
  const deadline = deadlineIn(
    deps.clock,
    args.deadlineMs ?? DEFAULT_MUTATION_DEADLINE_MS
  );
  const now = nowFn(deps);

  let journal = await readJournal(deps.dataDir);
  const sessionResource = resolveSessionResource(journal, args.session);
  const owner = owns(journal, sessionResource);
  if (suppliedGrantId === undefined) {
    throw confirmationRequired(
      deps,
      {
        operations: ['collect', 'reply', 'approve'],
        repository: owner.repository,
        requestedBranch: owner.requestedBranch,
        ...(owner.taskRef !== undefined ? { taskRef: owner.taskRef } : {}),
      },
      { localRequestId: owner.localRequestId, localId: owner.localId }
    );
  }
  const grantId = suppliedGrantId;

  // Gate: the grant exists, is bound to this controller, and covers the session's scope.
  const { grant } = loadAuthorizedGrant(deps, grantId);
  const scope = evaluateScope(
    grant,
    {
      repository: owner.repository,
      sourceResource: owner.sourceResource,
      branch: owner.requestedBranch,
      ...(owner.taskRef !== undefined ? { taskRef: owner.taskRef } : {}),
    },
    now()
  );
  const grantExpired = !scope.ok && scope.reason === 'expired';
  // An expired grant may still drive an escalation, but only for a session it
  // covered: the scope is judged again at the instant before it expired.
  const coverage = grantExpired
    ? evaluateScope(
        grant,
        {
          repository: owner.repository,
          sourceResource: owner.sourceResource,
          branch: owner.requestedBranch,
          ...(owner.taskRef !== undefined ? { taskRef: owner.taskRef } : {}),
        },
        new Date(Date.parse(grant.expiresAt) - 1)
      )
    : scope;
  if (!coverage.ok) {
    throw new AppErrorException(
      makeAppError(coverage.code, coverage.message, {
        recoveryAction:
          'The grant does not cover this session. List grants with authorize --list, or create a covering grant with authorize in a terminal.',
      })
    );
  }

  const base = {
    operation: 'supervise' as const,
    localId: owner.localId,
    sessionResource,
    correctiveRoundsLeft: correctiveRoundsLeft(grant, owner.taskRef),
    // What a repair delegate needs to name the task it repairs.
    repository: owner.repository,
    requestedBranch: owner.requestedBranch,
    ...(owner.taskRef !== undefined ? { taskRef: owner.taskRef } : {}),
  };
  const persist = (patch: SupervisionPatch): Promise<OperationRecord> =>
    updateSupervision(deps.dataDir, owner.localRequestId, patch, now);
  const decided = (
    decision: SupervisionDecision
  ): Pick<SupervisionPatch, 'lastDecision'> => ({
    lastDecision: { decision, decidedAt: now().toISOString() },
  });

  // An existing pause short-circuits: no vendor call, nothing to decide.
  const existingPause = owner.supervision?.paused;
  if (existingPause !== undefined) {
    return {
      ...base,
      decision: 'paused',
      reason: existingPause.reason,
      nextCheck: {
        afterSeconds: HUMAN_WAIT_SECONDS,
        reason: 'waiting for a human',
      },
      allowedActions: [],
      fenced: {},
      pause: existingPause,
      ...attentionOf(['paused']),
    };
  }

  // R32: outside activity recorded by ANY earlier walk (a plain `status` runs
  // between passes and would otherwise consume the evidence) pauses the session.
  const pauseForOutside = async (
    seenOutside: { readonly activityId: string },
    extra: Partial<SuperviseResult> = {}
  ): Promise<SuperviseResult> => {
    const pause = {
      reason: 'outside-user-message',
      observedAt: now().toISOString(),
      activityId: seenOutside.activityId,
    };
    await persist({ paused: pause, backoff: null, ...decided('paused') });
    return {
      ...base,
      decision: 'paused',
      reason: pause.reason,
      nextCheck: waitForHuman,
      allowedActions: [],
      fenced: {},
      pause: { reason: pause.reason, observedAt: pause.observedAt },
      ...extra,
      ...attentionOf(['paused', pause.reason]),
    };
  };
  const startOutside = owner.supervision?.outsideSeen;
  if (startOutside !== undefined) return pauseForOutside(startOutside);

  const aborted = (): SuperviseResult => ({
    ...base,
    decision: 'pass-aborted',
    nextCheck: {
      afterSeconds: ABORTED_RETRY_SECONDS,
      reason: 'the deadline fired mid-pass; no verdict was reached',
    },
    allowedActions: [],
    fenced: {},
    ...attentionOf(['passAborted']),
  });
  const checkFailed = async (reason: string): Promise<SuperviseResult> => {
    const failures = (owner.supervision?.backoff?.failures ?? 0) + 1;
    const seconds = backoffSeconds(failures);
    await persist({
      backoff: {
        failures,
        nextCheckAt: new Date(now().getTime() + seconds * 1000).toISOString(),
      },
      ...decided('check-failed'),
    });
    return {
      ...base,
      decision: 'check-failed',
      reason,
      nextCheck: {
        afterSeconds: seconds,
        reason: `backoff after ${failures} failed check(s)`,
      },
      allowedActions: [],
      fenced: {},
      ...attentionOf(['checkFailed']),
    };
  };

  // Observation: the status walk, with a view of every activity it reads.
  // Only the fields below are read; plan steps and artifacts (patch text) are not kept.
  const newActivities: ActivityView[] = [];
  const newest: { agent?: ActivityView } = {};
  let seen: StatusResult;
  try {
    const result = await status(deps, {
      session: sessionResource,
      reconcile: false,
      deadlineMs: Math.max(1, remainingMs(deps.clock, deadline)),
      observer: (activity, info) => {
        if (info.unseen) newActivities.push(viewOf(activity));
        if (
          activity.type === 'agentMessaged' &&
          (newest.agent === undefined ||
            compareStamp(activity, newest.agent) > 0)
        ) {
          newest.agent = viewOf(activity);
        }
      },
    });
    seen = result;
  } catch (err) {
    if (err instanceof AppErrorException) {
      if (err.appError.code === 'JULES_DEADLINE_EXCEEDED') return aborted();
      if (CHECK_FAILED_CODES.has(err.appError.code)) {
        return checkFailed(err.appError.code);
      }
    }
    throw err;
  }

  const walk = seen.activities;
  if (walk === undefined) {
    return throwAppError(
      'JULES_MALFORMED_RESPONSE',
      'status returned no activity summary'
    );
  }
  // The pause wins over every early return below: a deadline or a failed page
  // must not let the evidence this walk (or an earlier one) recorded go stale.
  journal = await readJournal(deps.dataDir);
  const fresh = owns(journal, sessionResource);
  const recordedOutside = fresh.supervision?.outsideSeen;
  if (recordedOutside !== undefined) {
    const echoed = newActivities.filter(
      (a) =>
        a.activityId === recordedOutside.activityId && a.message !== undefined
    );
    return pauseForOutside(recordedOutside, {
      ...(seen.condition !== undefined ? { condition: seen.condition } : {}),
      ...(seen.vendorState !== undefined
        ? { vendorState: seen.vendorState }
        : {}),
      fenced:
        echoed.length > 0
          ? {
              activities: fenceUntrusted(
                echoed
                  .slice(0, FENCED_MESSAGE_COUNT)
                  .map(
                    (a) =>
                      `user message ${a.activityId}: ${truncate(a.message ?? '')}`
                  )
                  .join('\n')
              ),
            }
          : {},
    });
  }
  if (
    walk.partialPagination &&
    (walk.stopReason === 'deadline' || isExpired(deps.clock, deadline))
  ) {
    return aborted();
  }
  if (walk.partialPagination && walk.stopReason === 'page-failure') {
    return checkFailed('page-failure');
  }
  if (walk.dedupWindowExceeded) return checkFailed('dedup-window-exceeded');

  const condition = seen.condition ?? 'needs-inspection';
  const vendorState = seen.vendorState ?? 'unspecified';
  const fenced: { plan?: string; question?: string; activities?: string } = {};

  // R32: a plan that changed under an evaluation, or a walk that cannot rule
  // outside activity out. (Outside user messages were handled above.)
  const evaluated = fresh.supervision?.evaluatedPlan;
  const repliedSinceEvaluation =
    evaluated !== undefined &&
    Object.values(journal.operations).some(
      (r) =>
        r.sessionResource === sessionResource &&
        r.kind === 'reply' &&
        // A clean rejection or a failure before dispatch never reached Jules;
        // reserved, accepted, unknown-outcome and reconciled replies might have.
        r.status !== 'failed' &&
        r.status !== 'rejected' &&
        // A reservation whose POST has not begun cannot have changed the plan.
        !(r.status === 'reserved' && r.dispatchedAt === undefined) &&
        r.createdAt >= evaluated.evaluatedAt
    );
  // A swap is caught whether this pass or an earlier plain `status` consumed
  // the new plan: the plan now pending is compared with the one evaluated.
  const swappedActivityId =
    evaluated !== undefined && !repliedSinceEvaluation
      ? (newActivities.find(
          (a) =>
            a.type === 'planGenerated' &&
            a.planId !== undefined &&
            a.planId !== evaluated.planId
        )?.activityId ??
        (seen.pendingPlan !== undefined &&
        seen.pendingPlan.planId !== evaluated.planId
          ? seen.pendingPlan.activityId
          : undefined))
      : undefined;
  let pauseReason: string | undefined;
  let pauseActivityId: string | undefined;
  if (swappedActivityId !== undefined) {
    pauseReason = 'plan-changed-after-evaluation';
    pauseActivityId = swappedActivityId;
  } else if (walk.partialPagination) {
    pauseReason =
      walk.stopReason === 'unmapped'
        ? 'partial-walk-unmapped-activity'
        : 'partial-walk';
  }
  if (pauseReason !== undefined) {
    const pause = {
      reason: pauseReason,
      observedAt: now().toISOString(),
      ...(pauseActivityId !== undefined ? { activityId: pauseActivityId } : {}),
    };
    await persist({ paused: pause, backoff: null, ...decided('paused') });
    return {
      ...base,
      decision: 'paused',
      reason: pauseReason,
      condition,
      vendorState,
      nextCheck: {
        afterSeconds: HUMAN_WAIT_SECONDS,
        reason: 'waiting for a human',
      },
      allowedActions: [],
      fenced,
      pause: { reason: pause.reason, observedAt: pause.observedAt },
      ...attentionOf(['paused', pauseReason]),
    };
  }

  const finish = async (
    decision: SupervisionDecision,
    extra: Partial<SuperviseResult> & {
      readonly nextCheck: NextCheck;
      readonly allowedActions: readonly AllowedAction[];
    },
    patch: SupervisionPatch = {},
    flags: readonly string[] = []
  ): Promise<SuperviseResult> => {
    // The evaluated plan is remembered only while a plan review is the decision.
    await persist({
      backoff: null,
      ...(decision === 'needs-plan-review' ? {} : { evaluatedPlan: null }),
      ...patch,
      ...decided(decision),
    });
    return {
      ...base,
      decision,
      condition,
      vendorState,
      fenced,
      ...extra,
      ...attentionOf(flags),
    };
  };
  // Escalations that need no further reading.
  if (seen.policyDeviation === true) {
    return finish(
      'escalate',
      {
        reason: 'policy-deviation',
        nextCheck: waitForHuman,
        allowedActions: [],
      },
      {},
      ['policyDeviation']
    );
  }
  if (grantExpired) {
    // R39: expiry never stops remote work. Without a live grant nothing can
    // be acted on, so a human decides; the reason says whether work is running.
    const terminal = isTerminalCondition(condition);
    return finish(
      'escalate',
      {
        reason: terminal ? 'grant-expired' : 'grant-expired-with-remote-work',
        nextCheck: waitForHuman,
        allowedActions: [],
      },
      {},
      ['grantExpired']
    );
  }
  if (condition === 'needs-inspection') {
    return finish(
      'escalate',
      {
        reason: 'unknown-vendor-state',
        nextCheck: waitForHuman,
        allowedActions: [],
      },
      {},
      ['needsInspection']
    );
  }
  if (condition === 'failed' || condition === 'paused') {
    return finish(
      'escalate',
      {
        reason: condition === 'failed' ? 'session-failed' : 'vendor-paused',
        nextCheck: waitForHuman,
        allowedActions: [],
      },
      {},
      [condition === 'failed' ? 'sessionFailed' : 'vendorPaused']
    );
  }

  const acting: NextCheck = {
    afterSeconds: AFTER_ACTING_SECONDS,
    reason: 'after acting on this decision',
  };

  // R13: another session under this grant carries an unreconciled policy
  // deviation, so every write under it is denied. Advertising approve or reply
  // would send the caller into a write that must fail; a human reconciles first.
  const grantBlocked = grantHasUnreconciledDeviation(journal, grant.grantId);
  if (
    grantBlocked &&
    (condition === 'awaiting-approval' || condition === 'awaiting-reply')
  ) {
    return finish(
      'escalate',
      {
        reason: 'grant-policy-deviation',
        nextCheck: waitForHuman,
        allowedActions: [],
      },
      {},
      ['policyDeviation']
    );
  }

  if (condition === 'awaiting-approval' && seen.pendingPlan !== undefined) {
    const shownPlan = planText(seen.pendingPlan);
    fenced.plan = fenceUntrusted(shownPlan);
    // A plan the fence rewrote (redaction, a forged delimiter) was not shown as
    // it is: it is not offered for approval or a plan-bound reply.
    const unactionable = fenceAltersText(shownPlan);
    const actions: AllowedAction[] = unactionable
      ? []
      : [
          ...(permits(grant, 'approve') ? (['approve'] as const) : []),
          ...(permits(grant, 'reply') ? (['reply'] as const) : []),
        ];
    return finish(
      'needs-plan-review',
      {
        ...(unactionable ? {} : { observedPlanId: seen.pendingPlan.planId }),
        nextCheck: acting,
        allowedActions: actions,
      },
      {
        evaluatedPlan: {
          planId: seen.pendingPlan.planId,
          evaluatedAt: now().toISOString(),
        },
      },
      unactionable ? ['planUnavailable'] : []
    );
  }

  if (condition === 'awaiting-approval') {
    // The vendor wants an approval but no plan could be read: a human looks.
    return finish(
      'escalate',
      {
        reason: 'awaiting-approval-without-plan',
        nextCheck: waitForHuman,
        allowedActions: [],
      },
      {},
      ['planUnavailable']
    );
  }

  if (condition === 'awaiting-reply') {
    const latest = newest.agent;
    if (latest?.message !== undefined) {
      fenced.question = fenceUntrusted(
        latest.message.length <= BOUND_QUESTION_MAX_CHARS
          ? latest.message
          : truncate(latest.message)
      );
    }
    // A question that redaction altered, or that is too long to show in full, was not
    // shown in full: no binding and no reply action are offered for it, so the
    // operator answers.
    const bindable =
      latest?.message !== undefined &&
      !fenceAltersText(latest.message) &&
      latest.message.length <= BOUND_QUESTION_MAX_CHARS;
    return finish(
      'needs-answer',
      {
        ...(bindable
          ? {
              observedActivityId: latest.activityId,
              observedQuestionDigest: messageDigest(latest.message),
            }
          : {}),
        nextCheck: acting,
        allowedActions: bindable && permits(grant, 'reply') ? ['reply'] : [],
      },
      {},
      bindable ? [] : ['questionUnavailable']
    );
  }

  if (condition === 'remote-completed') {
    if (base.correctiveRoundsLeft === 0) {
      return finish(
        'escalate',
        {
          reason: 'corrective-rounds-exhausted',
          verification: 'unavailable',
          nextCheck: waitForHuman,
          allowedActions: [],
        },
        {},
        ['correctiveRoundsExhausted']
      );
    }
    let artifacts: SuperviseResult['artifacts'];
    if (permits(grant, 'collect')) {
      try {
        const staged = await collect(deps, {
          session: sessionResource,
          deadlineMs: Math.max(1, remainingMs(deps.clock, deadline)),
        });
        artifacts = {
          noSupportedArtifact: staged.noSupportedArtifact,
          partialStaging: staged.partialStaging,
          items: staged.artifacts.map((a) => ({
            kind: a.kind,
            ...(a.path !== undefined ? { path: a.path } : {}),
            ...(a.sha256 !== undefined ? { sha256: a.sha256 } : {}),
            secretShapedContent: a.secretShapedContent,
          })),
        };
      } catch (err) {
        if (err instanceof AppErrorException) {
          if (err.appError.code === 'JULES_DEADLINE_EXCEEDED') return aborted();
          if (CHECK_FAILED_CODES.has(err.appError.code)) {
            return checkFailed(err.appError.code);
          }
        }
        throw err;
      }
    }
    const repair =
      // The write gate requires a plain launch under the SAME grant for a
      // correction, so only advertise the repair when this grant has one.
      !grantBlocked &&
      permits(grant, 'create') &&
      owner.taskRef !== undefined &&
      hasPlainLaunch(journal, grant.grantId, owner.taskRef)
        ? (['repair-delegate'] as const)
        : [];
    return finish(
      'needs-verification',
      {
        verification: 'unavailable',
        ...(artifacts !== undefined ? { artifacts } : {}),
        nextCheck: acting,
        allowedActions: [...repair, 'escalate'],
      },
      {},
      [
        'verificationUnavailable',
        ...(artifacts === undefined ? ['collectNotPermitted'] : []),
      ]
    );
  }

  // starting / working: nothing to decide.
  const newAgent = newActivities
    .filter((a) => a.type === 'agentMessaged' && a.message !== undefined)
    .slice(-FENCED_MESSAGE_COUNT);
  if (newAgent.length > 0) {
    fenced.activities = fenceUntrusted(
      newAgent
        .map(
          (a) => `agent message ${a.activityId}: ${truncate(a.message ?? '')}`
        )
        .join('\n')
    );
  }
  const nextCheck: NextCheck =
    condition === 'starting'
      ? { afterSeconds: STARTING_CHECK_SECONDS, reason: 'session is starting' }
      : condition === 'working'
        ? { afterSeconds: WORKING_CHECK_SECONDS, reason: 'session is working' }
        : {
            afterSeconds: HUMAN_WAIT_SECONDS,
            reason: 'nothing left to supervise',
          };
  return finish('no-change', { nextCheck, allowedActions: [] });
}

// ---------------------------------------------------------------------------
// supervise --clear-pause
// ---------------------------------------------------------------------------

export interface ClearPauseArgs {
  readonly session: string;
}

export interface ClearPauseResult {
  readonly operation: 'supervise';
  readonly localId: string;
  readonly sessionResource: string;
  readonly cleared: true;
}

/**
 * The pause the write gate enforces: a recorded pause, or else outside
 * activity that `status` saw before any supervise pass turned it into a pause.
 */
function effectivePause(
  state: OperationRecord['supervision']
): { readonly reason: string; readonly observedAt: string } | undefined {
  if (state?.paused !== undefined) return state.paused;
  if (state?.outsideSeen === undefined) return undefined;
  return {
    reason: 'outside-user-message',
    observedAt: state.outsideSeen.observedAt,
  };
}

/**
 * Clears a pause. TTY-confirmed (it widens effective authority) and only after
 * a COMPLETE `status` walk newer than the pause: the owner must have looked
 * at what happened first, and the activity that caused the pause is no longer
 * "new" to the next pass.
 */
export async function clearPause(
  deps: WriteDeps,
  args: ClearPauseArgs
): Promise<ClearPauseResult> {
  refuseInsideSupervisedSession(deps.env, 'supervise --clear-pause');
  prepare(deps);
  const journal = await readJournal(deps.dataDir);
  const sessionResource = resolveSessionResource(journal, args.session);
  const owner = owns(journal, sessionResource);
  const paused = effectivePause(owner.supervision);
  if (paused === undefined) {
    return throwAppError('JULES_INVALID_STATE', 'this session is not paused', {
      recoveryAction: 'Nothing to clear.',
    });
  }
  if (
    owner.lastCompleteWalkAt === undefined ||
    owner.lastCompleteWalkAt <= paused.observedAt
  ) {
    return throwAppError(
      'JULES_INVALID_STATE',
      'no complete status walk has run since the pause',
      {
        recoveryAction:
          'Run status for this session first, inspect it, then retry.',
      }
    );
  }
  await confirmOwner(
    deps,
    [
      'yellow-jules: CLEAR SUPERVISION PAUSE',
      `  session:     ${sessionResource}`,
      `  paused for:  ${paused.reason}`,
      `  paused at:   ${paused.observedAt}`,
      ...(owner.supervision?.outsideSeen !== undefined
        ? [
            `  outside activity: ${owner.supervision.outsideSeen.activityId} (seen ${owner.supervision.outsideSeen.observedAt}) - inspect it first; clearing forgets it`,
          ]
        : []),
      '',
      'Supervised writes under the grant resume for this session.',
    ].join('\n')
  );
  // The owner typed the code for THIS pause. A pass that recorded a different
  // pause or newer outside activity during the wait must not be cleared by it.
  await updateJournal(deps.dataDir, (operations) => {
    const current = operations[owner.localRequestId];
    const state = current?.supervision;
    if (
      current === undefined ||
      state === undefined ||
      effectivePause(state)?.observedAt !== paused.observedAt ||
      effectivePause(state)?.reason !== paused.reason ||
      state.outsideSeen?.activityId !==
        owner.supervision?.outsideSeen?.activityId ||
      current.lastCompleteWalkAt === undefined ||
      current.lastCompleteWalkAt <= paused.observedAt
    ) {
      return throwAppError(
        'JULES_INVALID_STATE',
        'the supervision state changed while the confirmation was open; nothing was cleared',
        {
          recoveryAction:
            'Run status for this session, inspect it, then retry.',
        }
      );
    }
    // The invalidated evaluation is forgotten with the pause, so the next pass
    // does not re-pause on the same plan swap.
    const {
      paused: _paused,
      outsideSeen: _outside,
      evaluatedPlan: _evaluated,
      ...rest
    } = state;
    operations[owner.localRequestId] = {
      ...current,
      supervision: rest,
      updatedAt: nowFn(deps)().toISOString(),
    };
  });
  return {
    operation: 'supervise',
    localId: owner.localId,
    sessionResource,
    cleared: true,
  };
}
