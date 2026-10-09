/**
 * Operation layer: one exported async function per CLI subcommand, each
 * taking a RuntimeDeps bag (the adapter factory is injected so tests use
 * fake-sdk.ts) plus its own already-parsed args. cli.ts and supervise.ts are the
 * callers — cli.ts owns argv, the JSON envelope, and exit codes; this module owns the
 * contract rules.
 *
 * This module holds the reads (`setup`, `list`, `status`, `collect`) and issues
 * no vendor-mutating request. The grant-gated writes live in mutations.ts, the
 * supervision pass in supervise.ts, and reconcile in reconcile.ts.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  COLLECT_PAGE_SIZE,
  compareStamp,
  nextRing,
  STATUS_PAGE_SIZE,
  walkActivities,
  type WalkStart,
} from './activity-walk.js';
import { releaseSlotInStore } from './authority.js';
import {
  type CredentialSource,
  ensureOwnerOnlyDir,
  hasEnvApiKey,
  resolveArtifactsDir,
  resolvePluginRoot,
} from './config.js';
import {
  DEFAULT_COLLECT_DEADLINE_MS,
  DEFAULT_READ_DEADLINE_MS,
  deadlineIn,
  remainingMs,
} from './deadline.js';
import { errorLabel, throwAppError } from './errors.js';
import { reconcile } from './reconcile.js';
import { redact, redactDeep, scanSecretShapes } from './redact.js';
import {
  type Attention,
  attentionOf,
  boundRecord,
  checkPolicyDeviation,
  conditionOf,
  nowFn,
  prepare,
  read,
  resolveSessionResource,
  type RuntimeDeps,
  withAdapter,
} from './runtime-support.js';
import {
  installSdk as realInstallSdk,
  probeSdkResolution,
  type SdkResolution,
} from './sdk-resolver.js';
import {
  claimOwnEchoes,
  findBySessionResource,
  hasUnreconciledDeviation,
  messageDigest,
  ownsSession,
  readJournal,
  recordArtifacts,
  upsertArtifactResumeToken,
  upsertReadState,
  withJournalLock,
} from './state.js';
import type {
  AdapterActivity,
  AdapterSession,
  ArtifactRecord,
  CapabilityResult,
  OperationRecord,
  PendingPlan,
  ReconciledEntry,
} from './types.js';
import {
  extractTitleTag,
  validateBaseCommitId,
  validatePageToken,
  validatePullRequestUrl,
} from './validate.js';

export {
  type Attention,
  attentionOf,
  boundRecord,
  checkPolicyDeviation,
  conditionOf,
  nowFn,
  prepare,
  read,
  REAL_CLOCK,
  resolveSessionResource,
  type RuntimeDeps,
  withAdapter,
} from './runtime-support.js';

// ---------------------------------------------------------------------------
// Unsupported capabilities (R11)
// ---------------------------------------------------------------------------

export type UnsupportedCapability =
  | 'cancel'
  | 'pause'
  | 'resume'
  | 'cost'
  | 'exactly-once';

export const UNSUPPORTED_CAPABILITIES: Readonly<
  Record<UnsupportedCapability, CapabilityResult<never>>
> = Object.freeze({
  cancel: {
    supported: false,
    reason:
      'the Jules API exposes no session cancel; stop it from the Jules console',
  },
  pause: { supported: false, reason: 'the Jules API exposes no session pause' },
  resume: {
    supported: false,
    reason: 'the Jules API exposes no session resume',
  },
  cost: {
    supported: false,
    reason: 'the Jules API exposes no per-session cost',
  },
  'exactly-once': {
    supported: false,
    reason:
      'the Jules API offers no idempotency key; the local request id deduplicates locally only',
  },
});

export function unsupportedCapability(name: UnsupportedCapability): never {
  const result = UNSUPPORTED_CAPABILITIES[name];
  return throwAppError(
    'JULES_UNSUPPORTED_CAPABILITY',
    `${name} is not supported: ${result.supported ? '' : result.reason}`
  );
}

// ---------------------------------------------------------------------------
// setup
// ---------------------------------------------------------------------------

export const SOURCES_PROBE_PAGE_SIZE = 20;

export interface SetupArgs {
  readonly installSdk: boolean;
  readonly deadlineMs?: number;
}

export interface SetupResult extends Attention {
  readonly operation: 'setup';
  readonly credentialSource: CredentialSource;
  readonly sdkResolution: SdkResolution;
  readonly sdkVersion?: string;
  readonly sdkIntegrity?: string;
  readonly sdkEntrySha256?: string;
  readonly installed?: true;
  readonly sourcesReachable: CapabilityResult<{
    readonly count: number;
    readonly truncated: boolean;
  }>;
}

export async function setup(
  deps: RuntimeDeps,
  args: SetupArgs
): Promise<SetupResult> {
  prepare(deps);
  const deadline = deadlineIn(
    deps.clock,
    args.deadlineMs ?? DEFAULT_READ_DEADLINE_MS
  );
  const credentialSource: CredentialSource = hasEnvApiKey(deps.env)
    ? 'env'
    : 'none';

  const probe = args.installSdk
    ? await (
        deps.installSdk ??
        ((d, o) =>
          realInstallSdk(d, {
            pluginRoot: deps.pluginRoot ?? resolvePluginRoot(),
            ...(o !== undefined ? { deadlineMs: o.deadlineMs } : {}),
          }))
      )(deps.dataDir, { deadlineMs: remainingMs(deps.clock, deadline) })
    : (
        deps.probeSdk ??
        ((d) =>
          probeSdkResolution(d, {
            pluginRoot: deps.pluginRoot ?? resolvePluginRoot(),
          }))
      )(deps.dataDir);

  let sourcesReachable: SetupResult['sourcesReachable'];
  if (probe.resolution === 'missing') {
    sourcesReachable = {
      supported: false,
      reason: 'the Jules SDK is not installed',
    };
  } else if (credentialSource === 'none') {
    // No credential: never contact the vendor.
    sourcesReachable = { supported: false, reason: 'JULES_API_KEY is not set' };
  } else {
    const page = await withAdapter(deps, (adapter) =>
      read(deps, deadline, () =>
        adapter.listSources({ pageSize: SOURCES_PROBE_PAGE_SIZE })
      )
    );
    sourcesReachable =
      page.unsupportedReason !== undefined
        ? { supported: false, reason: page.unsupportedReason }
        : {
            supported: true,
            value: { count: page.sources.length, truncated: page.truncated },
          };
  }

  const flags: string[] = [];
  if (credentialSource === 'none') flags.push('credentialSource');
  if (probe.resolution === 'missing') flags.push('sdkResolution');
  if (!sourcesReachable.supported) flags.push('sourcesReachable');

  return {
    operation: 'setup',
    credentialSource,
    sdkResolution: probe.resolution,
    ...(probe.sdkVersion !== undefined ? { sdkVersion: probe.sdkVersion } : {}),
    ...(probe.sdkIntegrity !== undefined
      ? { sdkIntegrity: probe.sdkIntegrity }
      : {}),
    ...(probe.sdkEntrySha256 !== undefined
      ? { sdkEntrySha256: probe.sdkEntrySha256 }
      : {}),
    ...(args.installSdk ? { installed: true as const } : {}),
    sourcesReachable,
    ...attentionOf(flags),
  };
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

export const LIST_DEFAULT_LIMIT = 20;
export const LIST_MAX_LIMIT = 100;

export interface ListArgs {
  readonly limit?: number;
  readonly pageToken?: string;
  readonly deadlineMs?: number;
}

export interface ListedSession {
  readonly localId?: string;
  readonly sessionResource: string;
  readonly vendorState: string;
  readonly condition: string;
  readonly title: string;
  readonly createTime?: string;
}

export interface ListResult extends Attention {
  readonly operation: 'list';
  readonly sessions: readonly ListedSession[];
  readonly nextPageToken?: string;
  /** Journal rows whose session did not appear on this page — page-scoped, never "gone". */
  readonly journalOnly: ReadonlyArray<{
    readonly localId: string;
    readonly sessionResource?: string;
    readonly condition: string;
  }>;
}

