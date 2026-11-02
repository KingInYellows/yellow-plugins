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
import { classifyTurn, needsInput, structuredOutput } from './classify';
import type { AgyErrorCode } from './errors';
import { AgyError } from './errors';
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
  getTask,
  isPidAlive,
  nowIso,
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

export class Lifecycle {
  private readonly deps: LifecycleDeps;
  private readonly ownerPid: number;
  private readonly alive: (pid: number | undefined) => boolean;

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
    const task = j.tasks[claim.localId];
    const at = nowIso();
    if (claim.op === 'delegate' && task === undefined) {
      const pending = j.requests[claim.requestId];
      const meta = pending?.outcome as
        | { worktree?: string; branch?: string; repo?: string; base?: string }
        | undefined;
      if (meta?.worktree !== undefined && meta.repo !== undefined) {
        await this.deps.exec.git(
          ['worktree', 'remove', '--force', '--', meta.worktree],
          { cwd: meta.repo }
        );
        if (meta.branch !== undefined && meta.base !== undefined) {
          await deleteBranchIfEmpty(
            this.deps.exec,
            meta.repo,
            meta.branch,
            meta.base
          ).catch(() => false);
        }
      }
      next = putRequest(next, {
        requestId: claim.requestId,
        op: claim.op,
        localId: claim.localId,
        status: 'done',
        outcome: { ok: false, code: 'AGY_INTERRUPTED', localId: claim.localId },
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
    meta?: Record<string, string>
  ): Promise<{ replay?: Outcome; journal: Journal }> {
    return updateJournal<{ replay?: Outcome; journal: Journal }>(
      this.deps.dataDir,
      async (j0) => {
        const j = await this.settleStale(j0);
        const prior = j.requests[requestId];
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
        const claim: Claim = {
          requestId,
          op,
          localId,
          ownerPid: this.ownerPid,
          startedAt: nowIso(),
        };
        const next = putRequest(
          { ...j, activeRun: claim },
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

  /** Drops the claim and the pending request: a refusal with no turn. */
  private release(requestId: string): Promise<void> {
    return updateJournal(this.deps.dataDir, (j) => {
      const { [requestId]: _gone, ...requests } = j.requests;
      void _gone;
      const next = j.activeRun?.requestId === requestId ? withoutClaim(j) : j;
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
      onSpawn: (pid) => {
        // Best effort: the owner pid already holds the claim.
        this.patchClaim(requestId, { childPid: pid }).catch(() => undefined);
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
      next = {
        ...next,
        usage: [
          ...next.usage,
          { at: nowIso(), localId: task.localId, requestId },
        ],
      };
      return { journal: next, result: outcome };
    });
  }

  private async gate(profile: TurnProfile, requestId: string): Promise<void> {
    try {
      await this.deps.quotaGate(profile, readJournal(this.deps.dataDir));
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
      }
    );
    if (res.replay !== undefined) return res.replay;
    const profile = this.readOnly();
    await this.gate(profile, input.requestId);
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
      const rec = j.requests[input.requestId];
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
    const failed =
      cls.kind === 'AUTH_REQUIRED' ||
      cls.kind === 'QUOTA' ||
      cls.kind === 'MODEL_ERROR';
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
      plan = isPlan(out) ? out : undefined;
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
        ? { lastFinishedReason: cls.finishedReason }
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

  private settleImplementTurn(
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
    const settled = this.settle(requestId, op, next, outcome);
    if (next.partial !== undefined) return settled;
    return settled.then(async (o) => {
      await dropSnapshotRefs(this.deps.exec, task.worktree, task.localId);
      return o;
    });
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
    prompt: string
  ): Promise<Outcome> {
    const profile = this.implement();
    await this.gate(profile, requestId);
    let snapshot: PartialSnapshot;
    try {
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
        prompt,
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
      'Implement the approved plan.'
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
      }
    );
    if (res.replay !== undefined) return res.replay;
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
      return this.implementTurn(input.requestId, 'reply', task, input.message);
    const profile = this.readOnly();
    await this.gate(profile, input.requestId);
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
    got: { readonly commits: string; readonly uncommitted: string }
  ): { commitsPatch?: string; uncommittedPatch?: string } {
    const dir = path.join(this.deps.dataDir, 'artifacts', localId);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const write = (name: string, text: string): string | undefined => {
      const file = path.join(dir, name);
      if (text === '') {
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
    const j = readJournal(this.deps.dataDir);
    const task = getTask(j, localId);
    if (
      j.activeRun?.localId === localId &&
      (this.alive(j.activeRun.ownerPid) || this.alive(j.activeRun.childPid))
    ) {
      throw new AgyError('AGY_BUSY', `a run on ${localId} is live`);
    }
    if (task.state === 'ABANDONED') {
      throw new AgyError(
        'AGY_INVALID_INPUT',
        `task ${localId} was abandoned; its last collect is in artifacts/${localId}`
      );
    }
    const got = await collectWorktree(
      this.deps.exec,
      task.worktree,
      localId,
      task.base
    );
    const { commitsPatch, uncommittedPatch } = this.writePatches(localId, got);
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
    ...(cls.kind === 'DENIED' ? { deniedActions: cls.deniedActions } : {}),
    ...(cls.kind === 'UNVERIFIED' && cls.finishedReason !== undefined
      ? { finishedReason: cls.finishedReason }
      : {}),
  };
}
