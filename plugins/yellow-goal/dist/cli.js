#!/usr/bin/env node
"use strict";
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
/**
 * Entry point. Exactly one JSON object on stdout per invocation; all
 * diagnostics go to stderr. Exit codes: 0 on ok:true, 1 on ok:false
 * (engine/business failure), 2 on a consumer CLI usage error.
 *
 * This process never imports yellow-goal TypeScript. It only spawns
 * `goal-gen` (or $GOAL_GEN_BIN) as a child.
 */
const node_util_1 = require("node:util");
const errors_js_1 = require("./errors.js");
const provider_protocol_js_1 = require("./provider-protocol.js");
const runtime = __importStar(require("./runtime.js"));
const spawn_js_1 = require("./spawn.js");
const KNOWN_OPERATIONS = ['setup', 'request', 'run-stub', 'run-real'];
function printJson(value) {
    process.stdout.write(`${JSON.stringify(value)}\n`);
}
class UsageError extends Error {
}
function requireString(value, flag) {
    if (value === undefined || value.length === 0) {
        throw new UsageError(`missing required flag ${flag}`);
    }
    return value;
}
function buildDeps() {
    return {
        spawn: (0, spawn_js_1.createDefaultSpawn)(process.env),
        env: process.env,
    };
}
function dispatchRequestCreate(rest, deps) {
    if (rest.some((arg) => arg === '--executor' || arg.startsWith('--executor='))) {
        throw new UsageError('refusing --executor; this plugin is read-only (create/validate only)');
    }
    const { values } = (0, node_util_1.parseArgs)({
        args: rest.slice(1),
        options: {
            repo: { type: 'string' },
            goal: { type: 'string' },
            output: { type: 'string' },
        },
        strict: true,
        allowPositionals: false,
    });
    return runtime.requestCreate(deps, {
        repo: requireString(values.repo, '--repo'),
        goal: requireString(values.goal, '--goal'),
        output: requireString(values.output, '--output'),
    });
}
function dispatchRequestValidate(rest, deps) {
    const { positionals } = (0, node_util_1.parseArgs)({
        args: rest.slice(1),
        strict: true,
        allowPositionals: true,
    });
    const request = positionals[0];
    if (positionals.length !== 1 ||
        typeof request !== 'string' ||
        request.length === 0) {
        throw new UsageError('request validate requires exactly one request file argument');
    }
    return runtime.requestValidate(deps, { request });
}
function dispatchRequest(rest, deps) {
    switch (rest[0]) {
        case 'create':
            return dispatchRequestCreate(rest, deps);
        case 'validate':
            return dispatchRequestValidate(rest, deps);
        default:
            throw new UsageError(`unknown request subcommand "${rest[0] ?? ''}"; expected create or validate`);
    }
}
function dispatchRunStub(rest, deps, controller) {
    if (rest.some((arg) => arg === '--executor' || arg.startsWith('--executor='))) {
        throw new UsageError('refusing --executor; run-stub always uses the stub executor');
    }
    if (rest.some((arg) => arg === '--protocol' || arg.startsWith('--protocol='))) {
        throw new UsageError('refusing --protocol; run-stub always uses protocol v2');
    }
    const { values, positionals } = (0, node_util_1.parseArgs)({
        args: rest,
        options: {
            scenario: { type: 'string' },
            'timeout-ms': { type: 'string' },
            yes: { type: 'boolean', default: false },
        },
        strict: true,
        allowPositionals: true,
    });
    const request = positionals[0];
    if (positionals.length !== 1 ||
        typeof request !== 'string' ||
        request.length === 0) {
        throw new UsageError('run-stub requires exactly one <request> argument');
    }
    const scenarioRaw = values.scenario ?? 'success';
    if (!provider_protocol_js_1.STUB_SCENARIOS.includes(scenarioRaw)) {
        throw new UsageError(`unknown --scenario "${scenarioRaw}"; expected one of: ${provider_protocol_js_1.STUB_SCENARIOS.join(', ')}`);
    }
    let timeoutMs;
    const timeoutRaw = values['timeout-ms'];
    if (timeoutRaw !== undefined) {
        if (!/^[1-9][0-9]*$/.test(timeoutRaw)) {
            throw new UsageError('--timeout-ms must be a positive decimal integer');
        }
        timeoutMs = Number(timeoutRaw);
    }
    return runtime.runStub(deps, {
        request,
        scenario: scenarioRaw,
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        yes: values.yes === true,
        signal: controller.signal,
    });
}
function refuseRealRunSelector(rest) {
    if (rest.some((arg) => arg === '--executor' || arg.startsWith('--executor='))) {
        throw new UsageError('refusing --executor; run-real always uses agx-claude-code');
    }
    if (rest.some((arg) => arg === '--protocol' || arg.startsWith('--protocol='))) {
        throw new UsageError('refusing --protocol; run-real always uses protocol v2');
    }
    if (rest.some((arg) => arg === '--yes' || arg.startsWith('--yes='))) {
        throw new UsageError('refusing --yes; an approval replaces confirmation');
    }
    if (rest.includes('approve')) {
        throw new UsageError('refusing approve; run-real cannot mint an approval');
    }
}
function requirePositiveInt(value, flag) {
    if (!/^[1-9][0-9]*$/.test(value)) {
        throw new UsageError(`${flag} must be a positive decimal integer`);
    }
    return value;
}
function requireUsd(value, flag) {
    if (!/^\d+(\.\d+)?$/.test(value)) {
        throw new UsageError(`${flag} must be a decimal USD amount`);
    }
    return value;
}
function dispatchRunReal(rest, deps, controller) {
    refuseRealRunSelector(rest);
    const { values, positionals } = (0, node_util_1.parseArgs)({
        args: rest,
        options: {
            approval: { type: 'string' },
            profile: { type: 'string' },
            'max-turns': { type: 'string' },
            'per-action-usd': { type: 'string' },
            'total-usd': { type: 'string' },
            'auth-mode': { type: 'string' },
            'allowed-tool': { type: 'string', multiple: true },
            'bundle-dir': { type: 'string' },
            'spend-ledger': { type: 'string' },
            model: { type: 'string' },
            'action-timeout-ms': { type: 'string' },
            'run-wall-clock-ms': { type: 'string' },
            'expires-in-minutes': { type: 'string' },
            'disallowed-tool': { type: 'string', multiple: true },
        },
        strict: true,
        allowPositionals: true,
    });
    const request = positionals[0];
    if (positionals.length !== 1 ||
        typeof request !== 'string' ||
        request.length === 0) {
        throw new UsageError('run-real requires exactly one <request> argument');
    }
    const authMode = requireString(values['auth-mode'], '--auth-mode');
    if (authMode !== 'subscription' && authMode !== 'api-key') {
        throw new UsageError('--auth-mode must be subscription or api-key');
    }
    const allowedTools = values['allowed-tool'] ?? [];
    if (allowedTools.length === 0) {
        throw new UsageError('at least one --allowed-tool is required');
    }
    const actionTimeout = values['action-timeout-ms'];
    const wallClock = values['run-wall-clock-ms'];
    const expires = values['expires-in-minutes'];
    return runtime.runReal(deps, {
        request,
        approvalPath: requireString(values.approval, '--approval'),
        profile: requireString(values.profile, '--profile'),
        maxTurns: requirePositiveInt(requireString(values['max-turns'], '--max-turns'), '--max-turns'),
        perActionUsd: requireUsd(requireString(values['per-action-usd'], '--per-action-usd'), '--per-action-usd'),
        totalUsd: requireUsd(requireString(values['total-usd'], '--total-usd'), '--total-usd'),
        authMode,
        allowedTools,
        bundleDir: requireString(values['bundle-dir'], '--bundle-dir'),
        spendLedger: requireString(values['spend-ledger'], '--spend-ledger'),
        ...(values.model !== undefined ? { model: values.model } : {}),
        ...(actionTimeout !== undefined
            ? { actionTimeoutMs: requirePositiveInt(actionTimeout, '--action-timeout-ms') }
            : {}),
        ...(wallClock !== undefined
            ? { runWallClockMs: requirePositiveInt(wallClock, '--run-wall-clock-ms') }
            : {}),
        ...(expires !== undefined
            ? { expiresInMinutes: requirePositiveInt(expires, '--expires-in-minutes') }
            : {}),
        ...(values['disallowed-tool'] !== undefined
            ? { disallowedTools: values['disallowed-tool'] }
            : {}),
        signal: controller.signal,
    });
}
async function dispatch(operation, rest, deps, controller) {
    switch (operation) {
        case 'setup': {
            (0, node_util_1.parseArgs)({ args: rest, strict: true, allowPositionals: false });
            return runtime.setup(deps);
        }
        case 'request':
            return dispatchRequest(rest, deps);
        case 'run-stub': {
            // GOAL_GEN_SCRATCH is a test-only seam: production never retains the
            // per-operation scratch tree, so the variable is stripped here.
            const { GOAL_GEN_SCRATCH: _testOnlyScratch, ...productionEnv } = deps.env;
            void _testOnlyScratch;
            return dispatchRunStub(rest, { env: productionEnv }, controller);
        }
        case 'run-real': {
            const { GOAL_GEN_SCRATCH: _testOnlyScratch, ...productionEnv } = deps.env;
            void _testOnlyScratch;
            return dispatchRunReal(rest, { env: productionEnv }, controller);
        }
        default:
            throw new UsageError(`unknown subcommand "${operation}"; expected one of: ${KNOWN_OPERATIONS.join(', ')}`);
    }
}
function isParseArgsError(err) {
    if (!(err instanceof Error))
        return false;
    const code = err.code;
    return typeof code === 'string' && code.startsWith('ERR_PARSE_ARGS_');
}
function isUsageError(err) {
    return (err instanceof UsageError ||
        isParseArgsError(err) ||
        (err instanceof errors_js_1.GoalEngineError && err.code === 'GOAL_INVALID_INPUT'));
}
async function main() {
    const [operation, ...rest] = process.argv.slice(2);
    const resolvedOperation = operation ?? 'unknown';
    if (operation === undefined) {
        process.stderr.write(`no subcommand given; expected one of: ${KNOWN_OPERATIONS.join(', ')}\n`);
        printJson({
            ok: false,
            operation: 'unknown',
            error: new errors_js_1.GoalEngineError('GOAL_INVALID_INPUT', `no subcommand given; expected one of: ${KNOWN_OPERATIONS.join(', ')}`).toJson(),
        });
        process.exitCode = 2;
        return;
    }
    const controller = new AbortController();
    const forwardSignal = () => controller.abort();
    let signalsInstalled = false;
    function installSignalForwarding() {
        if (signalsInstalled)
            return;
        signalsInstalled = true;
        process.on('SIGINT', forwardSignal);
        process.on('SIGTERM', forwardSignal);
    }
    function removeSignalForwarding() {
        if (!signalsInstalled)
            return;
        signalsInstalled = false;
        process.off('SIGINT', forwardSignal);
        process.off('SIGTERM', forwardSignal);
    }
    try {
        // Only the async run-stub lifecycle listens to the controller; the
        // synchronous setup/request paths keep Node's default signal behavior.
        if (operation === 'run-stub' || operation === 'run-real') {
            installSignalForwarding();
        }
        const result = await dispatch(operation, rest, buildDeps(), controller);
        if ('outcome' in result && result.outcome !== 'verified') {
            printJson({ ok: false, operation: resolvedOperation, ...result });
            process.exitCode = 1;
            return;
        }
        printJson({ ok: true, operation: resolvedOperation, ...result });
    }
    catch (err) {
        if (isUsageError(err)) {
            process.stderr.write(`${err.message}\n`);
            printJson({
                ok: false,
                operation: resolvedOperation,
                error: new errors_js_1.GoalEngineError('GOAL_INVALID_INPUT', err.message).toJson(),
            });
            process.exitCode = 2;
            return;
        }
        const appError = (0, errors_js_1.toGoalError)(err);
        process.stderr.write(`${appError.code}: ${appError.message}\n`);
        printJson({
            ok: false,
            operation: resolvedOperation,
            error: appError,
        });
        process.exitCode = 1;
    }
    finally {
        removeSignalForwarding();
    }
}
void main();
