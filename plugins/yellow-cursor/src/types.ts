/**
 * Shared runtime types for the yellow-cursor CLI. Nothing here imports
 * `@cursor/sdk` — these are normalized shapes the adapter translates SDK
 * responses into, so runtime.ts, state.ts, and tests only ever depend on
 * this module.
 */

export type RunStatus = 'running' | 'finished' | 'error' | 'cancelled';

/** Mirrors the SDK's Run.git.branches[] shape — the only place branch/PR info actually surfaces. */
export interface RunGitBranch {
  readonly repoUrl: string;
  readonly branch?: string;
  readonly prUrl?: string;
}

export interface AdapterRun {
  readonly id: string;
  readonly agentId: string;
  readonly status: RunStatus;
  readonly requestId?: string;
  readonly result?: string;
  readonly errorMessage?: string;
  readonly model?: string;
  readonly branches: readonly RunGitBranch[];
  readonly createdAt?: string;
}

/**
 * Mirrors SDKAgentInfo's real (narrower than originally assumed) shape: no
 * `model`, `prUrl`, or `startingRef` readback exists on Agent.get/list —
 * those only ever surface on a Run (see AdapterRun.branches).
 */
export interface AdapterAgentInfo {
  readonly agentId: string;
  readonly name: string;
  readonly summary: string;
  readonly status?: 'running' | 'finished' | 'error';
  readonly archived: boolean;
  readonly metadata: Record<string, string>;
  readonly repository?: string;
  readonly createdAt?: string;
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly totalTokens: number;
  readonly reasoningTokens?: number;
}

export interface UsageCost {
  readonly rawCostCents: number;
  readonly chargedCents: number;
}

export interface AdapterUsage {
  readonly usage: TokenUsage;
  readonly cost?: UsageCost;
  readonly runs: ReadonlyArray<{
    readonly runId: string;
    readonly usage: TokenUsage;
    readonly cost?: UsageCost;
  }>;
}

export interface AdapterArtifact {
  readonly path: string;
  readonly sizeBytes?: number;
  readonly updatedAt?: string;
}

/**
 * Distinguishes "the SDK/account does not expose this" from "the value is
 * empty" — callers must not conflate the two (see CURSOR_UNSUPPORTED_CAPABILITY).
 */
export type CapabilityResult<T> =
  | { readonly supported: true; readonly value: T }
  | { readonly supported: false; readonly reason: string };

export interface CreateAgentOptions {
  readonly repoUrl: string;
  readonly startingRef?: string;
  readonly autoCreatePR: boolean;
  readonly model?: string;
  readonly idempotencyKey: string;
  readonly metadata?: Record<string, string>;
  readonly envVars?: Record<string, string>;
}

export interface AdapterAgentHandle {
  readonly agentId: string;
  send(
    message: string,
    options: { idempotencyKey: string }
  ): Promise<AdapterRun>;
}

export interface ListAgentsResult {
  readonly items: readonly AdapterAgentInfo[];
  readonly nextCursor?: string;
}

export interface SetupProbeResult {
  readonly me?: { readonly email?: string };
  readonly modelsCount?: CapabilityResult<number>;
}

/**
 * Dependency-injection seam: runtime.ts depends only on this interface, so
 * tests inject fake-sdk.ts instead of the real `@cursor/sdk` wrapper.
 * Deliberately has no deleteAgent method — Agent.delete exists in the SDK
 * but must never be reachable from this CLI's surface.
 */
export interface SdkAdapter {
  createAgent(options: CreateAgentOptions): Promise<AdapterAgentHandle>;
  resumeAgent(agentId: string): Promise<AdapterAgentHandle>;
  getAgent(agentId: string): Promise<AdapterAgentInfo>;
  listAgents(options?: { cursor?: string }): Promise<ListAgentsResult>;
  /** agentId is required — the SDK's cloud GetRunOptions needs it to route the lookup. */
  getRun(runId: string, agentId: string): Promise<AdapterRun>;
  cancelRun(runId: string, agentId: string): Promise<void>;
  archiveAgent(agentId: string): Promise<void>;
  unarchiveAgent(agentId: string): Promise<void>;
  getUsage(agentId: string): Promise<CapabilityResult<AdapterUsage>>;
  listArtifacts(
    agentId: string
  ): Promise<CapabilityResult<readonly AdapterArtifact[]>>;
  downloadArtifact(agentId: string, remotePath: string): Promise<Buffer>;
  probeSetup(): Promise<SetupProbeResult>;
}

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}
