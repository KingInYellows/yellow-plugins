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

import { type Deadline, isExpired, withReadRetry } from './deadline.js';
import { AdapterError } from './errors.js';
import type {
  AdapterActivity,
  Clock,
  PendingPlan,
  SdkAdapter,
} from './types.js';

export const STATUS_PAGE_SIZE = 50;
export const COLLECT_PAGE_SIZE = 10;
export const PAGE_CAP = 20;
export const OVERLAP_WINDOW_MS = 5 * 60_000;
/** Longer than any write deadline (cli MAX_DEADLINE_MS 200 s) plus a minute of slack. */
export const RESERVATION_SETTLE_MS = 260_000;
export const DEDUP_RING_CAP = 1000;

export type WalkStart =
  | { readonly kind: 'session-start' }
  | {
      readonly kind: 'watermark';
      readonly createTime: string;
      readonly activityId: string;
    }
  | {
      readonly kind: 'resume';
      readonly pageToken: string;
      /** Where to restart if the vendor rejects the token (400/404). */
      readonly fallback:
        | { readonly kind: 'session-start' }
        | {
            readonly kind: 'watermark';
            readonly createTime: string;
            readonly activityId: string;
          };
    };

export type StopReason = 'page-cap' | 'page-failure' | 'deadline' | 'unmapped';

export interface WalkParams {
  readonly adapter: SdkAdapter;
  readonly sessionResource: string;
  readonly pageSize: number;
  readonly start: WalkStart;
  readonly clock: Clock;
  readonly deadline: Deadline;
  readonly pageCap?: number;
  /** The journal's dedup ring (read for counting only). */
  readonly ring?: readonly string[];
  /** The journal watermark, for counting `new`; independent of where the walk starts. */
  readonly watermark?: {
    readonly createTime: string;
    readonly activityId: string;
  };
  readonly pendingPlan?: PendingPlan;
  /**
   * The newest `planApproved` stamp an earlier partial walk of this session
   * read but could not pair with its (older) plan. Newest-first listings
   * reach the approval before the plan it approved.
   */
  readonly approval?: {
    readonly createTime: string;
    readonly activityId: string;
    readonly approvedPlanId?: string;
  };
  /**
   * Called for every activity read, in page order (collect stages artifacts
   * here). `isNew` is true when the activity was counted toward `newIds`:
   * outside the dedup ring and after the watermark. `unseen` is wider: the id
   * is absent from the ring and not older than the ring's coverage (the
   * overlap window below the watermark), whatever its sort position.
   * Classification that must not miss an activity uses `unseen`.
   */
  readonly onActivity?: (
    activity: AdapterActivity,
    info: { readonly isNew: boolean; readonly unseen: boolean }
  ) => void | Promise<void>;
}

export interface WalkResult {
  readonly pages: number;
  readonly processed: number;
  /** Ids counted as new: outside the ring and after the watermark. */
  readonly newIds: readonly string[];
  readonly complete: boolean;
  readonly partialPagination: boolean;
  readonly unmappedActivity: boolean;
  readonly stopReason?: StopReason;
  /** Token to continue from after a partial walk. */
  readonly resumePageToken?: string;
  /** Newest `(createTime, activityId)` seen. */
  readonly newest?: {
    readonly createTime: string;
    readonly activityId: string;
  };
  /** Ids seen with their create times (for the caller's ring computation). */
  readonly seen: ReadonlyArray<{
    readonly activityId: string;
    readonly createTime: string;
  }>;
  /** The pending plan after this walk; `null` when a later planApproved cleared it. */
  readonly pendingPlan: PendingPlan | null | undefined;
  /** The newest plan generated (including the carried one), whether or not a later approval cleared it. */
  readonly generatedPlan?: PendingPlan;
  /** Newest `planApproved` seen (including the carried `approval`); persist it across a partial walk. */
  readonly latestApproval?: {
    readonly createTime: string;
    readonly activityId: string;
    readonly approvedPlanId?: string;
  };
  readonly startedFromResume: boolean;
  /** The stored resume token was rejected (400/404) and the walk restarted from its fallback. */
  readonly resumeRejected: boolean;
  /** A filtered first page was rejected with 400 and retried unfiltered. */
  readonly filterRetried: boolean;
}

