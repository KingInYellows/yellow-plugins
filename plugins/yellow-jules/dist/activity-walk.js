"use strict";
/**
 * The single activity-walk unit (contract "Activity walk"). `status`,
 * `approve`, and `collect` differ only in the parameters they pass:
 * page size, start point, and whether the caller will write read-state
 * (only `status` does; this module never touches the journal).
 *
 * A walk follows `nextPageToken` for at most `pageCap` pages and stops on
 * the cap, a page failure, the deadline, or an activity the SDK mapper
 * cannot parse. Every such stop is `partialPagination: true` — never a
 * manufactured end of results (R18). Filters are an optimization only: a
 * `400` on a filtered first page is retried once unfiltered.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEDUP_RING_CAP = exports.RESERVATION_SETTLE_MS = exports.OVERLAP_WINDOW_MS = exports.PAGE_CAP = exports.COLLECT_PAGE_SIZE = exports.STATUS_PAGE_SIZE = void 0;
exports.compareStamp = compareStamp;
exports.watermarkFilter = watermarkFilter;
exports.walkActivities = walkActivities;
exports.nextRing = nextRing;
const deadline_js_1 = require("./deadline.js");
const errors_js_1 = require("./errors.js");
exports.STATUS_PAGE_SIZE = 50;
exports.COLLECT_PAGE_SIZE = 10;
exports.PAGE_CAP = 20;
exports.OVERLAP_WINDOW_MS = 5 * 60_000;
/** Longer than any write deadline (cli MAX_DEADLINE_MS 200 s) plus a minute of slack. */
exports.RESERVATION_SETTLE_MS = 260_000;
exports.DEDUP_RING_CAP = 1000;
function timeOf(createTime) {
    const t = Date.parse(createTime);
    return Number.isNaN(t) ? 0 : t;
}
/** Orders `(createTime, activityId)` pairs; activity id breaks equal timestamps. */
function compareStamp(a, b) {
    const dt = timeOf(a.createTime) - timeOf(b.createTime);
    if (dt !== 0)
        return dt;
    return a.activityId < b.activityId ? -1 : a.activityId > b.activityId ? 1 : 0;
}
function watermarkFilter(createTime) {
    const since = new Date(timeOf(createTime) - exports.OVERLAP_WINDOW_MS).toISOString();
    return `create_time>"${since}"`;
}
function isRejection(err, statuses) {
    return (err instanceof errors_js_1.AdapterError &&
        err.status !== undefined &&
        statuses.includes(err.status));
}
function initialPage(start) {
    if (start.kind === 'resume')
        return { pageToken: start.pageToken };
    if (start.kind === 'watermark')
        return { filter: watermarkFilter(start.createTime) };
    return {};
}
async function walkActivities(params) {
    const pageCap = params.pageCap ?? exports.PAGE_CAP;
    const ring = new Set(params.ring ?? []);
    const seenIds = new Set();
    const seen = [];
    const newIds = [];
    let latestPlan = params.pendingPlan;
    // Content keys of the plans at the newest plan createTime: equal times are
    // unordered, so more than one distinct key leaves the current plan unknown.
    const planKeyOf = (p) => JSON.stringify([p.planId, p.steps]);
    let newestPlanKeys = new Set(params.pendingPlan === undefined
        ? []
        : [
            planKeyOf(params.pendingPlan),
            ...(params.pendingPlan.ambiguous === true ? ['\0ambiguous'] : []),
        ]);
    let latestApproval = params.approval;
    // The plan the newest approval named; carried in the resume marker, and
    // unknown for a marker written before it was kept.
    let latestApprovalPlanId = params.approval?.approvedPlanId;
    // Every plan id named by approvals at the newest approval time: equal times
    // are unordered, so a tie naming different plans decides nothing.
    let approvalPlanIds = new Set(params.approval !== undefined ? [params.approval.approvedPlanId] : []);
    let newest;
    let pages = 0;
    let processed = 0;
    let unmappedActivity = false;
    let stopReason;
    let resumePageToken;
    let resumeRejected = false;
    let filterRetried = false;
    let complete = false;
    let next = initialPage(params.start);
    let firstPageOfSegment = true;
    for (;;) {
        if (pages >= pageCap) {
            stopReason = 'page-cap';
            break;
        }
        if ((0, deadline_js_1.isExpired)(params.clock, params.deadline)) {
            stopReason = 'deadline';
            break;
        }
        let page;
        try {
            const request = next;
            page = await (0, deadline_js_1.withReadRetry)(() => params.adapter.listActivities(params.sessionResource, {
                pageSize: params.pageSize,
                ...(request.pageToken !== undefined
                    ? { pageToken: request.pageToken }
                    : {}),
                ...(request.filter !== undefined ? { filter: request.filter } : {}),
            }), { clock: params.clock, deadline: params.deadline });
        }
        catch (err) {
            if (firstPageOfSegment &&
                params.start.kind === 'resume' &&
                !resumeRejected &&
                next.pageToken === params.start.pageToken &&
                isRejection(err, [400, 404])) {
                resumeRejected = true;
                next = initialPage(params.start.fallback);
                continue;
            }
            if (firstPageOfSegment &&
                next.filter !== undefined &&
                !filterRetried &&
                isRejection(err, [400])) {
                filterRetried = true;
                next = {};
                continue;
            }
            // Only a vendor/transport failure is a page failure; our own verdicts
            // (integrity, allowlist) and programming errors surface as errors.
            if (!(err instanceof errors_js_1.AdapterError))
                throw err;
            stopReason = 'page-failure';
            break;
        }
        pages += 1;
        firstPageOfSegment = false;
        for (const activity of page.activities) {
            processed += 1;
            let isNew = false;
            let unseen = false;
            if (!seenIds.has(activity.activityId)) {
                seenIds.add(activity.activityId);
                seen.push({
                    activityId: activity.activityId,
                    createTime: activity.createTime,
                });
                const afterWatermark = params.watermark === undefined ||
                    compareStamp(activity, params.watermark) > 0;
                // The ring covers every id within the overlap window below the
                // watermark, so an id absent from it there was never seen, even when
                // it sorts at or before the watermark (equal time, lower opaque id).
                if (!ring.has(activity.activityId) &&
                    (afterWatermark ||
                        timeOf(activity.createTime) >=
                            timeOf(params.watermark?.createTime ?? '') - exports.OVERLAP_WINDOW_MS)) {
                    unseen = true;
                }
                if (!ring.has(activity.activityId) && afterWatermark) {
                    newIds.push(activity.activityId);
                    isNew = true;
                }
            }
            if (newest === undefined || compareStamp(activity, newest) > 0) {
                newest = {
                    createTime: activity.createTime,
                    activityId: activity.activityId,
                };
            }
            // Plan state is derived from the whole walk, not arrival order: the
            // vendor's list order is unverified, so track the newest plan and the
            // newest approval by stamp and combine them after the last page.
            if (activity.type === 'planGenerated' && activity.plan !== undefined) {
                const stamp = {
                    createTime: activity.createTime,
                    activityId: activity.activityId,
                };
                const timeCmp = latestPlan == null
                    ? 1
                    : compareStamp({ createTime: stamp.createTime, activityId: '' }, { createTime: latestPlan.activityCreateTime, activityId: '' });
                if (timeCmp > 0)
                    newestPlanKeys = new Set();
                if (timeCmp >= 0)
                    newestPlanKeys.add(planKeyOf(activity.plan));
                if (latestPlan == null ||
                    compareStamp(stamp, {
                        createTime: latestPlan.activityCreateTime,
                        activityId: latestPlan.activityId,
                    }) > 0) {
                    latestPlan = {
                        planId: activity.plan.planId,
                        steps: activity.plan.steps,
                        activityCreateTime: activity.createTime,
                        activityId: activity.activityId,
                    };
                }
            }
            else if (activity.type === 'planApproved') {
                const approvalCmp = latestApproval === undefined
                    ? 1
                    : compareStamp({ createTime: activity.createTime, activityId: '' }, { createTime: latestApproval.createTime, activityId: '' });
                if (approvalCmp > 0)
                    approvalPlanIds = new Set();
                if (approvalCmp >= 0)
                    approvalPlanIds.add(activity.approvedPlanId);
                if (latestApproval === undefined ||
                    compareStamp(activity, latestApproval) > 0) {
                    latestApproval = {
                        createTime: activity.createTime,
                        activityId: activity.activityId,
                    };
                    latestApprovalPlanId = activity.approvedPlanId;
                }
            }
            await params.onActivity?.(activity, { isNew, unseen });
        }
        if (page.unmappedActivity === true) {
            unmappedActivity = true;
            stopReason = 'unmapped';
            // The next token (if any) is unknown after a mapper throw; resume from the same request.
            resumePageToken = next.pageToken;
            break;
        }
        if (page.nextPageToken === undefined) {
            complete = true;
            break;
        }
        next = { pageToken: page.nextPageToken };
    }
    if (!complete && stopReason !== 'unmapped') {
        // Continue from the page that was not read. A resumed walk that failed
        // before reading anything keeps its (still valid) stored token.
        resumePageToken = next.pageToken;
    }
    // An approval newer than the newest plan clears it; an approval alone,
    // with no plan known, leaves the result undefined.
    // Across types an equal createTime is unordered (opaque ids carry no order):
    // an approval at the plan's own time clears it only when it names that plan's
    // id; a different plan stays pending and the tie is marked ambiguous.
    const approvalVsPlan = latestPlan !== undefined && latestApproval !== undefined
        ? compareStamp({ createTime: latestApproval.createTime, activityId: '' }, { createTime: latestPlan.activityCreateTime, activityId: '' })
        : undefined;
    const approvalTies = approvalVsPlan === 0;
    const approvalClears = approvalVsPlan !== undefined &&
        (approvalVsPlan > 0 ||
            (approvalTies &&
                approvalPlanIds.size === 1 &&
                approvalPlanIds.has(latestPlan?.planId)));
    const pendingPlan = approvalClears
        ? null
        : latestPlan !== undefined && (newestPlanKeys.size > 1 || approvalTies)
            ? { ...latestPlan, ambiguous: true }
            : latestPlan;
    return {
        pages,
        processed,
        newIds,
        complete,
        partialPagination: !complete,
        unmappedActivity,
        ...(stopReason !== undefined ? { stopReason } : {}),
        ...(resumePageToken !== undefined ? { resumePageToken } : {}),
        ...(newest !== undefined ? { newest } : {}),
        seen,
        pendingPlan,
        ...(latestPlan !== undefined ? { generatedPlan: latestPlan } : {}),
        ...(latestApproval !== undefined
            ? {
                latestApproval: {
                    createTime: latestApproval.createTime,
                    activityId: latestApproval.activityId,
                    ...(latestApprovalPlanId !== undefined && approvalPlanIds.size === 1
                        ? { approvedPlanId: latestApprovalPlanId }
                        : {}),
                },
            }
            : {}),
        startedFromResume: params.start.kind === 'resume',
        resumeRejected,
        filterRetried,
    };
}
/**
 * The dedup ring after a walk. Complete walk: ids seen whose createTime
 * falls within the overlap window below the newest activity (exactly what
 * the next watermarked read re-reads). Partial walk: the prior ring plus
 * this walk's new ids, so a restart does not recount them. Capped at 1000;
 * overflow reports `dedupWindowExceeded` (counts may inflate, and
 * `supervise` treats the pass as check-failed).
 */
function nextRing(prior, walk) {
    let candidates;
    if (walk.complete && walk.newest !== undefined) {
        const floor = timeOf(walk.newest.createTime) - exports.OVERLAP_WINDOW_MS;
        candidates = walk.seen
            .filter((s) => timeOf(s.createTime) >= floor)
            .map((s) => s.activityId);
    }
    else if (walk.complete) {
        candidates = [...prior];
    }
    else {
        candidates = [...new Set([...prior, ...walk.newIds])];
    }
    if (candidates.length > exports.DEDUP_RING_CAP) {
        return {
            ring: candidates.slice(candidates.length - exports.DEDUP_RING_CAP),
            dedupWindowExceeded: true,
        };
    }
    return { ring: candidates, dedupWindowExceeded: false };
}
