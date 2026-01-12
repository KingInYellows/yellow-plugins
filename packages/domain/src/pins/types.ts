/**
 * @yellow-plugins/domain - Pin Management Types
 *
 * Types for plugin pin management functionality.
 * Enables protection of specific plugin versions from cache eviction.
 *
 * Part of Task I3.T3: Pin management implementation
 *
 * Architecture References:
 * - FR-007: Pin management for version control
 * - Section 3.4: Data Persistence & Cache Layout
 * - Registry contract: activePins array semantics
 */

import type { InstalledPlugin } from '../registry/types.js';

/**
 * Pin operation result.
 */
export interface PinOperationResult {
  /**
   * Whether operation succeeded
   */
  readonly success: boolean;

  /**
   * Plugin ID that was pinned/unpinned
   */
  readonly pluginId: string;

  /**
   * Version that was pinned/unpinned (if specified)
   */
  readonly version?: string;

  /**
   * Error message if operation failed
   */
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
  };

  /**
   * Whether the operation was a no-op (already in desired state)
   */
  readonly wasNoOp?: boolean;
}

/**
 * Pin status information for a plugin.
 */
export interface PinStatus {
  /**
   * Plugin identifier
   */
  readonly pluginId: string;

  /**
   * Whether plugin is pinned in registry
   */
  readonly isPinned: boolean;

  /**
   * Installed plugin record
   */
  readonly plugin?: InstalledPlugin;

  /**
   * Whether this version is cached
   */
  readonly isCached: boolean;

  /**
   * Version of the installed plugin
   */
  readonly version?: string;
}

/**
 * Pin list entry.
 */
export interface PinListEntry {
  /**
   * Plugin identifier
   */
  readonly pluginId: string;

  /**
   * Plugin version
   */
  readonly version: string;

  /**
   * When plugin was installed
   */
  readonly installedAt: Date;

  /**
   * Whether version is cached
   */
  readonly isCached: boolean;

  /**
   * Cache path for this version
   */
  readonly cachePath: string;
}