function timeOf(createTime: string): number {
  const t = Date.parse(createTime);
  return Number.isNaN(t) ? 0 : t;
}

/** Orders `(createTime, activityId)` pairs; activity id breaks equal timestamps. */
export function compareStamp(
  a: { readonly createTime: string; readonly activityId: string },
  b: { readonly createTime: string; readonly activityId: string }
): number {
  const dt = timeOf(a.createTime) - timeOf(b.createTime);
  if (dt !== 0) return dt;
  return a.activityId < b.activityId ? -1 : a.activityId > b.activityId ? 1 : 0;
}

export function watermarkFilter(createTime: string): string {
  const since = new Date(timeOf(createTime) - OVERLAP_WINDOW_MS).toISOString();
  return `create_time>"${since}"`;
}

function isRejection(err: unknown, statuses: readonly number[]): boolean {
  return (
    err instanceof AdapterError &&
    err.status !== undefined &&
    statuses.includes(err.status)
  );
}

interface PagePlan {
  pageToken?: string;
  filter?: string;
}

function initialPage(start: WalkStart): PagePlan {
  if (start.kind === 'resume') return { pageToken: start.pageToken };
  if (start.kind === 'watermark')
    return { filter: watermarkFilter(start.createTime) };
  return {};
}

export async function walkActivities(params: WalkParams): Promise<WalkResult> {
  const pageCap = params.pageCap ?? PAGE_CAP;
  const ring = new Set(params.ring ?? []);
  const seenIds = new Set<string>();
  const seen: Array<{ activityId: string; createTime: string }> = [];
  const newIds: string[] = [];
  let latestPlan: PendingPlan | undefined = params.pendingPlan;
  // Content keys of the plans at the newest plan createTime: equal times are
  // unordered, so more than one distinct key leaves the current plan unknown.
  const planKeyOf = (p: {
    planId: string;
    steps: readonly unknown[];
  }): string => JSON.stringify([p.planId, p.steps]);
  let newestPlanKeys = new Set<string>(
    params.pendingPlan === undefined
      ? []
      : [
          planKeyOf(params.pendingPlan),
          ...(params.pendingPlan.ambiguous === true ? ['\0ambiguous'] : []),
        ]
  );
  let latestApproval: { createTime: string; activityId: string } | undefined =
    params.approval;
  // The plan the newest approval named; carried in the resume marker, and
  // unknown for a marker written before it was kept.
  let latestApprovalPlanId: string | undefined =
    params.approval?.approvedPlanId;
  // Every plan id named by approvals at the newest approval time: equal times
  // are unordered, so a tie naming different plans decides nothing.
  let approvalPlanIds = new Set<string | undefined>(
    params.approval !== undefined ? [params.approval.approvedPlanId] : []
  );
  let newest: { createTime: string; activityId: string } | undefined;
  let pages = 0;
  let processed = 0;
  let unmappedActivity = false;
  let stopReason: StopReason | undefined;
  let resumePageToken: string | undefined;
  let resumeRejected = false;
  let filterRetried = false;
  let complete = false;

  let next: PagePlan = initialPage(params.start);
  let firstPageOfSegment = true;

  for (;;) {
    if (pages >= pageCap) {
      stopReason = 'page-cap';
      break;
    }
    if (isExpired(params.clock, params.deadline)) {
      stopReason = 'deadline';
      break;
    }
    let page;
    try {
      const request = next;
      page = await withReadRetry(
        () =>
          params.adapter.listActivities(params.sessionResource, {
            pageSize: params.pageSize,
            ...(request.pageToken !== undefined
              ? { pageToken: request.pageToken }
              : {}),
            ...(request.filter !== undefined ? { filter: request.filter } : {}),
          }),
        { clock: params.clock, deadline: params.deadline }
      );
    } catch (err) {
      if (
        firstPageOfSegment &&
        params.start.kind === 'resume' &&
        !resumeRejected &&
        next.pageToken === params.start.pageToken &&
        isRejection(err, [400, 404])
      ) {
        resumeRejected = true;
        next = initialPage(params.start.fallback);
        continue;
      }
      if (
        firstPageOfSegment &&
        next.filter !== undefined &&
        !filterRetried &&
        isRejection(err, [400])
      ) {
        filterRetried = true;
        next = {};
        continue;
      }
      // Only a vendor/transport failure is a page failure; our own verdicts
      // (integrity, allowlist) and programming errors surface as errors.
      if (!(err instanceof AdapterError)) throw err;
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
        const afterWatermark =
          params.watermark === undefined ||
          compareStamp(activity, params.watermark) > 0;
        // The ring covers every id within the overlap window below the
        // watermark, so an id absent from it there was never seen, even when
        // it sorts at or before the watermark (equal time, lower opaque id).
        if (
          !ring.has(activity.activityId) &&
          (afterWatermark ||
            timeOf(activity.createTime) >=
              timeOf(params.watermark?.createTime ?? '') - OVERLAP_WINDOW_MS)
        ) {
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
        const timeCmp =
          latestPlan == null
            ? 1
            : compareStamp(
                { createTime: stamp.createTime, activityId: '' },
                { createTime: latestPlan.activityCreateTime, activityId: '' }
              );
        if (timeCmp > 0) newestPlanKeys = new Set();
        if (timeCmp >= 0) newestPlanKeys.add(planKeyOf(activity.plan));
        if (
          latestPlan == null ||
          compareStamp(stamp, {
            createTime: latestPlan.activityCreateTime,
            activityId: latestPlan.activityId,
          }) > 0
        ) {
          latestPlan = {
            planId: activity.plan.planId,
            steps: activity.plan.steps,
            activityCreateTime: activity.createTime,
            activityId: activity.activityId,
          };
        }
      } else if (activity.type === 'planApproved') {
        const approvalCmp =
          latestApproval === undefined
            ? 1
            : compareStamp(
                { createTime: activity.createTime, activityId: '' },
                { createTime: latestApproval.createTime, activityId: '' }
              );
        if (approvalCmp > 0) approvalPlanIds = new Set();
        if (approvalCmp >= 0) approvalPlanIds.add(activity.approvedPlanId);
        if (
          latestApproval === undefined ||
          compareStamp(activity, latestApproval) > 0
        ) {
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
  const approvalVsPlan =
    latestPlan !== undefined && latestApproval !== undefined
      ? compareStamp(
          { createTime: latestApproval.createTime, activityId: '' },
          { createTime: latestPlan.activityCreateTime, activityId: '' }
        )
      : undefined;
  const approvalTies = approvalVsPlan === 0;
  const approvalClears =
    approvalVsPlan !== undefined &&
    (approvalVsPlan > 0 ||
      (approvalTies &&
        approvalPlanIds.size === 1 &&
        approvalPlanIds.has(latestPlan?.planId)));
  const pendingPlan: PendingPlan | null | undefined = approvalClears
    ? null
    : latestPlan !== undefined && (newestPlanKeys.size > 1 || approvalTies)
      ? { ...latestPlan, ambiguous: true as const }
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
export function nextRing(
  prior: readonly string[],
  walk: Pick<WalkResult, 'complete' | 'seen' | 'newest' | 'newIds'>
): { ring: string[]; dedupWindowExceeded: boolean } {
  let candidates: string[];
  if (walk.complete && walk.newest !== undefined) {
    const floor = timeOf(walk.newest.createTime) - OVERLAP_WINDOW_MS;
    candidates = walk.seen
      .filter((s) => timeOf(s.createTime) >= floor)
      .map((s) => s.activityId);
  } else if (walk.complete) {
    candidates = [...prior];
  } else {
    candidates = [...new Set([...prior, ...walk.newIds])];
  }
  if (candidates.length > DEDUP_RING_CAP) {
    return {
      ring: candidates.slice(candidates.length - DEDUP_RING_CAP),
      dedupWindowExceeded: true,
    };
  }
  return { ring: candidates, dedupWindowExceeded: false };
}