export async function list(
  deps: RuntimeDeps,
  args: ListArgs
): Promise<ListResult> {
  prepare(deps);
  const deadline = deadlineIn(
    deps.clock,
    args.deadlineMs ?? DEFAULT_READ_DEADLINE_MS
  );
  const journal = await readJournal(deps.dataDir);
  const pageToken =
    args.pageToken !== undefined
      ? validatePageToken(args.pageToken, 'input')
      : undefined;

  const page = await withAdapter(deps, (adapter) =>
    read(deps, deadline, () =>
      adapter.listSessions({
        pageSize: args.limit ?? LIST_DEFAULT_LIMIT,
        ...(pageToken !== undefined ? { pageToken } : {}),
      })
    )
  );

  const onPage = new Set<string>();
  const sessions = page.sessions.map((s): ListedSession => {
    onPage.add(s.sessionResource);
    const tag = extractTitleTag(s.title);
    // The title tag is vendor-writable, so it is never trusted on its own:
    // a local id is shown only when the journal binds it to this session.
    const localId = findBySessionResource(journal, s.sessionResource)?.localId;
    return {
      ...(localId !== undefined ? { localId } : {}),
      sessionResource: s.sessionResource,
      vendorState: s.vendorState,
      condition: conditionOf(s.vendorState),
      title: tag.title,
      ...(s.createTime !== undefined ? { createTime: s.createTime } : {}),
    };
  });

  const journalOnly = Object.values(journal.operations)
    .filter(ownsSession)
    .filter(
      (r) => r.sessionResource === undefined || !onPage.has(r.sessionResource)
    )
    .map((r) => ({
      localId: r.localId,
      ...(r.sessionResource !== undefined
        ? { sessionResource: r.sessionResource }
        : {}),
      condition: r.condition ?? r.status,
    }));

  const nextPageToken =
    page.nextPageToken !== undefined
      ? validatePageToken(page.nextPageToken, 'response')
      : undefined;
  return {
    operation: 'list',
    sessions,
    ...(nextPageToken !== undefined ? { nextPageToken } : {}),
    journalOnly,
  };
}

export type RenderedOutput =
  | {
      readonly type: 'pullRequest';
      readonly prUrl?: string;
      readonly title: string;
      readonly external: true;
    }
  | {
      readonly type: 'changeSet';
      readonly baseCommit?: string;
      readonly patchBytes: number;
    };

