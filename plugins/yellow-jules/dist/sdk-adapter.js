"use strict";
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
exports.JulesSdkAdapter = exports.CREATE_REQUEST_TIMEOUT_MS = void 0;
exports.buildClientOptions = buildClientOptions;
exports.buildCreateSessionConfig = buildCreateSessionConfig;
exports.toAdapterError = toAdapterError;
exports.classifyAdapterError = classifyAdapterError;
exports.mapSession = mapSession;
exports.mapActivity = mapActivity;
const crypto = __importStar(require("node:crypto"));
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const config_js_1 = require("./config.js");
const errors_js_1 = require("./errors.js");
const redact_js_1 = require("./redact.js");
const validate_js_1 = require("./validate.js");
exports.CREATE_REQUEST_TIMEOUT_MS = 60_000;
function buildClientOptions(sdk, input) {
    const recorder = {
        sessionStorages: [],
        activityStorages: new Map(),
    };
    const options = {
        apiKey: input.apiKey,
        config: {
            requestTimeoutMs: exports.CREATE_REQUEST_TIMEOUT_MS,
            rateLimitRetry: { maxRetryTimeMs: 0 },
        },
        storageFactory: {
            activity: (sessionId) => {
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
/** R12: plan approval required and vendor auto-PR off, always explicit. */
function buildCreateSessionConfig(input) {
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
function kindForApiStatus(status, url) {
    if (status === 401 || status === 403)
        return 'auth';
    if (status === 429)
        return 'rate-limited';
    if (status === 404)
        return /\/sources(?:\/|$|\?)/.test(url) ? 'source-not-found' : 'not-found';
    if (status === 400 || status === 409 || status === 422)
        return 'invalid-request';
    if (status >= 500 && status <= 599)
        return 'server-error';
    return 'malformed';
}
/**
 * SDK error -> transport-neutral AdapterError. Message text is never used to
 * classify, and it is redacted and cut to 512 bytes before it leaves here
 * (JulesApiError embeds the response body in its message).
 */
function toAdapterError(sdk, err) {
    if (err instanceof errors_js_1.AdapterError)
        return err;
    const message = (0, redact_js_1.truncateRedacted)(err instanceof Error ? err.message : String(err));
    const make = (kind, status) => new errors_js_1.AdapterError(kind, message, {
        ...(status !== undefined ? { status } : {}),
        cause: err,
    });
    if (err instanceof sdk.JulesRateLimitError)
        return make('rate-limited', err.status);
    if (err instanceof sdk.JulesAuthenticationError)
        return make('auth', err.status);
    if (err instanceof sdk.MissingApiKeyError)
        return make('auth');
    if (err instanceof sdk.SourceNotFoundError)
        return make('source-not-found');
    if (err instanceof sdk.JulesApiError)
        return make(kindForApiStatus(err.status, err.url), err.status);
    if (err instanceof sdk.JulesNetworkError)
        return make('network');
    if (err instanceof sdk.InvalidStateError)
        return make('invalid-state');
    if (err instanceof sdk.TimeoutError)
        return make('timeout');
    return make('malformed');
}
/** The contract's SDK-class table by phase; after dispatch, anything unclear is JULES_UNKNOWN_OUTCOME. */
function classifyAdapterError(sdk, err, phase) {
    return (0, errors_js_1.mapAdapterError)(toAdapterError(sdk, err), phase);
}
// ---------------------------------------------------------------------------
// Response mapping (validate every id before it leaves the adapter, R7)
// ---------------------------------------------------------------------------
function str(value) {
    return typeof value === 'string' ? value : '';
}
function mapOutput(output) {
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
        suggestedCommitMessage: str(output.changeSet?.gitPatch?.suggestedCommitMessage),
    };
}
function optionalSource(value) {
    try {
        return (0, validate_js_1.validateSourceResource)(value, 'response');
    }
    catch {
        return undefined;
    }
}
function mapSession(resource) {
    const sessionResource = (0, validate_js_1.validateSessionResource)(resource.name, 'response');
    const sourceResource = optionalSource(resource.sourceContext?.source);
    const startingBranch = resource.sourceContext?.githubRepoContext?.startingBranch;
    const url = (0, validate_js_1.validateSessionDisplayUrl)(resource.url);
    const generatedFiles = (resource.generatedFiles ?? []).map((f) => ({
        path: str(f.path),
        changeType: str(f.changeType),
        content: str(f.content),
    }));
    return {
        sessionResource,
        vendorState: typeof resource.state === 'string' ? resource.state : 'unspecified',
        title: str(resource.title),
        ...(typeof resource.createTime === 'string'
            ? { createTime: resource.createTime }
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
function mapArtifact(artifact) {
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
function mapActivity(activity) {
    const activityId = (0, validate_js_1.validateActivityId)(activity.id, 'response');
    const base = {
        activityId,
        createTime: str(activity.createTime),
        type: str(activity.type),
        ...(typeof activity.originator === 'string'
            ? { originator: activity.originator }
            : {}),
        artifacts: (activity.artifacts ?? []).map(mapArtifact),
    };
    if (activity.type === 'planGenerated') {
        const steps = (activity.plan?.steps ?? []).map((step, i) => ({
            id: (0, validate_js_1.validatePlanId)(step.id, 'response'),
            title: str(step.title),
            ...(typeof step.description === 'string'
                ? { description: step.description }
                : {}),
            index: typeof step.index === 'number' ? step.index : i,
        }));
        return {
            ...base,
            plan: { planId: (0, validate_js_1.validatePlanId)(activity.plan?.id, 'response'), steps },
        };
    }
    if (activity.type === 'planApproved') {
        return {
            ...base,
            approvedPlanId: (0, validate_js_1.validatePlanId)(activity.planId, 'response'),
        };
    }
    return base;
}
function assertScratchEmpty(scratch, when) {
    const entries = fs.readdirSync(scratch);
    if (entries.length > 0) {
        (0, errors_js_1.throwAppError)('JULES_SDK_INTEGRITY', `sdk-scratch/ is not empty ${when}; the SDK wrote to disk`);
    }
}
function proveWritable(scratch) {
    const probe = path.join(scratch, `.probe-${crypto.randomUUID()}`);
    try {
        fs.writeFileSync(probe, '', { mode: 0o600, flag: 'wx' });
        fs.unlinkSync(probe);
    }
    catch {
        (0, errors_js_1.throwAppError)('JULES_DATA_DIR', 'sdk-scratch/ is not writable');
    }
}
class JulesSdkAdapter {
    sdk;
    client;
    recorder;
    scratch;
    sessionClients = new Map();
    infoReads = new Map();
    previousJulesHome;
    constructor(sdk, client, recorder, scratch, previousJulesHome) {
        this.sdk = sdk;
        this.client = client;
        this.recorder = recorder;
        this.scratch = scratch;
        this.previousJulesHome = previousJulesHome;
    }
    /**
     * Creates and proves `sdk-scratch/` before connecting, points JULES_HOME
     * at it for this process only (defense in depth: the default file storage
     * would otherwise write `.jules/cache/` into a cwd holding a package.json),
     * then asserts the injected session storage is the one the client uses.
     */
    static connect(input) {
        const scratch = (0, config_js_1.resolveSdkScratchDir)(input.dataDir);
        (0, config_js_1.ensureOwnerOnlyDir)(scratch);
        proveWritable(scratch);
        assertScratchEmpty(scratch, 'before connect()');
        const previousJulesHome = process.env['JULES_HOME'];
        process.env['JULES_HOME'] = scratch;
        const { options, recorder } = buildClientOptions(input.sdk, {
            apiKey: input.apiKey,
            ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
        });
        const client = input.sdk.connect(options);
        if (recorder.sessionStorages.length !== 1 ||
            client.storage !== recorder.sessionStorages[0]) {
            (0, errors_js_1.throwAppError)('JULES_SDK_INTEGRITY', 'the SDK did not bind the injected in-memory session storage');
        }
        assertScratchEmpty(scratch, 'after connect()');
        return new JulesSdkAdapter(input.sdk, client, recorder, scratch, previousJulesHome);
    }
    fail(err) {
        throw toAdapterError(this.sdk, err);
    }
    /** `session(id)` is local; on first use assert the activity storage came from the factory. */
    sessionClient(sessionResource) {
        const id = (0, validate_js_1.sessionIdOf)(sessionResource);
        const existing = this.sessionClients.get(id);
        if (existing !== undefined)
            return existing;
        const sessionClient = this.client.session(id);
        const handed = this.recorder.activityStorages.get(id);
        const activities = sessionClient.activities;
        const bound = sessionClient
            .sessionStorage;
        if (handed === undefined ||
            activities.storage !== handed[handed.length - 1] ||
            bound !== this.client.storage) {
            (0, errors_js_1.throwAppError)('JULES_SDK_INTEGRITY', 'the SDK did not bind the injected in-memory activity storage');
        }
        this.sessionClients.set(id, sessionClient);
        return sessionClient;
    }
    /**
     * At most one `info()` per session per process (R15 fresh read): with
     * per-process memory storage and `persist: false` on every sessions page,
     * the first `info()` always reaches the network.
     */
    getSession(sessionResource) {
        const id = (0, validate_js_1.sessionIdOf)(sessionResource);
        const existing = this.infoReads.get(id);
        if (existing !== undefined)
            return existing;
        const read = (async () => {
            try {
                return mapSession(await this.sessionClient(sessionResource).info());
            }
            catch (err) {
                return this.fail(err);
            }
        })();
        this.infoReads.set(id, read);
        return read;
    }
    async listSessions(options) {
        let page;
        try {
            page = await this.client.sessions({
                pageSize: options.pageSize,
                persist: false,
                ...(options.pageToken !== undefined
                    ? { pageToken: options.pageToken }
                    : {}),
                ...(options.filter !== undefined ? { filter: options.filter } : {}),
            });
        }
        catch (err) {
            return this.fail(err);
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
    async listActivities(sessionResource, options) {
        const sessionClient = this.sessionClient(sessionResource);
        let page;
        try {
            page = await sessionClient.activities.list({
                pageSize: options.pageSize,
                ...(options.pageToken !== undefined
                    ? { pageToken: options.pageToken }
                    : {}),
                ...(options.filter !== undefined ? { filter: options.filter } : {}),
            });
        }
        catch (err) {
            if (err instanceof this.sdk.JulesError)
                return this.fail(err);
            return { activities: [], unmappedActivity: true };
        }
        return {
            activities: (page.activities ?? []).map(mapActivity),
            ...(typeof page.nextPageToken === 'string' && page.nextPageToken !== ''
                ? { nextPageToken: page.nextPageToken }
                : {}),
        };
    }
    async getSource(owner, repo) {
        let source;
        try {
            source = await this.client.sources.get({ github: `${owner}/${repo}` });
        }
        catch (err) {
            return this.fail(err);
        }
        if (source === undefined) {
            throw new errors_js_1.AdapterError('source-not-found', `no Jules source for ${owner}/${repo}`);
        }
        const sourceResource = (0, validate_js_1.validateSourceResource)(source.name, 'response');
        return { sourceResource, ...(0, validate_js_1.repoOfSourceResource)(sourceResource) };
    }
    /**
     * The SDK exposes sources only as an auto-paginating iterator, so one
     * "page" is `pageSize` items, and reading one more item (which may fetch
     * the next page) is how truncation is detected.
     */
    async listSources(options) {
        const sources = [];
        let truncated = false;
        let unsupportedReason;
        try {
            for await (const source of this.client.sources({
                pageSize: options.pageSize,
            })) {
                if (sources.length >= options.pageSize) {
                    truncated = true;
                    break;
                }
                const sourceResource = optionalSource(source.name);
                if (sourceResource === undefined) {
                    unsupportedReason =
                        'a connected source is not a GitHub repository this plugin can address';
                    continue;
                }
                sources.push({
                    sourceResource,
                    ...(0, validate_js_1.repoOfSourceResource)(sourceResource),
                });
            }
        }
        catch (err) {
            if (err instanceof this.sdk.JulesError)
                return this.fail(err);
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
    async close() {
        try {
            assertScratchEmpty(this.scratch, 'at exit');
        }
        finally {
            if (this.previousJulesHome === undefined)
                delete process.env['JULES_HOME'];
            else
                process.env['JULES_HOME'] = this.previousJulesHome;
        }
    }
}
exports.JulesSdkAdapter = JulesSdkAdapter;
