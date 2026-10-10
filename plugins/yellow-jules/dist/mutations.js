"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.delegate = delegate;
exports.reply = reply;
exports.approve = approve;
exports.abandon = abandon;
const crypto = __importStar(require("node:crypto"));
const activity_walk_js_1 = require("./activity-walk.js");
const authority_js_1 = require("./authority.js");
const controller_js_1 = require("./controller.js");
const deadline_js_1 = require("./deadline.js");
const errors_js_1 = require("./errors.js");
const redact_js_1 = require("./redact.js");
const runtime_support_js_1 = require("./runtime-support.js");
const state_js_1 = require("./state.js");
const validate_js_1 = require("./validate.js");
const write_gate_js_1 = require("./write-gate.js");
const PROMPT_MAX_CHARS = 100_000;
const MESSAGE_MAX_CHARS = 32_000;
const TITLE_MAX_CHARS = 200;
const DERIVED_TITLE_CHARS = 60;
/** `approve`'s re-fetch is bounded by its time budget, not by the 20-page cap. */
const APPROVE_PAGE_CAP = 1000;
const APPROVE_REFETCH_SHARE = 0.4;
const DELEGATE_RECONCILE = 'Run status --reconcile; never relaunch (R16).';
const SESSION_RECONCILE = 'Run status --session <ref> --reconcile; never resend.';
function mintRequestId() {
    return `jr-${crypto.randomBytes(16).toString('hex')}`;
}
function validateText(value, label, maxChars) {
    if (value.trim().length === 0) {
        return (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', `${label} must not be empty`);
    }
    if (value.length > maxChars) {
        return (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', `${label} must be at most ${maxChars} characters`);
    }
    return value;
}
function validateTitle(value) {
    if (value.trim().length === 0 || value.length > TITLE_MAX_CHARS) {
        return (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', `--title must be 1-${TITLE_MAX_CHARS} characters`);
    }
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f]/.test(value)) {
        return (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', '--title must not contain control characters');
    }
    if (value.toLowerCase().includes('[yellow:')) {
        return (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', '--title must not contain the reconcile tag "[yellow:"');
    }
    return value;
}
/** Tag first, so vendor-side truncation cannot strip it (contract `delegate`). */
function vendorTitle(localId, title, prompt) {
    const base = (title ?? prompt.slice(0, DERIVED_TITLE_CHARS * 2))
        .replace(/\s+/g, ' ')
        .replace(/\[yellow:/gi, '[yellow-')
        .trim()
        .slice(0, title !== undefined ? TITLE_MAX_CHARS : DERIVED_TITLE_CHARS)
        .trim();
    return `[yellow:${localId}] ${base.length > 0 ? base : 'yellow-jules task'}`;
}
/** A write failure that is not already an AdapterError is, by construction, after dispatch. */
function asWriteError(err) {
    if (err instanceof errors_js_1.AdapterError || err instanceof errors_js_1.AppErrorException) {
        return err;
    }
    return new errors_js_1.AdapterError('malformed', err instanceof Error ? err.message : String(err), { cause: err, dispatched: true });
}
function expiredBeforeWrite() {
    return (0, errors_js_1.throwAppError)('JULES_DEADLINE_EXCEEDED', 'the operation deadline expired before any write was dispatched', {
        recoveryAction: 'Nothing was sent. Retry with a larger --deadline-ms.',
    });
}
/** Cap on chained retries so a runaway journal cannot grow the id without bound. */
const MAX_RETRY_ATTEMPTS = 50;
async function nextAttemptRequestId(deps, base) {
    // Location rules first: reading the journal creates the state directory.
    (0, runtime_support_js_1.prepare)(deps);
    const { operations } = await (0, state_js_1.readJournal)(deps.dataDir);
    let candidate = base;
    for (let attempt = 2; attempt <= MAX_RETRY_ATTEMPTS; attempt += 1) {
        const record = operations[candidate];
        if (record === undefined ||
            record.kind !== 'create' ||
            record.status !== 'failed' ||
            record.sessionResource !== undefined) {
            break;
        }
        candidate = `${base}.a${attempt}`;
    }
    return (0, validate_js_1.validateRequestId)(candidate);
}
async function delegate(deps, args) {
    const requested = args.requestId !== undefined
        ? (0, validate_js_1.validateRequestId)(args.requestId)
        : undefined;
    const localRequestId = requested === undefined
        ? mintRequestId()
        : args.retryFailed === true
            ? await nextAttemptRequestId(deps, requested)
            : requested;
    const localId = (0, validate_js_1.mintLocalId)();
    try {
        return await delegateInner(deps, args, { localRequestId, localId });
    }
    catch (err) {
        return (0, errors_js_1.rethrowWithContext)(err, { localRequestId, localId });
    }
}
async function delegateInner(deps, args, ids) {
    const repo = (0, validate_js_1.validateRepoInput)(args.repo);
    const repository = `${repo.owner}/${repo.repo}`;
    const branch = (0, validate_js_1.validateRef)(args.branch);
    const prompt = validateText(args.prompt, '--prompt', PROMPT_MAX_CHARS);
    const title = args.title !== undefined ? validateTitle(args.title) : undefined;
    const taskRef = args.taskRef !== undefined ? (0, validate_js_1.validateTaskRef)(args.taskRef) : undefined;
    if (taskRef === undefined) {
        (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', args.correction
            ? '--correction needs the --task-ref of the task being repaired (R44)'
            : 'a delegate needs --task-ref: grants cover named tasks only');
    }
    (0, runtime_support_js_1.prepare)(deps);
    const deadline = (0, deadline_js_1.deadlineIn)(deps.clock, args.deadlineMs ?? deadline_js_1.DEFAULT_MUTATION_DEADLINE_MS);
    const sourceResource = (0, validate_js_1.sourceResourceFor)(repo);
    if (!args.dryRun && args.grantId === undefined) {
        throw (0, write_gate_js_1.confirmationRequired)(deps, {
            operation: 'create',
            repository,
            requestedBranch: branch,
            ...(taskRef !== undefined ? { taskRef } : {}),
        }, ids);
    }
    const grantId = args.grantId !== undefined ? (0, validate_js_1.validateGrantId)(args.grantId) : undefined;
    return (0, runtime_support_js_1.withMutationAdapter)(deps, async (adapter) => {
        // R17: the source is discovered, never synthesized.
        const source = await (0, runtime_support_js_1.read)(deps, deadline, () => adapter.getSource(repo.owner, repo.repo));
        if (source.sourceResource !== sourceResource) {
            return (0, errors_js_1.throwAppError)('JULES_SOURCE_ACCESS', 'the discovered source does not match the requested repository');
        }
        if (args.dryRun || grantId === undefined) {
            return {
                operation: 'delegate',
                localRequestId: ids.localRequestId,
                localId: ids.localId,
                repository,
                requestedBranch: branch,
                sourceResource,
                ...(taskRef !== undefined ? { taskRef } : {}),
                ...(args.correction
                    ? {
                        launchGrantIds: (0, write_gate_js_1.plainLaunchGrantIds)(await (0, state_js_1.readJournal)(deps.dataDir), taskRef),
                    }
                    : {}),
                dryRun: true,
            };
        }
        if ((0, deadline_js_1.isExpired)(deps.clock, deadline))
            return expiredBeforeWrite();
        const reservation = await (0, write_gate_js_1.reserveUnderGrant)(deps, {
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
                promptDigest: (0, state_js_1.messageDigest)(prompt),
            },
        });
        if ((0, deadline_js_1.isExpired)(deps.clock, deadline)) {
            return (0, write_gate_js_1.settleExpiredBeforeWrite)(deps, reservation, DELEGATE_RECONCILE);
        }
        await (0, write_gate_js_1.assertGrantLiveBeforeWrite)(deps, reservation, DELEGATE_RECONCILE);
        let created;
        try {
            created = await adapter.createSession({
                prompt,
                owner: repo.owner,
                repo: repo.repo,
                baseBranch: branch,
                title: vendorTitle(ids.localId, title, prompt),
            });
        }
        catch (err) {
            return (0, write_gate_js_1.settleFailure)(deps, reservation, asWriteError(err), {
                reconcileHint: DELEGATE_RECONCILE,
            });
        }
        const vendorState = 'queued';
        await (0, write_gate_js_1.settleAcceptedOrUnknown)(deps, reservation, {
            sessionResource: created.sessionResource,
            vendorState,
            condition: (0, runtime_support_js_1.conditionOf)(vendorState),
        }, { what: 'session created', reconcileHint: DELEGATE_RECONCILE });
        return {
            operation: 'delegate',
            localRequestId: ids.localRequestId,
            localId: ids.localId,
            sessionResource: created.sessionResource,
            vendorState,
            condition: (0, runtime_support_js_1.conditionOf)(vendorState),
            repository,
            requestedBranch: branch,
            sourceResource,
        };
    });
}
async function resolveTarget(deps, sessionRef) {
    const journal = await (0, state_js_1.readJournal)(deps.dataDir);
    const sessionResource = (0, runtime_support_js_1.resolveSessionResource)(journal, sessionRef);
    return {
        sessionResource,
        owner: (0, state_js_1.findBySessionResource)(journal, sessionResource),
    };
}
/** Grants cover sessions created through this plugin; anything else has no repo, branch or task to match. */
function requireOwner(target, ids) {
    if (!(0, state_js_1.isOwningCreate)(target.owner)) {
        throw new errors_js_1.MutationErrorException((0, errors_js_1.makeAppError)('JULES_AUTHORITY_DENIED', `${target.sessionResource} was not created through this plugin, so no grant can cover it`, {
            recoveryAction: 'Grants cover sessions created by delegate. Act on this session in the Jules console.',
        }), ids);
    }
    return target.owner;
}
/** The repository, branch and task a grant must cover, when this plugin created the session. */
function scopeOf(target) {
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
async function reply(deps, args) {
    const localRequestId = args.requestId !== undefined
        ? (0, validate_js_1.validateRequestId)(args.requestId)
        : mintRequestId();
    const localId = (0, validate_js_1.mintLocalId)();
    try {
        return await replyInner(deps, args, { localRequestId, localId });
    }
    catch (err) {
        return (0, errors_js_1.rethrowWithContext)(err, { localRequestId, localId });
    }
}
function validateExpectedQuestion(args) {
    const { expectActivityId: id, expectQuestionDigest: digest } = args;
    if (id === undefined && digest === undefined)
        return undefined;
    if (id === undefined || digest === undefined) {
        return (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', '--expect-activity-id and --expect-question-digest must be given together');
    }
    const hasControl = [...id].some((c) => {
        const code = c.charCodeAt(0);
        return code < 32 || code === 127;
    });
    if (id.length === 0 || id.length > 512 || hasControl) {
        return (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', '--expect-activity-id must be a non-empty activity id');
    }
    if (!/^[0-9a-f]{64}$/.test(digest)) {
        return (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', '--expect-question-digest must be 64 lowercase hex characters');
    }
    return { activityId: id, digest };
}
/**
 * Refuses a reply unless the session still awaits one and its newest agent
 * message is the question the caller evaluated. A fresh, complete read right
 * before the reservation: like approve's plan check it narrows the race but the
 * POST cannot be made atomic with it.
 */
async function assertQuestionStillOpen(deps, adapter, sessionResource, liveCondition, expected, deadline) {
    const changed = (why) => (0, errors_js_1.throwAppError)('JULES_QUESTION_CHANGED', `${why}; nothing was sent`);
    if (liveCondition !== 'awaiting-reply') {
        return changed(`the session is ${liveCondition}, not awaiting a reply`);
    }
    let newest;
    const userMessages = [];
    const agentMessages = [];
    const walk = await (0, activity_walk_js_1.walkActivities)({
        adapter,
        sessionResource,
        pageSize: activity_walk_js_1.STATUS_PAGE_SIZE,
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
                    digest: (0, state_js_1.messageDigest)(activity.message ?? ''),
                });
            }
            if (activity.type === 'agentMessaged' &&
                (newest === undefined || (0, activity_walk_js_1.compareStamp)(activity, newest) > 0)) {
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
        return (0, errors_js_1.throwAppError)('JULES_INVALID_STATE', 'the session activity could not be completely re-read; nothing was sent', { recoveryAction: 'Retry with a larger --deadline-ms.' });
    }
    if (newestPlanAmbiguous(agentMessages)) {
        return changed('two different questions share the newest timestamp, so the current one cannot be told');
    }
    const current = newest;
    // The review saw the redacted question; an answer to text redaction hid
    // cannot be bound to what was shown.
    if (current?.message !== undefined &&
        (0, redact_js_1.redact)(current.message) !== current.message) {
        (0, errors_js_1.throwAppError)('JULES_INVALID_STATE', 'the pending question contains credential-shaped text that is redacted from the review; it cannot be answered unseen. Nothing was sent', {
            recoveryAction: 'Read the question in the Jules console and answer it there.',
        });
    }
    if (current === undefined ||
        current.message === undefined ||
        current.activityId !== expected.activityId ||
        (0, state_js_1.messageDigest)(current.message) !== expected.digest) {
        return changed('the session no longer awaits the question the pass showed');
    }
    if (await hasUnclaimedUserMessage(deps, sessionResource, userMessages, current)) {
        return changed('a user message arrived after the question and was not sent by this plugin');
    }
}
/**
 * True when a user message newer than `after` is not one of this plugin's
 * claimed echoes: someone else is steering the session. A complete re-read does
 * not classify it, so the write fails closed and the next `status` records it.
 */
async function hasUnclaimedUserMessage(deps, sessionResource, userMessages, after) {
    const claimed = new Set(
    // Activity ids carry no session, so only this session's claims count.
    Object.values((await (0, state_js_1.readJournal)(deps.dataDir)).operations).flatMap((r) => r.echoActivityId !== undefined && r.sessionResource === sessionResource
        ? [r.echoActivityId]
        : []));
    // Freshness check: opaque activity ids carry no order, so a message at the
    // same createTime as `after` may be later. Equal time counts as after.
    return userMessages.some((u) => !claimed.has(u.activityId) && !stampBefore(u, after));
}
/** Strictly earlier by createTime alone; equal time is never "before". */
function stampBefore(a, b) {
    return ((0, activity_walk_js_1.compareStamp)({ createTime: a.createTime, activityId: '' }, { createTime: b.createTime, activityId: '' }) < 0);
}
function targetChanged(code, why) {
    return new errors_js_1.AppErrorException((0, errors_js_1.makeAppError)(code, `${why}; nothing was sent`, {
        recoveryAction: 'Run status, evaluate the session again, then retry.',
    }));
}
/** Refusal when the floor walk met a user message this plugin did not send. */
function outsideBeforeWrite() {
    return new errors_js_1.AppErrorException((0, errors_js_1.makeAppError)('JULES_SUPERVISION_PAUSED', 'a user message not sent by this plugin arrived before the write; outside activity was recorded and nothing was sent', {
        recoveryAction: 'Review the session, then run supervise --clear-pause before writing again.',
    }));
}
/** Refusal when the pre-dispatch floor could not be read: nothing was sent. */
function floorUnreadable() {
    return new errors_js_1.AppErrorException((0, errors_js_1.makeAppError)('JULES_SERVICE_UNAVAILABLE', "the session's activity could not be completely read before the write, so its echo could never be ordered; nothing was sent", { recoveryAction: 'Retry the write; no request was dispatched.' }));
}
/**
 * Reads the session's newest activity right before a reply or approve is sent,
 * so a later echo can be ordered against the dispatch on the vendor's clock
 * alone. Starts from the owner's stored status watermark when there is one. A
 * failed or partial read yields no floor, and the caller refuses the write
 * before the POST rather than send one whose echo could never bind.
 */
async function readVendorFloor(deps, adapter, sessionResource, owner, deadline, expect = {}) {
    const stored = owner.lastActivityCreateTime !== undefined &&
        owner.lastActivityId !== undefined
        ? {
            createTime: owner.lastActivityCreateTime,
            activityId: owner.lastActivityId,
        }
        : undefined;
    try {
        // User messages this walk sees were never classified: a teammate's message
        // that arrived since the last status (or since preflight) must not be
        // dispatched over. They get the same own-echo / outside-activity
        // classification as a status walk.
        const userMessages = [];
        const agentMessages = [];
        const walkStartedAt = (0, runtime_support_js_1.nowFn)(deps)().toISOString();
        const walkSeq = await (0, state_js_1.takeSeq)(deps.dataDir);
        const walk = await (0, activity_walk_js_1.walkActivities)({
            adapter,
            sessionResource,
            pageSize: activity_walk_js_1.STATUS_PAGE_SIZE,
            start: stored !== undefined
                ? { kind: 'watermark', ...stored }
                : { kind: 'session-start' },
            clock: deps.clock,
            deadline,
            pageCap: APPROVE_PAGE_CAP,
            ring: owner.recentActivityIds,
            ...(stored !== undefined ? { watermark: stored } : {}),
            ...(owner.pendingPlan !== undefined
                ? { pendingPlan: owner.pendingPlan }
                : {}),
            onActivity: (activity, info) => {
                if (info.unseen &&
                    activity.type === 'userMessaged' &&
                    activity.message !== undefined) {
                    userMessages.push({
                        activityId: activity.activityId,
                        digest: (0, state_js_1.messageDigest)(activity.message),
                        createTime: activity.createTime,
                        observedAt: (0, runtime_support_js_1.nowFn)(deps)().toISOString(),
                    });
                }
                if (activity.type === 'agentMessaged') {
                    agentMessages.push({
                        activityId: activity.activityId,
                        createTime: activity.createTime,
                        digest: (0, state_js_1.messageDigest)(activity.message ?? ''),
                    });
                }
            },
        });
        if (!walk.complete)
            return undefined;
        if (userMessages.length > 0) {
            const held = [];
            const outside = await (0, state_js_1.claimOwnEchoes)(deps.dataDir, sessionResource, userMessages, {
                ownerRequestId: owner.localRequestId,
                observedAt: (0, runtime_support_js_1.nowFn)(deps)().toISOString(),
                walkStartedAt,
                walkSeq,
            }, held, true);
            // Unclaimed (outside) or held (an in-flight write might explain it):
            // either way the session is not provably ours alone.
            if (outside !== undefined || held.length > 0) {
                return outsideBeforeWrite();
            }
        }
        // The target the write was approved against must still be current on this
        // same complete walk.
        if (expect.plan !== undefined) {
            const { planId, digest, code } = expect.plan;
            const current = walk.pendingPlan;
            if (current?.ambiguous === true) {
                return targetChanged(code, 'two different plans share the newest timestamp, so the current plan cannot be told');
            }
            if (current === null ||
                current === undefined ||
                current.planId !== planId ||
                (digest !== undefined &&
                    (0, state_js_1.planDigest)(current.planId, (0, redact_js_1.redactDeep)(current).steps) !== digest)) {
                return targetChanged(code, 'the pending plan is no longer the reviewed plan (id or digest)');
            }
        }
        if (expect.question !== undefined) {
            if (newestPlanAmbiguous(agentMessages)) {
                return targetChanged('JULES_QUESTION_CHANGED', 'two different questions share the newest timestamp, so the current one cannot be told');
            }
            let newestMsg;
            for (const m of agentMessages) {
                if (newestMsg === undefined || (0, activity_walk_js_1.compareStamp)(m, newestMsg) > 0) {
                    newestMsg = m;
                }
            }
            if (newestMsg !== undefined &&
                (newestMsg.activityId !== expect.question.activityId ||
                    newestMsg.digest !== expect.question.digest)) {
                return targetChanged('JULES_QUESTION_CHANGED', 'the session no longer awaits the question the pass showed');
            }
        }
        const newest = walk.newest !== undefined &&
            (stored === undefined || (0, activity_walk_js_1.compareStamp)(walk.newest, stored) > 0)
            ? walk.newest
            : stored;
        return newest ?? 'empty';
    }
    catch {
        return undefined;
    }
}
/**
 * True when more than one plan with differing digests shares the newest
 * createTime: which one is current is unknowable from opaque ids, so the
 * caller refuses rather than pick one by id order.
 */
function newestPlanAmbiguous(plans) {
    let newest;
    for (const p of plans) {
        if (newest === undefined || stampBefore(newest, p))
            newest = p;
    }
    if (newest === undefined)
        return false;
    const top = newest;
    return (new Set(plans.filter((p) => !stampBefore(p, top)).map((p) => p.digest))
        .size > 1);
}
function validateExpectedPlan(args, haveQuestion) {
    const { expectPlanId: id, expectPlanDigest: digest } = args;
    if (id === undefined && digest === undefined)
        return undefined;
    if (id === undefined || digest === undefined) {
        return (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', '--expect-plan-id and --expect-plan-digest must be given together');
    }
    if (haveQuestion) {
        return (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', 'a reply expects either a question or a plan, not both');
    }
    const planId = (0, validate_js_1.validatePlanId)(id, 'input');
    if (!/^[0-9a-f]{64}$/.test(digest)) {
        return (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', '--expect-plan-digest must be 64 lowercase hex characters');
    }
    return { planId, digest };
}
/**
 * Refuses a reply unless the session still awaits plan approval and its newest
 * pending plan is the one the caller reviewed (id and digest). Same shape and
 * the same race limit as `assertQuestionStillOpen`.
 */
async function assertPlanStillPending(deps, adapter, target, liveCondition, expected, deadline) {
    const changed = (why) => (0, errors_js_1.throwAppError)('JULES_QUESTION_CHANGED', `${why}; nothing was sent`);
    if (liveCondition !== 'awaiting-approval') {
        return changed(`the session is ${liveCondition}, not awaiting plan approval`);
    }
    const pending = target.owner?.pendingPlan;
    if (pending === undefined) {
        return changed('no pending plan is recorded for this session');
    }
    const userMessages = [];
    const plans = [];
    const walk = await (0, activity_walk_js_1.walkActivities)({
        adapter,
        sessionResource: target.sessionResource,
        pageSize: activity_walk_js_1.STATUS_PAGE_SIZE,
        start: {
            kind: 'watermark',
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
                    digest: (0, state_js_1.planDigest)(activity.plan.planId, (0, redact_js_1.redactDeep)({ steps: activity.plan.steps }).steps),
                });
            }
        },
    });
    if (!walk.complete)
        return incompleteRefetch(walk);
    if (newestPlanAmbiguous(plans) || walk.pendingPlan?.ambiguous === true) {
        return changed('two different plans share the newest timestamp, so the current one cannot be told');
    }
    const current = walk.pendingPlan;
    if (current !== null && current !== undefined)
        assertPlanReviewable(current);
    if (current === null ||
        current === undefined ||
        current.planId !== expected.planId ||
        (0, state_js_1.planDigest)(current.planId, (0, redact_js_1.redactDeep)(current).steps) !== expected.digest) {
        return changed('the session no longer has the plan the pass showed');
    }
    if (await hasUnclaimedUserMessage(deps, target.sessionResource, userMessages, {
        activityId: current.activityId,
        createTime: current.activityCreateTime,
    })) {
        return changed('a user message arrived after the reviewed plan and was not sent by this plugin');
    }
}
/**
 * Redaction hides part of a plan from the review, and the plan digest hashes the
 * redacted text, so plans differing only in the hidden value would share a
 * digest. A plan redaction changed cannot be approved or replied to unseen.
 */
function assertPlanReviewable(plan) {
    const steps = plan
        .steps;
    const hidden = (steps ?? []).some((step) => [step['title'], step['description']].some((text) => typeof text === 'string' && redact_js_1.HIDDEN_CHARS_RE.test(text)));
    if (hidden) {
        (0, errors_js_1.throwAppError)('JULES_INVALID_STATE', 'the pending plan contains hidden characters (control, bidi or zero-width) that the review would replace; it cannot be acted on unseen. Nothing was sent', {
            recoveryAction: 'Review this plan in the Jules console, or ask for a plan without hidden characters.',
        });
    }
    if (JSON.stringify((0, redact_js_1.redactDeep)(plan)) !== JSON.stringify(plan)) {
        (0, errors_js_1.throwAppError)('JULES_INVALID_STATE', 'the pending plan contains credential-shaped text that is redacted from the review; it cannot be acted on unseen. Nothing was sent', {
            recoveryAction: 'Review this plan in the Jules console, or ask for a plan without credentials.',
        });
    }
}
function validateReplyKind(kind, question, plan) {
    if (kind === undefined)
        return;
    const bad = (m) => (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', m);
    if (kind === 'question' && question === undefined) {
        bad('--reply-kind question requires --expect-activity-id and --expect-question-digest');
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
async function replyInner(deps, args, ids) {
    const message = validateText(args.message, '--message', MESSAGE_MAX_CHARS);
    const expectQuestion = validateExpectedQuestion(args);
    const expectPlan = validateExpectedPlan(args, expectQuestion !== undefined);
    validateReplyKind(args.replyKind, expectQuestion, expectPlan);
    (0, runtime_support_js_1.prepare)(deps);
    const deadline = (0, deadline_js_1.deadlineIn)(deps.clock, args.deadlineMs ?? deadline_js_1.DEFAULT_MUTATION_DEADLINE_MS);
    const target = await resolveTarget(deps, args.session);
    if (!args.dryRun && args.grantId === undefined) {
        throw (0, write_gate_js_1.confirmationRequired)(deps, { operation: 'reply', ...scopeOf(target) }, ids);
    }
    return (0, runtime_support_js_1.withMutationAdapter)(deps, async (adapter) => {
        if (args.dryRun) {
            await (0, runtime_support_js_1.read)(deps, deadline, () => adapter.getSession(target.sessionResource));
            return {
                operation: 'reply',
                localRequestId: ids.localRequestId,
                localId: ids.localId,
                sessionResource: target.sessionResource,
                sent: false,
                dryRun: true,
                ...scopeOf(target),
            };
        }
        const grantId = (0, validate_js_1.validateGrantId)(args.grantId);
        const owner = requireOwner(target, ids);
        // A reply to a finished session would reopen it, past the active-session
        // limit that freed its slot. The journal's condition is the last status
        // call's, so read the live session right before reserving. A repair is a
        // new delegate instead.
        const live = await (0, runtime_support_js_1.read)(deps, deadline, () => adapter.getSession(target.sessionResource));
        const liveCondition = (0, runtime_support_js_1.conditionOf)(live.vendorState);
        if ((0, runtime_support_js_1.isTerminalCondition)(liveCondition)) {
            throw new errors_js_1.MutationErrorException((0, errors_js_1.makeAppError)('JULES_INVALID_STATE', `the session is ${liveCondition}; a reply does not reopen a finished session`, {
                recoveryAction: 'For a repair, run delegate with --correction and the same --task-ref.',
            }), ids);
        }
        if (expectQuestion !== undefined) {
            await assertQuestionStillOpen(deps, adapter, target.sessionResource, liveCondition, expectQuestion, deadline);
        }
        if (expectPlan !== undefined) {
            await assertPlanStillPending(deps, adapter, target, liveCondition, expectPlan, deadline);
        }
        if ((0, deadline_js_1.isExpired)(deps.clock, deadline))
            return expiredBeforeWrite();
        const reservation = await (0, write_gate_js_1.reserveUnderGrant)(deps, {
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
                promptDigest: (0, state_js_1.messageDigest)(message),
            },
        });
        if ((0, deadline_js_1.isExpired)(deps.clock, deadline)) {
            return (0, write_gate_js_1.settleExpiredBeforeWrite)(deps, reservation, SESSION_RECONCILE);
        }
        const replyFloor = await readVendorFloor(deps, adapter, target.sessionResource, owner, deadline, {
            ...(expectPlan !== undefined
                ? {
                    plan: {
                        planId: expectPlan.planId,
                        digest: expectPlan.digest,
                        code: 'JULES_QUESTION_CHANGED',
                    },
                }
                : {}),
            ...(expectQuestion !== undefined ? { question: expectQuestion } : {}),
        });
        if ((0, deadline_js_1.isExpired)(deps.clock, deadline)) {
            return (0, write_gate_js_1.settleExpiredBeforeWrite)(deps, reservation, SESSION_RECONCILE);
        }
        if (replyFloor === undefined) {
            return (0, write_gate_js_1.settleFailure)(deps, reservation, floorUnreadable(), {
                reconcileHint: SESSION_RECONCILE,
            });
        }
        if (replyFloor instanceof errors_js_1.AppErrorException) {
            return (0, write_gate_js_1.settleFailure)(deps, reservation, replyFloor, {
                reconcileHint: SESSION_RECONCILE,
            });
        }
        await (0, write_gate_js_1.assertGrantLiveBeforeWrite)(deps, reservation, SESSION_RECONCILE, replyFloor);
        try {
            await adapter.sendMessage(target.sessionResource, message);
        }
        catch (err) {
            return (0, write_gate_js_1.settleFailure)(deps, reservation, asWriteError(err), {
                reconcileHint: SESSION_RECONCILE,
            });
        }
        await (0, write_gate_js_1.settleAcceptedOrUnknown)(deps, reservation, { sessionResource: target.sessionResource }, { what: 'message sent', reconcileHint: SESSION_RECONCILE });
        return {
            operation: 'reply',
            localRequestId: ids.localRequestId,
            localId: ids.localId,
            sessionResource: target.sessionResource,
            sent: true,
        };
    });
}
function incompleteRefetch(walk) {
    const cause = walk.stopReason === 'unmapped'
        ? 'an activity the SDK mapper cannot parse'
        : walk.stopReason === 'page-failure'
            ? 'a page failure'
            : 'the time or page budget';
    const recoveryAction = walk.stopReason === 'unmapped'
        ? 'Re-verify the SDK pin with /jules:setup; a larger deadline will not help.'
        : walk.stopReason === 'page-failure'
            ? 'Retry; if it repeats, run status.'
            : 'Retry with a larger --deadline-ms.';
    return (0, errors_js_1.throwAppError)('JULES_INVALID_STATE', `the pending plan could not be completely re-read (${cause}); nothing was approved`, { recoveryAction });
}
/**
 * R34. The vendor's approve endpoint takes NO plan id: it approves whatever
 * plan is pending when the POST lands. Comparing `--plan-id` with a fresh,
 * complete re-fetch immediately before the POST therefore narrows the race but
 * cannot close it — compare-and-approve is not atomic. The post-POST re-read
 * records a deviation (R34) when the plan that was actually approved differs.
 */
async function approve(deps, args) {
    const localRequestId = args.requestId !== undefined
        ? (0, validate_js_1.validateRequestId)(args.requestId)
        : mintRequestId();
    const localId = (0, validate_js_1.mintLocalId)();
    try {
        return await approveInner(deps, args, { localRequestId, localId });
    }
    catch (err) {
        return (0, errors_js_1.rethrowWithContext)(err, { localRequestId, localId });
    }
}
async function approveInner(deps, args, ids) {
    const planId = (0, validate_js_1.validatePlanId)(args.planId, 'input');
    if (args.expectPlanDigest !== undefined &&
        !/^[0-9a-f]{64}$/.test(args.expectPlanDigest)) {
        (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', '--expect-plan-digest must be 64 lowercase hex characters');
    }
    (0, runtime_support_js_1.prepare)(deps);
    const totalMs = args.deadlineMs ?? deadline_js_1.DEFAULT_MUTATION_DEADLINE_MS;
    const deadline = (0, deadline_js_1.deadlineIn)(deps.clock, totalMs);
    const target = await resolveTarget(deps, args.session);
    if (!args.dryRun && args.grantId === undefined) {
        throw (0, write_gate_js_1.confirmationRequired)(deps, { operation: 'approve', ...scopeOf(target) }, ids);
    }
    if (!args.dryRun && args.expectPlanDigest === undefined) {
        (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', 'approve requires --expect-plan-digest: the sha256 of the plan you reviewed');
    }
    const pending = target.owner?.pendingPlan;
    if (pending === undefined) {
        return (0, errors_js_1.throwAppError)('JULES_INVALID_STATE', 'no pending plan is recorded for this session', { recoveryAction: 'Run status for this session, then retry.' });
    }
    const start = {
        kind: 'watermark',
        createTime: pending.activityCreateTime,
        activityId: pending.activityId,
    };
    return (0, runtime_support_js_1.withMutationAdapter)(deps, async (adapter) => {
        const session = await (0, runtime_support_js_1.read)(deps, deadline, () => adapter.getSession(target.sessionResource));
        if (session.vendorState !== 'awaitingPlanApproval') {
            return (0, errors_js_1.throwAppError)('JULES_INVALID_STATE', `the session is ${(0, runtime_support_js_1.conditionOf)(session.vendorState)}, not awaiting plan approval`);
        }
        // A real call re-fetches inside 40% of the deadline; a dry run may use it all.
        const refetchDeadline = args.dryRun
            ? deadline
            : (0, deadline_js_1.deadlineIn)(deps.clock, Math.floor(totalMs * APPROVE_REFETCH_SHARE));
        const userMessages = [];
        const plans = [];
        const refetch = await (0, activity_walk_js_1.walkActivities)({
            adapter,
            sessionResource: target.sessionResource,
            pageSize: activity_walk_js_1.STATUS_PAGE_SIZE,
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
                        digest: (0, state_js_1.planDigest)(activity.plan.planId, (0, redact_js_1.redactDeep)({ steps: activity.plan.steps }).steps),
                    });
                }
            },
        });
        if (!refetch.complete)
            return incompleteRefetch(refetch);
        const ambiguous = newestPlanAmbiguous(plans) || refetch.pendingPlan?.ambiguous === true;
        const steered = await hasUnclaimedUserMessage(deps, target.sessionResource, userMessages, start);
        const newest = refetch.pendingPlan;
        if (newest === null || newest === undefined) {
            return (0, errors_js_1.throwAppError)('JULES_INVALID_STATE', 'the vendor shows no pending plan for this session', { recoveryAction: 'Run status for this session, then retry.' });
        }
        if (args.dryRun) {
            const changed = ambiguous ||
                newest.planId !== planId ||
                (args.expectPlanDigest !== undefined &&
                    (0, state_js_1.planDigest)(newest.planId, (0, redact_js_1.redactDeep)(newest).steps) !==
                        args.expectPlanDigest);
            return {
                operation: 'approve',
                localRequestId: ids.localRequestId,
                localId: ids.localId,
                sessionResource: target.sessionResource,
                dryRun: true,
                observedPlanId: newest.planId,
                ...scopeOf(target),
                ...(0, runtime_support_js_1.attentionOf)(changed || steered ? ['planChanged'] : []),
            };
        }
        // A user message after the reviewed plan that this plugin did not send may
        // have changed what the plan means; the re-read does not classify it.
        // Rejected whatever the cached pause state says: the owner may clear that
        // pause between resolving the target and the reservation. A session that
        // already records outside activity gets the more specific code.
        if (steered) {
            const alreadyPaused = target.owner?.supervision?.paused !== undefined ||
                target.owner?.supervision?.outsideSeen !== undefined;
            return alreadyPaused
                ? (0, errors_js_1.throwAppError)('JULES_SUPERVISION_PAUSED', 'outside activity was recorded on this session; no grant-backed write is allowed until supervise --clear-pause')
                : (0, errors_js_1.throwAppError)('JULES_INVALID_STATE', 'a user message arrived after the reviewed plan and was not sent by this plugin; nothing was approved', {
                    recoveryAction: 'Run status to record it, read the session, then evaluate the plan again.',
                });
        }
        assertPlanReviewable(newest);
        if (ambiguous) {
            return (0, errors_js_1.throwAppError)('JULES_POLICY_DEVIATION', 'two different plans share the newest timestamp, so the current plan cannot be told; nothing was approved', {
                recoveryAction: 'Run status, evaluate the plans in the Jules console, and approve once one is clearly newest.',
            });
        }
        if (newest.planId !== planId ||
            (0, state_js_1.planDigest)(newest.planId, (0, redact_js_1.redactDeep)(newest).steps) !==
                args.expectPlanDigest) {
            return (0, errors_js_1.throwAppError)('JULES_POLICY_DEVIATION', 'the newest pending plan differs from the reviewed plan (id or digest); nothing was approved', {
                recoveryAction: 'Run status, evaluate the new plan, and approve that plan id.',
            });
        }
        const grantId = (0, validate_js_1.validateGrantId)(args.grantId);
        const owner = requireOwner(target, ids);
        if ((0, deadline_js_1.isExpired)(deps.clock, deadline))
            return expiredBeforeWrite();
        const reservation = await (0, write_gate_js_1.reserveUnderGrant)(deps, {
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
        if ((0, deadline_js_1.isExpired)(deps.clock, deadline)) {
            return (0, write_gate_js_1.settleExpiredBeforeWrite)(deps, reservation, SESSION_RECONCILE);
        }
        const approveFloor = await readVendorFloor(deps, adapter, target.sessionResource, owner, deadline, {
            plan: {
                planId,
                ...(args.expectPlanDigest !== undefined
                    ? { digest: args.expectPlanDigest }
                    : {}),
                code: 'JULES_POLICY_DEVIATION',
            },
        });
        if ((0, deadline_js_1.isExpired)(deps.clock, deadline)) {
            return (0, write_gate_js_1.settleExpiredBeforeWrite)(deps, reservation, SESSION_RECONCILE);
        }
        if (approveFloor === undefined) {
            return (0, write_gate_js_1.settleFailure)(deps, reservation, floorUnreadable(), {
                reconcileHint: SESSION_RECONCILE,
            });
        }
        if (approveFloor instanceof errors_js_1.AppErrorException) {
            return (0, write_gate_js_1.settleFailure)(deps, reservation, approveFloor, {
                reconcileHint: SESSION_RECONCILE,
            });
        }
        await (0, write_gate_js_1.assertGrantLiveBeforeWrite)(deps, reservation, SESSION_RECONCILE, approveFloor);
        try {
            await adapter.approvePlan(target.sessionResource);
        }
        catch (err) {
            return (0, write_gate_js_1.settleFailure)(deps, reservation, asWriteError(err), {
                reconcileHint: SESSION_RECONCILE,
            });
        }
        await (0, write_gate_js_1.settleAcceptedOrUnknown)(deps, reservation, { sessionResource: target.sessionResource }, { what: 'plan approved', reconcileHint: SESSION_RECONCILE });
        // The POST was answered 2xx. Everything below is verification and can never
        // turn the success into a failure envelope.
        const verified = await verifyApproval(deps, adapter, target.sessionResource, start, deadline, args.expectPlanDigest);
        let deviated = false;
        let deviationUnrecorded = false;
        if (((verified.observedPlanIdAfter !== null &&
            verified.observedPlanIdAfter !== planId) ||
            verified.planChanged) &&
            target.owner !== undefined) {
            deviated = true;
            try {
                await (0, state_js_1.recordDeviation)(deps.dataDir, target.owner.localRequestId, {
                    kind: 'policy-deviation',
                    reason: 'the plan approved by the vendor differs from the plan evaluated before approval',
                }, (0, runtime_support_js_1.nowFn)(deps));
            }
            catch (err) {
                // The approval already happened; never turn it into a failure envelope.
                // The deviation is still reported, with the missed bookkeeping flagged.
                deviationUnrecorded = true;
                process.stderr.write(`warning: plan approved but the deviation could not be recorded: ${(0, errors_js_1.errorLabel)(err)}\n`);
            }
        }
        return {
            operation: 'approve',
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
            ...(deviated ? { policyDeviation: true } : {}),
            ...(0, runtime_support_js_1.attentionOf)([
                ...(verified.deferred ? ['verificationDeferred'] : []),
                ...(deviated ? ['policyDeviation'] : []),
                ...(deviationUnrecorded ? ['deviationUnrecorded'] : []),
            ]),
        };
    });
}
/** Post-POST re-read from the same start: which plan did the vendor record as approved? */
async function verifyApproval(deps, adapter, sessionResource, start, deadline, expectedDigest) {
    const generated = [];
    let approvedPlanId;
    let approvedAmbiguous = false;
    let approvedStamp;
    try {
        const walk = await (0, activity_walk_js_1.walkActivities)({
            adapter,
            sessionResource,
            pageSize: activity_walk_js_1.STATUS_PAGE_SIZE,
            start,
            clock: deps.clock,
            deadline,
            pageCap: APPROVE_PAGE_CAP,
            onActivity: (activity) => {
                if (activity.type === 'planGenerated' && activity.plan !== undefined) {
                    generated.push({
                        createTime: activity.createTime,
                        activityId: activity.activityId,
                        digest: (0, state_js_1.planDigest)(activity.plan.planId, (0, redact_js_1.redactDeep)({ steps: activity.plan.steps }).steps),
                    });
                }
                // Approvals are ordered by createTime alone: one at the reviewed plan's
                // own time is unordered evidence (opaque ids carry no order), kept, not
                // discarded. Several at the newest time that name different plans leave
                // the approved plan unknowable.
                if (activity.type === 'planApproved' &&
                    activity.approvedPlanId !== undefined &&
                    !stampBefore(activity, start)) {
                    const cmp = approvedStamp === undefined
                        ? 1
                        : (0, activity_walk_js_1.compareStamp)({ createTime: activity.createTime, activityId: '' }, { createTime: approvedStamp.createTime, activityId: '' });
                    if (cmp > 0) {
                        approvedStamp = {
                            createTime: activity.createTime,
                            activityId: activity.activityId,
                        };
                        approvedPlanId = activity.approvedPlanId;
                        approvedAmbiguous = false;
                    }
                    else if (cmp === 0 && activity.approvedPlanId !== approvedPlanId) {
                        approvedAmbiguous = true;
                    }
                }
            },
        });
        const observed = approvedPlanId ?? null;
        // The plan the vendor approved is the newest one generated before the
        // approval. The same id with other steps is a replacement under the
        // reviewed id, which the id comparison alone cannot see.
        const stamp = approvedStamp;
        const candidates = stamp === undefined ? [] : generated.filter((g) => stampBefore(g, stamp));
        const before = [...candidates].sort((a, b) => (0, activity_walk_js_1.compareStamp)({ createTime: b.createTime, activityId: '' }, { createTime: a.createTime, activityId: '' }))[0];
        // Equal-time plans with differing digests: the approved one is unknowable.
        // A plan stamped at the approval's own time is unordered against it (the
        // ids are opaque), so one that differs from the reviewed digest counts.
        const atApproval = stamp === undefined
            ? []
            : generated.filter((g) => !stampBefore(g, stamp) && !stampBefore(stamp, g));
        const ambiguous = approvedAmbiguous ||
            newestPlanAmbiguous(candidates) ||
            (expectedDigest !== undefined &&
                atApproval.some((g) => g.digest !== expectedDigest));
        return {
            observedPlanIdAfter: observed,
            planChanged: ambiguous ||
                (before !== undefined &&
                    expectedDigest !== undefined &&
                    before.digest !== expectedDigest),
            // A partial read, or a complete one that has not yet seen the approval, cannot confirm.
            deferred: !walk.complete || observed === null,
            partial: walk.partialPagination,
            pages: walk.pages,
        };
    }
    catch (err) {
        // The approval already happened: whatever broke here, verification is
        // deferred, never a failure envelope. The label says why.
        process.stderr.write(`warning: plan approved but verification could not complete: ${(0, errors_js_1.errorLabel)(err)}\n`);
        return {
            observedPlanIdAfter: null,
            deferred: true,
            partial: true,
            pages: 0,
            planChanged: false,
        };
    }
}
function abandonable(record, id) {
    if (record === undefined) {
        return (0, errors_js_1.throwAppError)('JULES_NOT_FOUND', `no journal record for ${id}`);
    }
    const outcome = record.lastReconcile?.outcome;
    // A reply or approve has no sessions walk to settle it: a complete walk that
    // finds no match leaves `unknown-outcome` for good, so that outcome qualifies
    // for it (a create is settled by `released`, never by this).
    const stuck = (record.kind === 'reply' || record.kind === 'approve') &&
        outcome === 'unknown-outcome';
    if (!state_js_1.UNRESOLVED_STATUSES.has(record.status) ||
        (outcome !== 'ambiguous-reconcile' && outcome !== 'not-reached' && !stuck)) {
        return (0, errors_js_1.throwAppError)('JULES_INVALID_STATE', `${id} cannot be abandoned: only an unresolved operation whose last reconcile was ambiguous-reconcile or not-reached (or, for a reply or approve, unknown-outcome) qualifies`, { recoveryAction: 'Run status --reconcile first.' });
    }
    return record;
}
/**
 * Marks a reservation reconcile could not settle terminal `failed` (R36's
 * escape hatch). It widens effective authority — it frees the repository and
 * branch guard and an active-session slot — so it is TTY-confirmed, never
 * grant-confirmed.
 */
async function abandon(deps, args) {
    (0, runtime_support_js_1.refuseInsideSupervisedSession)(deps.env, 'abandon');
    const requestId = (0, validate_js_1.validateRequestId)(args.requestId);
    (0, runtime_support_js_1.prepare)(deps);
    const first = abandonable((await (0, state_js_1.readJournal)(deps.dataDir)).operations[requestId], requestId);
    const reason = [
        first.lastReconcile?.outcome ?? 'unresolved',
        ...(first.lastReconcile?.reason !== undefined
            ? [first.lastReconcile.reason]
            : []),
    ].join(': ');
    await (0, runtime_support_js_1.confirmOwner)(deps, [
        'yellow-jules: ABANDON OPERATION',
        `  request id:  ${first.localRequestId}`,
        `  kind:        ${first.kind}`,
        `  repository:  ${first.repository ?? '(none)'}`,
        `  branch:      ${first.requestedBranch ?? '(none)'}`,
        `  reconcile:   ${reason}`,
        '',
        'The vendor may still hold a session for this operation. Abandoning frees the',
        'repository/branch guard and the grant slot so a new delegate can run.',
    ].join('\n'));
    const ctx = (0, runtime_support_js_1.resolveControllerContext)(deps);
    return (0, state_js_1.withJournalLock)(deps.dataDir, async () => {
        const journal = await (0, state_js_1.readJournal)(deps.dataDir);
        // Re-check under the lock: the record may have been reconciled while the owner typed.
        const record = abandonable(journal.operations[requestId], requestId);
        // Every check that can refuse runs BEFORE the first write, so a refusal
        // leaves the record exactly as it was. A grant that no longer exists holds
        // no slot, but one that does must still be bound to this controller.
        let grants;
        let grantId;
        if (record.grantId !== undefined) {
            const loaded = (0, authority_js_1.loadGrants)(deps.dataDir);
            const grant = loaded.grants[record.grantId];
            if (grant !== undefined) {
                (0, controller_js_1.assertControllerAuthority)(ctx.controllerDir, deps.dataDir, grant.epochRef, ctx.controllerId);
                if (record.kind === 'create' &&
                    grant.usage.activeSessionRefs.includes(record.localRequestId)) {
                    grants = loaded;
                    grantId = grant.grantId;
                }
            }
        }
        const now = (0, runtime_support_js_1.nowFn)(deps)().toISOString();
        journal.operations[requestId] = (0, state_js_1.applyRetention)({
            ...record,
            status: 'failed',
            abandonedAt: now,
            abandonReason: reason,
            updatedAt: now,
        });
        await (0, state_js_1.writeJournal)(deps.dataDir, journal, [requestId]);
        // Journal first: a crash before the next line leaks a slot, which only
        // makes the grant stricter.
        let slotReleased = false;
        if (grants !== undefined && grantId !== undefined) {
            try {
                (0, authority_js_1.writeGrants)(deps.dataDir, (0, authority_js_1.updateGrant)(grants, grantId, (g) => (0, authority_js_1.releaseGrant)(g, record.localRequestId)));
                slotReleased = true;
            }
            catch (err) {
                // The abandon already took effect; report it with the slot still held
                // instead of an error a retry could not act on.
                process.stderr.write(`warning: abandoned ${record.localRequestId} but could not release its grant slot: ${(0, errors_js_1.errorLabel)(err)}\n`);
            }
        }
        return {
            operation: 'abandon',
            localRequestId: record.localRequestId,
            localId: record.localId,
            abandoned: true,
            released: {
                ...(record.grantId !== undefined ? { grantId: record.grantId } : {}),
                slotReleased,
            },
        };
    });
}
