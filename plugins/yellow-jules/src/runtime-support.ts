/**
 * Helpers shared by runtime.ts, mutations.ts, reconcile.ts, supervise.ts and
 * authorize.ts: the dependency bag, the one-adapter-per-invocation wrapper,
 * the bounded read, the status vocabulary, session resolution, and the R13
 * policy check. Split out of runtime.ts so the new write-side modules can use
 * them without importing the (large) operation layer back.
 */

import * as os from 'node:os';

import {
  prepareDataDir,
  resolveControllerDir,
  resolvePluginRoot,
} from './config.js';
import type { ControllerContext } from './controller.js';
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
import {
  confirmOnTty,
  DEFAULT_CONFIRM_DEADLINE_MS,
  type OpenTty,
} from './tty-confirm.js';
import type {
  AdapterSession,
  Clock,
  Journal,
  OperationRecord,
  SdkAdapter,
} from './types.js';
import {
  parseSessionRef,
  validateControllerId,
  validatePullRequestUrl,
} from './validate.js';

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

export function nowFn(deps: Pick<RuntimeDeps, 'clock'>): () => Date {
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

/** A session in one of these conditions is no longer working: it holds no active-session slot. */
export function isTerminalCondition(condition: string | undefined): boolean {
  return condition === 'remote-completed' || condition === 'failed';
}

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

// ---------------------------------------------------------------------------
// Write-path deps shared by authorize, mutations, supervise and write-gate
// ---------------------------------------------------------------------------

/** Set by the supervision skill for the duration of a pass; the owner-only commands (`authorize`, `--take-over`, `abandon`, `--clear-pause`) refuse while it is set (R30). */
export const ACTIVE_GRANT_ENV = 'YELLOW_JULES_ACTIVE_GRANT';

export interface WriteDeps extends RuntimeDeps {
  readonly openTty?: OpenTty;
  /** Test seam; production resolves it with `resolveControllerDir`. */
  readonly controllerDir?: string;
  /** Test seam; production uses the sanitized host name. */
  readonly controllerId?: string;
  readonly confirmDeadlineMs?: number;
}

/** Host name made safe for the controller-id allowlist, then validated. */
export function defaultControllerId(
  hostname: () => string = os.hostname
): string {
  const cleaned = hostname()
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/^[^A-Za-z0-9]+/, '')
    .slice(0, 63);
  return validateControllerId(cleaned.length > 0 ? cleaned : 'host');
}

export function resolveControllerContext(
  deps: Pick<
    WriteDeps,
    'dataDir' | 'env' | 'controllerDir' | 'controllerId' | 'clock'
  >
): ControllerContext {
  return {
    controllerDir:
      deps.controllerDir ?? resolveControllerDir(deps.dataDir, deps.env),
    controllerId: validateControllerId(
      deps.controllerId ?? defaultControllerId()
    ),
    now: nowFn(deps),
  };
}

export function refuseInsideSupervisedSession(
  env: NodeJS.ProcessEnv,
  command = 'authorize'
): void {
  const active = env[ACTIVE_GRANT_ENV];
  if (active !== undefined && active !== '') {
    throwAppError(
      'JULES_AUTHORITY_DENIED',
      `${command} cannot run inside a supervised session; a grant is never created or widened from under another grant`,
      {
        recoveryAction:
          'End the supervised session and run authorize yourself in a terminal.',
      }
    );
  }
}

/** The owner's typed confirmation on the controlling terminal (the only trust root). */
export function confirmOwner(deps: WriteDeps, summary: string): Promise<void> {
  return confirmOnTty({
    summary,
    deadlineMs: deps.confirmDeadlineMs ?? DEFAULT_CONFIRM_DEADLINE_MS,
    ...(deps.openTty !== undefined ? { openTty: deps.openTty } : {}),
  });
}
