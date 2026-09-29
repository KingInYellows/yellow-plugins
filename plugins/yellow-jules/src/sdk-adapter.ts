/**
 * The only file that touches the `@google/jules-sdk` API (R2): type imports
 * plus the module namespace handed in by sdk-resolver.ts. Everything that
 * leaves this file is a normalized, validated shape from types.ts.
 *
 * Client configuration is fixed by the contract's transport verdict:
 * `config.requestTimeoutMs: 60000`, the retry knob nested as
 * `config.rateLimitRetry.maxRetryTimeMs: 0` (a top-level `rateLimitRetry` is
 * silently ignored), and a recording in-memory `storageFactory` whose
 * bindings are asserted after `connect()` and on first per-session use.
 *
 * PR2 exposes reads only. `buildCreateSessionConfig` is a pure builder for
 * the packed-SDK transport suite; the runtime never calls `session(config)`,
 * `send()`, or `approve()` (shell 03 wires them). Never used here: `run`,
 * `all`, `result`, `ask`, `waitFor`, `stream`, `updates`, `history`,
 * `hydrate`, `sync` (R9).
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type * as Sdk from '@google/jules-sdk' with {
  'resolution-mode': 'import',
};

import { ensureOwnerOnlyDir, resolveSdkScratchDir } from './config.js';
import {
  AdapterError,
  AppErrorException,
  type AdapterErrorKind,
  type AppError,
  type CallPhase,
  mapAdapterError,
  throwAppError,
} from './errors.js';
import { FetchGuardRefusal } from './fetch-guard.js';
import { truncateRedacted } from './redact.js';
import type {
  ActivityPage,
  AdapterActivity,
  AdapterActivityArtifact,
  AdapterGeneratedFile,
  AdapterOutput,
  AdapterSession,
  AdapterSource,
  PageOptions,
  PlanStepRecord,
  SdkAdapter,
  SessionPage,
  SourcePage,
} from './types.js';
import {
  repoOfSourceResource,
  sessionIdOf,
  isValidPageToken,
  validateActivityId,
  validatePlanId,
  validateSessionDisplayUrl,
  validateSessionResource,
  validateSourceResource,
} from './validate.js';

export type SdkModule = typeof Sdk;

export const CREATE_REQUEST_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Pure builders (used by the runtime and, for create, only by tests in PR2)
// ---------------------------------------------------------------------------

export interface StorageRecorder {
  readonly sessionStorages: object[];
  readonly activityStorages: Map<string, object[]>;
}

export interface ClientOptionsInput {
  readonly apiKey: string;
  /** Test seam only: a 127.0.0.1 origin. Never from config, env, or argv. */
  readonly baseUrl?: string;
}

export function buildClientOptions(
  sdk: Pick<SdkModule, 'MemoryStorage' | 'MemorySessionStorage'>,
  input: ClientOptionsInput
): { options: Sdk.JulesOptions; recorder: StorageRecorder } {
  const recorder: StorageRecorder = {
    sessionStorages: [],
    activityStorages: new Map(),
  };
  const options: Sdk.JulesOptions = {
    apiKey: input.apiKey,
    config: {
      requestTimeoutMs: CREATE_REQUEST_TIMEOUT_MS,
      rateLimitRetry: { maxRetryTimeMs: 0 },
    },
    storageFactory: {
      activity: (sessionId: string) => {
        const storage = new sdk.MemoryStorage();
        const list = recorder.activityStorages.get(sessionId) ?? [];
        list.push(storage);
        recorder.activityStorages.set(sessionId, list);
        return storage;
      },
      session: () => {
        const storage = new sdk.MemorySessionStorage();
        recorder.sessionStorages.push(storage);
        return storage;
      },
    },
    ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
  };
  return { options, recorder };
}

export interface CreateSessionInput {
  readonly prompt: string;
  readonly owner: string;
  readonly repo: string;
  readonly baseBranch: string;
  readonly title: string;
}

/** R12: plan approval required and vendor auto-PR off, always explicit. */
export function buildCreateSessionConfig(
  input: CreateSessionInput
): Sdk.SessionConfig {
  return {
    prompt: input.prompt,
    title: input.title,
    source: {
      github: `${input.owner}/${input.repo}`,
      baseBranch: input.baseBranch,
    },
    requireApproval: true,
    autoPr: false,
  };
}

