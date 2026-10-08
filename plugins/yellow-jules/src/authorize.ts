/**
 * `authorize` — the only trust root (R29, R30). Creating a grant, taking over
 * the controller (R38), and — in mutations.ts — `abandon` all require the
 * owner to type a runtime-minted challenge back on the controlling terminal.
 * `--list` and `--revoke` need no terminal because they never widen authority.
 *
 * Flow for a new grant: validate, confirm on the TTY (before the lock, so a
 * waiting human never holds it), resolve the source through the adapter (R17),
 * then under the journal lock initialize or assert the controller authority
 * and write the grant atomically.
 */

import * as os from 'node:os';

import {
  emptyUsage,
  GRANT_CEILINGS,
  GRANT_DEFAULTS,
  type GrantView,
  listGrants,
  loadGrants,
  revokeGrant,
  writeGrants,
} from './authority.js';
import { canonicalPath, resolveControllerDir } from './config.js';
import {
  type ControllerContext,
  initControllerAuthority,
  readControllerAuthority,
  takeOverController,
} from './controller.js';
import { DEFAULT_READ_DEADLINE_MS, deadlineIn } from './deadline.js';
import { throwAppError } from './errors.js';
import {
  nowFn,
  prepare,
  read,
  type RuntimeDeps,
  withAdapter,
} from './runtime-support.js';
import { withJournalLock } from './state.js';
import {
  confirmOnTty,
  DEFAULT_CONFIRM_DEADLINE_MS,
  type OpenTty,
} from './tty-confirm.js';
import type { GrantOperation, GrantRecord } from './types.js';
import {
  mintGrantId,
  sourceResourceFor,
  validateBranchPattern,
  validateControllerId,
  validateGrantId,
  validateOperations,
  validateOwnerLabel,
  validateRepoInput,
  validateSourceResource,
  validateTaskRef,
} from './validate.js';

/** Set by the supervision skill for the duration of a pass; `authorize` refuses while it is set (R30). */
export const ACTIVE_GRANT_ENV = 'YELLOW_JULES_ACTIVE_GRANT';

export interface AuthorizeDeps extends RuntimeDeps {
  readonly openTty?: OpenTty;
  /** Test seam; production resolves it with `resolveControllerDir`. */
  readonly controllerDir?: string;
  /** Test seam; production uses the sanitized host name. */
  readonly controllerId?: string;
  readonly confirmDeadlineMs?: number;
}

export interface AuthorizeCreateArgs {
  readonly repo: string;
  readonly branch: string;
  readonly source?: string;
  readonly taskRefs: readonly string[];
  readonly operations: string;
  readonly maxActiveSessions?: number;
  readonly maxTotalTasks?: number;
  readonly maxCorrectiveRounds?: number;
  readonly ttlMinutes?: number;
  readonly owner: string;
  readonly deadlineMs?: number;
}

export interface GrantLimits {
  readonly maxActiveSessions: number;
  readonly maxTotalTasks: number;
  readonly maxCorrectiveRounds: number;
}

export interface AuthorizeCreateResult {
  readonly operation: 'authorize';
  readonly grantId: string;
  readonly repository: string;
  readonly sourceResource: string;
  readonly branchPattern: string;
  readonly taskRefs: readonly string[];
  readonly operations: readonly GrantOperation[];
  readonly limits: GrantLimits;
  readonly expiresAt: string;
  readonly controllerId: string;
  readonly epoch: number;
}

export interface AuthorizeListResult {
  readonly operation: 'authorize';
  readonly grants: readonly GrantView[];
}

export interface AuthorizeRevokeResult {
  readonly operation: 'authorize';
  readonly grantId: string;
  readonly revokedAt: string;
}

export interface AuthorizeTakeOverResult {
  readonly operation: 'authorize';
  readonly controllerId: string;
  readonly epoch: number;
  readonly dataDir: string;
  readonly grantsRebound: number;
}

/** Host name made safe for the controller-id allowlist, then validated. */
export function defaultControllerId(
  hostname: () => string = os.hostname
): string {
  const cleaned = hostname()
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/^[^A-Za-z0-9]+/, '')
    .slice(0, 63);
  return validateControllerId(cleaned.length > 0 ? cleaned : 'host');
}

export function resolveControllerContext(
  deps: Pick<
    AuthorizeDeps,
    'dataDir' | 'env' | 'controllerDir' | 'controllerId' | 'clock'
  >
): ControllerContext {
  return {
    controllerDir:
      deps.controllerDir ?? resolveControllerDir(deps.dataDir, deps.env),
    controllerId: validateControllerId(
      deps.controllerId ?? defaultControllerId()
    ),
    now: nowFn(deps as RuntimeDeps),
  };
}

