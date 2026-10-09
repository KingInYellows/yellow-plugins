"use strict";
/**
 * `status --reconcile` (contract `status`, R16, R36). Resolves every
 * outstanding `reserved` and `unknown-outcome` operation in scope without ever
 * relaunching anything:
 *
 * - `delegate` reservations share ONE sessions walk (pages of 100, at most 5,
 *   `persist: false`), matched by the anchored `[yellow:<local-id>]` title tag;
 *   no per-candidate activity reads.
 * - `reply` and `approve` reservations resolve on their own session: one
 *   `info()` plus an activity walk looking for the digest or plan id.
 *
 * Absence of evidence never frees the R36 guard on its own: a `released`
 * outcome needs a COMPLETE walk, no tagged and no untagged same-branch
 * candidate, and the journal's `archiveVisibilityConfirmed` flag.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.approvedPlanVerdict = approvedPlanVerdict;
exports.reconcile = reconcile;
const activity_walk_js_1 = require("./activity-walk.js");
const deadline_js_1 = require("./deadline.js");
const errors_js_1 = require("./errors.js");
const redact_js_1 = require("./redact.js");
const runtime_support_js_1 = require("./runtime-support.js");
const slot_release_js_1 = require("./slot-release.js");
const state_js_1 = require("./state.js");
const validate_js_1 = require("./validate.js");
const RECONCILE_SESSIONS_PAGE_SIZE = 100;
const RECONCILE_SESSIONS_PAGE_CAP = 5;
function project(s) {
    return {
        sessionResource: s.sessionResource,
        title: s.title,
        vendorState: s.vendorState,
        ...(s.createTime !== undefined ? { createTime: s.createTime } : {}),
        ...(s.sourceResource !== undefined
            ? { sourceResource: s.sourceResource }
            : {}),
        ...(s.startingBranch !== undefined
            ? { startingBranch: s.startingBranch }
            : {}),
    };
}
function entryOf(r) {
    const sessionResource = r.session?.sessionResource ?? r.record.sessionResource;
    return {
        localRequestId: r.record.localRequestId,
        kind: r.record.kind,
        outcome: r.outcome,
        ...(r.reason !== undefined ? { reason: r.reason } : {}),
        ...(sessionResource !== undefined ? { sessionResource } : {}),
    };
}
const UNATTRIBUTED_APPROVAL_DEVIATION = 'a different plan was approved after an unresolved approve was sent, and it cannot be attributed to that approve';
const APPROVED_PLAN_DEVIATION = 'the plan approved by the vendor differs from the plan evaluated before approval';
/**
 * What the vendor approved, judged like the post-POST verifier: the newest plan
 * generated strictly before the approval must match the reviewed digest; plans
 * tied at that time, or stamped at the approval's own time, cannot be ordered,
 * so any that differ count as a change. No readable preceding plan, or an
 * incomplete walk, is `unreadable`: never silently bound.
 */
