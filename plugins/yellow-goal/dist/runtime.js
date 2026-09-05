"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setup = setup;
exports.requestCreate = requestCreate;
exports.requestValidate = requestValidate;
exports.runStub = runStub;
const node_fs_1 = require("node:fs");
const errors_js_1 = require("./errors.js");
const pin_js_1 = require("./pin.js");
const provider_process_js_1 = require("./provider-process.js");
const provider_protocol_js_1 = require("./provider-protocol.js");
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
const DEFAULT_DEADLINE_BASE_MS = 120_000;
const MIN_TIMEOUT_MS = 1;
const MAX_TIMEOUT_MS = 3_600_000;
function runStubUsageError(message) {
    throw new errors_js_1.GoalEngineError('GOAL_INVALID_INPUT', message);
}
function validateScenario(scenario) {
    if (!provider_protocol_js_1.STUB_SCENARIOS.includes(scenario)) {
        runStubUsageError(`unknown stub scenario "${scenario}"; expected one of: ${provider_protocol_js_1.STUB_SCENARIOS.join(', ')}`);
    }
}
function validateTimeoutMs(timeoutMs, scenario) {
    if (timeoutMs === undefined) {
        if (scenario === 'await-cancel') {
            runStubUsageError('the await-cancel scenario requires --timeout-ms');
        }
        return;
    }
    if (!Number.isSafeInteger(timeoutMs) ||
        timeoutMs < MIN_TIMEOUT_MS ||
        timeoutMs > MAX_TIMEOUT_MS) {
        runStubUsageError(`--timeout-ms must be a safe integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}`);
    }
}
function localCauseError(cause, extras = {}) {
    if (cause === 'caller-cancelled') {
        return new errors_js_1.GoalEngineError('GOAL_RUN_CANCELLED', 'run cancelled by the caller before completion', { ...extras, localCause: cause });
    }
    return new errors_js_1.GoalEngineError('GOAL_RUN_DEADLINE_EXCEEDED', 'the consumer deadline elapsed before completion', { ...extras, localCause: cause });
}
/** Rethrow a caught failure with runId/eventCount filled in when absent. */
function attachRunDiagnostics(err, runId, eventCount) {
    if (err instanceof errors_js_1.GoalEngineError) {
        throw new errors_js_1.GoalEngineError(err.code, err.message, {
            engineVersion: err.engineVersion,
            pinnedVersion: err.pinnedVersion,
            runId: err.runId ?? runId,
            eventCount: err.eventCount ?? eventCount,
            terminalStatus: err.terminalStatus,
            terminationReason: err.terminationReason,
            gateKind: err.gateKind,
            localCause: err.localCause,
        });
    }
    throw err;
}
const BOOTSTRAP_LIMITS = {
    maxStdoutBytes: provider_protocol_js_1.CONSUMER_LIMITS.bootstrapMaxStdoutBytes,
    maxStderrBytes: provider_protocol_js_1.CONSUMER_LIMITS.bootstrapMaxStderrBytes,
};
function probeOutcome(result, label) {
    if (result.forcedKill || result.signal !== null) {
        throw new errors_js_1.GoalEngineError('GOAL_PROTOCOL_TRANSPORT', `${label} probe did not close cleanly`);
    }
    if (result.localCause !== undefined) {
        // Probe-phase local cancellation/deadline: discard partial output.
        throw localCauseError(result.localCause);
    }
}
async function runStub(deps, input) {
    validateScenario(input.scenario);
    validateTimeoutMs(input.timeoutMs, input.scenario);
    const pinnedScratch = deps.env['GOAL_GEN_SCRATCH'];
    const scratchDir = (0, provider_process_js_1.createOperationScratchDir)(deps.env);
    try {
        return await runStubInScratch(deps, input, scratchDir);
    }
    finally {
        if (typeof pinnedScratch !== 'string' || pinnedScratch.length === 0) {
            (0, node_fs_1.rmSync)(scratchDir, { recursive: true, force: true });
        }
    }
}
async function runStubInScratch(deps, input, scratchDir) {
    const controller = new AbortController();
    let localCause;
    const deadlineAt = Date.now() +
        (input.deadlineMs ?? DEFAULT_DEADLINE_BASE_MS + (input.timeoutMs ?? 0));
    const recordLocalCause = (cause) => {
        if (localCause === undefined)
            localCause = cause;
    };
    if (input.signal !== undefined) {
        if (input.signal.aborted) {
            recordLocalCause('caller-cancelled');
            controller.abort();
        }
        else {
            input.signal.addEventListener('abort', () => {
                recordLocalCause('caller-cancelled');
                controller.abort();
            }, { once: true });
        }
    }
    function checkNotCancelled() {
        if (localCause !== undefined)
            throw localCauseError(localCause);
        if (Date.now() >= deadlineAt) {
            recordLocalCause('deadline');
            controller.abort();
            throw localCauseError('deadline');
        }
    }
    checkNotCancelled();
    const bin = (0, spawn_js_1.resolveEngineBin)(deps.env);
    const env = (0, provider_process_js_1.buildChildEnv)({
        sourceEnv: deps.env,
        scratchDir,
        childEnvOverride: deps.childEnvOverride,
    });
    function runChild(argv, limits, onStdout) {
        return (0, provider_process_js_1.spawnProtocolChild)({
            bin,
            argv,
            env,
            deadlineAt,
            signal: controller.signal,
            limits,
            ...(onStdout !== undefined ? { onStdout } : {}),
        });
    }
    // Phase 1: version.
    const versionResult = await runChild(['version', '--json'], BOOTSTRAP_LIMITS);
    probeOutcome(versionResult, 'version');
    if (versionResult.stdout.length === 0) {
        throw (0, provider_protocol_js_1.classifyPreflightFailure)({
            exitCode: versionResult.exitCode,
            signal: versionResult.signal,
            stdout: versionResult.stdout,
            stderr: versionResult.stderr,
        });
    }
    const engineVersion = (0, provider_protocol_js_1.validateVersionProbe)((0, provider_protocol_js_1.parseSingleJsonObject)(versionResult.stdout, 'version probe', provider_protocol_js_1.CONSUMER_LIMITS.bootstrapMaxStdoutBytes), pin_js_1.PINNED_ENGINE_VERSION);
    checkNotCancelled();
    // Phase 2: capabilities.
    const capabilitiesResult = await runChild(['capabilities', '--json'], BOOTSTRAP_LIMITS);
    probeOutcome(capabilitiesResult, 'capabilities');
    if (capabilitiesResult.stdout.length === 0) {
        throw (0, provider_protocol_js_1.classifyPreflightFailure)({
            exitCode: capabilitiesResult.exitCode,
            signal: capabilitiesResult.signal,
            stdout: capabilitiesResult.stdout,
            stderr: capabilitiesResult.stderr,
        });
    }
    const capabilities = (0, provider_protocol_js_1.validateCapabilities)((0, provider_protocol_js_1.parseSingleJsonObject)(capabilitiesResult.stdout, 'capabilities probe', provider_protocol_js_1.CONSUMER_LIMITS.bootstrapMaxStdoutBytes), pin_js_1.PINNED_ENGINE_VERSION);
    if (!capabilities.stubScenarios.includes(input.scenario)) {
        throw new errors_js_1.GoalEngineError('GOAL_PROTOCOL_INCOMPATIBLE', `engine did not advertise the ${input.scenario} stub scenario`, {
            engineVersion: capabilities.engineVersion,
            pinnedVersion: pin_js_1.PINNED_ENGINE_VERSION,
        });
    }
    checkNotCancelled();
    // Phase 3: run.
    const runArgv = [
        'run',
        '--executor',
        'stub',
        '--protocol',
        'v1',
        '--stub-scenario',
        input.scenario,
        ...(input.timeoutMs !== undefined
            ? ['--timeout-ms', String(input.timeoutMs)]
            : []),
        ...(input.yes === true ? ['--yes'] : []),
        '--',
        input.request,
    ];
    const framer = new provider_protocol_js_1.JsonLinesFramer({
        maxRecordBytes: Math.min(provider_protocol_js_1.CONSUMER_LIMITS.maxEventBytes, capabilities.limits.maxEventBytes),
        maxTotalBytes: provider_protocol_js_1.CONSUMER_LIMITS.maxStdoutBytes,
    });
    const validator = new provider_protocol_js_1.RunStreamValidator();
    const onStdout = (chunk) => {
        for (const record of framer.push(chunk))
            validator.accept(record);
    };
    let runResult;
    try {
        runResult = await runChild(runArgv, {
            maxStdoutBytes: provider_protocol_js_1.CONSUMER_LIMITS.maxStdoutBytes,
            maxStderrBytes: provider_protocol_js_1.CONSUMER_LIMITS.maxStderrBytes,
        }, onStdout);
    }
    catch (err) {
        attachRunDiagnostics(err, validator.snapshot.runId, validator.snapshot.eventCount);
    }
    if (runResult.forcedKill || runResult.signal !== null) {
        throw new errors_js_1.GoalEngineError('GOAL_PROTOCOL_TRANSPORT', 'run did not close cleanly', {
            runId: validator.snapshot.runId,
            eventCount: validator.snapshot.eventCount,
        });
    }
    function finalizeRunStream() {
        framer.finish();
        const snapshot = validator.snapshot;
        if (framer.bytesConsumed === 0 && snapshot.summary === undefined) {
            throw (0, provider_protocol_js_1.classifyPreflightFailure)({
                exitCode: runResult.exitCode,
                signal: runResult.signal,
                stdout: Buffer.alloc(0),
                stderr: runResult.stderr,
            });
        }
        validator.finish();
        const finished = validator.snapshot;
        if (finished.summary === undefined) {
            throw new errors_js_1.GoalEngineError('GOAL_PROTOCOL_INVALID', 'run stream ended without a validated summary');
        }
        return (0, provider_protocol_js_1.validateTerminalAgreement)({
            exitCode: runResult.exitCode,
            signal: runResult.signal,
            stderr: runResult.stderr,
            summary: finished.summary,
            gateKind: finished.gateKind,
        });
    }
    let outcome;
    try {
        outcome = finalizeRunStream();
    }
    catch (err) {
        if (runResult.localCause !== undefined) {
            // A cancellation interrupted the stream before it could fully agree;
            // that is a transport artifact of our own signal, never a protocol
            // violation by the engine.
            throw new errors_js_1.GoalEngineError('GOAL_PROTOCOL_TRANSPORT', 'run stream was incomplete after cancellation', {
                runId: validator.snapshot.runId,
                eventCount: validator.snapshot.eventCount,
                localCause: runResult.localCause,
            });
        }
        attachRunDiagnostics(err, validator.snapshot.runId, validator.snapshot.eventCount);
    }
    const snapshot = validator.snapshot;
    if (runResult.localCause !== undefined) {
        // The stream fully and validly agreed (success or an engine terminal),
        // but a local cause still wins: it was observed before this close.
        recordLocalCause(runResult.localCause);
        throw localCauseError(runResult.localCause, {
            runId: snapshot.runId,
            eventCount: snapshot.eventCount,
        });
    }
    if (outcome.kind === 'succeeded') {
        if (snapshot.runId === undefined) {
            throw new errors_js_1.GoalEngineError('GOAL_PROTOCOL_INVALID', 'succeeded run stream is missing its run identity');
        }
        return {
            engineVersion,
            protocolVersion: capabilities.protocolVersion,
            runId: snapshot.runId,
            eventCount: snapshot.eventCount,
            summary: snapshot.summary,
        };
    }
    throw new errors_js_1.GoalEngineError(outcome.code, outcome.message, {
        runId: snapshot.runId,
        eventCount: snapshot.eventCount,
        terminalStatus: snapshot.summary?.status,
        terminationReason: snapshot.summary?.terminationReason,
        gateKind: snapshot.gateKind,
    });
}
