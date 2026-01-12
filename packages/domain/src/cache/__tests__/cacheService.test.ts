/**
 * Cache Service Integration Tests
 *
 * Tests cache eviction flows, pinning protection, staging/promote operations,
 * and orphaned temp cleanup as specified in acceptance criteria.
 *
 * @module domain/cache/__tests__/cacheService
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Config } from '../../config/contracts.js';
import { CacheService } from '../cacheService.js';
import type { ICacheAdapter } from '../contracts.js';
import { EvictionReason } from '../types.js';

/**
 * Mock cache adapter for testing
 */
class MockCacheAdapter implements ICacheAdapter {
  private directories = new Map<string, boolean>();
  private files = new Map<string, unknown>();
  private dirSizes = new Map<string, number>();

  async ensureDirectory(path: string): Promise<void> {
    this.directories.set(path, true);
  }

  async calculateDirectorySize(path: string): Promise<number> {
    return this.dirSizes.get(path) || 0;
  }

  setDirectorySize(path: string, size: number): void {
    this.dirSizes.set(path, size);
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
    this.dirSizes.delete(path);
  }

  async moveDirectory(source: string, destination: string): Promise<void> {
    if (!this.directories.has(source)) {
      throw new Error(`Source directory ${source} does not exist`);
    }
    this.directories.delete(source);
    this.directories.set(destination, true);

    // Transfer size
    const size = this.dirSizes.get(source) || 0;
    this.dirSizes.delete(source);
    this.dirSizes.set(destination, size);
  }

  async writeJsonAtomic<T>(path: string, data: T): Promise<void> {
    this.files.set(path, data);
  }

  async readJson<T>(path: string): Promise<T | undefined> {
    return this.files.get(path) as T | undefined;
  }

  async calculateChecksum(_path: string): Promise<string> {
    return 'mock-checksum-abc123';
  }

  async touchFile(_path: string): Promise<void> {
    // No-op for mock
  }

  async createTempDirectory(prefix: string): Promise<string> {
    const tempPath = `${prefix}/${Date.now()}-${Math.random()}`;
    this.directories.set(tempPath, true);
    return tempPath;
  }

  async listTempDirectories(pattern: string): Promise<string[]> {
    const results: string[] = [];
    for (const dir of this.directories.keys()) {
      if (dir.startsWith(pattern)) {
        results.push(dir);
      }
    }
    return results;
  }
}

