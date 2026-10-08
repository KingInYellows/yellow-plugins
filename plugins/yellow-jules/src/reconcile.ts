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
  conditionOf,
} from './runtime-support.js';
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

/** Longer than any write deadline (cli MAX_DEADLINE_MS 200 s) plus a minute of slack. */
export const RESERVATION_SETTLE_MS = 260_000;
export const RECONCILE_SESSIONS_PAGE_SIZE = 100;
export const RECONCILE_SESSIONS_PAGE_CAP = 5;

/** The fields reconcile reads from a listed session; outputs and generated files (patch text) are dropped as pages arrive. */
type SessionProjection = Pick<
  AdapterSession,
  | 'sessionResource'
  | 'title'
  | 'vendorState'
  | 'createTime'
  | 'sourceResource'
  | 'startingBranch'
>;

function project(s: AdapterSession): SessionProjection {
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

interface Resolution {
  readonly record: OperationRecord;
  readonly outcome: ReconcileOutcome;
  readonly reason?: string;
  readonly session?: SessionProjection;
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
  readonly sessions: readonly SessionProjection[];
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
  const sessions: SessionProjection[] = [];
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
    for (const session of page.sessions) sessions.push(project(session));
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

/**
 * Every unresolved reply and approve of ONE session, resolved with one `info()`
 * and one activity walk from the earliest reservation, so ten stuck operations
 * on a session cost one walk, not ten.
 */
async function resolveOnOwnSession(
  deps: RuntimeDeps,
  adapter: SdkAdapter,
  sessionResource: string,
  records: readonly OperationRecord[],
  deadline: Deadline
): Promise<Resolution[]> {
  try {
    await read(deps, deadline, () => adapter.getSession(sessionResource));
  } catch (err) {
    rethrowIfAuth(err);
    if (err instanceof AppErrorException) {
      return records.map((record) =>
        notReached(record, `session read failed (${err.appError.code})`)
      );
    }
    throw err;
  }
  const floors = new Map(
    records.map((r) => [
      r.localRequestId,
      Date.parse(r.createdAt) - OVERLAP_WINDOW_MS,
    ])
  );
  const matches = new Map<string, Set<string>>(
    records.map((r) => [r.localRequestId, new Set<string>()])
  );
  const earliest = Math.min(...records.map((r) => Date.parse(r.createdAt)));
  const walk = await walkActivities({
    adapter,
    sessionResource,
    pageSize: STATUS_PAGE_SIZE,
    start: {
      kind: 'watermark',
      createTime: new Date(earliest).toISOString(),
      activityId: '',
    },
    clock: deps.clock,
    deadline,
    onActivity: (activity) => {
      const created = Date.parse(activity.createTime);
      if (Number.isNaN(created)) return;
      for (const record of records) {
        // Only activities at or after this reservation (minus the overlap window).
        if (created < (floors.get(record.localRequestId) ?? Infinity)) continue;
        const found = matches.get(record.localRequestId);
        if (found === undefined) continue;
        if (
          record.kind === 'reply' &&
          activity.type === 'userMessaged' &&
          activity.message !== undefined &&
          record.promptDigest !== undefined &&
          messageDigest(activity.message) === record.promptDigest
        ) {
          found.add(activity.activityId);
        }
        if (
          record.kind === 'approve' &&
          activity.type === 'planApproved' &&
          record.observedPlanId !== undefined &&
          activity.approvedPlanId === record.observedPlanId
        ) {
          found.add(activity.activityId);
        }
      }
    },
  });
  return records.map((record): Resolution => {
    const found = matches.get(record.localRequestId) ?? new Set<string>();
    if (found.size > 1) {
      return {
        record,
        outcome: 'ambiguous-reconcile',
        reason: 'multiple-candidates',
      };
    }
    if (found.size === 1) return { record, outcome: 'bound' };
    if (!walk.complete) {
      return notReached(
        record,
        `activity walk incomplete (${walk.stopReason ?? 'unknown'})`
      );
    }
    return { record, outcome: 'unknown-outcome' };
  });
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

  // A `reserved` row may still have its POST in flight in another process; only
  // an `unknown-outcome` row is certainly settled on the caller's side. A
  // reservation younger than the longest write deadline is left alone, so
  // reconcile can never free (and then be overwritten by) a live write.
  const nowMs = deps.clock.now();
  const inFlight = targets.filter(
    (r) =>
      r.status === 'reserved' &&
      nowMs - Date.parse(r.createdAt) < RESERVATION_SETTLE_MS
  );
  const settled = targets.filter((r) => !inFlight.includes(r));
  const early: Resolution[] = inFlight.map((record) =>
    notReached(
      record,
      'the reservation may still be in flight; try again shortly'
    )
  );
  const creates = settled.filter((r) => r.kind === 'create');
  const others = settled.filter(
    (r) => r.kind === 'reply' || r.kind === 'approve'
  );

  const resolutions = [
    ...early,
    ...(settled.length === 0
      ? []
      : await withAdapter(deps, async (adapter) => {
          const out: Resolution[] = [];
          if (creates.length > 0) {
            const oldest = new Date(
              Math.min(...creates.map((r) => Date.parse(r.createdAt)))
            );
            const walk = await walkSessions(deps, adapter, oldest, deadline);
            out.push(...resolveCreates(journal, creates, walk));
          }
          const bySession = new Map<string, OperationRecord[]>();
          for (const record of others) {
            if (record.sessionResource === undefined) {
              out.push(
                notReached(record, 'the operation has no bound session')
              );
              continue;
            }
            const list = bySession.get(record.sessionResource) ?? [];
            list.push(record);
            bySession.set(record.sessionResource, list);
          }
          for (const [session, records] of bySession) {
            if (isExpired(deps.clock, deadline)) {
              out.push(
                ...records.map((record) =>
                  notReached(
                    record,
                    'the deadline expired before this operation was checked'
                  )
                )
              );
              continue;
            }
            out.push(
              ...(await resolveOnOwnSession(
                deps,
                adapter,
                session,
                records,
                deadline
              ))
            );
          }
          return out;
        })),
  ];

  // A young reservation is reported but not recorded: `not-reached` would make
  // it abandonable while its write may still be in flight.
  await persist(
    deps,
    resolutions.filter((r) => !early.includes(r))
  );
  for (const r of resolutions) {
    if (
      r.outcome === 'released' &&
      r.record.kind === 'create' &&
      r.record.grantId !== undefined
    ) {
      await releaseSlotInStore(
        deps.dataDir,
        r.record.grantId,
        r.record.localRequestId
      );
    }
  }
  return resolutions.map(entryOf);
}