// ---------------------------------------------------------------------------
// Error classification (instanceof, most-derived first)
// ---------------------------------------------------------------------------

export type SdkErrorClasses = Pick<
  SdkModule,
  | 'JulesError'
  | 'JulesNetworkError'
  | 'JulesApiError'
  | 'JulesAuthenticationError'
  | 'JulesRateLimitError'
  | 'MissingApiKeyError'
  | 'SourceNotFoundError'
  | 'TimeoutError'
  | 'InvalidStateError'
>;

function kindForApiStatus(status: number, url: string): AdapterErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate-limited';
  if (status === 404)
    return /\/sources(?:\/|$|\?)/.test(url) ? 'source-not-found' : 'not-found';
  if (status === 400 || status === 409 || status === 422)
    return 'invalid-request';
  if (status >= 500 && status <= 599) return 'server-error';
  return 'malformed';
}

/**
 * SDK error -> transport-neutral AdapterError. Message text is never used to
 * classify, and it is redacted and cut to 512 bytes before it leaves here
 * (JulesApiError embeds the response body in its message).
 */
export function toAdapterError(
  sdk: SdkErrorClasses,
  err: unknown
): AdapterError {
  if (err instanceof AdapterError) return err;
  const message = truncateRedacted(
    err instanceof Error ? err.message : String(err)
  );
  const make = (kind: AdapterErrorKind, status?: number): AdapterError =>
    new AdapterError(kind, message, {
      ...(status !== undefined ? { status } : {}),
      cause: err,
    });

  if (err instanceof sdk.JulesRateLimitError)
    return make('rate-limited', err.status);
  if (err instanceof sdk.JulesAuthenticationError)
    return make('auth', err.status);
  if (err instanceof sdk.MissingApiKeyError) return make('auth');
  if (err instanceof sdk.SourceNotFoundError) return make('source-not-found');
  if (err instanceof sdk.JulesApiError)
    return make(kindForApiStatus(err.status, err.url), err.status);
  if (err instanceof sdk.JulesNetworkError) return make('network');
  if (err instanceof sdk.InvalidStateError) return make('invalid-state');
  if (err instanceof sdk.TimeoutError) return make('timeout');
  return make('malformed');
}

/** The contract's SDK-class table by phase; after dispatch, anything unclear is JULES_UNKNOWN_OUTCOME. */
export function classifyAdapterError(
  sdk: SdkErrorClasses,
  err: unknown,
  phase: CallPhase
): AppError {
  return mapAdapterError(toAdapterError(sdk, err), phase);
}

// ---------------------------------------------------------------------------
// Response mapping (validate every id before it leaves the adapter, R7)
// ---------------------------------------------------------------------------

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function mapOutput(output: Sdk.SessionOutput): AdapterOutput {
  if (output.type === 'pullRequest') {
    return {
      type: 'pullRequest',
      url: str(output.pullRequest?.url),
      title: str(output.pullRequest?.title),
      description: str(output.pullRequest?.description),
    };
  }
  return {
    type: 'changeSet',
    source: str(output.changeSet?.source),
    unidiffPatch: str(output.changeSet?.gitPatch?.unidiffPatch),
    baseCommitId: str(output.changeSet?.gitPatch?.baseCommitId),
    suggestedCommitMessage: str(
      output.changeSet?.gitPatch?.suggestedCommitMessage
    ),
  };
}

const STATE_RE = /^[A-Za-z_]{1,64}$/;
const RFC3339_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/** Unknown or non-enum-shaped states become `unspecified` (condition `needs-inspection`). */
function allowlistedState(value: unknown): string {
  return typeof value === 'string' && STATE_RE.test(value)
    ? value
    : 'unspecified';
}

/** Vendor timestamps are rendered and persisted, so anything not RFC 3339 is dropped. */
function rfc3339OrEmpty(value: unknown): string {
  return typeof value === 'string' && RFC3339_RE.test(value) ? value : '';
}

function optionalSource(value: unknown): string | undefined {
  try {
    return validateSourceResource(value, 'response');
  } catch {
    return undefined;
  }
}