describe('CacheService', () => {
  let adapter: MockCacheAdapter;
  let config: Config;
  let service: CacheService;
  let testDir: string;

  beforeEach(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'cache-test-'));

    adapter = new MockCacheAdapter();
    config = {
      pluginDir: join(testDir, '.claude-plugin'),
      installDir: join(testDir, '.claude/plugins'),
      maxCacheSizeMb: 1, // 1 MB for testing
      telemetryEnabled: false,
      lifecycleTimeoutMs: 30000,
    };

    service = new CacheService(config, adapter);

    // Initialize cache index
    await service.rebuildIndex();
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Cache Statistics', () => {
    it('should return empty stats for new cache', () => {
      const stats = service.getStats();

      expect(stats.totalSizeBytes).toBe(0);
      expect(stats.totalSizeMb).toBe(0);
      expect(stats.totalEntries).toBe(0);
      expect(stats.pinnedEntries).toBe(0);
      expect(stats.uniquePlugins).toBe(0);
      expect(stats.nearLimit).toBe(false);
      expect(stats.overLimit).toBe(false);
    });

it('should detect when cache is near limit', async () => {
      // Add cache entry that's 95% of limit
      const stageResult = await service.stageArtifacts('test-plugin', '1.0.0');
      const stagingPath = stageResult.data!.stagingPath;
      const sizeBytes = 0.95 * config.maxCacheSizeMb * 1024 * 1024;
      adapter.setDirectorySize(stagingPath, sizeBytes);

      await service.promoteArtifacts('test-plugin', '1.0.0', stagingPath);
      const stats = service.getStats();

      expect(stats.nearLimit).toBe(true);
      expect(stats.overLimit).toBe(false);
    });

it('should detect when cache is over limit', async () => {
      // Add cache entry that exceeds limit
      const stageResult = await service.stageArtifacts('test-plugin', '1.0.0');
      const stagingPath = stageResult.data!.stagingPath;
      const sizeBytes = 1.1 * config.maxCacheSizeMb * 1024 * 1024;
      adapter.setDirectorySize(stagingPath, sizeBytes);

      await service.promoteArtifacts('test-plugin', '1.0.0', stagingPath, { skipEviction: true });
      const stats = service.getStats();

      expect(stats.overLimit).toBe(true);
    });
  });

  describe('Stage and Promote Flow', () => {
    it('should stage artifacts successfully', async () => {
      const result = await service.stageArtifacts('test-plugin', '1.0.0');

      expect(result.success).toBe(true);
      expect(result.data?.stagingPath).toBeDefined();
      expect(result.data?.transactionId).toBeDefined();
      expect(result.metadata.operationType).toBe('stage');
    });

    it('should promote staged artifacts to cache', async () => {
      const stageResult = await service.stageArtifacts('test-plugin', '1.0.0');
      expect(stageResult.success).toBe(true);

      const stagingPath = stageResult.data!.stagingPath;
      const sizeBytes = 100000; // 100 KB
      adapter.setDirectorySize(stagingPath, sizeBytes);

      const promoteResult = await service.promoteArtifacts(
        'test-plugin',
        '1.0.0',
        stagingPath
      );

      expect(promoteResult.success).toBe(true);
      expect(promoteResult.data?.cachePath).toContain('test-plugin/1.0.0');
      expect(promoteResult.data?.sizeBytes).toBe(sizeBytes);
      expect(promoteResult.data?.checksum).toBeDefined();
    });

    it('should trigger eviction after promote if over limit', async () => {
      // Set cache size to exceed limit
      config.maxCacheSizeMb = 0.5; // 500 KB

      const stageResult = await service.stageArtifacts('test-plugin', '1.0.0');
      const stagingPath = stageResult.data!.stagingPath;

      // Make staged artifacts exceed limit
      const sizeBytes = 600 * 1024; // 600 KB
      adapter.setDirectorySize(stagingPath, sizeBytes);

      const promoteResult = await service.promoteArtifacts(
        'test-plugin',
        '1.0.0',
        stagingPath
      );

      expect(promoteResult.success).toBe(true);
      expect(promoteResult.data?.evictionTriggered).toBe(true);
    });
  });

  describe('Cache Eviction', () => {
    it('should not evict when cache is under limit', async () => {
      const result = await service.evictCache();

      expect(result.evictionTriggered).toBe(false);
      expect(result.bytesFreed).toBe(0);
      expect(result.entriesEvicted).toBe(0);
    });

    it('should evict oldest entries when over limit', async () => {
      // Promote multiple versions, exceeding cache limit
      config.maxCacheSizeMb = 0.5; // 500 KB

      // Add 3 versions of same plugin
      for (let i = 1; i <= 3; i++) {
        const stageResult = await service.stageArtifacts('test-plugin', `1.0.${i}`);
        const stagingPath = stageResult.data!.stagingPath;
        adapter.setDirectorySize(stagingPath, 300 * 1024); // 300 KB each

        await service.promoteArtifacts(
          'test-plugin',
          `1.0.${i}`,
          stagingPath,
          { skipEviction: true } // Skip auto-eviction to test manual
        );
      }

      // Now trigger eviction manually
      const evictionResult = await service.evictCache();

      expect(evictionResult.evictionTriggered).toBe(true);
      expect(evictionResult.entriesEvicted).toBeGreaterThan(0);
      expect(evictionResult.bytesFreed).toBeGreaterThan(0);
      expect(evictionResult.reason).toBe(EvictionReason.SIZE_LIMIT);
    });

    it('should protect pinned entries from eviction', async () => {
      config.maxCacheSizeMb = 0.5; // 500 KB

      // Add pinned version
      const stageResult1 = await service.stageArtifacts('test-plugin', '1.0.0');
      adapter.setDirectorySize(stageResult1.data!.stagingPath, 300 * 1024);
      await service.promoteArtifacts('test-plugin', '1.0.0', stageResult1.data!.stagingPath);
      await service.pinVersion('test-plugin', '1.0.0');

      // Add unpinned version that causes overflow
      const stageResult2 = await service.stageArtifacts('test-plugin', '1.0.1');
      adapter.setDirectorySize(stageResult2.data!.stagingPath, 300 * 1024);
      await service.promoteArtifacts('test-plugin', '1.0.1', stageResult2.data!.stagingPath);

      await service.evictCache();

      // Should not evict pinned entry
      const pinnedEntry = service.getEntry('test-plugin', '1.0.0');
      expect(pinnedEntry).toBeDefined();
    });

    it('enforces last three versions per plugin retention', async () => {
      config.maxCacheSizeMb = 5; // disable size-based evictions

      // Add 5 versions
      for (let i = 1; i <= 5; i++) {
        const stageResult = await service.stageArtifacts('test-plugin', `1.0.${i}`);
        adapter.setDirectorySize(stageResult.data!.stagingPath, 50 * 1024); // 50 KB each
        await service.promoteArtifacts('test-plugin', `1.0.${i}`, stageResult.data!.stagingPath, {
          skipEviction: true,
        });
      }

      const entries = service.listEntries('test-plugin');
      const versions = entries.map((entry) => entry.version).sort();

      expect(entries).toHaveLength(3);
      expect(versions).toEqual(['1.0.3', '1.0.4', '1.0.5']);
    });

    it('logs pin protection when eviction runs with pinned entries', async () => {
      config.maxCacheSizeMb = 0.5; // 500 KB overall

      // Add pinned version
      const stageResult1 = await service.stageArtifacts('pinned-plugin', '1.0.0');
      adapter.setDirectorySize(stageResult1.data!.stagingPath, 300 * 1024);
      await service.promoteArtifacts('pinned-plugin', '1.0.0', stageResult1.data!.stagingPath);
      await service.pinVersion('pinned-plugin', '1.0.0');

      // Add another plugin to push over limit
      const stageResult2 = await service.stageArtifacts('other-plugin', '2.0.0');
      adapter.setDirectorySize(stageResult2.data!.stagingPath, 300 * 1024);
      await service.promoteArtifacts('other-plugin', '2.0.0', stageResult2.data!.stagingPath);

      await service.evictCache();

      const indexPath = join(config.pluginDir, 'cache', 'index.json');
      const indexData = await adapter.readJson<any>(indexPath);

      expect(indexData.evictionLog.some((entry: any) => entry.reason === EvictionReason.PIN_PROTECTED)).toBe(true);
      const pinnedLog = indexData.evictionLog.find(
        (entry: any) => entry.reason === EvictionReason.PIN_PROTECTED
      );
      expect(pinnedLog).toBeDefined();
      expect(pinnedLog.pluginId).toBe('pinned-plugin');
    });
  });

  describe('Retrieve Artifacts', () => {
    it('should retrieve cached artifacts and update access time', async () => {
      const stageResult = await service.stageArtifacts('test-plugin', '1.0.0');
      adapter.setDirectorySize(stageResult.data!.stagingPath, 100 * 1024);
      await service.promoteArtifacts('test-plugin', '1.0.0', stageResult.data!.stagingPath);

      const retrieveResult = await service.retrieveArtifacts('test-plugin', '1.0.0');

      expect(retrieveResult.success).toBe(true);
      expect(retrieveResult.data).toContain('test-plugin/1.0.0');
    });

    it('should fail when artifacts not cached', async () => {
      const result = await service.retrieveArtifacts('nonexistent-plugin', '1.0.0');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_CACHED');
    });
  });

  describe('Orphaned Temp Cleanup', () => {
    it('should clean up orphaned temporary directories', async () => {
      // Create some orphaned temp directories
      await adapter.createTempDirectory(join(config.pluginDir, 'tmp'));
      await adapter.createTempDirectory(join(config.pluginDir, 'tmp'));

      const cleanedCount = await service.cleanupOrphanedTemp();

      expect(cleanedCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Integrity Validation', () => {
    it('should return empty array for valid cache', async () => {
      const stageResult = await service.stageArtifacts('test-plugin', '1.0.0');
      adapter.setDirectorySize(stageResult.data!.stagingPath, 100 * 1024);
      await service.promoteArtifacts('test-plugin', '1.0.0', stageResult.data!.stagingPath);

      const corrupted = await service.validateIntegrity();

      expect(corrupted).toHaveLength(0);
    });
  });

  describe('Pin/Unpin Operations', () => {
    it('should pin and unpin plugin versions', async () => {
      const stageResult = await service.stageArtifacts('test-plugin', '1.0.0');
      adapter.setDirectorySize(stageResult.data!.stagingPath, 100 * 1024);
      await service.promoteArtifacts('test-plugin', '1.0.0', stageResult.data!.stagingPath);

      await service.pinVersion('test-plugin', '1.0.0');
      let entry = service.getEntry('test-plugin', '1.0.0');
      expect(entry?.pinned).toBe(true);

      await service.unpinVersion('test-plugin', '1.0.0');
      entry = service.getEntry('test-plugin', '1.0.0');
      expect(entry?.pinned).toBe(false);
    });
  });

  describe('removeEntry', () => {
    it('removes cached versions when requested explicitly', async () => {
      const stageResult = await service.stageArtifacts('cleanup-plugin', '1.0.0');
      adapter.setDirectorySize(stageResult.data!.stagingPath, 64 * 1024);
      await service.promoteArtifacts('cleanup-plugin', '1.0.0', stageResult.data!.stagingPath);

      const removed = await service.removeEntry('cleanup-plugin', '1.0.0');
      expect(removed).toBeDefined();
      expect(removed?.version).toBe('1.0.0');

      const entries = service.listEntries('cleanup-plugin');
      expect(entries).toHaveLength(0);

      const stats = service.getStats();
      expect(stats.totalEntries).toBe(0);
      expect(stats.totalSizeBytes).toBe(0);
    });
  });
});