function renderOutputs(session: AdapterSession): RenderedOutput[] {
  return session.outputs.map((output): RenderedOutput => {
    if (output.type === 'pullRequest') {
      const check =
        session.sourceResource !== undefined
          ? validatePullRequestUrl(output.url, session.sourceResource)
          : undefined;
      return {
        type: 'pullRequest',
        ...(check?.valid === true ? { prUrl: check.url } : {}),
        title: output.title,
        external: true,
      };
    }
    const baseCommit = optionalBaseCommit(output.baseCommitId);
    return {
      type: 'changeSet',
      ...(baseCommit !== undefined ? { baseCommit } : {}),
      patchBytes: Buffer.byteLength(output.unidiffPatch, 'utf8'),
    };
  });
}

function optionalBaseCommit(value: string): string | undefined {
  try {
    return validateBaseCommitId(value, 'response');
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

const TERMINAL_VENDOR_STATES = new Set(['completed', 'failed']);

export interface StatusArgs {
  readonly session?: string;
  readonly reconcile: boolean;
  readonly deadlineMs?: number;
  /**
   * Sees every activity the observation walk reads, in page order, with
   * whether it counted as new. `supervise` uses it to build the fenced activity
   * and question text; outside activity itself is recorded inside `status`
   * (R32). The CLI never sets it.
   */
  readonly observer?: (
    activity: AdapterActivity,
    info: { readonly isNew: boolean }
  ) => void;
}

export type { ReconciledEntry } from './types.js';

export interface StatusActivities {
  readonly processed: number;
  readonly new: number;
  readonly pages: number;
  readonly partialPagination: boolean;
  readonly dedupWindowExceeded: boolean;
  readonly unmappedActivity: boolean;
  /** Why a partial walk stopped. */
  readonly stopReason?: 'page-cap' | 'page-failure' | 'deadline' | 'unmapped';
  readonly resumePageToken?: string;
}

export interface StatusResult extends Attention {
  readonly operation: 'status';
  readonly localId?: string;
  readonly sessionResource?: string;
  readonly vendorState?: string;
  readonly condition?: string;
  readonly title?: string;
  readonly url?: string;
  readonly activities?: StatusActivities;
  readonly pendingPlan?: PendingPlan;
  readonly outputs?: readonly RenderedOutput[];
  readonly policyDeviation?: true;
  readonly reconciled?: readonly ReconciledEntry[];
}

function walkStartFor(
  record: OperationRecord,
  token: string | undefined
): WalkStart {
  const watermark =
    record.lastActivityCreateTime !== undefined &&
    record.lastActivityId !== undefined
      ? {
          kind: 'watermark' as const,
          createTime: record.lastActivityCreateTime,
          activityId: record.lastActivityId,
        }
      : undefined;
  if (token !== undefined) {
    return {
      kind: 'resume',
      pageToken: token,
      fallback: watermark ?? { kind: 'session-start' },
    };
  }
  return watermark ?? { kind: 'session-start' };
}

/**
 * R32: a user message none of this plugin sent is recorded the moment ANY walk
 * sees it, because `status` advances the watermark and the dedup ring and
 * `supervise` would otherwise never see the message as new. `supervise` pauses
 * on the record. Only sessions this plugin created have a digest set to compare
 * against.
 */
async function recordOutsideActivity(
  deps: RuntimeDeps,
  record: OperationRecord,
  messages: ReadonlyArray<{
    activityId: string;
    digest: string;
    createTime?: string;
  }>,
  walkComplete: boolean
): Promise<ReadonlySet<string>> {
  const pending: string[] = [];
  if (messages.length === 0 || record.kind !== 'create') return new Set();
  if (record.sessionResource === undefined) return new Set();
  await claimOwnEchoes(
    deps.dataDir,
    record.sessionResource,
    messages,
    {
      ownerRequestId: record.localRequestId,
      observedAt: nowFn(deps)().toISOString(),
    },
    pending,
    walkComplete
  );
  return new Set(pending);
}

export async function status(
  deps: RuntimeDeps,
  args: StatusArgs
): Promise<StatusResult> {
  if (args.session === undefined && !args.reconcile) {
    return throwAppError(
      'JULES_INVALID_INPUT',
      '--session is required unless --reconcile is given'
    );
  }
  prepare(deps);
  const deadline = deadlineIn(
    deps.clock,
    args.deadlineMs ?? DEFAULT_READ_DEADLINE_MS
  );
  let journal = await readJournal(deps.dataDir);
  const sessionResource =
    args.session !== undefined
      ? resolveSessionResource(journal, args.session)
      : undefined;
  const reconciled = args.reconcile
    ? await reconcile(deps, journal, sessionResource, deadline)
    : undefined;
  // A reconcile may have bound a reservation to its session; look it up fresh.
  if (reconciled !== undefined && reconciled.length > 0) {
    journal = await readJournal(deps.dataDir);
  }
  const reconcileFlags = (reconciled ?? [])
    .filter(
      (r) =>
        (r.outcome !== 'bound' && r.outcome !== 'released') ||
        r.slotStuck === true
    )
    .map((r) =>
      r.slotStuck === true ? 'reconciled:slotStuck' : `reconciled:${r.outcome}`
    );

  if (sessionResource === undefined) {
    return {
      operation: 'status',
      reconciled: reconciled ?? [],
      ...attentionOf(reconcileFlags),
    };
  }

  return withAdapter(deps, async (adapter) => {
    const session = await read(deps, deadline, () =>
      adapter.getSession(sessionResource)
    );
    let record = await boundRecord(deps, journal, sessionResource);

    const watermark =
      record.lastActivityCreateTime !== undefined &&
      record.lastActivityId !== undefined
        ? {
            createTime: record.lastActivityCreateTime,
            activityId: record.lastActivityId,
          }
        : undefined;
    const newUserMessages: Array<{
      activityId: string;
      digest: string;
      createTime?: string;
    }> = [];
    const walk = await walkActivities({
      adapter,
      sessionResource,
      pageSize: STATUS_PAGE_SIZE,
      start: walkStartFor(record, record.resumePageToken),
      clock: deps.clock,
      deadline,
      ring: record.recentActivityIds,
      ...(watermark !== undefined ? { watermark } : {}),
      ...(record.pendingPlan !== undefined
        ? { pendingPlan: record.pendingPlan }
        : {}),
      ...(record.resumeApproval !== undefined
        ? { approval: record.resumeApproval }
        : {}),
      onActivity: (activity, info) => {
        if (
          info.isNew &&
          activity.type === 'userMessaged' &&
          activity.message !== undefined
        ) {
          newUserMessages.push({
            activityId: activity.activityId,
            digest: messageDigest(activity.message),
            createTime: activity.createTime,
          });
        }
        args.observer?.(activity, info);
      },
    });

    // Restart guard: a stored token the vendor rejected, or one that yielded
    // nothing new, is discarded; the second consecutive such restart fails.
    // A resumed walk that read nothing (a transient failure on its first
    // page) says nothing about progress; only a walk that read pages counts.
    const noProgress =
      walk.startedFromResume &&
      !walk.resumeRejected &&
      walk.pages > 0 &&
      !walk.unmappedActivity &&
      walk.newIds.length === 0;
    const restarted =
      walk.startedFromResume && (walk.resumeRejected || noProgress);
    const restartCount = restarted
      ? record.resumeRestartCount + 1
      : walk.newIds.length > 0
        ? 0
        : record.resumeRestartCount;
    if (restarted && restartCount >= 2) {
      await upsertReadState(
        deps.dataDir,
        record.localRequestId,
        { resumePageToken: null, resumeRestartCount: restartCount },
        nowFn(deps)
      );
      return throwAppError(
        'JULES_NO_PROGRESS',
        `two consecutive activity walks for ${sessionResource} restarted without advancing`
      );
    }

    const { ring, dedupWindowExceeded } = nextRing(
      record.recentActivityIds,
      walk
    );
    const advance =
      walk.complete &&
      walk.newest !== undefined &&
      walk.newest.createTime !== '' &&
      (watermark === undefined || compareStamp(walk.newest, watermark) > 0);
    const resumePageToken =
      walk.complete || noProgress ? null : (walk.resumePageToken ?? null);
    const vendorState = session.vendorState;
    const condition = conditionOf(vendorState);

    // Record outside evidence BEFORE the watermark/dedup ring advances: a
    // failure between the two then leaves the message re-detectable on the
    // next walk instead of lost (the write gate also sees outsideSeen first).
    // Messages only an in-flight (dispatched, unsettled) reply could explain are
    // held back: neither the watermark nor the ring may pass them, so the next
    // walk classifies them once the write has settled.
    const held = await recordOutsideActivity(
      deps,
      record,
      newUserMessages,
      walk.complete
    );
    const heldBack = held.size > 0;
    record = await upsertReadState(
      deps.dataDir,
      record.localRequestId,
      {
        vendorState,
        condition,
        ...(advance && !heldBack && walk.newest !== undefined
          ? { watermark: walk.newest }
          : {}),
        resumePageToken: heldBack ? null : resumePageToken,
        // A partial walk keeps the newest approval it read so the resumed walk
        // can pair it with the older plan; otherwise it is dropped.
        resumeApproval:
          !heldBack &&
          resumePageToken !== null &&
          walk.latestApproval !== undefined
            ? walk.latestApproval
            : null,
        // A walk that holds a message back has not classified it: stamping it
        // complete would let clearPause forget an older pause over that message.
        ...(walk.complete && !heldBack
          ? { completeWalkAt: nowFn(deps)().toISOString() }
          : {}),
        recentActivityIds: ring.filter((id) => !held.has(id)),
        activityCountDelta: walk.newIds.filter((id) => !held.has(id)).length,
        // The walk ran unlocked: rebase against the journal record as it is
        // when the update lands, so an overlapping status is not double-counted.
        newActivityIds: walk.newIds.filter((id) => !held.has(id)),
        rebase: {
          ring: record.recentActivityIds,
          ...(record.pendingPlan !== undefined
            ? { pendingPlan: record.pendingPlan }
            : {}),
          ...(record.resumeApproval !== undefined
            ? { approval: record.resumeApproval }
            : {}),
        },
        ...(walk.pendingPlan !== record.pendingPlan
          ? {
              // Plan text is vendor-writable: redacted before it is persisted.
              pendingPlan:
                walk.pendingPlan == null ? null : redactDeep(walk.pendingPlan),
            }
          : {}),
        resumeRestartCount: restartCount,
      },
      nowFn(deps)
    );
    record = await checkPolicyDeviation(deps, record, session);
    const policyDeviation = hasUnreconciledDeviation(record);
    // A session observed in a terminal vendor state no longer holds its
    // grant's active-session slot (tasks and corrective rounds stay spent).
    // status is a read command: a failed release keeps the slot held, which
    // only makes the grant stricter, and is reported instead of thrown.
    let slotStuck = false;
    if (
      TERMINAL_VENDOR_STATES.has(vendorState) &&
      record.kind === 'create' &&
      record.grantId !== undefined
    ) {
      try {
        await releaseSlotInStore(
          deps.dataDir,
          record.grantId,
          record.localRequestId
        );
      } catch (err) {
        slotStuck = true;
        process.stderr.write(
          `warning: could not release the grant slot of ${record.localRequestId}: ${errorLabel(err)}\n`
        );
      }
    }

    const flags: string[] = [];
    if (slotStuck) flags.push('slotStuck');
    if (walk.partialPagination) flags.push('partialPagination');
    if (walk.unmappedActivity) flags.push('unmappedActivity');
    if (dedupWindowExceeded) flags.push('dedupWindowExceeded');
    if (policyDeviation) flags.push('policyDeviation');
    flags.push(...reconcileFlags);

    const tag = extractTitleTag(session.title);
    return {
      operation: 'status',
      localId: record.localId,
      sessionResource,
      vendorState,
      condition,
      title: tag.title,
      ...(session.url !== undefined ? { url: session.url } : {}),
      activities: {
        processed: walk.processed,
        new: walk.newIds.length,
        pages: walk.pages,
        partialPagination: walk.partialPagination,
        dedupWindowExceeded,
        unmappedActivity: walk.unmappedActivity,
        ...(walk.partialPagination && walk.stopReason !== undefined
          ? { stopReason: walk.stopReason }
          : {}),
        ...(record.resumePageToken !== undefined
          ? { resumePageToken: record.resumePageToken }
          : {}),
      },
      ...(record.pendingPlan !== undefined
        ? { pendingPlan: record.pendingPlan }
        : {}),
      outputs: renderOutputs(session),
      ...(policyDeviation ? { policyDeviation: true as const } : {}),
      ...(reconciled !== undefined ? { reconciled } : {}),
      ...attentionOf(flags),
    };
  });
}

// ---------------------------------------------------------------------------
// collect
// ---------------------------------------------------------------------------

export const AGGREGATE_ARTIFACT_CAP_BYTES = 100 * 1024 * 1024;

export interface CollectArgs {
  readonly session: string;
  readonly deadlineMs?: number;
}

export interface CollectedArtifact {
  readonly kind: 'patch' | 'pr-ref' | 'generated-file';
  readonly path?: string;
  readonly sha256?: string;
  readonly baseCommit?: string;
  readonly prUrl?: string;
  readonly vendorPath?: string;
  readonly secretShapedContent: boolean;
  readonly verification: 'unverified';
}

export interface SkippedArtifact {
  readonly kind: CollectedArtifact['kind'];
  readonly reason: 'aggregate-cap-reached';
  readonly bytes?: number;
}

export interface CollectResult extends Attention {
  readonly operation: 'collect';
  readonly localId: string;
  readonly sessionResource: string;
  readonly artifacts: readonly CollectedArtifact[];
  readonly skipped: readonly SkippedArtifact[];
  readonly activities: {
    readonly pages: number;
    readonly partialPagination: boolean;
    readonly unmappedActivity: boolean;
  };
  readonly partialStaging: boolean;
  readonly noSupportedArtifact: boolean;
  readonly policyDeviation?: true;
}

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/** Atomic 0600 write inside a directory ensureOwnerOnlyDir already vetted (no symlinks). */
function writeStaged(filePath: string, content: string): void {
  const tmp = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.writeFileSync(tmp, content, { mode: 0o600, flag: 'wx' });
  fs.renameSync(tmp, filePath);
}

const MANIFEST_MAX_BYTES = 10 * 1024 * 1024;
const STAGED_PATH_RE =
  /^(?:patch\.diff|patches\/\d{2,}-[0-9a-f]{12}\.diff|generated\/\d{2,}-[0-9a-f]{12})$/;

/** Manifest-relative paths are always POSIX-separated, whatever the platform. */
export function toManifestPath(
  rel: string,
  pathImpl: Pick<typeof path, 'sep'> = path
): string {
  return rel.split(pathImpl.sep).join('/');
}

/** Native filesystem path for a POSIX manifest-relative path. */
function stagedFsPath(dir: string, rel: string): string {
  return path.join(dir, ...rel.split('/'));
}

/**
 * Artifacts a previous `collect` recorded here, rebuilt from validated fields
 * only: a staged file must still exist with the recorded digest (its secret
 * scan is recomputed), `verification` is always `unverified`, and a PR
 * reference must pass the session-source check again. Anything else in the
 * manifest is ignored — it is never trusted as data.
 */
function readManifestArtifacts(
  dir: string,
  sourceResource: string | undefined
): CollectedArtifact[] {
  const file = path.join(dir, 'manifest.json');
  let parsed: unknown;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > MANIFEST_MAX_BYTES) return [];
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
  const list = (parsed as { artifacts?: unknown } | null)?.artifacts;
  if (!Array.isArray(list)) return [];
  const out: CollectedArtifact[] = [];
  for (const entry of list) {
    const a = (entry ?? {}) as Partial<
      Record<keyof CollectedArtifact, unknown>
    >;
    if (a.kind === 'pr-ref') {
      const check =
        sourceResource !== undefined
          ? validatePullRequestUrl(a.prUrl, sourceResource)
          : undefined;
      if (check?.valid === true) {
        out.push({
          kind: 'pr-ref',
          prUrl: check.url,
          secretShapedContent: false,
          verification: 'unverified',
        });
      }
      continue;
    }
    if (a.kind !== 'patch' && a.kind !== 'generated-file') continue;
    if (typeof a.path !== 'string') continue;
    // Tolerate manifests written with native (backslash) separators.
    const relPath = toManifestPath(a.path, path.win32);
    if (!STAGED_PATH_RE.test(relPath)) continue;
    if (typeof a.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(a.sha256))
      continue;
    let bytes: Buffer;
    try {
      const staged = stagedFsPath(dir, relPath);
      if (!fs.lstatSync(staged).isFile()) continue;
      bytes = fs.readFileSync(staged);
    } catch {
      continue;
    }
    // Staged content was hashed as its UTF-8 bytes, so the raw file hashes the same.
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== a.sha256)
      continue;
    const content = bytes.toString('utf8');
    const baseCommit =
      typeof a.baseCommit === 'string'
        ? optionalBaseCommit(a.baseCommit)
        : undefined;
    out.push({
      kind: a.kind,
      path: relPath,
      sha256: a.sha256,
      ...(a.kind === 'patch' && baseCommit !== undefined ? { baseCommit } : {}),
      ...(a.kind === 'generated-file' && typeof a.vendorPath === 'string'
        ? { vendorPath: redact(a.vendorPath) }
        : {}),
      secretShapedContent: scanSecretShapes(content),
      verification: 'unverified',
    });
  }
  return out;
}

