"use strict";
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
 * write (JULES_SUPERVISION_PAUSED) until `--clear-pause`, which is TTY-confirmed
 * because it widens effective authority.
 *
 * Verification (R43) ships in PR4: a completed session reports
 * `verification: "unavailable"`, and the only verdicts offered are a repair
 * delegate or escalation — never acceptance.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BACKOFF_CAP_SECONDS = exports.BACKOFF_BASE_SECONDS = void 0;
exports.superviseOnce = superviseOnce;
exports.clearPause = clearPause;
const activity_walk_js_1 = require("./activity-walk.js");
const authority_js_1 = require("./authority.js");
const deadline_js_1 = require("./deadline.js");
const errors_js_1 = require("./errors.js");
const redact_js_1 = require("./redact.js");
const runtime_support_js_1 = require("./runtime-support.js");
const runtime_js_1 = require("./runtime.js");
const state_js_1 = require("./state.js");
const validate_js_1 = require("./validate.js");
const write_gate_js_1 = require("./write-gate.js");
exports.BACKOFF_BASE_SECONDS = 60;
exports.BACKOFF_CAP_SECONDS = 3600;
const STARTING_CHECK_SECONDS = 120;
const WORKING_CHECK_SECONDS = 600;
const AFTER_ACTING_SECONDS = 120;
const HUMAN_WAIT_SECONDS = 3600;
const ABORTED_RETRY_SECONDS = 60;
const FENCED_MESSAGE_CHARS = 500;
const FENCED_MESSAGE_COUNT = 3;
function viewOf(a) {
    return {
        activityId: a.activityId,
        createTime: a.createTime,
        type: a.type,
        ...(a.message !== undefined ? { message: a.message } : {}),
        ...(a.plan !== undefined ? { planId: a.plan.planId } : {}),
    };
}
const waitForHuman = {
    afterSeconds: HUMAN_WAIT_SECONDS,
    reason: 'waiting for a human',
};
function owns(journal, sessionResource) {
    const owner = (0, state_js_1.findBySessionResource)(journal, sessionResource);
    if (!(0, state_js_1.isOwningCreate)(owner)) {
        return (0, errors_js_1.throwAppError)('JULES_AUTHORITY_DENIED', `${sessionResource} was not created through this plugin, so no grant covers it`, {
            recoveryAction: 'Supervision covers sessions created by delegate. Act on this session in the Jules console.',
        });
    }
    return owner;
}
function correctiveRoundsLeft(grant, taskRef) {
    const used = taskRef !== undefined ? (grant.usage.correctiveRounds[taskRef] ?? 0) : 0;
    return Math.max(0, grant.maxCorrectiveRounds - used);
}
function permits(grant, op) {
    return grant.operations.includes(op);
}
function truncate(text) {
    return text.length > FENCED_MESSAGE_CHARS
        ? `${text.slice(0, FENCED_MESSAGE_CHARS)}…[truncated]`
        : text;
}
function planText(plan) {
    return plan.steps
        .map((step) => `${step.index + 1}. ${step.title}${step.description !== undefined ? `: ${step.description}` : ''}`)
        .join('\n');
}
function backoffSeconds(failures) {
    return Math.min(exports.BACKOFF_BASE_SECONDS * 2 ** Math.max(0, failures - 1), exports.BACKOFF_CAP_SECONDS);
}
/** Failures a pass maps to `check-failed`: transient vendor, network, or credential trouble. */
const CHECK_FAILED_CODES = new Set([
    'JULES_SERVICE_UNAVAILABLE',
    'JULES_AUTH_FAILED',
    'JULES_RATE_LIMITED',
    'JULES_NO_PROGRESS',
    'JULES_MALFORMED_RESPONSE',
]);
async function superviseOnce(deps, args) {
    const grantId = (0, validate_js_1.validateGrantId)(args.grantId);
    (0, runtime_support_js_1.prepare)(deps);
    const deadline = (0, deadline_js_1.deadlineIn)(deps.clock, args.deadlineMs ?? deadline_js_1.DEFAULT_MUTATION_DEADLINE_MS);
    const now = (0, runtime_support_js_1.nowFn)(deps);
    let journal = await (0, state_js_1.readJournal)(deps.dataDir);
    const sessionResource = (0, runtime_support_js_1.resolveSessionResource)(journal, args.session);
    const owner = owns(journal, sessionResource);
    // Gate: the grant exists, is bound to this controller, and covers the session's scope.
    const { grant } = (0, write_gate_js_1.loadAuthorizedGrant)(deps, grantId);
    const scope = (0, authority_js_1.evaluateScope)(grant, {
        repository: owner.repository,
        sourceResource: owner.sourceResource,
        branch: owner.requestedBranch,
        ...(owner.taskRef !== undefined ? { taskRef: owner.taskRef } : {}),
    }, now());
    const grantExpired = !scope.ok && scope.reason === 'expired';
    if (!scope.ok && !grantExpired) {
        throw new errors_js_1.AppErrorException((0, errors_js_1.makeAppError)(scope.code, scope.message, {
            recoveryAction: 'The grant does not cover this session. List grants with authorize --list, or create a covering grant with authorize in a terminal.',
        }));
    }
    const base = {
        operation: 'supervise',
        localId: owner.localId,
        sessionResource,
        correctiveRoundsLeft: correctiveRoundsLeft(grant, owner.taskRef),
    };
    const persist = (patch) => (0, state_js_1.updateSupervision)(deps.dataDir, owner.localRequestId, patch, now);
    const decided = (decision) => ({
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
            ...(0, runtime_support_js_1.attentionOf)(['paused']),
        };
    }
    // R32: outside activity recorded by ANY earlier walk (a plain `status` runs
    // between passes and would otherwise consume the evidence) pauses the session.
    const pauseForOutside = async (seenOutside, extra = {}) => {
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
            ...(0, runtime_support_js_1.attentionOf)(['paused', pause.reason]),
        };
    };
    const startOutside = owner.supervision?.outsideSeen;
    if (startOutside !== undefined)
        return pauseForOutside(startOutside);
    const aborted = () => ({
        ...base,
        decision: 'pass-aborted',
        nextCheck: {
            afterSeconds: ABORTED_RETRY_SECONDS,
            reason: 'the deadline fired mid-pass; no verdict was reached',
        },
        allowedActions: [],
        fenced: {},
        ...(0, runtime_support_js_1.attentionOf)(['passAborted']),
    });
    const checkFailed = async (reason) => {
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
            ...(0, runtime_support_js_1.attentionOf)(['checkFailed']),
        };
    };
    // Observation: the status walk, with a view of every activity it reads.
    // Only the fields below are read; plan steps and artifacts (patch text) are not kept.
    const newActivities = [];
    const newest = {};
    let seen;
    try {
        const result = await (0, runtime_js_1.status)(deps, {
            session: sessionResource,
            reconcile: false,
            deadlineMs: Math.max(1, (0, deadline_js_1.remainingMs)(deps.clock, deadline)),
            observer: (activity, info) => {
                if (info.isNew)
                    newActivities.push(viewOf(activity));
                if (activity.type === 'agentMessaged' &&
                    (newest.agent === undefined ||
                        (0, activity_walk_js_1.compareStamp)(activity, newest.agent) > 0)) {
                    newest.agent = viewOf(activity);
                }
            },
        });
        seen = result;
    }
    catch (err) {
        if (err instanceof errors_js_1.AppErrorException) {
            if (err.appError.code === 'JULES_DEADLINE_EXCEEDED')
                return aborted();
            if (CHECK_FAILED_CODES.has(err.appError.code)) {
                return checkFailed(err.appError.code);
            }
        }
        throw err;
    }
    const walk = seen.activities;
    if (walk === undefined) {
        return (0, errors_js_1.throwAppError)('JULES_MALFORMED_RESPONSE', 'status returned no activity summary');
    }
    // The pause wins over every early return below: a deadline or a failed page
    // must not let the evidence this walk (or an earlier one) recorded go stale.
    journal = await (0, state_js_1.readJournal)(deps.dataDir);
    const fresh = owns(journal, sessionResource);
    const recordedOutside = fresh.supervision?.outsideSeen;
    if (recordedOutside !== undefined) {
        const echoed = newActivities.filter((a) => a.activityId === recordedOutside.activityId && a.message !== undefined);
        return pauseForOutside(recordedOutside, {
            ...(seen.condition !== undefined ? { condition: seen.condition } : {}),
            ...(seen.vendorState !== undefined
                ? { vendorState: seen.vendorState }
                : {}),
            fenced: echoed.length > 0
                ? {
                    activities: (0, redact_js_1.fenceUntrusted)(echoed
                        .slice(0, FENCED_MESSAGE_COUNT)
                        .map((a) => `user message ${a.activityId}: ${truncate(a.message ?? '')}`)
                        .join('\n')),
                }
                : {},
        });
    }
    if (walk.partialPagination &&
        (walk.stopReason === 'deadline' || (0, deadline_js_1.isExpired)(deps.clock, deadline))) {
        return aborted();
    }
    if (walk.partialPagination && walk.stopReason === 'page-failure') {
        return checkFailed('page-failure');
    }
    if (walk.dedupWindowExceeded)
        return checkFailed('dedup-window-exceeded');
    const condition = seen.condition ?? 'needs-inspection';
    const vendorState = seen.vendorState ?? 'unspecified';
    const fenced = {};
    // R32: a plan that changed under an evaluation, or a walk that cannot rule
    // outside activity out. (Outside user messages were handled above.)
    const evaluated = fresh.supervision?.evaluatedPlan;
    const repliedSinceEvaluation = evaluated !== undefined &&
        Object.values(journal.operations).some((r) => r.sessionResource === sessionResource &&
            r.kind === 'reply' &&
            r.createdAt >= evaluated.evaluatedAt);
    const swappedPlan = evaluated !== undefined && !repliedSinceEvaluation
        ? newActivities.find((a) => a.type === 'planGenerated' &&
            a.planId !== undefined &&
            a.planId !== evaluated.planId)
        : undefined;
    let pauseReason;
    let pauseActivity;
    if (swappedPlan !== undefined) {
        pauseReason = 'plan-changed-after-evaluation';
        pauseActivity = swappedPlan;
    }
    else if (walk.partialPagination) {
        pauseReason =
            walk.stopReason === 'unmapped'
                ? 'partial-walk-unmapped-activity'
                : 'partial-walk';
    }
    if (pauseReason !== undefined) {
        const pause = {
            reason: pauseReason,
            observedAt: now().toISOString(),
            ...(pauseActivity !== undefined
                ? { activityId: pauseActivity.activityId }
                : {}),
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
            ...(0, runtime_support_js_1.attentionOf)(['paused', pauseReason]),
        };
    }
    const finish = async (decision, extra, patch = {}, flags = []) => {
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
            ...(0, runtime_support_js_1.attentionOf)(flags),
        };
    };
    // Escalations that need no further reading.
    if (seen.policyDeviation === true) {
        return finish('escalate', {
            reason: 'policy-deviation',
            nextCheck: waitForHuman,
            allowedActions: [],
        }, {}, ['policyDeviation']);
    }
    if (grantExpired) {
        // R39: expiry never stops remote work. Without a live grant nothing can
        // be acted on, so a human decides; the reason says whether work is running.
        const terminal = (0, runtime_support_js_1.isTerminalCondition)(condition);
        return finish('escalate', {
            reason: terminal ? 'grant-expired' : 'grant-expired-with-remote-work',
            nextCheck: waitForHuman,
            allowedActions: [],
        }, {}, ['grantExpired']);
    }
    if (condition === 'needs-inspection') {
        return finish('escalate', {
            reason: 'unknown-vendor-state',
            nextCheck: waitForHuman,
            allowedActions: [],
        }, {}, ['needsInspection']);
    }
    if (condition === 'failed' || condition === 'paused') {
        return finish('escalate', {
            reason: condition === 'failed' ? 'session-failed' : 'vendor-paused',
            nextCheck: waitForHuman,
            allowedActions: [],
        }, {}, [condition === 'failed' ? 'sessionFailed' : 'vendorPaused']);
    }
    const acting = {
        afterSeconds: AFTER_ACTING_SECONDS,
        reason: 'after acting on this decision',
    };
    if (condition === 'awaiting-approval' && seen.pendingPlan !== undefined) {
        fenced.plan = (0, redact_js_1.fenceUntrusted)(planText(seen.pendingPlan));
        const actions = [
            ...(permits(grant, 'approve') ? ['approve'] : []),
            ...(permits(grant, 'reply') ? ['reply'] : []),
        ];
        return finish('needs-plan-review', {
            observedPlanId: seen.pendingPlan.planId,
            nextCheck: acting,
            allowedActions: actions,
        }, {
            evaluatedPlan: {
                planId: seen.pendingPlan.planId,
                evaluatedAt: now().toISOString(),
            },
        });
    }
    if (condition === 'awaiting-reply') {
        const latest = newest.agent;
        if (latest?.message !== undefined) {
            fenced.question = (0, redact_js_1.fenceUntrusted)(truncate(latest.message));
        }
        return finish('needs-answer', {
            nextCheck: acting,
            allowedActions: permits(grant, 'reply') ? ['reply'] : [],
        }, {}, latest?.message === undefined ? ['questionUnavailable'] : []);
    }
    if (condition === 'remote-completed') {
        if (base.correctiveRoundsLeft === 0) {
            return finish('escalate', {
                reason: 'corrective-rounds-exhausted',
                verification: 'unavailable',
                nextCheck: waitForHuman,
                allowedActions: [],
            }, {}, ['correctiveRoundsExhausted']);
        }
        let artifacts;
        if (permits(grant, 'collect')) {
            try {
                const staged = await (0, runtime_js_1.collect)(deps, {
                    session: sessionResource,
                    deadlineMs: Math.max(1, (0, deadline_js_1.remainingMs)(deps.clock, deadline)),
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
            }
            catch (err) {
                if (err instanceof errors_js_1.AppErrorException) {
                    if (err.appError.code === 'JULES_DEADLINE_EXCEEDED')
                        return aborted();
                    if (CHECK_FAILED_CODES.has(err.appError.code)) {
                        return checkFailed(err.appError.code);
                    }
                }
                throw err;
            }
        }
        const repair = permits(grant, 'create') && owner.taskRef !== undefined
            ? ['repair-delegate']
            : [];
        return finish('needs-verification', {
            verification: 'unavailable',
            ...(artifacts !== undefined ? { artifacts } : {}),
            nextCheck: acting,
            allowedActions: [...repair, 'escalate'],
        }, {}, [
            'verificationUnavailable',
            ...(artifacts === undefined ? ['collectNotPermitted'] : []),
        ]);
    }
    // starting / working: nothing to decide.
    const newAgent = newActivities
        .filter((a) => a.type === 'agentMessaged' && a.message !== undefined)
        .slice(-FENCED_MESSAGE_COUNT);
    if (newAgent.length > 0) {
        fenced.activities = (0, redact_js_1.fenceUntrusted)(newAgent
            .map((a) => `agent message ${a.activityId}: ${truncate(a.message ?? '')}`)
            .join('\n'));
    }
    const nextCheck = condition === 'starting'
        ? { afterSeconds: STARTING_CHECK_SECONDS, reason: 'session is starting' }
        : condition === 'working'
            ? { afterSeconds: WORKING_CHECK_SECONDS, reason: 'session is working' }
            : {
                afterSeconds: HUMAN_WAIT_SECONDS,
                reason: 'nothing left to supervise',
            };
    return finish('no-change', { nextCheck, allowedActions: [] });
}
/**
 * Clears a pause. TTY-confirmed (it widens effective authority) and only after
 * a COMPLETE `status` walk newer than the pause: the owner must have looked
 * at what happened first, and the activity that caused the pause is no longer
 * "new" to the next pass.
 */
async function clearPause(deps, args) {
    (0, runtime_support_js_1.refuseInsideSupervisedSession)(deps.env);
    (0, runtime_support_js_1.prepare)(deps);
    const journal = await (0, state_js_1.readJournal)(deps.dataDir);
    const sessionResource = (0, runtime_support_js_1.resolveSessionResource)(journal, args.session);
    const owner = owns(journal, sessionResource);
    const paused = owner.supervision?.paused;
    if (paused === undefined) {
        return (0, errors_js_1.throwAppError)('JULES_INVALID_STATE', 'this session is not paused', {
            recoveryAction: 'Nothing to clear.',
        });
    }
    if (owner.lastCompleteWalkAt === undefined ||
        owner.lastCompleteWalkAt <= paused.observedAt) {
        return (0, errors_js_1.throwAppError)('JULES_INVALID_STATE', 'no complete status walk has run since the pause', {
            recoveryAction: 'Run status for this session first, inspect it, then retry.',
        });
    }
    await (0, runtime_support_js_1.confirmOwner)(deps, [
        'yellow-jules: CLEAR SUPERVISION PAUSE',
        `  session:     ${sessionResource}`,
        `  paused for:  ${paused.reason}`,
        `  paused at:   ${paused.observedAt}`,
        '',
        'Supervised writes under the grant resume for this session.',
    ].join('\n'));
    await (0, state_js_1.updateSupervision)(deps.dataDir, owner.localRequestId, { paused: null, outsideSeen: null }, (0, runtime_support_js_1.nowFn)(deps));
    return {
        operation: 'supervise',
        localId: owner.localId,
        sessionResource,
        cleared: true,
    };
}
