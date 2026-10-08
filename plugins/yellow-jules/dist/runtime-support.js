"use strict";
/**
 * Helpers shared by runtime.ts, mutations.ts, reconcile.ts, supervise.ts and
 * authorize.ts: the dependency bag, the one-adapter-per-invocation wrapper,
 * the bounded read, the status vocabulary, session resolution, and the R13
 * policy check. Split out of runtime.ts so the new write-side modules can use
 * them without importing the (large) operation layer back.
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
exports.ACTIVE_GRANT_ENV = exports.REAL_CLOCK = void 0;
exports.nowFn = nowFn;
exports.prepare = prepare;
exports.withAdapter = withAdapter;
exports.read = read;
exports.isTerminalCondition = isTerminalCondition;
exports.conditionOf = conditionOf;
exports.attentionOf = attentionOf;
exports.resolveSessionResource = resolveSessionResource;
exports.boundRecord = boundRecord;
exports.checkPolicyDeviation = checkPolicyDeviation;
exports.defaultControllerId = defaultControllerId;
exports.resolveControllerContext = resolveControllerContext;
exports.refuseInsideSupervisedSession = refuseInsideSupervisedSession;
exports.confirmOwner = confirmOwner;
const os = __importStar(require("node:os"));
const config_js_1 = require("./config.js");
const deadline_js_1 = require("./deadline.js");
const errors_js_1 = require("./errors.js");
const state_js_1 = require("./state.js");
const tty_confirm_js_1 = require("./tty-confirm.js");
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
        try {
            await adapter.close();
        }
        catch (closeErr) {
            // A scratch-tripwire violation is the more severe invariant failure; it outranks the operation's own error.
            if (closeErr instanceof errors_js_1.AppErrorException &&
                closeErr.appError.code === 'JULES_SDK_INTEGRITY')
                throw closeErr;
        }
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
/** A session in one of these conditions is no longer working: it holds no active-session slot. */
function isTerminalCondition(condition) {
    return condition === 'remote-completed' || condition === 'failed';
}
function conditionOf(vendorState) {
    return Object.prototype.hasOwnProperty.call(CONDITION_BY_STATE, vendorState)
        ? CONDITION_BY_STATE[vendorState]
        : 'needs-inspection';
}
function attentionOf(flags) {
    return flags.length > 0 ? { requiresAttention: true, attention: flags } : {};
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
 * policy deviation. Independently of that request, a PR value that fails
 * `validatePullRequestUrl` is always a deviation (contract: invalid values are
 * reported as `policy-deviation`). The reason carries only the validator's
 * fixed reason string; the vendor-writable URL is never echoed.
 */
async function checkPolicyDeviation(deps, record, session) {
    let current = record;
    for (const output of session.outputs) {
        if (output.type !== 'pullRequest')
            continue;
        const source = record.sourceResource ?? session.sourceResource;
        const check = source !== undefined
            ? (0, validate_js_1.validatePullRequestUrl)(output.url, source)
            : { valid: false, reason: 'session source unknown' };
        if (!check.valid) {
            current = await (0, state_js_1.recordDeviation)(deps.dataDir, record.localRequestId, {
                kind: 'policy-deviation',
                reason: `vendor pull request reference failed validation: ${check.reason}`,
            }, nowFn(deps));
            continue;
        }
        if (record.autoPrRequested !== false)
            continue;
        current = await (0, state_js_1.recordDeviation)(deps.dataDir, record.localRequestId, {
            kind: 'policy-deviation',
            reason: 'vendor pull request observed on a session created with autoPr: false',
            prUrl: check.url,
        }, nowFn(deps));
    }
    return current;
}
// ---------------------------------------------------------------------------
// Write-path deps shared by authorize, mutations, supervise and write-gate
// ---------------------------------------------------------------------------
/** Set by the supervision skill for the duration of a pass; `authorize` refuses while it is set (R30). */
exports.ACTIVE_GRANT_ENV = 'YELLOW_JULES_ACTIVE_GRANT';
/** Host name made safe for the controller-id allowlist, then validated. */
function defaultControllerId(hostname = os.hostname) {
    const cleaned = hostname()
        .replace(/[^A-Za-z0-9._-]/g, '-')
        .replace(/^[^A-Za-z0-9]+/, '')
        .slice(0, 63);
    return (0, validate_js_1.validateControllerId)(cleaned.length > 0 ? cleaned : 'host');
}
function resolveControllerContext(deps) {
    return {
        controllerDir: deps.controllerDir ?? (0, config_js_1.resolveControllerDir)(deps.dataDir, deps.env),
        controllerId: (0, validate_js_1.validateControllerId)(deps.controllerId ?? defaultControllerId()),
        now: nowFn(deps),
    };
}
function refuseInsideSupervisedSession(env) {
    const active = env[exports.ACTIVE_GRANT_ENV];
    if (active !== undefined && active !== '') {
        (0, errors_js_1.throwAppError)('JULES_AUTHORITY_DENIED', 'authorize cannot run inside a supervised session; a grant is never created or widened from under another grant', {
            recoveryAction: 'End the supervised session and run authorize yourself in a terminal.',
        });
    }
}
/** The owner's typed confirmation on the controlling terminal (the only trust root). */
function confirmOwner(deps, summary) {
    return (0, tty_confirm_js_1.confirmOnTty)({
        summary,
        deadlineMs: deps.confirmDeadlineMs ?? tty_confirm_js_1.DEFAULT_CONFIRM_DEADLINE_MS,
        ...(deps.openTty !== undefined ? { openTty: deps.openTty } : {}),
    });
}
