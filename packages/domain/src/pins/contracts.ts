/**
 * @yellow-plugins/domain - Pin Service Contracts
 *
 * Service contracts for plugin pin management.
 *
 * Part of Task I3.T3: Pin management implementation
 *
 * Architecture References:
 * - FR-007: Pin management
 * - CRIT-002: Cache eviction with pin protection
 */

import type { PinListEntry, PinOperationResult, PinStatus } from './types.js';

/**
 * Pin service interface.
 * Orchestrates pin operations across registry and cache layers.
 */
export interface IPinService {
  /**
   * Pin a plugin to protect it from cache eviction.
   * Idempotent - pinning an already-pinned plugin succeeds silently.
   *
   * @param pluginId Plugin identifier to pin
   * @param version Optional specific version to pin (defaults to installed version)
   * @returns Pin operation result
   */
  pinPlugin(pluginId: string, version?: string): Promise<PinOperationResult>;

  /**
   * Unpin a plugin to allow cache eviction.
   * Idempotent - unpinning a non-pinned plugin succeeds silently.
   *
   * @param pluginId Plugin identifier to unpin
   * @returns Unpin operation result
   */
  unpinPlugin(pluginId: string): Promise<PinOperationResult>;

  /**
   * Check if a plugin is currently pinned.
   *
   * @param pluginId Plugin identifier to check
   * @returns Pin status information
   */
  getPinStatus(pluginId: string): Promise<PinStatus>;

  /**
   * List all currently pinned plugins.
   *
   * @returns Array of pinned plugins with details
   */
  listPins(): Promise<PinListEntry[]>;

  /**
   * Check if a plugin is pinned (simple boolean check).
   *
   * @param pluginId Plugin identifier to check
   * @returns True if pinned, false otherwise
   */
  isPinned(pluginId: string): Promise<boolean>;
}
