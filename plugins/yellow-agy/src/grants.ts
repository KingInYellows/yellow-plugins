/**
 * Grants (contract-v0 "Output envelope … grants"): bounded, expiring
 * permissions that only `authorize` writes, after the owner types a code on
 * the terminal. They live in the journal, so a check and its charge happen
 * in the same locked write as the reservation they cover. The runtime only
 * narrows a grant (charge, revoke); it never widens one.
 */

import { randomBytes } from 'node:crypto';

import { AgyError } from './errors';
import { validateAllowCommand } from './profiles';
import type { Journal, Operation, Task } from './state';
import { validateBranchName } from './worktree';

/** Grant operations; `delegate` is `create`. `abandon` is terminal-gated instead. */
export type GrantOp = 'create' | 'approve' | 'reply' | 'collect';

export const GRANT_OPS: readonly GrantOp[] = [
  'create',
  'approve',
  'reply',
  'collect',
];

export interface Grant {
  readonly grantId: string;
  /** Canonical repo path, in the filesystem agy runs in. */
  readonly repo: string;
  /** An exact branch, or a prefix ending in a single `*`. */
  readonly branchPattern: string;
  readonly operations: readonly GrantOp[];
  /** Test and lint commands, used only where --sandbox is verified. */
  readonly allowCommands: readonly string[];
  readonly minQuotaPercent: number;
  readonly maxTotalTasks: number;
  readonly maxCorrectiveRounds: number;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly revokedAt?: string;
  /** Tasks created under the grant; never decremented. */
  readonly totalTasks: number;
}

export const GRANT_DEFAULTS = Object.freeze({
  maxTotalTasks: 3,
  maxCorrectiveRounds: 2,
  ttlMinutes: 120,
  minQuotaPercent: 10,
});

export const GRANT_CEILINGS = Object.freeze({
  maxTotalTasks: 10,
  maxCorrectiveRounds: 3,
  ttlMinutes: 24 * 60,
});

export const GRANT_ID_RE = /^ag-[0-9a-f]{32}$/;
const BRANCH_PATTERN_MAX = 200;

export function mintGrantId(): string {
  return `ag-${randomBytes(16).toString('hex')}`;
}

export function validateGrantId(value: string): string {
  if (!GRANT_ID_RE.test(value)) {
    throw new AgyError(
      'AGY_INVALID_INPUT',
      `invalid grant id ${JSON.stringify(value)}`
    );
  }
  return value;
}

/**
 * An exact branch name, or a branch-name prefix with one trailing `*`. The
 * glob is never mid-name, so matching is a prefix test.
 */
export function validateBranchPattern(input: string): string {
  if (input.length === 0 || input.length > BRANCH_PATTERN_MAX) {
    throw new AgyError(
      'AGY_INVALID_INPUT',
      `branch pattern must be 1-${BRANCH_PATTERN_MAX} characters`
    );
  }
  const star = input.indexOf('*');
  if (star === -1) return validateBranchName(input);
  if (star !== input.length - 1) {
    throw new AgyError(
      'AGY_INVALID_INPUT',
      'a branch pattern allows one trailing "*" only'
    );
  }
  const prefix = input.slice(0, -1);
  if (prefix.length === 0) {
    throw new AgyError(
      'AGY_INVALID_INPUT',
      'the branch pattern "*" matches every branch and is refused'
    );
  }
  // `agy/` is a fine prefix; check it as the branch it starts.
  validateBranchName(prefix.endsWith('/') ? `${prefix}x` : prefix);
  return input;
}

export function branchMatches(pattern: string, branch: string): boolean {
  return pattern.endsWith('*')
    ? branch.startsWith(pattern.slice(0, -1))
    : pattern === branch;
}

export function validateOperations(input: string): GrantOp[] {
  const out: GrantOp[] = [];
  for (const raw of input.split(',')) {
    const op = GRANT_OPS.find((o) => o === raw.trim());
    if (op === undefined) {
      throw new AgyError(
        'AGY_INVALID_INPUT',
        `operations must be a comma-separated subset of ${GRANT_OPS.join(', ')}`
      );
    }
    if (out.includes(op)) {
      throw new AgyError(
        'AGY_INVALID_INPUT',
        `operation ${op} is listed more than once`
      );
    }
    out.push(op);
  }
  return out;
}

