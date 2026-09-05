"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.spawnProtocolChild = spawnProtocolChild;
exports.buildChildEnv = buildChildEnv;
exports.createOperationScratchDir = createOperationScratchDir;
/**
 * Async fixed-authority process transport for Provider Protocol v1 probes
 * and runs. One child at a time; the caller owns a single AbortController
 * and one absolute deadline shared across every phase. This module only
 * mechanically spawns/kills/collects — protocol interpretation (JSON
 * shape, terminal agreement) lives in provider-protocol.ts and runtime.ts.
 */
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const errors_js_1 = require("./errors.js");
const SIGKILL_GRACE_MS = 5000;
function mapSpawnError(error) {
    switch (error.code) {
        case 'ENOENT':
            return new errors_js_1.GoalEngineError('GOAL_ENGINE_MISSING', `protocol engine binary not found (${error.message})`);
        case 'EACCES':
        case 'EPERM':
            return new errors_js_1.GoalEngineError('GOAL_ENGINE_UNRUNNABLE', `protocol engine binary could not be executed (${error.code})`);
        default:
            return new errors_js_1.GoalEngineError('GOAL_PROTOCOL_TRANSPORT', `protocol child spawn error: ${error.message}`);
    }
}
/**
 * Spawn one protocol child under one shared abort signal and one absolute
 * deadline. Cancellation (either the signal firing or the deadline
 * elapsing) is recorded as a local cause before SIGTERM; a child that
 * ignores SIGTERM for {@link SIGKILL_GRACE_MS} is escalated to SIGKILL.
 * The promise settles exactly once, on `close`, except for spawn/stream
 * errors and byte-bound overflow, which reject immediately after best-effort
 * SIGKILL. Every timer and every active listener is released at settlement;
 * only inert no-op `error` guards stay attached so a late pipe or kill()
 * error after settlement can never surface as an unhandled event.
 */
