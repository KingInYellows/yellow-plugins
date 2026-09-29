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
// Adapter port (read-only in PR2)
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

/**
 * Dependency-injection seam: runtime.ts depends only on this interface, so
 * tests inject fake-sdk.ts instead of the real SDK wrapper. PR2 exposes no
 * mutating method at all — `session(config)`, `send()`, and `approve()` are
 * wired by PR3.
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

/** `yellow` records come from a yellow write; `external` sessions were first seen by a read (PR2 has no `delegate`). */
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
  readonly promptDigest?: string;
  readonly observedPlanId?: string;
  readonly vendorState?: string;
  readonly condition?: string;
  // Activity read-state: written only by `status` (contract "Activity walk").
  readonly lastActivityCreateTime?: string;
  readonly lastActivityId?: string;
  readonly resumePageToken?: string;
  readonly recentActivityIds: readonly string[];
  readonly activityCount: number;
  readonly pendingPlan?: PendingPlan;
  readonly resumeRestartCount: number;
  // Written only by `collect`.
  readonly artifactResumePageToken?: string;
  readonly artifacts: readonly ArtifactRecord[];
  readonly deviations: readonly DeviationRecord[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Journal {
  readonly version: 1;
  /** Set only by the recorded R53 observation; until then a no-candidate reconcile never releases (contract `status`). */
  readonly archiveVisibilityConfirmed: boolean;
  /** Keyed by localRequestId; built with Object.create(null). */
  readonly operations: Record<string, OperationRecord>;
}
