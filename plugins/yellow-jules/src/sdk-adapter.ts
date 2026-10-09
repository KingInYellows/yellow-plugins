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
 * Writes are exactly three: `session(config)`, `send()` and `approve()`, each
 * one POST and never retried. A write failure is classified by whether a POST
 * was dispatched (the fetch guard's POST counter): before dispatch it maps like
 * a read, after dispatch only a clear rejection keeps its code and everything
 * else is an unknown outcome (R16). Never used here: `run`, `all`, `result`,
 * `ask`, `waitFor`, `stream`, `updates`, `history`, `hydrate`, `sync` (R9).
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
import { FetchGuardRefusal, ResponseTooLarge } from './fetch-guard.js';
import { truncateRedacted } from './redact.js';
import type {
  ActivityPage,
  AdapterActivity,
  AdapterActivityArtifact,
  AdapterGeneratedFile,
  AdapterOutput,
  AdapterSession,
  AdapterSource,
  CreatedSession,
  CreateSessionRequest,
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
// Pure builders (used by the adapter; `buildCreateSessionConfig` is also exercised directly by the packed-SDK tests)
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

export type CreateSessionInput = CreateSessionRequest;

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
 * A failure of the connection itself (aborted, timed out, `fetch failed`, a
 * socket error code), as opposed to a mapper throw on a body that arrived.
 * Looks down the `cause` chain because the SDK wraps what the transport threw.
 */
function isTransportFailure(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e instanceof Error && i < 5; i++) {
    const code = (e as { code?: unknown }).code;
    if (
      e.name === 'AbortError' ||
      e.name === 'TimeoutError' ||
      (e instanceof TypeError && e.message === 'fetch failed') ||
      (typeof code === 'string' &&
        /^(ECONN|ETIMEDOUT|ENOTFOUND|EAI_|EPIPE|UND_ERR_)/.test(code))
    ) {
      return true;
    }
    e = e.cause;
  }
  return false;
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

  // An oversized body is cut by the fetch guard; the SDK may wrap it.
  for (let e: unknown = err, i = 0; e instanceof Error && i < 5; i++) {
    if (e instanceof ResponseTooLarge) return make('malformed');
    e = (e as { cause?: unknown }).cause;
  }
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
  if (isTransportFailure(err)) return make('network');
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

/** The SDK's SessionState enum: the only values rendered bare or persisted. */
const KNOWN_STATES = new Set([
  'unspecified',
  'queued',
  'planning',
  'awaitingPlanApproval',
  'awaitingUserFeedback',
  'inProgress',
  'paused',
  'failed',
  'completed',
]);
const RFC3339_RE =
  /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

/** Any state outside the known enum becomes `unspecified` (condition `needs-inspection`). */
function allowlistedState(value: unknown): string {
  return typeof value === 'string' && KNOWN_STATES.has(value)
    ? value
    : 'unspecified';
}

/** Vendor timestamps are rendered and persisted, so anything not RFC 3339 is dropped. */
function rfc3339OrEmpty(value: unknown): string {
  if (typeof value !== 'string') return '';
  const m = RFC3339_RE.exec(value);
  if (!m) return '';
  // Date.parse rolls invalid calendar dates over (2026-02-31 -> March 3), so
  // the day is checked against the month explicitly.
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  return month >= 1 && month <= 12 && probe.getUTCDate() === day ? value : '';
}

function optionalSource(value: unknown): string | undefined {
  try {
    return validateSourceResource(value, 'response');
  } catch {
    return undefined;
  }
}

export function mapSession(resource: Sdk.SessionResource): AdapterSession {
  const createTime = rfc3339OrEmpty(resource.createTime);
  const updateTime = rfc3339OrEmpty(resource.updateTime);
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
    ...(createTime !== '' ? { createTime } : {}),
    ...(updateTime !== '' ? { updateTime } : {}),
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
  const createTime = rfc3339OrEmpty(activity.createTime);
  // Plan state is ordered by time: a plan activity without a usable time
  // could neither replace nor clear the pending plan, so it fails closed
  // (listActivities turns this into unmappedActivity).
  if (
    (activity.type === 'planGenerated' || activity.type === 'planApproved') &&
    createTime === ''
  ) {
    throwAppError(
      'JULES_MALFORMED_RESPONSE',
      `plan activity ${activityId} has no usable createTime`
    );
  }
  // Messages are ordered by time too. A user message with no usable time would
  // sort before every watermark and never be recorded as outside activity, and
  // an agent message without one would lose to an older question when the
  // newest is picked, so both are malformed and the walk stops on them
  // (supervise pauses on a partial walk).
  if (
    (activity.type === 'userMessaged' || activity.type === 'agentMessaged') &&
    createTime === ''
  ) {
    throwAppError(
      'JULES_MALFORMED_RESPONSE',
      `message ${activityId} has no usable createTime`
    );
  }
  const base = {
    activityId,
    createTime,
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
        // Journal validation requires a non-negative integer; fall back to
        // the array position for negative, fractional, or non-finite values.
        index:
          typeof step.index === 'number' &&
          Number.isInteger(step.index) &&
          step.index >= 0
            ? step.index
            : i,
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
  if (activity.type === 'userMessaged' || activity.type === 'agentMessaged') {
    return { ...base, message: str(activity.message) };
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
  /**
   * The fetch guard's POST counter. A write that fails with the count
   * unchanged was never dispatched. Absent, every write failure is treated as
   * dispatched (the safe default: unknown outcome unless clearly rejected).
   */
  readonly postCount?: () => number;
}

// Concurrent processes share one sdk-scratch/, and each creates then removes
// an empty `.probe-<uuid>` file to prove it is writable. Another process's
// probe is not an SDK write; anything else is.
const WRITABILITY_PROBE = /^\.probe-[0-9a-f-]{36}$/;

function assertScratchEmpty(scratch: string, when: string): void {
  const entries = fs
    .readdirSync(scratch)
    .filter((name) => !WRITABILITY_PROBE.test(name));
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
    previousJulesHome: string | undefined,
    private readonly postCount: (() => number) | undefined
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

    let built: ReturnType<typeof buildClientOptions>;
    let client: ReturnType<SdkModule['connect']>;
    try {
      built = buildClientOptions(input.sdk, {
        apiKey: input.apiKey,
        ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
      });
      client = input.sdk.connect(built.options);
      if (
        built.recorder.sessionStorages.length !== 1 ||
        client.storage !== built.recorder.sessionStorages[0]
      ) {
        throwAppError(
          'JULES_SDK_INTEGRITY',
          'the SDK did not bind the injected in-memory session storage'
        );
      }
      assertScratchEmpty(scratch, 'after connect()');
    } catch (err) {
      // No adapter exists to close, so put the environment back here.
      if (previousJulesHome === undefined) delete process.env['JULES_HOME'];
      else process.env['JULES_HOME'] = previousJulesHome;
      throw err;
    }
    const { recorder } = built;
    return new JulesSdkAdapter(
      input.sdk,
      client,
      recorder,
      scratch,
      previousJulesHome,
      input.postCount
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
      // A dropped connection is a retryable read failure, not an unmappable type.
      if (isTransportFailure(err)) return this.fail(err);
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
      if (isTransportFailure(err)) return this.fail(err);
      unsupportedReason =
        'a connected source has a type the pinned SDK cannot map';
    }
    return {
      sources,
      truncated,
      ...(unsupportedReason !== undefined ? { unsupportedReason } : {}),
    };
  }

  // -------------------------------------------------------------------------
  // Writes: one POST each, never retried
  // -------------------------------------------------------------------------

  /** A POST was sent since `before` was sampled; without a counter, assume it was. */
  private dispatchedSince(before: number | undefined): boolean {
    if (this.postCount === undefined || before === undefined) return true;
    return this.postCount() > before;
  }

  /** SDK error -> AdapterError tagged with whether a POST had been dispatched. */
  private writeFailure(
    err: unknown,
    before: number | undefined,
    sessionResource?: string
  ): AdapterError {
    const base = toAdapterError(this.sdk, err);
    return new AdapterError(base.kind, base.message, {
      ...(base.requestId !== undefined ? { requestId: base.requestId } : {}),
      ...(base.status !== undefined ? { status: base.status } : {}),
      cause: base.cause ?? err,
      dispatched: this.dispatchedSince(before),
      ...(sessionResource !== undefined ? { sessionResource } : {}),
    });
  }

  /**
   * `jules.session(config)`: the SDK reads the source (a GET) and then issues
   * one `POST sessions` with `requirePlanApproval: true` and
   * `automationMode: AUTOMATION_MODE_UNSPECIFIED` (R12). A throw while mapping
   * the answer is after dispatch by construction.
   */
  async createSession(input: CreateSessionRequest): Promise<CreatedSession> {
    const before = this.postCount?.();
    let created: Sdk.SessionClient;
    try {
      created = await this.client.session(buildCreateSessionConfig(input));
    } catch (err) {
      throw this.writeFailure(err, before);
    }
    try {
      return {
        sessionResource: validateSessionResource(
          `sessions/${String(created.id)}`,
          'response'
        ),
      };
    } catch (err) {
      throw new AdapterError(
        'malformed',
        'the created session has an unexpected shape',
        { cause: err, dispatched: true }
      );
    }
  }

  async sendMessage(sessionResource: string, message: string): Promise<void> {
    // Resolved before anything can be sent: an integrity or allowlist verdict
    // here is our own, not an SDK failure, and must not be flattened.
    const client = this.sessionClient(sessionResource);
    const before = this.postCount?.();
    try {
      await client.send(message);
    } catch (err) {
      throw this.writeFailure(err, before, sessionResource);
    }
  }

  async approvePlan(sessionResource: string): Promise<void> {
    const client = this.sessionClient(sessionResource);
    const before = this.postCount?.();
    try {
      await client.approve();
    } catch (err) {
      throw this.writeFailure(err, before, sessionResource);
    }
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
