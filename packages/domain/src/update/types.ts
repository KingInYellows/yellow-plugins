/**
 * @yellow-plugins/domain - Update Service Types
 *
 * Type definitions for update operations with changelog integration.
 * Extends install types with update-specific fields.
 *
 * Part of Task I3.T2: Changelog-aware update pipeline
 *
 * @specification docs/SPECIFICATION-PART1-v1.1.md (CRIT-008)
 */

import type { ChangelogFetchResult } from '../changelog/types.js';
import type { InstallResult } from '../install/types.js';

/**
 * Update check request parameters.
 */
export interface UpdateCheckRequest {
  /**
   * Plugin identifier to check (omit for all plugins)
   */
  readonly pluginId?: string;

  /**
   * Check all installed plugins
   */
  readonly all?: boolean;

  /**
   * Fetch changelog metadata
   */
  readonly fetchChangelogs?: boolean;

  /**
   * Bypass changelog cache
   */
  readonly bypassChangelogCache?: boolean;

  /**
   * Transaction ID for correlation
   */
  readonly transactionId?: string;

  /**
   * Correlation ID for tracing
   */
  readonly correlationId?: string;
}

/**
 * Single plugin update check result.
 */
export interface PluginUpdateCheck {
  /**
   * Plugin identifier
   */
  readonly pluginId: string;

  /**
   * Currently installed version
   */
  readonly currentVersion: string;

  /**
   * Latest available version
   */
  readonly latestVersion: string;

  /**
   * Whether update is available
   */
  readonly updateAvailable: boolean;

  /**
   * Changelog URL (if provided by plugin)
   */
  readonly changelogUrl?: string;

  /**
   * Changelog fetch result (if fetchChangelogs=true)
   */
  readonly changelog?: ChangelogFetchResult;

  /**
   * Permission changes in new version
   */
  readonly permissionChanges?: {
    readonly added: string[];
    readonly removed: string[];
  };

  /**
   * Compatibility warnings
   */
  readonly warnings?: string[];

  /**
   * Whether plugin is pinned
   */
  readonly pinned?: boolean;
}

/**
 * Update check result.
 */
export interface UpdateCheckResult {
  /**
   * Whether check succeeded
   */
  readonly success: boolean;

  /**
   * Transaction ID for audit trail
   */
  readonly transactionId: string;

  /**
   * Plugins with updates available
   */
  readonly updatesAvailable: PluginUpdateCheck[];

  /**
   * Plugins already up-to-date
   */
  readonly upToDate: string[];

  /**
   * Plugins skipped (errors, not installed, etc.)
   */
  readonly skipped: Array<{
    readonly pluginId: string;
    readonly reason: string;
    readonly errorCode?: string;
  }>;

  /**
   * Marketplace index staleness warning
   */
  readonly marketplaceWarning?: {
    readonly stale: boolean;
    readonly lastUpdated?: Date;
    readonly message: string;
  };

  /**
   * Error details if check failed
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
    readonly durationMs: number;
    readonly timestamp: Date;
    readonly correlationId?: string;
    readonly changelogsFetched?: number;
    readonly changelogCacheHits?: number;
  };
}

/**
 * Update execution request.
 * Extends UpdateCheckRequest with execution-specific options.
 */
export interface UpdateExecutionRequest extends UpdateCheckRequest {
  /**
   * Target version constraint (semver range)
   */
  readonly versionConstraint?: string;

  /**
   * Skip lifecycle scripts
   */
  readonly skipLifecycle?: boolean;

  /**
   * Force update even if pinned
   */
  readonly force?: boolean;

  /**
   * Dry-run mode (check without installing)
   */
  readonly dryRun?: boolean;
}

/**
 * Update execution result.
 * Extends InstallResult with changelog metadata.
 */
export interface UpdateExecutionResult extends InstallResult {
  /**
   * Changelog fetch result for updated plugin
   */
  readonly changelog?: ChangelogFetchResult;

  /**
   * Permission changes applied
   */
  readonly permissionChanges?: {
    readonly added: string[];
    readonly removed: string[];
  };
}

/**
 * Batch update result (for --all mode).
 */
export interface BatchUpdateResult {
  /**
   * Whether batch succeeded (all or partial)
   */
  readonly success: boolean;

  /**
   * Transaction ID for audit trail
   */
  readonly transactionId: string;

  /**
   * Successfully updated plugins
   */
  readonly updated: Array<{
    readonly pluginId: string;
    readonly fromVersion: string;
    readonly toVersion: string;
    readonly changelog?: ChangelogFetchResult;
  }>;

  /**
   * Plugins already up-to-date
   */
  readonly upToDate: string[];

  /**
   * Plugins skipped (pinned, errors, etc.)
   */
  readonly skipped: Array<{
    readonly pluginId: string;
    readonly reason: string;
    readonly errorCode?: string;
  }>;

  /**
   * Plugins failed during update
   */
  readonly failed: Array<{
    readonly pluginId: string;
    readonly error: string;
    readonly errorCode?: string;
  }>;

  /**
   * Operation metadata
   */
  readonly metadata: {
    readonly durationMs: number;
    readonly timestamp: Date;
    readonly correlationId?: string;
  };
}
