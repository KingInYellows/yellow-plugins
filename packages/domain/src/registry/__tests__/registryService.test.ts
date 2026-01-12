/**
 * Registry Service Integration Tests
 *
 * Tests atomic writes, plugin CRUD operations, validation, and backup/restore
 * as specified in acceptance criteria.
 *
 * @module domain/registry/__tests__/registryService
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ICacheAdapter } from '../../cache/contracts.js';
import type { Config } from '../../config/contracts.js';
import { RegistryService } from '../registryService.js';
import { InstallState } from '../types.js';
import type { InstalledPlugin } from '../types.js';

/**
 * Mock cache adapter for testing
 */
class MockCacheAdapter implements ICacheAdapter {
  private directories = new Map<string, boolean>();
  private files = new Map<string, unknown>();

  async ensureDirectory(_path: string): Promise<void> {
    this.directories.set(_path, true);
  }

  async calculateDirectorySize(_path: string): Promise<number> {
    return 0;
  }

  async listDirectory(
    _path: string
  ): Promise<Array<{ name: string; path: string; isDirectory: boolean; size: number; mtime: Date }>> {
    return [];
  }

  async exists(path: string): Promise<boolean> {
    return this.directories.has(path) || this.files.has(path);
  }

  async removeDirectory(path: string): Promise<void> {
    this.directories.delete(path);
  }

  async moveDirectory(_source: string, _destination: string): Promise<void> {
    // No-op for mock
  }

  async writeJsonAtomic<T>(path: string, data: T): Promise<void> {
    this.files.set(path, data);
  }

  async readJson<T>(path: string): Promise<T | undefined> {
    return this.files.get(path) as T | undefined;
  }

  async calculateChecksum(_path: string): Promise<string> {
    return 'mock-checksum';
  }

  async touchFile(_path: string): Promise<void> {
    // No-op
  }

  async createTempDirectory(prefix: string): Promise<string> {
    return `${prefix}/temp-${Date.now()}`;
  }

  async listTempDirectories(_pattern: string): Promise<string[]> {
    return [];
  }

  // Helper to set directory existence
  setDirectoryExists(path: string, exists: boolean): void {
    if (exists) {
      this.directories.set(path, true);
    } else {
      this.directories.delete(path);
    }
  }
}

