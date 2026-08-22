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

import type {
  AgentOptions,
  AgentUsage as SdkAgentUsage,
  Run as SdkRun,
  SDKAgent,
  SDKAgentInfo,
  SDKArtifact,
} from '@cursor/sdk';

import { AdapterError } from './errors.js';
import { resolveSdk } from './sdk-resolver.js';
import type {
  AdapterAgentHandle,
  AdapterAgentInfo,
  AdapterArtifact,
  AdapterRun,
  AdapterUsage,
  CapabilityResult,
  CreateAgentOptions,
  ListAgentsResult,
  RunStatus,
  SdkAdapter,
  SetupProbeResult,
} from './types.js';

type CursorSdkModule = typeof import('@cursor/sdk');

function classifySdkError(err: unknown, sdk: CursorSdkModule): AdapterError {
  const requestId =
    err instanceof sdk.CursorSdkError ? err.requestId : undefined;
  const isRetryable =
    err instanceof sdk.CursorSdkError ? err.isRetryable : false;
  const message = err instanceof Error ? err.message : String(err);
  const options = {
    ...(requestId !== undefined ? { requestId } : {}),
    isRetryable,
    cause: err,
  };

  if (err instanceof sdk.IntegrationNotConnectedError)
    return new AdapterError('repo_access', message, options);
  if (err instanceof sdk.AuthenticationError)
    return new AdapterError('auth', message, options);
  if (err instanceof sdk.RateLimitError)
    return new AdapterError('rate_limited', message, {
      ...options,
      isRetryable: true,
    });
  if (err instanceof sdk.ConfigurationError)
    return new AdapterError('invalid_input', message, options);
  if (err instanceof sdk.AgentBusyError)
    return new AdapterError('agent_busy', message, options);
  if (err instanceof sdk.AgentNotFoundError)
    return new AdapterError('not_found', message, {
      ...options,
      isRetryable: false,
    });
  if (err instanceof sdk.NetworkError)
    return new AdapterError('service_unavailable', message, options);
  if (err instanceof sdk.UnknownAgentError)
    return new AdapterError('unknown', message, options);
  if (err instanceof sdk.CursorSdkError)
    return new AdapterError('unknown', message, options);
  return new AdapterError('unknown', message, {
    isRetryable: false,
    cause: err,
  });
}

function toRunStatus(status: string): RunStatus {
  if (
    status === 'running' ||
    status === 'finished' ||
    status === 'error' ||
    status === 'cancelled'
  ) {
    return status;
  }
  return 'error';
}

