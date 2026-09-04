"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoalEngineError = void 0;
exports.toGoalError = toGoalError;
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
};
class GoalEngineError extends Error {
    code;
    retryable;
    recoveryAction;
    engineVersion;
    pinnedVersion;
    constructor(code, message, extras = {}) {
        super(message);
        this.name = 'GoalEngineError';
        this.code = code;
        this.retryable = CODE_TABLE[code].retryable;
        this.recoveryAction = CODE_TABLE[code].recoveryAction;
        this.engineVersion = extras.engineVersion;
        this.pinnedVersion = extras.pinnedVersion;
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