describe('RegistryService', () => {
  let adapter: MockCacheAdapter;
  let config: Config;
  let service: RegistryService;
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'registry-test-'));

    adapter = new MockCacheAdapter();
    config = {
      pluginDir: join(testDir, '.claude-plugin'),
      installDir: join(testDir, '.claude/plugins'),
      maxCacheSizeMb: 500,
      telemetryEnabled: false,
      lifecycleTimeoutMs: 30000,
    };

    service = new RegistryService(config, adapter);
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Load Registry', () => {
    it('should return empty registry if file does not exist', async () => {
      const registry = await service.loadRegistry();

      expect(registry.metadata.registryVersion).toBe('1.0');
      expect(registry.plugins).toHaveLength(0);
      expect(registry.activePins).toHaveLength(0);
    });

    it('should load existing registry from disk', async () => {
      // Add a plugin first
      const plugin: InstalledPlugin = {
        pluginId: 'test-plugin',
        version: '1.0.0',
        source: 'plugins/test-plugin',
        installState: InstallState.INSTALLED,
        installedAt: new Date(),
        cachePath: '/path/to/cache',
        transactionId: 'tx-123',
      };

      await service.addPlugin(plugin);

      // Create new service instance to test loading
      const newService = new RegistryService(config, adapter);
      const registry = await newService.loadRegistry();

      expect(registry.plugins).toHaveLength(1);
      expect(registry.plugins[0].pluginId).toBe('test-plugin');
    });
  });

  describe('Add Plugin', () => {
    it('should add plugin to registry successfully', async () => {
      const plugin: InstalledPlugin = {
        pluginId: 'test-plugin',
        version: '1.0.0',
        source: 'plugins/test-plugin',
        installState: InstallState.INSTALLED,
        installedAt: new Date(),
        cachePath: '/path/to/cache',
        transactionId: 'tx-123',
      };

      const result = await service.addPlugin(plugin);

      expect(result.success).toBe(true);
      expect(result.data?.pluginId).toBe('test-plugin');
      expect(result.metadata.operationType).toBe('add');

      const loadedPlugin = await service.getPlugin('test-plugin');
      expect(loadedPlugin).toBeDefined();
      expect(loadedPlugin?.version).toBe('1.0.0');
    });

    it('should fail to add duplicate plugin', async () => {
      const plugin: InstalledPlugin = {
        pluginId: 'test-plugin',
        version: '1.0.0',
        source: 'plugins/test-plugin',
        installState: InstallState.INSTALLED,
        installedAt: new Date(),
        cachePath: '/path/to/cache',
        transactionId: 'tx-123',
      };

      await service.addPlugin(plugin);
      const result = await service.addPlugin(plugin);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PLUGIN_EXISTS');
    });

    it('should capture telemetry when adding plugin', async () => {
      const plugin: InstalledPlugin = {
        pluginId: 'test-plugin',
        version: '1.0.0',
        source: 'plugins/test-plugin',
        installState: InstallState.INSTALLED,
        installedAt: new Date(),
        cachePath: '/path/to/cache',
        transactionId: 'tx-123',
      };

      const result = await service.addPlugin(plugin, {
        telemetryContext: {
          id: 'tel-test',
          transactionId: 'tx-123',
          commandType: 'install',
          durationMs: 1000,
          success: true,
          capturedAt: new Date(),
        },
      });

      expect(result.success).toBe(true);

      const registry = await service.loadRegistry();
      expect(registry.telemetry).toBeDefined();
      expect(registry.telemetry?.['tel-test']).toBeDefined();
    });
  });

  describe('Update Plugin', () => {
    it('should update existing plugin', async () => {
      const plugin: InstalledPlugin = {
        pluginId: 'test-plugin',
        version: '1.0.0',
        source: 'plugins/test-plugin',
        installState: InstallState.INSTALLED,
        installedAt: new Date(),
        cachePath: '/path/to/cache',
        transactionId: 'tx-123',
      };

      await service.addPlugin(plugin);

      const result = await service.updatePlugin('test-plugin', {
        version: '1.0.1',
        installState: InstallState.INSTALLED,
      });

      expect(result.success).toBe(true);
      expect(result.data?.version).toBe('1.0.1');

      const updated = await service.getPlugin('test-plugin');
      expect(updated?.version).toBe('1.0.1');
    });

    it('should fail to update non-existent plugin', async () => {
      const result = await service.updatePlugin('nonexistent', {
        version: '2.0.0',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PLUGIN_NOT_FOUND');
    });
  });

  describe('Remove Plugin', () => {
    it('should remove plugin from registry', async () => {
      const plugin: InstalledPlugin = {
        pluginId: 'test-plugin',
        version: '1.0.0',
        source: 'plugins/test-plugin',
        installState: InstallState.INSTALLED,
        installedAt: new Date(),
        cachePath: '/path/to/cache',
        transactionId: 'tx-123',
      };

      await service.addPlugin(plugin);
      const result = await service.removePlugin('test-plugin');

      expect(result.success).toBe(true);

      const removed = await service.getPlugin('test-plugin');
      expect(removed).toBeUndefined();
    });

    it('should remove plugin from activePins when removed', async () => {
      const plugin: InstalledPlugin = {
        pluginId: 'test-plugin',
        version: '1.0.0',
        source: 'plugins/test-plugin',
        installState: InstallState.INSTALLED,
        installedAt: new Date(),
        cachePath: '/path/to/cache',
        transactionId: 'tx-123',
      };

      await service.addPlugin(plugin);
      await service.pinPlugin('test-plugin');

      let registry = await service.loadRegistry();
      expect(registry.activePins).toContain('test-plugin');

      await service.removePlugin('test-plugin');

      registry = await service.loadRegistry();
      expect(registry.activePins).not.toContain('test-plugin');
    });
  });

  describe('Query Plugins', () => {
    beforeEach(async () => {
      const plugin1: InstalledPlugin = {
        pluginId: 'plugin-one',
        version: '1.0.0',
        source: 'plugins/plugin-one',
        installState: InstallState.INSTALLED,
        installedAt: new Date('2026-01-10'),
        cachePath: '/cache/one',
        transactionId: 'tx-1',
        pinned: true,
      };

      const plugin2: InstalledPlugin = {
        pluginId: 'plugin-two',
        version: '2.0.0',
        source: 'plugins/plugin-two',
        installState: InstallState.FAILED,
        installedAt: new Date('2026-01-11'),
        cachePath: '/cache/two',
        transactionId: 'tx-2',
      };

      await service.addPlugin(plugin1);
      await service.addPlugin(plugin2);
    });

    it('should query by plugin ID', async () => {
      const results = await service.queryPlugins({ pluginId: 'plugin-one' });

      expect(results).toHaveLength(1);
      expect(results[0].pluginId).toBe('plugin-one');
    });

    it('should query by install state', async () => {
      const results = await service.queryPlugins({ installState: InstallState.INSTALLED });

      expect(results).toHaveLength(1);
      expect(results[0].installState).toBe(InstallState.INSTALLED);
    });

    it('should query by pinned status', async () => {
      const results = await service.queryPlugins({ pinned: true });

      expect(results).toHaveLength(1);
      expect(results[0].pinned).toBe(true);
    });

    it('should query by install date range', async () => {
      const results = await service.queryPlugins({
        installedAfter: new Date('2026-01-11'),
      });

      expect(results).toHaveLength(1);
      expect(results[0].pluginId).toBe('plugin-two');
    });
  });

  describe('Pin/Unpin Plugin', () => {
    it('should pin plugin and add to activePins', async () => {
      const plugin: InstalledPlugin = {
        pluginId: 'test-plugin',
        version: '1.0.0',
        source: 'plugins/test-plugin',
        installState: InstallState.INSTALLED,
        installedAt: new Date(),
        cachePath: '/path/to/cache',
        transactionId: 'tx-123',
      };

      await service.addPlugin(plugin);
      await service.pinPlugin('test-plugin');

      const registry = await service.loadRegistry();
      expect(registry.activePins).toContain('test-plugin');

      const pinnedPlugin = await service.getPlugin('test-plugin');
      expect(pinnedPlugin?.pinned).toBe(true);
    });

    it('should unpin plugin and remove from activePins', async () => {
      const plugin: InstalledPlugin = {
        pluginId: 'test-plugin',
        version: '1.0.0',
        source: 'plugins/test-plugin',
        installState: InstallState.INSTALLED,
        installedAt: new Date(),
        cachePath: '/path/to/cache',
        transactionId: 'tx-123',
      };

      await service.addPlugin(plugin);
      await service.pinPlugin('test-plugin');
      await service.unpinPlugin('test-plugin');

      const registry = await service.loadRegistry();
      expect(registry.activePins).not.toContain('test-plugin');

      const unpinnedPlugin = await service.getPlugin('test-plugin');
      expect(unpinnedPlugin?.pinned).toBe(false);
    });

    it('should throw error when pinning non-existent plugin', async () => {
      await expect(service.pinPlugin('nonexistent')).rejects.toThrow();
    });
  });

  describe('Validate Registry', () => {
    it('should validate correct registry', async () => {
      // Mark cache path as existing
      adapter.setDirectoryExists('/path/to/cache', true);

      const plugin: InstalledPlugin = {
        pluginId: 'test-plugin',
        version: '1.0.0',
        source: 'plugins/test-plugin',
        installState: InstallState.INSTALLED,
        installedAt: new Date(),
        cachePath: '/path/to/cache',
        transactionId: 'tx-123',
      };

      await service.addPlugin(plugin);

      const errors = await service.validateRegistry();
      expect(errors).toHaveLength(0);
    });

    it('should detect missing cache path for installed plugin', async () => {
      // Don't mark cache path as existing
      const plugin: InstalledPlugin = {
        pluginId: 'test-plugin',
        version: '1.0.0',
        source: 'plugins/test-plugin',
        installState: InstallState.INSTALLED,
        installedAt: new Date(),
        cachePath: '/nonexistent/path',
        transactionId: 'tx-123',
      };

      await service.addPlugin(plugin);

      const errors = await service.validateRegistry();
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.includes('does not exist'))).toBe(true);
    });

    it('should detect invalid activePins reference', async () => {
      const plugin: InstalledPlugin = {
        pluginId: 'test-plugin',
        version: '1.0.0',
        source: 'plugins/test-plugin',
        installState: InstallState.INSTALLED,
        installedAt: new Date(),
        cachePath: '/path/to/cache',
        transactionId: 'tx-123',
      };

      await service.addPlugin(plugin);

      // Manually add invalid pin
      const registry = await service.loadRegistry();
      registry.activePins.push('nonexistent-plugin');
      await adapter.writeJsonAtomic(join(config.pluginDir, 'registry.json'), registry);

      const errors = await service.validateRegistry();
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.includes('not found in plugins list'))).toBe(true);
    });
  });

  describe('Backup and Restore', () => {
    it('should create backup of registry', async () => {
      const plugin: InstalledPlugin = {
        pluginId: 'test-plugin',
        version: '1.0.0',
        source: 'plugins/test-plugin',
        installState: InstallState.INSTALLED,
        installedAt: new Date(),
        cachePath: '/path/to/cache',
        transactionId: 'tx-123',
      };

      await service.addPlugin(plugin);

      const backup = await service.createBackup('Test backup');

      expect(backup.backupPath).toBeDefined();
      expect(backup.reason).toBe('Test backup');
      expect(backup.registryVersion).toBe('1.0');
    });

    it('should restore registry from backup', async () => {
      const plugin: InstalledPlugin = {
        pluginId: 'test-plugin',
        version: '1.0.0',
        source: 'plugins/test-plugin',
        installState: InstallState.INSTALLED,
        installedAt: new Date(),
        cachePath: '/path/to/cache',
        transactionId: 'tx-123',
      };

      await service.addPlugin(plugin);

      const backup = await service.createBackup('Before change');

      // Remove plugin
      await service.removePlugin('test-plugin');
      expect(await service.getPlugin('test-plugin')).toBeUndefined();

      // Restore from backup
      await service.restoreFromBackup(backup.backupPath);

      const restored = await service.getPlugin('test-plugin');
      expect(restored).toBeDefined();
      expect(restored?.pluginId).toBe('test-plugin');
    });
  });

  describe('Registry Statistics', () => {
    it('should return correct stats', async () => {
      const plugin1: InstalledPlugin = {
        pluginId: 'plugin-one',
        version: '1.0.0',
        source: 'plugins/plugin-one',
        installState: InstallState.INSTALLED,
        installedAt: new Date('2026-01-10'),
        cachePath: '/cache/one',
        transactionId: 'tx-1',
      };

      const plugin2: InstalledPlugin = {
        pluginId: 'plugin-two',
        version: '2.0.0',
        source: 'plugins/plugin-two',
        installState: InstallState.FAILED,
        installedAt: new Date('2026-01-11'),
        cachePath: '/cache/two',
        transactionId: 'tx-2',
      };

      await service.addPlugin(plugin1);
      await service.addPlugin(plugin2);
      await service.pinPlugin('plugin-one');

      const stats = await service.getStats();

      expect(stats.totalPlugins).toBe(2);
      expect(stats.installedCount).toBe(1);
      expect(stats.failedCount).toBe(1);
      expect(stats.pinnedCount).toBe(1);
      expect(stats.oldestInstall).toBeDefined();
      expect(stats.newestInstall).toBeDefined();
    });
  });
});
