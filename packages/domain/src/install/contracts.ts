/**
 * @yellow-plugins/domain - Install Service Contracts
 *
 * Domain interfaces for plugin installation orchestration.
 * Defines the contract between CLI layer and domain services.
 *
 * Part of Task I2.T3: Install Transaction Orchestrator
 *
 * Architecture References:
 * - Section 2.1: Install Transaction Orchestrator component
 * - Section 3.10: Install Transaction Lifecycle
 */

import type {
  InstallRequest,
  InstallResult,
  RollbackRequest,
  UninstallRequest,
  UninstallResult,
  UpdateRequest,
} from './types.js';

/**
 * Install service interface for domain operations.
 * Orchestrates plugin installation with full transaction lifecycle.
 */
export interface IInstallService {
  /**
   * Install a plugin from marketplace or source.
   * Implements full 7-step transaction lifecycle from Architecture §3.10.
   *
   * Steps:
   * 1. Validate marketplace index and compatibility
   * 2. Stage artifacts (download/cache)
   * 3. Extract and validate manifest
   * 4. Display lifecycle scripts and obtain consent
   * 5. Promote to cache and update registry
   * 6. Activate via symlinks
   * 7. Emit telemetry and cleanup
   *
   * @param request - Install request parameters
   * @returns Install result with transaction ID and metadata
   */
  install(request: InstallRequest): Promise<InstallResult>;

  /**
   * Update an installed plugin to a new version.
   * Similar to install but includes version transition logic.
   *
   * @param request - Update request parameters
   * @returns Install result with update metadata
   */
  update(request: UpdateRequest): Promise<InstallResult>;

  /**
   * Rollback a plugin to a previous cached version.
   * Skips download phase, focuses on cache verification and symlink swaps.
   *
   * @param request - Rollback request parameters
   * @returns Install result with rollback metadata
   */
  rollback(request: RollbackRequest): Promise<InstallResult>;

  /**
   * Verify installation integrity for a plugin.
   * Checks cache, registry, and symlinks without mutations.
   *
   * @param pluginId - Plugin identifier
   * @returns Validation result
   */
  verify(pluginId: string): Promise<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  }>;

  /**
   * List available rollback targets for a plugin.
   * Returns cached versions that can be rolled back to.
   *
   * @param pluginId - Plugin identifier
   * @returns Array of cached versions with metadata
   */
  listRollbackTargets(pluginId: string): Promise<
    Array<{
      version: string;
      cachePath: string;
      sizeBytes: number;
      lastAccessTime: Date;
      pinned: boolean;
    }>
  >;

  /**
   * Uninstall a plugin from the system.
   * Runs lifecycle uninstall hooks, removes symlinks, updates registry,
   * and handles cache retention based on policy.
   *
   * Steps:
   * 1. Validate plugin exists in registry
   * 2. Load lifecycle uninstall scripts for consent
   * 3. Execute lifecycle hooks in sandbox (after consent)
   * 4. Remove symlink atomically
   * 5. Update registry (remove entry)
   * 6. Apply cache retention policy
   * 7. Emit telemetry and create audit log
   *
   * @param request - Uninstall request parameters
   * @returns Uninstall result with transaction ID and metadata
   */
  uninstall(request: UninstallRequest): Promise<UninstallResult>;
}
