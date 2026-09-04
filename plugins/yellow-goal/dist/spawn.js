"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveEngineBin = resolveEngineBin;
exports.createDefaultSpawn = createDefaultSpawn;
/**
 * Process-boundary spawn. The engine is always a child process — never
 * imported. Args are an argv array (`shell` stays false).
 */
const node_child_process_1 = require("node:child_process");
const errors_js_1 = require("./errors.js");
function resolveEngineBin(env) {
    const override = env['GOAL_GEN_BIN'];
    if (typeof override === 'string' && override.length > 0) {
        return override;
    }
    return 'goal-gen';
}
function spawnError(error, bin, timeoutMs) {
    switch (error.code) {
        case 'ETIMEDOUT':
            return new errors_js_1.GoalEngineError('GOAL_ENGINE_FAILED', `goal-gen timed out after ${timeoutMs}ms`);
        case 'ENOENT':
            return new errors_js_1.GoalEngineError('GOAL_ENGINE_MISSING', `goal-gen not found on PATH (looked up as ${bin})`);
        case 'EACCES':
        case 'EPERM':
            return new errors_js_1.GoalEngineError('GOAL_ENGINE_UNRUNNABLE', `goal-gen could not be executed (${error.code})`);
        default:
            return new errors_js_1.GoalEngineError('GOAL_ENGINE_FAILED', error.message);
    }
}
function outputText(value) {
    return value ?? '';
}
function completedSpawn(result, bin, timeoutMs) {
    if (result.error)
        throw spawnError(result.error, bin, timeoutMs);
    if (result.signal !== null) {
        throw new errors_js_1.GoalEngineError('GOAL_ENGINE_FAILED', `goal-gen terminated by ${result.signal}`);
    }
    return {
        exitCode: result.status ?? 1,
        stdout: outputText(result.stdout),
        stderr: outputText(result.stderr),
    };
}
function createDefaultSpawn(env, timeoutMs = 30_000) {
    return (args) => {
        const bin = resolveEngineBin(env);
        const result = (0, node_child_process_1.spawnSync)(bin, [...args], {
            encoding: 'utf8',
            timeout: timeoutMs,
            // spawnSync waits for the child after timeout; SIGTERM can be ignored.
            killSignal: 'SIGKILL',
            env,
            maxBuffer: 10 * 1024 * 1024,
            windowsHide: true,
            shell: false,
        });
        return completedSpawn(result, bin, timeoutMs);
    };
}
