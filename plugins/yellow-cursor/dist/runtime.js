"use strict";
/**
 * Operation layer: one exported async function per CLI subcommand, each
 * taking a RuntimeDeps bag (SdkAdapter injected for tests) plus its own
 * validated-or-throwing args. cli.ts is the only caller — it owns argv
 * parsing, the JSON envelope, and exit codes; this module owns the business
 * rules (confirmation gates, idempotency, retries, state reconciliation).
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
exports.REAL_CLOCK = void 0;
exports.setup = setup;
exports.delegate = delegate;
exports.followUp = followUp;
exports.status = status;
exports.list = list;
exports.cancel = cancel;
exports.archive = archive;
exports.unarchive = unarchive;
exports.artifacts = artifacts;
exports.usage = usage;
const fs = __importStar(require("node:fs"));
const config_js_1 = require("./config.js");
const config_js_2 = require("./config.js");
const errors_js_1 = require("./errors.js");
const sdk_resolver_js_1 = require("./sdk-resolver.js");
const state_js_1 = require("./state.js");
const validate_js_1 = require("./validate.js");
exports.REAL_CLOCK = {
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
function nowIso(deps) {
    return new Date(deps.clock.now()).toISOString();
}
async function withRetry(fn, clock, maxRetries = 2, baseDelayMs = 500) {
    let attempt = 0;
    for (;;) {
        try {
            return await fn();
        }
        catch (err) {
            if (err instanceof errors_js_1.AdapterError &&
                err.isRetryable &&
                attempt < maxRetries) {
                const delay = baseDelayMs * 2 ** attempt;
                attempt += 1;
                await clock.sleep(delay);
                continue;
            }
            throw err;
        }
    }
}
/**
 * send() is the real create/auth point for cloud agents (create() is lazy).
 * A retryable failure here is safe to retry (same idempotencyKey dedups
 * server-side); after retries are exhausted, an ambiguous failure kind
 * (network/malformed/unknown — we can't tell if the run was actually
 * created) is reported as CURSOR_UNKNOWN_OUTCOME rather than its normal
 * code, so the caller knows to reconcile instead of assuming failure.
 */
async function sendWithOutcomeTracking(handle, prompt, idempotencyKey, clock) {
    try {
        return await withRetry(() => handle.send(prompt, { idempotencyKey }), clock);
    }
    catch (err) {
        if (err instanceof errors_js_1.AdapterError &&
            (err.kind === 'service_unavailable' ||
                err.kind === 'malformed_response' ||
                err.kind === 'unknown')) {
            return (0, errors_js_1.throwAppError)('CURSOR_UNKNOWN_OUTCOME', err.message, err.requestId !== undefined ? { requestId: err.requestId } : {});
        }
        throw err;
    }
}
/** Safety bound on remote pagination sweeps, so a huge account can't hang a launch. */
const MAX_LIST_PAGES = 5;
/**
 * Counts running cloud agents for `repoUrl`, and FAILS CLOSED if the account
 * has more pages than MAX_LIST_PAGES: an undercount here would authorize a
 * billable launch past the user's --max-active cap, so an incomplete sweep is
 * reported as a concurrency refusal rather than treated as "not at the cap".
 */
