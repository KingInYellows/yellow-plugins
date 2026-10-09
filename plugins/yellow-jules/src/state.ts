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

import {
  compareStamp,
  DEDUP_RING_CAP,
  DISPATCH_SKEW_MS,
  RESERVATION_SETTLE_MS,
} from './activity-walk.js';
import {
  assertOwnerOnlyFile,
  ensureOwnerOnlyDir,
  resolveJournalPath,
  resolveLockPath,
  resolveStateDir,
} from './config.js';
import { throwAppError } from './errors.js';
import { assertNoSecretShapedValues } from './redact.js';
import { isNonNegativeInt, isPlainObject, isStringArray } from './shape.js';
import type {
  ArtifactRecord,
  DeviationRecord,
  Journal,
  OperationKind,
  OperationRecord,
  OperationStatus,
  PendingPlan,
  SupervisionState,
} from './types.js';
import {
  isValidPageToken,
  mintLocalId,
  validateRequestId,
} from './validate.js';

export function digestText(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Digest of a plan under review: sha256 of the compact JSON
 * `[planId, [[title, description], ...]]` plus the newline `jq -c` prints. The commands compute the same value
 * with `jq -c` over `status` output, so DEL is escaped the way jq escapes it.
 */
export function planDigest(
  planId: string,
  steps: ReadonlyArray<{
    readonly title: string;
    readonly description?: string;
  }>
): string {
  const json = JSON.stringify([
    planId,
    steps.map((step) => [step.title, step.description ?? null]),
  ]).replace(/\u007f/g, '\\u007f');
  return digestText(`${json}\n`);
}

/** Digest of a message for reply matching: the vendor may trim edge whitespace, so both sides are trimmed. */
export function messageDigest(text: string): string {
  return digestText(text.trim());
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
  'echoActivityId',
  'observedPlanId',
  'vendorState',
  'condition',
  'lastActivityCreateTime',
  'lastActivityId',
  'lastCompleteWalkAt',
  'resumePageToken',
  'artifactResumePageToken',
  'abandonedAt',
  'abandonReason',
  'invalidatedBy',
  'dispatchedAt',
] as const;

const ARTIFACT_KINDS = new Set(['patch', 'pr-ref', 'generated-file']);
const ARTIFACT_VERIFICATIONS = new Set([
  'unverified',
  'passed',
  'failed',
  'unavailable',
  'errored',
]);

/** Absent is fine; present must be a string. */
function hasOptionalStrings(
  value: Record<string, unknown>,
  fields: readonly string[]
): boolean {
  return fields.every(
    (f) => value[f] === undefined || typeof value[f] === 'string'
  );
}

function isValidArtifact(value: unknown): value is ArtifactRecord {
  if (!isPlainObject(value)) return false;
  return (
    ARTIFACT_KINDS.has(value['kind'] as string) &&
    typeof value['sessionResource'] === 'string' &&
    hasOptionalStrings(value, [
      'path',
      'sha256',
      'baseCommit',
      'prUrl',
      'vendorPath',
    ]) &&
    typeof value['secretShapedContent'] === 'boolean' &&
    typeof value['collectedAt'] === 'string' &&
    ARTIFACT_VERIFICATIONS.has(value['verification'] as string)
  );
}

function isValidDeviation(value: unknown): value is DeviationRecord {
  if (!isPlainObject(value)) return false;
  return (
    value['kind'] === 'policy-deviation' &&
    typeof value['reason'] === 'string' &&
    hasOptionalStrings(value, ['prUrl']) &&
    typeof value['observedAt'] === 'string' &&
    typeof value['reconciled'] === 'boolean'
  );
}

function isValidPlanStep(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return (
    typeof value['id'] === 'string' &&
    typeof value['title'] === 'string' &&
    hasOptionalStrings(value, ['description']) &&
    isNonNegativeInt(value['index'])
  );
}

function isValidPendingPlan(value: unknown): value is PendingPlan {
  if (!isPlainObject(value)) return false;
  return (
    typeof value['planId'] === 'string' &&
    typeof value['activityCreateTime'] === 'string' &&
    typeof value['activityId'] === 'string' &&
    Array.isArray(value['steps']) &&
    value['steps'].every(isValidPlanStep)
  );
}

const RECONCILE_OUTCOMES = new Set([
  'bound',
  'released',
  'ambiguous-reconcile',
  'policy-deviation',
  'unknown-outcome',
  'not-reached',
]);
const DECISIONS = new Set([
  'no-change',
  'check-failed',
  'pass-aborted',
  'needs-plan-review',
  'needs-answer',
  'needs-verification',
  'escalate',
  'paused',
]);

function isValidLastReconcile(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return (
    RECONCILE_OUTCOMES.has(value['outcome'] as string) &&
    hasOptionalStrings(value, ['reason']) &&
    typeof value['observedAt'] === 'string'
  );
}

function isValidSupervision(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  const { paused, backoff, lastDecision } = value;
  if (
    paused !== undefined &&
    !(
      isPlainObject(paused) &&
      typeof paused['reason'] === 'string' &&
      typeof paused['observedAt'] === 'string' &&
      hasOptionalStrings(paused, ['activityId'])
    )
  )
    return false;
  if (
    backoff !== undefined &&
    !(
      isPlainObject(backoff) &&
      isNonNegativeInt(backoff['failures']) &&
      typeof backoff['nextCheckAt'] === 'string'
    )
  )
    return false;
  const outsideSeen = value['outsideSeen'];
  if (
    outsideSeen !== undefined &&
    !(
      isPlainObject(outsideSeen) &&
      typeof outsideSeen['activityId'] === 'string' &&
      typeof outsideSeen['observedAt'] === 'string' &&
      hasOptionalStrings(outsideSeen, ['createTime'])
    )
  )
    return false;
  const heldActivities = value['heldActivities'];
  if (
    heldActivities !== undefined &&
    !(
      isPlainObject(heldActivities) &&
      Object.values(heldActivities).every((v) => typeof v === 'string')
    )
  )
    return false;
  const evaluatedPlan = value['evaluatedPlan'];
  if (
    evaluatedPlan !== undefined &&
    !(
      isPlainObject(evaluatedPlan) &&
      typeof evaluatedPlan['planId'] === 'string' &&
      typeof evaluatedPlan['evaluatedAt'] === 'string'
    )
  )
    return false;
  return (
    lastDecision === undefined ||
    (isPlainObject(lastDecision) &&
      DECISIONS.has(lastDecision['decision'] as string) &&
      typeof lastDecision['decidedAt'] === 'string')
  );
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
  for (const field of ['autoPrRequested', 'correction'] as const) {
    if (value[field] !== undefined && typeof value[field] !== 'boolean') {
      return false;
    }
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
    !value['artifacts'].every(isValidArtifact)
  )
    return false;
  if (
    !Array.isArray(value['deviations']) ||
    !value['deviations'].every(isValidDeviation)
  )
    return false;
  if (
    value['pendingPlan'] !== undefined &&
    !isValidPendingPlan(value['pendingPlan'])
  )
    return false;
  if (
    value['resumeApproval'] !== undefined &&
    !(
      isPlainObject(value['resumeApproval']) &&
      typeof value['resumeApproval']['createTime'] === 'string' &&
      typeof value['resumeApproval']['activityId'] === 'string'
    )
  )
    return false;
  if (
    value['lastReconcile'] !== undefined &&
    !isValidLastReconcile(value['lastReconcile'])
  )
    return false;
  if (
    value['supervision'] !== undefined &&
    !isValidSupervision(value['supervision'])
  )
    return false;
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
  journal: Journal,
  /** Keys of the records that changed; when given, only those are secret-scanned. */
  changedKeys?: readonly string[]
): Promise<void> {
  const toScan =
    changedKeys === undefined
      ? Object.values(journal.operations)
      : changedKeys.flatMap((key) => {
          const record = journal.operations[key];
          return record === undefined ? [] : [record];
        });
  for (const record of toScan) {
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

  for (;;) {
    try {
      const handle = await fs.promises.open(lockPath, 'wx', 0o600);
      // Stamped when the lock is actually taken, not when waiting began: a
      // process that waited 14 s must not look 14 s older than it is.
      const content: LockOwner = {
        owner,
        pid: process.pid,
        hostname: os.hostname(),
        startedAt: Date.now(),
      };
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
      // Change detection by reference, not by serializing the whole journal
      // twice: every record type is readonly and every mutator replaces a record
      // by assignment, so an untouched record keeps its identity.
      const before = new Map(Object.entries(journal.operations));
      const confirmed = journal.archiveVisibilityConfirmed;
      const result = mutate(journal.operations, journal);
      const changed = Object.entries(journal.operations)
        .filter(([key, record]) => before.get(key) !== record)
        .map(([key]) => key);
      const expectedCount =
        before.size + changed.filter((k) => !before.has(k)).length;
      const unchanged =
        changed.length === 0 &&
        expectedCount === Object.keys(journal.operations).length &&
        confirmed === journal.archiveVisibilityConfirmed;
      // A mutation that changed nothing skips the fsync'd rewrite; a write only
      // secret-scans the records it changed (the rest passed when written).
      if (!unchanged) await writeJournal(dataDir, journal, changed);
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

/** Kinds that own a session's read-state; a `reply` or `approve` row only points at the session. */
export function ownsSession(record: OperationRecord): boolean {
  return record.kind !== 'reply' && record.kind !== 'approve';
}

/** The create (or first-seen) record that owns the session; reply and approve rows never match. */
export function findBySessionResource(
  journal: Journal,
  sessionResource: string
): OperationRecord | undefined {
  return Object.values(journal.operations).find(
    (r) => ownsSession(r) && r.sessionResource === sessionResource
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
  readonly correction?: boolean;
  readonly promptDigest?: string;
  readonly observedPlanId?: string;
}

/**
 * The pure core of the reservation (R36): refuses a recorded request id and,
 * for a create, any unresolved operation on the same repository and branch,
 * then adds the `reserved` record. Callers hold the journal lock;
 * `reserveOperation` wraps it for the one-file case and `write-gate.ts` runs it
 * inside the larger authority critical section (R31).
 */
export function applyReservation(
  operations: Record<string, OperationRecord>,
  journal: Journal,
  input: ReservationInput,
  now: () => Date = () => new Date()
): OperationRecord {
  validateRequestId(input.localRequestId);
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
    if (input.repository === undefined || input.requestedBranch === undefined) {
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
    (operations, journal) => applyReservation(operations, journal, input, now),
    config
  );
}

/** Retention: once terminal, the dedup ring and both resume tokens are dropped. */
export function applyRetention(record: OperationRecord): OperationRecord {
  if (!TERMINAL_STATUSES.has(record.status)) return record;
  const {
    resumePageToken: _r,
    artifactResumePageToken: _a,
    resumeApproval: _p,
    ...rest
  } = record;
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
 * First sight of a session with no journal row (it was created outside
 * yellow, or by another copy of this data): mint a local id and record it with
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
  /** `null` clears the carried approval; `undefined` leaves it unchanged. */
  readonly resumeApproval?: {
    readonly createTime: string;
    readonly activityId: string;
  } | null;
  readonly recentActivityIds?: readonly string[];
  readonly activityCountDelta?: number;
  /** Present only after a COMPLETE walk. */
  readonly completeWalkAt?: string;
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
    readonly approval?: {
      readonly createTime: string;
      readonly activityId: string;
    };
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
        resumeApproval: _dropApproval,
        ...base
      } = current;
      const resumePageToken =
        update.resumePageToken === undefined
          ? current.resumePageToken
          : (update.resumePageToken ?? undefined);
      let resumeApproval =
        update.resumeApproval === undefined
          ? current.resumeApproval
          : (update.resumeApproval ?? undefined);
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
        // A stored approval has no reader without a resume token: it is
        // dropped with the token. Otherwise keep the newest stamp, so an older
        // walk cannot clear (or replace) a newer approval a concurrent status
        // stored since the snapshot.
        const freshApproval = current.resumeApproval;
        if (resumePageToken === undefined) {
          resumeApproval = undefined;
        } else if (update.resumeApproval === null) {
          resumeApproval =
            freshApproval !== undefined &&
            (rebase.approval === undefined ||
              compareStamp(freshApproval, rebase.approval) > 0)
              ? freshApproval
              : undefined;
        } else if (
          update.resumeApproval !== undefined &&
          freshApproval !== undefined &&
          compareStamp(update.resumeApproval, freshApproval) <= 0
        ) {
          resumeApproval = freshApproval;
        }
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
      // A status walk runs unlocked, so an older observation can land after a
      // newer one. A finished session does not run again (reply refuses it), so
      // a terminal condition already stored is never regressed by a walk that
      // read the session earlier: the write gate's terminal-owner check and the
      // released slot both rely on it.
      const keepTerminal =
        rebase !== undefined &&
        (current.condition === 'remote-completed' ||
          current.condition === 'failed') &&
        update.condition !== current.condition;
      const next: OperationRecord = applyRetention({
        ...base,
        ...(update.vendorState !== undefined && !keepTerminal
          ? { vendorState: update.vendorState }
          : {}),
        ...(update.condition !== undefined && !keepTerminal
          ? { condition: update.condition }
          : {}),
        ...(watermark !== undefined
          ? {
              lastActivityCreateTime: watermark.createTime,
              lastActivityId: watermark.activityId,
            }
          : {}),
        // Forward only: a delayed older walk must not pull the stamp back.
        ...(update.completeWalkAt !== undefined &&
        (current.lastCompleteWalkAt === undefined ||
          update.completeWalkAt > current.lastCompleteWalkAt)
          ? { lastCompleteWalkAt: update.completeWalkAt }
          : {}),
        ...(resumePageToken !== undefined ? { resumePageToken } : {}),
        ...(resumeApproval !== undefined ? { resumeApproval } : {}),
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

export interface SupervisionPatch {
  /** Pauses are removed by `supervise --clear-pause` directly, not through this patch. */
  readonly paused?: NonNullable<SupervisionState['paused']> | null;
  /** `null` resets the check-failed backoff. */
  readonly backoff?: NonNullable<SupervisionState['backoff']> | null;
  readonly lastDecision?: NonNullable<SupervisionState['lastDecision']>;
  /** Written by `status`; removed with the pause by `--clear-pause`. */
  readonly outsideSeen?: NonNullable<SupervisionState['outsideSeen']> | null;
  /** `null` forgets the evaluated plan. */
  readonly evaluatedPlan?: NonNullable<
    SupervisionState['evaluatedPlan']
  > | null;
}

/** `undefined` keeps the stored value, `null` clears it, anything else sets it. */
function keep<K extends string, V>(
  key: K,
  previous: V | undefined,
  patch: V | null | undefined
): { [P in K]?: V } {
  const value = patch === undefined ? previous : (patch ?? undefined);
  return value === undefined ? {} : ({ [key]: value } as { [P in K]?: V });
}

/** Merges a patch into the session's supervision state; written by `supervise` and, for `outsideSeen`, by `status` (R32, R33). */
export async function updateSupervision(
  dataDir: string,
  localRequestId: string,
  patch: SupervisionPatch,
  now: () => Date = () => new Date(),
  config: LockConfig = DEFAULT_LOCK_CONFIG
): Promise<OperationRecord> {
  return updateJournal(
    dataDir,
    (operations) => {
      const current = requireRecord(operations, localRequestId);
      const previous: SupervisionState = current.supervision ?? {};
      // `undefined` keeps the stored value, `null` clears it, anything else sets it.
      // A pass runs unlocked, so a delayed one can land after a newer one:
      // markers replace the stored value only with a strictly later one.
      const pausedPatch =
        patch.paused != null &&
        previous.paused !== undefined &&
        patch.paused.observedAt < previous.paused.observedAt
          ? undefined
          : patch.paused;
      const decisionPatch =
        patch.lastDecision !== undefined &&
        previous.lastDecision !== undefined &&
        patch.lastDecision.decidedAt < previous.lastDecision.decidedAt
          ? undefined
          : patch.lastDecision;
      const outsidePatch =
        patch.outsideSeen != null &&
        previous.outsideSeen !== undefined &&
        compareStamp(
          {
            createTime: patch.outsideSeen.createTime ?? '',
            activityId: patch.outsideSeen.activityId,
          },
          {
            createTime: previous.outsideSeen.createTime ?? '',
            activityId: previous.outsideSeen.activityId,
          }
        ) <= 0
          ? undefined
          : patch.outsideSeen;
      const next: SupervisionState = {
        ...keep('paused', previous.paused, pausedPatch),
        ...keep('backoff', previous.backoff, patch.backoff),
        ...keep('lastDecision', previous.lastDecision, decisionPatch),
        ...keep('outsideSeen', previous.outsideSeen, outsidePatch),
        ...keep('evaluatedPlan', previous.evaluatedPlan, patch.evaluatedPlan),
        // Owned by claimOwnEchoes; a supervise patch must not drop it.
        ...(previous.heldActivities !== undefined
          ? { heldActivities: previous.heldActivities }
          : {}),
      };
      const updated: OperationRecord = {
        ...current,
        supervision: next,
        updatedAt: now().toISOString(),
      };
      operations[localRequestId] = updated;
      return updated;
    },
    config
  );
}

/**
 * Splits new user messages into this plugin's own echoes and outside ones. Each
 * landed reply or create explains at most ONE vendor activity (its echo), so a
 * teammate later repeating an earlier prompt verbatim is not mistaken for the
 * plugin: the first matching activity claims the operation's `echoActivityId`,
 * and further matches have no operation left to explain them. A rewalk of an
 * already-claimed activity stays own. With `mark`, the newest outside message (by
 * `(createTime, activityId)`, independent of list order) is also recorded as the
 * owner's `outsideSeen` under the same journal lock; a newer one replaces the marker, so a pending `--clear-pause` confirmation for the older one fails. A message that only a dispatched write
 * still in flight could explain is reported in `pendingOut` and neither claimed nor
 * classified, so the caller leaves it for a later walk. On a partial walk (`walkComplete` false) a message that would claim an echo is held the same way. A cleanly rejected or released write never
 * landed and claims nothing; an abandoned one might have, so it can.
 */
export async function claimOwnEchoes(
  dataDir: string,
  sessionResource: string,
  messages: ReadonlyArray<{
    activityId: string;
    digest: string;
    createTime?: string;
    /** When the walk read this message; the persisted hold starts here. */
    observedAt?: string;
  }>,
  mark?: {
    readonly ownerRequestId: string;
    readonly observedAt: string;
    /**
     * When the walk that read `messages` began. A write created or dispatched
     * after it cannot be the echo of a message the walk already held, so it is
     * not a candidate; a matching message is held for a later walk instead.
     */
    readonly walkStartedAt?: string;
  },
  pendingOut?: string[],
  walkComplete = true,
  config: LockConfig = DEFAULT_LOCK_CONFIG
): Promise<{ activityId: string; digest: string } | undefined> {
  return updateJournal(
    dataDir,
    (operations) => {
      const landed = Object.values(operations).filter((record) => {
        const neverLanded =
          (record.status === 'failed' && record.abandonedAt === undefined) ||
          record.status === 'rejected';
        return (
          record.sessionResource === sessionResource &&
          (record.kind === 'reply' || record.kind === 'create') &&
          record.promptDigest !== undefined &&
          !neverLanded &&
          // A reservation whose POST has not begun cannot have produced an echo.
          !(record.status === 'reserved' && record.dispatchedAt === undefined)
        );
      });
      const nowMs = Date.parse(mark?.observedAt ?? new Date().toISOString());
      // A dispatched write that has not settled and is still inside its settle
      // window; past it the existing unknown-outcome rules apply.
      const inFlight = (r: OperationRecord): boolean =>
        r.status === 'reserved' &&
        r.dispatchedAt !== undefined &&
        nowMs - Date.parse(r.dispatchedAt) < RESERVATION_SETTLE_MS;
      const walkStartMs =
        mark?.walkStartedAt !== undefined
          ? Date.parse(mark.walkStartedAt)
          : Number.NaN;
      // Rebased under this lock, but only writes the walk could have raced:
      // one created or dispatched after the walk began is not a candidate. A
      // write stamped the same millisecond as the walk start cannot be ordered
      // against it, so it counts as post-walk (fail closed: it cannot claim).
      const postWalk = (r: OperationRecord): boolean =>
        !Number.isNaN(walkStartMs) &&
        (Date.parse(r.createdAt) >= walkStartMs ||
          (r.dispatchedAt !== undefined &&
            Date.parse(r.dispatchedAt) >= walkStartMs));
      const claimed = new Set(
        landed.flatMap((r) =>
          r.echoActivityId !== undefined ? [r.echoActivityId] : []
        )
      );
      // Held messages persist when they were first read: a write dispatched
      // after that can never explain them, however many walks later it is
      // compared (the 30 s dispatch allowance must not let it reach back).
      const heldBefore = (
        mark !== undefined ? operations[mark.ownerRequestId] : undefined
      )?.supervision?.heldActivities;
      const held: Record<string, string> = { ...(heldBefore ?? {}) };
      const afterFirstRead = (r: OperationRecord, id: string): boolean => {
        const since = held[id];
        if (since === undefined) return false;
        const sinceMs = Date.parse(since);
        return (
          !Number.isNaN(sinceMs) &&
          (Date.parse(r.createdAt) >= sinceMs ||
            (r.dispatchedAt !== undefined &&
              Date.parse(r.dispatchedAt) >= sinceMs))
        );
      };
      const hold = (message: { activityId: string; observedAt?: string }) => {
        held[message.activityId] ??=
          message.observedAt ?? mark?.walkStartedAt ?? mark?.observedAt ?? '';
        if (held[message.activityId] === '') delete held[message.activityId];
      };
      // The newest outside message by `(createTime, activityId)`, the order
      // `compareStamp` uses: vendor list order is unverified, so neither the
      // first nor the last message visited can stand for it.
      let newestOutside:
        | { activityId: string; digest: string; createTime?: string }
        | undefined;
      for (const message of messages) {
        if (claimed.has(message.activityId)) {
          delete held[message.activityId];
          continue;
        }
        const sent = message.createTime && Date.parse(message.createTime);
        const matches = (r: OperationRecord): boolean =>
          r.echoActivityId === undefined &&
          r.promptDigest === message.digest &&
          // A message older than the record's dispatch cannot be its echo.
          !(
            typeof sent === 'number' &&
            !Number.isNaN(sent) &&
            r.dispatchedAt !== undefined &&
            sent < Date.parse(r.dispatchedAt) - DISPATCH_SKEW_MS
          );
        // A write made after the message was first read cannot be its echo.
        const possible = landed.filter(
          (r) => matches(r) && !afterFirstRead(r, message.activityId)
        );
        const eligible = possible.filter((r) => !inFlight(r) && !postWalk(r));
        // Vendor list order is unverified, so with a usable timestamp prefer
        // the latest-dispatched write that precedes the message: an older
        // identical write then keeps the older echo.
        const slot =
          typeof sent === 'number' && !Number.isNaN(sent)
            ? eligible.reduce<OperationRecord | undefined>(
                (best, r) =>
                  best === undefined ||
                  Date.parse(r.dispatchedAt ?? r.createdAt) >
                    Date.parse(best.dispatchedAt ?? best.createdAt)
                    ? r
                    : best,
                undefined
              )
            : eligible[0];
        if (slot === undefined && possible.length > 0) {
          // Only a dispatched write whose outcome is unknown could explain it:
          // `dispatchedAt` proves the POST began, not that it landed. Leave the
          // message unclassified; the caller must not consume it yet.
          pendingOut?.push(message.activityId);
          hold(message);
          continue;
        }
        if (slot !== undefined && !walkComplete) {
          // A partial walk may not have reached the write's real, older echo:
          // claiming this same-digest message now could be a teammate's. Hold
          // it until a complete walk can tell which match is earliest.
          pendingOut?.push(message.activityId);
          hold(message);
          continue;
        }
        if (slot === undefined) {
          delete held[message.activityId];
          if (
            newestOutside === undefined ||
            compareStamp(
              {
                createTime: message.createTime ?? '',
                activityId: message.activityId,
              },
              {
                createTime: newestOutside.createTime ?? '',
                activityId: newestOutside.activityId,
              }
            ) > 0
          ) {
            newestOutside = message;
          }
          continue;
        }
        claimed.add(message.activityId);
        delete held[message.activityId];
        operations[slot.localRequestId] = {
          ...slot,
          echoActivityId: message.activityId,
        };
        // `landed` holds the replaced record; keep it current for later matches.
        landed[landed.indexOf(slot)] = operations[slot.localRequestId]!;
      }
      // The marker is written in this same critical section: a reserve cannot
      // slip between classifying the message and recording that it was seen.
      const owner =
        mark !== undefined ? operations[mark.ownerRequestId] : undefined;
      // Outside evidence strictly newer (by stamp) than the stored marker
      // replaces it: a `--clear-pause` confirmed against the older id must then
      // be refused. An older message, from a delayed overlapping walk, never
      // displaces a newer marker, or clearing it would forget the newer one.
      const stored = owner?.supervision?.outsideSeen;
      const evidence =
        stored === undefined
          ? newestOutside
          : newestOutside !== undefined &&
              compareStamp(
                {
                  createTime: newestOutside.createTime ?? '',
                  activityId: newestOutside.activityId,
                },
                {
                  createTime: stored.createTime ?? '',
                  activityId: stored.activityId,
                }
              ) > 0
            ? newestOutside
            : undefined;
      if (evidence !== undefined && mark !== undefined && owner !== undefined) {
        operations[mark.ownerRequestId] = {
          ...owner,
          supervision: {
            ...(owner.supervision ?? {}),
            outsideSeen: {
              activityId: evidence.activityId,
              observedAt: mark.observedAt,
              ...(evidence.createTime !== undefined
                ? { createTime: evidence.createTime }
                : {}),
            },
          },
          updatedAt: mark.observedAt,
        };
        // Reservations already written for this session (a reply or approve
        // between its reserve and its POST) were gated before the outside
        // activity was seen; the pre-POST re-check reads this flag and refuses.
        for (const r of Object.values(operations)) {
          if (
            r.status === 'reserved' &&
            (r.kind === 'reply' || r.kind === 'approve') &&
            r.sessionResource === sessionResource &&
            r.invalidatedBy === undefined
          ) {
            operations[r.localRequestId] = {
              ...r,
              invalidatedBy: 'outside-activity',
              updatedAt: mark.observedAt,
            };
          }
        }
      }
      // Persist what is still held (and forget what was classified) in the
      // same critical section, so the next walk compares writes against when
      // each held message was first read.
      const current =
        mark !== undefined ? operations[mark.ownerRequestId] : undefined;
      if (current !== undefined && mark !== undefined) {
        const before = current.supervision?.heldActivities ?? {};
        const same =
          Object.keys(held).length === Object.keys(before).length &&
          Object.entries(held).every(([id, at]) => before[id] === at);
        if (!same) {
          const { heldActivities: _drop, ...rest } = current.supervision ?? {};
          operations[mark.ownerRequestId] = {
            ...current,
            supervision: {
              ...rest,
              ...(Object.keys(held).length > 0 ? { heldActivities: held } : {}),
            },
            updatedAt: mark.observedAt,
          };
        }
      }
      return newestOutside;
    },
    config
  );
}

/**
 * An earlier launch of this task under this grant that blocks a repair launch:
 * it is paused or carries unreviewed outside activity. One predicate for the
 * pre-reservation gate and the pre-POST re-check.
 */
export function blocksRepairLaunch(
  record: OperationRecord,
  grantId: string | undefined,
  taskRef: string | undefined
): boolean {
  return (
    record.kind === 'create' &&
    record.grantId === grantId &&
    record.taskRef === taskRef &&
    (record.supervision?.paused !== undefined ||
      record.supervision?.outsideSeen !== undefined)
  );
}

/** A create this plugin made: the only record a grant can cover (it carries the repository, branch and source). */
export type OwningCreate = OperationRecord & {
  readonly repository: string;
  readonly requestedBranch: string;
  readonly sourceResource: string;
};

export function isOwningCreate(
  record: OperationRecord | undefined
): record is OwningCreate {
  return (
    record !== undefined &&
    record.kind === 'create' &&
    record.repository !== undefined &&
    record.requestedBranch !== undefined &&
    record.sourceResource !== undefined
  );
}
