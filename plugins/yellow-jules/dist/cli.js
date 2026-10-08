#!/usr/bin/env node
"use strict";
/**
 * Entry point. Exactly one JSON object on stdout per invocation (one line,
 * redacted); diagnostics go to stderr only. Exit codes: 0 on ok:true, 1 on
 * a well-formed operational failure, 2 on a CLI usage error (unknown
 * subcommand, missing flag, unparseable argv), which still prints a valid
 * `{ ok: false, operation, error }` envelope (R7).
 *
 * The reads (`setup`, `list`, `status`, `collect`), the grant-gated writes
 * (`delegate`, `reply`, `approve`), `authorize`, `abandon`, and `supervise`
 * are all wired here; a mutating failure echoes `localRequestId` and `localId`.
 * `cancel`, `pause`, `resume`, and `cost` are recognized and answer
 * JULES_UNSUPPORTED_CAPABILITY (R11); `integrate` is not available yet.
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
const node_util_1 = require("node:util");
const authority_js_1 = require("./authority.js");
const authorize_js_1 = require("./authorize.js");
const config_js_1 = require("./config.js");
const deadline_js_1 = require("./deadline.js");
const errors_js_1 = require("./errors.js");
const fetch_guard_js_1 = require("./fetch-guard.js");
const mutations_js_1 = require("./mutations.js");
const redact_js_1 = require("./redact.js");
const runtime = __importStar(require("./runtime.js"));
const sdk_adapter_js_1 = require("./sdk-adapter.js");
const sdk_resolver_js_1 = require("./sdk-resolver.js");
const supervise_js_1 = require("./supervise.js");
const test_seam_js_1 = require("./test-seam.js");
const validate_js_1 = require("./validate.js");
const KNOWN_OPERATIONS = [
    'setup',
    'list',
    'status',
    'collect',
    'delegate',
    'reply',
    'approve',
    'authorize',
    'abandon',
    'supervise',
];
const UNSUPPORTED_OPERATIONS = ['cancel', 'pause', 'resume', 'cost'];
const LATER_OPERATIONS = ['integrate'];
// Deadline plus one in-flight read (up to the 60 s client timeout) plus the
// post-walk staging and journal writes must fit inside the wrappers' 300 s
// Bash timeout, or the run is killed mid-write.
const MAX_DEADLINE_MS = 200_000;
function printJson(value) {
    process.stdout.write(`${JSON.stringify((0, redact_js_1.redactDeep)(value))}\n`);
}
class UsageError extends Error {
}
function isParseArgsError(err) {
    const code = err.code;
    return typeof code === 'string' && code.startsWith('ERR_PARSE_ARGS_');
}
function requireString(value, flag) {
    if (typeof value !== 'string')
        throw new UsageError(`missing required flag ${flag}`);
    return value;
}
function deadlineFlag(value, fallback) {
    return typeof value === 'string'
        ? (0, validate_js_1.validatePositiveInt)(value, '--deadline-ms', 1, MAX_DEADLINE_MS)
        : fallback;
}
function buildDeps() {
    const dataDir = (0, config_js_1.resolveDataDir)();
    // The guard patches global fetch and can be installed once per process, but
    // one invocation may open several adapters (reconcile, then status; status,
    // then collect). Install on first use and share the handle: its POST counter
    // is cumulative, and each adapter only compares samples taken within its own
    // write, so sharing is safe.
    let guard;
    return {
        dataDir,
        clock: runtime.REAL_CLOCK,
        env: process.env,
        adapterFactory: async () => {
            const apiKey = process.env['JULES_API_KEY'];
            if (apiKey === undefined || apiKey === '') {
                return (0, errors_js_1.throwAppError)('JULES_AUTH_FAILED', 'JULES_API_KEY is not set');
            }
            const resolved = await (0, sdk_resolver_js_1.resolveSdk)(dataDir);
            const transport = (0, test_seam_js_1.getTestTransport)();
            // Installed before the adapter exists, so no SDK request can bypass it.
            guard ??= (0, fetch_guard_js_1.installFetchGuard)({
                allowedOrigins: transport?.allowedOrigins ?? [fetch_guard_js_1.VENDOR_ORIGIN],
                readTimeoutMs: fetch_guard_js_1.READ_TIMEOUT_MS,
            });
            return sdk_adapter_js_1.JulesSdkAdapter.connect({
                sdk: resolved.module,
                dataDir,
                apiKey,
                postCount: guard.postCount,
                ...(transport !== undefined ? { baseUrl: transport.baseUrl } : {}),
            });
        },
    };
}
async function dispatch(operation, rest, deps) {
    const deadline = { 'deadline-ms': { type: 'string' } };
    switch (operation) {
        case 'setup': {
            const { values } = (0, node_util_1.parseArgs)({
                args: [...rest],
                options: {
                    'install-sdk': { type: 'boolean', default: false },
                    ...deadline,
                },
                strict: true,
                allowPositionals: false,
            });
            return runtime.setup(deps, {
                installSdk: values['install-sdk'] === true,
                deadlineMs: deadlineFlag(values['deadline-ms'], deadline_js_1.DEFAULT_READ_DEADLINE_MS),
            });
        }
        case 'list': {
            const { values } = (0, node_util_1.parseArgs)({
                args: [...rest],
                options: {
                    limit: { type: 'string' },
                    'page-token': { type: 'string' },
                    ...deadline,
                },
                strict: true,
                allowPositionals: false,
            });
            return runtime.list(deps, {
                ...(typeof values.limit === 'string'
                    ? {
                        limit: (0, validate_js_1.validatePositiveInt)(values.limit, '--limit', 1, runtime.LIST_MAX_LIMIT),
                    }
                    : {}),
                ...(typeof values['page-token'] === 'string'
                    ? { pageToken: values['page-token'] }
                    : {}),
                deadlineMs: deadlineFlag(values['deadline-ms'], deadline_js_1.DEFAULT_READ_DEADLINE_MS),
            });
        }
        case 'status': {
            const { values } = (0, node_util_1.parseArgs)({
                args: [...rest],
                options: {
                    session: { type: 'string' },
                    reconcile: { type: 'boolean', default: false },
                    ...deadline,
                },
                strict: true,
                allowPositionals: false,
            });
            if (values.session === undefined && values.reconcile !== true) {
                throw new UsageError('missing required flag --session (or pass --reconcile)');
            }
            return runtime.status(deps, {
                ...(typeof values.session === 'string'
                    ? { session: values.session }
                    : {}),
                reconcile: values.reconcile === true,
                deadlineMs: deadlineFlag(values['deadline-ms'], deadline_js_1.DEFAULT_READ_DEADLINE_MS),
            });
        }
        case 'collect': {
            const { values } = (0, node_util_1.parseArgs)({
                args: [...rest],
                options: { session: { type: 'string' }, ...deadline },
                strict: true,
                allowPositionals: false,
            });
            return runtime.collect(deps, {
                session: requireString(values.session, '--session'),
                deadlineMs: deadlineFlag(values['deadline-ms'], deadline_js_1.DEFAULT_COLLECT_DEADLINE_MS),
            });
        }
        case 'delegate': {
            const { values } = (0, node_util_1.parseArgs)({
                args: [...rest],
                options: {
                    repo: { type: 'string' },
                    branch: { type: 'string' },
                    prompt: { type: 'string' },
                    title: { type: 'string' },
                    'task-ref': { type: 'string' },
                    'request-id': { type: 'string' },
                    'grant-id': { type: 'string' },
                    'dry-run': { type: 'boolean', default: false },
                    correction: { type: 'boolean', default: false },
                    ...deadline,
                },
                strict: true,
                allowPositionals: false,
            });
            return (0, mutations_js_1.delegate)(deps, {
                repo: requireString(values.repo, '--repo'),
                branch: requireString(values.branch, '--branch'),
                prompt: requireString(values.prompt, '--prompt'),
                ...(typeof values.title === 'string' ? { title: values.title } : {}),
                ...(typeof values['task-ref'] === 'string'
                    ? { taskRef: values['task-ref'] }
                    : {}),
                ...(typeof values['request-id'] === 'string'
                    ? { requestId: values['request-id'] }
                    : {}),
                ...(typeof values['grant-id'] === 'string'
                    ? { grantId: values['grant-id'] }
                    : {}),
                dryRun: values['dry-run'] === true,
                correction: values.correction === true,
                deadlineMs: deadlineFlag(values['deadline-ms'], deadline_js_1.DEFAULT_MUTATION_DEADLINE_MS),
            });
        }
        case 'reply': {
            const { values } = (0, node_util_1.parseArgs)({
                args: [...rest],
                options: {
                    session: { type: 'string' },
                    message: { type: 'string' },
                    'request-id': { type: 'string' },
                    'grant-id': { type: 'string' },
                    'dry-run': { type: 'boolean', default: false },
                    correction: { type: 'boolean', default: false },
                    ...deadline,
                },
                strict: true,
                allowPositionals: false,
            });
            return (0, mutations_js_1.reply)(deps, {
                session: requireString(values.session, '--session'),
                message: requireString(values.message, '--message'),
                ...(typeof values['request-id'] === 'string'
                    ? { requestId: values['request-id'] }
                    : {}),
                ...(typeof values['grant-id'] === 'string'
                    ? { grantId: values['grant-id'] }
                    : {}),
                dryRun: values['dry-run'] === true,
                correction: values.correction === true,
                deadlineMs: deadlineFlag(values['deadline-ms'], deadline_js_1.DEFAULT_MUTATION_DEADLINE_MS),
            });
        }
        case 'approve': {
            const { values } = (0, node_util_1.parseArgs)({
                args: [...rest],
                options: {
                    session: { type: 'string' },
                    'plan-id': { type: 'string' },
                    'request-id': { type: 'string' },
                    'grant-id': { type: 'string' },
                    'dry-run': { type: 'boolean', default: false },
                    ...deadline,
                },
                strict: true,
                allowPositionals: false,
            });
            return (0, mutations_js_1.approve)(deps, {
                session: requireString(values.session, '--session'),
                planId: requireString(values['plan-id'], '--plan-id'),
                ...(typeof values['request-id'] === 'string'
                    ? { requestId: values['request-id'] }
                    : {}),
                ...(typeof values['grant-id'] === 'string'
                    ? { grantId: values['grant-id'] }
                    : {}),
                dryRun: values['dry-run'] === true,
                deadlineMs: deadlineFlag(values['deadline-ms'], deadline_js_1.DEFAULT_MUTATION_DEADLINE_MS),
            });
        }
        case 'abandon': {
            const { values } = (0, node_util_1.parseArgs)({
                args: [...rest],
                options: { 'request-id': { type: 'string' } },
                strict: true,
                allowPositionals: false,
            });
            return (0, mutations_js_1.abandon)(deps, {
                requestId: requireString(values['request-id'], '--request-id'),
            });
        }
        case 'supervise': {
            const { values } = (0, node_util_1.parseArgs)({
                args: [...rest],
                options: {
                    session: { type: 'string' },
                    'grant-id': { type: 'string' },
                    'clear-pause': { type: 'boolean', default: false },
                    ...deadline,
                },
                strict: true,
                allowPositionals: false,
            });
            if (values['clear-pause'] === true) {
                if (typeof values['grant-id'] === 'string') {
                    throw new UsageError('--clear-pause takes only --session; it is confirmed on the terminal, not by a grant');
                }
                return (0, supervise_js_1.clearPause)(deps, {
                    session: requireString(values.session, '--session'),
                });
            }
            return (0, supervise_js_1.superviseOnce)(deps, {
                session: requireString(values.session, '--session'),
                grantId: requireString(values['grant-id'], '--grant-id'),
                deadlineMs: deadlineFlag(values['deadline-ms'], deadline_js_1.DEFAULT_MUTATION_DEADLINE_MS),
            });
        }
        case 'authorize': {
            const { values } = (0, node_util_1.parseArgs)({
                args: [...rest],
                options: {
                    repo: { type: 'string' },
                    branch: { type: 'string' },
                    source: { type: 'string' },
                    'task-ref': { type: 'string', multiple: true },
                    operations: { type: 'string' },
                    'max-active-sessions': { type: 'string' },
                    'max-total-tasks': { type: 'string' },
                    'max-corrective-rounds': { type: 'string' },
                    'ttl-minutes': { type: 'string' },
                    owner: { type: 'string' },
                    'take-over': { type: 'boolean', default: false },
                    list: { type: 'boolean', default: false },
                    revoke: { type: 'string' },
                    ...deadline,
                },
                strict: true,
                allowPositionals: false,
            });
            const modes = [
                values.list === true,
                typeof values.revoke === 'string',
                values['take-over'] === true,
            ].filter(Boolean).length;
            const creationFlags = [
                values.repo,
                values.branch,
                values.source,
                values['task-ref'],
                values.operations,
                values['max-active-sessions'],
                values['max-total-tasks'],
                values['max-corrective-rounds'],
                values['ttl-minutes'],
                values.owner,
            ].some((v) => v !== undefined);
            if (modes > 1 || (modes === 1 && creationFlags)) {
                throw new UsageError('authorize takes exactly one of: grant-creation flags, --list, --revoke <grant-id>, or --take-over');
            }
            if (values.list === true)
                return (0, authorize_js_1.authorizeList)(deps);
            if (typeof values.revoke === 'string') {
                return (0, authorize_js_1.authorizeRevoke)(deps, values.revoke);
            }
            if (values['take-over'] === true)
                return (0, authorize_js_1.authorizeTakeOver)(deps);
            const intFlag = (raw, flag, min, max) => typeof raw === 'string'
                ? (0, validate_js_1.validatePositiveInt)(raw, flag, min, max)
                : undefined;
            const maxActiveSessions = intFlag(values['max-active-sessions'], '--max-active-sessions', 1, authority_js_1.GRANT_CEILINGS.maxActiveSessions);
            const maxTotalTasks = intFlag(values['max-total-tasks'], '--max-total-tasks', 1, authority_js_1.GRANT_CEILINGS.maxTotalTasks);
            const maxCorrectiveRounds = intFlag(values['max-corrective-rounds'], '--max-corrective-rounds', 0, authority_js_1.GRANT_CEILINGS.maxCorrectiveRounds);
            const ttlMinutes = intFlag(values['ttl-minutes'], '--ttl-minutes', 1, authority_js_1.GRANT_CEILINGS.ttlMinutes);
            return (0, authorize_js_1.authorizeCreate)(deps, {
                repo: requireString(values.repo, '--repo'),
                branch: requireString(values.branch, '--branch'),
                ...(typeof values.source === 'string' ? { source: values.source } : {}),
                taskRefs: values['task-ref'] ?? [],
                operations: requireString(values.operations, '--operations'),
                owner: requireString(values.owner, '--owner'),
                ...(maxActiveSessions !== undefined ? { maxActiveSessions } : {}),
                ...(maxTotalTasks !== undefined ? { maxTotalTasks } : {}),
                ...(maxCorrectiveRounds !== undefined ? { maxCorrectiveRounds } : {}),
                ...(ttlMinutes !== undefined ? { ttlMinutes } : {}),
                deadlineMs: deadlineFlag(values['deadline-ms'], deadline_js_1.DEFAULT_READ_DEADLINE_MS),
            });
        }
        default:
            if (UNSUPPORTED_OPERATIONS.includes(operation)) {
                return runtime.unsupportedCapability(operation);
            }
            if (LATER_OPERATIONS.includes(operation)) {
                throw new UsageError(`"${operation}" is not available in this release; available: ${KNOWN_OPERATIONS.join(', ')}`);
            }
            throw new UsageError(`unknown subcommand "${operation}"; expected one of: ${KNOWN_OPERATIONS.join(', ')}`);
    }
}
function usageEnvelope(operation, message) {
    process.stderr.write(`${(0, redact_js_1.redact)(message)}\n`);
    printJson({
        ok: false,
        operation,
        error: {
            code: 'JULES_INVALID_INPUT',
            message,
            retryable: false,
            recoveryAction: 'Fix the reported CLI invocation and retry.',
        },
    });
}
function operationName(operation) {
    if (operation === undefined)
        return 'unknown';
    const known = [
        ...KNOWN_OPERATIONS,
        ...UNSUPPORTED_OPERATIONS,
    ];
    return known.includes(operation) ? operation : 'unknown';
}
async function main() {
    const [operation, ...rest] = process.argv.slice(2);
    const name = operationName(operation);
    if (operation === undefined) {
        usageEnvelope('unknown', `no subcommand given; expected one of: ${KNOWN_OPERATIONS.join(', ')}`);
        process.exitCode = 2;
        return;
    }
    try {
        const result = await dispatch(operation, rest, buildDeps());
        printJson({ ok: true, ...result });
        process.exitCode = 0;
    }
    catch (err) {
        if (err instanceof UsageError || isParseArgsError(err)) {
            usageEnvelope(name, err instanceof Error ? err.message : String(err));
            process.exitCode = 2;
            return;
        }
        const appError = (0, errors_js_1.toAppError)(err, 'read');
        // The message can carry vendor text; it travels only inside the JSON
        // envelope, which the wrappers fence. stderr gets the code alone.
        process.stderr.write(`${appError.code}\n`);
        // A mutating failure echoes the ids a reservation can be reconciled by.
        const context = err instanceof errors_js_1.MutationErrorException ? err : undefined;
        printJson({
            ok: false,
            operation: name,
            ...(context?.localRequestId !== undefined
                ? { localRequestId: context.localRequestId }
                : {}),
            ...(context?.localId !== undefined ? { localId: context.localId } : {}),
            ...(context?.details !== undefined ? { details: context.details } : {}),
            error: appError,
        });
        process.exitCode = 1;
    }
}
main().catch((err) => {
    process.stderr.write(`unexpected error: ${(0, redact_js_1.redact)(err instanceof Error ? err.name : 'unknown')}\n`);
    process.exitCode = 1;
});
