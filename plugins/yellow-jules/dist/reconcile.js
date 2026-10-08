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
exports.RECONCILE_SESSIONS_PAGE_CAP = exports.RECONCILE_SESSIONS_PAGE_SIZE = exports.RESERVATION_SETTLE_MS = void 0;
exports.reconcile = reconcile;
const activity_walk_js_1 = require("./activity-walk.js");
const authority_js_1 = require("./authority.js");
const deadline_js_1 = require("./deadline.js");
const errors_js_1 = require("./errors.js");
const runtime_support_js_1 = require("./runtime-support.js");
const state_js_1 = require("./state.js");
const validate_js_1 = require("./validate.js");
/** Longer than any write deadline (cli MAX_DEADLINE_MS 200 s) plus a minute of slack. */
exports.RESERVATION_SETTLE_MS = 260_000;
exports.RECONCILE_SESSIONS_PAGE_SIZE = 100;
exports.RECONCILE_SESSIONS_PAGE_CAP = 5;
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
async function walkSessions(deps, adapter, oldestReservation, deadline) {
    const since = new Date(oldestReservation.getTime() - activity_walk_js_1.OVERLAP_WINDOW_MS).toISOString();
    let filter = `create_time > "${since}"`;
    let pageToken;
    const sessions = [];
    for (let pages = 0;;) {
        if (pages >= exports.RECONCILE_SESSIONS_PAGE_CAP) {
            return { sessions, complete: false, stopReason: 'page-cap' };
        }
        if ((0, deadline_js_1.isExpired)(deps.clock, deadline)) {
            return { sessions, complete: false, stopReason: 'deadline' };
        }
        let page;
        try {
            page = await (0, runtime_support_js_1.read)(deps, deadline, () => adapter.listSessions({
                pageSize: exports.RECONCILE_SESSIONS_PAGE_SIZE,
                ...(pageToken !== undefined ? { pageToken } : {}),
                ...(filter !== undefined ? { filter } : {}),
            }));
        }
        catch (err) {
            rethrowIfAuth(err);
            // The filter is an optimization: a first page the vendor rejects is retried unfiltered once.
            if (err instanceof errors_js_1.AppErrorException &&
                err.appError.code === 'JULES_INVALID_INPUT' &&
                filter !== undefined &&
                pages === 0) {
                filter = undefined;
                continue;
            }
            if (err instanceof errors_js_1.AppErrorException) {
                return { sessions, complete: false, stopReason: 'page-failure' };
            }
            throw err;
        }
        pages += 1;
        sessions.push(...page.sessions);
        if (page.nextPageToken === undefined)
            return { sessions, complete: true };
        pageToken = page.nextPageToken;
    }
}
function resolveCreates(journal, creates, walk) {
    const boundElsewhere = new Set(Object.values(journal.operations)
        .filter((r) => (0, state_js_1.ownsSession)(r) && r.sessionResource !== undefined)
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
async function resolveOnOwnSession(deps, adapter, sessionResource, records, deadline) {
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
    const floors = new Map(records.map((r) => [
        r.localRequestId,
        Date.parse(r.createdAt) - activity_walk_js_1.OVERLAP_WINDOW_MS,
    ]));
    const matches = new Map(records.map((r) => [r.localRequestId, new Set()]));
    const earliest = Math.min(...records.map((r) => Date.parse(r.createdAt)));
    const walk = await (0, activity_walk_js_1.walkActivities)({
        adapter,
        sessionResource,
        pageSize: activity_walk_js_1.STATUS_PAGE_SIZE,
        start: {
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
            for (const record of records) {
                // Only activities at or after this reservation (minus the overlap window).
                if (created < (floors.get(record.localRequestId) ?? Infinity))
                    continue;
                const found = matches.get(record.localRequestId);
                if (found === undefined)
                    continue;
                if (record.kind === 'reply' &&
                    activity.type === 'userMessaged' &&
                    activity.message !== undefined &&
                    record.promptDigest !== undefined &&
                    (0, state_js_1.messageDigest)(activity.message) === record.promptDigest) {
                    found.add(activity.activityId);
                }
                if (record.kind === 'approve' &&
                    activity.type === 'planApproved' &&
                    record.observedPlanId !== undefined &&
                    activity.approvedPlanId === record.observedPlanId) {
                    found.add(activity.activityId);
                }
            }
        },
    });
    return records.map((record) => {
        const found = matches.get(record.localRequestId) ?? new Set();
        if (found.size > 1) {
            return {
                record,
                outcome: 'ambiguous-reconcile',
                reason: 'multiple-candidates',
            };
        }
        if (found.size === 1)
            return { record, outcome: 'bound' };
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
    await (0, state_js_1.updateJournal)(deps.dataDir, (operations) => {
        for (const r of resolutions) {
            const current = operations[r.record.localRequestId];
            // Another process may have settled it since this pass read the journal.
            if (current === undefined || !state_js_1.UNRESOLVED_STATUSES.has(current.status)) {
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
                    ...(r.session !== undefined
                        ? {
                            sessionResource: r.session.sessionResource,
                            vendorState: r.session.vendorState,
                            condition: (0, runtime_support_js_1.conditionOf)(r.session.vendorState),
                        }
                        : {}),
                };
            }
            else if (r.outcome === 'released') {
                next = { ...next, status: 'failed' };
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
            operations[current.localRequestId] = (0, state_js_1.applyRetention)(next);
        }
    });
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
        nowMs - Date.parse(r.createdAt) < exports.RESERVATION_SETTLE_MS);
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
                    const oldest = new Date(Math.min(...creates.map((r) => Date.parse(r.createdAt))));
                    const walk = await walkSessions(deps, adapter, oldest, deadline);
                    out.push(...resolveCreates(journal, creates, walk));
                }
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
                    out.push(...(await resolveOnOwnSession(deps, adapter, session, records, deadline)));
                }
                return out;
            })),
    ];
    // A young reservation is reported but not recorded: `not-reached` would make
    // it abandonable while its write may still be in flight.
    await persist(deps, resolutions.filter((r) => !early.includes(r)));
    for (const r of resolutions) {
        if (r.outcome === 'released' &&
            r.record.kind === 'create' &&
            r.record.grantId !== undefined) {
            await (0, authority_js_1.releaseSlotInStore)(deps.dataDir, r.record.grantId, r.record.localRequestId);
        }
    }
    return resolutions.map(entryOf);
}