async function countActiveAgentsForRepo(adapter, repoUrl, maxActive) {
    let count = 0;
    let cursor;
    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
        const result = await adapter.listAgents({
            includeArchived: false,
            ...(cursor !== undefined ? { cursor } : {}),
        });
        count += result.items.filter((item) => item.repository === repoUrl && item.status === 'running').length;
        if (result.nextCursor === undefined)
            return count;
        cursor = result.nextCursor;
    }
    // recoveryAction is overridden because the catalog default ("raise
    // --max-active") is actively wrong here: this branch throws before any count
    // exists to compare the cap against, so raising it can never clear the error.
    return (0, errors_js_1.throwAppError)('CURSOR_CONCURRENCY_LIMIT', `could not confirm the active-agent count for ${repoUrl}: the cloud agent listing still had more pages after ${MAX_LIST_PAGES}, so the max-active=${maxActive} cap cannot be enforced safely.`, {
        recoveryAction: 'Archive agents you no longer need (/cursor:archive removes them from this listing) until it fits within the page bound. Raising --max-active does not help here.',
    });
}
async function readHealthyIndex(stateFilePath) {
    const result = await (0, state_js_1.readIndex)(stateFilePath);
    (0, state_js_1.throwIfQuarantined)(result);
    return result.index;
}
async function touchLocalRecordForAgent(deps, agentId, status) {
    const index = await readHealthyIndex(deps.stateFilePath);
    const existing = (0, state_js_1.findByAgentId)(index, agentId);
    if (!existing)
        return;
    await (0, state_js_1.upsertRecord)(deps.stateFilePath, {
        ...existing,
        status,
        updatedAt: nowIso(deps),
    });
}
async function setup(deps, args) {
    let installed;
    if (args.installSdk) {
        const result = await (0, sdk_resolver_js_1.installSdk)(deps.dataDir);
        installed = { runtimeDir: result.runtimeDir };
    }
    const sdkResolution = (0, sdk_resolver_js_1.probeSdkResolutionState)(deps.dataDir);
    if (sdkResolution === 'missing') {
        return {
            operation: 'setup',
            credentialSource: (0, config_js_1.hasEnvApiKey)(deps.env) ? 'env' : 'none',
            sdkResolution,
            modelsCount: { supported: false, reason: 'SDK not installed' },
            ...(installed !== undefined ? { installed } : {}),
        };
    }
    const probe = await deps.adapter.probeSetup();
    const credentialSource = (0, config_js_1.hasEnvApiKey)(deps.env)
        ? 'env'
        : probe.me !== undefined
            ? 'stored-login'
            : 'none';
    return {
        operation: 'setup',
        credentialSource,
        sdkResolution,
        modelsCount: probe.modelsCount ?? {
            supported: false,
            reason: 'not probed',
        },
        ...(probe.me !== undefined ? { me: probe.me } : {}),
        ...(installed !== undefined ? { installed } : {}),
    };
}
async function delegate(deps, args) {
    const repoUrl = (0, validate_js_1.validateRepoUrl)(args.repoUrl);
    const startingRef = args.startingRef !== undefined ? (0, validate_js_1.validateRef)(args.startingRef) : undefined;
    const model = (0, validate_js_1.validateModelId)(args.model);
    const prompt = (0, validate_js_1.validatePrompt)(args.prompt);
    const idempotencyKey = (0, validate_js_1.validateIdempotencyKey)(args.idempotencyKey);
    const maxActive = (0, validate_js_1.validateMaxActive)(args.maxActive);
    if (args.dryRun) {
        return {
            operation: 'delegate',
            dryRun: true,
            idempotencyKey,
            repository: repoUrl,
            ...(startingRef !== undefined ? { startingRef } : {}),
            ...(model !== undefined ? { model } : {}),
        };
    }
    if (!args.yes) {
        (0, errors_js_1.throwAppError)('CURSOR_CONFIRMATION_REQUIRED', 'delegate requires --yes to confirm.');
    }
    if (deps.env['YELLOW_REMOTE_AGENT_CONTEXT']) {
        (0, errors_js_1.throwAppError)('CURSOR_NESTED_DELEGATION', 'refusing to delegate from inside a remote agent run.');
    }
    const promptDigest = (0, state_js_1.digestPrompt)(prompt);
    const reservation = {
        repository: repoUrl,
        status: 'pending-launch',
        createdAt: nowIso(deps),
        updatedAt: nowIso(deps),
        idempotencyKey,
        promptDigest,
        ...(startingRef !== undefined ? { startingRef } : {}),
        ...(model !== undefined ? { model } : {}),
        ...(args.linearIssue !== undefined
            ? { linearIssue: args.linearIssue }
            : {}),
        ...(args.callingHost !== undefined
            ? { callingHost: args.callingHost }
            : {}),
    };
    await (0, state_js_1.withStateLock)(deps.stateFilePath, async () => {
        const readResult = await (0, state_js_1.readIndex)(deps.stateFilePath);
        (0, state_js_1.throwIfQuarantined)(readResult);
        const existing = (0, state_js_1.findByIdempotencyKey)(readResult.index, idempotencyKey);
        if (existing && !(0, state_js_1.isTerminalStatus)(existing.status)) {
            (0, errors_js_1.throwAppError)('CURSOR_DUPLICATE_LAUNCH', `an operation with idempotency key "${idempotencyKey}" is already in flight (status: ${existing.status}).`);
        }
    });
    const remoteActive = await countActiveAgentsForRepo(deps.adapter, repoUrl, maxActive);
    await (0, state_js_1.withStateLock)(deps.stateFilePath, async () => {
        const readResult = await (0, state_js_1.readIndex)(deps.stateFilePath);
        (0, state_js_1.throwIfQuarantined)(readResult);
        const existing = (0, state_js_1.findByIdempotencyKey)(readResult.index, idempotencyKey);
        if (existing && !(0, state_js_1.isTerminalStatus)(existing.status)) {
            (0, errors_js_1.throwAppError)('CURSOR_DUPLICATE_LAUNCH', `an operation with idempotency key "${idempotencyKey}" is already in flight (status: ${existing.status}).`);
        }
        const localPending = (0, state_js_1.countLocalPendingReservationsForRepo)(readResult.index, repoUrl);
        if (remoteActive + localPending >= maxActive) {
            (0, errors_js_1.throwAppError)('CURSOR_CONCURRENCY_LIMIT', `${remoteActive + localPending} active agent slot(s) already reserved or running for ${repoUrl} (max-active=${maxActive}).`);
        }
        await (0, state_js_1.upsertRecordUnderLock)(deps.stateFilePath, reservation);
    });
    // Hoisted so the catch block can tell "createAgent() itself failed" (handle
    // never assigned) apart from "createAgent() succeeded but send() failed"
    // (handle assigned) — both must terminal-mark the reservation, but only the
    // latter has an agentId to record.
    let handle;
    try {
        handle = await deps.adapter.createAgent({
            repoUrl,
            autoCreatePR: args.autoCreatePr,
            idempotencyKey,
            ...(startingRef !== undefined ? { startingRef } : {}),
            ...(model !== undefined ? { model } : {}),
        });
        const run = await sendWithOutcomeTracking(handle, prompt, idempotencyKey, deps.clock);
        const canonicalAgentId = await resolveCanonicalAgentId(deps, handle.agentId, run, idempotencyKey);
        const branch = run.branches[0];
        await (0, state_js_1.upsertRecord)(deps.stateFilePath, {
            ...reservation,
            agentId: canonicalAgentId,
            runId: run.id,
            status: run.status,
            updatedAt: nowIso(deps),
            ...(run.requestId !== undefined ? { requestId: run.requestId } : {}),
            ...(branch?.branch !== undefined ? { targetBranch: branch.branch } : {}),
            ...(branch?.prUrl !== undefined ? { prUrl: branch.prUrl } : {}),
        });
        return {
            operation: 'delegate',
            idempotencyKey,
            agentId: canonicalAgentId,
            runId: run.id,
            status: run.status,
            repository: repoUrl,
            ...(run.requestId !== undefined ? { requestId: run.requestId } : {}),
            ...(startingRef !== undefined ? { startingRef } : {}),
            ...(branch?.branch !== undefined ? { targetBranch: branch.branch } : {}),
            ...(branch?.prUrl !== undefined ? { pullRequestUrl: branch.prUrl } : {}),
            ...(model !== undefined ? { model } : {}),
        };
    }
    catch (err) {
        const failedStatus = err instanceof errors_js_1.AppErrorException &&
            err.appError.code === 'CURSOR_UNKNOWN_OUTCOME'
            ? 'unknown'
            : 'error';
        // Terminal-mark the reservation regardless of WHERE it failed — a
        // createAgent() failure never got an agentId; a send() failure did.
        // Either way this makes the idempotencyKey non-terminal-free so a
        // same-key retry is allowed instead of permanently hitting
        // CURSOR_DUPLICATE_LAUNCH against a reservation nothing will ever advance.
        await (0, state_js_1.upsertRecord)(deps.stateFilePath, {
            ...reservation,
            ...(handle !== undefined ? { agentId: handle.agentId } : {}),
            status: failedStatus,
            updatedAt: nowIso(deps),
        });
        throw err;
    }
}
/**
 * The SDK's cloud Agent.create() mints a client-side PROVISIONAL agent id;
 * the server assigns the CANONICAL id when the first send() actually creates
 * the agent remotely. Live-verified 2026-08-22: Agent.get/getRun/list 404'd
 * the provisional id while the real agent existed under a different id.
 * Resolution order:
 *   1. the send() run's own agentId, when the server populated it with
 *      something different from the provisional id;
 *   2. reconciliation through the cloud agent list by the
 *      metadata.yellowIdempotencyKey marker this CLI stamps on every agent
 *      it creates (live-verified to read back);
 *   3. never return the provisional id — it 404s on Agent.get/getRun/list.
 *      A failed reconciliation after a billable send() is CURSOR_UNKNOWN_OUTCOME
 *      so the caller reconciles via list metadata instead of persisting a dead id.
 *
 * CURSOR_UNKNOWN_OUTCOME is deliberately NOT a claim that the launch failed —
 * it is the "launched, but this CLI cannot name the agent" outcome, and its
 * recovery action is `status --reconcile` rather than "relaunch". Reporting
 * that is strictly better than returning ok:true with a provisional id that
 * every subsequent follow-up/cancel/status call would 404 on, so do not
 * "simplify" this into a best-effort fallback that persists the provisional id.
 */
