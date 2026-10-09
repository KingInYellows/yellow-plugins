"use strict";
/**
 * Operation layer: one exported async function per CLI subcommand, each
 * taking a RuntimeDeps bag (the adapter factory is injected so tests use
 * fake-sdk.ts) plus its own already-parsed args. cli.ts and supervise.ts are the
 * callers — cli.ts owns argv, the JSON envelope, and exit codes; this module owns the
 * contract rules.
 *
 * This module holds the reads (`setup`, `list`, `status`, `collect`) and issues
 * no vendor-mutating request. The grant-gated writes live in mutations.ts, the
 * supervision pass in supervise.ts, and reconcile in reconcile.ts.
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
exports.StagingBuffer = exports.AGGREGATE_ARTIFACT_CAP_BYTES = exports.LIST_MAX_LIMIT = exports.LIST_DEFAULT_LIMIT = exports.SOURCES_PROBE_PAGE_SIZE = exports.UNSUPPORTED_CAPABILITIES = exports.withAdapter = exports.resolveSessionResource = exports.REAL_CLOCK = exports.read = exports.prepare = exports.nowFn = exports.conditionOf = exports.checkPolicyDeviation = exports.boundRecord = exports.attentionOf = void 0;
exports.unsupportedCapability = unsupportedCapability;
exports.setup = setup;
exports.list = list;
exports.status = status;
exports.toManifestPath = toManifestPath;
exports.collect = collect;
const crypto = __importStar(require("node:crypto"));
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const activity_walk_js_1 = require("./activity-walk.js");
const config_js_1 = require("./config.js");
const deadline_js_1 = require("./deadline.js");
const errors_js_1 = require("./errors.js");
const reconcile_js_1 = require("./reconcile.js");
const redact_js_1 = require("./redact.js");
const runtime_support_js_1 = require("./runtime-support.js");
const sdk_resolver_js_1 = require("./sdk-resolver.js");
const slot_release_js_1 = require("./slot-release.js");
const state_js_1 = require("./state.js");
const validate_js_1 = require("./validate.js");
var runtime_support_js_2 = require("./runtime-support.js");
Object.defineProperty(exports, "attentionOf", { enumerable: true, get: function () { return runtime_support_js_2.attentionOf; } });
Object.defineProperty(exports, "boundRecord", { enumerable: true, get: function () { return runtime_support_js_2.boundRecord; } });
Object.defineProperty(exports, "checkPolicyDeviation", { enumerable: true, get: function () { return runtime_support_js_2.checkPolicyDeviation; } });
Object.defineProperty(exports, "conditionOf", { enumerable: true, get: function () { return runtime_support_js_2.conditionOf; } });
Object.defineProperty(exports, "nowFn", { enumerable: true, get: function () { return runtime_support_js_2.nowFn; } });
Object.defineProperty(exports, "prepare", { enumerable: true, get: function () { return runtime_support_js_2.prepare; } });
Object.defineProperty(exports, "read", { enumerable: true, get: function () { return runtime_support_js_2.read; } });
Object.defineProperty(exports, "REAL_CLOCK", { enumerable: true, get: function () { return runtime_support_js_2.REAL_CLOCK; } });
Object.defineProperty(exports, "resolveSessionResource", { enumerable: true, get: function () { return runtime_support_js_2.resolveSessionResource; } });
Object.defineProperty(exports, "withAdapter", { enumerable: true, get: function () { return runtime_support_js_2.withAdapter; } });
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
    (0, runtime_support_js_1.prepare)(deps);
    const deadline = (0, deadline_js_1.deadlineIn)(deps.clock, args.deadlineMs ?? deadline_js_1.DEFAULT_READ_DEADLINE_MS);
    const credentialSource = (0, config_js_1.hasEnvApiKey)(deps.env)
        ? 'env'
        : 'none';
    const probe = args.installSdk
        ? await (deps.installSdk ??
            ((d, o) => (0, sdk_resolver_js_1.installSdk)(d, {
                pluginRoot: deps.pluginRoot ?? (0, config_js_1.resolvePluginRoot)(),
                ...(o !== undefined ? { deadlineMs: o.deadlineMs } : {}),
            })))(deps.dataDir, { deadlineMs: (0, deadline_js_1.remainingMs)(deps.clock, deadline) })
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
        const page = await (0, runtime_support_js_1.withAdapter)(deps, (adapter) => (0, runtime_support_js_1.read)(deps, deadline, () => adapter.listSources({ pageSize: exports.SOURCES_PROBE_PAGE_SIZE })));
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
        ...(0, runtime_support_js_1.attentionOf)(flags),
    };
}
// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------
exports.LIST_DEFAULT_LIMIT = 20;
exports.LIST_MAX_LIMIT = 100;
async function list(deps, args) {
    (0, runtime_support_js_1.prepare)(deps);
    const deadline = (0, deadline_js_1.deadlineIn)(deps.clock, args.deadlineMs ?? deadline_js_1.DEFAULT_READ_DEADLINE_MS);
    const journal = await (0, state_js_1.readJournal)(deps.dataDir);
    const pageToken = args.pageToken !== undefined
        ? (0, validate_js_1.validatePageToken)(args.pageToken, 'input')
        : undefined;
    const page = await (0, runtime_support_js_1.withAdapter)(deps, (adapter) => (0, runtime_support_js_1.read)(deps, deadline, () => adapter.listSessions({
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
            condition: (0, runtime_support_js_1.conditionOf)(s.vendorState),
            title: tag.title,
            ...(s.createTime !== undefined ? { createTime: s.createTime } : {}),
        };
    });
    const journalOnly = Object.values(journal.operations)
        .filter(state_js_1.ownsSession)
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
/**
 * R32: a user message none of this plugin sent is recorded the moment ANY walk
 * sees it, because `status` advances the watermark and the dedup ring and
 * `supervise` would otherwise never see the message as new. `supervise` pauses
 * on the record. Only sessions this plugin created have a digest set to compare
 * against.
 */
