"use strict";
/**
 * Operation layer: one exported async function per CLI subcommand, each
 * taking a RuntimeDeps bag (the adapter factory is injected so tests use
 * fake-sdk.ts) plus its own already-parsed args. cli.ts is the only caller —
 * it owns argv, the JSON envelope, and exit codes; this module owns the
 * contract rules.
 *
 * PR2 ships reads only (`setup`, `list`, `status`, `collect`). No function
 * here issues a vendor-mutating request; `delegate`, `reply`, and `approve`
 * arrive with `authorize` in PR3 (contract "Open Question 6, decided").
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
exports.AGGREGATE_ARTIFACT_CAP_BYTES = exports.LIST_MAX_LIMIT = exports.LIST_DEFAULT_LIMIT = exports.SOURCES_PROBE_PAGE_SIZE = exports.UNSUPPORTED_CAPABILITIES = exports.REAL_CLOCK = void 0;
exports.conditionOf = conditionOf;
exports.unsupportedCapability = unsupportedCapability;
exports.setup = setup;
exports.list = list;
exports.status = status;
exports.collect = collect;
const crypto = __importStar(require("node:crypto"));
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const activity_walk_js_1 = require("./activity-walk.js");
const config_js_1 = require("./config.js");
const deadline_js_1 = require("./deadline.js");
const errors_js_1 = require("./errors.js");
const redact_js_1 = require("./redact.js");
const sdk_resolver_js_1 = require("./sdk-resolver.js");
const state_js_1 = require("./state.js");
const validate_js_1 = require("./validate.js");
exports.REAL_CLOCK = {
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
function nowFn(deps) {
    return () => new Date(deps.clock.now());
}
function prepare(deps) {
    (0, config_js_1.prepareDataDir)(deps.dataDir, {
        pluginRoot: deps.pluginRoot ?? (0, config_js_1.resolvePluginRoot)(),
        cwd: deps.cwd ?? process.cwd(),
    });
}
/** Every vendor read goes through one adapter per invocation, closed (scratch tripwire) before returning. */
async function withAdapter(deps, fn) {
    const adapter = await deps.adapterFactory();
    let result;
    try {
        result = await fn(adapter);
    }
    catch (err) {
        await adapter.close().catch(() => undefined);
        throw err;
    }
    await adapter.close();
    return result;
}
/** Adapter failures on a read are mapped with the pre-dispatch/read column; nothing here is after dispatch. */
async function read(deps, deadline, fn) {
    if ((0, deadline_js_1.isExpired)(deps.clock, deadline)) {
        return (0, errors_js_1.throwAppError)('JULES_DEADLINE_EXCEEDED', 'the operation deadline expired before the read', {
            recoveryAction: 'Retry with a larger --deadline-ms.',
        });
    }
    try {
        return await (0, deadline_js_1.withReadRetry)(fn, { clock: deps.clock, deadline });
    }
    catch (err) {
        if (err instanceof errors_js_1.AdapterError) {
            const app = (0, errors_js_1.mapAdapterError)(err, 'read');
            return (0, errors_js_1.throwAppError)(app.code, app.message, {
                ...(app.requestId !== undefined ? { requestId: app.requestId } : {}),
            });
        }
        throw err;
    }
}
// ---------------------------------------------------------------------------
// Status vocabulary (R10) and the attention envelope
// ---------------------------------------------------------------------------
const CONDITION_BY_STATE = Object.freeze({
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
function conditionOf(vendorState) {
    return Object.prototype.hasOwnProperty.call(CONDITION_BY_STATE, vendorState)
        ? CONDITION_BY_STATE[vendorState]
        : 'needs-inspection';
}
function attentionOf(flags) {
    return flags.length > 0 ? { requiresAttention: true, attention: flags } : {};
}
exports.UNSUPPORTED_CAPABILITIES = Object.freeze({
    cancel: {
        supported: false,
        reason: 'the Jules API exposes no session cancel; stop it from the Jules console',
    },
    pause: { supported: false, reason: 'the Jules API exposes no session pause' },
    resume: {
        supported: false,
        reason: 'the Jules API exposes no session resume',
    },
    cost: {
        supported: false,
        reason: 'the Jules API exposes no per-session cost',
    },
    'exactly-once': {
        supported: false,
        reason: 'the Jules API offers no idempotency key; the local request id deduplicates locally only',
    },
});
function unsupportedCapability(name) {
    const result = exports.UNSUPPORTED_CAPABILITIES[name];
    return (0, errors_js_1.throwAppError)('JULES_UNSUPPORTED_CAPABILITY', `${name} is not supported: ${result.supported ? '' : result.reason}`);
}
// ---------------------------------------------------------------------------
// setup
// ---------------------------------------------------------------------------
exports.SOURCES_PROBE_PAGE_SIZE = 20;
async function setup(deps, args) {
    prepare(deps);
    const deadline = (0, deadline_js_1.deadlineIn)(deps.clock, args.deadlineMs ?? deadline_js_1.DEFAULT_READ_DEADLINE_MS);
    const credentialSource = (0, config_js_1.hasEnvApiKey)(deps.env)
        ? 'env'
        : 'none';
    const probe = args.installSdk
        ? await (deps.installSdk ??
            ((d) => (0, sdk_resolver_js_1.installSdk)(d, {
                pluginRoot: deps.pluginRoot ?? (0, config_js_1.resolvePluginRoot)(),
            })))(deps.dataDir)
        : (deps.probeSdk ??
            ((d) => (0, sdk_resolver_js_1.probeSdkResolution)(d, {
                pluginRoot: deps.pluginRoot ?? (0, config_js_1.resolvePluginRoot)(),
            })))(deps.dataDir);
    let sourcesReachable;
    if (probe.resolution === 'missing') {
        sourcesReachable = {
            supported: false,
            reason: 'the Jules SDK is not installed',
        };
    }
    else if (credentialSource === 'none') {
        // No credential: never contact the vendor.
        sourcesReachable = { supported: false, reason: 'JULES_API_KEY is not set' };
    }
    else {
        const page = await withAdapter(deps, (adapter) => read(deps, deadline, () => adapter.listSources({ pageSize: exports.SOURCES_PROBE_PAGE_SIZE })));
        sourcesReachable =
            page.unsupportedReason !== undefined
                ? { supported: false, reason: page.unsupportedReason }
                : {
                    supported: true,
                    value: { count: page.sources.length, truncated: page.truncated },
                };
    }
    const flags = [];
    if (credentialSource === 'none')
        flags.push('credentialSource');
    if (probe.resolution === 'missing')
        flags.push('sdkResolution');
    if (!sourcesReachable.supported)
        flags.push('sourcesReachable');
    return {
        operation: 'setup',
        credentialSource,
        sdkResolution: probe.resolution,
        ...(probe.sdkVersion !== undefined ? { sdkVersion: probe.sdkVersion } : {}),
        ...(probe.sdkIntegrity !== undefined
            ? { sdkIntegrity: probe.sdkIntegrity }
            : {}),
        ...(probe.sdkEntrySha256 !== undefined
            ? { sdkEntrySha256: probe.sdkEntrySha256 }
            : {}),
        ...(args.installSdk ? { installed: true } : {}),
        sourcesReachable,
        ...attentionOf(flags),
    };
}
// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------
exports.LIST_DEFAULT_LIMIT = 20;
exports.LIST_MAX_LIMIT = 100;
async function list(deps, args) {
    prepare(deps);
    const deadline = (0, deadline_js_1.deadlineIn)(deps.clock, args.deadlineMs ?? deadline_js_1.DEFAULT_READ_DEADLINE_MS);
    const journal = await (0, state_js_1.readJournal)(deps.dataDir);
    const pageToken = args.pageToken !== undefined
        ? (0, validate_js_1.validatePageToken)(args.pageToken, 'input')
        : undefined;
    const page = await withAdapter(deps, (adapter) => read(deps, deadline, () => adapter.listSessions({
        pageSize: args.limit ?? exports.LIST_DEFAULT_LIMIT,
        ...(pageToken !== undefined ? { pageToken } : {}),
    })));
    const onPage = new Set();
    const sessions = page.sessions.map((s) => {
        onPage.add(s.sessionResource);
        const tag = (0, validate_js_1.extractTitleTag)(s.title);
        // The title tag is vendor-writable, so it is never trusted on its own:
        // a local id is shown only when the journal binds it to this session.
        const localId = (0, state_js_1.findBySessionResource)(journal, s.sessionResource)?.localId;
        return {
            ...(localId !== undefined ? { localId } : {}),
            sessionResource: s.sessionResource,
            vendorState: s.vendorState,
            condition: conditionOf(s.vendorState),
            title: tag.title,
            ...(s.createTime !== undefined ? { createTime: s.createTime } : {}),
        };
    });
    const journalOnly = Object.values(journal.operations)
        .filter((r) => r.sessionResource === undefined || !onPage.has(r.sessionResource))
        .map((r) => ({
        localId: r.localId,
        ...(r.sessionResource !== undefined
            ? { sessionResource: r.sessionResource }
            : {}),
        condition: r.condition ?? r.status,
    }));
    const nextPageToken = page.nextPageToken !== undefined
        ? (0, validate_js_1.validatePageToken)(page.nextPageToken, 'response')
        : undefined;
    return {
        operation: 'list',
        sessions,
        ...(nextPageToken !== undefined ? { nextPageToken } : {}),
        journalOnly,
    };
}
// ---------------------------------------------------------------------------
// shared: session resolution and the R13 policy check
// ---------------------------------------------------------------------------
function resolveSessionResource(journal, ref) {
    const parsed = (0, validate_js_1.parseSessionRef)(ref);
    if (parsed.kind === 'resource')
        return parsed.sessionResource;
    const record = (0, state_js_1.findByLocalId)(journal, parsed.localId);
    if (record === undefined) {
        return (0, errors_js_1.throwAppError)('JULES_NOT_FOUND', `no journal record for local id ${parsed.localId}`);
    }
    if (record.sessionResource === undefined) {
        return (0, errors_js_1.throwAppError)('JULES_NOT_FOUND', `local id ${parsed.localId} has no bound session yet`, {
            recoveryAction: 'Run status --reconcile to bind or release the reservation.',
        });
    }
    return record.sessionResource;
}
async function boundRecord(deps, journal, sessionResource) {
    return ((0, state_js_1.findBySessionResource)(journal, sessionResource) ??
        (await (0, state_js_1.ensureObservedRecord)(deps.dataDir, sessionResource, nowFn(deps))));
}
/**
 * R13: a vendor PR on a session whose create requested `autoPr: false` is a
 * policy deviation. External sessions (PR2: every observable session) have
 * no such request, so their PRs are collectable references only (R42).
 */
async function checkPolicyDeviation(deps, record, session) {
    let current = record;
    if (record.autoPrRequested !== false)
        return current;
    for (const output of session.outputs) {
        if (output.type !== 'pullRequest')
            continue;
        const source = record.sourceResource ?? session.sourceResource;
        const check = source !== undefined
            ? (0, validate_js_1.validatePullRequestUrl)(output.url, source)
            : undefined;
        current = await (0, state_js_1.recordDeviation)(deps.dataDir, record.localRequestId, {
            kind: 'policy-deviation',
            reason: 'vendor pull request observed on a session created with autoPr: false',
            ...(check?.valid === true ? { prUrl: check.url } : {}),
        }, nowFn(deps));
    }
    return current;
}
function renderOutputs(session) {
    return session.outputs.map((output) => {
        if (output.type === 'pullRequest') {
            const check = session.sourceResource !== undefined
                ? (0, validate_js_1.validatePullRequestUrl)(output.url, session.sourceResource)
                : undefined;
            return {
                type: 'pullRequest',
                ...(check?.valid === true ? { prUrl: check.url } : {}),
                title: output.title,
                external: true,
            };
        }
        const baseCommit = optionalBaseCommit(output.baseCommitId);
        return {
            type: 'changeSet',
            ...(baseCommit !== undefined ? { baseCommit } : {}),
            patchBytes: Buffer.byteLength(output.unidiffPatch, 'utf8'),
        };
    });
}
function optionalBaseCommit(value) {
    try {
        return (0, validate_js_1.validateBaseCommitId)(value, 'response');
    }
    catch {
        return undefined;
    }
}
/**
 * PR2 has no `delegate`, so no reservation is reachable and `--reconcile`
 * normally returns `reconciled: []`. A hand-planted unresolved record is
 * reported as `not-reached` rather than silently ignored: the reconcile
 * walk ships with `delegate` in PR3.
 */
function reconcileInPr2(journal, sessionResource) {
    return Object.values(journal.operations)
        .filter((r) => state_js_1.UNRESOLVED_STATUSES.has(r.status))
        .filter((r) => sessionResource === undefined || r.sessionResource === sessionResource)
        .map((r) => ({
        localRequestId: r.localRequestId,
        kind: r.kind,
        outcome: 'not-reached',
        reason: 'reconcile ships with delegate in PR3',
        ...(r.sessionResource !== undefined
            ? { sessionResource: r.sessionResource }
            : {}),
    }));
}
function walkStartFor(record, token) {
    const watermark = record.lastActivityCreateTime !== undefined &&
        record.lastActivityId !== undefined
        ? {
            kind: 'watermark',
            createTime: record.lastActivityCreateTime,
            activityId: record.lastActivityId,
        }
        : undefined;
    if (token !== undefined) {
        return {
            kind: 'resume',
            pageToken: token,
            fallback: watermark ?? { kind: 'session-start' },
        };
    }
    return watermark ?? { kind: 'session-start' };
}
async function status(deps, args) {
    if (args.session === undefined && !args.reconcile) {
        return (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', '--session is required unless --reconcile is given');
    }
    prepare(deps);
    const deadline = (0, deadline_js_1.deadlineIn)(deps.clock, args.deadlineMs ?? deadline_js_1.DEFAULT_READ_DEADLINE_MS);
    const journal = await (0, state_js_1.readJournal)(deps.dataDir);
    const sessionResource = args.session !== undefined
        ? resolveSessionResource(journal, args.session)
        : undefined;
    const reconciled = args.reconcile
        ? reconcileInPr2(journal, sessionResource)
        : undefined;
    const reconcileFlags = (reconciled ?? [])
        .filter((r) => r.outcome !== 'bound' && r.outcome !== 'released')
        .map((r) => `reconciled:${r.outcome}`);
    if (sessionResource === undefined) {
        return {
            operation: 'status',
            reconciled: reconciled ?? [],
            ...attentionOf(reconcileFlags),
        };
    }
    return withAdapter(deps, async (adapter) => {
        const session = await read(deps, deadline, () => adapter.getSession(sessionResource));
        let record = await boundRecord(deps, journal, sessionResource);
        const watermark = record.lastActivityCreateTime !== undefined &&
            record.lastActivityId !== undefined
            ? {
                createTime: record.lastActivityCreateTime,
                activityId: record.lastActivityId,
            }
            : undefined;
        const walk = await (0, activity_walk_js_1.walkActivities)({
            adapter,
            sessionResource,
            pageSize: activity_walk_js_1.STATUS_PAGE_SIZE,
            start: walkStartFor(record, record.resumePageToken),
            clock: deps.clock,
            deadline,
            ring: record.recentActivityIds,
            ...(watermark !== undefined ? { watermark } : {}),
            ...(record.pendingPlan !== undefined
                ? { pendingPlan: record.pendingPlan }
                : {}),
        });
        // Restart guard: a stored token the vendor rejected, or one that yielded
        // nothing new, is discarded; the second consecutive such restart fails.
        // A resumed walk that read nothing (a transient failure on its first
        // page) says nothing about progress; only a walk that read pages counts.
        const noProgress = walk.startedFromResume &&
            !walk.resumeRejected &&
            walk.pages > 0 &&
            walk.newIds.length === 0;
        const restarted = walk.startedFromResume && (walk.resumeRejected || noProgress);
        const restartCount = restarted
            ? record.resumeRestartCount + 1
            : walk.newIds.length > 0
                ? 0
                : record.resumeRestartCount;
        if (restarted && restartCount >= 2) {
            await (0, state_js_1.upsertReadState)(deps.dataDir, record.localRequestId, { resumePageToken: null, resumeRestartCount: restartCount }, nowFn(deps));
            return (0, errors_js_1.throwAppError)('JULES_NO_PROGRESS', `two consecutive activity walks for ${sessionResource} restarted without advancing`);
        }
        const { ring, dedupWindowExceeded } = (0, activity_walk_js_1.nextRing)(record.recentActivityIds, walk);
        const advance = walk.complete &&
            walk.newest !== undefined &&
            walk.newest.createTime !== '' &&
            (watermark === undefined || (0, activity_walk_js_1.compareStamp)(walk.newest, watermark) > 0);
        const resumePageToken = walk.complete || noProgress ? null : (walk.resumePageToken ?? null);
        const vendorState = session.vendorState;
        const condition = conditionOf(vendorState);
        record = await (0, state_js_1.upsertReadState)(deps.dataDir, record.localRequestId, {
            vendorState,
            condition,
            ...(advance && walk.newest !== undefined
                ? { watermark: walk.newest }
                : {}),
            resumePageToken,
            recentActivityIds: ring,
            activityCountDelta: walk.newIds.length,
            ...(walk.pendingPlan !== record.pendingPlan
                ? {
                    // Plan text is vendor-writable: redacted before it is persisted.
                    pendingPlan: walk.pendingPlan == null ? null : (0, redact_js_1.redactDeep)(walk.pendingPlan),
                }
                : {}),
            resumeRestartCount: restartCount,
        }, nowFn(deps));
        record = await checkPolicyDeviation(deps, record, session);
        const policyDeviation = (0, state_js_1.hasUnreconciledDeviation)(record);
        const flags = [];
        if (walk.partialPagination)
            flags.push('partialPagination');
        if (walk.unmappedActivity)
            flags.push('unmappedActivity');
        if (dedupWindowExceeded)
            flags.push('dedupWindowExceeded');
        if (policyDeviation)
            flags.push('policyDeviation');
        flags.push(...reconcileFlags);
        const tag = (0, validate_js_1.extractTitleTag)(session.title);
        return {
            operation: 'status',
            localId: record.localId,
            sessionResource,
            vendorState,
            condition,
            title: tag.title,
            ...(session.url !== undefined ? { url: session.url } : {}),
            activities: {
                processed: walk.processed,
                new: walk.newIds.length,
                pages: walk.pages,
                partialPagination: walk.partialPagination,
                dedupWindowExceeded,
                unmappedActivity: walk.unmappedActivity,
                ...(record.resumePageToken !== undefined
                    ? { resumePageToken: record.resumePageToken }
                    : {}),
            },
            ...(record.pendingPlan !== undefined
                ? { pendingPlan: record.pendingPlan }
                : {}),
            outputs: renderOutputs(session),
            ...(policyDeviation ? { policyDeviation: true } : {}),
            ...(reconciled !== undefined ? { reconciled } : {}),
            ...attentionOf(flags),
        };
    });
}
// ---------------------------------------------------------------------------
// collect
// ---------------------------------------------------------------------------
exports.AGGREGATE_ARTIFACT_CAP_BYTES = 100 * 1024 * 1024;
function sha256(content) {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}
/** Atomic 0600 write inside a directory ensureOwnerOnlyDir already vetted (no symlinks). */
function writeStaged(filePath, content) {
    const tmp = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
    fs.writeFileSync(tmp, content, { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, filePath);
}
const ARTIFACT_KINDS = new Set(['patch', 'pr-ref', 'generated-file']);
/** Artifacts a previous `collect` recorded in this directory's manifest; anything malformed is ignored. */
function readManifestArtifacts(dir) {
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    }
    catch {
        return [];
    }
    const list = parsed.artifacts;
    if (!Array.isArray(list))
        return [];
    return list.filter((a) => a !== null &&
        typeof a === 'object' &&
        ARTIFACT_KINDS.has(a.kind) &&
        (a.path === undefined ||
            typeof a.path === 'string') &&
        (a.sha256 === undefined ||
            /^[0-9a-f]{64}$/.test(String(a.sha256))));
}
function countFiles(dir) {
    try {
        return fs.readdirSync(dir).filter((name) => !name.includes('.tmp-')).length;
    }
    catch {
        return 0;
    }
}
/**
 * Stages artifacts under `artifacts/<local-id>/`. Seeded from the previous
 * manifest and the files on disk, so a resumed `collect` continues the
 * numbering instead of overwriting `patch.diff` or an earlier file, and the
 * manifest accumulates rather than being replaced.
 */
class Stager {
    dir;
    capBytes;
    artifacts = [];
    skipped = [];
    staged = 0;
    seenDigests = new Set();
    seenGenerated = new Set();
    seenPrs = new Set();
    patchSeq;
    generatedSeq;
    constructor(dir, capBytes) {
        this.dir = dir;
        this.capBytes = capBytes;
        for (const prior of readManifestArtifacts(dir)) {
            this.artifacts.push(prior);
            if (prior.kind === 'patch' && prior.sha256 !== undefined)
                this.seenDigests.add(prior.sha256);
            if (prior.kind === 'generated-file' && prior.sha256 !== undefined) {
                this.seenGenerated.add(`${prior.sha256}:${prior.vendorPath ?? ''}`);
            }
            if (prior.kind === 'pr-ref' && prior.prUrl !== undefined)
                this.seenPrs.add(prior.prUrl);
        }
        this.patchSeq =
            (fs.existsSync(path.join(dir, 'patch.diff')) ? 1 : 0) +
                countFiles(path.join(dir, 'patches'));
        this.generatedSeq = countFiles(path.join(dir, 'generated'));
    }
    get partialStaging() {
        return this.skipped.length > 0;
    }
    overCap(bytes) {
        return this.staged + bytes > this.capBytes;
    }
    /** Patches are staged byte-exact and scanned, never redacted (contract "Redaction" layer 8). */
    patch(unidiffPatch, baseCommitId) {
        if (unidiffPatch === '')
            return;
        const digest = sha256(unidiffPatch);
        if (this.seenDigests.has(digest))
            return;
        this.seenDigests.add(digest);
        const bytes = Buffer.byteLength(unidiffPatch, 'utf8');
        if (this.overCap(bytes)) {
            this.skipped.push({
                kind: 'patch',
                reason: 'aggregate-cap-reached',
                bytes,
            });
            return;
        }
        this.staged += bytes;
        this.patchSeq += 1;
        const rel = this.patchSeq === 1
            ? 'patch.diff'
            : path.join('patches', `${String(this.patchSeq).padStart(2, '0')}-${digest.slice(0, 12)}.diff`);
        if (this.patchSeq > 1)
            (0, config_js_1.ensureOwnerOnlyDir)(path.join(this.dir, 'patches'));
        writeStaged(path.join(this.dir, rel), unidiffPatch);
        const baseCommit = optionalBaseCommit(baseCommitId);
        this.artifacts.push({
            kind: 'patch',
            path: rel,
            sha256: digest,
            ...(baseCommit !== undefined ? { baseCommit } : {}),
            secretShapedContent: (0, redact_js_1.scanSecretShapes)(unidiffPatch),
            verification: 'unverified',
        });
    }
    /** Named locally by sequence and digest; the vendor path is recorded as redacted data only. */
    generated(vendorPath, content) {
        const bytes = Buffer.byteLength(content, 'utf8');
        if (this.overCap(bytes)) {
            this.skipped.push({
                kind: 'generated-file',
                reason: 'aggregate-cap-reached',
                bytes,
            });
            return;
        }
        const digest = sha256(content);
        const safeVendorPath = (0, redact_js_1.redact)(vendorPath);
        const key = `${digest}:${safeVendorPath}`;
        if (this.seenGenerated.has(key))
            return;
        this.seenGenerated.add(key);
        this.staged += bytes;
        this.generatedSeq += 1;
        (0, config_js_1.ensureOwnerOnlyDir)(path.join(this.dir, 'generated'));
        const rel = path.join('generated', `${String(this.generatedSeq).padStart(2, '0')}-${digest.slice(0, 12)}`);
        writeStaged(path.join(this.dir, rel), content);
        this.artifacts.push({
            kind: 'generated-file',
            path: rel,
            sha256: digest,
            vendorPath: safeVendorPath,
            secretShapedContent: (0, redact_js_1.scanSecretShapes)(content),
            verification: 'unverified',
        });
    }
    /** R42: an existing vendor PR is an external reference only, never adopted. */
    prRef(prUrl) {
        if (this.seenPrs.has(prUrl))
            return;
        this.seenPrs.add(prUrl);
        this.artifacts.push({
            kind: 'pr-ref',
            prUrl,
            secretShapedContent: false,
            verification: 'unverified',
        });
    }
}
async function collect(deps, args) {
    prepare(deps);
    const deadline = (0, deadline_js_1.deadlineIn)(deps.clock, args.deadlineMs ?? deadline_js_1.DEFAULT_COLLECT_DEADLINE_MS);
    const journal = await (0, state_js_1.readJournal)(deps.dataDir);
    const sessionResource = resolveSessionResource(journal, args.session);
    return withAdapter(deps, async (adapter) => {
        const session = await read(deps, deadline, () => adapter.getSession(sessionResource));
        let record = await boundRecord(deps, journal, sessionResource);
        record = await checkPolicyDeviation(deps, record, session);
        // Staging path derives from the local id only (R40); never from vendor data.
        const artifactsRoot = (0, config_js_1.resolveArtifactsDir)(deps.dataDir);
        (0, config_js_1.ensureOwnerOnlyDir)(artifactsRoot);
        const dir = path.join(artifactsRoot, record.localId);
        (0, config_js_1.ensureOwnerOnlyDir)(dir);
        const stager = new Stager(dir, deps.aggregateCapBytes ?? exports.AGGREGATE_ARTIFACT_CAP_BYTES);
        for (const output of session.outputs) {
            if (output.type === 'changeSet') {
                stager.patch(output.unidiffPatch, output.baseCommitId);
            }
            else if (session.sourceResource !== undefined) {
                const check = (0, validate_js_1.validatePullRequestUrl)(output.url, session.sourceResource);
                if (check.valid)
                    stager.prRef(check.url);
            }
        }
        const token = record.artifactResumePageToken;
        const walk = await (0, activity_walk_js_1.walkActivities)({
            adapter,
            sessionResource,
            pageSize: activity_walk_js_1.COLLECT_PAGE_SIZE,
            start: token !== undefined
                ? {
                    kind: 'resume',
                    pageToken: token,
                    fallback: { kind: 'session-start' },
                }
                : { kind: 'session-start' },
            clock: deps.clock,
            deadline,
            ring: record.recentActivityIds,
            onActivity: (activity) => {
                for (const artifact of activity.artifacts) {
                    if (artifact.type === 'changeSet')
                        stager.patch(artifact.unidiffPatch, artifact.baseCommitId);
                }
            },
        });
        for (const file of session.generatedFiles) {
            if (file.changeType === 'deleted' || file.content === '')
                continue;
            stager.generated(file.path, file.content);
        }
        const collectedAt = new Date(deps.clock.now()).toISOString();
        writeStaged(path.join(dir, 'manifest.json'), `${JSON.stringify({
            localId: record.localId,
            sessionResource,
            collectedAt,
            artifacts: stager.artifacts,
            skipped: stager.skipped,
            partialPagination: walk.partialPagination,
        }, null, 2)}\n`);
        const journalArtifacts = stager.artifacts.map((a) => ({
            ...a,
            sessionResource,
            collectedAt,
        }));
        record = await (0, state_js_1.recordArtifacts)(deps.dataDir, record.localRequestId, journalArtifacts, nowFn(deps));
        record = await (0, state_js_1.upsertArtifactResumeToken)(deps.dataDir, record.localRequestId, 
        // A token the vendor rejected is never re-stored; a resumed walk that
        // failed before reading keeps it (the walk returns it as resumePageToken).
        walk.complete ? null : (walk.resumePageToken ?? null), nowFn(deps));
        const partialStaging = stager.partialStaging;
        const policyDeviation = (0, state_js_1.hasUnreconciledDeviation)(record);
        const flags = [];
        if (walk.partialPagination)
            flags.push('partialPagination');
        if (walk.unmappedActivity)
            flags.push('unmappedActivity');
        if (partialStaging)
            flags.push('partialStaging');
        if (policyDeviation)
            flags.push('policyDeviation');
        return {
            operation: 'collect',
            localId: record.localId,
            sessionResource,
            artifacts: stager.artifacts,
            skipped: stager.skipped,
            activities: {
                pages: walk.pages,
                partialPagination: walk.partialPagination,
                unmappedActivity: walk.unmappedActivity,
            },
            partialStaging,
            noSupportedArtifact: stager.artifacts.length === 0 &&
                !walk.partialPagination &&
                !partialStaging,
            ...(policyDeviation ? { policyDeviation: true } : {}),
            ...attentionOf(flags),
        };
    });
}