async function resolveCanonicalAgentId(deps, provisionalId, run, idempotencyKey) {
    if (run.agentId !== '' && run.agentId !== provisionalId) {
        return run.agentId;
    }
    try {
        let cursor;
        for (let page = 0; page < MAX_LIST_PAGES; page++) {
            // includeArchived: reconciliation must still find an agent that was
            // archived between the send() and this sweep.
            const res = await deps.adapter.listAgents({
                includeArchived: true,
                ...(cursor !== undefined ? { cursor } : {}),
            });
            const match = res.items.find((a) => a.metadata['yellowIdempotencyKey'] === idempotencyKey);
            if (match !== undefined)
                return match.agentId;
            if (res.nextCursor === undefined)
                break;
            cursor = res.nextCursor;
        }
    }
    catch {
        // fall through to UNKNOWN_OUTCOME — provisional id is not usable
    }
    return (0, errors_js_1.throwAppError)('CURSOR_UNKNOWN_OUTCOME', 'launch succeeded but the canonical agent id could not be resolved; run list or status --reconcile.');
}
async function followUp(deps, args) {
    const agentId = (0, validate_js_1.validateAgentId)(args.agentId);
    const prompt = (0, validate_js_1.validatePrompt)(args.prompt);
    const idempotencyKey = (0, validate_js_1.validateIdempotencyKey)(args.idempotencyKey);
    if (!args.yes) {
        (0, errors_js_1.throwAppError)('CURSOR_CONFIRMATION_REQUIRED', 'follow-up requires --yes to confirm.');
    }
    if (deps.env['YELLOW_REMOTE_AGENT_CONTEXT']) {
        (0, errors_js_1.throwAppError)('CURSOR_NESTED_DELEGATION', 'refusing to send a follow-up from inside a remote agent run.');
    }
    const info = await deps.adapter.getAgent(agentId);
    if (info.archived) {
        (0, errors_js_1.throwAppError)('CURSOR_INVALID_INPUT', `agent ${agentId} is archived; unarchive it before sending a follow-up.`);
    }
    const handle = await deps.adapter.resumeAgent(agentId);
    const run = await sendWithOutcomeTracking(handle, prompt, idempotencyKey, deps.clock);
    const branch = run.branches[0];
    const index = await readHealthyIndex(deps.stateFilePath);
    const existing = (0, state_js_1.findByAgentId)(index, agentId);
    await (0, state_js_1.upsertRecord)(deps.stateFilePath, {
        repository: info.repository ?? existing?.repository ?? '',
        idempotencyKey,
        createdAt: existing?.createdAt ?? nowIso(deps),
        ...existing,
        agentId,
        runId: run.id,
        status: run.status,
        updatedAt: nowIso(deps),
        ...(run.requestId !== undefined ? { requestId: run.requestId } : {}),
        ...(branch?.branch !== undefined ? { targetBranch: branch.branch } : {}),
        ...(branch?.prUrl !== undefined ? { prUrl: branch.prUrl } : {}),
    });
    return {
        operation: 'follow-up',
        idempotencyKey,
        agentId,
        runId: run.id,
        status: run.status,
        ...(run.requestId !== undefined ? { requestId: run.requestId } : {}),
        ...(branch?.branch !== undefined ? { targetBranch: branch.branch } : {}),
        ...(branch?.prUrl !== undefined ? { pullRequestUrl: branch.prUrl } : {}),
    };
}
async function status(deps, args) {
    const agentId = (0, validate_js_1.validateAgentId)(args.agentId);
    const info = await deps.adapter.getAgent(agentId);
    let run;
    if (args.runId !== undefined) {
        const runId = (0, validate_js_1.validateRunId)(args.runId);
        run = await deps.adapter.getRun(runId, agentId);
    }
    const index = await readHealthyIndex(deps.stateFilePath);
    const localRecord = (0, state_js_1.findByAgentId)(index, agentId);
    const idempotencyKey = localRecord?.idempotencyKey ?? info.metadata['yellowIdempotencyKey'];
    let drift;
    if ((args.reconcile || localRecord !== undefined) &&
        idempotencyKey !== undefined) {
        const agentStatus = info.status ?? localRecord?.status ?? 'unknown';
        drift =
            localRecord !== undefined &&
                info.status !== undefined &&
                localRecord.status !== info.status;
        const branch = run?.branches[0];
        await (0, state_js_1.upsertRecord)(deps.stateFilePath, {
            repository: info.repository ?? localRecord?.repository ?? '',
            createdAt: localRecord?.createdAt ?? nowIso(deps),
            ...localRecord,
            agentId: info.agentId,
            idempotencyKey,
            status: agentStatus,
            updatedAt: nowIso(deps),
            ...(run !== undefined ? { runId: run.id } : {}),
            ...(branch?.branch !== undefined ? { targetBranch: branch.branch } : {}),
            ...(branch?.prUrl !== undefined ? { prUrl: branch.prUrl } : {}),
        });
    }
    const branch = run?.branches[0];
    return {
        operation: 'status',
        agentId,
        archived: info.archived,
        ...(info.status !== undefined ? { agentStatus: info.status } : {}),
        ...(info.repository !== undefined ? { repository: info.repository } : {}),
        ...(run !== undefined
            ? {
                run: {
                    id: run.id,
                    status: run.status,
                    ...(run.requestId !== undefined
                        ? { requestId: run.requestId }
                        : {}),
                    ...(branch?.branch !== undefined
                        ? { targetBranch: branch.branch }
                        : {}),
                    ...(branch?.prUrl !== undefined
                        ? { pullRequestUrl: branch.prUrl }
                        : {}),
                    ...(run.result !== undefined ? { result: run.result } : {}),
                    ...(run.errorMessage !== undefined
                        ? { errorMessage: run.errorMessage }
                        : {}),
                },
            }
            : {}),
        ...(drift !== undefined ? { drift } : {}),
    };
}
async function list(deps, args) {
    const cursor = (0, validate_js_1.validateCursor)(args.cursor);
    const result = await deps.adapter.listAgents({
        includeArchived: args.archived === true,
        ...(cursor !== undefined ? { cursor } : {}),
    });
    const index = await readHealthyIndex(deps.stateFilePath);
    const items = result.items.map((info) => {
        const idempotencyKey = info.metadata['yellowIdempotencyKey'];
        const local = idempotencyKey !== undefined
            ? (0, state_js_1.findByIdempotencyKey)(index, idempotencyKey)
            : (0, state_js_1.findByAgentId)(index, info.agentId);
        const drift = local !== undefined && local.status !== (info.status ?? local.status);
        return {
            agentId: info.agentId,
            name: info.name,
            archived: info.archived,
            drift,
            ...(info.status !== undefined ? { status: info.status } : {}),
            ...(info.repository !== undefined ? { repository: info.repository } : {}),
            ...(local !== undefined ? { localStatus: local.status } : {}),
        };
    });
    return {
        operation: 'list',
        items,
        ...(result.nextCursor !== undefined
            ? { nextCursor: result.nextCursor }
            : {}),
    };
}
async function cancel(deps, args) {
    const agentId = (0, validate_js_1.validateAgentId)(args.agentId);
    const runId = (0, validate_js_1.validateRunId)(args.runId);
    if (!args.yes) {
        (0, errors_js_1.throwAppError)('CURSOR_CONFIRMATION_REQUIRED', 'cancel requires --yes to confirm.');
    }
    const run = await deps.adapter.getRun(runId, agentId);
    if (state_js_1.TERMINAL_RUN_STATUSES.has(run.status)) {
        return {
            operation: 'cancel',
            agentId,
            runId,
            status: run.status,
            alreadyTerminal: true,
        };
    }
    await deps.adapter.cancelRun(runId, agentId);
    const after = await deps.adapter.getRun(runId, agentId);
    await touchLocalRecordForAgent(deps, agentId, after.status);
    return {
        operation: 'cancel',
        agentId,
        runId,
        status: after.status,
        alreadyTerminal: false,
    };
}
async function archive(deps, args) {
    const agentId = (0, validate_js_1.validateAgentId)(args.agentId);
    if (!args.yes) {
        (0, errors_js_1.throwAppError)('CURSOR_CONFIRMATION_REQUIRED', 'archive requires --yes to confirm.');
    }
    const info = await deps.adapter.getAgent(agentId);
    if (info.archived) {
        return { operation: 'archive', agentId, alreadyInState: true };
    }
    if (info.status === 'running' && !args.force) {
        (0, errors_js_1.throwAppError)('CURSOR_AGENT_BUSY', `agent ${agentId} has an active run; pass --force to archive anyway.`);
    }
    await deps.adapter.archiveAgent(agentId);
    await touchLocalRecordForAgent(deps, agentId, 'archived');
    return { operation: 'archive', agentId, alreadyInState: false };
}
async function unarchive(deps, args) {
    const agentId = (0, validate_js_1.validateAgentId)(args.agentId);
    if (!args.yes) {
        (0, errors_js_1.throwAppError)('CURSOR_CONFIRMATION_REQUIRED', 'unarchive requires --yes to confirm.');
    }
    const info = await deps.adapter.getAgent(agentId);
    if (!info.archived) {
        return { operation: 'unarchive', agentId, alreadyInState: true };
    }
    await deps.adapter.unarchiveAgent(agentId);
    await touchLocalRecordForAgent(deps, agentId, info.status ?? 'unknown');
    return { operation: 'unarchive', agentId, alreadyInState: false };
}
async function writeArtifactFile(downloadRoot, localPath, buffer) {
    await (0, validate_js_1.ensureContainedPathForWrite)(downloadRoot, localPath);
    await fs.promises.writeFile(localPath, buffer, { mode: 0o600 });
}
async function artifacts(deps, args) {
    const agentId = (0, validate_js_1.validateAgentId)(args.agentId);
    if (args.download === undefined) {
        const result = await deps.adapter.listArtifacts(agentId);
        if (!result.supported) {
            (0, errors_js_1.throwAppError)('CURSOR_UNSUPPORTED_CAPABILITY', result.reason);
        }
        return { operation: 'artifacts', agentId, items: result.value };
    }
    if (args.out === undefined) {
        (0, errors_js_1.throwAppError)('CURSOR_INVALID_INPUT', '--download requires --out <local-path>');
    }
    const remotePath = (0, validate_js_1.validateArtifactRemotePath)(args.download);
    const downloadRoot = (0, config_js_2.resolveArtifactDownloadDir)(deps.dataDir);
    const localPath = (0, validate_js_1.resolveLocalOutPath)(downloadRoot, args.out);
    const buffer = await deps.adapter.downloadArtifact(agentId, remotePath);
    await writeArtifactFile(downloadRoot, localPath, buffer);
    return {
        operation: 'artifacts',
        agentId,
        downloaded: { remotePath, localPath, bytes: buffer.length },
    };
}
async function usage(deps, args) {
    const agentId = (0, validate_js_1.validateAgentId)(args.agentId);
    const result = await deps.adapter.getUsage(agentId);
    if (!result.supported) {
        (0, errors_js_1.throwAppError)('CURSOR_UNSUPPORTED_CAPABILITY', result.reason);
    }
    return { operation: 'usage', agentId, usage: result.value };
}
