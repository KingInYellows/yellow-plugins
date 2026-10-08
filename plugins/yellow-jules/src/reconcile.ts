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

import {
  OVERLAP_WINDOW_MS,
  STATUS_PAGE_SIZE,
  walkActivities,
} from './activity-walk.js';
import { releaseSlotInStore } from './authority.js';
import { type Deadline, isExpired } from './deadline.js';
import { AppErrorException } from './errors.js';
import {
  type RuntimeDeps,
  nowFn,
  read,
  withAdapter,
} from './runtime-support.js';
import { conditionOf } from './runtime-support.js';
import {
  messageDigest,
  ownsSession,
  UNRESOLVED_STATUSES,
  updateJournal,
  applyRetention,
} from './state.js';
import type {
  AdapterSession,
  Journal,
  OperationRecord,
  ReconciledEntry,
  ReconcileOutcome,
  SdkAdapter,
} from './types.js';
import { extractTitleTag } from './validate.js';

export const RECONCILE_SESSIONS_PAGE_SIZE = 100;
export const RECONCILE_SESSIONS_PAGE_CAP = 5;

interface Resolution {
  readonly record: OperationRecord;
  readonly outcome: ReconcileOutcome;
  readonly reason?: string;
  readonly session?: AdapterSession;
  readonly deviation?: string;
}

function entryOf(r: Resolution): ReconciledEntry {
  const sessionResource =
    r.session?.sessionResource ?? r.record.sessionResource;
  return {
    localRequestId: r.record.localRequestId,
    kind: r.record.kind,
    outcome: r.outcome,
    ...(r.reason !== undefined ? { reason: r.reason } : {}),
    ...(sessionResource !== undefined ? { sessionResource } : {}),
  };
}

function notReached(record: OperationRecord, reason: string): Resolution {
  return { record, outcome: 'not-reached', reason };
}

/** An auth failure means no reconcile can succeed; anything else just leaves the operation unreached. */
function rethrowIfAuth(err: unknown): void {
  if (
    err instanceof AppErrorException &&
    err.appError.code === 'JULES_AUTH_FAILED'
  ) {
    throw err;
  }
}

// ---------------------------------------------------------------------------
// delegate reservations: the shared sessions walk
// ---------------------------------------------------------------------------

interface SessionsWalk {
  readonly sessions: readonly AdapterSession[];
  readonly complete: boolean;
  readonly stopReason?: string;
}

async function walkSessions(
  deps: RuntimeDeps,
  adapter: SdkAdapter,
  oldestReservation: Date,
  deadline: Deadline
): Promise<SessionsWalk> {
  const since = new Date(
    oldestReservation.getTime() - OVERLAP_WINDOW_MS
  ).toISOString();
  let filter: string | undefined = `create_time > "${since}"`;
  let pageToken: string | undefined;
  const sessions: AdapterSession[] = [];
  for (let pages = 0; ; ) {
    if (pages >= RECONCILE_SESSIONS_PAGE_CAP) {
      return { sessions, complete: false, stopReason: 'page-cap' };
    }
    if (isExpired(deps.clock, deadline)) {
      return { sessions, complete: false, stopReason: 'deadline' };
    }
    let page;
    try {
      page = await read(deps, deadline, () =>
        adapter.listSessions({
          pageSize: RECONCILE_SESSIONS_PAGE_SIZE,
          ...(pageToken !== undefined ? { pageToken } : {}),
          ...(filter !== undefined ? { filter } : {}),
        })
      );
    } catch (err) {
      rethrowIfAuth(err);
      // The filter is an optimization: a first page the vendor rejects is retried unfiltered once.
      if (
        err instanceof AppErrorException &&
        err.appError.code === 'JULES_INVALID_INPUT' &&
        filter !== undefined &&
        pages === 0
      ) {
        filter = undefined;
        continue;
      }
      if (err instanceof AppErrorException) {
        return { sessions, complete: false, stopReason: 'page-failure' };
      }
      throw err;
    }
    pages += 1;
    sessions.push(...page.sessions);
    if (page.nextPageToken === undefined) return { sessions, complete: true };
    pageToken = page.nextPageToken;
  }
}

