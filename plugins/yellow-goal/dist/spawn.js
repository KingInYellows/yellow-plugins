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
        if (result.error) {
            const code = result.error.code;
            if (code === 'ETIMEDOUT') {
                throw new errors_js_1.GoalEngineError('GOAL_ENGINE_FAILED', `goal-gen timed out after ${timeoutMs}ms`);
            }
            if (code === 'ENOENT') {
                throw new errors_js_1.GoalEngineError('GOAL_ENGINE_MISSING', `goal-gen not found on PATH (looked up as ${bin})`);
            }
            if (code === 'EACCES' || code === 'EPERM') {
                throw new errors_js_1.GoalEngineError('GOAL_ENGINE_UNRUNNABLE', `goal-gen could not be executed (${code})`);
            }
            throw new errors_js_1.GoalEngineError('GOAL_ENGINE_FAILED', result.error.message);
        }
        if (result.signal !== null) {
            throw new errors_js_1.GoalEngineError('GOAL_ENGINE_FAILED', `goal-gen terminated by ${result.signal}`);
        }
        return {
            exitCode: result.status ?? 1,
            stdout: result.stdout ?? '',
            stderr: result.stderr ?? '',
        };
    };
}
