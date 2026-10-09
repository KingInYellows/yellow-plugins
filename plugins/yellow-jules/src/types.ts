/**
 * Shared runtime types for the yellow-jules CLI. Nothing here imports the
 * Jules SDK — these are normalized, already-validated shapes the
 * adapter translates SDK responses into, so runtime.ts, state.ts, and tests
 * only ever depend on this module.
 */

/**
 * Distinguishes "the vendor contract does not expose this" from "the value
 * is empty" — callers must not conflate the two (JULES_UNSUPPORTED_CAPABILITY).
 */
export type CapabilityResult<T> =
  | { readonly supported: true; readonly value: T }
  | { readonly supported: false; readonly reason: string };

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

// ---------------------------------------------------------------------------
// Adapter port (reads, plus three writes that are never retried)
// ---------------------------------------------------------------------------

export type AdapterOutput =
  | {
      readonly type: 'pullRequest';
      /** Vendor text; validated against the session source before any rendering as a link. */
      readonly url: string;
      readonly title: string;
      readonly description: string;
    }
  | {
      readonly type: 'changeSet';
      readonly source: string;
      readonly unidiffPatch: string;
      readonly baseCommitId: string;
      readonly suggestedCommitMessage: string;
    };

export interface AdapterGeneratedFile {
  /** Vendor path: data only, never used in a filesystem operation. */
  readonly path: string;
  readonly changeType: string;
  readonly content: string;
}

export interface AdapterSession {
  /** Validated `sessions/{id}`. */
  readonly sessionResource: string;
  /**
   * The SDK's SessionState. The pinned SDK maps any unknown REST state to
   * `unspecified` and does not keep the raw string, so an unknown state
   * surfaces as `unspecified` (condition `needs-inspection`, R10).
   */
  readonly vendorState: string;
  readonly title: string;
  readonly createTime?: string;
  readonly updateTime?: string;
  /** Validated `sources/github/{owner}/{repo}`, when the session carries one. */
  readonly sourceResource?: string;
  readonly startingBranch?: string;
  /** Display-only, https-checked. */
  readonly url?: string;
  readonly outputs: readonly AdapterOutput[];
  readonly generatedFiles: readonly AdapterGeneratedFile[];
  readonly archived: boolean;
}

export interface PlanStepRecord {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly index: number;
}

export interface AdapterPlan {
  readonly planId: string;
  readonly steps: readonly PlanStepRecord[];
}

export type AdapterActivityArtifact =
  | {
      readonly type: 'changeSet';
      readonly source: string;
      readonly unidiffPatch: string;
      readonly baseCommitId: string;
      readonly suggestedCommitMessage: string;
    }
  | { readonly type: 'bashOutput' }
  | { readonly type: 'media' };

export interface AdapterActivity {
  /** Validated activity id (last segment of the activity name). */
  readonly activityId: string;
  readonly createTime: string;
  /** SDK activity type (`planGenerated`, `planApproved`, `agentMessaged`, ...). */
  readonly type: string;
  readonly originator?: string;
  readonly plan?: AdapterPlan;
  /** `planApproved` only. */
  readonly approvedPlanId?: string;
  /**
   * `userMessaged` / `agentMessaged` only: vendor-writable text, held in
   * memory for digest matching (reconcile, R32) and fenced rendering
   * (supervise); never persisted or printed unfenced.
   */
  readonly message?: string;
  readonly artifacts: readonly AdapterActivityArtifact[];
}

export interface ActivityPage {
  readonly activities: readonly AdapterActivity[];
  readonly nextPageToken?: string;
  /** The SDK mapper could not parse an activity on this page; the walk must stop (contract "Activity walk"). */
  readonly unmappedActivity?: boolean;
}

export interface SessionPage {
  readonly sessions: readonly AdapterSession[];
  readonly nextPageToken?: string;
}

export interface AdapterSource {
  readonly sourceResource: string;
  readonly owner: string;
  readonly repo: string;
}