/** Dedupe key for a staged generated file; `safeVendorPath` is already redacted. */
function generatedKey(digest: string, safeVendorPath: string): string {
  return `${digest}:${safeVendorPath}`;
}

function countFiles(dir: string): number {
  try {
    return fs.readdirSync(dir).filter((name) => !name.includes('.tmp-')).length;
  } catch {
    return 0;
  }
}

/**
 * Stages artifacts under `artifacts/<local-id>/`. Seeded from the previous
 * manifest and the files on disk, so a resumed `collect` continues the
 * numbering instead of overwriting `patch.diff` or an earlier file, and the
 * manifest accumulates rather than being replaced.
 */
class Stager {
  readonly artifacts: CollectedArtifact[] = [];
  readonly skipped: SkippedArtifact[] = [];
  private staged = 0;
  private readonly seenDigests = new Set<string>();
  private readonly seenGenerated = new Set<string>();
  private readonly seenPrs = new Set<string>();
  private patchSeq: number;
  private generatedSeq: number;

  constructor(
    private readonly dir: string,
    private readonly capBytes: number,
    sourceResource: string | undefined
  ) {
    for (const prior of readManifestArtifacts(dir, sourceResource)) {
      this.artifacts.push(prior);
      if (prior.kind === 'patch' && prior.sha256 !== undefined)
        this.seenDigests.add(prior.sha256);
      if (prior.kind === 'generated-file' && prior.sha256 !== undefined) {
        this.seenGenerated.add(
          generatedKey(prior.sha256, prior.vendorPath ?? '')
        );
      }
      if (prior.kind === 'pr-ref' && prior.prUrl !== undefined)
        this.seenPrs.add(prior.prUrl);
    }
    this.patchSeq =
      (fs.existsSync(path.join(dir, 'patch.diff')) ? 1 : 0) +
      countFiles(path.join(dir, 'patches'));
    this.generatedSeq = countFiles(path.join(dir, 'generated'));
  }

