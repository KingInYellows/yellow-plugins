/**
 * The delegate lifecycle (contract-v0 "Run lifecycle" and "Reservations,
 * retries and recovery"): delegate → approve → reply, then collect or
 * abandon. Every mutating call reserves its request id and the single
 * active-run claim under the journal lock, runs the agy turn outside the
 * lock, and settles under the lock again. All side effects come in through
 * LifecycleDeps, so tests run real git with a fake agy.
 */

import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { AgyResult, TurnClass, TurnOutcome } from './classify';
import {
  classifyTurn,
  NEEDS_INPUT_INSTRUCTION,
  needsInput,
  structuredOutput,
} from './classify';
import type { AgyErrorCode } from './errors';
import { AgyError } from './errors';
import { authorizeRequest, putGrant, requireGrant } from './grants';
import type { HostExec } from './host-exec';
import type { Host, Invocation } from './invocation';
import { buildInvocation } from './invocation';
import type { Plan } from './plan-schema';
import { isPlan, PLAN_SCHEMA } from './plan-schema';
import type { RunOptions } from './process';
import type { TurnProfile } from './profiles';
import { implementProfile, readOnlyProfile, turnArgs } from './profiles';
import { redact, scanSecretShapes, truncateRedacted } from './redact';
import type {
  Claim,
  Journal,
  Operation,
  PartialSnapshot,
  Task,
  TaskState,
} from './state';
import {
  dropRequest,
  getTask,
  isPidAlive,
  nowIso,
  own,
  putRequest,
  putTask,
  readJournal,
  updateJournal,
  withoutClaim,
} from './state';
import {
  collectWorktree,
  createWorktree,
  deleteBranchIfEmpty,
  dropSnapshotRefs,
  removeWorktree,
  resetToSnapshot,
  snapshotWorktree,
} from './worktree';

export interface LifecycleDeps {
  readonly host: Host;
  readonly exec: HostExec;
  /** Host-side data dir holding the journal and artifacts. */
  readonly dataDir: string;
  /** Where worktrees go, in the filesystem agy runs in. */
  readonly worktreeRoot: string;
  /** Where the plan schema is written, in the filesystem agy runs in. */
  readonly schemaPath: string;
  readonly baseEnv: Readonly<Record<string, string | undefined>>;
  readonly runTurn: (
    inv: Invocation,
    options: RunOptions
  ) => Promise<TurnOutcome>;
  /** Refuses (throws AGY_QUOTA_LOW / AGY_QUOTA_UNKNOWN) before a model turn. */
  readonly quotaGate: (profile: TurnProfile, journal: Journal) => Promise<void>;
  readonly toolPermission?: string;
  readonly allowCommands: readonly string[];
  readonly sandboxVerified: boolean;
  readonly printTimeoutSeconds: number;
  /** Our own deadline; a little longer than printTimeoutSeconds. */
  readonly deadlineMs: number;
  readonly newId?: () => string;
  /**
   * The grant every mutating call is checked and charged against, inside
   * the reservation's locked write. The CLI always sets it.
   */
  readonly grantId?: string;
  readonly now?: () => Date;
  readonly ownerPid?: number;
  readonly isAlive?: (pid: number | undefined) => boolean;
}

export interface Outcome {
  readonly ok: boolean;
  readonly code?: AgyErrorCode;
  readonly localId: string;
  readonly state: TaskState;
  readonly requiresAttention: boolean;
  readonly attention: readonly string[];
  readonly conversationId?: string;
  readonly plan?: Plan;
  readonly response?: string;
  readonly question?: string;
  readonly deniedActions?: readonly unknown[];
  readonly finishedReason?: string;
}

const MAX_RESPONSE_BYTES = 16 * 1024;

