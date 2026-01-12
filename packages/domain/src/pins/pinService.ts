/**
 * @yellow-plugins/domain - Pin Service Implementation
 *
 * Core domain service for plugin pin management.
 * Orchestrates pin operations across registry and cache layers,
 * ensuring atomic updates and cache eviction protection.
 *
 * Part of Task I3.T3: Pin management implementation
 *
 * Architecture References:
 * - FR-007: Pin management for version control
 * - CRIT-002: Cache eviction with pin protection
 * - Section 3.4: Data Persistence & Cache Layout
 */

import type { ICacheService } from '../cache/contracts.js';
import type { IRegistryService } from '../registry/contracts.js';

import type { IPinService } from './contracts.js';
import type { PinListEntry, PinOperationResult, PinStatus } from './types.js';

/**
 * Pin service implementation.
 * Provides high-level pin management operations by coordinating
 * registry and cache persistence layers.
 */
export class PinService implements IPinService {
  constructor(
    private readonly registryService: IRegistryService,
    private readonly cacheService: ICacheService
  ) {}

  /**
   * Pin a plugin to protect it from cache eviction.
   */
  async pinPlugin(pluginId: string, version?: string): Promise<PinOperationResult> {
    try {
      // Load plugin from registry
      const plugin = await this.registryService.getPlugin(pluginId);

      if (!plugin) {
        return {
          success: false,
          pluginId,
          version,
          error: {
            code: 'PLUGIN_NOT_FOUND',
            message: `Plugin ${pluginId} not found in registry. Install the plugin before pinning.`,
          },
        };
      }

      // Determine target version (use specified or installed version)
      const targetVersion = version || plugin.version;

      // Check if version is cached
      const cacheEntry = this.cacheService.getEntry(pluginId, targetVersion);
      if (!cacheEntry) {
        return {
          success: false,
          pluginId,
          version: targetVersion,
          error: {
            code: 'VERSION_NOT_CACHED',
            message: `Version ${targetVersion} of plugin ${pluginId} is not cached. Install this version before pinning.`,
          },
        };
      }

      // Check if already pinned (idempotency)
      const registry = await this.registryService.loadRegistry();
      const isAlreadyPinned = registry.activePins.includes(pluginId);

      if (isAlreadyPinned && plugin.pinned) {
        return {
          success: true,
          pluginId,
          version: targetVersion,
          wasNoOp: true,
        };
      }

      // Pin in registry (updates activePins array and plugin.pinned flag)
      await this.registryService.pinPlugin(pluginId);

      // Pin in cache (marks cache entry as pinned for eviction protection)
      await this.cacheService.pinVersion(pluginId, targetVersion);

      return {
        success: true,
        pluginId,
        version: targetVersion,
      };
    } catch (error) {
      return {
        success: false,
        pluginId,
        version,
        error: {
          code: 'PIN_FAILED',
          message: `Failed to pin plugin ${pluginId}: ${(error as Error).message}`,
          details: error,
        },
      };
    }
  }

  /**
   * Unpin a plugin to allow cache eviction.
   */
  async unpinPlugin(pluginId: string): Promise<PinOperationResult> {
    try {
      // Load plugin from registry
      const plugin = await this.registryService.getPlugin(pluginId);

      if (!plugin) {
        // Allow unpinning non-existent plugins (cleanup case)
        return {
          success: true,
          pluginId,
          wasNoOp: true,
        };
      }

      // Check if not pinned (idempotency)
      const registry = await this.registryService.loadRegistry();
      const isCurrentlyPinned = registry.activePins.includes(pluginId);

      if (!isCurrentlyPinned && !plugin.pinned) {
        return {
          success: true,
          pluginId,
          version: plugin.version,
          wasNoOp: true,
        };
      }

      // Unpin in registry
      await this.registryService.unpinPlugin(pluginId);

      // Unpin in cache (if version is cached)
      const cacheEntry = this.cacheService.getEntry(pluginId, plugin.version);
      if (cacheEntry) {
        await this.cacheService.unpinVersion(pluginId, plugin.version);
      }

      return {
        success: true,
        pluginId,
        version: plugin.version,
      };
    } catch (error) {
      return {
        success: false,
        pluginId,
        error: {
          code: 'UNPIN_FAILED',
          message: `Failed to unpin plugin ${pluginId}: ${(error as Error).message}`,
          details: error,
        },
      };
    }
  }

  /**
   * Get pin status for a plugin.
   */
  async getPinStatus(pluginId: string): Promise<PinStatus> {
    const plugin = await this.registryService.getPlugin(pluginId);
    const registry = await this.registryService.loadRegistry();
    const isPinned = registry.activePins.includes(pluginId);

    if (!plugin) {
      return {
        pluginId,
        isPinned: false,
        isCached: false,
      };
    }

    const cacheEntry = this.cacheService.getEntry(pluginId, plugin.version);

    return {
      pluginId,
      isPinned,
      plugin,
      isCached: Boolean(cacheEntry),
      version: plugin.version,
    };
  }

  /**
   * List all pinned plugins.
   */
  async listPins(): Promise<PinListEntry[]> {
    const registry = await this.registryService.loadRegistry();
    const pinned: PinListEntry[] = [];

    for (const pinnedId of registry.activePins) {
      const plugin = registry.plugins.find((p) => p.pluginId === pinnedId);

      if (!plugin) {
        // Skip orphaned pins (should be cleaned up by validation)
        continue;
      }

      const cacheEntry = this.cacheService.getEntry(plugin.pluginId, plugin.version);

      const installedAt =
        plugin.installedAt instanceof Date
          ? plugin.installedAt
          : new Date(plugin.installedAt as unknown as string);

      pinned.push({
        pluginId: plugin.pluginId,
        version: plugin.version,
        installedAt,
        isCached: Boolean(cacheEntry),
        cachePath: plugin.cachePath,
      });
    }

    return pinned;
  }

  /**
   * Check if a plugin is pinned.
   */
  async isPinned(pluginId: string): Promise<boolean> {
    const registry = await this.registryService.loadRegistry();
    return registry.activePins.includes(pluginId);
  }
}