  get partialStaging(): boolean {
    return this.skipped.length > 0;
  }

  private overCap(bytes: number): boolean {
    return this.staged + bytes > this.capBytes;
  }

  /** Patches are staged byte-exact and scanned, never redacted (contract "Redaction" layer 8). */
  patch(unidiffPatch: string, baseCommitId: string): void {
    if (unidiffPatch === '') return;
    const digest = sha256(unidiffPatch);
    if (this.seenDigests.has(digest)) return;
    this.seenDigests.add(digest);
    const bytes = Buffer.byteLength(unidiffPatch, 'utf8');
    if (this.overCap(bytes)) {
      this.skipped.push({
        kind: 'patch',
        reason: 'aggregate-cap-reached',
        bytes,
      });
      return;
    }
    this.staged += bytes;
    this.patchSeq += 1;
    const rel =
      this.patchSeq === 1
        ? 'patch.diff'
        : path.posix.join(
            'patches',
            `${String(this.patchSeq).padStart(2, '0')}-${digest.slice(0, 12)}.diff`
          );
    if (this.patchSeq > 1) ensureOwnerOnlyDir(path.join(this.dir, 'patches'));
    writeStaged(stagedFsPath(this.dir, rel), unidiffPatch);
    const baseCommit = optionalBaseCommit(baseCommitId);
    this.artifacts.push({
      kind: 'patch',
      path: rel,
      sha256: digest,
      ...(baseCommit !== undefined ? { baseCommit } : {}),
      secretShapedContent: scanSecretShapes(unidiffPatch),
      verification: 'unverified',
    });
  }