function approvedPlanVerdict(plans, approvalTime, reviewedDigest, walkComplete) {
    if (!walkComplete || approvalTime === undefined)
        return 'unreadable';
    const cmp = (a, b) => (0, activity_walk_js_1.compareStamp)({ createTime: a, activityId: '' }, { createTime: b, activityId: '' });
    const before = plans.filter((p) => cmp(p.createTime, approvalTime) < 0);
    const atApproval = plans.filter((p) => cmp(p.createTime, approvalTime) === 0);
    if (before.length === 0)
        return 'unreadable';
    const newest = before.reduce((a, b) => cmp(b.createTime, a.createTime) > 0 ? b : a);
    const tied = before.filter((p) => cmp(p.createTime, newest.createTime) === 0);
    const digests = new Set(tied.map((p) => p.digest));
    if (digests.size > 1 ||
        !digests.has(reviewedDigest) ||
        atApproval.some((p) => p.digest !== reviewedDigest)) {
        return 'changed';
    }
    return 'same';
}
function notReached(record, reason) {
    return { record, outcome: 'not-reached', reason };
}
/** An auth failure means no reconcile can succeed; anything else just leaves the operation unreached. */
function rethrowIfAuth(err) {
    if (err instanceof errors_js_1.AppErrorException &&
        err.appError.code === 'JULES_AUTH_FAILED') {
        throw err;
    }
}
async function walkSessions(deps, adapter, deadline) {
    // No create_time filter: its floor would come from the controller's clock,
    // and a controller ahead of the service clock would hide the tagged session
    // and release the create. A walk the page cap cuts short is `not-reached`.
    let pageToken;
    const sessions = [];
    for (let pages = 0;;) {
        if (pages >= RECONCILE_SESSIONS_PAGE_CAP) {
            return { sessions, complete: false, stopReason: 'page-cap' };
        }
        if ((0, deadline_js_1.isExpired)(deps.clock, deadline)) {
            return { sessions, complete: false, stopReason: 'deadline' };
        }
        let page;
        try {
            page = await (0, runtime_support_js_1.read)(deps, deadline, () => adapter.listSessions({
                pageSize: RECONCILE_SESSIONS_PAGE_SIZE,
                ...(pageToken !== undefined ? { pageToken } : {}),
            }));
        }
        catch (err) {
            rethrowIfAuth(err);
            if (err instanceof errors_js_1.AppErrorException) {
                return { sessions, complete: false, stopReason: 'page-failure' };
            }
            throw err;
        }
        pages += 1;
        for (const session of page.sessions)
            sessions.push(project(session));
        if (page.nextPageToken === undefined)
            return { sessions, complete: true };
        pageToken = page.nextPageToken;
    }
}
function resolveCreates(journal, creates, walk) {
    const boundElsewhere = new Set(Object.values(journal.operations)
        // An `observe` owner is a guess made by status for a session it could not
        // match to a create (a trimmed title): it must not hide the session from
        // the lost create it may belong to.
        .filter((r) => (0, state_js_1.ownsSession)(r) &&
        r.kind !== 'observe' &&
        r.sessionResource !== undefined)
        .map((r) => r.sessionResource));
    return creates.map((record) => {
        const tagged = walk.sessions.filter((s) => (0, validate_js_1.extractTitleTag)(s.title).localId === record.localId);
        if (tagged.length > 1) {
            return {
                record,
                outcome: 'ambiguous-reconcile',
                reason: 'multiple-candidates',
            };
        }
        const [match] = tagged;
        if (match !== undefined) {
            if (match.sourceResource === record.sourceResource &&
                match.startingBranch === record.requestedBranch) {
                return { record, outcome: 'bound', session: match };
            }
            return {
                record,
                outcome: 'policy-deviation',
                reason: 'repository-or-branch-mismatch',
                deviation: 'a tagged session does not match the reserved repository or branch',
            };
        }
        if (!walk.complete) {
            return notReached(record, `sessions walk incomplete (${walk.stopReason ?? 'unknown'})`);
        }
        const floor = Date.parse(record.createdAt) - activity_walk_js_1.OVERLAP_WINDOW_MS;
        const untagged = walk.sessions.filter((s) => {
            if ((0, validate_js_1.extractTitleTag)(s.title).localId !== undefined)
                return false;
            if (boundElsewhere.has(s.sessionResource))
                return false;
            if (s.sourceResource !== record.sourceResource ||
                s.startingBranch !== record.requestedBranch) {
                return false;
            }
            const created = s.createTime !== undefined ? Date.parse(s.createTime) : NaN;
            // A session with no usable create time cannot be ruled out.
            return Number.isNaN(created) || created >= floor;
        });
        if (untagged.length > 0) {
            return {
                record,
                outcome: 'ambiguous-reconcile',
                reason: 'untagged-candidate',
            };
        }
        if (!journal.archiveVisibilityConfirmed) {
            return {
                record,
                outcome: 'ambiguous-reconcile',
                reason: 'archive-visibility-unverified',
            };
        }
        return { record, outcome: 'released' };
    });
}
// ---------------------------------------------------------------------------
// reply / approve reservations: their own session
// ---------------------------------------------------------------------------
/**
 * Every unresolved reply and approve of ONE session, resolved with one `info()`
 * and one activity walk from the earliest reservation, so ten stuck operations
 * on a session cost one walk, not ten.
 */
