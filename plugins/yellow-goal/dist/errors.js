"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoalEngineError = void 0;
exports.toGoalError = toGoalError;
const MAX_DIAGNOSTIC_STRING = 200;
function capDiagnostic(value) {
    if (value === undefined)
        return undefined;
    return value.length > MAX_DIAGNOSTIC_STRING
        ? value.slice(0, MAX_DIAGNOSTIC_STRING)
        : value;
}
function normalizeEventCount(value) {
    if (value === undefined)
        return undefined;
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
const CODE_TABLE = {
    GOAL_ENGINE_MISSING: {
        retryable: false,
        recoveryAction: 'Install the pinned goal-gen tarball and put `goal-gen` on PATH, then rerun /goal:setup.',
    },
    GOAL_ENGINE_UNRUNNABLE: {
        retryable: false,
        recoveryAction: 'goal-gen is on PATH but could not be executed. Check permissions and rerun /goal:setup.',
    },
    GOAL_ENGINE_VERSION_MISMATCH: {
        retryable: false,
        recoveryAction: 'Install the pinned engine version (see plugins/yellow-goal/src/pin.ts) and rerun /goal:setup.',
    },
    GOAL_ENGINE_UNPARSEABLE: {
        retryable: false,
        recoveryAction: 'goal-gen did not emit the process-contract JSON. Confirm the binary is a real goal-gen, not a wrapper.',
    },
    GOAL_ENGINE_USAGE_ERROR: {
        retryable: false,
        recoveryAction: 'Fix the reported CLI invocation and retry.',
    },
    GOAL_ENGINE_FAILED: {
        retryable: false,
        recoveryAction: 'Inspect the engine error payload and retry after fixing the request.',
    },
    GOAL_INVALID_INPUT: {
        retryable: false,
        recoveryAction: 'Fix the reported CLI invocation and retry.',
    },
    GOAL_PROTOCOL_INCOMPATIBLE: {
        retryable: false,
        recoveryAction: 'Update the pinned engine (or its declared protocol/capabilities) so identities, required capabilities, and limits agree, then retry.',
    },
    GOAL_PROTOCOL_INVALID: {
        retryable: false,
        recoveryAction: 'The engine violated the provider protocol contract; report the malformed output instead of retrying unmodified.',
    },
    GOAL_PROTOCOL_TRANSPORT: {
        retryable: true,
        recoveryAction: 'The stdout/stderr transport failed or was truncated; retry the run.',
    },
    GOAL_RUN_FAILED: {
        retryable: false,
        recoveryAction: 'Inspect the run summary reason and retry after fixing the request.',
    },
    GOAL_RUN_BUDGET_EXHAUSTED: {
        retryable: false,
        recoveryAction: 'Increase the configured budget or reduce run scope, then retry.',
    },
    GOAL_RUN_GATE_REQUIRED: {
        retryable: false,
        recoveryAction: 'Supply the required consent (e.g. --yes) before retrying the run.',
    },
    GOAL_RUN_ENGINE_TIMEOUT: {
        retryable: false,
        recoveryAction: 'Increase --timeout-ms or investigate why the run did not finish in time.',
    },
    GOAL_RUN_CANCELLED: {
        retryable: false,
        recoveryAction: 'The run was cancelled by a signal; retry only if the cancellation was unintended.',
    },
    GOAL_RUN_DEADLINE_EXCEEDED: {
        retryable: true,
        recoveryAction: 'The caller deadline elapsed before the run finished; retry with a longer deadline.',
    },
};
class GoalEngineError extends Error {
    code;
    retryable;
    recoveryAction;
    engineVersion;
    pinnedVersion;
    runId;
    eventCount;
    terminalStatus;
    terminationReason;
    gateKind;
    localCause;
    constructor(code, message, extras = {}) {
        super(message);
        this.name = 'GoalEngineError';
        this.code = code;
        this.retryable = CODE_TABLE[code].retryable;
        this.recoveryAction = CODE_TABLE[code].recoveryAction;
        this.engineVersion = extras.engineVersion;
        this.pinnedVersion = extras.pinnedVersion;
        this.runId = capDiagnostic(extras.runId);
        this.eventCount = normalizeEventCount(extras.eventCount);
        this.terminalStatus = capDiagnostic(extras.terminalStatus);
        this.terminationReason = capDiagnostic(extras.terminationReason);
        this.gateKind = capDiagnostic(extras.gateKind);
        this.localCause = extras.localCause;
    }
    toJson() {
        return {
            code: this.code,
            message: this.message,
            retryable: this.retryable,
            recoveryAction: this.recoveryAction,
            ...(this.engineVersion !== undefined
                ? { engineVersion: this.engineVersion }
                : {}),
            ...(this.pinnedVersion !== undefined
                ? { pinnedVersion: this.pinnedVersion }
                : {}),
            ...(this.runId !== undefined ? { runId: this.runId } : {}),
            ...(this.eventCount !== undefined ? { eventCount: this.eventCount } : {}),
            ...(this.terminalStatus !== undefined
                ? { terminalStatus: this.terminalStatus }
                : {}),
            ...(this.terminationReason !== undefined
                ? { terminationReason: this.terminationReason }
                : {}),
            ...(this.gateKind !== undefined ? { gateKind: this.gateKind } : {}),
            ...(this.localCause !== undefined ? { localCause: this.localCause } : {}),
        };
    }
}
exports.GoalEngineError = GoalEngineError;
function toGoalError(err) {
    if (err instanceof GoalEngineError) {
        return err.toJson();
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
        code: 'GOAL_ENGINE_FAILED',
        message,
        retryable: false,
        recoveryAction: CODE_TABLE.GOAL_ENGINE_FAILED.recoveryAction,
    };
}
