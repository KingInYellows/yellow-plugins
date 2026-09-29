/**
 * Provider-local journal at <dataDir>/state/journal.json (R35-R38).
 *
 * Diverges from yellow-cursor's state.ts on purpose:
 * - a corrupt or unparseable journal throws JULES_JOURNAL_CORRUPT and is
 *   never renamed, replaced, or treated as empty (R37);
 * - a lock whose holder is dead on this host, or older than `staleMs`, fails
 *   loud with JULES_STALE_LOCK and is never taken over (R38).
 *
 * Every write is read-modify-write under the lock, atomic (temp file, fsync,
 * rename), 0600, and passes assertNoSecretShapedValues first. Keyed by
 * localRequestId; maps are built with Object.create(null) so caller-supplied
 * keys cannot reach the prototype.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { compareStamp, DEDUP_RING_CAP } from './activity-walk.js';
import {
  assertOwnerOnlyFile,
  ensureOwnerOnlyDir,
  resolveJournalPath,
  resolveLockPath,
  resolveStateDir,
} from './config.js';
import { throwAppError } from './errors.js';
import { assertNoSecretShapedValues } from './redact.js';
import type {
  ArtifactRecord,
  DeviationRecord,
  Journal,
  OperationKind,
  OperationRecord,
  OperationStatus,
  PendingPlan,
} from './types.js';
import {
  isValidPageToken,
  mintLocalId,
  validateRequestId,
} from './validate.js';

export function digestText(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export function emptyJournal(): Journal {
  return {
    version: 1,
    archiveVisibilityConfirmed: false,
    operations: Object.create(null) as Record<string, OperationRecord>,
  };
}

const KINDS = new Set<OperationKind>([
  'create',
  'reply',
  'approve',
  'collect',
  'observe',
]);
const ORIGINS = new Set(['yellow', 'external']);
const STATUSES = new Set<OperationStatus>([
  'reserved',
  'accepted',
  'unknown-outcome',
  'reconciled',
  'rejected',
  'failed',
  'observed',
]);
/** Settled records drop their dedup ring and resume tokens (retention rule). */
export const TERMINAL_STATUSES = new Set<OperationStatus>([
  'reconciled',
  'rejected',
  'failed',
]);
/** R36: only these block a new create for the same repository and branch. */
export const UNRESOLVED_STATUSES = new Set<OperationStatus>([
  'reserved',
  'unknown-outcome',
]);

