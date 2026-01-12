/**
 * @yellow-plugins/domain - Install Transaction Types
 *
 * Domain types for plugin installation, update, and rollback operations.
 * Implements transaction lifecycle with staging, validation, and atomic commits.
 *
 * Part of Task I2.T3: Install Transaction Orchestrator
 *
 * Architecture References:
 * - Section 3.10: Install Transaction Lifecycle
 * - Section 2.1: Functional Requirements (FR-001 through FR-004)
 * - CRIT-001: Transaction tracking
 * - CRIT-002: Rollback support
 */

import type { InstalledPlugin } from '../registry/types.js';

/**
 * Install request parameters from CLI layer.
 * Matches CLI contract expectations from Architecture §3.7.
 */
export interface InstallRequest {
  /**
   * Plugin identifier to install
   */
  readonly pluginId: string;

  /**
   * Target version (semver string or 'latest')
   */
  readonly version?: string;

  /**
   * Source URI or marketplace entry
   */
  readonly source?: string;

  /**
   * Force reinstall even if already installed
   */
  readonly force?: boolean;

  /**
   * Compatibility intent context from local host
   */
  readonly compatibilityIntent?: {
    readonly nodeVersion?: string;
    readonly os?: string;
    readonly arch?: string;
    readonly claudeCodeVersion?: string;
  };

  /**
   * Script review digest (proves user saw lifecycle scripts)
   */
  readonly scriptReviewDigest?: string;

  /**
   * Transaction checklist for step-level tracking
   */
  readonly transactionChecklist?: string[];

  /**
   * Security context with permission disclosure
   */
  readonly securityContext?: {
    readonly declaredPermissions?: string[];
    readonly enforcedPermissions?: string[];
  };

  /**
   * Rollback plan (steps to execute on failure)
   */
  readonly rollbackPlan?: RollbackStep[];

  /**
   * Correlation ID for tracing
   */
  readonly correlationId?: string;

  /**
   * Dry-run mode (simulate without mutations)
   */
  readonly dryRun?: boolean;
}

/**
 * Update request extends install with version transition metadata.
 */
export interface UpdateRequest extends InstallRequest {
  /**
   * Currently installed version
   */
  readonly currentVersion: string;

  /**
   * Digest of currently installed manifest
   */
  readonly currentManifestDigest?: string;

  /**
   * Digest of target manifest
   */
  readonly targetManifestDigest?: string;
}

/**
 * Rollback request parameters.
 */
export interface RollbackRequest {
  /**
   * Plugin identifier to rollback
   */
  readonly pluginId: string;

  /**
   * Target version to rollback to (must be cached)
   * If omitted, rollback to previous version
   */
  readonly targetVersion?: string;

  /**
   * Cache preference (require cached version vs allow download)
   */
  readonly cachePreference?: 'cached-only' | 'allow-download';

  /**
   * Confirmation token (user acknowledged rollback action)
   */
  readonly confirmationToken?: string;

  /**
   * Correlation ID for tracing
   */
  readonly correlationId?: string;

  /**
   * Dry-run mode
   */
  readonly dryRun?: boolean;
}

/**
 * Install/update/rollback operation result.
 */
export interface InstallResult {
  /**
   * Whether operation succeeded
   */
  readonly success: boolean;

  /**
   * Transaction ID for audit trail
   */
  readonly transactionId: string;

  /**
   * Installed plugin record
   */
  readonly plugin?: InstalledPlugin;

  /**
   * Registry delta (changes made)
   */
  readonly registryDelta?: {
    readonly added?: InstalledPlugin[];
    readonly updated?: InstalledPlugin[];
    readonly removed?: string[];
  };

  /**
   * Cache operations performed
   */
  readonly cacheOperations?: {
    readonly staged: boolean;
    readonly promoted: boolean;
    readonly checksum: string;
    readonly evicted: number;
    readonly sizeMb: number;
  };

  /**
   * Lifecycle script execution results
   */
  readonly lifecycleResults?: {
    readonly preInstall?: LifecycleExecutionResult;
    readonly postInstall?: LifecycleExecutionResult;
  };

  /**
   * Compatibility verdict
   */
  readonly compatibilityVerdict?: {
    readonly compatible: boolean;
    readonly warnings?: string[];
    readonly errors?: string[];
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
 * Lifecycle script execution result.
 */
export interface LifecycleExecutionResult {
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
 * Single step in a rollback plan.
 */
export interface RollbackStep {
  /**
   * Step identifier
   */
  readonly id: string;

  /**
   * Step description
   */
  readonly description: string;

  /**
   * Action to perform (revert, cleanup, restore)
   */
  readonly action: 'revert' | 'cleanup' | 'restore';

  /**
   * Target path or resource
   */
  readonly target?: string;

  /**
   * Completed flag
   */
  completed?: boolean;
}

/**
 * Transaction phase for step-level tracking.
 */
export enum TransactionPhase {
  VALIDATE = 'VALIDATE',
  STAGE = 'STAGE',
  DOWNLOAD = 'DOWNLOAD',
  EXTRACT = 'EXTRACT',
  LIFECYCLE_PRE = 'LIFECYCLE_PRE',
  PROMOTE = 'PROMOTE',
  ACTIVATE = 'ACTIVATE',
  LIFECYCLE_POST = 'LIFECYCLE_POST',
  TELEMETRY = 'TELEMETRY',
  CLEANUP = 'CLEANUP',
  ROLLBACK = 'ROLLBACK',
}

/**
 * Transaction progress tracking.
 */
export interface TransactionProgress {
  /**
   * Current phase
   */
  readonly phase: TransactionPhase;

  /**
   * Completed phases
   */
  readonly completedPhases: TransactionPhase[];

  /**
   * Total estimated steps
   */
  readonly totalSteps: number;

  /**
   * Completed steps
   */
  readonly completedSteps: number;

  /**
   * Current step description
   */
  readonly currentStep?: string;

  /**
   * Start time
   */
  readonly startedAt: Date;

  /**
   * Messages log
   */
  readonly messages: Array<{
    readonly level: 'info' | 'warn' | 'error';
    readonly message: string;
    readonly phase: TransactionPhase;
    readonly timestamp: Date;
  }>;
}

/**
 * Install operation options for internal orchestration.
 */
export interface InstallOperationOptions {
  /**
   * Transaction ID (auto-generated if not provided)
   */
  readonly transactionId?: string;

  /**
   * Skip cache eviction after promotion
   */
  readonly skipEviction?: boolean;

  /**
   * Validate registry after update
   */
  readonly validateRegistry?: boolean;

  /**
   * Create registry backup before mutation
   */
  readonly createBackup?: boolean;

  /**
   * Progress callback for UI updates
   */
  readonly onProgress?: (progress: TransactionProgress) => void;

  /**
   * Telemetry context
   */
  readonly telemetryContext?: Record<string, unknown>;
}
