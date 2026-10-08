/**
 * Helpers shared by runtime.ts, mutations.ts, reconcile.ts, supervise.ts and
 * authorize.ts: the dependency bag, the one-adapter-per-invocation wrapper,
 * the bounded read, the status vocabulary, session resolution, and the R13
 * policy check. Split out of runtime.ts so the new write-side modules can use
 * them without importing the (large) operation layer back.
 */

import { prepareDataDir, resolvePluginRoot } from './config.js';
import { type Deadline, isExpired, withReadRetry } from './deadline.js';
import {
  AdapterError,
  AppErrorException,
  mapAdapterError,
  throwAppError,
} from './errors.js';
import type { SdkProbe } from './sdk-resolver.js';
import {
  ensureObservedRecord,
  findByLocalId,
  findBySessionResource,
  recordDeviation,
} from './state.js';
import type {
  AdapterSession,
  Clock,
  Journal,
  OperationRecord,
  SdkAdapter,
} from './types.js';
import { parseSessionRef, validatePullRequestUrl } from './validate.js';

export interface RuntimeDeps {
  /** Resolves the SDK and connects lazily; only called by operations that read from the vendor. */
  readonly adapterFactory: () => Promise<SdkAdapter>;
  readonly clock: Clock;
  readonly env: NodeJS.ProcessEnv;
  readonly dataDir: string;
  readonly pluginRoot?: string;
  readonly cwd?: string;
  readonly probeSdk?: (dataDir: string) => SdkProbe;
  readonly installSdk?: (
    dataDir: string,
    options?: { readonly deadlineMs: number }
  ) => Promise<SdkProbe>;
  /** Test seam for the aggregate staging cap; production uses AGGREGATE_ARTIFACT_CAP_BYTES. */
  readonly aggregateCapBytes?: number;
}

export const REAL_CLOCK: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export function nowFn(deps: RuntimeDeps): () => Date {
  return () => new Date(deps.clock.now());
}

export function prepare(deps: RuntimeDeps): void {
  prepareDataDir(deps.dataDir, {
    pluginRoot: deps.pluginRoot ?? resolvePluginRoot(),
    cwd: deps.cwd ?? process.cwd(),
  });
}

/** Every vendor read goes through one adapter per invocation, closed (scratch tripwire) before returning. */
export async function withAdapter<T>(
  deps: RuntimeDeps,
  fn: (adapter: SdkAdapter) => Promise<T>
): Promise<T> {
  const adapter = await deps.adapterFactory();
  let result: T;
  try {
    result = await fn(adapter);
  } catch (err) {
    try {
      await adapter.close();
    } catch (closeErr) {
      // A scratch-tripwire violation is the more severe invariant failure; it outranks the operation's own error.
      if (
        closeErr instanceof AppErrorException &&
        closeErr.appError.code === 'JULES_SDK_INTEGRITY'
      )
        throw closeErr;
    }
    throw err;
  }
  await adapter.close();
  return result;
}

/** Adapter failures on a read are mapped with the pre-dispatch/read column; nothing here is after dispatch. */
export async function read<T>(
  deps: RuntimeDeps,
  deadline: Deadline,
  fn: () => Promise<T>
): Promise<T> {
  if (isExpired(deps.clock, deadline)) {
    return throwAppError(
      'JULES_DEADLINE_EXCEEDED',
      'the operation deadline expired before the read',
      {
        recoveryAction: 'Retry with a larger --deadline-ms.',
      }
    );
  }
  try {
    return await withReadRetry(fn, { clock: deps.clock, deadline });
  } catch (err) {
    if (err instanceof AdapterError) {
      const app = mapAdapterError(err, 'read');
      return throwAppError(app.code, app.message, {
        ...(app.requestId !== undefined ? { requestId: app.requestId } : {}),
      });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Status vocabulary (R10) and the attention envelope
// ---------------------------------------------------------------------------

const CONDITION_BY_STATE: Readonly<Record<string, string>> = Object.freeze({
  queued: 'starting',
  planning: 'starting',
  awaitingPlanApproval: 'awaiting-approval',
  awaitingUserFeedback: 'awaiting-reply',
  inProgress: 'working',
  paused: 'paused',
  failed: 'failed',
  completed: 'remote-completed',
});

/** Unknown states — including `unspecified` — are never placed in a completed bucket. */
export function conditionOf(vendorState: string): string {
  return Object.prototype.hasOwnProperty.call(CONDITION_BY_STATE, vendorState)
    ? (CONDITION_BY_STATE[vendorState] as string)
    : 'needs-inspection';
}

export interface Attention {
  readonly requiresAttention?: true;
  readonly attention?: readonly string[];
}

export function attentionOf(flags: readonly string[]): Attention {
  return flags.length > 0 ? { requiresAttention: true, attention: flags } : {};
}

// ---------------------------------------------------------------------------
// shared: session resolution and the R13 policy check
// ---------------------------------------------------------------------------

export function resolveSessionResource(journal: Journal, ref: string): string {
  const parsed = parseSessionRef(ref);
  if (parsed.kind === 'resource') return parsed.sessionResource;
  const record = findByLocalId(journal, parsed.localId);
  if (record === undefined) {
    return throwAppError(
      'JULES_NOT_FOUND',
      `no journal record for local id ${parsed.localId}`
    );
  }
  if (record.sessionResource === undefined) {
    return throwAppError(
      'JULES_NOT_FOUND',
      `local id ${parsed.localId} has no bound session yet`,
      {
        recoveryAction:
          'Run status --reconcile to bind or release the reservation.',
      }
    );
  }
  return record.sessionResource;
}

export async function boundRecord(
  deps: RuntimeDeps,
  journal: Journal,
  sessionResource: string
): Promise<OperationRecord> {
  return (
    findBySessionResource(journal, sessionResource) ??
    (await ensureObservedRecord(deps.dataDir, sessionResource, nowFn(deps)))
  );
}

/**
 * R13: a vendor PR on a session whose create requested `autoPr: false` is a
 * policy deviation. Independently of that request, a PR value that fails
 * `validatePullRequestUrl` is always a deviation (contract: invalid values are
 * reported as `policy-deviation`). The reason carries only the validator's
 * fixed reason string; the vendor-writable URL is never echoed.
 */
export async function checkPolicyDeviation(
  deps: RuntimeDeps,
  record: OperationRecord,
  session: AdapterSession
): Promise<OperationRecord> {
  let current = record;
  for (const output of session.outputs) {
    if (output.type !== 'pullRequest') continue;
    const source = record.sourceResource ?? session.sourceResource;
    const check =
      source !== undefined
        ? validatePullRequestUrl(output.url, source)
        : ({ valid: false, reason: 'session source unknown' } as const);
    if (!check.valid) {
      current = await recordDeviation(
        deps.dataDir,
        record.localRequestId,
        {
          kind: 'policy-deviation',
          reason: `vendor pull request reference failed validation: ${check.reason}`,
        },
        nowFn(deps)
      );
      continue;
    }
    if (record.autoPrRequested !== false) continue;
    current = await recordDeviation(
      deps.dataDir,
      record.localRequestId,
      {
        kind: 'policy-deviation',
        reason:
          'vendor pull request observed on a session created with autoPr: false',
        prUrl: check.url,
      },
      nowFn(deps)
    );
  }
  return current;
}