function resolveCreates(
  journal: Journal,
  creates: readonly OperationRecord[],
  walk: SessionsWalk
): Resolution[] {
  const boundElsewhere = new Set(
    Object.values(journal.operations)
      .filter((r) => ownsSession(r) && r.sessionResource !== undefined)
      .map((r) => r.sessionResource as string)
  );
  return creates.map((record): Resolution => {
    const tagged = walk.sessions.filter(
      (s) => extractTitleTag(s.title).localId === record.localId
    );
    if (tagged.length > 1) {
      return {
        record,
        outcome: 'ambiguous-reconcile',
        reason: 'multiple-candidates',
      };
    }
    const [match] = tagged;
    if (match !== undefined) {
      if (
        match.sourceResource === record.sourceResource &&
        match.startingBranch === record.requestedBranch
      ) {
        return { record, outcome: 'bound', session: match };
      }
      return {
        record,
        outcome: 'policy-deviation',
        reason: 'repository-or-branch-mismatch',
        deviation:
          'a tagged session does not match the reserved repository or branch',
      };
    }
    if (!walk.complete) {
      return notReached(
        record,
        `sessions walk incomplete (${walk.stopReason ?? 'unknown'})`
      );
    }
    const floor = Date.parse(record.createdAt) - OVERLAP_WINDOW_MS;
    const untagged = walk.sessions.filter((s) => {
      if (extractTitleTag(s.title).localId !== undefined) return false;
      if (boundElsewhere.has(s.sessionResource)) return false;
      if (
        s.sourceResource !== record.sourceResource ||
        s.startingBranch !== record.requestedBranch
      ) {
        return false;
      }
      const created =
        s.createTime !== undefined ? Date.parse(s.createTime) : NaN;
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

async function resolveOnOwnSession(
  deps: RuntimeDeps,
  adapter: SdkAdapter,
  record: OperationRecord,
  deadline: Deadline
): Promise<Resolution> {
  const sessionResource = record.sessionResource;
  if (sessionResource === undefined) {
    return notReached(record, 'the operation has no bound session');
  }
  try {
    await read(deps, deadline, () => adapter.getSession(sessionResource));
  } catch (err) {
    rethrowIfAuth(err);
    if (err instanceof AppErrorException) {
      return notReached(record, `session read failed (${err.appError.code})`);
    }
    throw err;
  }
  const floor = Date.parse(record.createdAt) - OVERLAP_WINDOW_MS;
  const matches = new Set<string>();
  const qualifies = (createTime: string): boolean => {
    const t = Date.parse(createTime);
    return !Number.isNaN(t) && t >= floor;
  };
  const walk = await walkActivities({
    adapter,
    sessionResource,
    pageSize: STATUS_PAGE_SIZE,
    start: {
      kind: 'watermark',
      createTime: record.createdAt,
      activityId: '',
    },
    clock: deps.clock,
    deadline,
    onActivity: (activity) => {
      if (!qualifies(activity.createTime)) return;
      if (
        record.kind === 'reply' &&
        activity.type === 'userMessaged' &&
        activity.message !== undefined &&
        record.promptDigest !== undefined &&
        messageDigest(activity.message) === record.promptDigest
      ) {
        matches.add(activity.activityId);
      }
      if (
        record.kind === 'approve' &&
        activity.type === 'planApproved' &&
        record.observedPlanId !== undefined &&
        activity.approvedPlanId === record.observedPlanId
      ) {
        matches.add(activity.activityId);
      }
    },
  });
  if (matches.size > 1) {
    return {
      record,
      outcome: 'ambiguous-reconcile',
      reason: 'multiple-candidates',
    };
  }
  if (matches.size === 1) return { record, outcome: 'bound' };
  if (!walk.complete) {
    return notReached(
      record,
      `activity walk incomplete (${walk.stopReason ?? 'unknown'})`
    );
  }
  return { record, outcome: 'unknown-outcome' };
}

// ---------------------------------------------------------------------------
// persistence
// ---------------------------------------------------------------------------

async function persist(
  deps: RuntimeDeps,
  resolutions: readonly Resolution[]
): Promise<void> {
  const now = nowFn(deps)().toISOString();
  await updateJournal(deps.dataDir, (operations) => {
    for (const r of resolutions) {
      const current = operations[r.record.localRequestId];
      // Another process may have settled it since this pass read the journal.
      if (current === undefined || !UNRESOLVED_STATUSES.has(current.status)) {
        continue;
      }
      const lastReconcile = {
        outcome: r.outcome,
        ...(r.reason !== undefined ? { reason: r.reason } : {}),
        observedAt: now,
      };
      let next: OperationRecord = { ...current, lastReconcile, updatedAt: now };
      if (r.outcome === 'bound') {
        next = {
          ...next,
          status: 'accepted',
          ...(r.session !== undefined
            ? {
                sessionResource: r.session.sessionResource,
                vendorState: r.session.vendorState,
                condition: conditionOf(r.session.vendorState),
              }
            : {}),
        };
      } else if (r.outcome === 'released') {
        next = { ...next, status: 'failed' };
      } else if (
        r.outcome === 'unknown-outcome' &&
        current.status === 'reserved'
      ) {
        next = { ...next, status: 'unknown-outcome' };
      } else if (
        r.outcome === 'policy-deviation' &&
        r.deviation !== undefined
      ) {
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
      operations[current.localRequestId] = applyRetention(next);
    }
  });
}

/**
 * Resolves the unresolved operations in scope. Returns one entry per
 * operation; an operation the deadline prevented from being checked is
 * `not-reached`, never resolved. The adapter is only created when something is
 * outstanding, so an empty reconcile needs no credential.
 */
export async function reconcile(
  deps: RuntimeDeps,
  journal: Journal,
  sessionResource: string | undefined,
  deadline: Deadline
): Promise<ReconciledEntry[]> {
  const targets = Object.values(journal.operations)
    .filter((r) => UNRESOLVED_STATUSES.has(r.status))
    .filter(
      (r) =>
        sessionResource === undefined || r.sessionResource === sessionResource
    );
  if (targets.length === 0) return [];

  const creates = targets.filter((r) => r.kind === 'create');
  const others = targets.filter(
    (r) => r.kind === 'reply' || r.kind === 'approve'
  );

  const resolutions = await withAdapter(deps, async (adapter) => {
    const out: Resolution[] = [];
    if (creates.length > 0) {
      const oldest = new Date(
        Math.min(...creates.map((r) => Date.parse(r.createdAt)))
      );
      const walk = await walkSessions(deps, adapter, oldest, deadline);
      out.push(...resolveCreates(journal, creates, walk));
    }
    for (const record of others) {
      out.push(
        isExpired(deps.clock, deadline)
          ? notReached(
              record,
              'the deadline expired before this operation was checked'
            )
          : await resolveOnOwnSession(deps, adapter, record, deadline)
      );
    }
    return out;
  });

  await persist(deps, resolutions);
  for (const r of resolutions) {
    if (
      r.outcome === 'released' &&
      r.record.kind === 'create' &&
      r.record.grantId !== undefined
    ) {
      await releaseSlotInStore(
        deps.dataDir,
        r.record.grantId,
        r.record.localRequestId,
        'reconcile-released'
      );
    }
  }
  return resolutions.map(entryOf);
}
