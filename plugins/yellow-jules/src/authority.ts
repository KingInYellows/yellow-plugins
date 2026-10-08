/**
 * Grants (R30) and the pure runtime authority check (R31). A grant is a
 * bounded, expiring permission written only by the TTY-confirmed `authorize`
 * path into `state/grants.json`; the runtime can only narrow it (revoke,
 * charge counters, release slots), never widen it.
 *
 * `evaluateAuthority` is pure. The callers in mutations.ts run it, together
 * with `assertControllerAuthority`, the R36 lookup, `chargeGrant` and the
 * reservation write, as one critical section under the journal lock (R31).
 *
 * Counter rules (R31): reserved and unknown-outcome operations count against
 * the limits; `totalTasks` and corrective rounds never decrement;
 * `releaseGrant` frees only an active-session slot and is callable from the
 * reconcile, abandon, terminal-observation and clean-rejection paths, never
 * from a path whose outcome is unknown.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  assertOwnerOnlyFile,
  ensureOwnerOnlyDir,
  resolveGrantsPath,
  resolveStateDir,
} from './config.js';
import { throwAppError } from './errors.js';
import { assertNoSecretShapedValues } from './redact.js';
import { hasUnreconciledDeviation, withJournalLock } from './state.js';
import type {
  GrantOperation,
  GrantRecord,
  GrantsFile,
  GrantUsage,
  Journal,
} from './types.js';
import { branchMatchesPattern, validateGrantId } from './validate.js';

/** R30 trial defaults. */
export const GRANT_DEFAULTS = Object.freeze({
  maxActiveSessions: 1,
  maxTotalTasks: 3,
  maxCorrectiveRounds: 2,
  ttlMinutes: 120,
});

/** Documented ceilings (contract "Autonomy boundaries"); `authorize` refuses anything above them. */
export const GRANT_CEILINGS = Object.freeze({
  maxActiveSessions: 3,
  maxTotalTasks: 10,
  maxCorrectiveRounds: 3,
  ttlMinutes: 24 * 60,
});

export function emptyGrants(): GrantsFile {
  return {
    version: 1,
    grants: Object.create(null) as Record<string, GrantRecord>,
  };
}

export function emptyUsage(): GrantUsage {
  return {
    activeSessionRefs: [],
    totalTasks: 0,
    correctiveRounds: Object.create(null) as Record<string, number>,
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const OPERATIONS = new Set<string>(['create', 'reply', 'approve', 'collect']);
const GRANT_ID_RE = /^jg-[0-9a-f]{32}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isIsoTime(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function parseUsage(value: unknown): GrantUsage | undefined {
  if (!isPlainObject(value)) return undefined;
  const { activeSessionRefs, totalTasks, correctiveRounds } = value;
  if (!isStringArray(activeSessionRefs) || !isNonNegativeInt(totalTasks))
    return undefined;
  if (!isPlainObject(correctiveRounds)) return undefined;
  const rounds = Object.create(null) as Record<string, number>;
  for (const [taskRef, n] of Object.entries(correctiveRounds)) {
    if (!isNonNegativeInt(n)) return undefined;
    rounds[taskRef] = n;
  }
  return { activeSessionRefs, totalTasks, correctiveRounds: rounds };
}

function parseGrant(key: string, value: unknown): GrantRecord | undefined {
  if (!isPlainObject(value)) return undefined;
  const v = value;
  if (v['grantId'] !== key || !GRANT_ID_RE.test(key)) return undefined;
  const epochRef = v['epochRef'];
  if (
    !isPlainObject(epochRef) ||
    typeof epochRef['controllerId'] !== 'string' ||
    !isPositiveInt(epochRef['epoch'])
  )
    return undefined;
  const usage = parseUsage(v['usage']);
  if (usage === undefined) return undefined;
  const operations = v['operations'];
  const taskRefs = v['taskRefs'];
  if (
    typeof v['repository'] !== 'string' ||
    typeof v['sourceResource'] !== 'string' ||
    typeof v['branchPattern'] !== 'string' ||
    !isStringArray(taskRefs) ||
    !isStringArray(operations) ||
    operations.length === 0 ||
    !operations.every((op) => OPERATIONS.has(op)) ||
    !isPositiveInt(v['maxActiveSessions']) ||
    !isPositiveInt(v['maxTotalTasks']) ||
    !isNonNegativeInt(v['maxCorrectiveRounds']) ||
    !isIsoTime(v['expiresAt']) ||
    !isIsoTime(v['createdAt']) ||
    typeof v['owner'] !== 'string' ||
    typeof v['controllerId'] !== 'string' ||
    (v['revokedAt'] !== undefined && !isIsoTime(v['revokedAt']))
  )
    return undefined;
  return {
    grantId: key,
    repository: v['repository'],
    sourceResource: v['sourceResource'],
    branchPattern: v['branchPattern'],
    taskRefs,
    operations: operations as GrantOperation[],
    maxActiveSessions: v['maxActiveSessions'],
    maxTotalTasks: v['maxTotalTasks'],
    maxCorrectiveRounds: v['maxCorrectiveRounds'],
    expiresAt: v['expiresAt'],
    createdAt: v['createdAt'],
    owner: v['owner'],
    controllerId: v['controllerId'],
    epochRef: {
      controllerId: epochRef['controllerId'],
      epoch: epochRef['epoch'],
    },
    ...(typeof v['revokedAt'] === 'string'
      ? { revokedAt: v['revokedAt'] }
      : {}),
    usage,
  };
}

function parseGrants(raw: string): GrantsFile | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isPlainObject(parsed) || parsed['version'] !== 1) return undefined;
  const grantsValue = parsed['grants'];
  if (!isPlainObject(grantsValue)) return undefined;
  const grants = Object.create(null) as Record<string, GrantRecord>;
  for (const [key, record] of Object.entries(grantsValue)) {
    const grant = parseGrant(key, record);
    if (grant === undefined) return undefined;
    grants[key] = grant;
  }
  return { version: 1, grants };
}

/**
 * Reads `state/grants.json`. A missing file is no grants; anything that does
 * not parse into the expected shape throws `JULES_JOURNAL_CORRUPT` and leaves
 * the file untouched — a corrupt grants file is never treated as empty.
 */
export function loadGrants(dataDir: string): GrantsFile {
  ensureOwnerOnlyDir(resolveStateDir(dataDir));
  const file = resolveGrantsPath(dataDir);
  assertOwnerOnlyFile(file);
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyGrants();
    throw err;
  }
  const grants = parseGrants(raw);
  if (grants === undefined) {
    return throwAppError(
      'JULES_JOURNAL_CORRUPT',
      `${file} does not parse as a yellow-jules grants file; it was left untouched`,
      {
        recoveryAction:
          'Inspect state/grants.json by hand; writes are blocked until it parses. Create a new grant with authorize once it is repaired or removed.',
      }
    );
  }
  return grants;
}

