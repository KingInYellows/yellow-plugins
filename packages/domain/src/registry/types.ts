/**
 * @yellow-plugins/domain - Registry Management Types
 *
 * Domain types for plugin installation registry and persistence.
 * Tracks installed plugins with transaction IDs, telemetry snapshots,
 * and lifecycle consent references.
 *
 * Part of Task I2.T2: Cache manager + registry persistence
 *
 * Architecture References:
 * - Section 3.4: Data Persistence & Cache Layout
 * - data-erd.puml: InstalledPluginRegistry, InstalledPlugin entities
 * - CRIT-001: Transaction tracking
 * - CRIT-010: Telemetry instrumentation
 */

/**
 * Installation state enum.
 */
export enum InstallState {
  /**
   * Plugin is being staged (downloading/extracting)
   */
  STAGING = 'STAGING',

  /**
   * Plugin is fully installed and active
   */
  INSTALLED = 'INSTALLED',

  /**
   * Plugin installation failed
   */
  FAILED = 'FAILED',

  /**
   * Plugin is being uninstalled
   */
  UNINSTALLING = 'UNINSTALLING',

  /**
   * Plugin is disabled but not uninstalled
   */
  DISABLED = 'DISABLED',
}

/**
 * Installed plugin record.
 * Matches InstalledPlugin entity from data-erd.puml.
 */
export interface InstalledPlugin {
  /**
   * Plugin identifier (unique)
   */
  readonly pluginId: string;

  /**
   * Semantic version string
   */
  readonly version: string;

  /**
   * Source URI or path where plugin was installed from
   */
  readonly source: string;

  /**
   * Current installation state
   */
  readonly installState: InstallState;

  /**
   * When plugin was installed
   */
  readonly installedAt: Date;

  /**
   * Absolute path to cached artifacts
   * Format: `<pluginDir>/cache/<pluginId>/<version>/`
   */
  readonly cachePath: string;

  /**
   * Symlink target for active installation
   * Format: `<installDir>/<pluginId>` → cachePath
   */
  readonly symlinkTarget?: string;

  /**
   * Last validation timestamp (integrity check)
   */
  readonly lastValidatedAt?: Date;

  /**
   * Transaction ID for this installation (for tracing/rollback)
   */
  readonly transactionId: string;

  /**
   * Whether this version is pinned (priority during eviction)
   */
  readonly pinned?: boolean;

  /**
   * Reference to telemetry snapshot for this installation
   */
  readonly telemetryRef?: string;

  /**
   * References to lifecycle consent records
   * Array of lifecycle script digests that were consented to
   */
  readonly lifecycleConsentRefs?: string[];

  /**
   * Optional error details if installation failed
   */
  readonly errorDetails?: {
    readonly code: string;
    readonly message: string;
    readonly failedAt: Date;
  };
}

/**
 * Registry metadata and versioning.
 */
export interface RegistryMetadata {
  /**
   * Registry schema version for migration support
   */
  readonly registryVersion: string;

  /**
   * Last time registry was updated
   */
  readonly lastUpdated: Date;

  /**
   * CLI version that last modified registry
   */
  readonly modifiedBy?: string;

  /**
   * Total number of installations tracked
   */
  readonly totalInstallations: number;

  /**
   * Checksum of registry file for integrity
   */
  readonly checksum?: string;
}

/**
 * Complete registry structure.
 * Stored in `.claude-plugin/registry.json`.
 */
export interface InstalledPluginRegistry {
  /**
   * Metadata about this registry
   */
  readonly metadata: RegistryMetadata;

  /**
   * Array of installed plugins
   */
  readonly plugins: InstalledPlugin[];

  /**
   * Active pinned plugins (priority list)
   * Plugin IDs that should be protected from eviction
   */
  readonly activePins: string[];

  /**
   * Telemetry snapshots for installations
   * Keyed by telemetry reference ID
   */
  readonly telemetry?: Record<string, TelemetrySnapshot>;
}

/**
 * Telemetry snapshot for an installation operation.
 * Captures metrics for observability and debugging.
 */
export interface TelemetrySnapshot {
  /**
   * Unique snapshot ID (telemetryRef in InstalledPlugin)
   */
  readonly id: string;

  /**
   * Transaction ID this snapshot is associated with
   */
  readonly transactionId: string;

  /**
   * Command that triggered this operation
   */
  readonly commandType: string;

  /**
   * Operation duration in milliseconds
   */
  readonly durationMs: number;

  /**
   * Whether operation succeeded
   */
  readonly success: boolean;

  /**
   * Error code if operation failed
   */
  readonly errorCode?: string;

  /**
   * When snapshot was captured
   */
  readonly capturedAt: Date;

  /**
   * Additional contextual metadata
   */
  readonly context?: Record<string, unknown>;
}

/**
 * Result of a registry operation (add, update, remove).
 */
export interface RegistryOperationResult<T = void> {
  /**
   * Whether operation succeeded
   */
  readonly success: boolean;

  /**
   * Result data (operation-specific)
   */
  readonly data?: T;

  /**
   * Error details if operation failed
   */
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
  };

  /**
   * Operation metadata
   */
  readonly metadata: {
    readonly operationType: string;
    readonly transactionId?: string;
    readonly durationMs: number;
    readonly timestamp: Date;
  };
}

/**
 * Options for registry update operations.
 */
export interface RegistryUpdateOptions {
  /**
   * Transaction ID for tracing/auditing
   */
  readonly transactionId?: string;

  /**
   * Whether to create backup before update
   */
  readonly createBackup?: boolean;

  /**
   * Whether to validate registry after update
   */
  readonly validateAfterUpdate?: boolean;

  /**
   * Telemetry context to capture
   */
  readonly telemetryContext?: Partial<TelemetrySnapshot>;
}

/**
 * Query filter for finding installed plugins.
 */
export interface RegistryQuery {
  /**
   * Filter by plugin ID (exact match)
   */
  readonly pluginId?: string;

  /**
   * Filter by installation state
   */
  readonly installState?: InstallState;

  /**
   * Filter by version (exact match or semver range)
   */
  readonly version?: string;

  /**
   * Filter by pinned status
   */
  readonly pinned?: boolean;

  /**
   * Filter by minimum install date
   */
  readonly installedAfter?: Date;

  /**
   * Filter by maximum install date
   */
  readonly installedBefore?: Date;
}

/**
 * Registry backup metadata.
 */
export interface RegistryBackup {
  /**
   * Path to backup file
   */
  readonly backupPath: string;

  /**
   * When backup was created
   */
  readonly createdAt: Date;

  /**
   * Registry version at time of backup
   */
  readonly registryVersion: string;

  /**
   * Reason for backup
   */
  readonly reason: string;

  /**
   * Original file checksum
   */
  readonly checksum: string;
}