export function boundedInt(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  label: string
): number {
  const n = value ?? fallback;
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new AgyError(
      'AGY_INVALID_INPUT',
      `${label} must be an integer from ${min} to ${max}`
    );
  }
  return n;
}

export interface NewGrantInput {
  readonly repo: string;
  readonly branchPattern: string;
  readonly operations: string;
  readonly allowCommands?: readonly string[];
  readonly minQuotaPercent?: number;
  readonly maxTotalTasks?: number;
  readonly maxCorrectiveRounds?: number;
  readonly ttlMinutes?: number;
}

/** Validates every field; throws before anything is shown or written. */
export function buildGrant(input: NewGrantInput, now: Date): Grant {
  const ttl = boundedInt(
    input.ttlMinutes,
    GRANT_DEFAULTS.ttlMinutes,
    1,
    GRANT_CEILINGS.ttlMinutes,
    'ttl minutes'
  );
  return {
    grantId: mintGrantId(),
    repo: input.repo,
    branchPattern: validateBranchPattern(input.branchPattern),
    operations: validateOperations(input.operations),
    allowCommands: (input.allowCommands ?? []).map(validateAllowCommand),
    minQuotaPercent: boundedInt(
      input.minQuotaPercent,
      GRANT_DEFAULTS.minQuotaPercent,
      0,
      100,
      'min quota percent'
    ),
    maxTotalTasks: boundedInt(
      input.maxTotalTasks,
      GRANT_DEFAULTS.maxTotalTasks,
      1,
      GRANT_CEILINGS.maxTotalTasks,
      'max total tasks'
    ),
    maxCorrectiveRounds: boundedInt(
      input.maxCorrectiveRounds,
      GRANT_DEFAULTS.maxCorrectiveRounds,
      0,
      GRANT_CEILINGS.maxCorrectiveRounds,
      'max corrective rounds'
    ),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttl * 60_000).toISOString(),
    totalTasks: 0,
  };
}

function isIso(v: unknown): v is string {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v));
}

function isCount(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= 0;
}

function validPattern(p: string): boolean {
  try {
    validateBranchPattern(p);
    return true;
  } catch {
    return false;
  }
}

/** A stored grant's shape check; anything else makes the journal unreadable. */
export function isGrant(key: string, v: unknown): v is Grant {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const g = v as Record<string, unknown>;
  const ops = g['operations'];
  const cmds = g['allowCommands'];
  return (
    g['grantId'] === key &&
    GRANT_ID_RE.test(key) &&
    typeof g['repo'] === 'string' &&
    typeof g['branchPattern'] === 'string' &&
    Array.isArray(ops) &&
    ops.length > 0 &&
    ops.every((o) => GRANT_OPS.includes(o as GrantOp)) &&
    Array.isArray(cmds) &&
    cmds.every((c) => typeof c === 'string') &&
    isCount(g['minQuotaPercent']) &&
    (g['minQuotaPercent'] as number) <= 100 &&
    isCount(g['maxTotalTasks']) &&
    (g['maxTotalTasks'] as number) <= GRANT_CEILINGS.maxTotalTasks &&
    isCount(g['maxCorrectiveRounds']) &&
    (g['maxCorrectiveRounds'] as number) <=
      GRANT_CEILINGS.maxCorrectiveRounds &&
    validPattern(g['branchPattern'] as string) &&
    isCount(g['totalTasks']) &&
    isIso(g['createdAt']) &&
    isIso(g['expiresAt']) &&
    (g['revokedAt'] === undefined || isIso(g['revokedAt']))
  );
}

function own<T>(rec: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(rec, key) ? rec[key] : undefined;
}

export function grants(j: Journal): Readonly<Record<string, Grant>> {
  return j.grants ?? {};
}

export function requireGrant(j: Journal, grantId: string): Grant {
  const grant = own(grants(j), validateGrantId(grantId));
  if (grant === undefined) {
    throw new AgyError('AGY_AUTHORITY_DENIED', `no grant ${grantId}`);
  }
  return grant;
}

export function putGrant(j: Journal, grant: Grant): Journal {
  return { ...j, grants: { ...grants(j), [grant.grantId]: grant } };
}

export function grantExpired(grant: Grant, now: Date): boolean {
  return now.getTime() >= Date.parse(grant.expiresAt);
}