/** Atomic whole-file rewrite (temp, fsync, rename, 0600). Callers hold the journal lock. */
export function writeGrants(dataDir: string, grants: GrantsFile): void {
  assertNoSecretShapedValues(grants);
  const stateDir = resolveStateDir(dataDir);
  ensureOwnerOnlyDir(stateDir);
  const file = resolveGrantsPath(dataDir);
  assertOwnerOnlyFile(file);
  const tmp = path.join(
    stateDir,
    `grants.json.tmp-${process.pid}-${crypto.randomUUID()}`
  );
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(grants, null, 2)}\n`, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  fs.chmodSync(file, 0o600);
}

// ---------------------------------------------------------------------------
// evaluateAuthority (pure)
// ---------------------------------------------------------------------------

export interface AuthorityRequest {
  readonly repository: string;
  readonly sourceResource: string;
  readonly branch: string;
  readonly taskRef?: string;
  readonly operation: GrantOperation;
  /** A repair `delegate` or a corrective `reply` (R44). */
  readonly correction?: boolean;
}

export type DenialReason =
  | 'revoked'
  | 'expired'
  | 'repository-mismatch'
  | 'branch-outside-pattern'
  | 'task-ref-outside-grant'
  | 'operation-not-permitted'
  | 'active-sessions-exhausted'
  | 'total-tasks-exhausted'
  | 'corrective-rounds-exhausted'
  | 'unreconciled-policy-deviation';

export interface AuthorityDenial {
  readonly ok: false;
  readonly code:
    | 'JULES_AUTHORITY_DENIED'
    | 'JULES_GRANT_EXPIRED'
    | 'JULES_GRANT_EXHAUSTED'
    | 'JULES_POLICY_DEVIATION';
  readonly reason: DenialReason;
  readonly message: string;
}

export type AuthorityVerdict = { readonly ok: true } | AuthorityDenial;

function deny(
  code: AuthorityDenial['code'],
  reason: DenialReason,
  message: string
): AuthorityDenial {
  return { ok: false, code, reason, message };
}

export function isExpired(grant: GrantRecord, now: Date): boolean {
  return now.getTime() >= Date.parse(grant.expiresAt);
}

/**
 * Denial order (each step is checked only if the previous passed):
 * revoked, expired, repository/source, branch, task ref, operation, limits,
 * then an unreconciled policy deviation under the grant (R13).
 */
export function evaluateAuthority(
  grant: GrantRecord,
  request: AuthorityRequest,
  now: Date,
  context: { readonly unreconciledDeviation: boolean }
): AuthorityVerdict {
  if (grant.revokedAt !== undefined) {
    return deny(
      'JULES_AUTHORITY_DENIED',
      'revoked',
      `grant ${grant.grantId} was revoked`
    );
  }
  if (isExpired(grant, now)) {
    return deny(
      'JULES_GRANT_EXPIRED',
      'expired',
      `grant ${grant.grantId} expired at ${grant.expiresAt}`
    );
  }
  if (
    request.repository !== grant.repository ||
    request.sourceResource !== grant.sourceResource
  ) {
    return deny(
      'JULES_AUTHORITY_DENIED',
      'repository-mismatch',
      `grant ${grant.grantId} does not cover ${request.repository}`
    );
  }
  if (!branchMatchesPattern(grant.branchPattern, request.branch)) {
    return deny(
      'JULES_AUTHORITY_DENIED',
      'branch-outside-pattern',
      `grant ${grant.grantId} does not cover branch ${request.branch}`
    );
  }
  if (
    request.taskRef === undefined ||
    !grant.taskRefs.includes(request.taskRef)
  ) {
    return deny(
      'JULES_AUTHORITY_DENIED',
      'task-ref-outside-grant',
      `grant ${grant.grantId} does not cover task ref ${request.taskRef ?? '(none)'}`
    );
  }
  if (!grant.operations.includes(request.operation)) {
    return deny(
      'JULES_AUTHORITY_DENIED',
      'operation-not-permitted',
      `grant ${grant.grantId} does not permit ${request.operation}`
    );
  }
  const limit = limitDenial(grant, request);
  if (limit !== undefined) return limit;
  if (context.unreconciledDeviation) {
    return deny(
      'JULES_POLICY_DEVIATION',
      'unreconciled-policy-deviation',
      `a session under grant ${grant.grantId} has an unreconciled policy deviation`
    );
  }
  return { ok: true };
}

function limitDenial(
  grant: GrantRecord,
  request: AuthorityRequest
): AuthorityDenial | undefined {
  const usage = grant.usage;
  const rounds =
    request.taskRef !== undefined
      ? (usage.correctiveRounds[request.taskRef] ?? 0)
      : 0;
  if (request.operation === 'create') {
    if (usage.activeSessionRefs.length >= grant.maxActiveSessions) {
      return deny(
        'JULES_GRANT_EXHAUSTED',
        'active-sessions-exhausted',
        `grant ${grant.grantId} allows ${grant.maxActiveSessions} active session(s)`
      );
    }
    if (
      request.correction !== true &&
      usage.totalTasks >= grant.maxTotalTasks
    ) {
      return deny(
        'JULES_GRANT_EXHAUSTED',
        'total-tasks-exhausted',
        `grant ${grant.grantId} allows ${grant.maxTotalTasks} task(s) in total`
      );
    }
  }
  if (
    request.correction === true &&
    (request.operation === 'create' || request.operation === 'reply') &&
    rounds >= grant.maxCorrectiveRounds
  ) {
    return deny(
      'JULES_GRANT_EXHAUSTED',
      'corrective-rounds-exhausted',
      `grant ${grant.grantId} allows ${grant.maxCorrectiveRounds} corrective round(s) per task`
    );
  }
  return undefined;
}

/** R13: any record under this grant that carries an unreconciled policy deviation. */
export function grantHasUnreconciledDeviation(
  journal: Journal,
  grantId: string
): boolean {
  return Object.values(journal.operations).some(
    (r) => r.grantId === grantId && hasUnreconciledDeviation(r)
  );
}

// ---------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------

export interface Charge {
  readonly operation: GrantOperation;
  readonly localRequestId: string;
  readonly taskRef?: string;
  readonly correction?: boolean;
}

function withRounds(
  usage: GrantUsage,
  taskRef: string
): Record<string, number> {
  const rounds = Object.create(null) as Record<string, number>;
  for (const [key, n] of Object.entries(usage.correctiveRounds))
    rounds[key] = n;
  rounds[taskRef] = (rounds[taskRef] ?? 0) + 1;
  return rounds;
}

/**
 * A `create` takes an active-session slot (held until the session is observed
 * terminal, or a reconcile/abandon/clean-rejection releases it) and, unless it
 * is a repair, one task; a repair `create` and a corrective `reply` spend one
 * corrective round on their task ref instead.
 */
export function chargeGrant(grant: GrantRecord, charge: Charge): GrantRecord {
  let usage = grant.usage;
  if (charge.operation === 'create') {
    usage = {
      ...usage,
      activeSessionRefs: usage.activeSessionRefs.includes(charge.localRequestId)
        ? usage.activeSessionRefs
        : [...usage.activeSessionRefs, charge.localRequestId],
      ...(charge.correction === true
        ? {}
        : { totalTasks: usage.totalTasks + 1 }),
    };
  }
  if (charge.correction === true && charge.taskRef !== undefined) {
    usage = {
      ...usage,
      correctiveRounds: withRounds(usage, charge.taskRef),
    };
  }
  return { ...grant, usage };
}

export type ReleaseReason =
  | 'reconcile-released'
  | 'abandon'
  | 'terminal-vendor-state'
  | 'clean-rejection';

/** Frees an active-session slot only; tasks and corrective rounds are spent for good. */
export function releaseGrant(
  grant: GrantRecord,
  localRequestId: string,
  _reason: ReleaseReason
): GrantRecord {
  if (!grant.usage.activeSessionRefs.includes(localRequestId)) return grant;
  return {
    ...grant,
    usage: {
      ...grant.usage,
      activeSessionRefs: grant.usage.activeSessionRefs.filter(
        (ref) => ref !== localRequestId
      ),
    },
  };
}

/** Applies `fn` to one stored grant and returns the file; callers write it under the lock. */
export function updateGrant(
  file: GrantsFile,
  grantId: string,
  fn: (grant: GrantRecord) => GrantRecord
): GrantsFile {
  const grant = file.grants[grantId];
  if (grant === undefined) {
    return throwAppError('JULES_NOT_FOUND', `no grant ${grantId}`);
  }
  const grants = Object.create(null) as Record<string, GrantRecord>;
  for (const [id, g] of Object.entries(file.grants)) grants[id] = g;
  grants[grantId] = fn(grant);
  return { version: 1, grants };
}

export function requireGrant(file: GrantsFile, grantId: string): GrantRecord {
  validateGrantId(grantId);
  const grant = file.grants[grantId];
  if (grant === undefined) {
    return throwAppError(
      'JULES_AUTHORITY_DENIED',
      `no grant ${grantId} exists on this host`,
      {
        recoveryAction:
          'List grants with authorize --list, or create one with authorize in a terminal.',
      }
    );
  }
  return grant;
}

// ---------------------------------------------------------------------------
// List and revoke (no TTY: both only narrow authority)
// ---------------------------------------------------------------------------

export interface GrantView extends GrantRecord {
  readonly expired: boolean;
  readonly revoked: boolean;
}

export function listGrants(dataDir: string, now: Date): GrantView[] {
  const file = loadGrants(dataDir);
  return Object.values(file.grants).map((grant) => ({
    ...grant,
    expired: isExpired(grant, now),
    revoked: grant.revokedAt !== undefined,
  }));
}

export async function revokeGrant(
  dataDir: string,
  grantId: string,
  now: Date
): Promise<{ grantId: string; revokedAt: string }> {
  validateGrantId(grantId);
  return withJournalLock(dataDir, async () => {
    const file = loadGrants(dataDir);
    const grant = file.grants[grantId];
    if (grant === undefined) {
      return throwAppError('JULES_NOT_FOUND', `no grant ${grantId}`, {
        recoveryAction: 'List grants with authorize --list.',
      });
    }
    if (grant.revokedAt !== undefined) {
      return { grantId, revokedAt: grant.revokedAt };
    }
    const revokedAt = now.toISOString();
    writeGrants(
      dataDir,
      updateGrant(file, grantId, (g) => ({ ...g, revokedAt }))
    );
    return { grantId, revokedAt };
  });
}

/**
 * Frees one active-session slot in `state/grants.json` under the journal lock.
 * Called only from the reconcile, abandon, terminal-vendor-state and
 * clean-rejection paths (never from a path whose outcome is unknown). A grant
 * that no longer exists (hand-removed file) is a no-op; a corrupt grants file
 * still fails loud.
 */
export async function releaseSlotInStore(
  dataDir: string,
  grantId: string,
  localRequestId: string,
  reason: ReleaseReason
): Promise<boolean> {
  return withJournalLock(dataDir, async () => {
    const file = loadGrants(dataDir);
    const grant = file.grants[grantId];
    if (
      grant === undefined ||
      !grant.usage.activeSessionRefs.includes(localRequestId)
    ) {
      return false;
    }
    writeGrants(
      dataDir,
      updateGrant(file, grantId, (g) => releaseGrant(g, localRequestId, reason))
    );
    return true;
  });
}