export function mapSession(resource: Sdk.SessionResource): AdapterSession {
  const sessionResource = validateSessionResource(resource.name, 'response');
  const sourceResource = optionalSource(resource.sourceContext?.source);
  const startingBranch =
    resource.sourceContext?.githubRepoContext?.startingBranch;
  const url = validateSessionDisplayUrl(resource.url);
  const generatedFiles: AdapterGeneratedFile[] = (
    resource.generatedFiles ?? []
  ).map((f) => ({
    path: str(f.path),
    changeType: str(f.changeType),
    content: str(f.content),
  }));
  return {
    sessionResource,
    // Server-set enum text, but rendered bare and persisted: allowlisted.
    vendorState: allowlistedState(resource.state),
    title: str(resource.title),
    ...(rfc3339OrEmpty(resource.createTime) !== ''
      ? { createTime: rfc3339OrEmpty(resource.createTime) }
      : {}),
    ...(typeof resource.updateTime === 'string'
      ? { updateTime: resource.updateTime }
      : {}),
    ...(sourceResource !== undefined ? { sourceResource } : {}),
    ...(typeof startingBranch === 'string' ? { startingBranch } : {}),
    ...(url !== undefined ? { url } : {}),
    outputs: (resource.outputs ?? []).map(mapOutput),
    generatedFiles,
    archived: resource.archived === true,
  };
}

function mapArtifact(artifact: Sdk.Artifact): AdapterActivityArtifact {
  if (artifact.type === 'changeSet') {
    return {
      type: 'changeSet',
      source: str(artifact.source),
      unidiffPatch: str(artifact.gitPatch?.unidiffPatch),
      baseCommitId: str(artifact.gitPatch?.baseCommitId),
      suggestedCommitMessage: str(artifact.gitPatch?.suggestedCommitMessage),
    };
  }
  // bashOutput and media are never staged as files (contract "Redaction" layer 8).
  return { type: artifact.type === 'media' ? 'media' : 'bashOutput' };
}

