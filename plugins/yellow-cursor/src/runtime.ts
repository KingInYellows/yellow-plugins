/**
 * Operation layer: one exported async function per CLI subcommand, each
 * taking a RuntimeDeps bag (SdkAdapter injected for tests) plus its own
 * validated-or-throwing args. cli.ts is the only caller — it owns argv
 * parsing, the JSON envelope, and exit codes; this module owns the business
 * rules (confirmation gates, idempotency, retries, state reconciliation).
 */

import * as fs from 'node:fs';

import { hasEnvApiKey, type CredentialSource } from './config.js';
import { resolveArtifactDownloadDir } from './config.js';
import { AdapterError, AppErrorException, throwAppError } from './errors.js';
import {
  installSdk,
  probeSdkResolutionState,
  type SdkResolutionState,
} from './sdk-resolver.js';
import {
  countLocalPendingReservationsForRepo,
  digestPrompt,
  findByAgentId,
  findByIdempotencyKey,
  isTerminalStatus,
  readIndex,
  TERMINAL_RUN_STATUSES,
  throwIfQuarantined,
  upsertRecord,
  upsertRecordUnderLock,
  withStateLock,
  type AgentIndex,
  type AgentRecord,
} from './state.js';
import type {
  AdapterAgentHandle,
  AdapterArtifact,
  AdapterRun,
  AdapterUsage,
  CapabilityResult,
  Clock,
  ListAgentsResult,
  SdkAdapter,
} from './types.js';
import {
  validateAgentId,
  validateArtifactRemotePath,
  validateCursor,
  validateIdempotencyKey,
  resolveLocalOutPath,
  ensureContainedPathForWrite,
  validateMaxActive,
  validateModelId,
  validatePrompt,
  validateRef,
  validateRepoUrl,
  validateRunId,
} from './validate.js';

export interface RuntimeDeps {
  readonly adapter: SdkAdapter;
  readonly dataDir: string;
  readonly stateFilePath: string;
  readonly clock: Clock;
  readonly env: NodeJS.ProcessEnv;
}

export const REAL_CLOCK: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

function nowIso(deps: RuntimeDeps): string {
  return new Date(deps.clock.now()).toISOString();
}