async function resolveOnOwnSession(deps, adapter, sessionResource, records, deadline, claimedEchoes, settledCandidates = []) {
    try {
        await (0, runtime_support_js_1.read)(deps, deadline, () => adapter.getSession(sessionResource));
    }
    catch (err) {
        rethrowIfAuth(err);
        if (err instanceof errors_js_1.AppErrorException) {
            return records.map((record) => notReached(record, `session read failed (${err.appError.code})`));
        }
        throw err;
    }
    // A POST cannot have produced an activity before it was dispatched. That is
    // decided on the vendor's clock only: a record carries the newest activity
    // the controller read just before dispatch, and a candidate echo must be
    // strictly newer. An older identical message is somebody else's; an equal
    // time, or a record with no such floor (legacy, or the pre-dispatch read
    // failed), cannot be ordered, so its match is left ambiguous, never bound.
    // A settled reply or approval that never had its echo recorded competes for a matching
    // activity: its sole echo may first appear in this very walk, and binding an
    // unresolved reply to it would credit a write that may never have landed. A
    // shared activity makes both ambiguous; the settled record is not changed.
    const competing = settledCandidates.filter((c) => c.echoActivityId === undefined &&
        ((c.kind === 'reply' && c.promptDigest !== undefined) ||
            (c.kind === 'approve' && c.observedPlanId !== undefined)) &&
        !records.some((r) => r.localRequestId === c.localRequestId));
    const candidates = [...records, ...competing];
    const matches = new Map(candidates.map((r) => [r.localRequestId, new Set()]));
    // Matches whose order against the dispatch is unproven.
    const unordered = new Map(candidates.map((r) => [r.localRequestId, new Set()]));
    // The walk starts at the vendor floor when a record has one (an echo is
    // newer than it), else at the reservation time.
    const earliest = Math.min(...records.map((r) => Date.parse(r.vendorFloorCreateTime ?? r.createdAt)));
    // An approve reserved with a reviewed digest checks the plan that preceded
    // its approval, which can predate the floor: read the whole session.
    const needsPlans = records.some((r) => r.kind === 'approve' && r.observedPlanDigest !== undefined);
    const plans = [];
    const createTimes = new Map();
    // planApproved activities after an approve's floor that name ANOTHER plan than
    // the one it reserved: the only trace its POST may have left when a
    // replacement became current before it landed.
    const foreignOrdered = new Map(candidates.map((r) => [r.localRequestId, new Set()]));
    const foreignUnordered = new Map(candidates.map((r) => [r.localRequestId, new Set()]));
    const walk = await (0, activity_walk_js_1.walkActivities)({
        adapter,
        sessionResource,
        pageSize: activity_walk_js_1.STATUS_PAGE_SIZE,
        start: needsPlans
            ? { kind: 'session-start' }
            : {
                kind: 'watermark',
                createTime: new Date(earliest).toISOString(),
                activityId: '',
            },
        clock: deps.clock,
        deadline,
        onActivity: (activity) => {
            const created = Date.parse(activity.createTime);
            if (Number.isNaN(created))
                return;
            // An echo another operation already claimed explains that operation, not
            // a later one with the same message. A record's own claimed echo is
            // positive landing evidence for it and still matches.
            createTimes.set(activity.activityId, activity.createTime);
            if (activity.type === 'planGenerated' && activity.plan !== undefined) {
                plans.push({
                    createTime: activity.createTime,
                    activityId: activity.activityId,
                    digest: (0, state_js_1.planDigest)(activity.plan.planId, (0, redact_js_1.redactDeep)({ steps: activity.plan.steps }).steps),
                });
            }
            const claimedBy = claimedEchoes.get(activity.activityId);
            for (const record of candidates) {
                const claimed = claimedBy !== undefined && claimedBy !== record.localRequestId;
                const ordered = matches.get(record.localRequestId);
                const unproven = unordered.get(record.localRequestId);
                if (ordered === undefined || unproven === undefined)
                    continue;
                // Strictly older than what the controller saw before dispatch: not an echo.
                if (record.vendorFloorActivityId === activity.activityId ||
                    (record.vendorFloorCreateTime !== undefined &&
                        (0, activity_walk_js_1.compareStamp)({ createTime: activity.createTime, activityId: '' }, { createTime: record.vendorFloorCreateTime, activityId: '' }) < 0)) {
                    continue;
                }
                // Proven newer: may bind. Equal, or no floor: ambiguous at best.
                const found = (0, state_js_1.followsDispatch)(record, activity.createTime, activity.activityId)
                    ? ordered
                    : unproven;
                if (record.kind === 'reply' &&
                    !claimed &&
                    activity.type === 'userMessaged' &&
                    activity.message !== undefined &&
                    record.promptDigest !== undefined &&
                    (0, state_js_1.messageDigest)(activity.message) === record.promptDigest) {
                    found.add(activity.activityId);
                }
                if (record.kind === 'approve' &&
                    !claimed &&
                    activity.type === 'planApproved' &&
                    record.observedPlanId !== undefined &&
                    activity.approvedPlanId === record.observedPlanId) {
                    found.add(activity.activityId);
                }
                if (record.kind === 'approve' &&
                    !claimed &&
                    activity.type === 'planApproved' &&
                    record.observedPlanId !== undefined &&
                    activity.approvedPlanId !== undefined &&
                    activity.approvedPlanId !== record.observedPlanId) {
                    (found === ordered ? foreignOrdered : foreignUnordered)
                        .get(record.localRequestId)
                        ?.add(activity.activityId);
                }
            }
        },
    });
    // One vendor activity can explain only one record, same-plan or foreign: two
    // unresolved records that share an activity cannot both be bound to it, and
    // nothing says which one landed.
    const owners = new Map();
    for (const group of [matches, unordered, foreignOrdered, foreignUnordered]) {
        for (const found of group.values()) {
            for (const id of found)
                owners.set(id, (owners.get(id) ?? 0) + 1);
        }
    }
    return records.map((record) => {
        const found = matches.get(record.localRequestId) ?? new Set();
        const unproven = unordered.get(record.localRequestId) ?? new Set();
        const orderedForeign = foreignOrdered.get(record.localRequestId) ?? new Set();
        const unorderedForeign = foreignUnordered.get(record.localRequestId) ?? new Set();
        // Every ambiguity on an approve also records a blocking deviation: an
        // approval whose fate is unknown must keep later grant-backed writes shut.
        const ambiguous = (reason) => ({
            record,
            outcome: 'ambiguous-reconcile',
            reason,
            ...(record.kind === 'approve'
                ? { deviation: UNATTRIBUTED_APPROVAL_DEVIATION }
                : {}),
        });
        const all = [...found, ...unproven, ...orderedForeign, ...unorderedForeign];
        if (found.size > 1 || all.some((id) => (owners.get(id) ?? 0) > 1)) {
            return ambiguous('multiple-candidates');
        }
        if (record.kind === 'approve' &&
            orderedForeign.size + unorderedForeign.size > 0) {
            const [only] = orderedForeign;
            // One approval of another plan, proven after the dispatch and nothing
            // else: the POST landed on the replacement plan. Anything less certain
            // (a same-plan match too, an unordered one) is ambiguous.
            if (found.size === 0 &&
                unproven.size === 0 &&
                orderedForeign.size === 1 &&
                unorderedForeign.size === 0 &&
                only !== undefined) {
                return {
                    record,
                    outcome: 'bound',
                    deviation: APPROVED_PLAN_DEVIATION,
                    echoActivityId: only,
                };
            }
            return ambiguous('approval-of-another-plan');
        }
        if (unproven.size > 0)
            return ambiguous('dispatch-time-unknown');
        if (found.size === 1) {
            const [echoId] = found;
            const echoTime = echoId !== undefined ? createTimes.get(echoId) : undefined;
            let deviation;
            if (record.kind === 'approve' &&
                record.observedPlanDigest !== undefined &&
                echoId !== undefined) {
                const verdict = approvedPlanVerdict(plans, echoTime, record.observedPlanDigest, walk.complete);
                if (verdict === 'unreadable')
                    return ambiguous('approved-plan-unreadable');
                if (verdict === 'changed')
                    deviation = APPROVED_PLAN_DEVIATION;
            }
            return {
                record,
                outcome: 'bound',
                // The consumed activity is persisted for approves too, so a later pass
                // cannot credit the same vendor approval to another record.
                ...(echoId !== undefined ? { echoActivityId: echoId } : {}),
                ...(record.kind === 'reply' && echoTime !== undefined
                    ? { echoCreateTime: echoTime }
                    : {}),
                ...(deviation !== undefined ? { deviation } : {}),
            };
        }
        if (!walk.complete) {
            return notReached(record, `activity walk incomplete (${walk.stopReason ?? 'unknown'})`);
        }
        return { record, outcome: 'unknown-outcome' };
    });
}
// ---------------------------------------------------------------------------
// persistence
// ---------------------------------------------------------------------------
async function persist(deps, resolutions) {
    const now = (0, runtime_support_js_1.nowFn)(deps)().toISOString();
    // The requests this pass actually moved to `failed`: only those give up a slot.
    const released = new Set();
    const refused = new Map();
    await (0, state_js_1.updateJournal)(deps.dataDir, (operations) => {
        for (const r of resolutions) {
            const current = operations[r.record.localRequestId];
            // Another process may have settled it since this pass read the journal.
            if (current === undefined || !state_js_1.UNRESOLVED_STATUSES.has(current.status)) {
                continue;
            }
            // A second create owning the same session would leave two owners, and
            // `findBySessionResource` would pick one of them. Refuse: the create
            // stays unresolved for a human (an `observe` owner is folded in below).
            if (r.outcome === 'bound' &&
                r.session !== undefined &&
                current.kind === 'create' &&
                (0, state_js_1.conflictingSessionOwner)(operations, current, r.session.sessionResource) !== undefined) {
                const reason = 'session-already-owned';
                operations[current.localRequestId] = {
                    ...current,
                    lastReconcile: {
                        outcome: 'ambiguous-reconcile',
                        reason,
                        observedAt: now,
                    },
                    updatedAt: now,
                };
                refused.set(current.localRequestId, {
                    record: r.record,
                    outcome: 'ambiguous-reconcile',
                    reason,
                });
                continue;
            }
            const lastReconcile = {
                outcome: r.outcome,
                ...(r.reason !== undefined ? { reason: r.reason } : {}),
                observedAt: now,
            };
            let next = { ...current, lastReconcile, updatedAt: now };
            if (r.outcome === 'bound') {
                next = {
                    ...next,
                    status: 'accepted',
                    ...(r.echoActivityId !== undefined
                        ? { echoActivityId: r.echoActivityId }
                        : {}),
                    ...(r.echoCreateTime !== undefined
                        ? { echoCreateTime: r.echoCreateTime }
                        : {}),
                    ...(r.session !== undefined
                        ? {
                            sessionResource: r.session.sessionResource,
                            vendorState: r.session.vendorState,
                            condition: (0, runtime_support_js_1.conditionOf)(r.session.vendorState),
                        }
                        : {}),
                };
                // A create bound to a session already terminal frees its slot in this
                // run, like the normal status path would.
                if (r.session !== undefined &&
                    slot_release_js_1.TERMINAL_VENDOR_STATES.has(r.session.vendorState)) {
                    released.add(current.localRequestId);
                }
            }
            else if (r.outcome === 'released') {
                next = { ...next, status: 'failed' };
                released.add(current.localRequestId);
            }
            else if (r.outcome === 'unknown-outcome' &&
                current.status === 'reserved') {
                next = { ...next, status: 'unknown-outcome' };
            }
            else if (r.outcome === 'policy-deviation' &&
                r.deviation !== undefined) {
                const known = current.deviations.some((d) => d.reason === r.deviation);
                if (!known) {
                    next = {
                        ...next,
                        deviations: [
                            ...current.deviations,
                            {
                                kind: 'policy-deviation',
                                reason: r.deviation,
                                observedAt: now,
                                reconciled: false,
                            },
                        ],
                    };
                }
            }
            // An approve that landed on other steps (or another plan), or whose
            // approval cannot be attributed, is a deviation on the session's owner,
            // as the post-POST verifier records: later grant-backed writes stay blocked.
            if (r.deviation !== undefined &&
                (r.outcome === 'bound' || r.outcome === 'ambiguous-reconcile') &&
                next.sessionResource !== undefined) {
                const owner = Object.values(operations).find((o) => (0, state_js_1.ownsSession)(o) && o.sessionResource === next.sessionResource);
                if (owner !== undefined &&
                    !owner.deviations.some((d) => d.reason === r.deviation)) {
                    operations[owner.localRequestId] = {
                        ...owner,
                        deviations: [
                            ...owner.deviations,
                            {
                                kind: 'policy-deviation',
                                reason: r.deviation,
                                observedAt: now,
                                reconciled: false,
                            },
                        ],
                        updatedAt: now,
                    };
                }
            }
            // Binding to a session an `observe` row already owns: its deviations,
            // pause and read state move onto the create and the row is retired.
            if (r.outcome === 'bound' && next.kind === 'create') {
                next = (0, state_js_1.absorbObservedOwners)(operations, next);
            }
            operations[current.localRequestId] = (0, state_js_1.applyRetention)(next);
        }
    });
    return { released, refused };
}
/**
 * Resolves the unresolved operations in scope. Returns one entry per
 * operation; an operation the deadline prevented from being checked is
 * `not-reached`, never resolved. The adapter is only created when something is
 * outstanding, so an empty reconcile needs no credential.
 */