  /** Named locally by sequence and digest; the vendor path is recorded as redacted data only. */
  generated(vendorPath: string, content: string): void {
    // Dedupe before the cap check, so a file an earlier run staged is never
    // reported as skipped (which would set partialStaging for nothing).
    const digest = sha256(content);
    const safeVendorPath = redact(vendorPath);
    const key = generatedKey(digest, safeVendorPath);
    if (this.seenGenerated.has(key)) return;
    this.seenGenerated.add(key);
    const bytes = Buffer.byteLength(content, 'utf8');
    if (this.overCap(bytes)) {
      this.skipped.push({
        kind: 'generated-file',
        reason: 'aggregate-cap-reached',
        bytes,
      });
      return;
    }
    this.staged += bytes;
    this.generatedSeq += 1;
    ensureOwnerOnlyDir(path.join(this.dir, 'generated'));
    const rel = path.posix.join(
      'generated',
      `${String(this.generatedSeq).padStart(2, '0')}-${digest.slice(0, 12)}`
    );
    writeStaged(stagedFsPath(this.dir, rel), content);
    this.artifacts.push({
      kind: 'generated-file',
      path: rel,
      sha256: digest,
      vendorPath: safeVendorPath,
      secretShapedContent: scanSecretShapes(content),
      verification: 'unverified',
    });
  }

