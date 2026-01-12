/**
 * Pin Service Unit Tests
 *
 * Tests pin/unpin operations, idempotency, cache integration, and error handling
 * as specified in acceptance criteria for Task I3.T3.
 *
 * @module domain/pins/__tests__/pinService
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';

import type { ICacheService } from '../../cache/contracts.js';
import type { CacheEntry } from '../../cache/types.js';
import type { IRegistryService } from '../../registry/contracts.js';
import type { InstalledPlugin, InstalledPluginRegistry } from '../../registry/types.js';
import { InstallState } from '../../registry/types.js';
import { PinService } from '../pinService.js';

/**
 * Mock Registry Service for testing
 */
class MockRegistryService implements Partial<IRegistryService> {
  private registry: InstalledPluginRegistry = {
    metadata: {
      registryVersion: '1.0',
      lastUpdated: new Date(),
      totalInstallations: 0,
    },
    plugins: [],
    activePins: [],
  };

  async loadRegistry(): Promise<InstalledPluginRegistry> {
    return this.registry;
  }

  async getPlugin(pluginId: string): Promise<InstalledPlugin | undefined> {
    return this.registry.plugins.find((p) => p.pluginId === pluginId);
  }

  async pinPlugin(pluginId: string): Promise<void> {
    if (!this.registry.activePins.includes(pluginId)) {
      this.registry.activePins.push(pluginId);
    }

    const plugin = this.registry.plugins.find((p) => p.pluginId === pluginId);
    if (plugin) {
      (plugin as { pinned: boolean }).pinned = true;
    }
  }

  async unpinPlugin(pluginId: string): Promise<void> {
    this.registry.activePins = this.registry.activePins.filter((id) => id !== pluginId);

    const plugin = this.registry.plugins.find((p) => p.pluginId === pluginId);
    if (plugin) {
      (plugin as { pinned: boolean }).pinned = false;
    }
  }

  // Test helper to add plugins
  addPlugin(plugin: InstalledPlugin): void {
    this.registry.plugins.push(plugin);
  }

  // Test helper to get registry state
  getRegistry(): InstalledPluginRegistry {
    return this.registry;
  }
}

/**
 * Mock Cache Service for testing
 */
class MockCacheService implements Partial<ICacheService> {
  private entries = new Map<string, CacheEntry[]>();

  getEntry(pluginId: string, version: string): CacheEntry | undefined {
    const pluginEntries = this.entries.get(pluginId) || [];
    return pluginEntries.find((e) => e.version === version);
  }

  async pinVersion(pluginId: string, version: string): Promise<void> {
    const entry = this.getEntry(pluginId, version);
    if (!entry) {
      throw new Error(`Version ${version} of plugin ${pluginId} not found in cache`);
    }
    (entry as { pinned: boolean }).pinned = true;
  }

  async unpinVersion(pluginId: string, version: string): Promise<void> {
    const entry = this.getEntry(pluginId, version);
    if (entry) {
      (entry as { pinned: boolean }).pinned = false;
    }
  }

  // Test helper to add cache entries
  addEntry(entry: CacheEntry): void {
    const pluginEntries = this.entries.get(entry.pluginId) || [];
    pluginEntries.push(entry);
    this.entries.set(entry.pluginId, pluginEntries);
  }
}