async function reconcile(deps, journal, sessionResource, deadline) {
    const targets = Object.values(journal.operations)
        .filter((r) => state_js_1.UNRESOLVED_STATUSES.has(r.status))
        .filter((r) => sessionResource === undefined || r.sessionResource === sessionResource);
    if (targets.length === 0)
        return [];
    // A `reserved` row may still have its POST in flight in another process; only
    // an `unknown-outcome` row is certainly settled on the caller's side. A
    // reservation younger than the longest write deadline is left alone, so
    // reconcile can never free (and then be overwritten by) a live write.
    const nowMs = deps.clock.now();
    const inFlight = targets.filter((r) => r.status === 'reserved' &&
        nowMs - Date.parse(r.createdAt) < activity_walk_js_1.RESERVATION_SETTLE_MS);
    const settled = targets.filter((r) => !inFlight.includes(r));
    const early = inFlight.map((record) => notReached(record, 'the reservation may still be in flight; try again shortly'));
    const creates = settled.filter((r) => r.kind === 'create');
    const others = settled.filter((r) => r.kind === 'reply' || r.kind === 'approve');
    const resolutions = [
        ...early,
        ...(settled.length === 0
            ? []
            : await (0, runtime_support_js_1.withAdapter)(deps, async (adapter) => {
                const out = [];
                if (creates.length > 0) {
                    const walk = await walkSessions(deps, adapter, deadline);
                    out.push(...resolveCreates(journal, creates, walk));
                }
                // Activity ids are stored without their session, so two sessions can
                // hold the same id: claims are scoped to the session being resolved.
                const claimedEchoesOf = (session) => new Map(Object.values(journal.operations).flatMap((r) => r.echoActivityId !== undefined &&
                    r.sessionResource === session
                    ? [[r.echoActivityId, r.localRequestId]]
                    : []));
                const settledReplies = Object.values(journal.operations).filter((r) => (r.kind === 'reply' || r.kind === 'approve') &&
                    (r.status === 'accepted' || r.status === 'reconciled'));
                const bySession = new Map();
                for (const record of others) {
                    if (record.sessionResource === undefined) {
                        out.push(notReached(record, 'the operation has no bound session'));
                        continue;
                    }
                    const list = bySession.get(record.sessionResource) ?? [];
                    list.push(record);
                    bySession.set(record.sessionResource, list);
                }
                for (const [session, records] of bySession) {
                    if ((0, deadline_js_1.isExpired)(deps.clock, deadline)) {
                        out.push(...records.map((record) => notReached(record, 'the deadline expired before this operation was checked')));
                        continue;
                    }
                    out.push(...(await resolveOnOwnSession(deps, adapter, session, records, deadline, claimedEchoesOf(session), settledReplies.filter((c) => c.sessionResource === session))));
                }
                return out;
            })),
    ];
    // A young reservation is reported but not recorded: `not-reached` would make
    // it abandonable while its write may still be in flight.
    const persisted = await persist(deps, resolutions.filter((r) => !early.includes(r)));
    const released = persisted.released;
    for (const [i, r] of resolutions.entries()) {
        const refusal = persisted.refused.get(r.record.localRequestId);
        if (refusal !== undefined)
            resolutions[i] = refusal;
    }
    // One failed release must not hide the others or the report; the slot stays
    // held, which only makes the grant stricter, and the entry says so.
    const slotStuck = new Set();
    const slotSkipped = new Set();
    for (const r of resolutions) {
        if ((r.outcome === 'released' || r.outcome === 'bound') &&
            released.has(r.record.localRequestId) &&
            r.record.kind === 'create') {
            // `released` creates never reached a session; `bound` ones count only
            // when the listed vendor state is terminal (checked by the helper).
            const release = await (0, slot_release_js_1.releaseTerminalSlot)(deps, r.record, r.outcome === 'released' ? 'failed' : r.session?.vendorState);
            if (release === 'stuck')
                slotStuck.add(r.record.localRequestId);
            if (release === 'skipped')
                slotSkipped.add(r.record.localRequestId);
        }
    }
    return resolutions.map((r) => slotStuck.has(r.record.localRequestId)
        ? {
            ...entryOf({
                ...r,
                reason: `${r.reason ?? 'released'}; the grant slot could not be released (revoke and rewrite the grant to reclaim it)`,
            }),
            slotStuck: true,
        }
        : {
            ...entryOf(r),
            ...(slotSkipped.has(r.record.localRequestId)
                ? { slotReleaseSkipped: true }
                : {}),
            ...(r.deviation !== undefined &&
                (r.outcome === 'bound' || r.outcome === 'ambiguous-reconcile')
                ? { policyDeviation: true }
                : {}),
        });
}
