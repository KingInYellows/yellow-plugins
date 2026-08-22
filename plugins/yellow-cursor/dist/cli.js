#!/usr/bin/env node
"use strict";
/**
 * Entry point. Exactly one JSON object on stdout per invocation; all
 * diagnostics go to stderr. Exit codes: 0 on ok:true, 1 on ok:false
 * (a well-formed business-rule/SDK failure), 2 on a CLI usage error
 * (unknown subcommand, missing required flag, unparseable argv).
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
const crypto = __importStar(require("node:crypto"));
const os = __importStar(require("node:os"));
const node_util_1 = require("node:util");
const config_js_1 = require("./config.js");
const errors_js_1 = require("./errors.js");
const redact_js_1 = require("./redact.js");
const runtime = __importStar(require("./runtime.js"));
const sdk_adapter_js_1 = require("./sdk-adapter.js");
const KNOWN_OPERATIONS = [
    'setup',
    'delegate',
    'list',
    'status',
    'follow-up',
    'cancel',
    'artifacts',
    'usage',
    'archive',
    'unarchive',
];
function printJson(value) {
    process.stdout.write(`${JSON.stringify((0, redact_js_1.redactDeep)(value))}\n`);
}
class UsageError extends Error {
}
function requireString(value, flag) {
    if (value === undefined) {
        throw new UsageError(`missing required flag ${flag}`);
    }
    return value;
}
function buildDeps() {
    const dataDir = (0, config_js_1.resolveDataDir)();
    return {
        adapter: new sdk_adapter_js_1.CursorSdkAdapter(dataDir),
        dataDir,
        stateFilePath: (0, config_js_1.resolveStateFilePath)(dataDir),
        clock: runtime.REAL_CLOCK,
        env: process.env,
    };
}
/** Set by the delegate/follow-up cases before their runtime call, so a thrown error can still echo the resolved key. */
let pendingIdempotencyKey;
async function dispatch(operation, rest, deps) {
    switch (operation) {
        case 'setup': {
            const { values } = (0, node_util_1.parseArgs)({
                args: rest,
                options: { 'install-sdk': { type: 'boolean', default: false } },
                strict: true,
                allowPositionals: false,
            });
            return await runtime.setup(deps, {
                installSdk: Boolean(values['install-sdk']),
            });
        }
        case 'delegate': {
            const { values } = (0, node_util_1.parseArgs)({
                args: rest,
                options: {
                    repo: { type: 'string' },
                    ref: { type: 'string' },
                    model: { type: 'string' },
                    prompt: { type: 'string' },
                    yes: { type: 'boolean', default: false },
                    'dry-run': { type: 'boolean', default: false },
                    'idempotency-key': { type: 'string' },
                    'max-active': { type: 'string', default: '3' },
                    'no-auto-create-pr': { type: 'boolean', default: false },
                    'linear-issue': { type: 'string' },
                    'calling-host': { type: 'string' },
                },
                strict: true,
                allowPositionals: false,
            });
            const repo = requireString(values.repo, '--repo');
            const prompt = requireString(values.prompt, '--prompt');
            const idempotencyKey = values['idempotency-key'] ??
                crypto.randomUUID();
            pendingIdempotencyKey = idempotencyKey;
            const maxActiveRaw = values['max-active'];
            // Number.parseInt('3abc', 10) === 3 — parses a leading numeric prefix
            // and silently ignores trailing garbage. Require the whole flag value
            // to be digits before parsing so "3abc" is rejected, not truncated.
            if (!/^\d+$/.test(maxActiveRaw)) {
                throw new UsageError(`--max-active must be a positive integer, got "${maxActiveRaw}"`);
            }
            const maxActive = Number.parseInt(maxActiveRaw, 10);
            return await runtime.delegate(deps, {
                repoUrl: repo,
                prompt,
                idempotencyKey,
                maxActive,
                yes: Boolean(values.yes),
                dryRun: Boolean(values['dry-run']),
                autoCreatePr: !values['no-auto-create-pr'],
                ...(values.ref !== undefined
                    ? { startingRef: values.ref }
                    : {}),
                ...(values.model !== undefined
                    ? { model: values.model }
                    : {}),
                ...(values['linear-issue'] !== undefined
                    ? { linearIssue: values['linear-issue'] }
                    : {}),
                ...(values['calling-host'] !== undefined
                    ? { callingHost: values['calling-host'] }
                    : { callingHost: os.hostname() }),
            });
        }
        case 'follow-up': {
            const { values } = (0, node_util_1.parseArgs)({
                args: rest,
                options: {
                    'agent-id': { type: 'string' },
                    prompt: { type: 'string' },
                    yes: { type: 'boolean', default: false },
                    'idempotency-key': { type: 'string' },
                },
                strict: true,
                allowPositionals: false,
            });
            const agentId = requireString(values['agent-id'], '--agent-id');
            const prompt = requireString(values.prompt, '--prompt');
            const idempotencyKey = values['idempotency-key'] ??
                crypto.randomUUID();
            pendingIdempotencyKey = idempotencyKey;
            return await runtime.followUp(deps, {
                agentId,
                prompt,
                idempotencyKey,
                yes: Boolean(values.yes),
            });
        }
        case 'list': {
            const { values } = (0, node_util_1.parseArgs)({
                args: rest,
                options: {
                    cursor: { type: 'string' },
                    archived: { type: 'boolean' },
                },
                strict: true,
                allowPositionals: false,
            });
            return await runtime.list(deps, {
                archived: values.archived === true,
                ...(values.cursor !== undefined
                    ? { cursor: values.cursor }
                    : {}),
            });
        }
        case 'status': {
            const { values } = (0, node_util_1.parseArgs)({
                args: rest,
                options: {
                    'agent-id': { type: 'string' },
                    'run-id': { type: 'string' },
                    reconcile: { type: 'boolean', default: false },
                },
                strict: true,
                allowPositionals: false,
            });
            const agentId = requireString(values['agent-id'], '--agent-id');
            return await runtime.status(deps, {
                agentId,
                reconcile: Boolean(values.reconcile),
                ...(values['run-id'] !== undefined
                    ? { runId: values['run-id'] }
                    : {}),
            });
        }
        case 'cancel': {
            const { values } = (0, node_util_1.parseArgs)({
                args: rest,
                options: {
                    'run-id': { type: 'string' },
                    'agent-id': { type: 'string' },
                    yes: { type: 'boolean', default: false },
                },
                strict: true,
                allowPositionals: false,
            });
            const runId = requireString(values['run-id'], '--run-id');
            const agentId = requireString(values['agent-id'], '--agent-id');
            return await runtime.cancel(deps, {
                runId,
                agentId,
                yes: Boolean(values.yes),
            });
        }
        case 'archive': {
            const { values } = (0, node_util_1.parseArgs)({
                args: rest,
                options: {
                    'agent-id': { type: 'string' },
                    yes: { type: 'boolean', default: false },
                    force: { type: 'boolean', default: false },
                },
                strict: true,
                allowPositionals: false,
            });
            const agentId = requireString(values['agent-id'], '--agent-id');
            return await runtime.archive(deps, {
                agentId,
                yes: Boolean(values.yes),
                force: Boolean(values.force),
            });
        }
        case 'unarchive': {
            const { values } = (0, node_util_1.parseArgs)({
                args: rest,
                options: {
                    'agent-id': { type: 'string' },
                    yes: { type: 'boolean', default: false },
                },
                strict: true,
                allowPositionals: false,
            });
            const agentId = requireString(values['agent-id'], '--agent-id');
            return await runtime.unarchive(deps, {
                agentId,
                yes: Boolean(values.yes),
            });
        }
        case 'artifacts': {
            const { values } = (0, node_util_1.parseArgs)({
                args: rest,
                options: {
                    'agent-id': { type: 'string' },
                    download: { type: 'string' },
                    out: { type: 'string' },
                },
                strict: true,
                allowPositionals: false,
            });
            const agentId = requireString(values['agent-id'], '--agent-id');
            return await runtime.artifacts(deps, {
                agentId,
                ...(values.download !== undefined
                    ? { download: values.download }
                    : {}),
                ...(values.out !== undefined ? { out: values.out } : {}),
            });
        }
        case 'usage': {
            const { values } = (0, node_util_1.parseArgs)({
                args: rest,
                options: { 'agent-id': { type: 'string' } },
                strict: true,
                allowPositionals: false,
            });
            const agentId = requireString(values['agent-id'], '--agent-id');
            return await runtime.usage(deps, { agentId });
        }
        default:
            throw new UsageError(`unknown subcommand "${operation}"; expected one of: ${KNOWN_OPERATIONS.join(', ')}`);
    }
}
async function main() {
    const [operation, ...rest] = process.argv.slice(2);
    const resolvedOperation = operation ?? 'unknown';
    if (operation === undefined) {
        process.stderr.write(`no subcommand given; expected one of: ${KNOWN_OPERATIONS.join(', ')}\n`);
        printJson({
            ok: false,
            operation: 'unknown',
            error: {
                code: 'CURSOR_INVALID_INPUT',
                message: `no subcommand given; expected one of: ${KNOWN_OPERATIONS.join(', ')}`,
                retryable: false,
                recoveryAction: 'Pass a subcommand and retry.',
            },
        });
        process.exit(2);
    }
    try {
        const deps = buildDeps();
        const result = await dispatch(operation, rest, deps);
        printJson({ ok: true, ...result });
    }
    catch (err) {
        if (err instanceof UsageError) {
            process.stderr.write(`${err.message}\n`);
            printJson({
                ok: false,
                operation: resolvedOperation,
                error: {
                    code: 'CURSOR_INVALID_INPUT',
                    message: err.message,
                    retryable: false,
                    recoveryAction: 'Fix the reported CLI invocation and retry.',
                },
            });
            process.exit(2);
        }
        const appError = (0, errors_js_1.toAppError)(err);
        process.stderr.write(`${appError.code}: ${(0, redact_js_1.redactDeep)(appError.message)}\n`);
        printJson({
            ok: false,
            operation: resolvedOperation,
            ...(pendingIdempotencyKey !== undefined
                ? { idempotencyKey: pendingIdempotencyKey }
                : {}),
            error: appError,
        });
        process.exit(1);
    }
}
main().catch((err) => {
    process.stderr.write(`unexpected error: ${String(err)}\n`);
    process.exit(1);
});