/** Which grant operation a lifecycle operation needs; abandon needs none. */
export function grantOpFor(op: Operation): GrantOp | undefined {
  switch (op) {
    case 'delegate':
      return 'create';
    case 'abandon':
      return undefined;
    default:
      return op;
  }
}

export interface AuthorityRequest {
  readonly op: Operation;
  readonly repo: string;
  readonly branch: string;
  /** The task, for every operation after delegate. */
  readonly task?: Task;
  readonly correction?: boolean;
}

/**
 * Checks `request` against `grantId` and returns the journal with the
 * grant charged. Order: missing, revoked, expired, repo, branch, operation,
 * limits. Runs inside the reservation's locked write.
 */
export function authorizeRequest(
  j: Journal,
  grantId: string,
  request: AuthorityRequest,
  now: Date
): Journal {
  const grant = requireGrant(j, grantId);
  if (grant.revokedAt !== undefined) {
    throw new AgyError('AGY_AUTHORITY_DENIED', `grant ${grantId} was revoked`);
  }
  if (grantExpired(grant, now)) {
    throw new AgyError(
      'AGY_GRANT_EXPIRED',
      `grant ${grantId} expired at ${grant.expiresAt}`
    );
  }
  if (request.repo !== grant.repo) {
    throw new AgyError(
      'AGY_AUTHORITY_DENIED',
      `grant ${grantId} does not cover ${request.repo}`
    );
  }
  if (!branchMatches(grant.branchPattern, request.branch)) {
    throw new AgyError(
      'AGY_AUTHORITY_DENIED',
      `grant ${grantId} does not cover branch ${request.branch}`
    );
  }
  if (request.task !== undefined && request.task.grantId !== grantId) {
    throw new AgyError(
      'AGY_AUTHORITY_DENIED',
      `task ${request.task.localId} was created under another grant`
    );
  }
  const op = grantOpFor(request.op);
  if (op !== undefined && !grant.operations.includes(op)) {
    throw new AgyError(
      'AGY_AUTHORITY_DENIED',
      `grant ${grantId} does not permit ${op}`
    );
  }
  if (op === 'create') {
    if (grant.totalTasks >= grant.maxTotalTasks) {
      throw new AgyError(
        'AGY_GRANT_EXHAUSTED',
        `grant ${grantId} allows ${grant.maxTotalTasks} task(s) in total`
      );
    }
    return putGrant(j, { ...grant, totalTasks: grant.totalTasks + 1 });
  }
  if (
    request.correction === true &&
    (request.task?.correctiveRounds ?? 0) >= grant.maxCorrectiveRounds
  ) {
    throw new AgyError(
      'AGY_GRANT_EXHAUSTED',
      `grant ${grantId} allows ${grant.maxCorrectiveRounds} corrective round(s) per task`
    );
  }
  return j;
}

export interface GrantView extends Grant {
  readonly expired: boolean;
  readonly revoked: boolean;
}

export function listGrants(j: Journal, now: Date): GrantView[] {
  return Object.values(grants(j)).map((g) => ({
    ...g,
    expired: grantExpired(g, now),
    revoked: g.revokedAt !== undefined,
  }));
}

/** Revoking only narrows authority, so it needs no terminal. */
export function revokeGrant(j: Journal, grantId: string, now: Date): Journal {
  const grant = requireGrant(j, grantId);
  if (grant.revokedAt !== undefined) return j;
  return putGrant(j, { ...grant, revokedAt: now.toISOString() });
}

/** The owner-facing summary printed on the terminal before confirming. */
export function grantSummary(grant: Grant): string {
  return [
    'yellow-agy: create a grant',
    `  repo:               ${grant.repo}`,
    `  branches:           ${grant.branchPattern}`,
    `  operations:         ${grant.operations.join(', ')}`,
    `  allowed commands:   ${grant.allowCommands.length === 0 ? '(none)' : grant.allowCommands.join('; ')}`,
    `  min quota percent:  ${grant.minQuotaPercent}`,
    `  max tasks:          ${grant.maxTotalTasks}`,
    `  corrective rounds:  ${grant.maxCorrectiveRounds} per task`,
    `  expires:            ${grant.expiresAt}`,
  ].join('\n');
}
