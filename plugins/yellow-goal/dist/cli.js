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
const runtime = __importStar(require("./runtime.js"));
const spawn_js_1 = require("./spawn.js");
const KNOWN_OPERATIONS = ['setup', 'request'];
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
function dispatch(operation, rest, deps) {
    switch (operation) {
        case 'setup': {
            (0, node_util_1.parseArgs)({ args: rest, strict: true, allowPositionals: false });
            return runtime.setup(deps);
        }
        case 'request': {
            const sub = rest[0];
            if (sub === 'create') {
                if (rest.some((a) => a === '--executor' || a.startsWith('--executor='))) {
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
            if (sub === 'validate') {
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
            throw new UsageError(`unknown request subcommand "${sub ?? ''}"; expected create or validate`);
        }
        default:
            throw new UsageError(`unknown subcommand "${operation}"; expected one of: ${KNOWN_OPERATIONS.join(', ')}`);
    }
}
function main() {
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
    try {
        const result = dispatch(operation, rest, buildDeps());
        printJson({ ok: true, operation: resolvedOperation, ...result });
    }
    catch (err) {
        if (err instanceof UsageError ||
            (err instanceof Error &&
                'code' in err &&
                typeof err.code === 'string' &&
                err.code.startsWith('ERR_PARSE_ARGS_'))) {
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
}
main();
