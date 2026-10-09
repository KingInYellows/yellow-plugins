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
  compareStamp,
  RESERVATION_SETTLE_MS,
  OVERLAP_WINDOW_MS,
  STATUS_PAGE_SIZE,
  walkActivities,
} from './activity-walk.js';
import { type Deadline, isExpired } from './deadline.js';
import { AppErrorException } from './errors.js';
import {
  type RuntimeDeps,
  nowFn,
  read,
  withAdapter,
  conditionOf,
} from './runtime-support.js';
import { releaseTerminalSlot, TERMINAL_VENDOR_STATES } from './slot-release.js';
import {
  absorbObservedOwners,
  conflictingSessionOwner,
  followsDispatch,
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

const RECONCILE_SESSIONS_PAGE_SIZE = 100;
const RECONCILE_SESSIONS_PAGE_CAP = 5;

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
  /** The userMessaged activity a reply was bound through; persisted so later passes cannot reuse it. */
  readonly echoActivityId?: string;
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
      // An `observe` owner is a guess made by status for a session it could not
      // match to a create (a trimmed title): it must not hide the session from
      // the lost create it may belong to.
      .filter(
        (r) =>
          ownsSession(r) &&
          r.kind !== 'observe' &&
          r.sessionResource !== undefined
      )
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
  deadline: Deadline,
  claimedEchoes: ReadonlyMap<string, string>,
  settledCandidates: readonly OperationRecord[] = []
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
  const competing = settledCandidates.filter(
    (c) =>
      c.echoActivityId === undefined &&
      ((c.kind === 'reply' && c.promptDigest !== undefined) ||
        (c.kind === 'approve' && c.observedPlanId !== undefined)) &&
      !records.some((r) => r.localRequestId === c.localRequestId)
  );
  const candidates = [...records, ...competing];
  const matches = new Map<string, Set<string>>(
    candidates.map((r) => [r.localRequestId, new Set<string>()])
  );
  // Matches whose order against the dispatch is unproven.
  const unordered = new Map<string, Set<string>>(
    candidates.map((r) => [r.localRequestId, new Set<string>()])
  );
  // The walk starts at the vendor floor when a record has one (an echo is
  // newer than it), else at the reservation time.
  const earliest = Math.min(
    ...records.map((r) => Date.parse(r.vendorFloorCreateTime ?? r.createdAt))
  );
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
      // An echo another operation already claimed explains that operation, not
      // a later one with the same message. A record's own claimed echo is
      // positive landing evidence for it and still matches.
      const claimedBy = claimedEchoes.get(activity.activityId);
      for (const record of candidates) {
        const claimed =
          claimedBy !== undefined && claimedBy !== record.localRequestId;
        const ordered = matches.get(record.localRequestId);
        const unproven = unordered.get(record.localRequestId);
        if (ordered === undefined || unproven === undefined) continue;
        // Strictly older than what the controller saw before dispatch: not an echo.
        if (
          record.vendorFloorActivityId === activity.activityId ||
          (record.vendorFloorCreateTime !== undefined &&
            compareStamp(
              { createTime: activity.createTime, activityId: '' },
              { createTime: record.vendorFloorCreateTime, activityId: '' }
            ) < 0)
        ) {
          continue;
        }
        // Proven newer: may bind. Equal, or no floor: ambiguous at best.
        const found = followsDispatch(
          record,
          activity.createTime,
          activity.activityId
        )
          ? ordered
          : unproven;
        if (
          record.kind === 'reply' &&
          !claimed &&
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
  // One vendor activity can explain only one record: two unresolved records with
  // the same digest (or two approvals of the same plan) that share an activity
  // cannot both be bound to it, and nothing says which one landed.
  const owners = new Map<string, number>();
  for (const group of [matches, unordered]) {
    for (const found of group.values()) {
      for (const id of found) owners.set(id, (owners.get(id) ?? 0) + 1);
    }
  }
  return records.map((record): Resolution => {
    const found = matches.get(record.localRequestId) ?? new Set<string>();
    const unproven = unordered.get(record.localRequestId) ?? new Set<string>();
    if (found.size > 1 || [...found].some((id) => (owners.get(id) ?? 0) > 1)) {
      return {
        record,
        outcome: 'ambiguous-reconcile',
        reason: 'multiple-candidates',
      };
    }
    if (unproven.size > 0) {
      return {
        record,
        outcome: 'ambiguous-reconcile',
        reason: 'dispatch-time-unknown',
      };
    }
    if (found.size === 1) {
      const [echoId] = found;
      return {
        record,
        outcome: 'bound',
        ...(record.kind === 'reply' && echoId !== undefined
          ? { echoActivityId: echoId }
          : {}),
      };
    }
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
): Promise<{
  readonly released: ReadonlySet<string>;
  /** Binds refused under the lock because another create already owns the session. */
  readonly refused: ReadonlyMap<string, Resolution>;
}> {
  const now = nowFn(deps)().toISOString();
  // The requests this pass actually moved to `failed`: only those give up a slot.
  const released = new Set<string>();
  const refused = new Map<string, Resolution>();
  await updateJournal(deps.dataDir, (operations) => {
    for (const r of resolutions) {
      const current = operations[r.record.localRequestId];
      // Another process may have settled it since this pass read the journal.
      if (current === undefined || !UNRESOLVED_STATUSES.has(current.status)) {
        continue;
      }
      // A second create owning the same session would leave two owners, and
      // `findBySessionResource` would pick one of them. Refuse: the create
      // stays unresolved for a human (an `observe` owner is folded in below).
      if (
        r.outcome === 'bound' &&
        r.session !== undefined &&
        current.kind === 'create' &&
        conflictingSessionOwner(
          operations,
          current,
          r.session.sessionResource
        ) !== undefined
      ) {
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
      let next: OperationRecord = { ...current, lastReconcile, updatedAt: now };
      if (r.outcome === 'bound') {
        next = {
          ...next,
          status: 'accepted',
          ...(r.echoActivityId !== undefined
            ? { echoActivityId: r.echoActivityId }
            : {}),
          ...(r.session !== undefined
            ? {
                sessionResource: r.session.sessionResource,
                vendorState: r.session.vendorState,
                condition: conditionOf(r.session.vendorState),
              }
            : {}),
        };
        // A create bound to a session already terminal frees its slot in this
        // run, like the normal status path would.
        if (
          r.session !== undefined &&
          TERMINAL_VENDOR_STATES.has(r.session.vendorState)
        ) {
          released.add(current.localRequestId);
        }
      } else if (r.outcome === 'released') {
        next = { ...next, status: 'failed' };
        released.add(current.localRequestId);
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
      // Binding to a session an `observe` row already owns: its deviations,
      // pause and read state move onto the create and the row is retired.
      if (r.outcome === 'bound' && next.kind === 'create') {
        next = absorbObservedOwners(operations, next);
      }
      operations[current.localRequestId] = applyRetention(next);
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
          // Activity ids are stored without their session, so two sessions can
          // hold the same id: claims are scoped to the session being resolved.
          const claimedEchoesOf = (session: string): Map<string, string> =>
            new Map<string, string>(
              Object.values(journal.operations).flatMap(
                (r): [string, string][] =>
                  r.echoActivityId !== undefined &&
                  r.sessionResource === session
                    ? [[r.echoActivityId, r.localRequestId]]
                    : []
              )
            );
          const settledReplies = Object.values(journal.operations).filter(
            (r) =>
              (r.kind === 'reply' || r.kind === 'approve') &&
              (r.status === 'accepted' || r.status === 'reconciled')
          );
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
                deadline,
                claimedEchoesOf(session),
                settledReplies.filter((c) => c.sessionResource === session)
              ))
            );
          }
          return out;
        })),
  ];

  // A young reservation is reported but not recorded: `not-reached` would make
  // it abandonable while its write may still be in flight.
  const persisted = await persist(
    deps,
    resolutions.filter((r) => !early.includes(r))
  );
  const released = persisted.released;
  for (const [i, r] of resolutions.entries()) {
    const refusal = persisted.refused.get(r.record.localRequestId);
    if (refusal !== undefined) resolutions[i] = refusal;
  }
  // One failed release must not hide the others or the report; the slot stays
  // held, which only makes the grant stricter, and the entry says so.
  const slotStuck = new Set<string>();
  for (const r of resolutions) {
    if (
      (r.outcome === 'released' || r.outcome === 'bound') &&
      released.has(r.record.localRequestId) &&
      r.record.kind === 'create'
    ) {
      // `released` creates never reached a session; `bound` ones count only
      // when the listed vendor state is terminal (checked by the helper).
      const stuck = await releaseTerminalSlot(
        deps.dataDir,
        r.record,
        r.outcome === 'released' ? 'failed' : r.session?.vendorState
      );
      if (stuck) slotStuck.add(r.record.localRequestId);
    }
  }
  return resolutions.map((r) =>
    slotStuck.has(r.record.localRequestId)
      ? {
          ...entryOf({
            ...r,
            reason: `${r.reason ?? 'released'}; the grant slot could not be released (revoke and rewrite the grant to reclaim it)`,
          }),
          slotStuck: true as const,
        }
      : entryOf(r)
  );
}