export function refuseInsideSupervisedSession(env: NodeJS.ProcessEnv): void {
  const active = env[ACTIVE_GRANT_ENV];
  if (active !== undefined && active !== '') {
    throwAppError(
      'JULES_AUTHORITY_DENIED',
      'authorize cannot run inside a supervised session; a grant is never created or widened from under another grant',
      {
        recoveryAction:
          'End the supervised session and run authorize yourself in a terminal.',
      }
    );
  }
}

function boundedInt(
  value: number | undefined,
  fallback: number,
  ceiling: number,
  min: number,
  label: string
): number {
  const chosen = value ?? fallback;
  if (!Number.isInteger(chosen) || chosen < min || chosen > ceiling) {
    return throwAppError(
      'JULES_INVALID_INPUT',
      `${label} must be an integer between ${min} and the ceiling ${ceiling}`
    );
  }
  return chosen;
}

function summaryOf(
  grant: Omit<GrantRecord, 'grantId' | 'usage' | 'epochRef' | 'createdAt'>,
  ttlMinutes: number
): string {
  return [
    'yellow-jules: CREATE GRANT',
    `  repository:  ${grant.repository} (${grant.sourceResource})`,
    `  branch:      ${grant.branchPattern}`,
    `  task refs:   ${grant.taskRefs.join(', ')}`,
    `  operations:  ${grant.operations.join(', ')}`,
    `  limits:      ${grant.maxActiveSessions} active session(s), ${grant.maxTotalTasks} task(s), ${grant.maxCorrectiveRounds} corrective round(s) per task`,
    `  expires:     ${grant.expiresAt} (${ttlMinutes} minutes)`,
    `  owner:       ${grant.owner}`,
    `  controller:  ${grant.controllerId}`,
    '',
    'A supervised session may act without asking inside these limits.',
  ].join('\n');
}

export async function authorizeCreate(
  deps: AuthorizeDeps,
  args: AuthorizeCreateArgs
): Promise<AuthorizeCreateResult> {
  refuseInsideSupervisedSession(deps.env);
  const repo = validateRepoInput(args.repo);
  const repository = `${repo.owner}/${repo.repo}`;
  const branchPattern = validateBranchPattern(args.branch);
  const sourceResource = sourceResourceFor(repo);
  if (args.source !== undefined) {
    validateSourceResource(args.source, 'input');
    if (args.source !== sourceResource) {
      throwAppError(
        'JULES_INVALID_INPUT',
        '--source does not match --repo; sources are discovered, never synthesized'
      );
    }
  }
  if (args.taskRefs.length === 0) {
    throwAppError('JULES_INVALID_INPUT', 'at least one --task-ref is required');
  }
  const taskRefs = [...new Set(args.taskRefs.map((t) => validateTaskRef(t)))];
  const operations = validateOperations(args.operations);
  const owner = validateOwnerLabel(args.owner);
  const maxActiveSessions = boundedInt(
    args.maxActiveSessions,
    GRANT_DEFAULTS.maxActiveSessions,
    GRANT_CEILINGS.maxActiveSessions,
    1,
    '--max-active-sessions'
  );
  const maxTotalTasks = boundedInt(
    args.maxTotalTasks,
    GRANT_DEFAULTS.maxTotalTasks,
    GRANT_CEILINGS.maxTotalTasks,
    1,
    '--max-total-tasks'
  );
  const maxCorrectiveRounds = boundedInt(
    args.maxCorrectiveRounds,
    GRANT_DEFAULTS.maxCorrectiveRounds,
    GRANT_CEILINGS.maxCorrectiveRounds,
    0,
    '--max-corrective-rounds'
  );
  const ttlMinutes = boundedInt(
    args.ttlMinutes,
    GRANT_DEFAULTS.ttlMinutes,
    GRANT_CEILINGS.ttlMinutes,
    1,
    '--ttl-minutes'
  );

  prepare(deps);
  const ctx = resolveControllerContext(deps);
  const createdAt = nowFn(deps)().toISOString();
  const expiresAt = new Date(
    deps.clock.now() + ttlMinutes * 60_000
  ).toISOString();

  await confirmOnTty({
    summary: summaryOf(
      {
        repository,
        sourceResource,
        branchPattern,
        taskRefs,
        operations,
        maxActiveSessions,
        maxTotalTasks,
        maxCorrectiveRounds,
        expiresAt,
        owner,
        controllerId: ctx.controllerId,
      },
      ttlMinutes
    ),
    deadlineMs: deps.confirmDeadlineMs ?? DEFAULT_CONFIRM_DEADLINE_MS,
    ...(deps.openTty !== undefined ? { openTty: deps.openTty } : {}),
  });

  // R17: the source is discovered through the adapter, never synthesized.
  const deadline = deadlineIn(
    deps.clock,
    args.deadlineMs ?? DEFAULT_READ_DEADLINE_MS
  );
  const source = await withAdapter(deps, (adapter) =>
    read(deps, deadline, () => adapter.getSource(repo.owner, repo.repo))
  );
  if (source.sourceResource !== sourceResource) {
    throwAppError(
      'JULES_SOURCE_ACCESS',
      'the discovered source does not match the requested repository'
    );
  }

  return withJournalLock(deps.dataDir, async () => {
    const grants = loadGrants(deps.dataDir);
    const existing = readControllerAuthority(
      ctx.controllerDir,
      ctx.controllerId
    );
    let epoch: number;
    if (existing === undefined) {
      if (Object.keys(grants.grants).length > 0) {
        return throwAppError(
          'JULES_CONTROLLER_MISMATCH',
          `grants exist but this host has no controller authority for ${ctx.controllerId}`
        );
      }
      epoch = initControllerAuthority(ctx, deps.dataDir).epoch;
    } else {
      if (existing.dataDir !== canonicalPath(deps.dataDir)) {
        return throwAppError(
          'JULES_CONTROLLER_MISMATCH',
          'this data directory is not the one the controller authority authorizes'
        );
      }
      epoch = existing.epoch;
    }
    const grantId = mintGrantId();
    const grant: GrantRecord = {
      grantId,
      repository,
      sourceResource,
      branchPattern,
      taskRefs,
      operations,
      maxActiveSessions,
      maxTotalTasks,
      maxCorrectiveRounds,
      expiresAt,
      createdAt,
      owner,
      controllerId: ctx.controllerId,
      epochRef: { controllerId: ctx.controllerId, epoch },
      usage: emptyUsage(),
    };
    const next = Object.create(null) as Record<string, GrantRecord>;
    for (const [id, g] of Object.entries(grants.grants)) next[id] = g;
    next[grantId] = grant;
    writeGrants(deps.dataDir, { version: 1, grants: next });
    return {
      operation: 'authorize' as const,
      grantId,
      repository,
      sourceResource,
      branchPattern,
      taskRefs,
      operations,
      limits: { maxActiveSessions, maxTotalTasks, maxCorrectiveRounds },
      expiresAt,
      controllerId: ctx.controllerId,
      epoch,
    };
  });
}