function toAdapterRun(run: SdkRun): AdapterRun {
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

function toAdapterAgentInfo(info: SDKAgentInfo): AdapterAgentInfo {
  const cloudInfo = info as SDKAgentInfo & {
    runtime?: string;
    repos?: string[];
    metadata?: Record<string, string>;
  };
  const repository =
    cloudInfo.runtime === 'cloud' ? cloudInfo.repos?.[0] : undefined;
  const metadata =
    cloudInfo.runtime === 'cloud' ? (cloudInfo.metadata ?? {}) : {};
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

function toAdapterUsage(usage: SdkAgentUsage): AdapterUsage {
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

function toAdapterArtifact(artifact: SDKArtifact): AdapterArtifact {
  const a = artifact as {
    path: string;
    sizeBytes?: number;
    updatedAt?: string | number;
  };
  return {
    path: a.path,
    ...(a.sizeBytes !== undefined ? { sizeBytes: a.sizeBytes } : {}),
    ...(a.updatedAt !== undefined ? { updatedAt: String(a.updatedAt) } : {}),
  };
}

function wrapHandle(agent: SDKAgent, sdk: CursorSdkModule): AdapterAgentHandle {
  return {
    agentId: agent.agentId,
    async send(
      message: string,
      options: { idempotencyKey: string }
    ): Promise<AdapterRun> {
      try {
        const run = await agent.send(message, {
          idempotencyKey: options.idempotencyKey,
        });
        return toAdapterRun(run);
      } catch (err) {
        throw classifySdkError(err, sdk);
      }
    },
  };
}

export class CursorSdkAdapter implements SdkAdapter {
  constructor(private readonly dataDir: string) {}

  private sdk(): CursorSdkModule {
    return resolveSdk(this.dataDir);
  }

  async createAgent(options: CreateAgentOptions): Promise<AdapterAgentHandle> {
    const sdk = this.sdk();
    try {
      const createOptions: AgentOptions = {
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
    } catch (err) {
      throw classifySdkError(err, sdk);
    }
  }

  async resumeAgent(agentId: string): Promise<AdapterAgentHandle> {
    const sdk = this.sdk();
    try {
      const agent = await sdk.Agent.resume(agentId);
      return wrapHandle(agent, sdk);
    } catch (err) {
      throw classifySdkError(err, sdk);
    }
  }

  async getAgent(agentId: string): Promise<AdapterAgentInfo> {
    const sdk = this.sdk();
    try {
      const info = await sdk.Agent.get(agentId);
      return toAdapterAgentInfo(info);
    } catch (err) {
      throw classifySdkError(err, sdk);
    }
  }

  async listAgents(options?: { cursor?: string }): Promise<ListAgentsResult> {
    const sdk = this.sdk();
    try {
      const result = await sdk.Agent.list(
        options?.cursor !== undefined ? { cursor: options.cursor } : undefined
      );
      const items = result.items.map(toAdapterAgentInfo);
      return {
        items,
        ...(result.nextCursor !== undefined
          ? { nextCursor: result.nextCursor }
          : {}),
      };
    } catch (err) {
      throw classifySdkError(err, sdk);
    }
  }

  async getRun(runId: string, agentId: string): Promise<AdapterRun> {
    const sdk = this.sdk();
    try {
      const run = await sdk.Agent.getRun(runId, { runtime: 'cloud', agentId });
      return toAdapterRun(run);
    } catch (err) {
      throw classifySdkError(err, sdk);
    }
  }

  async cancelRun(runId: string, agentId: string): Promise<void> {
    const sdk = this.sdk();
    try {
      await sdk.Agent.cancelRun(runId, { runtime: 'cloud', agentId });
    } catch (err) {
      throw classifySdkError(err, sdk);
    }
  }

  async archiveAgent(agentId: string): Promise<void> {
    const sdk = this.sdk();
    try {
      await sdk.Agent.archive(agentId);
    } catch (err) {
      throw classifySdkError(err, sdk);
    }
  }

  async unarchiveAgent(agentId: string): Promise<void> {
    const sdk = this.sdk();
    try {
      await sdk.Agent.unarchive(agentId);
    } catch (err) {
      throw classifySdkError(err, sdk);
    }
  }

  async getUsage(agentId: string): Promise<CapabilityResult<AdapterUsage>> {
    const sdk = this.sdk();
    try {
      const usage = await sdk.Agent.getUsage(agentId);
      return { supported: true, value: toAdapterUsage(usage) };
    } catch (err) {
      const adapterErr = classifySdkError(err, sdk);
      if (adapterErr.kind === 'unknown' || adapterErr.kind === 'not_found') {
        return { supported: false, reason: adapterErr.message };
      }
      throw adapterErr;
    }
  }

  async listArtifacts(
    agentId: string
  ): Promise<CapabilityResult<readonly AdapterArtifact[]>> {
    const sdk = this.sdk();
    try {
      const agent = await sdk.Agent.resume(agentId);
      const artifacts = await agent.listArtifacts();
      return { supported: true, value: artifacts.map(toAdapterArtifact) };
    } catch (err) {
      const adapterErr = classifySdkError(err, sdk);
      if (adapterErr.kind === 'unknown' || adapterErr.kind === 'not_found') {
        return { supported: false, reason: adapterErr.message };
      }
      throw adapterErr;
    }
  }

  async downloadArtifact(agentId: string, remotePath: string): Promise<Buffer> {
    const sdk = this.sdk();
    try {
      const agent = await sdk.Agent.resume(agentId);
      return await agent.downloadArtifact(remotePath);
    } catch (err) {
      throw classifySdkError(err, sdk);
    }
  }

  async probeSetup(): Promise<SetupProbeResult> {
    const sdk = this.sdk();
    let me: { email?: string } | undefined;
    try {
      const user = await sdk.Cursor.me();
      me = {
        ...(user.userEmail !== undefined ? { email: user.userEmail } : {}),
      };
    } catch {
      me = undefined;
    }

    let modelsCount: CapabilityResult<number>;
    try {
      const models = await sdk.Cursor.models.list();
      modelsCount = { supported: true, value: models.length };
    } catch (err) {
      const adapterErr = classifySdkError(err, sdk);
      modelsCount = { supported: false, reason: adapterErr.message };
    }

    return { ...(me !== undefined ? { me } : {}), modelsCount };
  }
}