  /** R42: an existing vendor PR is an external reference only, never adopted. */
  prRef(prUrl: string): void {
    if (this.seenPrs.has(prUrl)) return;
    this.seenPrs.add(prUrl);
    this.artifacts.push({
      kind: 'pr-ref',
      prUrl,
      secretShapedContent: false,
      verification: 'unverified',
    });
  }
}

/**
 * Bounded buffer for staging operations recorded during the unlocked vendor
 * walk and replayed under the journal lock. Bodies are retained only while the
 * running total stays within the aggregate cap (the same test `Stager` applies,
 * which also starts its total at zero for each collect); a body that would
 * exceed it is dropped and replayed as a cap-skip, so memory is bounded by the
 * cap and `skipped` / `partialStaging` stay correct. `Stager` remains the
 * authoritative enforcement under the lock.
 */
export class StagingBuffer {
  readonly pending: Array<(stager: Stager) => void> = [];
  private buffered = 0;
  private readonly seenPatches = new Set<string>();
  private readonly seenGenerated = new Set<string>();

  constructor(private readonly capBytes: number) {}

  /**
   * Marks artifacts an earlier collect already staged as seen, so they neither
   * count toward the per-run cap nor queue a replay (`Stager` would discard
   * them as duplicates). An optimisation hint from an unlocked read; `Stager`
   * re-reads the manifest under the lock.
   */
  seedStaged(prior: readonly CollectedArtifact[]): void {
    for (const a of prior) {
      if (a.sha256 === undefined) continue;
      if (a.kind === 'patch') this.seenPatches.add(a.sha256);
      else if (a.kind === 'generated-file')
        this.seenGenerated.add(generatedKey(a.sha256, a.vendorPath ?? ''));
    }
  }

  /** Bytes of artifact bodies currently retained. */
  get bufferedBytes(): number {
    return this.buffered;
  }

  patch(unidiffPatch: string, baseCommitId: string): void {
    if (unidiffPatch === '') return;
    const digest = sha256(unidiffPatch);
    if (this.seenPatches.has(digest)) return;
    this.seenPatches.add(digest);
    const bytes = Buffer.byteLength(unidiffPatch, 'utf8');
    if (this.buffered + bytes > this.capBytes) {
      this.pending.push((s) =>
        s.skipped.push({
          kind: 'patch',
          reason: 'aggregate-cap-reached',
          bytes,
        })
      );
      return;
    }
    this.buffered += bytes;
    this.pending.push((s) => s.patch(unidiffPatch, baseCommitId));
  }

  generated(vendorPath: string, content: string): void {
    const key = generatedKey(sha256(content), redact(vendorPath));
    if (this.seenGenerated.has(key)) return;
    this.seenGenerated.add(key);
    const bytes = Buffer.byteLength(content, 'utf8');
    if (this.buffered + bytes > this.capBytes) {
      this.pending.push((s) =>
        s.skipped.push({
          kind: 'generated-file',
          reason: 'aggregate-cap-reached',
          bytes,
        })
      );
      return;
    }
    this.buffered += bytes;
    this.pending.push((s) => s.generated(vendorPath, content));
  }

  prRef(prUrl: string): void {
    this.pending.push((s) => s.prRef(prUrl));
  }
}