async function withRetry<T>(
  fn: () => Promise<T>,
  clock: Clock,
  maxRetries = 2,
  baseDelayMs = 500
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (
        err instanceof AdapterError &&
        err.isRetryable &&
        attempt < maxRetries
      ) {
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
async function sendWithOutcomeTracking(
  handle: AdapterAgentHandle,
  prompt: string,
  idempotencyKey: string,
  clock: Clock
): Promise<AdapterRun> {
  try {
    return await withRetry(
      () => handle.send(prompt, { idempotencyKey }),
      clock
    );
  } catch (err) {
    if (
      err instanceof AdapterError &&
      (err.kind === 'service_unavailable' ||
        err.kind === 'malformed_response' ||
        err.kind === 'unknown')
    ) {
      return throwAppError(
        'CURSOR_UNKNOWN_OUTCOME',
        err.message,
        err.requestId !== undefined ? { requestId: err.requestId } : {}
      );
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
 *
 * includeArchived is TRUE here even though the user-facing `list` hides
 * archived agents. `/cursor:archive --force` archives an agent whose run is
 * still running and does NOT cancel that run, so an archived agent can still
 * be consuming a billable slot. The cap counts what is actually running, not
 * what is visible; filtering on status alone keeps archived-but-finished
 * agents out of the count.
 */
async function countActiveAgentsForRepo(
  adapter: SdkAdapter,
  repoUrl: string,
  maxActive: number
): Promise<number> {
  let count = 0;
  let cursor: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const result: ListAgentsResult = await adapter.listAgents({
      includeArchived: true,
      ...(cursor !== undefined ? { cursor } : {}),
    });
    count += result.items.filter(
      (item) => item.repository === repoUrl && item.status === 'running'
    ).length;
    if (result.nextCursor === undefined) return count;
    cursor = result.nextCursor;
  }
  // recoveryAction is overridden because the catalog default ("raise
  // --max-active") is actively wrong here: this branch throws before any count
  // exists to compare the cap against, so raising it can never clear the error.
  return throwAppError(
    'CURSOR_CONCURRENCY_LIMIT',
    `could not confirm the active-agent count for ${repoUrl}: the cloud agent listing still had more pages after ${MAX_LIST_PAGES}, so the max-active=${maxActive} cap cannot be enforced safely.`,
    {
      // Deliberately promises no remedy. Raising --max-active cannot help (this
      // throws before any count exists to compare it against) and neither can
      // archiving, since the sweep requests includeArchived: true — archived
      // agents still occupy these pages. At this account size the cap is simply
      // not automatically enforceable, and saying so is more useful than naming
      // an action that does nothing.
      recoveryAction:
        'No flag clears this: the account has more cloud agents than the bounded sweep can enumerate, and neither raising --max-active nor archiving reduces the page count. Review running agents yourself with /cursor:list, then launch via /cursor:delegate once you have confirmed there is capacity.',
    }
  );
}

async function readHealthyIndex(stateFilePath: string): Promise<AgentIndex> {
  const result = await readIndex(stateFilePath);
  throwIfQuarantined(result);
  return result.index;
}

async function touchLocalRecordForAgent(
  deps: RuntimeDeps,
  agentId: string,
  status: string
): Promise<void> {
  const index = await readHealthyIndex(deps.stateFilePath);
  const existing = findByAgentId(index, agentId);
  if (!existing) return;
  await upsertRecord(deps.stateFilePath, {
    ...existing,
    status,
    updatedAt: nowIso(deps),
  });
}

// ---------------------------------------------------------------------------
// setup
// ---------------------------------------------------------------------------

export interface SetupArgs {
  readonly installSdk: boolean;
}

export interface SetupResult {
  readonly operation: 'setup';
  readonly credentialSource: CredentialSource;
  readonly sdkResolution: SdkResolutionState;
  readonly installed?: { readonly runtimeDir: string };
  readonly me?: { readonly email?: string };
  readonly modelsCount: CapabilityResult<number>;
}

export async function setup(
  deps: RuntimeDeps,
  args: SetupArgs
): Promise<SetupResult> {
  let installed: { runtimeDir: string } | undefined;
  if (args.installSdk) {
    const result = await installSdk(deps.dataDir);
    installed = { runtimeDir: result.runtimeDir };
  }

  const sdkResolution = probeSdkResolutionState(deps.dataDir);
  if (sdkResolution === 'missing') {
    return {
      operation: 'setup',
      credentialSource: hasEnvApiKey(deps.env) ? 'env' : 'none',
      sdkResolution,
      modelsCount: { supported: false, reason: 'SDK not installed' },
      ...(installed !== undefined ? { installed } : {}),
    };
  }

  const probe = await deps.adapter.probeSetup();
  const credentialSource: CredentialSource = hasEnvApiKey(deps.env)
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

// ---------------------------------------------------------------------------
// delegate
// ---------------------------------------------------------------------------

export interface DelegateArgs {
  readonly repoUrl: string;
  readonly startingRef?: string;
  readonly model?: string;
  readonly prompt: string;
  readonly yes: boolean;
  readonly dryRun: boolean;
  /** Resolved (given or generated) by cli.ts before this is called, so it can be echoed even on failure. */
  readonly idempotencyKey: string;
  readonly maxActive: number;
  readonly autoCreatePr: boolean;
  readonly linearIssue?: string;
  readonly callingHost?: string;
}

export interface DelegateResult {
  readonly operation: 'delegate';
  readonly idempotencyKey: string;
  readonly dryRun?: true;
  readonly agentId?: string;
  readonly runId?: string;
  readonly requestId?: string;
  readonly status?: string;
  readonly repository: string;
  readonly startingRef?: string;
  readonly targetBranch?: string;
  readonly pullRequestUrl?: string;
  readonly model?: string;
}

export async function delegate(
  deps: RuntimeDeps,
  args: DelegateArgs
): Promise<DelegateResult> {
  const repoUrl = validateRepoUrl(args.repoUrl);
  const startingRef =
    args.startingRef !== undefined ? validateRef(args.startingRef) : undefined;
  const model = validateModelId(args.model);
  const prompt = validatePrompt(args.prompt);
  const idempotencyKey = validateIdempotencyKey(args.idempotencyKey);
  const maxActive = validateMaxActive(args.maxActive);

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
    throwAppError(
      'CURSOR_CONFIRMATION_REQUIRED',
      'delegate requires --yes to confirm.'
    );
  }

  if (deps.env['YELLOW_REMOTE_AGENT_CONTEXT']) {
    throwAppError(
      'CURSOR_NESTED_DELEGATION',
      'refusing to delegate from inside a remote agent run.'
    );
  }

  const promptDigest = digestPrompt(prompt);
  const reservation: AgentRecord = {
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

  await withStateLock(deps.stateFilePath, async () => {
    const readResult = await readIndex(deps.stateFilePath);
    throwIfQuarantined(readResult);
    const existing = findByIdempotencyKey(
      readResult.index,
      idempotencyKey
    );
    if (existing && !isTerminalStatus(existing.status)) {
      throwAppError(
        'CURSOR_DUPLICATE_LAUNCH',
        `an operation with idempotency key "${idempotencyKey}" is already in flight (status: ${existing.status}).`
      );
    }
  });

  const remoteActive = await countActiveAgentsForRepo(
    deps.adapter,
    repoUrl,
    maxActive
  );

  await withStateLock(deps.stateFilePath, async () => {
    const readResult = await readIndex(deps.stateFilePath);
    throwIfQuarantined(readResult);
    const existing = findByIdempotencyKey(
      readResult.index,
      idempotencyKey
    );
    if (existing && !isTerminalStatus(existing.status)) {
      throwAppError(
        'CURSOR_DUPLICATE_LAUNCH',
        `an operation with idempotency key "${idempotencyKey}" is already in flight (status: ${existing.status}).`
      );
    }

    const localPending = countLocalPendingReservationsForRepo(
      readResult.index,
      repoUrl
    );
    if (remoteActive + localPending >= maxActive) {
      throwAppError(
        'CURSOR_CONCURRENCY_LIMIT',
        `${remoteActive + localPending} active agent slot(s) already reserved or running for ${repoUrl} (max-active=${maxActive}).`
      );
    }

    await upsertRecordUnderLock(deps.stateFilePath, reservation);
  });

  // Hoisted so the catch block can tell "createAgent() itself failed" (handle
  // never assigned) apart from "createAgent() succeeded but send() failed"
  // (handle assigned) — both must terminal-mark the reservation, but only the
  // latter has an agentId to record.
  let handle: AdapterAgentHandle | undefined;
  try {
    handle = await deps.adapter.createAgent({
      repoUrl,
      autoCreatePR: args.autoCreatePr,
      idempotencyKey,
      ...(startingRef !== undefined ? { startingRef } : {}),
      ...(model !== undefined ? { model } : {}),
    });
    const run = await sendWithOutcomeTracking(
      handle,
      prompt,
      idempotencyKey,
      deps.clock
    );
    const canonicalAgentId = await resolveCanonicalAgentId(
      deps,
      handle.agentId,
      run,
      idempotencyKey
    );
    const branch = run.branches[0];
    await upsertRecord(deps.stateFilePath, {
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
  } catch (err) {
    const failedStatus =
      err instanceof AppErrorException &&
      err.appError.code === 'CURSOR_UNKNOWN_OUTCOME'
        ? 'unknown'
        : 'error';
    // Terminal-mark the reservation regardless of WHERE it failed — a
    // createAgent() failure never got an agentId; a send() failure did.
    // Either way this makes the idempotencyKey non-terminal-free so a
    // same-key retry is allowed instead of permanently hitting
    // CURSOR_DUPLICATE_LAUNCH against a reservation nothing will ever advance.
    await upsertRecord(deps.stateFilePath, {
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
async function resolveCanonicalAgentId(
  deps: RuntimeDeps,
  provisionalId: string,
  run: AdapterRun,
  idempotencyKey: string
): Promise<string> {
  if (run.agentId !== '' && run.agentId !== provisionalId) {
    return run.agentId;
  }
  try {
    let cursor: string | undefined;
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      // includeArchived: reconciliation must still find an agent that was
      // archived between the send() and this sweep.
      const res = await deps.adapter.listAgents({
        includeArchived: true,
        ...(cursor !== undefined ? { cursor } : {}),
      });
      const match = res.items.find(
        (a) => a.metadata['yellowIdempotencyKey'] === idempotencyKey
      );
      if (match !== undefined) return match.agentId;
      if (res.nextCursor === undefined) break;
      cursor = res.nextCursor;
    }
  } catch {
    // fall through to UNKNOWN_OUTCOME — provisional id is not usable
  }
  return throwAppError(
    'CURSOR_UNKNOWN_OUTCOME',
    'launch succeeded but the canonical agent id could not be resolved; run list or status --reconcile.'
  );
}

// ---------------------------------------------------------------------------
// follow-up
// ---------------------------------------------------------------------------

export interface FollowUpArgs {
  readonly agentId: string;
  readonly prompt: string;
  readonly yes: boolean;
  readonly idempotencyKey: string;
}

export interface FollowUpResult {
  readonly operation: 'follow-up';
  readonly idempotencyKey: string;
  readonly agentId: string;
  readonly runId?: string;
  readonly requestId?: string;
  readonly status?: string;
  readonly targetBranch?: string;
  readonly pullRequestUrl?: string;
}

export async function followUp(
  deps: RuntimeDeps,
  args: FollowUpArgs
): Promise<FollowUpResult> {
  const agentId = validateAgentId(args.agentId);
  const prompt = validatePrompt(args.prompt);
  const idempotencyKey = validateIdempotencyKey(args.idempotencyKey);

  if (!args.yes) {
    throwAppError(
      'CURSOR_CONFIRMATION_REQUIRED',
      'follow-up requires --yes to confirm.'
    );
  }
  if (deps.env['YELLOW_REMOTE_AGENT_CONTEXT']) {
    throwAppError(
      'CURSOR_NESTED_DELEGATION',
      'refusing to send a follow-up from inside a remote agent run.'
    );
  }

  const info = await deps.adapter.getAgent(agentId);
  if (info.archived) {
    throwAppError(
      'CURSOR_INVALID_INPUT',
      `agent ${agentId} is archived; unarchive it before sending a follow-up.`
    );
  }

  const handle = await deps.adapter.resumeAgent(agentId);
  const run = await sendWithOutcomeTracking(
    handle,
    prompt,
    idempotencyKey,
    deps.clock
  );
  const branch = run.branches[0];

  const index = await readHealthyIndex(deps.stateFilePath);
  const existing = findByAgentId(index, agentId);
  await upsertRecord(deps.stateFilePath, {
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

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

export interface StatusArgs {
  readonly agentId: string;
  readonly runId?: string;
  readonly reconcile: boolean;
}

export interface StatusResult {
  readonly operation: 'status';
  readonly agentId: string;
  readonly agentStatus?: string;
  readonly archived: boolean;
  readonly repository?: string;
  readonly run?: {
    readonly id: string;
    readonly status: string;
    readonly requestId?: string;
    readonly targetBranch?: string;
    readonly pullRequestUrl?: string;
    readonly result?: string;
    readonly errorMessage?: string;
  };
  readonly drift?: boolean;
}

export async function status(
  deps: RuntimeDeps,
  args: StatusArgs
): Promise<StatusResult> {
  const agentId = validateAgentId(args.agentId);
  const info = await deps.adapter.getAgent(agentId);

  let run: AdapterRun | undefined;
  if (args.runId !== undefined) {
    const runId = validateRunId(args.runId);
    run = await deps.adapter.getRun(runId, agentId);
  }

  const index = await readHealthyIndex(deps.stateFilePath);
  const localRecord = findByAgentId(index, agentId);
  const idempotencyKey =
    localRecord?.idempotencyKey ?? info.metadata['yellowIdempotencyKey'];
  let drift: boolean | undefined;

  if (
    (args.reconcile || localRecord !== undefined) &&
    idempotencyKey !== undefined
  ) {
    const agentStatus = info.status ?? localRecord?.status ?? 'unknown';
    drift =
      localRecord !== undefined &&
      info.status !== undefined &&
      localRecord.status !== info.status;
    const branch = run?.branches[0];
    await upsertRecord(deps.stateFilePath, {
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

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

export interface ListArgs {
  readonly cursor?: string;
  /**
   * Include archived agents. Off by default so `/cursor:archive` genuinely
   * hides an agent from the default listing, per that command's contract.
   * Requested service-side rather than filtered here: dropping archived rows
   * from an already-fetched page would yield an empty `items` alongside a
   * `nextCursor`, which reads as "no agents" to the caller.
   */
  readonly archived?: boolean;
}

export interface ListItem {
  readonly agentId: string;
  readonly name: string;
  readonly status?: string;
  readonly archived: boolean;
  readonly repository?: string;
  readonly localStatus?: string;
  readonly drift: boolean;
}

export interface ListResult {
  readonly operation: 'list';
  readonly items: readonly ListItem[];
  readonly nextCursor?: string;
}

export async function list(
  deps: RuntimeDeps,
  args: ListArgs
): Promise<ListResult> {
  const cursor = validateCursor(args.cursor);
  const result = await deps.adapter.listAgents({
    includeArchived: args.archived === true,
    ...(cursor !== undefined ? { cursor } : {}),
  });
  const index = await readHealthyIndex(deps.stateFilePath);

  const items = result.items.map((info) => {
    const idempotencyKey = info.metadata['yellowIdempotencyKey'];
    const local =
      idempotencyKey !== undefined
        ? findByIdempotencyKey(index, idempotencyKey)
        : findByAgentId(index, info.agentId);
    const drift =
      local !== undefined && local.status !== (info.status ?? local.status);
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

// ---------------------------------------------------------------------------
// cancel
// ---------------------------------------------------------------------------

export interface CancelArgs {
  readonly runId: string;
  readonly agentId: string;
  readonly yes: boolean;
}

export interface CancelResult {
  readonly operation: 'cancel';
  readonly agentId: string;
  readonly runId: string;
  readonly status: string;
  readonly alreadyTerminal: boolean;
}

export async function cancel(
  deps: RuntimeDeps,
  args: CancelArgs
): Promise<CancelResult> {
  const agentId = validateAgentId(args.agentId);
  const runId = validateRunId(args.runId);

  if (!args.yes) {
    throwAppError(
      'CURSOR_CONFIRMATION_REQUIRED',
      'cancel requires --yes to confirm.'
    );
  }

  const run = await deps.adapter.getRun(runId, agentId);
  if (TERMINAL_RUN_STATUSES.has(run.status)) {
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

// ---------------------------------------------------------------------------
// archive / unarchive
// ---------------------------------------------------------------------------

export interface ArchiveArgs {
  readonly agentId: string;
  readonly yes: boolean;
  readonly force: boolean;
}

export interface ArchiveResult {
  readonly operation: 'archive' | 'unarchive';
  readonly agentId: string;
  readonly alreadyInState: boolean;
}

export async function archive(
  deps: RuntimeDeps,
  args: ArchiveArgs
): Promise<ArchiveResult> {
  const agentId = validateAgentId(args.agentId);
  if (!args.yes) {
    throwAppError(
      'CURSOR_CONFIRMATION_REQUIRED',
      'archive requires --yes to confirm.'
    );
  }

  const info = await deps.adapter.getAgent(agentId);
  if (info.archived) {
    return { operation: 'archive', agentId, alreadyInState: true };
  }
  if (info.status === 'running' && !args.force) {
    throwAppError(
      'CURSOR_AGENT_BUSY',
      `agent ${agentId} has an active run; pass --force to archive anyway.`
    );
  }

  await deps.adapter.archiveAgent(agentId);
  await touchLocalRecordForAgent(deps, agentId, 'archived');
  return { operation: 'archive', agentId, alreadyInState: false };
}

export async function unarchive(
  deps: RuntimeDeps,
  args: { agentId: string; yes: boolean }
): Promise<ArchiveResult> {
  const agentId = validateAgentId(args.agentId);
  if (!args.yes) {
    throwAppError(
      'CURSOR_CONFIRMATION_REQUIRED',
      'unarchive requires --yes to confirm.'
    );
  }

  const info = await deps.adapter.getAgent(agentId);
  if (!info.archived) {
    return { operation: 'unarchive', agentId, alreadyInState: true };
  }

  await deps.adapter.unarchiveAgent(agentId);
  await touchLocalRecordForAgent(deps, agentId, info.status ?? 'unknown');
  return { operation: 'unarchive', agentId, alreadyInState: false };
}

// ---------------------------------------------------------------------------
// artifacts
// ---------------------------------------------------------------------------

export interface ArtifactsArgs {
  readonly agentId: string;
  readonly download?: string;
  readonly out?: string;
}

export interface ArtifactsResult {
  readonly operation: 'artifacts';
  readonly agentId: string;
  readonly items?: readonly AdapterArtifact[];
  readonly downloaded?: {
    readonly remotePath: string;
    readonly localPath: string;
    readonly bytes: number;
  };
}

async function writeArtifactFile(
  downloadRoot: string,
  localPath: string,
  buffer: Buffer
): Promise<void> {
  await ensureContainedPathForWrite(downloadRoot, localPath);
  await fs.promises.writeFile(localPath, buffer, { mode: 0o600 });
}

export async function artifacts(
  deps: RuntimeDeps,
  args: ArtifactsArgs
): Promise<ArtifactsResult> {
  const agentId = validateAgentId(args.agentId);

  if (args.download === undefined) {
    const result = await deps.adapter.listArtifacts(agentId);
    if (!result.supported) {
      throwAppError('CURSOR_UNSUPPORTED_CAPABILITY', result.reason);
    }
    return { operation: 'artifacts', agentId, items: result.value };
  }

  if (args.out === undefined) {
    throwAppError(
      'CURSOR_INVALID_INPUT',
      '--download requires --out <local-path>'
    );
  }
  const remotePath = validateArtifactRemotePath(args.download);
  const downloadRoot = resolveArtifactDownloadDir(deps.dataDir);
  const localPath = resolveLocalOutPath(downloadRoot, args.out);
  const buffer = await deps.adapter.downloadArtifact(agentId, remotePath);
  await writeArtifactFile(downloadRoot, localPath, buffer);
  return {
    operation: 'artifacts',
    agentId,
    downloaded: { remotePath, localPath, bytes: buffer.length },
  };
}

// ---------------------------------------------------------------------------
// usage
// ---------------------------------------------------------------------------

export interface UsageArgs {
  readonly agentId: string;
}

export interface UsageResult {
  readonly operation: 'usage';
  readonly agentId: string;
  readonly usage: AdapterUsage;
}

export async function usage(
  deps: RuntimeDeps,
  args: UsageArgs
): Promise<UsageResult> {
  const agentId = validateAgentId(args.agentId);
  const result = await deps.adapter.getUsage(agentId);
  if (!result.supported) {
    throwAppError('CURSOR_UNSUPPORTED_CAPABILITY', result.reason);
  }
  return { operation: 'usage', agentId, usage: result.value };
}
