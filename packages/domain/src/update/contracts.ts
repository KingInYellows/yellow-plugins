/**
 * @yellow-plugins/domain - Update Service Contracts
 *
 * Domain interface for update operations with changelog integration.
 * Implements CRIT-008 requirements for changelog-aware updates.
 *
 * Part of Task I3.T2: Changelog-aware update pipeline
 *
 * @specification docs/SPECIFICATION-PART1-v1.1.md (CRIT-008)
 */

import type {
  UpdateCheckRequest,
  UpdateCheckResult,
  UpdateExecutionRequest,
  UpdateExecutionResult,
  BatchUpdateResult,
} from './types.js';

/**
 * Update service interface for domain operations.
 * Orchestrates update checks and executions with changelog fetching.
 */
export interface IUpdateService {
  /**
   * Check for available updates.
   * Implements parallelizable fetch with timeout fallback per CRIT-008.
   *
   * @param request - Update check request
   * @returns Update check result with changelog metadata
   */
  checkUpdates(request: UpdateCheckRequest): Promise<UpdateCheckResult>;

  /**
   * Execute update for a single plugin.
   * Fetches changelog, displays warnings, and proceeds with installation.
   *
   * @param request - Update execution request
   * @returns Update execution result with changelog and permission changes
   */
  updatePlugin(request: UpdateExecutionRequest): Promise<UpdateExecutionResult>;

  /**
   * Execute update for all installed plugins.
   * Parallelizable with individual timeout handling.
   *
   * @param request - Batch update request
   * @returns Batch update result with aggregated status
   */
  updateAll(request: UpdateExecutionRequest): Promise<BatchUpdateResult>;
}
