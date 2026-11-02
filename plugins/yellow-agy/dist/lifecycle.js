"use strict";
/**
 * The delegate lifecycle (contract-v0 "Run lifecycle" and "Reservations,
 * retries and recovery"): delegate → approve → reply, then collect or
 * abandon. Every mutating call reserves its request id and the single
 * active-run claim under the journal lock, runs the agy turn outside the
 * lock, and settles under the lock again. All side effects come in through
 * LifecycleDeps, so tests run real git with a fake agy.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Lifecycle = void 0;
const node_crypto_1 = require("node:crypto");
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const classify_1 = require("./classify");
const errors_1 = require("./errors");
const invocation_1 = require("./invocation");
const plan_schema_1 = require("./plan-schema");
const profiles_1 = require("./profiles");
const redact_1 = require("./redact");
const state_1 = require("./state");
const worktree_1 = require("./worktree");
const MAX_RESPONSE_BYTES = 16 * 1024;
function defaultId() {
    return `agy-${Date.now().toString(36)}-${(0, node_crypto_1.randomBytes)(4).toString('hex')}`;
}
function joinHost(host, ...parts) {
    return host.kind === 'wsl-bridge'
        ? path.posix.join(...parts)
        : path.join(...parts);
}
function outcomeOf(task, extra = {}) {
    return {
        ok: extra.code === undefined,
        localId: task.localId,
        state: task.state,
        requiresAttention: task.requiresAttention,
        attention: [],
        ...(task.conversationId === undefined
            ? {}
            : { conversationId: task.conversationId }),
        ...((0, plan_schema_1.isPlan)(task.plan) ? { plan: task.plan } : {}),
        ...extra,
    };
}
class Lifecycle {
    deps;
    ownerPid;
    alive;
    constructor(deps) {
        this.deps = deps;
        this.ownerPid = deps.ownerPid ?? process.pid;
        this.alive = deps.isAlive ?? state_1.isPidAlive;
    }
    readOnly() {
        return (0, profiles_1.readOnlyProfile)(this.deps.toolPermission === undefined
            ? {}
            : { toolPermission: this.deps.toolPermission });
    }
    implement() {
        return (0, profiles_1.implementProfile)({
            ...(this.deps.toolPermission === undefined
                ? {}
                : { toolPermission: this.deps.toolPermission }),
            allowCommands: this.deps.allowCommands,
            sandboxVerified: this.deps.sandboxVerified,
        });
    }
    /** Settles a claim whose owner died. Runs under the lock. */
    async settleStale(j) {
        const claim = j.activeRun;
        if (claim === undefined)
            return j;
        if (this.alive(claim.ownerPid) || this.alive(claim.childPid))
            return j;
        let next = (0, state_1.withoutClaim)(j);
        const task = j.tasks[claim.localId];
        const at = (0, state_1.nowIso)();
        if (claim.op === 'delegate' && task === undefined) {
            const pending = j.requests[claim.requestId];
            const meta = pending?.outcome;
            if (meta?.worktree !== undefined && meta.repo !== undefined) {
                await this.deps.exec.git(['worktree', 'remove', '--force', '--', meta.worktree], { cwd: meta.repo });
                if (meta.branch !== undefined && meta.base !== undefined) {
                    await (0, worktree_1.deleteBranchIfEmpty)(this.deps.exec, meta.repo, meta.branch, meta.base).catch(() => false);
                }
            }
            next = (0, state_1.putRequest)(next, {
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
            const settled = {
                ...task,
                state: task.state === 'PLAN_PENDING' && !task.approved
                    ? 'PLAN_PENDING'
                    : 'INTERRUPTED',
                requiresAttention: true,
                ...(claim.snapshot === undefined ? {} : { partial: claim.snapshot }),
                updatedAt: at,
            };
            next = (0, state_1.putTask)(next, settled);
            next = (0, state_1.putRequest)(next, {
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
    async reserve(requestId, op, localId, check, meta) {
        return (0, state_1.updateJournal)(this.deps.dataDir, async (j0) => {
            const j = await this.settleStale(j0);
            const prior = j.requests[requestId];
            if (prior !== undefined) {
                if (prior.op !== op) {
                    throw new errors_1.AgyError('AGY_INVALID_INPUT', `request id ${requestId} was used for ${prior.op}`);
                }
                if (prior.status === 'done') {
                    return {
                        journal: j,
                        result: { replay: prior.outcome, journal: j },
                    };
                }
                throw new errors_1.AgyError('AGY_BUSY', `request ${requestId} is still running`);
            }
            if (j.activeRun !== undefined) {
                throw new errors_1.AgyError('AGY_BUSY', `a ${j.activeRun.op} run on ${j.activeRun.localId} is live`);
            }
            check(j);
            const claim = {
                requestId,
                op,
                localId,
                ownerPid: this.ownerPid,
                startedAt: (0, state_1.nowIso)(),
            };
            const next = (0, state_1.putRequest)({ ...j, activeRun: claim }, {
                requestId,
                op,
                localId,
                status: 'pending',
                at: claim.startedAt,
                ...(meta === undefined ? {} : { outcome: meta }),
            });
            return { journal: next, result: { journal: next } };
        });
    }
    /** Drops the claim and the pending request: a refusal with no turn. */
    release(requestId) {
        return (0, state_1.updateJournal)(this.deps.dataDir, (j) => {
            const { [requestId]: _gone, ...requests } = j.requests;
            void _gone;
            const next = j.activeRun?.requestId === requestId ? (0, state_1.withoutClaim)(j) : j;
            return { journal: { ...next, requests }, result: undefined };
        });
    }
    patchClaim(requestId, patch) {
        return (0, state_1.updateJournal)(this.deps.dataDir, (j) => {
            if (j.activeRun?.requestId !== requestId)
                return { journal: j, result: undefined };
            return {
                journal: { ...j, activeRun: { ...j.activeRun, ...patch } },
                result: undefined,
            };
        });
    }
    async turn(requestId, worktree, prompt, profile, conversationId, withSchema) {
        if (withSchema) {
            await this.deps.exec.writeFile(this.deps.schemaPath, `${JSON.stringify(plan_schema_1.PLAN_SCHEMA)}\n`);
        }
        const args = (0, profiles_1.turnArgs)({
            prompt,
            profile,
            printTimeoutSeconds: this.deps.printTimeoutSeconds,
            ...(conversationId === undefined ? {} : { conversationId }),
            ...(withSchema ? { jsonSchemaPath: this.deps.schemaPath } : {}),
        });
        const inv = (0, invocation_1.buildInvocation)(this.deps.host, args, {
            cwd: worktree,
            baseEnv: this.deps.baseEnv,
        });
        const outcome = await this.deps.runTurn(inv, {
            deadlineMs: this.deps.deadlineMs,
            onSpawn: (pid) => {
                // Best effort: the owner pid already holds the claim.
                this.patchClaim(requestId, { childPid: pid }).catch(() => undefined);
            },
        });
        return (0, classify_1.classifyTurn)(outcome);
    }
    /** Writes the settled task and request, journals usage, drops the claim. */
    settle(requestId, op, task, outcome) {
        return (0, state_1.updateJournal)(this.deps.dataDir, (j) => {
            let next = (0, state_1.withoutClaim)((0, state_1.putTask)(j, task));
            next = (0, state_1.putRequest)(next, {
                requestId,
                op,
                localId: task.localId,
                status: 'done',
                outcome,
                at: (0, state_1.nowIso)(),
            });
            next = {
                ...next,
                usage: [
                    ...next.usage,
                    { at: (0, state_1.nowIso)(), localId: task.localId, requestId },
                ],
            };
            return { journal: next, result: outcome };
        });
    }
    async gate(profile, requestId) {
        try {
            await this.deps.quotaGate(profile, (0, state_1.readJournal)(this.deps.dataDir));
        }
        catch (err) {
            await this.release(requestId);
            throw err;
        }
    }
    async delegate(input) {
        const localId = (this.deps.newId ?? defaultId)();
        const worktree = joinHost(this.deps.host, this.deps.worktreeRoot, localId);
        const res = await this.reserve(input.requestId, 'delegate', localId, () => undefined, {
            worktree,
            branch: input.branch,
            repo: input.repo,
        });
        if (res.replay !== undefined)
            return res.replay;
        const profile = this.readOnly();
        await this.gate(profile, input.requestId);
        let base;
        try {
            base = await (0, worktree_1.createWorktree)(this.deps.exec, {
                repo: input.repo,
                worktree,
                branch: input.branch,
                remote: input.remote,
                baseBranch: input.baseBranch,
            });
        }
        catch (err) {
            await this.release(input.requestId);
            throw err;
        }
        await (0, state_1.updateJournal)(this.deps.dataDir, (j) => {
            const rec = j.requests[input.requestId];
            if (rec === undefined)
                return { journal: j, result: undefined };
            return {
                journal: (0, state_1.putRequest)(j, {
                    ...rec,
                    outcome: { worktree, branch: input.branch, repo: input.repo, base },
                }),
                result: undefined,
            };
        });
        const at = (0, state_1.nowIso)();
        const draft = {
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
        let cls;
        try {
            cls = await this.turn(input.requestId, worktree, input.prompt, profile, undefined, true);
        }
        catch (err) {
            const code = err instanceof errors_1.AgyError ? err.code : 'AGY_INTERNAL';
            return this.settle(input.requestId, 'delegate', draft, outcomeOf(draft, { code, attention: [(0, redact_1.truncateRedacted)(String(err))] }));
        }
        return this.settlePlanTurn(input.requestId, 'delegate', draft, cls, true);
    }
    settlePlanTurn(requestId, op, task, cls, passedSchema) {
        const result = 'result' in cls ? cls.result : undefined;
        const conversationId = result?.conversation_id ?? task.conversationId;
        const attention = [];
        const at = (0, state_1.nowIso)();
        const failed = cls.kind === 'AUTH_REQUIRED' ||
            cls.kind === 'QUOTA' ||
            cls.kind === 'MODEL_ERROR';
        if (failed || conversationId === undefined) {
            const code = failed ? codeFor(cls) : 'AGY_MODEL_ERROR';
            // A failed reply keeps the task as it was; a failed delegate is FAILED.
            const next = op === 'delegate'
                ? { ...task, state: 'FAILED', updatedAt: at }
                : { ...task, updatedAt: at };
            return this.settle(requestId, op, next, outcomeOf(next, { code, attention: detailOf(cls) }));
        }
        let plan = task.plan;
        if (passedSchema) {
            const out = result === undefined ? undefined : (0, classify_1.structuredOutput)(result, true);
            if ((0, plan_schema_1.isPlan)(out))
                plan = out;
            else
                attention.push('agy returned no valid plan; reply with --correction to ask for one');
        }
        if (cls.kind !== 'OK')
            attention.push(attentionFor(cls));
        const next = {
            ...task,
            state: 'PLAN_PENDING',
            conversationId,
            ...(plan === undefined ? {} : { plan }),
            requiresAttention: attention.length > 0,
            ...(cls.kind === 'UNVERIFIED' && cls.finishedReason !== undefined
                ? { lastFinishedReason: cls.finishedReason }
                : {}),
            updatedAt: at,
        };
        return this.settle(requestId, op, next, outcomeOf(next, extrasOf(cls, result, attention)));
    }
    settleImplementTurn(requestId, op, task, snapshot, cls) {
        const result = 'result' in cls ? cls.result : undefined;
        const at = (0, state_1.nowIso)();
        const base = { ...task, approved: true, updatedAt: at };
        const conversationId = result?.conversation_id ?? task.conversationId;
        const withConv = conversationId === undefined ? base : { ...base, conversationId };
        const attention = [];
        let next;
        let code;
        switch (cls.kind) {
            case 'OK':
            case 'UNVERIFIED': {
                const question = (0, classify_1.needsInput)(result?.response);
                if (question !== undefined)
                    attention.push(`agy needs input: ${(0, redact_1.redact)(question)}`);
                if (cls.kind === 'UNVERIFIED')
                    attention.push(attentionFor(cls));
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
                attention.push('partial edits may be in the worktree; retry with --keep-partial or --reset-partial');
                next = {
                    ...withConv,
                    state: cls.kind,
                    requiresAttention: true,
                    partial: snapshot,
                };
                break;
            default:
                code = codeFor(cls);
                attention.push(...detailOf(cls), 'edits from the failed turn may be in the worktree; retry with --keep-partial or --reset-partial');
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
        const outcome = outcomeOf(next, code === undefined ? extras : { ...extras, code });
        const settled = this.settle(requestId, op, next, outcome);
        if (next.partial !== undefined)
            return settled;
        return settled.then(async (o) => {
            await (0, worktree_1.dropSnapshotRefs)(this.deps.exec, task.worktree, task.localId);
            return o;
        });
    }
    /** Applies --keep-partial / --reset-partial, or refuses when neither was given. */
    async resolvePartial(task, keep, reset) {
        if (task.partial === undefined)
            return task;
        if (keep === reset) {
            throw new errors_1.AgyError('AGY_WORKTREE', `task ${task.localId} has partial edits from an unfinished turn`, 'Review the worktree, then retry with --keep-partial or --reset-partial.');
        }
        if (reset)
            await (0, worktree_1.resetToSnapshot)(this.deps.exec, task.worktree, task.localId, task.partial);
        else
            await (0, worktree_1.dropSnapshotRefs)(this.deps.exec, task.worktree, task.localId);
        const { partial: _p, ...rest } = task;
        void _p;
        return rest;
    }
    async implementTurn(requestId, op, task, prompt) {
        const profile = this.implement();
        await this.gate(profile, requestId);
        let snapshot;
        try {
            const s = await (0, worktree_1.snapshotWorktree)(this.deps.exec, task.worktree, task.localId);
            snapshot = { head: s.head, commit: s.commit, indexTree: s.indexTree };
            await this.patchClaim(requestId, { snapshot });
        }
        catch (err) {
            await this.release(requestId);
            throw err;
        }
        let cls;
        try {
            cls = await this.turn(requestId, task.worktree, prompt, profile, task.conversationId, false);
        }
        catch (err) {
            const code = err instanceof errors_1.AgyError ? err.code : 'AGY_INTERNAL';
            const next = {
                ...task,
                partial: snapshot,
                requiresAttention: true,
                updatedAt: (0, state_1.nowIso)(),
            };
            return this.settle(requestId, op, next, outcomeOf(next, { code, attention: [(0, redact_1.truncateRedacted)(String(err))] }));
        }
        return this.settleImplementTurn(requestId, op, task, snapshot, cls);
    }
    async approve(input) {
        const res = await this.reserve(input.requestId, 'approve', input.localId, (j) => {
            const t = (0, state_1.getTask)(j, input.localId);
            if (t.state !== 'PLAN_PENDING' || t.approved) {
                throw new errors_1.AgyError('AGY_INVALID_INPUT', `task ${t.localId} is ${t.state}; approve needs PLAN_PENDING`);
            }
            if (!(0, plan_schema_1.isPlan)(t.plan)) {
                throw new errors_1.AgyError('AGY_INVALID_INPUT', `task ${t.localId} has no valid plan to approve`, 'Reply with --correction to get a plan first.');
            }
        });
        if (res.replay !== undefined)
            return res.replay;
        let task;
        try {
            task = await this.resolvePartial((0, state_1.getTask)(res.journal, input.localId), input.keepPartial === true, input.resetPartial === true);
        }
        catch (err) {
            await this.release(input.requestId);
            throw err;
        }
        return this.implementTurn(input.requestId, 'approve', task, 'Implement the approved plan.');
    }
    async reply(input) {
        const res = await this.reserve(input.requestId, 'reply', input.localId, (j) => {
            const t = (0, state_1.getTask)(j, input.localId);
            if (t.state === 'FAILED' ||
                t.state === 'ABANDONED' ||
                t.conversationId === undefined) {
                throw new errors_1.AgyError('AGY_INVALID_INPUT', `task ${t.localId} is ${t.state}; there is no conversation to reply to`);
            }
        });
        if (res.replay !== undefined)
            return res.replay;
        let task;
        try {
            task = await this.resolvePartial((0, state_1.getTask)(res.journal, input.localId), input.keepPartial === true, input.resetPartial === true);
        }
        catch (err) {
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
        let cls;
        try {
            cls = await this.turn(input.requestId, task.worktree, input.message, profile, task.conversationId, withSchema);
        }
        catch (err) {
            const code = err instanceof errors_1.AgyError ? err.code : 'AGY_INTERNAL';
            return this.settle(input.requestId, 'reply', task, outcomeOf(task, { code, attention: [(0, redact_1.truncateRedacted)(String(err))] }));
        }
        return this.settlePlanTurn(input.requestId, 'reply', task, cls, withSchema);
    }
    /** Writes the task's patches under artifacts/<localId>/. Needs no live run. */
    async collect(localId) {
        const j = (0, state_1.readJournal)(this.deps.dataDir);
        const task = (0, state_1.getTask)(j, localId);
        if (j.activeRun?.localId === localId &&
            (this.alive(j.activeRun.ownerPid) || this.alive(j.activeRun.childPid))) {
            throw new errors_1.AgyError('AGY_BUSY', `a run on ${localId} is live`);
        }
        if (task.state === 'ABANDONED') {
            throw new errors_1.AgyError('AGY_INVALID_INPUT', `task ${localId} was abandoned; its last collect is in artifacts/${localId}`);
        }
        const got = await (0, worktree_1.collectWorktree)(this.deps.exec, task.worktree, localId, task.base);
        const dir = path.join(this.deps.dataDir, 'artifacts', localId);
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        const write = (name, text) => {
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
        const secret = (0, redact_1.scanSecretShapes)(got.commits) || (0, redact_1.scanSecretShapes)(got.uncommitted);
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
    async abandon(input) {
        const res = await this.reserve(input.requestId, 'abandon', input.localId, (j) => {
            const t = (0, state_1.getTask)(j, input.localId);
            if (t.state === 'ABANDONED')
                throw new errors_1.AgyError('AGY_INVALID_INPUT', `task ${t.localId} is already abandoned`);
        });
        if (res.replay !== undefined)
            return res.replay;
        // collect refuses while a claim on this task is live; ours is not a run.
        const task = (0, state_1.getTask)(res.journal, input.localId);
        let attention = [];
        try {
            const got = await (0, worktree_1.collectWorktree)(this.deps.exec, task.worktree, task.localId, task.base);
            const dir = path.join(this.deps.dataDir, 'artifacts', task.localId);
            fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
            if (got.commits !== '')
                fs.writeFileSync(path.join(dir, 'commits.patch'), got.commits, {
                    mode: 0o600,
                });
            if (got.uncommitted !== '')
                fs.writeFileSync(path.join(dir, 'uncommitted.patch'), got.uncommitted, {
                    mode: 0o600,
                });
            if ((0, redact_1.scanSecretShapes)(got.commits) || (0, redact_1.scanSecretShapes)(got.uncommitted)) {
                attention = ['the collected patches contain secret-shaped content'];
            }
            await (0, worktree_1.dropSnapshotRefs)(this.deps.exec, task.worktree, task.localId);
            await (0, worktree_1.removeWorktree)(this.deps.exec, task.repo, task.worktree);
        }
        catch (err) {
            await this.release(input.requestId);
            throw err;
        }
        const { partial: _p, ...rest } = task;
        void _p;
        const next = {
            ...rest,
            state: 'ABANDONED',
            requiresAttention: attention.length > 0,
            updatedAt: (0, state_1.nowIso)(),
        };
        return (0, state_1.updateJournal)(this.deps.dataDir, (j) => {
            const outcome = outcomeOf(next, { attention });
            let n = (0, state_1.withoutClaim)((0, state_1.putTask)(j, next));
            n = (0, state_1.putRequest)(n, {
                requestId: input.requestId,
                op: 'abandon',
                localId: next.localId,
                status: 'done',
                outcome,
                at: (0, state_1.nowIso)(),
            });
            return { journal: n, result: outcome };
        });
    }
    status(localId) {
        const j = (0, state_1.readJournal)(this.deps.dataDir);
        if (localId !== undefined)
            return [(0, state_1.getTask)(j, localId)];
        return Object.values(j.tasks).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }
}
exports.Lifecycle = Lifecycle;
function codeFor(cls) {
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
function detailOf(cls) {
    return cls.kind === 'MODEL_ERROR' ? [(0, redact_1.truncateRedacted)(cls.detail)] : [];
}
function attentionFor(cls) {
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
function extrasOf(cls, result, attention) {
    const response = typeof result?.response === 'string'
        ? (0, redact_1.truncateRedacted)(result.response, MAX_RESPONSE_BYTES)
        : undefined;
    const question = (0, classify_1.needsInput)(result?.response);
    return {
        attention,
        requiresAttention: attention.length > 0,
        ...(response === undefined ? {} : { response }),
        ...(question === undefined ? {} : { question: (0, redact_1.redact)(question) }),
        ...(cls.kind === 'DENIED' ? { deniedActions: cls.deniedActions } : {}),
        ...(cls.kind === 'UNVERIFIED' && cls.finishedReason !== undefined
            ? { finishedReason: cls.finishedReason }
            : {}),
    };
}
