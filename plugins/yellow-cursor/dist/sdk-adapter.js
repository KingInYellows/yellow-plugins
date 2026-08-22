"use strict";
/**
 * The ONLY file that imports `@cursor/sdk`. Type-only imports below are
 * erased at compile time (see tsconfig: module=node16), so they impose no
 * runtime import — the actual `require('@cursor/sdk')` only happens inside
 * sdk-resolver.ts's resolveSdk(), invoked lazily from each method here.
 *
 * This is also the only file that does `instanceof` checks against the
 * SDK's exported error classes; every method wraps its SDK call and
 * re-throws a normalized AdapterError (defined in errors.ts, which has no
 * SDK dependency) so the rest of the codebase never sees SDK types.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CursorSdkAdapter = void 0;
const errors_js_1 = require("./errors.js");
const sdk_resolver_js_1 = require("./sdk-resolver.js");
function classifySdkError(err, sdk) {
    const requestId = err instanceof sdk.CursorSdkError ? err.requestId : undefined;
    const isRetryable = err instanceof sdk.CursorSdkError ? err.isRetryable : false;
    const message = err instanceof Error ? err.message : String(err);
    const options = {
        ...(requestId !== undefined ? { requestId } : {}),
        isRetryable,
        cause: err,
    };
    if (err instanceof sdk.IntegrationNotConnectedError)
        return new errors_js_1.AdapterError('repo_access', message, options);
    if (err instanceof sdk.AuthenticationError)
        return new errors_js_1.AdapterError('auth', message, options);
    if (err instanceof sdk.RateLimitError)
        return new errors_js_1.AdapterError('rate_limited', message, {
            ...options,
            isRetryable: true,
        });
    if (err instanceof sdk.ConfigurationError)
        return new errors_js_1.AdapterError('invalid_input', message, options);
    if (err instanceof sdk.AgentBusyError)
        return new errors_js_1.AdapterError('agent_busy', message, options);
    if (err instanceof sdk.AgentNotFoundError)
        return new errors_js_1.AdapterError('not_found', message, {
            ...options,
            isRetryable: false,
        });
    if (err instanceof sdk.NetworkError)
        return new errors_js_1.AdapterError('service_unavailable', message, options);
    if (err instanceof sdk.UnknownAgentError)
        return new errors_js_1.AdapterError('unknown', message, options);
    if (err instanceof sdk.CursorSdkError)
        return new errors_js_1.AdapterError('unknown', message, options);
    return new errors_js_1.AdapterError('unknown', message, {
        isRetryable: false,
        cause: err,
    });
}
function toRunStatus(status) {
    if (status === 'running' ||
        status === 'finished' ||
        status === 'error' ||
        status === 'cancelled') {
        return status;
    }
    return 'error';
}
function toAdapterRun(run) {
    const branches = (run.git?.branches ?? []).map((branch) => ({
        repoUrl: branch.repoUrl,
        ...(branch.branch !== undefined ? { branch: branch.branch } : {}),
        ...(branch.prUrl !== undefined ? { prUrl: branch.prUrl } : {}),
    }));
    return {
        id: run.id,
        agentId: run.agentId,
        status: toRunStatus(run.status),
        branches,
        ...(run.requestId !== undefined ? { requestId: run.requestId } : {}),
        ...(run.result !== undefined ? { result: run.result } : {}),
        ...(run.error !== undefined ? { errorMessage: run.error.message } : {}),
        ...(run.model?.id !== undefined ? { model: run.model.id } : {}),
        ...(run.createdAt !== undefined
            ? { createdAt: new Date(run.createdAt).toISOString() }
            : {}),
    };
}
function toAdapterAgentInfo(info) {
    const cloudInfo = info;
    const repository = cloudInfo.runtime === 'cloud' ? cloudInfo.repos?.[0] : undefined;
    const metadata = cloudInfo.runtime === 'cloud' ? (cloudInfo.metadata ?? {}) : {};
    return {
        agentId: info.agentId,
        name: info.name,
        summary: info.summary,
        archived: Boolean(info.archived),
        metadata,
        ...(info.status !== undefined ? { status: info.status } : {}),
        ...(repository !== undefined ? { repository } : {}),
        ...(info.createdAt !== undefined
            ? { createdAt: new Date(info.createdAt).toISOString() }
            : {}),
    };
}
function toAdapterUsage(usage) {
    return {
        usage: usage.usage,
        ...(usage.cost !== undefined ? { cost: usage.cost } : {}),
        runs: usage.runs.map((run) => ({
            runId: run.runId,
            usage: run.usage,
            ...(run.cost !== undefined ? { cost: run.cost } : {}),
        })),
    };
}
function toAdapterArtifact(artifact) {
    const a = artifact;
    return {
        path: a.path,
        ...(a.sizeBytes !== undefined ? { sizeBytes: a.sizeBytes } : {}),
        ...(a.updatedAt !== undefined ? { updatedAt: String(a.updatedAt) } : {}),
    };
}
function wrapHandle(agent, sdk) {
    return {
        agentId: agent.agentId,
        async send(message, options) {
            try {
                const run = await agent.send(message, {
                    idempotencyKey: options.idempotencyKey,
                });
                return toAdapterRun(run);
            }
            catch (err) {
                throw classifySdkError(err, sdk);
            }
        },
    };
}
class CursorSdkAdapter {
    dataDir;
    constructor(dataDir) {
        this.dataDir = dataDir;
    }
    sdk() {
        return (0, sdk_resolver_js_1.resolveSdk)(this.dataDir);
    }
    async createAgent(options) {
        const sdk = this.sdk();
        try {
            const createOptions = {
                cloud: {
                    repos: [
                        {
                            url: options.repoUrl,
                            ...(options.startingRef !== undefined
                                ? { startingRef: options.startingRef }
                                : {}),
                        },
                    ],
                    autoCreatePR: options.autoCreatePR,
                    envVars: { YELLOW_REMOTE_AGENT_CONTEXT: '1', ...options.envVars },
                    metadata: {
                        yellowIdempotencyKey: options.idempotencyKey,
                        ...options.metadata,
                    },
                },
                idempotencyKey: options.idempotencyKey,
                ...(options.model !== undefined
                    ? { model: { id: options.model } }
                    : {}),
            };
            const agent = await sdk.Agent.create(createOptions);
            return wrapHandle(agent, sdk);
        }
        catch (err) {
            throw classifySdkError(err, sdk);
        }
    }
    async resumeAgent(agentId) {
        const sdk = this.sdk();
        try {
            const agent = await sdk.Agent.resume(agentId);
            return wrapHandle(agent, sdk);
        }
        catch (err) {
            throw classifySdkError(err, sdk);
        }
    }
    async getAgent(agentId) {
        const sdk = this.sdk();
        try {
            const info = await sdk.Agent.get(agentId);
            return toAdapterAgentInfo(info);
        }
        catch (err) {
            throw classifySdkError(err, sdk);
        }
    }
    async listAgents(options) {
        const sdk = this.sdk();
        try {
            const result = await sdk.Agent.list(options?.cursor !== undefined ? { cursor: options.cursor } : undefined);
            const items = result.items.map(toAdapterAgentInfo);
            return {
                items,
                ...(result.nextCursor !== undefined
                    ? { nextCursor: result.nextCursor }
                    : {}),
            };
        }
        catch (err) {
            throw classifySdkError(err, sdk);
        }
    }
    async getRun(runId, agentId) {
        const sdk = this.sdk();
        try {
            const run = await sdk.Agent.getRun(runId, { runtime: 'cloud', agentId });
            return toAdapterRun(run);
        }
        catch (err) {
            throw classifySdkError(err, sdk);
        }
    }
    async cancelRun(runId, agentId) {
        const sdk = this.sdk();
        try {
            await sdk.Agent.cancelRun(runId, { runtime: 'cloud', agentId });
        }
        catch (err) {
            throw classifySdkError(err, sdk);
        }
    }
    async archiveAgent(agentId) {
        const sdk = this.sdk();
        try {
            await sdk.Agent.archive(agentId);
        }
        catch (err) {
            throw classifySdkError(err, sdk);
        }
    }
    async unarchiveAgent(agentId) {
        const sdk = this.sdk();
        try {
            await sdk.Agent.unarchive(agentId);
        }
        catch (err) {
            throw classifySdkError(err, sdk);
        }
    }
    async getUsage(agentId) {
        const sdk = this.sdk();
        try {
            const usage = await sdk.Agent.getUsage(agentId);
            return { supported: true, value: toAdapterUsage(usage) };
        }
        catch (err) {
            const adapterErr = classifySdkError(err, sdk);
            if (adapterErr.kind === 'unknown' || adapterErr.kind === 'not_found') {
                return { supported: false, reason: adapterErr.message };
            }
            throw adapterErr;
        }
    }
    async listArtifacts(agentId) {
        const sdk = this.sdk();
        try {
            const agent = await sdk.Agent.resume(agentId);
            const artifacts = await agent.listArtifacts();
            return { supported: true, value: artifacts.map(toAdapterArtifact) };
        }
        catch (err) {
            const adapterErr = classifySdkError(err, sdk);
            if (adapterErr.kind === 'unknown' || adapterErr.kind === 'not_found') {
                return { supported: false, reason: adapterErr.message };
            }
            throw adapterErr;
        }
    }
    async downloadArtifact(agentId, remotePath) {
        const sdk = this.sdk();
        try {
            const agent = await sdk.Agent.resume(agentId);
            return await agent.downloadArtifact(remotePath);
        }
        catch (err) {
            throw classifySdkError(err, sdk);
        }
    }
    async probeSetup() {
        const sdk = this.sdk();
        let me;
        try {
            const user = await sdk.Cursor.me();
            me = {
                ...(user.userEmail !== undefined ? { email: user.userEmail } : {}),
            };
        }
        catch {
            me = undefined;
        }
        let modelsCount;
        try {
            const models = await sdk.Cursor.models.list();
            modelsCount = { supported: true, value: models.length };
        }
        catch (err) {
            const adapterErr = classifySdkError(err, sdk);
            modelsCount = { supported: false, reason: adapterErr.message };
        }
        return { ...(me !== undefined ? { me } : {}), modelsCount };
    }
}
exports.CursorSdkAdapter = CursorSdkAdapter;