export interface SourcePage {
  readonly sources: readonly AdapterSource[];
  /** More sources exist beyond `pageSize` (the SDK exposes sources only as an auto-paginating iterator). */
  readonly truncated: boolean;
  /** Set when a source is not a GitHub repository the SDK mapper understands. */
  readonly unsupportedReason?: string;
}

export interface PageOptions {
  readonly pageSize: number;
  readonly pageToken?: string;
  readonly filter?: string;
}

export interface CreateSessionRequest {
  readonly prompt: string;
  readonly owner: string;
  readonly repo: string;
  readonly baseBranch: string;
  /** Already carries the `[yellow:<local-id>]` reconcile tag. */
  readonly title: string;
}

export interface CreatedSession {
  /** Validated `sessions/{id}`. */
  readonly sessionResource: string;
}

/**
 * Dependency-injection seam: runtime.ts depends only on this interface, so
 * tests inject fake-sdk.ts instead of the real SDK wrapper. The three write
 * methods are never retried; a failure carries `AdapterError.dispatched`, and
 * anything after dispatch that is not a clear rejection is an unknown outcome
 * (R16). There is deliberately no cancel, pause, resume, run, all, result, ask
 * or waitFor (R9, R11).
 */
export interface SdkAdapter {
  getSession(sessionResource: string): Promise<AdapterSession>;
  listSessions(options: PageOptions): Promise<SessionPage>;
  listActivities(
    sessionResource: string,
    options: PageOptions
  ): Promise<ActivityPage>;
  getSource(owner: string, repo: string): Promise<AdapterSource>;
  listSources(options: { readonly pageSize: number }): Promise<SourcePage>;
  /** One POST; requireApproval true and autoPr false (R12). */
  createSession(input: CreateSessionRequest): Promise<CreatedSession>;
  /** One non-blocking POST (R9). */
  sendMessage(sessionResource: string, message: string): Promise<void>;
  /** One POST; the endpoint takes no plan id, so compare-and-approve is not atomic. */
  approvePlan(sessionResource: string): Promise<void>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Journal records (spec "Data model", contract "Local state")
// ---------------------------------------------------------------------------

export type OperationKind =
  | 'create'
  | 'reply'
  | 'approve'
  | 'collect'
  | 'observe';

/** `yellow` records come from a yellow write; `external` sessions were first seen by a read (a yellow write is `delegate`, `reply`, or `approve`). */
export type OperationOrigin = 'yellow' | 'external';

export type OperationStatus =
  | 'reserved'
  | 'accepted'
  | 'unknown-outcome'
  | 'reconciled'
  | 'rejected'
  | 'failed'
  | 'observed';

export type ArtifactVerification =
  | 'unverified'
  | 'passed'
  | 'failed'
  | 'unavailable'
  | 'errored';

export interface ArtifactRecord {
  readonly kind: 'patch' | 'pr-ref' | 'generated-file';
  readonly sessionResource: string;
  /** Path under `<dataDir>/artifacts/<local-id>/`, relative to that directory. */
  readonly path?: string;
  readonly sha256?: string;
  readonly baseCommit?: string;
  readonly prUrl?: string;
  readonly vendorPath?: string;
  /** sha256 of the raw vendor path (identity only; the raw path is never persisted). */
  readonly vendorPathDigest?: string;
  readonly secretShapedContent: boolean;
  readonly collectedAt: string;
  /** Never optional: initialized `unverified`, written only by the R43 verification step. */
  readonly verification: ArtifactVerification;
}

export interface DeviationRecord {
  readonly kind: 'policy-deviation';
  readonly reason: string;
  /** External PR reference (R13); present only when it passed validatePullRequestUrl. */
  readonly prUrl?: string;
  readonly observedAt: string;
  readonly reconciled: boolean;
}

export interface PendingPlan {
  readonly planId: string;
  readonly steps: readonly PlanStepRecord[];
  readonly activityCreateTime: string;
  readonly activityId: string;
  /** Set by the walk when plans with differing content share the newest createTime: which is current is unknowable, so the plan is never actionable. */
  readonly ambiguous?: true;
  /** Set by `status` when redaction changed the plan text it persisted; such a plan is never actionable. */
  readonly redacted?: true;
}

export interface OperationRecord {
  readonly localRequestId: string;
  readonly localId: string;
  readonly kind: OperationKind;
  readonly origin: OperationOrigin;
  readonly status: OperationStatus;
  readonly sessionResource?: string;
  readonly repository?: string;
  readonly requestedBranch?: string;
  readonly observedHead?: string;
  readonly sourceResource?: string;
  readonly taskRef?: string;
  readonly grantId?: string;
  /** Set only by a yellow create; `false` makes an observed vendor PR a policy deviation (R13). */
  readonly autoPrRequested?: boolean;
  /** A `delegate --correction` repair launch; it needs an earlier plain launch of the same task under the grant. */
  readonly correction?: boolean;
  readonly promptDigest?: string;
  /** The vendor activity that echoed this operation's message; each landed message explains at most one activity. */
  readonly echoActivityId?: string;
  /** The vendor `createTime` of that echo: same-clock evidence for ordering against vendor plan stamps. */
  readonly echoCreateTime?: string;
  /**
   * Set when a walk judged same-text messages to outnumber the settled writes
   * sharing this unresolved write's text: which message is whose is unknowable,
   * so no later walk may give it an `echoActivityId`; only reconcile or abandon
   * settles it.
   */
  readonly echoAmbiguous?: boolean;
  /** The reviewed plan digest an `approve` was reserved against; reconcile checks the approved plan against it. */
  readonly observedPlanDigest?: string;
  readonly observedPlanId?: string;
  readonly vendorState?: string;
  readonly condition?: string;
  // Activity read-state: written only by `status` (contract "Activity walk").
  readonly lastActivityCreateTime?: string;
  readonly lastActivityId?: string;
  /** When `status` last finished a COMPLETE walk; `supervise --clear-pause` needs one after the pause. */
  readonly lastCompleteWalkAt?: string;
  /** Journal sequence taken when that walk began; `supervise --clear-pause` compares it with the pause's sequence. */
  readonly lastCompleteWalkSeq?: number;
  readonly resumePageToken?: string;
  readonly recentActivityIds: readonly string[];
  readonly activityCount: number;
  readonly pendingPlan?: PendingPlan;
  /**
   * The newest `planGenerated` any `status` walk has read, kept after the plan
   * is approved or cleared. `seq` is the journal sequence at which `status`
   * first recorded this plan id; supervise compares it with the evaluation's
   * sequence to catch a swap that an intervening status consumed (R32).
   */
  readonly lastGeneratedPlan?: {
    readonly planId: string;
    readonly activityId: string;
    readonly activityCreateTime: string;
    readonly seq?: number;
    /** Digest of the plan's id and (redacted) steps; a same-id plan with other steps differs. */
    readonly planDigest?: string;
  };
  /** Newest `planApproved` read by a partial walk, kept while `resumePageToken` is stored. */
  readonly resumeApproval?: {
    readonly createTime: string;
    readonly activityId: string;
  };
  readonly resumeRestartCount: number;
  // Written only by `collect`.
  readonly artifactResumePageToken?: string;
  readonly artifactResumeRestartCount?: number;
  readonly artifacts: readonly ArtifactRecord[];
  readonly deviations: readonly DeviationRecord[];
  /** Written only by `status --reconcile`; `abandon` accepts `ambiguous-reconcile` and `not-reached`, and `unknown-outcome` for a reply or approve. */
  readonly lastReconcile?: {
    readonly outcome: ReconcileOutcome;
    readonly reason?: string;
    readonly observedAt: string;
  };
  /** Written by `supervise` (R32, R33) and, for `outsideSeen`, by `status`. */
  readonly supervision?: SupervisionState;
  /** Set under the journal lock when outside activity is recorded on the session while this reply/approve is reserved but not dispatched; the pre-POST re-check refuses it. */
  readonly invalidatedBy?: 'outside-activity';
  /** Set under the journal lock by the final pre-POST check; only a record carrying it may have landed, so only it can claim an echo. */
  readonly dispatchedAt?: string;
  /**
   * The newest vendor activity (`createTime`, id) the controller read just
   * before this write was sent. An echo must be strictly newer by vendor
   * `createTime`; an equal or older stamp, or no floor at all, leaves the match
   * unordered (never bound). Same clock on both sides: no local time is compared.
   */
  readonly vendorFloorCreateTime?: string;
  readonly vendorFloorActivityId?: string;
  /** The session had no activities at all before dispatch: any matching activity is newer by construction. */
  readonly vendorFloorEmpty?: true;
  /** Journal sequence at reservation; absent on records written before sequences (order unknown). */
  readonly createSeq?: number;
  /** Journal sequence stamped with `dispatchedAt`, in the same critical section. */
  readonly dispatchSeq?: number;
  /** Set only by `abandon`, which maps onto terminal `failed` (no new status). */
  readonly abandonedAt?: string;
  readonly abandonReason?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ReconciledEntry {
  readonly localRequestId: string;
  readonly kind: string;
  readonly outcome: ReconcileOutcome;
  readonly reason?: string;
  readonly sessionResource?: string;
  /** The create was released but its grant slot could not be freed. */
  readonly slotStuck?: true;
  /** The slot was left held: this host is not the grant's controller, so status stays read-only. */
  readonly slotReleaseSkipped?: true;
  /** The bound approve landed on a different plan than the reviewed one; the deviation is recorded on the session owner. */
  readonly policyDeviation?: true;
}

export type ReconcileOutcome =
  | 'bound'
  | 'released'
  | 'ambiguous-reconcile'
  | 'policy-deviation'
  | 'unknown-outcome'
  | 'not-reached';

export type SupervisionDecision =
  | 'no-change'
  | 'check-failed'
  | 'pass-aborted'
  | 'needs-plan-review'
  | 'needs-answer'
  | 'needs-verification'
  | 'escalate'
  | 'paused';

/** Per-session supervision memory: a pause, the check-failed backoff, and the last decision. */
export interface SupervisionState {
  readonly paused?: {
    readonly reason: string;
    readonly observedAt: string;
    readonly activityId?: string;
    /** Journal sequence at which the pause was recorded; absent on pauses written before sequences. */
    readonly observedSeq?: number;
  };
  readonly backoff?: {
    readonly failures: number;
    /** ISO time before which the next pass is advised to wait. */
    readonly nextCheckAt: string;
  };
  readonly lastDecision?: {
    readonly decision: SupervisionDecision;
    readonly decidedAt: string;
  };
  /**
   * Set by `status` (not only `supervise`) when a walk sees a user message that
   * is none of this plugin's own, so a plain `status` can never consume the
   * evidence before `supervise` pauses on it (R32). Cleared with the pause.
   */
  readonly outsideSeen?: {
    readonly activityId: string;
    /**
     * Other outside messages tied with `activityId` on the newest `createTime`.
     * Equal times are unordered, so clearing the pause must cover all of them.
     */
    readonly alsoActivityIds?: readonly string[];
    readonly observedAt: string;
    /**
     * The message's vendor `createTime`; with `activityId` it is the stamp the
     * marker is ordered by, so it only ever moves to a strictly newer message.
     * Absent on markers written before the stamp was kept.
     */
    readonly createTime?: string;
    /** Journal sequence at which the marker was recorded; absent on markers written before sequences. */
    readonly observedSeq?: number;
  };
  /**
   * User messages a walk saw but could not yet classify (a still-unsettled or
   * post-walk write might have explained them), keyed by activity id, with when
   * a walk first read each. A write dispatched after that time can never be the
   * echo of the message, however many walks later it is compared. Removed when
   * the message is claimed or recorded as outside activity.
   */
  readonly heldActivities?: Readonly<Record<string, string>>;
  /**
   * The journal sequence of the walk that first read each held message (same
   * keys as `heldActivities`). A write whose sequence is not below it cannot be
   * proven to precede the first read. Absent on holds written before sequences.
   */
  readonly heldSeqs?: Readonly<Record<string, number>>;
  /**
   * The plan a `needs-plan-review` pass presented, and when. A different plan
   * appearing before it is approved, with no reply of ours since, pauses (R32).
   */
  readonly evaluatedPlan?: {
    readonly planId: string;
    /** Digest of the evaluated plan's id and steps; absent on evaluations written before it existed. */
    readonly planDigest?: string;
    readonly evaluatedAt: string;
    /** Journal sequence of the evaluation; absent on evaluations written before sequences (order unknown). */
    readonly evaluatedSeq?: number;
  };
  /**
   * Start of the pass that last set or cleared `evaluatedPlan`. Passes run
   * unlocked, so a pass that began earlier never overwrites or clears the
   * evaluation of one that began later.
   */
  readonly evaluatedPassAt?: string;
  /** Journal sequence taken at the start of that pass; orders passes without relying on clocks. */
  readonly evaluatedPassSeq?: number;
}

export interface Journal {
  readonly version: 1;
  /** Set only by the recorded R53 observation; until then a no-candidate reconcile never releases (contract `status`). */
  readonly archiveVisibilityConfirmed: boolean;
  /**
   * Strictly increasing ordering counter, advanced only under the journal lock.
   * It orders events whose relative order decides authority (write create and
   * dispatch, plan evaluation, walk and pass start, first read of a held
   * message); ISO timestamps stay for display and TTLs because two events can
   * share a millisecond. Absent in journals written before sequences: records
   * without a sequence have an unknown order and never authorize.
   */
  seq?: number;
  /** Keyed by localRequestId; built with Object.create(null). */
  readonly operations: Record<string, OperationRecord>;
}

// ---------------------------------------------------------------------------
// Grants (R30) and the controller authority (R38)
// ---------------------------------------------------------------------------

export type GrantOperation = 'create' | 'reply' | 'approve' | 'collect';

/** The R38 reference every grant carries to the host-local controller authority file. */
export interface EpochRef {
  readonly controllerId: string;
  readonly epoch: number;
}

export interface GrantUsage {
  /** Local request ids of the creates holding an active-session slot (stable from reservation to release). */
  readonly activeSessionRefs: readonly string[];
  /** Never decrements (R31). */
  readonly totalTasks: number;
  /** Keyed by task ref; built with Object.create(null). */
  readonly correctiveRounds: Readonly<Record<string, number>>;
}

export interface GrantRecord {
  /** `jg-<32 hex>`. */
  readonly grantId: string;
  /** `owner/repo`. */
  readonly repository: string;
  readonly sourceResource: string;
  /** An exact ref, or a ref ending in a single trailing `*`. */
  readonly branchPattern: string;
  readonly taskRefs: readonly string[];
  readonly operations: readonly GrantOperation[];
  readonly maxActiveSessions: number;
  readonly maxTotalTasks: number;
  readonly maxCorrectiveRounds: number;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly owner: string;
  readonly controllerId: string;
  readonly epochRef: EpochRef;
  readonly revokedAt?: string;
  readonly usage: GrantUsage;
}

/** `state/grants.json`, written only by the TTY-confirmed `authorize` path and the counters it guards. */
export interface GrantsFile {
  readonly version: 1;
  /** Keyed by grantId; built with Object.create(null). */
  readonly grants: Record<string, GrantRecord>;
}

/** `<controllerDir>/<controllerId>.json` (R38). */
export interface ControllerAuthority {
  readonly controllerId: string;
  readonly epoch: number;
  /** Canonical realpath of the data directory this file authorizes. */
  readonly dataDir: string;
  readonly updatedAt: string;
}
