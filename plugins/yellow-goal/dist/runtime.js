"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setup = setup;
exports.requestCreate = requestCreate;
exports.requestValidate = requestValidate;
const errors_js_1 = require("./errors.js");
const pin_js_1 = require("./pin.js");
const spawn_js_1 = require("./spawn.js");
function firstJsonLine(text) {
    const line = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.length > 0);
    if (line === undefined) {
        throw new errors_js_1.GoalEngineError('GOAL_ENGINE_UNPARSEABLE', 'goal-gen produced empty stdout');
    }
    try {
        return JSON.parse(line);
    }
    catch {
        throw new errors_js_1.GoalEngineError('GOAL_ENGINE_UNPARSEABLE', `goal-gen stdout was not JSON: ${line.slice(0, 200)}`);
    }
}
function engineErrorMessage(result) {
    const line = result.stderr
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.length > 0);
    if (line !== undefined) {
        try {
            const parsed = JSON.parse(line);
            if (parsed.error?.message) {
                return `${parsed.error.code ?? 'ENGINE'}: ${parsed.error.message}`;
            }
        }
        catch {
            return line.slice(0, 400);
        }
        return line.slice(0, 400);
    }
    return result.stdout.trim().slice(0, 400) || `exit ${result.exitCode}`;
}
function throwOnEngineFailure(result) {
    if (result.exitCode === 0) {
        return;
    }
    if (result.exitCode === 2) {
        throw new errors_js_1.GoalEngineError('GOAL_ENGINE_USAGE_ERROR', engineErrorMessage(result));
    }
    throw new errors_js_1.GoalEngineError('GOAL_ENGINE_FAILED', engineErrorMessage(result));
}
function setup(deps) {
    const result = deps.spawn(['version', '--json']);
    throwOnEngineFailure(result);
    const parsed = firstJsonLine(result.stdout);
    if (parsed === null ||
        typeof parsed !== 'object' ||
        !('engineVersion' in parsed) ||
        typeof parsed.engineVersion !== 'string') {
        throw new errors_js_1.GoalEngineError('GOAL_ENGINE_UNPARSEABLE', 'goal-gen version --json did not include a string engineVersion');
    }
    const engineVersion = parsed.engineVersion;
    if (engineVersion !== pin_js_1.PINNED_ENGINE_VERSION) {
        throw new errors_js_1.GoalEngineError('GOAL_ENGINE_VERSION_MISMATCH', `engineVersion ${engineVersion} does not match pin ${pin_js_1.PINNED_ENGINE_VERSION}`, { engineVersion, pinnedVersion: pin_js_1.PINNED_ENGINE_VERSION });
    }
    return {
        engineVersion,
        pinnedVersion: pin_js_1.PINNED_ENGINE_VERSION,
        binary: (0, spawn_js_1.resolveEngineBin)(deps.env),
    };
}
function requestCreate(deps, input) {
    const result = deps.spawn([
        'request',
        'create',
        '--repo',
        input.repo,
        '--goal',
        input.goal,
        '--output',
        input.output,
        '--json',
    ]);
    throwOnEngineFailure(result);
    const parsed = firstJsonLine(result.stdout);
    if (parsed === null ||
        typeof parsed !== 'object' ||
        !('requestId' in parsed) ||
        typeof parsed.requestId !== 'string') {
        throw new errors_js_1.GoalEngineError('GOAL_ENGINE_UNPARSEABLE', 'goal-gen request create --json did not include a string requestId');
    }
    return {
        requestId: parsed.requestId,
        output: input.output,
    };
}
function requestValidate(deps, input) {
    const result = deps.spawn(['request', 'validate', input.request, '--json']);
    throwOnEngineFailure(result);
    const parsed = firstJsonLine(result.stdout);
    if (parsed === null ||
        typeof parsed !== 'object' ||
        parsed.valid !== true) {
        throw new errors_js_1.GoalEngineError('GOAL_ENGINE_FAILED', `request validate did not return valid:true (${JSON.stringify(parsed).slice(0, 200)})`);
    }
    return { valid: true, request: input.request };
}