const OPTIONAL_STRING_FIELDS = [
  'sessionResource',
  'repository',
  'requestedBranch',
  'observedHead',
  'sourceResource',
  'taskRef',
  'grantId',
  'promptDigest',
  'observedPlanId',
  'vendorState',
  'condition',
  'lastActivityCreateTime',
  'lastActivityId',
  'resumePageToken',
  'artifactResumePageToken',
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isNonNegativeInt(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isValidRecord(key: string, value: unknown): value is OperationRecord {
  if (!isPlainObject(value)) return false;
  if (value['localRequestId'] !== key) return false;
  if (
    typeof value['localId'] !== 'string' ||
    !/^jl-[0-9a-f]{32}$/.test(value['localId'])
  ) {
    return false;
  }
  if (!KINDS.has(value['kind'] as OperationKind)) return false;
  if (!ORIGINS.has(value['origin'] as string)) return false;
  if (!STATUSES.has(value['status'] as OperationStatus)) return false;
  for (const field of OPTIONAL_STRING_FIELDS) {
    if (value[field] !== undefined && typeof value[field] !== 'string')
      return false;
  }
  // Stored tokens go back to the vendor as query parameters: re-checked on load.
  for (const field of ['resumePageToken', 'artifactResumePageToken'] as const) {
    if (value[field] !== undefined && !isValidPageToken(value[field]))
      return false;
  }
  if (
    value['autoPrRequested'] !== undefined &&
    typeof value['autoPrRequested'] !== 'boolean'
  ) {
    return false;
  }
  if (!isStringArray(value['recentActivityIds'])) return false;
  if (!isNonNegativeInt(value['activityCount'])) return false;
  if (!isNonNegativeInt(value['resumeRestartCount'])) return false;
  if (
    value['artifactResumeRestartCount'] !== undefined &&
    !isNonNegativeInt(value['artifactResumeRestartCount'])
  )
    return false;
  if (
    !Array.isArray(value['artifacts']) ||
    !value['artifacts'].every(isPlainObject)
  )
    return false;
  if (
    !Array.isArray(value['deviations']) ||
    !value['deviations'].every(isPlainObject)
  )
    return false;
  if (value['pendingPlan'] !== undefined) {
    const plan = value['pendingPlan'];
    if (!isPlainObject(plan)) return false;
    if (
      typeof plan['planId'] !== 'string' ||
      typeof plan['activityCreateTime'] !== 'string'
    ) {
      return false;
    }
    if (typeof plan['activityId'] !== 'string' || !Array.isArray(plan['steps']))
      return false;
  }
  return (
    typeof value['createdAt'] === 'string' &&
    typeof value['updatedAt'] === 'string'
  );
}

function parseJournal(raw: string): Journal | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isPlainObject(parsed)) return undefined;
  if (parsed['version'] !== 1) return undefined;
  if (typeof parsed['archiveVisibilityConfirmed'] !== 'boolean')
    return undefined;
  const ops = parsed['operations'];
  if (!isPlainObject(ops)) return undefined;
  const operations = Object.create(null) as Record<string, OperationRecord>;
  for (const [key, record] of Object.entries(ops)) {
    if (!isValidRecord(key, record)) return undefined;
    operations[key] = record;
  }
  return {
    version: 1,
    archiveVisibilityConfirmed: parsed['archiveVisibilityConfirmed'],
    operations,
  };
}

/**
 * Reads the journal. A missing file is an empty journal; anything that does
 * not parse into the expected shape throws JULES_JOURNAL_CORRUPT and leaves
 * the file byte-identical — read commands report it instead of degrading to
 * an empty id set (R37).
 */
export async function readJournal(dataDir: string): Promise<Journal> {
  ensureOwnerOnlyDir(resolveStateDir(dataDir));
  const journalPath = resolveJournalPath(dataDir);
  assertOwnerOnlyFile(journalPath);
  let raw: string;
  try {
    raw = await fs.promises.readFile(journalPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyJournal();
    throw err;
  }
  const journal = parseJournal(raw);
  if (journal === undefined) {
    return throwAppError(
      'JULES_JOURNAL_CORRUPT',
      `${journalPath} does not parse as a yellow-jules journal; it was left untouched`
    );
  }
  return journal;
}

/** Atomic whole-file rewrite. Callers must hold the journal lock. */
export async function writeJournal(
  dataDir: string,
  journal: Journal
): Promise<void> {
  for (const record of Object.values(journal.operations)) {
    assertNoSecretShapedValues(record);
  }
  const stateDir = resolveStateDir(dataDir);
  ensureOwnerOnlyDir(stateDir);
  const journalPath = resolveJournalPath(dataDir);
  assertOwnerOnlyFile(journalPath);
  const tmpPath = path.join(
    stateDir,
    `journal.json.tmp-${process.pid}-${crypto.randomUUID()}`
  );
  const data = `${JSON.stringify(journal, null, 2)}\n`;
  const handle = await fs.promises.open(tmpPath, 'wx', 0o600);
  try {
    await handle.writeFile(data, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.promises.chmod(tmpPath, 0o600);
    await fs.promises.rename(tmpPath, journalPath);
  } catch (err) {
    await fs.promises.unlink(tmpPath).catch(() => undefined);
    throw err;
  }
  await fs.promises.chmod(journalPath, 0o600);
}

// ---------------------------------------------------------------------------
// Lock
// ---------------------------------------------------------------------------

export interface LockConfig {
  /** A lock older than this is abandoned: fail loud, never take over. */
  readonly staleMs: number;
  /** Bounded wait for a live holder before giving up. */
  readonly timeoutMs: number;
  readonly pollMs: number;
}

export const DEFAULT_LOCK_CONFIG: LockConfig = {
  staleMs: 60_000,
  timeoutMs: 15_000,
  pollMs: 50,
};

interface LockOwner {
  readonly owner: string;
  readonly pid: number;
  readonly hostname: string;
  readonly startedAt: number;
}

function parseLockOwner(raw: string): LockOwner | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isPlainObject(value)) return undefined;
    const { owner, pid, hostname, startedAt } = value;
    if (typeof owner !== 'string' || typeof hostname !== 'string')
      return undefined;
    if (typeof pid !== 'number' || typeof startedAt !== 'number')
      return undefined;
    return { owner, pid, hostname, startedAt };
  } catch {
    return undefined;
  }
}