describe('PinService', () => {
  let registryService: MockRegistryService;
  let cacheService: MockCacheService;
  let pinService: PinService;

  beforeEach(() => {
    registryService = new MockRegistryService();
    cacheService = new MockCacheService();
    pinService = new PinService(
      registryService as unknown as IRegistryService,
      cacheService as unknown as ICacheService
    );
  });

  describe('pinPlugin', () => {
    it('should successfully pin an installed plugin', async () => {
      // Setup: Add installed plugin and cache entry
      const plugin: InstalledPlugin = {
        pluginId: 'test-plugin',
        version: '1.0.0',
        source: 'test-source',
        installState: InstallState.INSTALLED,
        installedAt: new Date(),
        cachePath: '/cache/test-plugin/1.0.0',
        transactionId: 'tx-123',
      };
      registryService.addPlugin(plugin);

      const cacheEntry: CacheEntry = {
        pluginId: 'test-plugin',
        version: '1.0.0',
        cachePath: '/cache/test-plugin/1.0.0',
        sizeBytes: 1024,
        lastAccessTime: new Date(),
        pinned: false,
        isCurrentVersion: true,
        checksum: 'checksum-123',
      };
      cacheService.addEntry(cacheEntry);

      // Act
      const result = await pinService.pinPlugin('test-plugin');

      // Assert
      expect(result.success).toBe(true);
      expect(result.pluginId).toBe('test-plugin');
      expect(result.version).toBe('1.0.0');
      expect(result.wasNoOp).toBeUndefined();

      // Verify registry state
      const registry = registryService.getRegistry();
      expect(registry.activePins).toContain('test-plugin');

      const updatedPlugin = await registryService.getPlugin('test-plugin');
      expect(updatedPlugin?.pinned).toBe(true);

      // Verify cache state
      const updatedEntry = cacheService.getEntry('test-plugin', '1.0.0');
      expect(updatedEntry?.pinned).toBe(true);
    });

    it('should pin a specific version when provided', async () => {
      // Setup
      const plugin: InstalledPlugin = {
        pluginId: 'test-plugin',
        version: '2.0.0',
        source: 'test-source',
        installState: InstallState.INSTALLED,
        installedAt: new Date(),
        cachePath: '/cache/test-plugin/2.0.0',
        transactionId: 'tx-123',
      };
      registryService.addPlugin(plugin);

      const cacheEntry: CacheEntry = {
        pluginId: 'test-plugin',
        version: '1.5.0',
        cachePath: '/cache/test-plugin/1.5.0',
        sizeBytes: 1024,
        lastAccessTime: new Date(),
        pinned: false,
        isCurrentVersion: false,
        checksum: 'checksum-123',
      };
      cacheService.addEntry(cacheEntry);

      // Act
      const result = await pinService.pinPlugin('test-plugin', '1.5.0');

      // Assert
      expect(result.success).toBe(true);
      expect(result.version).toBe('1.5.0');

      const updatedEntry = cacheService.getEntry('test-plugin', '1.5.0');
      expect(updatedEntry?.pinned).toBe(true);
    });

    it('should be idempotent - pinning already pinned plugin succeeds', async () => {
      // Setup
      const plugin: InstalledPlugin = {
        pluginId: 'test-plugin',
        version: '1.0.0',
        source: 'test-source',
        installState: InstallState.INSTALLED,
        installedAt: new Date(),
        cachePath: '/cache/test-plugin/1.0.0',
        transactionId: 'tx-123',
        pinned: true,
      };
      registryService.addPlugin(plugin);
      await registryService.pinPlugin('test-plugin');

      const cacheEntry: CacheEntry = {
        pluginId: 'test-plugin',
        version: '1.0.0',
        cachePath: '/cache/test-plugin/1.0.0',
        sizeBytes: 1024,
        lastAccessTime: new Date(),
        pinned: true,
        isCurrentVersion: true,
        checksum: 'checksum-123',
      };
      cacheService.addEntry(cacheEntry);

      // Act
      const result = await pinService.pinPlugin('test-plugin');

      // Assert
      expect(result.success).toBe(true);
      expect(result.wasNoOp).toBe(true);
      expect(result.pluginId).toBe('test-plugin');
    });

    it('should fail when plugin is not found', async () => {
      // Act
      const result = await pinService.pinPlugin('nonexistent-plugin');

      // Assert
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PLUGIN_NOT_FOUND');
      expect(result.error?.message).toContain('not found in registry');
    });

    it('should fail when version is not cached', async () => {
      // Setup
      const plugin: InstalledPlugin = {
        pluginId: 'test-plugin',
        version: '1.0.0',
        source: 'test-source',
        installState: InstallState.INSTALLED,
        installedAt: new Date(),
        cachePath: '/cache/test-plugin/1.0.0',
        transactionId: 'tx-123',
      };
      registryService.addPlugin(plugin);
      // Note: No cache entry added

      // Act
      const result = await pinService.pinPlugin('test-plugin', '2.0.0');

      // Assert
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('VERSION_NOT_CACHED');
      expect(result.error?.message).toContain('is not cached');
    });

    it('should handle errors gracefully', async () => {
      // Setup plugin but mock registry to throw
      const plugin: InstalledPlugin = {
        pluginId: 'test-plugin',
        version: '1.0.0',
        source: 'test-source',
        installState: InstallState.INSTALLED,
        installedAt: new Date(),
        cachePath: '/cache/test-plugin/1.0.0',
        transactionId: 'tx-123',
      };
      registryService.addPlugin(plugin);

      const cacheEntry: CacheEntry = {
        pluginId: 'test-plugin',
        version: '1.0.0',
        cachePath: '/cache/test-plugin/1.0.0',
        sizeBytes: 1024,
        lastAccessTime: new Date(),
        pinned: false,
        isCurrentVersion: true,
        checksum: 'checksum-123',
      };
      cacheService.addEntry(cacheEntry);

      // Mock registryService.pinPlugin to throw
      vi.spyOn(registryService, 'pinPlugin').mockRejectedValueOnce(new Error('Registry error'));

      // Act
      const result = await pinService.pinPlugin('test-plugin');

      // Assert
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PIN_FAILED');
      expect(result.error?.message).toContain('Registry error');
    });
  });

  describe('unpinPlugin', () => {
    it('should successfully unpin a pinned plugin', async () => {
      // Setup
      const plugin: InstalledPlugin = {
        pluginId: 'test-plugin',
        version: '1.0.0',
        source: 'test-source',
        installState: InstallState.INSTALLED,
        installedAt: new Date(),
        cachePath: '/cache/test-plugin/1.0.0',
        transactionId: 'tx-123',
        pinned: true,
      };
      registryService.addPlugin(plugin);
      await registryService.pinPlugin('test-plugin');

      const cacheEntry: CacheEntry = {
        pluginId: 'test-plugin',
        version: '1.0.0',
        cachePath: '/cache/test-plugin/1.0.0',
        sizeBytes: 1024,
        lastAccessTime: new Date(),
        pinned: true,
        isCurrentVersion: true,
        checksum: 'checksum-123',
      };
      cacheService.addEntry(cacheEntry);

      // Act
      const result = await pinService.unpinPlugin('test-plugin');

      // Assert
      expect(result.success).toBe(true);
      expect(result.pluginId).toBe('test-plugin');

      // Verify registry state
      const registry = registryService.getRegistry();
      expect(registry.activePins).not.toContain('test-plugin');

      const updatedPlugin = await registryService.getPlugin('test-plugin');
      expect(updatedPlugin?.pinned).toBe(false);

      // Verify cache state
      const updatedEntry = cacheService.getEntry('test-plugin', '1.0.0');
      expect(updatedEntry?.pinned).toBe(false);
    });

    it('should be idempotent - unpinning non-pinned plugin succeeds', async () => {
      // Setup
      const plugin: InstalledPlugin = {
        pluginId: 'test-plugin',
        version: '1.0.0',
        source: 'test-source',
        installState: InstallState.INSTALLED,
        installedAt: new Date(),
        cachePath: '/cache/test-plugin/1.0.0',
        transactionId: 'tx-123',
        pinned: false,
      };
      registryService.addPlugin(plugin);

      // Act
      const result = await pinService.unpinPlugin('test-plugin');

      // Assert
      expect(result.success).toBe(true);
      expect(result.wasNoOp).toBe(true);
    });

    it('should succeed when unpinning nonexistent plugin', async () => {
      // Act (cleanup case)
      const result = await pinService.unpinPlugin('nonexistent-plugin');

      // Assert
      expect(result.success).toBe(true);
      expect(result.wasNoOp).toBe(true);
    });

    it('should handle errors gracefully', async () => {
      // Setup
      const plugin: InstalledPlugin = {
        pluginId: 'test-plugin',
        version: '1.0.0',
        source: 'test-source',
        installState: InstallState.INSTALLED,
        installedAt: new Date(),
        cachePath: '/cache/test-plugin/1.0.0',
        transactionId: 'tx-123',
        pinned: true,
      };
      registryService.addPlugin(plugin);
      await registryService.pinPlugin('test-plugin');

      // Mock registryService.unpinPlugin to throw
      vi.spyOn(registryService, 'unpinPlugin').mockRejectedValueOnce(new Error('Registry error'));

      // Act
      const result = await pinService.unpinPlugin('test-plugin');

      // Assert
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('UNPIN_FAILED');
    });
  });

  describe('getPinStatus', () => {
    it('should return pin status for pinned plugin', async () => {
      // Setup
      const plugin: InstalledPlugin = {
        pluginId: 'test-plugin',
        version: '1.0.0',
        source: 'test-source',
        installState: InstallState.INSTALLED,
        installedAt: new Date(),
        cachePath: '/cache/test-plugin/1.0.0',
        transactionId: 'tx-123',
        pinned: true,
      };
      registryService.addPlugin(plugin);
      await registryService.pinPlugin('test-plugin');

      const cacheEntry: CacheEntry = {
        pluginId: 'test-plugin',
        version: '1.0.0',
        cachePath: '/cache/test-plugin/1.0.0',
        sizeBytes: 1024,
        lastAccessTime: new Date(),
        pinned: true,
        isCurrentVersion: true,
        checksum: 'checksum-123',
      };
      cacheService.addEntry(cacheEntry);

      // Act
      const status = await pinService.getPinStatus('test-plugin');

      // Assert
      expect(status.pluginId).toBe('test-plugin');
      expect(status.isPinned).toBe(true);
      expect(status.isCached).toBe(true);
      expect(status.version).toBe('1.0.0');
      expect(status.plugin).toBeDefined();
    });

    it('should return status for non-pinned plugin', async () => {
      // Setup
      const plugin: InstalledPlugin = {
        pluginId: 'test-plugin',
        version: '1.0.0',
        source: 'test-source',
        installState: InstallState.INSTALLED,
        installedAt: new Date(),
        cachePath: '/cache/test-plugin/1.0.0',
        transactionId: 'tx-123',
      };
      registryService.addPlugin(plugin);

      // Act
      const status = await pinService.getPinStatus('test-plugin');

      // Assert
      expect(status.isPinned).toBe(false);
      expect(status.plugin).toBeDefined();
    });

    it('should return status for nonexistent plugin', async () => {
      // Act
      const status = await pinService.getPinStatus('nonexistent-plugin');

      // Assert
      expect(status.pluginId).toBe('nonexistent-plugin');
      expect(status.isPinned).toBe(false);
      expect(status.isCached).toBe(false);
      expect(status.plugin).toBeUndefined();
    });
  });

  describe('listPins', () => {
    it('should return empty array when no pins', async () => {
      // Act
      const pins = await pinService.listPins();

      // Assert
      expect(pins).toEqual([]);
    });

    it('should list all pinned plugins', async () => {
      // Setup multiple pinned plugins
      const plugin1: InstalledPlugin = {
        pluginId: 'plugin-1',
        version: '1.0.0',
        source: 'source-1',
        installState: InstallState.INSTALLED,
        installedAt: new Date('2026-01-10'),
        cachePath: '/cache/plugin-1/1.0.0',
        transactionId: 'tx-1',
        pinned: true,
      };
      registryService.addPlugin(plugin1);
      await registryService.pinPlugin('plugin-1');

      const plugin2: InstalledPlugin = {
        pluginId: 'plugin-2',
        version: '2.0.0',
        source: 'source-2',
        installState: InstallState.INSTALLED,
        installedAt: new Date('2026-01-11'),
        cachePath: '/cache/plugin-2/2.0.0',
        transactionId: 'tx-2',
        pinned: true,
      };
      registryService.addPlugin(plugin2);
      await registryService.pinPlugin('plugin-2');

      const cache1: CacheEntry = {
        pluginId: 'plugin-1',
        version: '1.0.0',
        cachePath: '/cache/plugin-1/1.0.0',
        sizeBytes: 1024,
        lastAccessTime: new Date(),
        pinned: true,
        isCurrentVersion: true,
        checksum: 'checksum-1',
      };
      cacheService.addEntry(cache1);

      const cache2: CacheEntry = {
        pluginId: 'plugin-2',
        version: '2.0.0',
        cachePath: '/cache/plugin-2/2.0.0',
        sizeBytes: 2048,
        lastAccessTime: new Date(),
        pinned: true,
        isCurrentVersion: true,
        checksum: 'checksum-2',
      };
      cacheService.addEntry(cache2);

      // Act
      const pins = await pinService.listPins();

      // Assert
      expect(pins).toHaveLength(2);
      expect(pins[0]).toMatchObject({
        pluginId: 'plugin-1',
        version: '1.0.0',
        isCached: true,
        cachePath: '/cache/plugin-1/1.0.0',
      });
      expect(pins[1]).toMatchObject({
        pluginId: 'plugin-2',
        version: '2.0.0',
        isCached: true,
        cachePath: '/cache/plugin-2/2.0.0',
      });
    });

    it('should skip orphaned pins', async () => {
      // Setup orphaned pin (in activePins but not in plugins)
      const registry = registryService.getRegistry();
      registry.activePins.push('orphaned-plugin');

      // Act
      const pins = await pinService.listPins();

      // Assert
      expect(pins).toEqual([]);
    });
  });

  describe('isPinned', () => {
    it('should return true for pinned plugin', async () => {
      // Setup
      const plugin: InstalledPlugin = {
        pluginId: 'test-plugin',
        version: '1.0.0',
        source: 'test-source',
        installState: InstallState.INSTALLED,
        installedAt: new Date(),
        cachePath: '/cache/test-plugin/1.0.0',
        transactionId: 'tx-123',
        pinned: true,
      };
      registryService.addPlugin(plugin);
      await registryService.pinPlugin('test-plugin');

      // Act
      const isPinned = await pinService.isPinned('test-plugin');

      // Assert
      expect(isPinned).toBe(true);
    });

    it('should return false for non-pinned plugin', async () => {
      // Act
      const isPinned = await pinService.isPinned('test-plugin');

      // Assert
      expect(isPinned).toBe(false);
    });
  });
});
