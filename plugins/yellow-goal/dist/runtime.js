"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setup = setup;
exports.requestCreate = requestCreate;
exports.requestValidate = requestValidate;
const errors_js_1 = require("./errors.js");
const pin_js_1 = require("./pin.js");
const spawn_js_1 = require("./spawn.js");
function firstJsonLine(text) {
    const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    const line = lines[0];
    if (lines.length !== 1 || line === undefined) {
        throw new errors_js_1.GoalEngineError('GOAL_ENGINE_UNPARSEABLE', 'goal-gen must produce exactly one JSON line on stdout');
    }
    try {
        return JSON.parse(line);
    }
    catch {
        throw new errors_js_1.GoalEngineError('GOAL_ENGINE_UNPARSEABLE', `goal-gen stdout was not JSON: ${line.slice(0, 200)}`);
    }
}
function isRecord(value) {
    return value !== null && typeof value === 'object';
}
function isValidationError(value) {
    return (isRecord(value) &&
        typeof value['path'] === 'string' &&
        typeof value['message'] === 'string');
}
function isSchemaInvalidValidationResult(value, validationPath) {
    if (!isRecord(value))
        return false;
    if (value['valid'] !== false || value['path'] !== validationPath)
        return false;
    return (Array.isArray(value['errors']) &&
        value['errors'].length > 0 &&
        value['errors'].every(isValidationError));
}
function engineErrorMessage(result, validationPath) {
    if (result.stderr.trim()) {
        if (result.stdout.trim()) {
            throw new errors_js_1.GoalEngineError('GOAL_ENGINE_UNPARSEABLE', 'engine failure contains both stdout and stderr');
        }
        try {
            const parsed = JSON.parse(result.stderr.trim());
            if (result.stderr.trim().split(/\r?\n/).length === 1 &&
                typeof parsed?.error?.code === 'string' &&
                typeof parsed.error.message === 'string' &&
                (result.exitCode === 2) === (parsed.error.code === 'USAGE_ERROR')) {
                return `${parsed.error.code}: ${parsed.error.message}`;
            }
        }
        catch {
            throw new errors_js_1.GoalEngineError('GOAL_ENGINE_UNPARSEABLE', 'engine stderr is not a structured error');
        }
        throw new errors_js_1.GoalEngineError('GOAL_ENGINE_UNPARSEABLE', 'engine stderr disagrees with its exit code or error contract');
    }
    // request validate reports schema-invalid data on stdout with exit 1.
    const parsed = firstJsonLine(result.stdout);
    if (validationPath !== undefined &&
        result.exitCode === 1 &&
        isSchemaInvalidValidationResult(parsed, validationPath)) {
        return `request validation failed: ${JSON.stringify(parsed).slice(0, 400)}`;
    }
    throw new errors_js_1.GoalEngineError('GOAL_ENGINE_UNPARSEABLE', 'engine failure has no structured error or validation result');
}
function throwOnEngineFailure(result, validationPath) {
    if (![0, 1, 2].includes(result.exitCode)) {
        throw new errors_js_1.GoalEngineError('GOAL_ENGINE_UNPARSEABLE', `engine returned unsupported exit code ${result.exitCode}`);
    }
    if (result.exitCode === 0) {
        if (result.stderr.trim()) {
            throw new errors_js_1.GoalEngineError('GOAL_ENGINE_UNPARSEABLE', 'engine success contains stderr diagnostics');
        }
        return;
    }
    if (result.exitCode === 2) {
        throw new errors_js_1.GoalEngineError('GOAL_ENGINE_USAGE_ERROR', engineErrorMessage(result, validationPath));
    }
    throw new errors_js_1.GoalEngineError('GOAL_ENGINE_FAILED', engineErrorMessage(result, validationPath));
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
    setup(deps);
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
    setup(deps);
    const result = deps.spawn([
        'request',
        'validate',
        '--json',
        '--',
        input.request,
    ]);
    throwOnEngineFailure(result, input.request);
    const parsed = firstJsonLine(result.stdout);
    if (parsed === null ||
        typeof parsed !== 'object' ||
        parsed.valid !== true) {
        throw new errors_js_1.GoalEngineError('GOAL_ENGINE_FAILED', `request validate did not return valid:true (${JSON.stringify(parsed).slice(0, 200)})`);
    }
    return { valid: true, request: input.request };
}