function spawnProtocolChild(opts) {
    return new Promise((resolve, reject) => {
        const child = (0, node_child_process_1.spawn)(opts.bin, [...opts.argv], {
            cwd: opts.cwd,
            env: opts.env,
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: false,
            windowsHide: true,
        });
        let settled = false;
        let localCause;
        let forcedKill = false;
        let sigkillTimer;
        let deadlineTimer;
        const stdoutChunks = [];
        const stderrChunks = [];
        let stdoutBytes = 0;
        let stderrBytes = 0;
        const clearTimers = () => {
            if (sigkillTimer !== undefined)
                clearTimeout(sigkillTimer);
            if (deadlineTimer !== undefined)
                clearTimeout(deadlineTimer);
            sigkillTimer = undefined;
            deadlineTimer = undefined;
        };
        const swallow = () => {
            // Late errors after settlement (a pipe closing under SIGKILL, or a
            // kill() failure event) must never surface as an unhandled 'error'.
        };
        const removeListeners = () => {
            child.stdout?.off('data', onStdoutData);
            child.stderr?.off('data', onStderrData);
            child.stdout?.off('error', onStdoutError);
            child.stderr?.off('error', onStderrError);
            child.off('error', onChildError);
            child.off('close', onClose);
            child.stdout?.on('error', swallow);
            child.stderr?.on('error', swallow);
            child.on('error', swallow);
            opts.signal.removeEventListener('abort', onAbort);
        };
        const finish = (action) => {
            if (settled)
                return;
            settled = true;
            clearTimers();
            removeListeners();
            action();
        };
        function killSigkill() {
            forcedKill = true;
            try {
                child.kill('SIGKILL');
            }
            catch {
                // Best effort: the process may already be gone.
            }
        }
        function beginCancellation(cause) {
            if (localCause !== undefined)
                return;
            localCause = cause;
            try {
                child.kill('SIGTERM');
            }
            catch {
                // Best effort: the process may already be gone.
            }
            sigkillTimer = setTimeout(killSigkill, SIGKILL_GRACE_MS);
        }
        function onAbort() {
            beginCancellation('caller-cancelled');
        }
        opts.signal.addEventListener('abort', onAbort);
        if (opts.signal.aborted)
            onAbort();
        const remainingMs = opts.deadlineAt - Date.now();
        deadlineTimer = setTimeout(() => beginCancellation('deadline'), Math.max(0, remainingMs));
        function hardFail(err) {
            killSigkill();
            finish(() => reject(err instanceof errors_js_1.GoalEngineError
                ? err
                : new errors_js_1.GoalEngineError('GOAL_PROTOCOL_TRANSPORT', String(err))));
        }
        const onChildError = (error) => {
            finish(() => reject(mapSpawnError(error)));
        };
        const onStdoutData = (chunk) => {
            if (settled)
                return;
            stdoutBytes += chunk.length;
            if (stdoutBytes > opts.limits.maxStdoutBytes) {
                hardFail(new errors_js_1.GoalEngineError('GOAL_PROTOCOL_TRANSPORT', 'stdout exceeded its byte bound'));
                return;
            }
            if (opts.onStdout !== undefined) {
                try {
                    opts.onStdout(chunk);
                }
                catch (err) {
                    hardFail(err);
                }
            }
            else {
                stdoutChunks.push(chunk);
            }
        };
        const onStderrData = (chunk) => {
            if (settled)
                return;
            stderrBytes += chunk.length;
            if (stderrBytes > opts.limits.maxStderrBytes) {
                hardFail(new errors_js_1.GoalEngineError('GOAL_PROTOCOL_TRANSPORT', 'stderr exceeded its byte bound'));
                return;
            }
            stderrChunks.push(chunk);
        };
        const onStdoutError = (error) => {
            hardFail(new errors_js_1.GoalEngineError('GOAL_PROTOCOL_TRANSPORT', `stdout stream error: ${error.message}`));
        };
        const onStderrError = (error) => {
            hardFail(new errors_js_1.GoalEngineError('GOAL_PROTOCOL_TRANSPORT', `stderr stream error: ${error.message}`));
        };
        const onClose = (code, signal) => {
            finish(() => resolve({
                exitCode: code,
                signal,
                stdout: Buffer.concat(stdoutChunks),
                stderr: Buffer.concat(stderrChunks),
                ...(localCause !== undefined ? { localCause } : {}),
                forcedKill,
            }));
        };
        child.on('error', onChildError);
        child.stdout?.on('data', onStdoutData);
        child.stderr?.on('data', onStderrData);
        child.stdout?.on('error', onStdoutError);
        child.stderr?.on('error', onStderrError);
        child.on('close', onClose);
    });
}
/**
 * Allowlisted, credential-free child environment: PATH, LANG/LC_ALL when
 * present, and a disposable HOME/TMPDIR/XDG_CONFIG_HOME/XDG_CACHE_HOME under
 * `scratchDir`. Ambient provider credentials and NODE_OPTIONS are never
 * forwarded from `sourceEnv`.
 */
function buildChildEnv(input) {
    const { sourceEnv, scratchDir, childEnvOverride } = input;
    const home = (0, node_path_1.join)(scratchDir, 'home');
    const tmp = (0, node_path_1.join)(scratchDir, 'tmp');
    (0, node_fs_1.mkdirSync)(home, { recursive: true });
    (0, node_fs_1.mkdirSync)(tmp, { recursive: true });
    const env = {
        PATH: sourceEnv['PATH'] ?? '',
        HOME: home,
        TMPDIR: tmp,
        XDG_CONFIG_HOME: (0, node_path_1.join)(home, '.config'),
        XDG_CACHE_HOME: (0, node_path_1.join)(home, '.cache'),
    };
    const lang = sourceEnv['LANG'];
    if (lang !== undefined)
        env['LANG'] = lang;
    const lcAll = sourceEnv['LC_ALL'];
    if (lcAll !== undefined)
        env['LC_ALL'] = lcAll;
    if (childEnvOverride !== undefined) {
        for (const [key, value] of Object.entries(childEnvOverride)) {
            if (value !== undefined)
                env[key] = value;
        }
    }
    return env;
}
function createOperationScratchDir(env) {
    const override = env['GOAL_GEN_SCRATCH'];
    if (typeof override === 'string' && override.length > 0) {
        return { path: override, owned: false };
    }
    return { path: (0, node_fs_1.mkdtempSync)((0, node_path_1.join)((0, node_os_1.tmpdir)(), 'yellow-goal-op-')), owned: true };
}
