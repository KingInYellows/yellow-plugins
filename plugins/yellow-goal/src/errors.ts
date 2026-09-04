export type GoalErrorCode =
  | 'GOAL_ENGINE_MISSING'
  | 'GOAL_ENGINE_UNRUNNABLE'
  | 'GOAL_ENGINE_VERSION_MISMATCH'
  | 'GOAL_ENGINE_UNPARSEABLE'
  | 'GOAL_ENGINE_USAGE_ERROR'
  | 'GOAL_ENGINE_FAILED'
  | 'GOAL_INVALID_INPUT';

export interface GoalError {
  readonly code: GoalErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly recoveryAction: string;
  readonly engineVersion?: string;
  readonly pinnedVersion?: string;
}

interface CodeDefaults {
  readonly retryable: boolean;
  readonly recoveryAction: string;
}

const CODE_TABLE: Record<GoalErrorCode, CodeDefaults> = {
  GOAL_ENGINE_MISSING: {
    retryable: false,
    recoveryAction:
      'Install the pinned goal-gen tarball and put `goal-gen` on PATH, then rerun /goal:setup.',
  },
  GOAL_ENGINE_UNRUNNABLE: {
    retryable: false,
    recoveryAction:
      'goal-gen is on PATH but could not be executed. Check permissions and rerun /goal:setup.',
  },
  GOAL_ENGINE_VERSION_MISMATCH: {
    retryable: false,
    recoveryAction:
      'Install the pinned engine version (see plugins/yellow-goal/src/pin.ts) and rerun /goal:setup.',
  },
  GOAL_ENGINE_UNPARSEABLE: {
    retryable: false,
    recoveryAction:
      'goal-gen did not emit the process-contract JSON. Confirm the binary is a real goal-gen, not a wrapper.',
  },
  GOAL_ENGINE_USAGE_ERROR: {
    retryable: false,
    recoveryAction: 'Fix the reported CLI invocation and retry.',
  },
  GOAL_ENGINE_FAILED: {
    retryable: false,
    recoveryAction:
      'Inspect the engine error payload and retry after fixing the request.',
  },
  GOAL_INVALID_INPUT: {
    retryable: false,
    recoveryAction: 'Fix the reported CLI invocation and retry.',
  },
};

export class GoalEngineError extends Error {
  readonly code: GoalErrorCode;
  readonly retryable: boolean;
  readonly recoveryAction: string;
  readonly engineVersion: string | undefined;
  readonly pinnedVersion: string | undefined;

  constructor(
    code: GoalErrorCode,
    message: string,
    extras: { engineVersion?: string; pinnedVersion?: string } = {}
  ) {
    super(message);
    this.name = 'GoalEngineError';
    this.code = code;
    this.retryable = CODE_TABLE[code].retryable;
    this.recoveryAction = CODE_TABLE[code].recoveryAction;
    this.engineVersion = extras.engineVersion;
    this.pinnedVersion = extras.pinnedVersion;
  }

  toJson(): GoalError {
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

export function toGoalError(err: unknown): GoalError {
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