export function mapActivity(activity: Sdk.Activity): AdapterActivity {
  const activityId = validateActivityId(activity.id, 'response');
  const base = {
    activityId,
    createTime: rfc3339OrEmpty(activity.createTime),
    type: str(activity.type),
    ...(typeof activity.originator === 'string'
      ? { originator: activity.originator }
      : {}),
    artifacts: (activity.artifacts ?? []).map(mapArtifact),
  };
  if (activity.type === 'planGenerated') {
    const steps: PlanStepRecord[] = (activity.plan?.steps ?? []).map(
      (step, i) => ({
        id: validatePlanId(step.id, 'response'),
        title: str(step.title),
        ...(typeof step.description === 'string'
          ? { description: step.description }
          : {}),
        index: typeof step.index === 'number' ? step.index : i,
      })
    );
    return {
      ...base,
      plan: { planId: validatePlanId(activity.plan?.id, 'response'), steps },
    };
  }
  if (activity.type === 'planApproved') {
    return {
      ...base,
      approvedPlanId: validatePlanId(activity.planId, 'response'),
    };
  }
  return base;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export interface ConnectInput {
  readonly sdk: SdkModule;
  readonly dataDir: string;
  readonly apiKey: string;
  readonly baseUrl?: string;
}

function assertScratchEmpty(scratch: string, when: string): void {
  const entries = fs.readdirSync(scratch);
  if (entries.length > 0) {
    throwAppError(
      'JULES_SDK_INTEGRITY',
      `sdk-scratch/ is not empty ${when}; the SDK wrote to disk`
    );
  }
}

function proveWritable(scratch: string): void {
  const probe = path.join(scratch, `.probe-${crypto.randomUUID()}`);
  try {
    fs.writeFileSync(probe, '', { mode: 0o600, flag: 'wx' });
    fs.unlinkSync(probe);
  } catch {
    throwAppError('JULES_DATA_DIR', 'sdk-scratch/ is not writable');
  }
}

export class JulesSdkAdapter implements SdkAdapter {
  private readonly sessionClients = new Map<string, Sdk.SessionClient>();
  private readonly infoReads = new Map<string, Promise<AdapterSession>>();
  private readonly previousJulesHome: string | undefined;

  private constructor(
    private readonly sdk: SdkModule,
    private readonly client: Sdk.JulesClient,
    private readonly recorder: StorageRecorder,
    private readonly scratch: string,
    previousJulesHome: string | undefined
  ) {
    this.previousJulesHome = previousJulesHome;
  }

  /**
   * Creates and proves `sdk-scratch/` before connecting, points JULES_HOME
   * at it for this process only (defense in depth: the default file storage
   * would otherwise write `.jules/cache/` into a cwd holding a package.json),
   * then asserts the injected session storage is the one the client uses.
   */
  static connect(input: ConnectInput): JulesSdkAdapter {
    const scratch = resolveSdkScratchDir(input.dataDir);
    ensureOwnerOnlyDir(scratch);
    proveWritable(scratch);
    assertScratchEmpty(scratch, 'before connect()');
    const previousJulesHome = process.env['JULES_HOME'];
    process.env['JULES_HOME'] = scratch;

    const { options, recorder } = buildClientOptions(input.sdk, {
      apiKey: input.apiKey,
      ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
    });
    const client = input.sdk.connect(options);
    if (
      recorder.sessionStorages.length !== 1 ||
      client.storage !== recorder.sessionStorages[0]
    ) {
      throwAppError(
        'JULES_SDK_INTEGRITY',
        'the SDK did not bind the injected in-memory session storage'
      );
    }
    assertScratchEmpty(scratch, 'after connect()');
    return new JulesSdkAdapter(
      input.sdk,
      client,
      recorder,
      scratch,
      previousJulesHome
    );
  }

  /** Our own verdicts (an integrity or allowlist failure) pass through; SDK errors are classified. */
  private fail(err: unknown): never {
    if (err instanceof AppErrorException) throw err;
    throw toAdapterError(this.sdk, err);
  }

  /** `session(id)` is local; on first use assert the activity storage came from the factory. */
  private sessionClient(sessionResource: string): Sdk.SessionClient {
    const id = sessionIdOf(sessionResource);
    const existing = this.sessionClients.get(id);
    if (existing !== undefined) return existing;
    const sessionClient = this.client.session(id);
    const handed = this.recorder.activityStorages.get(id);
    const activities = sessionClient.activities as unknown as {
      storage?: unknown;
    };
    const bound = (sessionClient as unknown as { sessionStorage?: unknown })
      .sessionStorage;
    if (
      handed === undefined ||
      activities.storage !== handed[handed.length - 1] ||
      bound !== this.client.storage
    ) {
      throwAppError(
        'JULES_SDK_INTEGRITY',
        'the SDK did not bind the injected in-memory activity storage'
      );
    }
    this.sessionClients.set(id, sessionClient);
    return sessionClient;
  }

  /**
   * At most one `info()` per session per process (R15 fresh read): with
   * per-process memory storage and `persist: false` on every sessions page,
   * the first `info()` always reaches the network.
   */
  getSession(sessionResource: string): Promise<AdapterSession> {
    const id = sessionIdOf(sessionResource);
    const existing = this.infoReads.get(id);
    if (existing !== undefined) return existing;
    const read = (async () => {
      try {
        return mapSession(await this.sessionClient(sessionResource).info());
      } catch (err) {
        return this.fail(err);
      }
    })();
    this.infoReads.set(id, read);
    // Only a successful read is memoized: a failed one must be re-sent by the
    // bounded read retry, not answered from this cache.
    read.catch(() => {
      if (this.infoReads.get(id) === read) this.infoReads.delete(id);
    });
    return read;
  }

  async listSessions(options: PageOptions): Promise<SessionPage> {
    let page: Sdk.ListSessionsResponse;
    try {
      page = await this.client.sessions({
        pageSize: options.pageSize,
        persist: false,
        ...(options.pageToken !== undefined
          ? { pageToken: options.pageToken }
          : {}),
        ...(options.filter !== undefined ? { filter: options.filter } : {}),
      });
    } catch (err) {
      return this.fail(err);
    }
    if (
      typeof page.nextPageToken === 'string' &&
      page.nextPageToken !== '' &&
      !isValidPageToken(page.nextPageToken)
    ) {
      throw new AdapterError(
        'malformed',
        'the sessions page token has an unexpected shape'
      );
    }
    return {
      sessions: (page.sessions ?? []).map(mapSession),
      ...(typeof page.nextPageToken === 'string' && page.nextPageToken !== ''
        ? { nextPageToken: page.nextPageToken }
        : {}),
    };
  }

  /**
   * One direct network page (`ActivityClient.list`, never `history()`). A
   * mapper throw — an activity or artifact type the pinned SDK cannot parse —
   * is not an error: the page reports `unmappedActivity` and the walk stops.
   */
  async listActivities(
    sessionResource: string,
    options: PageOptions
  ): Promise<ActivityPage> {
    const sessionClient = this.sessionClient(sessionResource);
    let page: { activities: Sdk.Activity[]; nextPageToken?: string };
    try {
      page = await sessionClient.activities.list({
        pageSize: options.pageSize,
        ...(options.pageToken !== undefined
          ? { pageToken: options.pageToken }
          : {}),
        ...(options.filter !== undefined ? { filter: options.filter } : {}),
      });
    } catch (err) {
      if (err instanceof this.sdk.JulesError) return this.fail(err);
      // Our own refusals are never downgraded to an "unmappable SDK type" signal.
      if (err instanceof AppErrorException || err instanceof FetchGuardRefusal)
        throw err;
      return { activities: [], unmappedActivity: true };
    }
    // An activity the SDK mapped but whose ids fail the allowlist, or a page
    // token outside it, is the same signal as a mapper throw: the walk stops
    // with unmappedActivity (re-verify the SDK pin), never a retried error.
    let activities: AdapterActivity[];
    try {
      activities = (page.activities ?? []).map(mapActivity);
    } catch (err) {
      if (err instanceof AppErrorException) {
        return { activities: [], unmappedActivity: true };
      }
      throw err;
    }
    const token = page.nextPageToken;
    if (typeof token !== 'string' || token === '') return { activities };
    if (!isValidPageToken(token)) return { activities, unmappedActivity: true };
    return { activities, nextPageToken: token };
  }

  async getSource(owner: string, repo: string): Promise<AdapterSource> {
    let source: Sdk.Source | undefined;
    try {
      source = await this.client.sources.get({ github: `${owner}/${repo}` });
    } catch (err) {
      return this.fail(err);
    }
    if (source === undefined) {
      throw new AdapterError(
        'source-not-found',
        `no Jules source for ${owner}/${repo}`
      );
    }
    const sourceResource = validateSourceResource(source.name, 'response');
    return { sourceResource, ...repoOfSourceResource(sourceResource) };
  }

  /**
   * The SDK exposes sources only as an auto-paginating iterator, so one
   * "page" is `pageSize` items, and reading one more item (which may fetch
   * the next page) is how truncation is detected.
   */
  async listSources(options: {
    readonly pageSize: number;
  }): Promise<SourcePage> {
    const sources: AdapterSource[] = [];
    let truncated = false;
    let unsupportedReason: string | undefined;
    let seen = 0;
    try {
      for await (const source of this.client.sources({
        pageSize: options.pageSize,
      })) {
        // Count every source, mappable or not, so the probe never reads past
        // pageSize + 1 items (at most two GET sources pages).
        if (seen >= options.pageSize) {
          truncated = true;
          break;
        }
        seen += 1;
        const sourceResource = optionalSource(source.name);
        if (sourceResource === undefined) {
          unsupportedReason =
            'a connected source is not a GitHub repository this plugin can address';
          continue;
        }
        sources.push({
          sourceResource,
          ...repoOfSourceResource(sourceResource),
        });
      }
    } catch (err) {
      if (err instanceof this.sdk.JulesError) return this.fail(err);
      // Our own refusals are never downgraded to an "unmappable SDK type" signal.
      if (err instanceof AppErrorException || err instanceof FetchGuardRefusal)
        throw err;
      unsupportedReason =
        'a connected source has a type the pinned SDK cannot map';
    }
    return {
      sources,
      truncated,
      ...(unsupportedReason !== undefined ? { unsupportedReason } : {}),
    };
  }

  /** Checks the scratch tripwire again before exit and restores JULES_HOME. */
  async close(): Promise<void> {
    try {
      assertScratchEmpty(this.scratch, 'at exit');
    } finally {
      if (this.previousJulesHome === undefined)
        delete process.env['JULES_HOME'];
      else process.env['JULES_HOME'] = this.previousJulesHome;
    }
  }
}