function defaultId(): string {
  return `agy-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
}

function joinHost(host: Host, ...parts: string[]): string {
  return host.kind === 'wsl-bridge'
    ? path.posix.join(...parts)
    : path.join(...parts);
}

function outcomeOf(task: Task, extra: Partial<Outcome> = {}): Outcome {
  return {
    ok: extra.code === undefined,
    localId: task.localId,
    state: task.state,
    requiresAttention: task.requiresAttention,
    attention: [],
    ...(task.conversationId === undefined
      ? {}
      : { conversationId: task.conversationId }),
    ...(isPlan(task.plan) ? { plan: task.plan } : {}),
    ...extra,
  };
}

/** True while `worktree` is still a git work tree. */
async function isWorktree(exec: HostExec, worktree: string): Promise<boolean> {
  try {
    const res = await exec.git(['rev-parse', '--is-inside-work-tree'], {
      cwd: worktree,
    });
    return res.code === 0 && res.stdout.trim() === 'true';
  } catch {
    return false;
  }
}

/** Every string inside `value` redacted, shape kept (agy-written data). */
function redactDeep<T>(value: T): T {
  if (typeof value === 'string') return redact(value) as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, redactDeep(v)])
    ) as T;
  }
  return value;
}

/** HEAD of `worktree` when it has `refs/heads/<branch>` checked out. */
async function ownBranchHead(
  exec: HostExec,
  worktree: string,
  branch: string
): Promise<string | undefined> {
  try {
    const ref = await exec.git(['symbolic-ref', '--quiet', 'HEAD'], {
      cwd: worktree,
    });
    if (ref.code !== 0 || ref.stdout.trim() !== `refs/heads/${branch}`) {
      return undefined;
    }
    const head = await exec.git(['rev-parse', '--verify', 'HEAD'], {
      cwd: worktree,
    });
    return head.code === 0 ? head.stdout.trim() : undefined;
  } catch {
    return undefined;
  }
}

export class Lifecycle {
  private readonly deps: LifecycleDeps;
  private readonly ownerPid: number;
  private readonly alive: (pid: number | undefined) => boolean;
  /** Request ids whose agy turn spawned in this process. */
  private readonly spawned = new Set<string>();

  constructor(deps: LifecycleDeps) {
    this.deps = deps;
    this.ownerPid = deps.ownerPid ?? process.pid;
    this.alive = deps.isAlive ?? isPidAlive;
  }

  private readOnly(): TurnProfile {
    return readOnlyProfile(
      this.deps.toolPermission === undefined
        ? {}
        : { toolPermission: this.deps.toolPermission }
    );
  }

  private implement(): TurnProfile {
    return implementProfile({
      ...(this.deps.toolPermission === undefined
        ? {}
        : { toolPermission: this.deps.toolPermission }),
      allowCommands: this.deps.allowCommands,
      sandboxVerified: this.deps.sandboxVerified,
    });
  }

  /** Settles a claim whose owner died. Runs under the lock. */
  private async settleStale(j: Journal): Promise<Journal> {
    const claim = j.activeRun;
    if (claim === undefined) return j;
    if (this.alive(claim.ownerPid) || this.alive(claim.childPid)) return j;
    let next = withoutClaim(j);
    const task = own(j.tasks, claim.localId);
    const at = nowIso();
    // A recorded child pid means agy started, so the turn counts.
    if (claim.childPid !== undefined) {
      next = {
        ...next,
        usage: [
          ...next.usage,
          { at, localId: claim.localId, requestId: claim.requestId },
        ],
      };
    }
    if (claim.op === 'collect') {
      // collect changes nothing but artifacts; a retry rewrites them.
      return dropRequest(next, claim.requestId);
    }
    if (claim.op === 'abandon' && task !== undefined) {
      if (await isWorktree(this.deps.exec, task.worktree)) {
        // Removal never happened: the task is as it was; retry abandon.
        return dropRequest(next, claim.requestId);
      }
      const { partial: _p, ...rest } = task;
      void _p;
      const done: Task = { ...rest, state: 'ABANDONED', updatedAt: at };
      next = putTask(next, done);
      return putRequest(next, {
        requestId: claim.requestId,
        op: claim.op,
        localId: claim.localId,
        status: 'done',
        outcome: outcomeOf(done),
        at,
      });
    }
    if (claim.op === 'delegate' && task === undefined) {
      const pending = own(j.requests, claim.requestId);
      const meta = pending?.outcome as
        | { worktree?: string; branch?: string; repo?: string; base?: string }
        | undefined;
      if (meta?.worktree !== undefined && meta.repo !== undefined) {
        // A crash between createWorktree and the journal write leaves no
        // base recorded. No turn has run then, so the worktree's HEAD, read
        // only while it still has our branch checked out, is the base.
        let base = meta.base;
        if (base === undefined && meta.branch !== undefined) {
          base = await ownBranchHead(
            this.deps.exec,
            meta.worktree,
            meta.branch
          );
        }
        // A thrown removal (repo gone, spawn failure) is judged like a
        // nonzero exit: fine once the orphan no longer exists.
        const removed = await this.deps.exec
          .git(['worktree', 'remove', '--force', '--', meta.worktree], {
            cwd: meta.repo,
          })
          .catch((err: unknown) => ({ code: -1, stderr: String(err) }));
        // Fail closed: keep the claim while the orphan still exists.
        if (
          removed.code !== 0 &&
          (await isWorktree(this.deps.exec, meta.worktree))
        ) {
          throw new AgyError(
            'AGY_WORKTREE',
            `an interrupted delegate left ${meta.worktree}, and removing it failed: ${removed.stderr.trim()}`,
            `Run git worktree remove --force -- ${meta.worktree} in ${meta.repo}, then retry.`
          );
        }
        if (meta.branch !== undefined && base !== undefined) {
          await deleteBranchIfEmpty(
            this.deps.exec,
            meta.repo,
            meta.branch,
            base
          ).catch(() => false);
        }
      }
      next = putRequest(next, {
        requestId: claim.requestId,
        op: claim.op,
        localId: claim.localId,
        status: 'done',
        outcome: {
          ok: false,
          code: 'AGY_INTERRUPTED',
          localId: claim.localId,
          state: 'FAILED',
          requiresAttention: true,
          attention: ['the delegate was interrupted before its first turn'],
        } satisfies Outcome,
        at,
      });
      return next;
    }
    if (task !== undefined) {
      const settled: Task = {
        ...task,
        state:
          task.state === 'PLAN_PENDING' && !task.approved
            ? 'PLAN_PENDING'
            : 'INTERRUPTED',
        requiresAttention: true,
        ...(claim.snapshot === undefined ? {} : { partial: claim.snapshot }),
        updatedAt: at,
      };
      next = putTask(next, settled);
      next = putRequest(next, {
        requestId: claim.requestId,
        op: claim.op,
        localId: claim.localId,
        status: 'done',
        outcome: outcomeOf(settled, {
          code: 'AGY_INTERRUPTED',
          requiresAttention: true,
        }),
        at,
      });
    }
    return next;
  }

  /**
   * Reserves `requestId` and the active-run claim. Returns the recorded
   * outcome instead when the request already finished.
   */
  private async reserve(
    requestId: string,
    op: Operation,
    localId: string,
    check: (j: Journal) => void,
    meta?: Record<string, string>,
    scope?: { readonly repo: string; readonly branch: string },
    correction?: boolean
  ): Promise<{ replay?: Outcome; journal: Journal }> {
    // Settle a dead claim in its own write, so a refusal below can't discard
    // the settlement.
    await updateJournal(this.deps.dataDir, async (j) => ({
      journal: await this.settleStale(j),
      result: undefined,
    }));
    return updateJournal<{ replay?: Outcome; journal: Journal }>(
      this.deps.dataDir,
      async (j0) => {
        const j = await this.settleStale(j0);
        const prior = own(j.requests, requestId);
        if (prior !== undefined) {
          if (prior.op !== op) {
            throw new AgyError(
              'AGY_INVALID_INPUT',
              `request id ${requestId} was used for ${prior.op}`
            );
          }
          if (prior.status === 'done') {
            return {
              journal: j,
              result: { replay: prior.outcome as Outcome, journal: j },
            };
          }
          throw new AgyError(
            'AGY_BUSY',
            `request ${requestId} is still running`
          );
        }
        if (j.activeRun !== undefined) {
          throw new AgyError(
            'AGY_BUSY',
            `a ${j.activeRun.op} run on ${j.activeRun.localId} is live`
          );
        }
        check(j);
        const charged = this.authorize(j, op, localId, scope, correction);
        const claim: Claim = {
          requestId,
          op,
          localId,
          ownerPid: this.ownerPid,
          startedAt: nowIso(),
        };
        const next = putRequest(
          { ...charged, activeRun: claim },
          {
            requestId,
            op,
            localId,
            status: 'pending',
            at: claim.startedAt,
            ...(meta === undefined ? {} : { outcome: meta }),
          }
        );
        return { journal: next, result: { journal: next } };
      }
    );
  }

  /** Checks the request against the grant and charges it. */
  private authorize(
    j: Journal,
    op: Operation,
    localId: string,
    scope: { readonly repo: string; readonly branch: string } | undefined,
    correction: boolean | undefined
  ): Journal {
    const grantId = this.deps.grantId;
    // Abandon is owner-confirmed on the terminal instead, and must work
    // after a grant expires.
    if (grantId === undefined || op === 'abandon') return j;
    const task = op === 'delegate' ? undefined : getTask(j, localId);
    const repo = scope?.repo ?? task?.repo ?? '';
    const branch = scope?.branch ?? task?.branch ?? '';
    return authorizeRequest(
      j,
      grantId,
      {
        op,
        repo,
        branch,
        ...(task === undefined ? {} : { task }),
        ...(correction === undefined ? {} : { correction }),
      },
      (this.deps.now ?? (() => new Date()))()
    );
  }

  /**
   * Drops the claim and the pending request: a refusal with no turn. A
   * delegate refused before its worktree existed gets its task back.
   */
  private release(requestId: string): Promise<void> {
    return updateJournal(this.deps.dataDir, (j) => {
      const rec = own(j.requests, requestId);
      const { [requestId]: _gone, ...requests } = j.requests;
      void _gone;
      let next = j.activeRun?.requestId === requestId ? withoutClaim(j) : j;
      const grantId = this.deps.grantId;
      if (rec?.op === 'delegate' && grantId !== undefined) {
        const g = requireGrant(next, grantId);
        if (g.totalTasks > 0)
          next = putGrant(next, { ...g, totalTasks: g.totalTasks - 1 });
      }
      return { journal: { ...next, requests }, result: undefined };
    });
  }

  private patchClaim(requestId: string, patch: Partial<Claim>): Promise<void> {
    return updateJournal(this.deps.dataDir, (j) => {
      if (j.activeRun?.requestId !== requestId)
        return { journal: j, result: undefined };
      return {
        journal: { ...j, activeRun: { ...j.activeRun, ...patch } },
        result: undefined,
      };
    });
  }

  private async turn(
    requestId: string,
    worktree: string,
    prompt: string,
    profile: TurnProfile,
    conversationId: string | undefined,
    withSchema: boolean
  ): Promise<TurnClass> {
    if (withSchema) {
      await this.deps.exec.writeFile(
        this.deps.schemaPath,
        `${JSON.stringify(PLAN_SCHEMA)}\n`
      );
    }
    const args = turnArgs({
      prompt,
      profile,
      printTimeoutSeconds: this.deps.printTimeoutSeconds,
      ...(conversationId === undefined ? {} : { conversationId }),
      ...(withSchema ? { jsonSchemaPath: this.deps.schemaPath } : {}),
    });
    const inv = buildInvocation(this.deps.host, args, {
      cwd: worktree,
      baseEnv: this.deps.baseEnv,
      filterDrivers: await this.deps.exec.filterDrivers(worktree),
    });
    const outcome = await this.deps.runTurn(inv, {
      deadlineMs: this.deps.deadlineMs,
      // Durable before the turn can settle: if the owner dies, the claim
      // still names a live agy. A failed write stops the turn.
      onSpawn: (pid) => {
        this.spawned.add(requestId);
        return this.patchClaim(requestId, { childPid: pid });
      },
    });
    return classifyTurn(outcome);
  }

  /** Writes the settled task and request, journals usage, drops the claim. */
  private settle(
    requestId: string,
    op: Operation,
    task: Task,
    outcome: Outcome
  ): Promise<Outcome> {
    return updateJournal(this.deps.dataDir, (j) => {
      let next = withoutClaim(putTask(j, task));
      next = putRequest(next, {
        requestId,
        op,
        localId: task.localId,
        status: 'done',
        outcome,
        at: nowIso(),
      });
      // Only a turn that actually started counts against the quota window.
      if (this.spawned.delete(requestId)) {
        next = {
          ...next,
          usage: [
            ...next.usage,
            { at: nowIso(), localId: task.localId, requestId },
          ],
        };
      }
      return { journal: next, result: outcome };
    });
  }

  /**
   * Builds the turn's profile and passes the quota gate, releasing the
   * reservation if either refuses. Runs before any worktree change.
   */
  private async prepare(
    requestId: string,
    build: () => TurnProfile
  ): Promise<TurnProfile> {
    try {
      const profile = build();
      await this.deps.quotaGate(profile, readJournal(this.deps.dataDir));
      return profile;
    } catch (err) {
      await this.release(requestId);
      throw err;
    }
  }

  async delegate(input: {
    readonly requestId: string;
    readonly branch: string;
    readonly prompt: string;
    readonly repo: string;
    readonly remote: string;
    readonly baseBranch: string;
  }): Promise<Outcome> {
    const localId = (this.deps.newId ?? defaultId)();
    const worktree = joinHost(this.deps.host, this.deps.worktreeRoot, localId);
    const res = await this.reserve(
      input.requestId,
      'delegate',
      localId,
      () => undefined,
      {
        worktree,
        branch: input.branch,
        repo: input.repo,
      },
      { repo: input.repo, branch: input.branch }
    );
    if (res.replay !== undefined) return res.replay;
    // Build (and so validate) the turn's argv before any git side effect,
    // so a bad prompt is refused without a branch or worktree left behind.
    const profile = await this.prepare(input.requestId, () => {
      const p = this.readOnly();
      buildInvocation(
        this.deps.host,
        turnArgs({
          prompt: input.prompt,
          profile: p,
          printTimeoutSeconds: this.deps.printTimeoutSeconds,
          jsonSchemaPath: this.deps.schemaPath,
        }),
        { cwd: worktree, baseEnv: this.deps.baseEnv, filterDrivers: [] }
      );
      return p;
    });
    let base: string;
    try {
      base = await createWorktree(this.deps.exec, {
        repo: input.repo,
        worktree,
        branch: input.branch,
        remote: input.remote,
        baseBranch: input.baseBranch,
      });
    } catch (err) {
      await this.release(input.requestId);
      throw err;
    }
    await updateJournal(this.deps.dataDir, (j) => {
      const rec = own(j.requests, input.requestId);
      if (rec === undefined) return { journal: j, result: undefined };
      return {
        journal: putRequest(j, {
          ...rec,
          outcome: { worktree, branch: input.branch, repo: input.repo, base },
        }),
        result: undefined,
      };
    });
    const at = nowIso();
    const draft: Task = {
      localId,
      branch: input.branch,
      repo: input.repo,
      worktree,
      base,
      state: 'FAILED',
      approved: false,
      correctiveRounds: 0,
      requiresAttention: true,
      ...(this.deps.grantId === undefined
        ? {}
        : { grantId: this.deps.grantId }),
      createdAt: at,
      updatedAt: at,
    };
    let cls: TurnClass;
    try {
      cls = await this.turn(
        input.requestId,
        worktree,
        input.prompt,
        profile,
        undefined,
        true
      );
    } catch (err) {
      const code = err instanceof AgyError ? err.code : 'AGY_INTERNAL';
      return this.settle(
        input.requestId,
        'delegate',
        draft,
        outcomeOf(draft, { code, attention: [truncateRedacted(String(err))] })
      );
    }
    return this.settlePlanTurn(input.requestId, 'delegate', draft, cls, true);
  }

  private settlePlanTurn(
    requestId: string,
    op: Operation,
    task: Task,
    cls: TurnClass,
    passedSchema: boolean
  ): Promise<Outcome> {
    const result = 'result' in cls ? cls.result : undefined;
    const conversationId = result?.conversation_id ?? task.conversationId;
    const attention: string[] = [];
    const at = nowIso();
    // A plan turn that timed out or was interrupted produced no plan to
    // trust; it is a failure with its own code, not a PLAN_PENDING success.
    const failed =
      cls.kind === 'AUTH_REQUIRED' ||
      cls.kind === 'QUOTA' ||
      cls.kind === 'MODEL_ERROR' ||
      cls.kind === 'TIMED_OUT' ||
      cls.kind === 'INTERRUPTED';
    if (failed || conversationId === undefined) {
      const code = failed ? codeFor(cls) : 'AGY_MODEL_ERROR';
      // A failed reply keeps the task as it was; a failed delegate is FAILED.
      const next: Task =
        op === 'delegate'
          ? { ...task, state: 'FAILED', updatedAt: at }
          : { ...task, updatedAt: at };
      return this.settle(
        requestId,
        op,
        next,
        outcomeOf(next, { code, attention: detailOf(cls) })
      );
    }
    let plan = task.plan;
    if (passedSchema) {
      const out =
        result === undefined ? undefined : structuredOutput(result, true);
      // The conversation has moved past the old plan, so a turn that asked
      // for a plan and got none leaves nothing to approve.
      // Stored in the journal and shown to the owner: redact agy's text.
      plan = isPlan(out) ? redactDeep(out) : undefined;
      if (plan === undefined)
        attention.push(
          'agy returned no valid plan; reply with --correction to ask for one'
        );
    }
    if (cls.kind !== 'OK') attention.push(attentionFor(cls));
    const { plan: _old, ...base } = task;
    void _old;
    const next: Task = {
      ...base,
      state: 'PLAN_PENDING',
      conversationId,
      ...(plan === undefined ? {} : { plan }),
      requiresAttention: attention.length > 0,
      ...(cls.kind === 'UNVERIFIED' && cls.finishedReason !== undefined
        ? { lastFinishedReason: redact(cls.finishedReason) }
        : {}),
      updatedAt: at,
    };
    return this.settle(
      requestId,
      op,
      next,
      outcomeOf(next, extrasOf(cls, result, attention))
    );
  }

  private async settleImplementTurn(
    requestId: string,
    op: Operation,
    task: Task,
    snapshot: PartialSnapshot,
    cls: TurnClass
  ): Promise<Outcome> {
    const result = 'result' in cls ? cls.result : undefined;
    const at = nowIso();
    const base = { ...task, approved: true, updatedAt: at };
    const conversationId = result?.conversation_id ?? task.conversationId;
    const withConv =
      conversationId === undefined ? base : { ...base, conversationId };
    const attention: string[] = [];
    let next: Task;
    let code: AgyErrorCode | undefined;
    switch (cls.kind) {
      case 'OK':
      case 'UNVERIFIED': {
        const question = needsInput(result?.response);
        if (question !== undefined)
          attention.push(`agy needs input: ${redact(question)}`);
        if (cls.kind === 'UNVERIFIED') attention.push(attentionFor(cls));
        next = {
          ...withConv,
          state: 'IMPLEMENTED',
          requiresAttention: attention.length > 0,
        };
        break;
      }
      case 'DENIED':
        attention.push(attentionFor(cls));
        next = { ...withConv, state: 'DENIED', requiresAttention: true };
        break;
      case 'TIMED_OUT':
      case 'INTERRUPTED':
        code = cls.kind === 'TIMED_OUT' ? 'AGY_TIMEOUT' : 'AGY_INTERRUPTED';
        attention.push(
          'partial edits may be in the worktree; retry with --keep-partial or --reset-partial'
        );
        next = {
          ...withConv,
          state: cls.kind,
          requiresAttention: true,
          partial: snapshot,
        };
        break;
      default:
        code = codeFor(cls);
        attention.push(
          ...detailOf(cls),
          'edits from the failed turn may be in the worktree; retry with --keep-partial or --reset-partial'
        );
        // The task keeps its pre-turn state; a failed approve stays unapproved.
        next = {
          ...task,
          updatedAt: at,
          requiresAttention: true,
          partial: snapshot,
        };
    }
    if (next.partial === undefined) {
      const { partial: _p, ...rest } = next;
      void _p;
      next = rest;
    }
    const extras = extrasOf(cls, result, attention);
    const outcome = outcomeOf(
      next,
      code === undefined ? extras : { ...extras, code }
    );
    if (next.partial === undefined) {
      // Drop the snapshot refs while the claim is still held, so a command
      // that starts after the release can't have its own refs removed.
      // Best effort: stale refs only pin objects until the next snapshot.
      await dropSnapshotRefs(this.deps.exec, task.worktree, task.localId).catch(
        () => undefined
      );
    }
    return this.settle(requestId, op, next, outcome);
  }

  /** Applies --keep-partial / --reset-partial, or refuses when neither was given. */
  private async resolvePartial(
    task: Task,
    keep: boolean,
    reset: boolean
  ): Promise<Task> {
    if (task.partial === undefined) return task;
    if (keep === reset) {
      throw new AgyError(
        'AGY_WORKTREE',
        `task ${task.localId} has partial edits from an unfinished turn`,
        'Review the worktree, then retry with --keep-partial or --reset-partial.'
      );
    }
    if (reset)
      await resetToSnapshot(
        this.deps.exec,
        task.worktree,
        task.localId,
        task.partial
      );
    else await dropSnapshotRefs(this.deps.exec, task.worktree, task.localId);
    const { partial: _p, ...rest } = task;
    void _p;
    return rest;
  }

  private async implementTurn(
    requestId: string,
    op: Operation,
    task: Task,
    prompt: string,
    profile: TurnProfile
  ): Promise<Outcome> {
    const fullPrompt = `${prompt}\n\n${NEEDS_INPUT_INSTRUCTION}`;
    let snapshot: PartialSnapshot;
    try {
      // Refuse a prompt whose argv is invalid or too long before the
      // snapshot and claim change anything.
      buildInvocation(
        this.deps.host,
        turnArgs({
          prompt: fullPrompt,
          profile,
          printTimeoutSeconds: this.deps.printTimeoutSeconds,
          ...(task.conversationId === undefined
            ? {}
            : { conversationId: task.conversationId }),
        }),
        { cwd: task.worktree, baseEnv: this.deps.baseEnv, filterDrivers: [] }
      );
      const s = await snapshotWorktree(
        this.deps.exec,
        task.worktree,
        task.localId
      );
      snapshot = { head: s.head, commit: s.commit, indexTree: s.indexTree };
      await this.patchClaim(requestId, { snapshot });
    } catch (err) {
      await this.release(requestId);
      throw err;
    }
    let cls: TurnClass;
    try {
      cls = await this.turn(
        requestId,
        task.worktree,
        fullPrompt,
        profile,
        task.conversationId,
        false
      );
    } catch (err) {
      const code = err instanceof AgyError ? err.code : 'AGY_INTERNAL';
      const next: Task = {
        ...task,
        partial: snapshot,
        requiresAttention: true,
        updatedAt: nowIso(),
      };
      return this.settle(
        requestId,
        op,
        next,
        outcomeOf(next, { code, attention: [truncateRedacted(String(err))] })
      );
    }
    return this.settleImplementTurn(requestId, op, task, snapshot, cls);
  }

  async approve(input: {
    readonly requestId: string;
    readonly localId: string;
    readonly keepPartial?: boolean;
    readonly resetPartial?: boolean;
  }): Promise<Outcome> {
    const res = await this.reserve(
      input.requestId,
      'approve',
      input.localId,
      (j) => {
        const t = getTask(j, input.localId);
        if (t.state !== 'PLAN_PENDING' || t.approved) {
          throw new AgyError(
            'AGY_INVALID_INPUT',
            `task ${t.localId} is ${t.state}; approve needs PLAN_PENDING`
          );
        }
        if (!isPlan(t.plan)) {
          throw new AgyError(
            'AGY_INVALID_INPUT',
            `task ${t.localId} has no valid plan to approve`,
            'Reply with --correction to get a plan first.'
          );
        }
      }
    );
    if (res.replay !== undefined) return res.replay;
    const profile = await this.prepare(input.requestId, () => this.implement());
    let task: Task;
    try {
      task = await this.resolvePartial(
        getTask(res.journal, input.localId),
        input.keepPartial === true,
        input.resetPartial === true
      );
    } catch (err) {
      await this.release(input.requestId);
      throw err;
    }
    return this.implementTurn(
      input.requestId,
      'approve',
      task,
      'Implement the approved plan.',
      profile
    );
  }

  async reply(input: {
    readonly requestId: string;
    readonly localId: string;
    readonly message: string;
    readonly correction?: boolean;
    readonly keepPartial?: boolean;
    readonly resetPartial?: boolean;
  }): Promise<Outcome> {
    const res = await this.reserve(
      input.requestId,
      'reply',
      input.localId,
      (j) => {
        const t = getTask(j, input.localId);
        if (
          t.state === 'FAILED' ||
          t.state === 'ABANDONED' ||
          t.conversationId === undefined
        ) {
          throw new AgyError(
            'AGY_INVALID_INPUT',
            `task ${t.localId} is ${t.state}; there is no conversation to reply to`
          );
        }
      },
      undefined,
      undefined,
      input.correction === true
    );
    if (res.replay !== undefined) return res.replay;
    const approved = getTask(res.journal, input.localId).approved;
    const profile = await this.prepare(input.requestId, () =>
      approved ? this.implement() : this.readOnly()
    );
    let task: Task;
    try {
      task = await this.resolvePartial(
        getTask(res.journal, input.localId),
        input.keepPartial === true,
        input.resetPartial === true
      );
    } catch (err) {
      await this.release(input.requestId);
      throw err;
    }
    if (input.correction === true)
      task = { ...task, correctiveRounds: task.correctiveRounds + 1 };
    if (task.approved)
      return this.implementTurn(
        input.requestId,
        'reply',
        task,
        input.message,
        profile
      );
    const withSchema = input.correction === true;
    let cls: TurnClass;
    try {
      cls = await this.turn(
        input.requestId,
        task.worktree,
        input.message,
        profile,
        task.conversationId,
        withSchema
      );
    } catch (err) {
      const code = err instanceof AgyError ? err.code : 'AGY_INTERNAL';
      return this.settle(
        input.requestId,
        'reply',
        task,
        outcomeOf(task, { code, attention: [truncateRedacted(String(err))] })
      );
    }
    return this.settlePlanTurn(input.requestId, 'reply', task, cls, withSchema);
  }

  /**
   * Writes the patches under artifacts/<localId>/, removing any whose new
   * content is empty, so a stale patch never outlives the edits it showed.
   */
  private writePatches(
    localId: string,
    got: { readonly commits: Buffer; readonly uncommitted: Buffer }
  ): { commitsPatch?: string; uncommittedPatch?: string } {
    const dir = path.join(this.deps.dataDir, 'artifacts', localId);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const write = (name: string, text: Buffer): string | undefined => {
      const file = path.join(dir, name);
      if (text.length === 0) {
        fs.rmSync(file, { force: true });
        return undefined;
      }
      fs.writeFileSync(file, text, { mode: 0o600 });
      return file;
    };
    const commitsPatch = write('commits.patch', got.commits);
    const uncommittedPatch = write('uncommitted.patch', got.uncommitted);
    return {
      ...(commitsPatch === undefined ? {} : { commitsPatch }),
      ...(uncommittedPatch === undefined ? {} : { uncommittedPatch }),
    };
  }

  /** Writes the task's patches under artifacts/<localId>/. Needs no live run. */
  async collect(localId: string): Promise<{
    readonly localId: string;
    readonly commitsPatch?: string;
    readonly uncommittedPatch?: string;
    readonly commitCount: number;
    readonly secretShapedContent: boolean;
    readonly requiresAttention: boolean;
  }> {
    // Holds the active-run claim until the artifacts are written, so no
    // turn or abandon can change the worktree or the patches underneath.
    const requestId = `collect-${randomBytes(8).toString('hex')}`;
    const res = await this.reserve(requestId, 'collect', localId, (j) => {
      const t = getTask(j, localId);
      if (t.state === 'ABANDONED') {
        throw new AgyError(
          'AGY_INVALID_INPUT',
          `task ${localId} was abandoned; its last collect is in artifacts/${localId}`
        );
      }
    });
    const task = getTask(res.journal, localId);
    let got: Awaited<ReturnType<typeof collectWorktree>>;
    let written: { commitsPatch?: string; uncommittedPatch?: string };
    try {
      got = await collectWorktree(
        this.deps.exec,
        task.worktree,
        localId,
        task.base
      );
      written = this.writePatches(localId, got);
    } finally {
      await this.release(requestId);
    }
    const { commitsPatch, uncommittedPatch } = written;
    const secret =
      scanSecretShapes(got.commits) || scanSecretShapes(got.uncommitted);
    return {
      localId,
      ...(commitsPatch === undefined ? {} : { commitsPatch }),
      ...(uncommittedPatch === undefined ? {} : { uncommittedPatch }),
      commitCount: got.commitCount,
      secretShapedContent: secret,
      requiresAttention: secret,
    };
  }

  /** Collects, removes the worktree and keeps the branch. */
  async abandon(input: {
    readonly requestId: string;
    readonly localId: string;
  }): Promise<Outcome> {
    const res = await this.reserve(
      input.requestId,
      'abandon',
      input.localId,
      (j) => {
        const t = getTask(j, input.localId);
        if (t.state === 'ABANDONED')
          throw new AgyError(
            'AGY_INVALID_INPUT',
            `task ${t.localId} is already abandoned`
          );
      }
    );
    if (res.replay !== undefined) return res.replay;
    // collect refuses while a claim on this task is live; ours is not a run.
    const task = getTask(res.journal, input.localId);
    let attention: string[] = [];
    try {
      const got = await collectWorktree(
        this.deps.exec,
        task.worktree,
        task.localId,
        task.base
      );
      this.writePatches(task.localId, got);
      if (scanSecretShapes(got.commits) || scanSecretShapes(got.uncommitted)) {
        attention = ['the collected patches contain secret-shaped content'];
      }
      await dropSnapshotRefs(this.deps.exec, task.worktree, task.localId);
      await removeWorktree(this.deps.exec, task.repo, task.worktree);
    } catch (err) {
      await this.release(input.requestId);
      throw err;
    }
    const { partial: _p, ...rest } = task;
    void _p;
    const next: Task = {
      ...rest,
      state: 'ABANDONED',
      requiresAttention: attention.length > 0,
      updatedAt: nowIso(),
    };
    return updateJournal(this.deps.dataDir, (j) => {
      const outcome = outcomeOf(next, { attention });
      let n = withoutClaim(putTask(j, next));
      n = putRequest(n, {
        requestId: input.requestId,
        op: 'abandon',
        localId: next.localId,
        status: 'done',
        outcome,
        at: nowIso(),
      });
      return { journal: n, result: outcome };
    });
  }

  status(localId?: string): readonly Task[] {
    const j = readJournal(this.deps.dataDir);
    if (localId !== undefined) return [getTask(j, localId)];
    return Object.values(j.tasks).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt)
    );
  }
}

function codeFor(cls: TurnClass): AgyErrorCode {
  switch (cls.kind) {
    case 'AUTH_REQUIRED':
      return 'AGY_AUTH_REQUIRED';
    case 'QUOTA':
      return 'AGY_QUOTA';
    case 'TIMED_OUT':
      return 'AGY_TIMEOUT';
    case 'INTERRUPTED':
      return 'AGY_INTERRUPTED';
    default:
      return 'AGY_MODEL_ERROR';
  }
}

function detailOf(cls: TurnClass): string[] {
  return cls.kind === 'MODEL_ERROR' ? [truncateRedacted(cls.detail)] : [];
}

function attentionFor(cls: TurnClass): string {
  switch (cls.kind) {
    case 'DENIED':
      return `agy was denied ${cls.deniedActions.length} action(s); reply with a narrower request or widen the grant`;
    case 'UNVERIFIED':
      return `agy finished with an unrecognized finished_reason ${JSON.stringify(cls.finishedReason)}; review the output`;
    case 'TIMED_OUT':
      return 'the turn timed out';
    case 'INTERRUPTED':
      return 'the turn was interrupted';
    default:
      return `the turn ended as ${cls.kind}`;
  }
}

function extrasOf(
  cls: TurnClass,
  result: AgyResult | undefined,
  attention: string[]
): Partial<Outcome> {
  const response =
    typeof result?.response === 'string'
      ? truncateRedacted(result.response, MAX_RESPONSE_BYTES)
      : undefined;
  const question = needsInput(result?.response);
  return {
    attention,
    requiresAttention: attention.length > 0,
    ...(response === undefined ? {} : { response }),
    ...(question === undefined ? {} : { question: redact(question) }),
    ...(cls.kind === 'DENIED'
      ? { deniedActions: redactDeep(cls.deniedActions) }
      : {}),
    ...(cls.kind === 'UNVERIFIED' && cls.finishedReason !== undefined
      ? { finishedReason: redact(cls.finishedReason) }
      : {}),
  };
}