async function recordOutsideActivity(deps, record, messages, walkComplete, walkStartedAt, walkSeq) {
    const pending = [];
    if (messages.length === 0 || record.kind !== 'create')
        return new Set();
    if (record.sessionResource === undefined)
        return new Set();
    await (0, state_js_1.claimOwnEchoes)(deps.dataDir, record.sessionResource, messages, {
        ownerRequestId: record.localRequestId,
        observedAt: (0, runtime_support_js_1.nowFn)(deps)().toISOString(),
        walkStartedAt,
        walkSeq,
    }, pending, walkComplete);
    return new Set(pending);
}
async function status(deps, args) {
    if (args.session === undefined && !args.reconcile) {
        return (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', '--session is required unless --reconcile is given');
    }
    (0, runtime_support_js_1.prepare)(deps);
    const deadline = (0, deadline_js_1.deadlineIn)(deps.clock, args.deadlineMs ?? deadline_js_1.DEFAULT_READ_DEADLINE_MS);
    let journal = await (0, state_js_1.readJournal)(deps.dataDir);
    const sessionResource = args.session !== undefined
        ? (0, runtime_support_js_1.resolveSessionResource)(journal, args.session)
        : undefined;
    const reconciled = args.reconcile
        ? await (0, reconcile_js_1.reconcile)(deps, journal, sessionResource, deadline)
        : undefined;
    // A reconcile may have bound a reservation to its session; look it up fresh.
    if (reconciled !== undefined && reconciled.length > 0) {
        journal = await (0, state_js_1.readJournal)(deps.dataDir);
    }
    const reconcileFlags = (reconciled ?? [])
        .filter((r) => (r.outcome !== 'bound' && r.outcome !== 'released') ||
        r.slotStuck === true)
        .map((r) => r.slotStuck === true ? 'reconciled:slotStuck' : `reconciled:${r.outcome}`);
    if (sessionResource === undefined) {
        return {
            operation: 'status',
            reconciled: reconciled ?? [],
            ...(0, runtime_support_js_1.attentionOf)(reconcileFlags),
        };
    }
    return (0, runtime_support_js_1.withAdapter)(deps, async (adapter) => {
        const session = await (0, runtime_support_js_1.read)(deps, deadline, () => adapter.getSession(sessionResource));
        let record = await (0, runtime_support_js_1.boundRecord)(deps, journal, sessionResource);
        const watermark = record.lastActivityCreateTime !== undefined &&
            record.lastActivityId !== undefined
            ? {
                createTime: record.lastActivityCreateTime,
                activityId: record.lastActivityId,
            }
            : undefined;
        const newUserMessages = [];
        // A complete walk vouches only for what it could see when it began: a
        // pause or outside marker recorded while it ran must postdate the stamp.
        const walkStartedAt = (0, runtime_support_js_1.nowFn)(deps)().toISOString();
        // The sequence orders this walk against writes and pauses exactly; the
        // timestamp above is for display (two events can share a millisecond).
        const walkSeq = await (0, state_js_1.takeSeq)(deps.dataDir);
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
            ...(record.resumeApproval !== undefined
                ? { approval: record.resumeApproval }
                : {}),
            onActivity: (activity, info) => {
                if (info.unseen &&
                    activity.type === 'userMessaged' &&
                    activity.message !== undefined) {
                    newUserMessages.push({
                        activityId: activity.activityId,
                        digest: (0, state_js_1.messageDigest)(activity.message),
                        createTime: activity.createTime,
                        observedAt: (0, runtime_support_js_1.nowFn)(deps)().toISOString(),
                    });
                }
                args.observer?.(activity, info);
            },
        });
        // Restart guard: a stored token the vendor rejected, or one that yielded
        // nothing new, is discarded; the second consecutive such restart fails.
        // A resumed walk that read nothing (a transient failure on its first
        // page) says nothing about progress; only a walk that read pages counts.
        const noProgress = walk.startedFromResume &&
            !walk.resumeRejected &&
            walk.pages > 0 &&
            !walk.unmappedActivity &&
            walk.newIds.length === 0;
        const restarted = walk.startedFromResume && (walk.resumeRejected || noProgress);
        const restartCount = restarted
            ? record.resumeRestartCount + 1
            : walk.newIds.length > 0
                ? 0
                : record.resumeRestartCount;
        if (restarted && restartCount >= 2) {
            await (0, state_js_1.upsertReadState)(deps.dataDir, record.localRequestId, { resumePageToken: null, resumeRestartCount: restartCount }, (0, runtime_support_js_1.nowFn)(deps));
            return (0, errors_js_1.throwAppError)('JULES_NO_PROGRESS', `two consecutive activity walks for ${sessionResource} restarted without advancing`);
        }
        const { ring, dedupWindowExceeded } = (0, activity_walk_js_1.nextRing)(record.recentActivityIds, walk);
        const advance = walk.complete &&
            walk.newest !== undefined &&
            walk.newest.createTime !== '' &&
            (watermark === undefined || (0, activity_walk_js_1.compareStamp)(walk.newest, watermark) > 0);
        const resumePageToken = walk.complete || noProgress ? null : (walk.resumePageToken ?? null);
        const vendorState = session.vendorState;
        const condition = (0, runtime_support_js_1.conditionOf)(vendorState);
        // Record outside evidence BEFORE the watermark/dedup ring advances: a
        // failure between the two then leaves the message re-detectable on the
        // next walk instead of lost (the write gate also sees outsideSeen first).
        // Messages only an in-flight (dispatched, unsettled) reply could explain are
        // held back: neither the watermark nor the ring may pass them, so the next
        // walk classifies them once the write has settled.
        const held = await recordOutsideActivity(deps, record, newUserMessages, walk.complete, walkStartedAt, walkSeq);
        const heldBack = held.size > 0;
        record = await (0, state_js_1.upsertReadState)(deps.dataDir, record.localRequestId, {
            vendorState,
            condition,
            ...(advance && !heldBack && walk.newest !== undefined
                ? { watermark: walk.newest }
                : {}),
            resumePageToken: heldBack ? null : resumePageToken,
            // A partial walk keeps the newest approval it read so the resumed walk
            // can pair it with the older plan; otherwise it is dropped.
            resumeApproval: !heldBack &&
                resumePageToken !== null &&
                walk.latestApproval !== undefined
                ? walk.latestApproval
                : null,
            // A walk that holds a message back has not classified it: stamping it
            // complete would let clearPause forget an older pause over that message.
            ...(walk.complete && !heldBack
                ? { completeWalkAt: walkStartedAt, completeWalkSeq: walkSeq }
                : {}),
            recentActivityIds: ring.filter((id) => !held.has(id)),
            activityCountDelta: walk.newIds.filter((id) => !held.has(id)).length,
            // The walk ran unlocked: rebase against the journal record as it is
            // when the update lands, so an overlapping status is not double-counted.
            newActivityIds: walk.newIds.filter((id) => !held.has(id)),
            rebase: {
                ring: record.recentActivityIds,
                ...(record.pendingPlan !== undefined
                    ? { pendingPlan: record.pendingPlan }
                    : {}),
                ...(record.resumeApproval !== undefined
                    ? { approval: record.resumeApproval }
                    : {}),
            },
            ...(walk.generatedPlan !== undefined
                ? { generatedPlan: walk.generatedPlan }
                : {}),
            ...(walk.pendingPlan !== record.pendingPlan
                ? {
                    // Plan text is vendor-writable: redacted before it is persisted.
                    pendingPlan: walk.pendingPlan == null ? null : (0, redact_js_1.redactDeep)(walk.pendingPlan),
                }
                : {}),
            resumeRestartCount: restartCount,
        }, (0, runtime_support_js_1.nowFn)(deps));
        record = await (0, runtime_support_js_1.checkPolicyDeviation)(deps, record, session);
        const policyDeviation = (0, state_js_1.hasUnreconciledDeviation)(record);
        // A session observed in a terminal vendor state no longer holds its
        // grant's active-session slot (tasks and corrective rounds stay spent).
        // status is a read command: a failed release keeps the slot held, which
        // only makes the grant stricter, and is reported instead of thrown.
        const slotStuck = await (0, slot_release_js_1.releaseTerminalSlot)(deps.dataDir, record, vendorState);
        const flags = [];
        if (slotStuck)
            flags.push('slotStuck');
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
                ...(walk.partialPagination && walk.stopReason !== undefined
                    ? { stopReason: walk.stopReason }
                    : {}),
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
            ...(0, runtime_support_js_1.attentionOf)(flags),
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
const MANIFEST_MAX_BYTES = 10 * 1024 * 1024;
const STAGED_PATH_RE = /^(?:patch\.diff|patches\/\d{2,}-[0-9a-f]{12}\.diff|generated\/\d{2,}-[0-9a-f]{12})$/;
/** Manifest-relative paths are always POSIX-separated, whatever the platform. */
function toManifestPath(rel, pathImpl = path) {
    return rel.split(pathImpl.sep).join('/');
}
/** Native filesystem path for a POSIX manifest-relative path. */
function stagedFsPath(dir, rel) {
    return path.join(dir, ...rel.split('/'));
}
/**
 * Artifacts a previous `collect` recorded here, rebuilt from validated fields
 * only: a staged file must still exist with the recorded digest (its secret
 * scan is recomputed), `verification` is always `unverified`, and a PR
 * reference must pass the session-source check again. Anything else in the
 * manifest is ignored — it is never trusted as data.
 */
function readManifestArtifacts(dir, sourceResource) {
    const file = path.join(dir, 'manifest.json');
    let parsed;
    try {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.size > MANIFEST_MAX_BYTES)
            return [];
        parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    catch {
        return [];
    }
    const list = parsed?.artifacts;
    if (!Array.isArray(list))
        return [];
    const out = [];
    for (const entry of list) {
        const a = (entry ?? {});
        if (a.kind === 'pr-ref') {
            const check = sourceResource !== undefined
                ? (0, validate_js_1.validatePullRequestUrl)(a.prUrl, sourceResource)
                : undefined;
            if (check?.valid === true) {
                out.push({
                    kind: 'pr-ref',
                    prUrl: check.url,
                    secretShapedContent: false,
                    verification: 'unverified',
                });
            }
            continue;
        }
        if (a.kind !== 'patch' && a.kind !== 'generated-file')
            continue;
        if (typeof a.path !== 'string')
            continue;
        // Tolerate manifests written with native (backslash) separators.
        const relPath = toManifestPath(a.path, path.win32);
        if (!STAGED_PATH_RE.test(relPath))
            continue;
        if (typeof a.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(a.sha256))
            continue;
        let bytes;
        try {
            const staged = stagedFsPath(dir, relPath);
            if (!fs.lstatSync(staged).isFile())
                continue;
            bytes = fs.readFileSync(staged);
        }
        catch {
            continue;
        }
        // Staged content was hashed as its UTF-8 bytes, so the raw file hashes the same.
        if (crypto.createHash('sha256').update(bytes).digest('hex') !== a.sha256)
            continue;
        const content = bytes.toString('utf8');
        const baseCommit = typeof a.baseCommit === 'string'
            ? optionalBaseCommit(a.baseCommit)
            : undefined;
        out.push({
            kind: a.kind,
            path: relPath,
            sha256: a.sha256,
            ...(a.kind === 'patch' && baseCommit !== undefined ? { baseCommit } : {}),
            ...(a.kind === 'generated-file' && typeof a.vendorPath === 'string'
                ? { vendorPath: (0, redact_js_1.redact)(a.vendorPath) }
                : {}),
            ...(a.kind === 'generated-file' &&
                typeof a.vendorPathDigest === 'string' &&
                /^[0-9a-f]{64}$/.test(a.vendorPathDigest)
                ? { vendorPathDigest: a.vendorPathDigest }
                : {}),
            secretShapedContent: (0, redact_js_1.scanSecretShapes)(content),
            verification: 'unverified',
        });
    }
    return out;
}
/**
 * Dedupe keys for a staged generated file. Identity is the content digest plus
 * the digest of the RAW vendor path, so two paths that redact to the same
 * string stay distinct. An entry staged before path digests existed has only
 * the redacted path, so it is matched by the legacy key.
 */
function generatedKey(digest, vendorPathDigest) {
    return `${digest}:${vendorPathDigest}`;
}
function legacyGeneratedKey(digest, safeVendorPath) {
    return `${digest}:legacy:${safeVendorPath}`;
}
/** Records a staged entry as seen under whichever key identifies it. */
function markGeneratedSeen(seen, a) {
    if (a.sha256 === undefined)
        return;
    seen.add(a.vendorPathDigest !== undefined
        ? generatedKey(a.sha256, a.vendorPathDigest)
        : legacyGeneratedKey(a.sha256, a.vendorPath ?? ''));
}
function isGeneratedSeen(seen, contentDigest, vendorPath) {
    return (seen.has(generatedKey(contentDigest, sha256(vendorPath))) ||
        seen.has(legacyGeneratedKey(contentDigest, (0, redact_js_1.redact)(vendorPath))));
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
    constructor(dir, capBytes, sourceResource) {
        this.dir = dir;
        this.capBytes = capBytes;
        for (const prior of readManifestArtifacts(dir, sourceResource)) {
            this.artifacts.push(prior);
            if (prior.kind === 'patch' && prior.sha256 !== undefined)
                this.seenDigests.add(prior.sha256);
            if (prior.kind === 'generated-file')
                markGeneratedSeen(this.seenGenerated, prior);
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
            : path.posix.join('patches', `${String(this.patchSeq).padStart(2, '0')}-${digest.slice(0, 12)}.diff`);
        if (this.patchSeq > 1)
            (0, config_js_1.ensureOwnerOnlyDir)(path.join(this.dir, 'patches'));
        writeStaged(stagedFsPath(this.dir, rel), unidiffPatch);
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
        // Dedupe before the cap check, so a file an earlier run staged is never
        // reported as skipped (which would set partialStaging for nothing).
        const digest = sha256(content);
        const safeVendorPath = (0, redact_js_1.redact)(vendorPath);
        const vendorPathDigest = sha256(vendorPath);
        if (isGeneratedSeen(this.seenGenerated, digest, vendorPath))
            return;
        this.seenGenerated.add(generatedKey(digest, vendorPathDigest));
        const bytes = Buffer.byteLength(content, 'utf8');
        if (this.overCap(bytes)) {
            this.skipped.push({
                kind: 'generated-file',
                reason: 'aggregate-cap-reached',
                bytes,
            });
            return;
        }
        this.staged += bytes;
        this.generatedSeq += 1;
        (0, config_js_1.ensureOwnerOnlyDir)(path.join(this.dir, 'generated'));
        const rel = path.posix.join('generated', `${String(this.generatedSeq).padStart(2, '0')}-${digest.slice(0, 12)}`);
        writeStaged(stagedFsPath(this.dir, rel), content);
        this.artifacts.push({
            kind: 'generated-file',
            path: rel,
            sha256: digest,
            vendorPath: safeVendorPath,
            vendorPathDigest,
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
/**
 * Bounded buffer for staging operations recorded during the unlocked vendor
 * walk and replayed under the journal lock. Bodies are retained only while the
 * running total stays within the aggregate cap (the same test `Stager` applies,
 * which also starts its total at zero for each collect); a body that would
 * exceed it is dropped and replayed as a cap-skip, so memory is bounded by the
 * cap and `skipped` / `partialStaging` stay correct. `Stager` remains the
 * authoritative enforcement under the lock.
 */
class StagingBuffer {
    capBytes;
    pending = [];
    buffered = 0;
    seenPatches = new Set();
    seenGenerated = new Set();
    constructor(capBytes) {
        this.capBytes = capBytes;
    }
    /**
     * Marks artifacts an earlier collect already staged as seen, so they neither
     * count toward the per-run cap nor queue a replay (`Stager` would discard
     * them as duplicates). An optimisation hint from an unlocked read; `Stager`
     * re-reads the manifest under the lock.
     */
    seedStaged(prior) {
        for (const a of prior) {
            if (a.sha256 === undefined)
                continue;
            if (a.kind === 'patch')
                this.seenPatches.add(a.sha256);
            else if (a.kind === 'generated-file')
                markGeneratedSeen(this.seenGenerated, a);
        }
    }
    /** Bytes of artifact bodies currently retained. */
    get bufferedBytes() {
        return this.buffered;
    }
    patch(unidiffPatch, baseCommitId) {
        if (unidiffPatch === '')
            return;
        const digest = sha256(unidiffPatch);
        if (this.seenPatches.has(digest))
            return;
        this.seenPatches.add(digest);
        const bytes = Buffer.byteLength(unidiffPatch, 'utf8');
        if (this.buffered + bytes > this.capBytes) {
            this.pending.push((s) => s.skipped.push({
                kind: 'patch',
                reason: 'aggregate-cap-reached',
                bytes,
            }));
            return;
        }
        this.buffered += bytes;
        this.pending.push((s) => s.patch(unidiffPatch, baseCommitId));
    }
    generated(vendorPath, content) {
        const contentDigest = sha256(content);
        if (isGeneratedSeen(this.seenGenerated, contentDigest, vendorPath))
            return;
        this.seenGenerated.add(generatedKey(contentDigest, sha256(vendorPath)));
        const bytes = Buffer.byteLength(content, 'utf8');
        if (this.buffered + bytes > this.capBytes) {
            this.pending.push((s) => s.skipped.push({
                kind: 'generated-file',
                reason: 'aggregate-cap-reached',
                bytes,
            }));
            return;
        }
        this.buffered += bytes;
        this.pending.push((s) => s.generated(vendorPath, content));
    }
    prRef(prUrl) {
        this.pending.push((s) => s.prRef(prUrl));
    }
}
exports.StagingBuffer = StagingBuffer;
async function collect(deps, args) {
    (0, runtime_support_js_1.prepare)(deps);
    const deadline = (0, deadline_js_1.deadlineIn)(deps.clock, args.deadlineMs ?? deadline_js_1.DEFAULT_COLLECT_DEADLINE_MS);
    const journal = await (0, state_js_1.readJournal)(deps.dataDir);
    const sessionResource = (0, runtime_support_js_1.resolveSessionResource)(journal, args.session);
    return (0, runtime_support_js_1.withAdapter)(deps, async (adapter) => {
        const session = await (0, runtime_support_js_1.read)(deps, deadline, () => adapter.getSession(sessionResource));
        let record = await (0, runtime_support_js_1.boundRecord)(deps, journal, sessionResource);
        record = await (0, runtime_support_js_1.checkPolicyDeviation)(deps, record, session);
        // Staging path derives from the local id only (R40); never from vendor data.
        const artifactsRoot = (0, config_js_1.resolveArtifactsDir)(deps.dataDir);
        (0, config_js_1.ensureOwnerOnlyDir)(artifactsRoot);
        const dir = path.join(artifactsRoot, record.localId);
        (0, config_js_1.ensureOwnerOnlyDir)(dir);
        // Vendor reads run unlocked; staging is buffered here and replayed inside
        // one critical section, so slot allocation never races another collect.
        const capBytes = deps.aggregateCapBytes ?? exports.AGGREGATE_ARTIFACT_CAP_BYTES;
        const buffer = new StagingBuffer(capBytes);
        const priorArtifacts = readManifestArtifacts(dir, session.sourceResource);
        buffer.seedStaged(priorArtifacts);
        for (const output of session.outputs) {
            if (output.type === 'changeSet') {
                buffer.patch(output.unidiffPatch, output.baseCommitId);
            }
            else if (session.sourceResource !== undefined) {
                const check = (0, validate_js_1.validatePullRequestUrl)(output.url, session.sourceResource);
                if (check.valid) {
                    const url = check.url;
                    buffer.prRef(url);
                }
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
                    if (artifact.type === 'changeSet') {
                        buffer.patch(artifact.unidiffPatch, artifact.baseCommitId);
                    }
                }
            },
        });
        for (const file of session.generatedFiles) {
            if (file.changeType === 'deleted' || file.content === '')
                continue;
            buffer.generated(file.path, file.content);
        }
        const collectedAt = new Date(deps.clock.now()).toISOString();
        // Seed from the manifest, allocate slots, rename, and rewrite the manifest
        // as one critical section. The journal lock is not reentrant, so the
        // journal write (recordArtifacts) follows after release.
        const stager = await (0, state_js_1.withJournalLock)(deps.dataDir, async () => {
            const s = new Stager(dir, capBytes, session.sourceResource);
            for (const apply of buffer.pending)
                apply(s);
            writeStaged(path.join(dir, 'manifest.json'), `${JSON.stringify({
                localId: record.localId,
                sessionResource,
                collectedAt,
                artifacts: s.artifacts,
                skipped: s.skipped,
                partialPagination: walk.partialPagination,
            }, null, 2)}\n`);
            return s;
        });
        const journalArtifacts = stager.artifacts.map((a) => ({
            ...a,
            sessionResource,
            collectedAt,
        }));
        record = await (0, state_js_1.recordArtifacts)(deps.dataDir, record.localRequestId, journalArtifacts, (0, runtime_support_js_1.nowFn)(deps));
        // Restart guard, as in `status`: a stored token the vendor rejected, or one
        // whose walk read pages, found nothing new, and handed back the same token,
        // is discarded so the next collect restarts from the session beginning; the
        // second consecutive such restart fails. Unmapped pages never count.
        // Progress is collect-owned: newly staged artifacts, not `status`'s activity
        // ring, which collect never writes (a repeated page would look new forever).
        const stagedNew = stager.artifacts.length > priorArtifacts.length;
        const noProgress = token !== undefined &&
            walk.startedFromResume &&
            !walk.resumeRejected &&
            walk.pages > 0 &&
            !walk.complete &&
            !walk.unmappedActivity &&
            !stagedNew &&
            walk.resumePageToken === token;
        const restarted = walk.startedFromResume && (walk.resumeRejected || noProgress);
        const restartCount = restarted
            ? (record.artifactResumeRestartCount ?? 0) + 1
            : stagedNew
                ? 0
                : (record.artifactResumeRestartCount ?? 0);
        const exhausted = restarted && restartCount >= 2;
        record = await (0, state_js_1.upsertArtifactResumeToken)(deps.dataDir, record.localRequestId, 
        // A token the vendor rejected is never re-stored; a resumed walk that
        // failed before reading keeps it (the walk returns it as resumePageToken).
        walk.complete || noProgress || exhausted
            ? null
            : (walk.resumePageToken ?? null), (0, runtime_support_js_1.nowFn)(deps), undefined, restartCount);
        if (exhausted) {
            return (0, errors_js_1.throwAppError)('JULES_NO_PROGRESS', `two consecutive artifact walks for ${sessionResource} restarted without advancing`);
        }
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
            ...(0, runtime_support_js_1.attentionOf)(flags),
        };
    });
}