export function authorizeList(deps: AuthorizeDeps): AuthorizeListResult {
  prepare(deps);
  return {
    operation: 'authorize',
    grants: listGrants(deps.dataDir, nowFn(deps)()),
  };
}

export async function authorizeRevoke(
  deps: AuthorizeDeps,
  grantId: string
): Promise<AuthorizeRevokeResult> {
  prepare(deps);
  validateGrantId(grantId);
  const result = await revokeGrant(deps.dataDir, grantId, nowFn(deps)());
  return { operation: 'authorize', ...result };
}

/** R38 handoff: TTY-confirmed; writes epoch+1 for this host and path and rebinds every grant. */
export async function authorizeTakeOver(
  deps: AuthorizeDeps
): Promise<AuthorizeTakeOverResult> {
  refuseInsideSupervisedSession(deps.env);
  prepare(deps);
  const ctx = resolveControllerContext(deps);
  const dataDir = canonicalPath(deps.dataDir);
  await confirmOnTty({
    summary: [
      'yellow-jules: TAKE OVER CONTROLLER',
      `  controller:  ${ctx.controllerId}`,
      `  data dir:    ${dataDir}`,
      '',
      'This host becomes the only writer. Every grant is rebound to the new epoch;',
      'any other copy of this data directory stops being able to write.',
    ].join('\n'),
    deadlineMs: deps.confirmDeadlineMs ?? DEFAULT_CONFIRM_DEADLINE_MS,
    ...(deps.openTty !== undefined ? { openTty: deps.openTty } : {}),
  });
  return withJournalLock(deps.dataDir, async () => {
    const grants = loadGrants(deps.dataDir);
    const result = takeOverController(ctx, deps.dataDir, grants);
    writeGrants(deps.dataDir, result.grants);
    return {
      operation: 'authorize' as const,
      controllerId: result.authority.controllerId,
      epoch: result.authority.epoch,
      dataDir: result.authority.dataDir,
      grantsRebound: Object.keys(result.grants.grants).length,
    };
  });
}
