/**
 * Deterministic, network-free test double for SdkAdapter. Every behavior is
 * an overridable async field with a working happy-path default, so a test
 * scripts exactly the scenario it needs (a specific AdapterError kind, a
 * timeout-after-create, a capability gap) by reassigning one field instead
 * of threading enum knobs through a constructor.
 */

import { AdapterError } from '../src/errors.js';
import type {
  AdapterAgentHandle,
  AdapterAgentInfo,
  AdapterArtifact,
  AdapterRun,
  AdapterUsage,
  CapabilityResult,
  CreateAgentOptions,
  ListAgentsResult,
  SdkAdapter,
  SetupProbeResult,
} from '../src/types.js';

export interface FakeAgentState {
  agentId: string;
  name: string;
  summary: string;
  status: 'running' | 'finished' | 'error';
  archived: boolean;
  repository?: string;
  metadata: Record<string, string>;
  createdAt: string;
  runs: Map<string, AdapterRun>;
}

let nextAgentSeq = 1;
let nextRunSeq = 1;

export function resetFakeSdkSequence(): void {
  nextAgentSeq = 1;
  nextRunSeq = 1;
}

export function makeFakeAgentId(): string {
  const n = String(nextAgentSeq).padStart(8, '0');
  nextAgentSeq += 1;
  return `bc-${n}0000-0000-0000-000000000000`;
}

export function makeFakeRunId(): string {
  const id = `run-${String(nextRunSeq).padStart(8, '0')}`;
  nextRunSeq += 1;
  return id;
}

export class FakeSdkAdapter implements SdkAdapter {
  readonly agents = new Map<string, FakeAgentState>();

  createImpl: (options: CreateAgentOptions) => Promise<FakeAgentState> = async (
    options
  ) => {
    const agentId = makeFakeAgentId();
    const state: FakeAgentState = {
      agentId,
      name: 'fake-agent',
      summary: '',
      status: 'running',
      archived: false,
      metadata: {
        yellowIdempotencyKey: options.idempotencyKey,
        ...options.metadata,
      },
      createdAt: new Date().toISOString(),
      runs: new Map(),
      ...(options.repoUrl !== undefined ? { repository: options.repoUrl } : {}),
    };
    this.agents.set(agentId, state);
    return state;
  };

  sendImpl: (
    state: FakeAgentState,
    message: string,
    options: { idempotencyKey: string }
  ) => Promise<AdapterRun> = async (state) => {
    const runId = makeFakeRunId();
    // Mimic live SDK: create() mints a provisional id; send() assigns the canonical id.
    const canonicalId = makeFakeAgentId();
    const run: AdapterRun = {
      id: runId,
      agentId: canonicalId,
      status: 'running',
      branches:
        state.repository !== undefined
          ? [{ repoUrl: state.repository, branch: `cursor/${runId}` }]
          : [],
      requestId: `req-${runId}`,
    };
    const canonicalState: FakeAgentState = {
      ...state,
      agentId: canonicalId,
      runs: new Map(state.runs),
    };
    canonicalState.runs.set(runId, run);
    this.agents.set(canonicalId, canonicalState);
    state.runs.set(runId, run);
    state.status = 'running';
    return run;
  };

  getAgentImpl: (agentId: string) => Promise<AdapterAgentInfo> = async (
    agentId
  ) => {
    const state = this.requireAgent(agentId);
    return this.toInfo(state);
  };

  listAgentsImpl: (options?: { cursor?: string }) => Promise<ListAgentsResult> =
    async () => ({
      items: Array.from(this.agents.values()).map((state) =>
        this.toInfo(state)
      ),
    });

  getRunImpl: (runId: string, agentId: string) => Promise<AdapterRun> = async (
    runId,
    agentId
  ) => {
    const state = this.requireAgent(agentId);
    const run = state.runs.get(runId);
    if (!run)
      throw new AdapterError(
        'not_found',
        `run ${runId} not found on agent ${agentId}`
      );
    return run;
  };