function processIsDead(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

function staleLock(lockPath: string, why: string): never {
  return throwAppError(
    'JULES_STALE_LOCK',
    `${lockPath}: ${why}; it was left in place`
  );
}

/**
 * `wx` (O_CREAT|O_EXCL) atomically fails if anything — including a symlink —
 * already occupies the path. The lock records owner token, pid, hostname,
 * and start time so a crashed holder can be recognized and reported.
 */
async function acquireLock(
  lockPath: string,
  config: LockConfig
): Promise<string> {
  const owner = crypto.randomUUID();
  const deadline = Date.now() + config.timeoutMs;
  const content: LockOwner = {
    owner,
    pid: process.pid,
    hostname: os.hostname(),
    startedAt: Date.now(),
  };

  for (;;) {
    try {
      const handle = await fs.promises.open(lockPath, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify(content));
      } catch (writeErr) {
        // Never leave an empty lock behind: the next process would read it as stale.
        await handle.close().catch(() => undefined);
        await fs.promises.unlink(lockPath).catch(() => undefined);
        throw writeErr;
      }
      await handle.close();
      return owner;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }

    let raw: string;
    let mtimeMs: number;
    try {
      const stat = await fs.promises.lstat(lockPath);
      if (!stat.isFile()) staleLock(lockPath, 'the lock is not a regular file');
      mtimeMs = stat.mtimeMs;
      raw = await fs.promises.readFile(lockPath, 'utf8');
    } catch (statErr) {
      if ((statErr as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw statErr;
    }

    const holder = parseLockOwner(raw);
    const startedAt = holder?.startedAt ?? mtimeMs;
    if (
      holder !== undefined &&
      holder.hostname === os.hostname() &&
      processIsDead(holder.pid)
    ) {
      staleLock(
        lockPath,
        `held by pid ${holder.pid}, which is no longer running`
      );
    }
    if (Date.now() - startedAt > config.staleMs) {
      staleLock(lockPath, `held since ${new Date(startedAt).toISOString()}`);
    }
    if (Date.now() > deadline) {
      return throwAppError(
        'JULES_STALE_LOCK',
        `${lockPath} is held by another yellow-jules process`,
        {
          retryable: true,
          recoveryAction:
            'Another yellow-jules process holds state/.lock; retry after it finishes. If no such process is running, inspect and remove the lock by hand.',
        }
      );
    }
    await new Promise((resolve) => setTimeout(resolve, config.pollMs));
  }
}

async function releaseLock(lockPath: string, owner: string): Promise<void> {
  try {
    const holder = parseLockOwner(await fs.promises.readFile(lockPath, 'utf8'));
    if (holder?.owner === owner) await fs.promises.unlink(lockPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

/** Serializes read-modify-write cycles on the journal across processes sharing the data dir. */
export async function withJournalLock<T>(
  dataDir: string,
  fn: () => Promise<T>,
  config: LockConfig = DEFAULT_LOCK_CONFIG
): Promise<T> {
  ensureOwnerOnlyDir(resolveStateDir(dataDir));
  const lockPath = resolveLockPath(dataDir);
  const owner = await acquireLock(lockPath, config);
  try {
    return await fn();
  } finally {
    await releaseLock(lockPath, owner);
  }
}

type MutableOperations = Record<string, OperationRecord>;

/** Read, mutate, and write the journal as one critical section; returns the mutator's value. */
export async function updateJournal<T>(
  dataDir: string,
  mutate: (operations: MutableOperations, journal: Journal) => T,
  config: LockConfig = DEFAULT_LOCK_CONFIG
): Promise<T> {
  return withJournalLock(
    dataDir,
    async () => {
      const journal = await readJournal(dataDir);
      const before = JSON.stringify(journal);
      const result = mutate(journal.operations, journal);
      // A mutation that changed nothing skips the fsync'd rewrite.
      if (JSON.stringify(journal) !== before)
        await writeJournal(dataDir, journal);
      return result;
    },
    config
  );
}

function requireRecord(
  operations: MutableOperations,
  localRequestId: string
): OperationRecord {
  const record = operations[localRequestId];
  if (record === undefined) {
    return throwAppError(
      'JULES_NOT_FOUND',
      `no journal record for ${localRequestId}`
    );
  }
  return record;
}

// ---------------------------------------------------------------------------
// Lookups (pure)
// ---------------------------------------------------------------------------

export function findBySessionResource(
  journal: Journal,
  sessionResource: string
): OperationRecord | undefined {
  return Object.values(journal.operations).find(
    (r) => r.sessionResource === sessionResource
  );
}

export function findByLocalId(
  journal: Journal,
  localId: string
): OperationRecord | undefined {
  return Object.values(journal.operations).find((r) => r.localId === localId);
}

export interface UnresolvedQuery {
  readonly repository: string;
  readonly requestedBranch: string;
  readonly taskRef?: string;
}

/** R36: `reserved` or `unknown-outcome` creates for the same repository and branch (and task ref when given). */
export function findUnresolvedOperations(
  journal: Journal,
  query: UnresolvedQuery
): OperationRecord[] {
  return Object.values(journal.operations).filter(
    (r) =>
      r.kind === 'create' &&
      UNRESOLVED_STATUSES.has(r.status) &&
      r.repository === query.repository &&
      r.requestedBranch === query.requestedBranch &&
      (query.taskRef === undefined || r.taskRef === query.taskRef)
  );
}

// ---------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------

function baseRecord(
  fields: Pick<
    OperationRecord,
    'localRequestId' | 'localId' | 'kind' | 'origin' | 'status'
  >,
  nowIso: string
): OperationRecord {
  return {
    ...fields,
    recentActivityIds: [],
    activityCount: 0,
    resumeRestartCount: 0,
    artifacts: [],
    deviations: [],
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export interface ReservationInput {
  readonly localRequestId: string;
  readonly localId?: string;
  readonly kind: Exclude<OperationKind, 'observe'>;
  readonly repository?: string;
  readonly requestedBranch?: string;
  readonly sourceResource?: string;
  readonly sessionResource?: string;
  readonly taskRef?: string;
  readonly grantId?: string;
  readonly autoPrRequested?: boolean;
  readonly promptDigest?: string;
  readonly observedPlanId?: string;
}

/**
 * Reservation-first write (R36): the unresolved-operation lookup and the
 * reservation are one critical section, so two concurrent creates for the
 * same repository and branch cannot both reserve.
 */
export async function reserveOperation(
  dataDir: string,
  input: ReservationInput,
  now: () => Date = () => new Date(),
  config: LockConfig = DEFAULT_LOCK_CONFIG
): Promise<OperationRecord> {
  validateRequestId(input.localRequestId);
  return updateJournal(
    dataDir,
    (operations, journal) => {
      if (operations[input.localRequestId] !== undefined) {
        return throwAppError(
          'JULES_DUPLICATE_LAUNCH',
          `request id ${input.localRequestId} is already recorded`,
          {
            recoveryAction:
              'Run status --reconcile; never reuse a request id for a new operation.',
          }
        );
      }
      if (input.kind === 'create') {
        if (
          input.repository === undefined ||
          input.requestedBranch === undefined
        ) {
          return throwAppError(
            'JULES_INVALID_INPUT',
            'a create reservation needs a repository and branch'
          );
        }
        const unresolved = findUnresolvedOperations(journal, {
          repository: input.repository,
          requestedBranch: input.requestedBranch,
          ...(input.taskRef !== undefined ? { taskRef: input.taskRef } : {}),
        });
        if (unresolved.length > 0) {
          return throwAppError(
            'JULES_DUPLICATE_LAUNCH',
            `unresolved operation ${unresolved[0]?.localRequestId ?? ''} exists for ${input.repository} ${input.requestedBranch}`
          );
        }
      }
      const { localId, ...rest } = input;
      const record: OperationRecord = {
        ...baseRecord(
          {
            localRequestId: input.localRequestId,
            localId: localId ?? mintLocalId(),
            kind: input.kind,
            origin: 'yellow',
            status: 'reserved',
          },
          now().toISOString()
        ),
        ...rest,
      };
      operations[input.localRequestId] = record;
      return record;
    },
    config
  );
}

/** Retention: once terminal, the dedup ring and both resume tokens are dropped. */
function applyRetention(record: OperationRecord): OperationRecord {
  if (!TERMINAL_STATUSES.has(record.status)) return record;
  const { resumePageToken: _r, artifactResumePageToken: _a, ...rest } = record;
  return { ...rest, recentActivityIds: [] };
}

export async function markOperation(
  dataDir: string,
  localRequestId: string,
  status: OperationStatus,
  extra: Partial<
    Pick<OperationRecord, 'sessionResource' | 'vendorState' | 'condition'>
  > = {},
  now: () => Date = () => new Date(),
  config: LockConfig = DEFAULT_LOCK_CONFIG
): Promise<OperationRecord> {
  return updateJournal(
    dataDir,
    (operations) => {
      const next = applyRetention({
        ...requireRecord(operations, localRequestId),
        ...extra,
        status,
        updatedAt: now().toISOString(),
      });
      operations[localRequestId] = next;
      return next;
    },
    config
  );
}

/**
 * First sight of a session with no journal row (PR2: every observable
 * session was created outside yellow): mint a local id and record it with
 * `origin: "external"`. Returns the existing record when one is bound.
 */
export async function ensureObservedRecord(
  dataDir: string,
  sessionResource: string,
  now: () => Date = () => new Date(),
  config: LockConfig = DEFAULT_LOCK_CONFIG
): Promise<OperationRecord> {
  return updateJournal(
    dataDir,
    (operations, journal) => {
      const existing = findBySessionResource(journal, sessionResource);
      if (existing !== undefined) return existing;
      const localId = mintLocalId();
      const record: OperationRecord = {
        ...baseRecord(
          {
            localRequestId: `observe:${localId}`,
            localId,
            kind: 'observe',
            origin: 'external',
            status: 'observed',
          },
          now().toISOString()
        ),
        sessionResource,
      };
      operations[record.localRequestId] = record;
      return record;
    },
    config
  );
}

export interface ReadStateUpdate {
  readonly vendorState?: string;
  readonly condition?: string;
  /** Present only after a complete walk; a partial walk never advances the watermark. */
  readonly watermark?: {
    readonly createTime: string;
    readonly activityId: string;
  };
  /** `null` clears a stored token; `undefined` leaves it unchanged. */
  readonly resumePageToken?: string | null;
  readonly recentActivityIds?: readonly string[];
  readonly activityCountDelta?: number;
  /** `null` clears the pending plan (a `planApproved` was seen). */
  readonly pendingPlan?: PendingPlan | null;
  readonly resumeRestartCount?: number;
  /**
   * The ids the walk counted as new. When given with `rebase`, the count added
   * is recomputed under the lock as the ids not already in the fresh record's
   * ring, so an overlapping status update does not count them twice
   * (`activityCountDelta` is then ignored).
   */
  readonly newActivityIds?: readonly string[];
  /**
   * The pre-walk snapshot this update was computed from. Given, the update is
   * rebased against the fresh journal record: the watermark never moves
   * backwards, ids a concurrent writer added to the ring are kept, and a
   * pending plan never regresses to an older one.
   */
  readonly rebase?: {
    readonly ring: readonly string[];
    readonly pendingPlan?: PendingPlan;
  };
}

/**
 * Activity read-state. Only the `status` path calls this (contract
 * "Activity walk": status is the sole writer of the watermark, resume token,
 * and dedup ring; approve and collect walks only read them).
 */
export async function upsertReadState(
  dataDir: string,
  localRequestId: string,
  update: ReadStateUpdate,
  now: () => Date = () => new Date(),
  config: LockConfig = DEFAULT_LOCK_CONFIG
): Promise<OperationRecord> {
  return updateJournal(
    dataDir,
    (operations) => {
      const current = requireRecord(operations, localRequestId);
      const {
        resumePageToken: _drop,
        pendingPlan: _dropPlan,
        ...base
      } = current;
      const resumePageToken =
        update.resumePageToken === undefined
          ? current.resumePageToken
          : (update.resumePageToken ?? undefined);
      const rebase = update.rebase;
      let pendingPlan =
        update.pendingPlan === undefined
          ? current.pendingPlan
          : (update.pendingPlan ?? undefined);
      let watermark = update.watermark;
      let recentActivityIds =
        update.recentActivityIds ?? current.recentActivityIds;
      let activityCountDelta = update.activityCountDelta ?? 0;
      if (rebase !== undefined) {
        const fresh = current.pendingPlan;
        if (update.pendingPlan === undefined) {
          pendingPlan = fresh;
        } else if (update.pendingPlan === null) {
          // Approval seen against the snapshot's plan: it must not clear a
          // different (newer) plan a concurrent update stored since.
          pendingPlan =
            fresh === undefined ||
            fresh.activityId === rebase.pendingPlan?.activityId
              ? undefined
              : fresh;
        } else if (fresh !== undefined) {
          const newer =
            compareStamp(
              {
                createTime: update.pendingPlan.activityCreateTime,
                activityId: update.pendingPlan.activityId,
              },
              {
                createTime: fresh.activityCreateTime,
                activityId: fresh.activityId,
              }
            ) > 0;
          pendingPlan = newer ? update.pendingPlan : fresh;
        } else if (
          current.lastActivityCreateTime !== undefined &&
          current.lastActivityId !== undefined &&
          compareStamp(
            {
              createTime: update.pendingPlan.activityCreateTime,
              activityId: update.pendingPlan.activityId,
            },
            {
              createTime: current.lastActivityCreateTime,
              activityId: current.lastActivityId,
            }
          ) <= 0
        ) {
          // No plan is stored, and a concurrent walk already advanced past
          // this one: it saw the plan and its approval, so do not resurrect it.
          pendingPlan = undefined;
        }
        if (
          watermark !== undefined &&
          current.lastActivityCreateTime !== undefined &&
          current.lastActivityId !== undefined &&
          compareStamp(watermark, {
            createTime: current.lastActivityCreateTime,
            activityId: current.lastActivityId,
          }) <= 0
        ) {
          watermark = undefined;
        }
        if (update.recentActivityIds !== undefined) {
          const base = new Set(rebase.ring);
          const merged = new Set(update.recentActivityIds);
          const concurrent = current.recentActivityIds.filter(
            (id) => !base.has(id) && !merged.has(id)
          );
          recentActivityIds = [...concurrent, ...merged].slice(-DEDUP_RING_CAP);
        }
        if (update.newActivityIds !== undefined) {
          const known = new Set(current.recentActivityIds);
          activityCountDelta = update.newActivityIds.filter(
            (id) => !known.has(id)
          ).length;
        }
      }
      const next: OperationRecord = applyRetention({
        ...base,
        ...(update.vendorState !== undefined
          ? { vendorState: update.vendorState }
          : {}),
        ...(update.condition !== undefined
          ? { condition: update.condition }
          : {}),
        ...(watermark !== undefined
          ? {
              lastActivityCreateTime: watermark.createTime,
              lastActivityId: watermark.activityId,
            }
          : {}),
        ...(resumePageToken !== undefined ? { resumePageToken } : {}),
        ...(pendingPlan !== undefined ? { pendingPlan } : {}),
        recentActivityIds,
        activityCount: current.activityCount + activityCountDelta,
        resumeRestartCount:
          update.resumeRestartCount ?? current.resumeRestartCount,
        updatedAt: now().toISOString(),
      });
      operations[localRequestId] = next;
      return next;
    },
    config
  );
}

/**
 * The read-state fields `collect` owns. `null` clears the token; `restartCount`
 * (when given) replaces the artifact restart guard counter.
 */
export async function upsertArtifactResumeToken(
  dataDir: string,
  localRequestId: string,
  token: string | null,
  now: () => Date = () => new Date(),
  config: LockConfig = DEFAULT_LOCK_CONFIG,
  restartCount?: number
): Promise<OperationRecord> {
  return updateJournal(
    dataDir,
    (operations) => {
      const current = requireRecord(operations, localRequestId);
      if (
        (current.artifactResumePageToken ?? null) === token &&
        (restartCount === undefined ||
          (current.artifactResumeRestartCount ?? 0) === restartCount)
      )
        return current;
      const { artifactResumePageToken: _drop, ...rest } = current;
      const next = applyRetention({
        ...rest,
        ...(token !== null ? { artifactResumePageToken: token } : {}),
        ...(restartCount !== undefined
          ? { artifactResumeRestartCount: restartCount }
          : {}),
        updatedAt: now().toISOString(),
      });
      operations[localRequestId] = next;
      return next;
    },
    config
  );
}

/** Content identity: the same bytes (or the same PR) are one artifact wherever they were staged. */
function artifactKey(a: ArtifactRecord): string {
  return a.kind === 'pr-ref'
    ? `pr-ref:${a.prUrl ?? ''}`
    : `${a.kind}:${a.sha256 ?? ''}:${a.vendorPath ?? ''}`;
}

/**
 * Artifact provenance with digests (R35), written only by `collect`. An
 * artifact already recorded keeps its `verification` value — only the R43
 * verification step (PR4) may change it.
 */
export async function recordArtifacts(
  dataDir: string,
  localRequestId: string,
  artifacts: readonly ArtifactRecord[],
  now: () => Date = () => new Date(),
  config: LockConfig = DEFAULT_LOCK_CONFIG
): Promise<OperationRecord> {
  return updateJournal(
    dataDir,
    (operations) => {
      const current = requireRecord(operations, localRequestId);
      const known = new Set(current.artifacts.map(artifactKey));
      const added = artifacts.filter((a) => !known.has(artifactKey(a)));
      if (added.length === 0) return current;
      const next: OperationRecord = {
        ...current,
        artifacts: [...current.artifacts, ...added],
        updatedAt: now().toISOString(),
      };
      operations[localRequestId] = next;
      return next;
    },
    config
  );
}

/** R13: record a policy deviation once per distinct reason + PR reference. */
export async function recordDeviation(
  dataDir: string,
  localRequestId: string,
  deviation: Omit<DeviationRecord, 'observedAt' | 'reconciled'>,
  now: () => Date = () => new Date(),
  config: LockConfig = DEFAULT_LOCK_CONFIG
): Promise<OperationRecord> {
  return updateJournal(
    dataDir,
    (operations) => {
      const current = requireRecord(operations, localRequestId);
      const duplicate = current.deviations.some(
        (d) => d.reason === deviation.reason && d.prUrl === deviation.prUrl
      );
      if (duplicate) return current;
      const nowIso = now().toISOString();
      const next: OperationRecord = {
        ...current,
        deviations: [
          ...current.deviations,
          { ...deviation, observedAt: nowIso, reconciled: false },
        ],
        updatedAt: nowIso,
      };
      operations[localRequestId] = next;
      return next;
    },
    config
  );
}

export function hasUnreconciledDeviation(record: OperationRecord): boolean {
  return record.deviations.some((d) => !d.reconciled);
}