export async function collect(
  deps: RuntimeDeps,
  args: CollectArgs
): Promise<CollectResult> {
  prepare(deps);
  const deadline = deadlineIn(
    deps.clock,
    args.deadlineMs ?? DEFAULT_COLLECT_DEADLINE_MS
  );
  const journal = await readJournal(deps.dataDir);
  const sessionResource = resolveSessionResource(journal, args.session);

  return withAdapter(deps, async (adapter) => {
    const session = await read(deps, deadline, () =>
      adapter.getSession(sessionResource)
    );
    let record = await boundRecord(deps, journal, sessionResource);
    record = await checkPolicyDeviation(deps, record, session);

    // Staging path derives from the local id only (R40); never from vendor data.
    const artifactsRoot = resolveArtifactsDir(deps.dataDir);
    ensureOwnerOnlyDir(artifactsRoot);
    const dir = path.join(artifactsRoot, record.localId);
    ensureOwnerOnlyDir(dir);
    // Vendor reads run unlocked; staging is buffered here and replayed inside
    // one critical section, so slot allocation never races another collect.
    const capBytes = deps.aggregateCapBytes ?? AGGREGATE_ARTIFACT_CAP_BYTES;
    const buffer = new StagingBuffer(capBytes);
    const priorArtifacts = readManifestArtifacts(dir, session.sourceResource);
    buffer.seedStaged(priorArtifacts);

    for (const output of session.outputs) {
      if (output.type === 'changeSet') {
        buffer.patch(output.unidiffPatch, output.baseCommitId);
      } else if (session.sourceResource !== undefined) {
        const check = validatePullRequestUrl(
          output.url,
          session.sourceResource
        );
        if (check.valid) {
          const url = check.url;
          buffer.prRef(url);
        }
      }
    }

    const token = record.artifactResumePageToken;
    const walk = await walkActivities({
      adapter,
      sessionResource,
      pageSize: COLLECT_PAGE_SIZE,
      start:
        token !== undefined
          ? {
              kind: 'resume',
              pageToken: token,
              fallback: { kind: 'session-start' },
            }
          : { kind: 'session-start' },
      clock: deps.clock,
      deadline,
      ring: record.recentActivityIds,
      onActivity: (activity: AdapterActivity) => {
        for (const artifact of activity.artifacts) {
          if (artifact.type === 'changeSet') {
            buffer.patch(artifact.unidiffPatch, artifact.baseCommitId);
          }
        }
      },
    });

    for (const file of session.generatedFiles) {
      if (file.changeType === 'deleted' || file.content === '') continue;
      buffer.generated(file.path, file.content);
    }

    const collectedAt = new Date(deps.clock.now()).toISOString();
    // Seed from the manifest, allocate slots, rename, and rewrite the manifest
    // as one critical section. The journal lock is not reentrant, so the
    // journal write (recordArtifacts) follows after release.
    const stager = await withJournalLock(deps.dataDir, async () => {
      const s = new Stager(dir, capBytes, session.sourceResource);
      for (const apply of buffer.pending) apply(s);
      writeStaged(
        path.join(dir, 'manifest.json'),
        `${JSON.stringify(
          {
            localId: record.localId,
            sessionResource,
            collectedAt,
            artifacts: s.artifacts,
            skipped: s.skipped,
            partialPagination: walk.partialPagination,
          },
          null,
          2
        )}\n`
      );
      return s;
    });

    const journalArtifacts: ArtifactRecord[] = stager.artifacts.map((a) => ({
      ...a,
      sessionResource,
      collectedAt,
    }));
    record = await recordArtifacts(
      deps.dataDir,
      record.localRequestId,
      journalArtifacts,
      nowFn(deps)
    );
    // Restart guard, as in `status`: a stored token the vendor rejected, or one
    // whose walk read pages, found nothing new, and handed back the same token,
    // is discarded so the next collect restarts from the session beginning; the
    // second consecutive such restart fails. Unmapped pages never count.
    // Progress is collect-owned: newly staged artifacts, not `status`'s activity
    // ring, which collect never writes (a repeated page would look new forever).
    const stagedNew = stager.artifacts.length > priorArtifacts.length;
    const noProgress =
      token !== undefined &&
      walk.startedFromResume &&
      !walk.resumeRejected &&
      walk.pages > 0 &&
      !walk.complete &&
      !walk.unmappedActivity &&
      !stagedNew &&
      walk.resumePageToken === token;
    const restarted =
      walk.startedFromResume && (walk.resumeRejected || noProgress);
    const restartCount = restarted
      ? (record.artifactResumeRestartCount ?? 0) + 1
      : stagedNew
        ? 0
        : (record.artifactResumeRestartCount ?? 0);
    const exhausted = restarted && restartCount >= 2;
    record = await upsertArtifactResumeToken(
      deps.dataDir,
      record.localRequestId,
      // A token the vendor rejected is never re-stored; a resumed walk that
      // failed before reading keeps it (the walk returns it as resumePageToken).
      walk.complete || noProgress || exhausted
        ? null
        : (walk.resumePageToken ?? null),
      nowFn(deps),
      undefined,
      restartCount
    );
    if (exhausted) {
      return throwAppError(
        'JULES_NO_PROGRESS',
        `two consecutive artifact walks for ${sessionResource} restarted without advancing`
      );
    }

    const partialStaging = stager.partialStaging;
    const policyDeviation = hasUnreconciledDeviation(record);
    const flags: string[] = [];
    if (walk.partialPagination) flags.push('partialPagination');
    if (walk.unmappedActivity) flags.push('unmappedActivity');
    if (partialStaging) flags.push('partialStaging');
    if (policyDeviation) flags.push('policyDeviation');

    return {
      operation: 'collect',
      localId: record.localId,
      sessionResource,
      artifacts: stager.artifacts,
      skipped: stager.skipped,
      activities: {
        pages: walk.pages,
        partialPagination: walk.partialPagination,
        unmappedActivity: walk.unmappedActivity,
      },
      partialStaging,
      noSupportedArtifact:
        stager.artifacts.length === 0 &&
        !walk.partialPagination &&
        !partialStaging,
      ...(policyDeviation ? { policyDeviation: true as const } : {}),
      ...attentionOf(flags),
    };
  });
}
