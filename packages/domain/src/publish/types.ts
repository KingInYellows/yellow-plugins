/**
 * @yellow-plugins/domain - Publish Transaction Types
 *
 * Domain types for plugin publishing, validation, and git operations.
 * Implements publish lifecycle with manifest validation, git status checks, and atomic operations.
 *
 * Part of Task I4.T1: Publish Service and CLI Command
 *
 * Architecture References:
 * - Section 3.0: API Design & Communication (git-native publish workflow)
 * - FR-008: Update Notifications (publish integration)
 * - CRIT-005: Publish workflow validation
 * - Assumption 2: Git authentication via existing credentials
 */

/**
 * Publish request parameters from CLI layer.
 * Matches CLI contract expectations from Architecture §3.7.
 */
export interface PublishRequest {
  /**
   * Plugin identifier to publish
   */
  readonly pluginId: string;

  /**
   * Whether to push changes to remote after validation
   */
  readonly push?: boolean;

  /**
   * Optional commit message override
   */
  readonly message?: string;

  /**
   * Optional tag to create
   */
  readonly tag?: string;

  /**
   * Script review digest (proves user saw lifecycle scripts)
   */
  readonly scriptReviewDigest?: string;

  /**
   * Correlation ID for tracing
   */
  readonly correlationId?: string;

  /**
   * Dry-run mode (validate without mutations)
   */
  readonly dryRun?: boolean;
}

/**
 * Git provenance information captured before publish.
 * Tracks repository state for audit trail.
 */
export interface GitProvenance {
  /**
   * Repository URL (origin remote)
   */
  readonly repoUrl: string;

  /**
   * Current commit SHA
   */
  readonly commitSha: string;

  /**
   * Current branch name
   */
  readonly branch: string;

  /**
   * Whether working directory has uncommitted changes
   */
  readonly isDirty: boolean;

  /**
   * Ahead/behind remote tracking status
   */
  readonly trackingStatus?: {
    readonly ahead: number;
    readonly behind: number;
  };

  /**
   * Remote name (default: 'origin')
   */
  readonly remoteName: string;
}

/**
 * Manifest validation result.
 */
export interface ManifestValidationResult {
  /**
   * Whether manifest is valid
   */
  readonly valid: boolean;

  /**
   * Validation errors (blocking issues)
   */
  readonly errors: Array<{
    readonly code: string;
    readonly message: string;
    readonly path?: string;
  }>;

  /**
   * Validation warnings (non-blocking issues)
   */
  readonly warnings: Array<{
    readonly code: string;
    readonly message: string;
    readonly path?: string;
  }>;

  /**
   * Manifest digest (SHA-256)
   */
  readonly digest?: string;
}

/**
 * Lifecycle script execution result for publish hooks.
 */
export interface PublishLifecycleResult {
  /**
   * Whether script executed successfully
   */
  readonly success: boolean;

  /**
   * Exit code from script
   */
  readonly exitCode: number;

  /**
   * Duration in milliseconds
   */
  readonly durationMs: number;

  /**
   * Script digest (SHA-256)
   */
  readonly digest: string;

  /**
   * Whether user consented to execution
   */
  readonly consented: boolean;

  /**
   * Timestamp of execution
   */
  readonly executedAt: Date;

  /**
   * Error details if execution failed
   */
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
}

/**
 * Publish operation result.
 */
export interface PublishResult {
  /**
   * Whether operation succeeded
   */
  readonly success: boolean;

  /**
   * Transaction ID for audit trail
   */
  readonly transactionId: string;

  /**
   * Git provenance captured during publish
   */
  readonly gitProvenance?: GitProvenance;

  /**
   * Manifest validation result
   */
  readonly manifestValidation?: ManifestValidationResult;

  /**
   * Lifecycle script execution results
   */
  readonly lifecycleResults?: {
    readonly prePublish?: PublishLifecycleResult;
    readonly postPublish?: PublishLifecycleResult;
  };

  /**
   * Git operations performed
   */
  readonly gitOperations?: {
    readonly committed: boolean;
    readonly pushed: boolean;
    readonly tagged: boolean;
    readonly commitSha?: string;
    readonly tagName?: string;
  };

  /**
   * Error details if operation failed
   */
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
    readonly failedStep?: string;
  };

  /**
   * Operation metadata
   */
  readonly metadata: {
    readonly durationMs: number;
    readonly timestamp: Date;
    readonly correlationId?: string;
  };

  /**
   * Messages for user display (structured logging)
   */
  readonly messages: Array<{
    readonly level: 'info' | 'warn' | 'error';
    readonly message: string;
    readonly step?: string;
  }>;
}

/**
 * Transaction phase for publish step-level tracking.
 */
export enum PublishPhase {
  VALIDATE_FLAGS = 'VALIDATE_FLAGS',
  CHECK_GIT_STATUS = 'CHECK_GIT_STATUS',
  VALIDATE_MANIFEST = 'VALIDATE_MANIFEST',
  LIFECYCLE_PRE = 'LIFECYCLE_PRE',
  STAGE_CHANGES = 'STAGE_CHANGES',
  COMMIT = 'COMMIT',
  TAG = 'TAG',
  PUSH = 'PUSH',
  LIFECYCLE_POST = 'LIFECYCLE_POST',
  TELEMETRY = 'TELEMETRY',
}