  cancelRunImpl: (runId: string, agentId: string) => Promise<void> = async (
    runId,
    agentId
  ) => {
    const state = this.requireAgent(agentId);
    const run = state.runs.get(runId);
    if (!run)
      throw new AdapterError(
        'not_found',
        `run ${runId} not found on agent ${agentId}`
      );
    state.runs.set(runId, { ...run, status: 'cancelled' });
    state.status = 'error';
  };

  archiveAgentImpl: (agentId: string) => Promise<void> = async (agentId) => {
    const state = this.requireAgent(agentId);
    state.archived = true;
  };

  unarchiveAgentImpl: (agentId: string) => Promise<void> = async (agentId) => {
    const state = this.requireAgent(agentId);
    state.archived = false;
  };

  getUsageImpl: (agentId: string) => Promise<CapabilityResult<AdapterUsage>> =
    async () => ({
      supported: true,
      value: {
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 150,
        },
        runs: [],
      },
    });

  listArtifactsImpl: (
    agentId: string
  ) => Promise<CapabilityResult<readonly AdapterArtifact[]>> = async () => ({
    supported: true,
    value: [],
  });

  downloadArtifactImpl: (
    agentId: string,
    remotePath: string
  ) => Promise<Buffer> = async () => Buffer.from('fake-artifact');

  probeSetupImpl: () => Promise<SetupProbeResult> = async () => ({
    me: { email: 'test@example.com' },
    modelsCount: { supported: true, value: 3 },
  });

  private requireAgent(agentId: string): FakeAgentState {
    const state = this.agents.get(agentId);
    if (!state)
      throw new AdapterError('not_found', `agent ${agentId} not found`);
    return state;
  }

  private toInfo(state: FakeAgentState): AdapterAgentInfo {
    return {
      agentId: state.agentId,
      name: state.name,
      summary: state.summary,
      status: state.status,
      archived: state.archived,
      metadata: state.metadata,
      createdAt: state.createdAt,
      ...(state.repository !== undefined
        ? { repository: state.repository }
        : {}),
    };
  }

  async createAgent(options: CreateAgentOptions): Promise<AdapterAgentHandle> {
    const state = await this.createImpl(options);
    return this.wrapHandle(state);
  }

  async resumeAgent(agentId: string): Promise<AdapterAgentHandle> {
    const state = this.requireAgent(agentId);
    return this.wrapHandle(state);
  }

  private wrapHandle(state: FakeAgentState): AdapterAgentHandle {
    return {
      agentId: state.agentId,
      send: (message, options) => this.sendImpl(state, message, options),
    };
  }

  getAgent(agentId: string): Promise<AdapterAgentInfo> {
    return this.getAgentImpl(agentId);
  }

  listAgents(options?: { cursor?: string }): Promise<ListAgentsResult> {
    return this.listAgentsImpl(options);
  }

  getRun(runId: string, agentId: string): Promise<AdapterRun> {
    return this.getRunImpl(runId, agentId);
  }

  cancelRun(runId: string, agentId: string): Promise<void> {
    return this.cancelRunImpl(runId, agentId);
  }

  archiveAgent(agentId: string): Promise<void> {
    return this.archiveAgentImpl(agentId);
  }

  unarchiveAgent(agentId: string): Promise<void> {
    return this.unarchiveAgentImpl(agentId);
  }

  getUsage(agentId: string): Promise<CapabilityResult<AdapterUsage>> {
    return this.getUsageImpl(agentId);
  }

  listArtifacts(
    agentId: string
  ): Promise<CapabilityResult<readonly AdapterArtifact[]>> {
    return this.listArtifactsImpl(agentId);
  }

  downloadArtifact(agentId: string, remotePath: string): Promise<Buffer> {
    return this.downloadArtifactImpl(agentId, remotePath);
  }

  probeSetup(): Promise<SetupProbeResult> {
    return this.probeSetupImpl();
  }
}

export function makeFakeClock(): {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  advanceMs: number;
} {
  const clock = {
    advanceMs: 0,
    now: () => 1_700_000_000_000 + clock.advanceMs,
    sleep: async (ms: number) => {
      clock.advanceMs += ms;
    },
  };
  return clock;
}
