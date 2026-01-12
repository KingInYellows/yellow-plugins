/**
 * @yellow-plugins/domain - Cache Service Implementation
 *
 * Core domain service for cache management, eviction policies, and artifact storage.
 * Implements LRU eviction with 500MB limit and last-3-versions retention per plugin.
 *
 * Part of Task I2.T2: Cache manager + registry persistence
 *
 * Architecture References:
 * - Section 3.4: Data Persistence & Cache Layout
 * - CRIT-002: Cache eviction policy (500MB, last-3-versions, LRU)
 * - Implementation Guide: Cache Eviction Algorithm
 */

import { join } from 'node:path';

import type { Config } from '../config/contracts.js';

import type { ICacheAdapter, ICacheService } from './contracts.js';
import type {
  CacheEntry,
  CacheIndex,
  CacheOperationOptions,
  CacheOperationResult,
  CachePromotionData,
  CacheStagingData,
  CacheStats,
  EvictionLogEntry,
  EvictionResult,
} from './types.js';
import { EvictionReason } from './types.js';

/**
 * Cache service implementation.
 * Orchestrates cache operations with eviction policies and atomic operations.
 */
export class CacheService implements ICacheService {
  private static readonly PER_PLUGIN_RETENTION = 3;
  private static readonly MIN_ROLLBACK_SET = 2;

  private readonly config: Config;
  private readonly adapter: ICacheAdapter;
  private cacheIndexCache: CacheIndex | null = null;

  /**
   * Cache directory path (computed from config)
   */
  private get cacheDir(): string {
    return join(this.config.pluginDir, 'cache');
  }

  /**
   * Temp directory path for staging
   */
  private get tempDir(): string {
    return join(this.config.pluginDir, 'tmp');
  }

  /**
   * Cache index file path
   */
  private get indexPath(): string {
    return join(this.cacheDir, 'index.json');
  }

  constructor(config: Config, adapter: ICacheAdapter) {
    this.config = config;
    this.adapter = adapter;

    // Warm the cache index asynchronously so synchronous accessors have data soon after startup
    void this.loadIndex().catch(() => undefined);
  }

  /**
   * Get current cache statistics.
   */
  getStats(): CacheStats {
    const index = this.getCachedIndex();
    return this.calculateStats(index);
  }

  /**
   * Get cache entry for a specific plugin version.
   */
  getEntry(pluginId: string, version: string): CacheEntry | undefined {
    const index = this.getCachedIndex();
    const entries = index.entries[pluginId] || [];
    return entries.find((e) => e.version === version);
  }

  /**
   * List all cached entries for a plugin.
   */
  listEntries(pluginId: string): CacheEntry[] {
    const index = this.getCachedIndex();
    return index.entries[pluginId] || [];
  }

  /**
   * Stage artifacts for caching (create temp directory).
   */
  async stageArtifacts(
    pluginId: string,
    version: string,
    options?: CacheOperationOptions
  ): Promise<CacheOperationResult<CacheStagingData>> {
    const startTime = Date.now();
    const transactionId = options?.transactionId || this.generateTransactionId();

    try {
      // Create staging directory
      await this.adapter.ensureDirectory(this.tempDir);
      const stagingPath = join(this.tempDir, transactionId);
      await this.adapter.ensureDirectory(stagingPath);

      return {
        success: true,
        data: {
          stagingPath,
          transactionId,
        },
        metadata: {
          operationType: 'stage',
          transactionId,
          durationMs: Date.now() - startTime,
          timestamp: new Date(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'STAGE_FAILED',
          message: `Failed to stage artifacts for ${pluginId}@${version}`,
          details: error,
        },
        metadata: {
          operationType: 'stage',
          transactionId,
          durationMs: Date.now() - startTime,
          timestamp: new Date(),
        },
      };
    }
  }

  /**
   * Promote staged artifacts to cache (atomic move).
   */
  async promoteArtifacts(
    pluginId: string,
    version: string,
    stagingPath: string,
    options?: CacheOperationOptions
  ): Promise<CacheOperationResult<CachePromotionData>> {
    const startTime = Date.now();
    const transactionId = options?.transactionId || this.generateTransactionId();

    try {
      // Ensure cache directory structure exists
      const pluginCacheDir = join(this.cacheDir, pluginId);
      await this.adapter.ensureDirectory(pluginCacheDir);

      // Calculate size and checksum before move
      const sizeBytes = await this.adapter.calculateDirectorySize(stagingPath);
      const checksum = await this.adapter.calculateChecksum(stagingPath);

      // Target cache path
      const cachePath = join(pluginCacheDir, version);

      // Atomic move from staging to cache
      await this.adapter.moveDirectory(stagingPath, cachePath);

      // Update cache index
      await this.addToIndex(pluginId, version, cachePath, sizeBytes, checksum);

      // Enforce per-plugin retention even if eviction is skipped
      const retentionEvictions = await this.enforceVersionRetention(pluginId);

      // Run eviction if not skipped
      let evictionTriggered = retentionEvictions.length > 0;
      if (!options?.skipEviction) {
        const evictionResult = await this.evictCache({ transactionId });
        evictionTriggered ||= evictionResult.evictionTriggered;
      }

      return {
        success: true,
        data: {
          cachePath,
          checksum,
          sizeBytes,
          evictionTriggered,
        },
        metadata: {
          operationType: 'promote',
          transactionId,
          durationMs: Date.now() - startTime,
          timestamp: new Date(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'PROMOTE_FAILED',
          message: `Failed to promote artifacts for ${pluginId}@${version}`,
          details: error,
        },
        metadata: {
          operationType: 'promote',
          transactionId,
          durationMs: Date.now() - startTime,
          timestamp: new Date(),
        },
      };
    }
  }

  /**
   * Retrieve cached artifacts for a plugin version.
   */
  async retrieveArtifacts(
    pluginId: string,
    version: string,
    options?: CacheOperationOptions
  ): Promise<CacheOperationResult<string>> {
    const startTime = Date.now();
    const transactionId = options?.transactionId || this.generateTransactionId();

    try {
      const entry = this.getEntry(pluginId, version);

      if (!entry) {
        return {
          success: false,
          error: {
            code: 'NOT_CACHED',
            message: `Plugin ${pluginId}@${version} not found in cache`,
          },
          metadata: {
            operationType: 'retrieve',
            transactionId,
            durationMs: Date.now() - startTime,
            timestamp: new Date(),
          },
        };
      }

      // Verify cache path exists
      const exists = await this.adapter.exists(entry.cachePath);
      if (!exists) {
        return {
          success: false,
          error: {
            code: 'CACHE_MISSING',
            message: `Cache path ${entry.cachePath} does not exist`,
          },
          metadata: {
            operationType: 'retrieve',
            transactionId,
            durationMs: Date.now() - startTime,
            timestamp: new Date(),
          },
        };
      }

      // Update last access time in index
      await this.updateLastAccessTime(pluginId, version);

      return {
        success: true,
        data: entry.cachePath,
        metadata: {
          operationType: 'retrieve',
          transactionId,
          durationMs: Date.now() - startTime,
          timestamp: new Date(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'RETRIEVE_FAILED',
          message: `Failed to retrieve artifacts for ${pluginId}@${version}`,
          details: error,
        },
        metadata: {
          operationType: 'retrieve',
          transactionId,
          durationMs: Date.now() - startTime,
          timestamp: new Date(),
        },
      };
    }
  }

  /**
   * Mark a plugin version as pinned.
   */
  async pinVersion(pluginId: string, version: string): Promise<void> {
    await this.updatePinStatus(pluginId, version, true);
  }

  /**
   * Unpin a plugin version.
   */
  async unpinVersion(pluginId: string, version: string): Promise<void> {
    await this.updatePinStatus(pluginId, version, false);
  }

  /**
   * Run cache eviction based on policies.
   */
  async evictCache(options?: CacheOperationOptions): Promise<EvictionResult> {
    void options;
    const index = await this.loadIndex();
    const stats = this.calculateStats(index);
    const sizeBefore = stats.totalSizeBytes;
    const maxSizeBytes = Math.max(this.config.maxCacheSizeMb, 0) * 1024 * 1024;

    if (!stats.overLimit) {
      return {
        evictionTriggered: false,
        bytesFreed: 0,
        entriesEvicted: 0,
        evictedEntries: [],
        sizeBefore,
        sizeAfter: sizeBefore,
        evictedAt: new Date(),
        reason: EvictionReason.SIZE_LIMIT,
      };
    }

    const { candidates, pinnedProtected } = this.getEvictionPlan(index);
    const evictedEntries: CacheEntry[] = [];
    let logWritten = false;
    let currentSize = sizeBefore;

    for (const pinnedEntry of pinnedProtected) {
      const logEntry: EvictionLogEntry = {
        evictedAt: new Date(),
        pluginId: pinnedEntry.pluginId,
        version: pinnedEntry.version,
        reason: EvictionReason.PIN_PROTECTED,
        bytesFreed: 0,
        wasPinned: true,
        cacheSizeBefore: currentSize,
        cacheSizeAfter: currentSize,
      };
      this.appendLogEntry(index, logEntry);
      logWritten = true;
    }

    for (const candidate of candidates) {
      if (currentSize <= maxSizeBytes) {
        break;
      }

      await this.adapter.removeDirectory(candidate.cachePath);

      const sizeBeforeRemoval = currentSize;
      const removed = this.removeFromIndex(index, candidate.pluginId, candidate.version);
      if (!removed) {
        continue;
      }

      currentSize = Math.max(0, currentSize - removed.sizeBytes);
      const logEntry: EvictionLogEntry = {
        evictedAt: new Date(),
        pluginId: removed.pluginId,
        version: removed.version,
        reason: EvictionReason.SIZE_LIMIT,
        bytesFreed: removed.sizeBytes,
        wasPinned: removed.pinned,
        cacheSizeBefore: sizeBeforeRemoval,
        cacheSizeAfter: currentSize,
      };
      this.appendLogEntry(index, logEntry);
      evictedEntries.push(removed);
      logWritten = true;
    }

    if (logWritten) {
      (index as { lastUpdated: Date }).lastUpdated = new Date();
      await this.persistIndex(index);
    }

    return {
      evictionTriggered: true,
      bytesFreed: sizeBefore - currentSize,
      entriesEvicted: evictedEntries.length,
      evictedEntries,
      sizeBefore,
      sizeAfter: currentSize,
      evictedAt: new Date(),
      reason: EvictionReason.SIZE_LIMIT,
    };
  }

  /**
   * Clean up orphaned temporary directories.
   */
  async cleanupOrphanedTemp(): Promise<number> {
    const tempDirs = await this.adapter.listTempDirectories(this.tempDir);
    let cleanedCount = 0;

    for (const tempDir of tempDirs) {
      try {
        await this.adapter.removeDirectory(tempDir);
        cleanedCount++;
      } catch {
        // Ignore cleanup errors for individual directories
      }
    }

    return cleanedCount;
  }

  /**
   * Rebuild cache index from filesystem state.
   */
  async rebuildIndex(): Promise<CacheIndex> {
    const entries: Record<string, CacheEntry[]> = {};
    let totalSizeBytes = 0;

    await this.adapter.ensureDirectory(this.cacheDir);
    const pluginDirs = await this.adapter.listDirectory(this.cacheDir);

    for (const pluginDir of pluginDirs) {
      if (!pluginDir.isDirectory || pluginDir.name === 'index.json') {
        continue;
      }

      const pluginId = pluginDir.name;
      const versionDirs = await this.adapter.listDirectory(pluginDir.path);
      entries[pluginId] = [];

      for (const versionDir of versionDirs) {
        if (!versionDir.isDirectory) {
          continue;
        }

        const version = versionDir.name;
        const sizeBytes = await this.adapter.calculateDirectorySize(versionDir.path);
        const checksum = await this.adapter.calculateChecksum(versionDir.path);

        const entry: CacheEntry = {
          pluginId,
          version,
          cachePath: versionDir.path,
          sizeBytes,
          lastAccessTime: versionDir.mtime ?? new Date(),
          pinned: false,
          isCurrentVersion: false,
          checksum,
        };

        entries[pluginId].push(entry);
        totalSizeBytes += sizeBytes;
      }

      const pluginEntries = entries[pluginId];
      if (pluginEntries.length > 0) {
        const sorted = [...pluginEntries].sort((a, b) => this.compareSemver(b.version, a.version));
        const latestVersion = sorted[0]?.version;
        if (latestVersion) {
          for (const entry of pluginEntries) {
            (entry as { isCurrentVersion: boolean }).isCurrentVersion = entry.version === latestVersion;
          }
        }
      }
    }

    const index: CacheIndex = {
      version: '1.0',
      lastUpdated: new Date(),
      totalSizeBytes,
      entries,
      evictionLog: [],
    };

    await this.persistIndex(index);
    return index;
  }

  /**
   * Validate cache integrity.
   */
  async validateIntegrity(): Promise<CacheEntry[]> {
    const index = await this.loadIndex();
    const corrupted: CacheEntry[] = [];

    for (const [, pluginEntries] of Object.entries(index.entries)) {
      for (const entry of pluginEntries) {
        const exists = await this.adapter.exists(entry.cachePath);
        if (!exists) {
          corrupted.push(entry);
          continue;
        }

        if (entry.checksum) {
          try {
            const actualChecksum = await this.adapter.calculateChecksum(entry.cachePath);
            if (actualChecksum !== entry.checksum) {
              corrupted.push(entry);
            }
          } catch {
            corrupted.push(entry);
          }
        }
      }
    }

    return corrupted;
  }

  // Private helper methods

  /**
   * Get cached index or load from disk.
   */
  private getCachedIndex(): CacheIndex {
    if (this.cacheIndexCache) {
      return this.cacheIndexCache;
    }

    return this.createEmptyIndex();
  }

  /**
   * Load index from disk asynchronously.
   */
  private async loadIndex(forceReload = false): Promise<CacheIndex> {
    if (this.cacheIndexCache && !forceReload) {
      return this.cacheIndexCache;
    }

    const index = await this.adapter.readJson<CacheIndex>(this.indexPath);

    if (!index) {
      return await this.rebuildIndex();
    }

    const normalized = this.normalizeIndex(index);
    this.cacheIndexCache = normalized;
    return normalized;
  }

  /**
   * Add entry to cache index.
   */
  private async addToIndex(
    pluginId: string,
    version: string,
    cachePath: string,
    sizeBytes: number,
    checksum: string
  ): Promise<void> {
    const index = await this.loadIndex();

    if (!index.entries[pluginId]) {
      index.entries[pluginId] = [];
    }

    for (const existing of index.entries[pluginId]) {
      (existing as { isCurrentVersion: boolean }).isCurrentVersion = false;
    }

    const entry: CacheEntry = {
      pluginId,
      version,
      cachePath,
      sizeBytes,
      lastAccessTime: new Date(),
      pinned: false,
      isCurrentVersion: true,
      checksum,
    };

    index.entries[pluginId].push(entry);
    index.totalSizeBytes += sizeBytes;
    (index as { lastUpdated: Date }).lastUpdated = new Date();

    await this.persistIndex(index);
  }

  /**
   * Enforce per-plugin retention limits even when cache is under the global size cap.
   */
  private async enforceVersionRetention(pluginId: string): Promise<CacheEntry[]> {
    const index = await this.loadIndex();
    const pluginEntries = index.entries[pluginId];

    if (!pluginEntries || pluginEntries.length <= CacheService.PER_PLUGIN_RETENTION) {
      return [];
    }

    const removalCandidates = this.getEntriesExceedingLimit(
      pluginEntries,
      CacheService.PER_PLUGIN_RETENTION
    );
    if (removalCandidates.length === 0) {
      return [];
    }

    let logWritten = false;
    let currentSize = index.totalSizeBytes;

    for (const entry of removalCandidates) {
      await this.adapter.removeDirectory(entry.cachePath);
      const sizeBefore = currentSize;
      const removed = this.removeFromIndex(index, entry.pluginId, entry.version);
      if (!removed) {
        continue;
      }

      currentSize = Math.max(0, currentSize - removed.sizeBytes);
      const logEntry: EvictionLogEntry = {
        evictedAt: new Date(),
        pluginId: removed.pluginId,
        version: removed.version,
        reason: EvictionReason.VERSION_LIMIT,
        bytesFreed: removed.sizeBytes,
        wasPinned: removed.pinned,
        cacheSizeBefore: sizeBefore,
        cacheSizeAfter: currentSize,
      };
      this.appendLogEntry(index, logEntry);
      logWritten = true;
    }

    if (logWritten) {
      (index as { lastUpdated: Date }).lastUpdated = new Date();
      await this.persistIndex(index);
    }

    return removalCandidates;
  }

  /**
   * Remove entry from cache index.
   */
  private removeFromIndex(index: CacheIndex, pluginId: string, version: string): CacheEntry | undefined {
    const pluginEntries = index.entries[pluginId];
    if (!pluginEntries) {
      return undefined;
    }

    const entryIndex = pluginEntries.findIndex((entry) => entry.version === version);
    if (entryIndex === -1) {
      return undefined;
    }

    const [entry] = pluginEntries.splice(entryIndex, 1);
    index.totalSizeBytes = Math.max(0, index.totalSizeBytes - entry.sizeBytes);

    if (pluginEntries.length === 0) {
      delete index.entries[pluginId];
    }

    return entry;
  }

  /**
   * Update last access time for an entry.
   */
  private async updateLastAccessTime(pluginId: string, version: string): Promise<void> {
    const index = await this.loadIndex();
    const entries = index.entries[pluginId];

    if (!entries) {
      return;
    }

    const entry = entries.find((e) => e.version === version);
    if (!entry) {
      return;
    }

    (entry as { lastAccessTime: Date }).lastAccessTime = new Date();
    (index as { lastUpdated: Date }).lastUpdated = new Date();

    await this.persistIndex(index);
  }

  /**
   * Update pin status for an entry.
   */
  private async updatePinStatus(pluginId: string, version: string, pinned: boolean): Promise<void> {
    const index = await this.loadIndex();
    const entries = index.entries[pluginId];

    if (!entries) {
      throw new Error(`Plugin ${pluginId} not found in cache`);
    }

    const entry = entries.find((e) => e.version === version);
    if (!entry) {
      throw new Error(`Version ${version} of plugin ${pluginId} not found in cache`);
    }

    (entry as { pinned: boolean }).pinned = pinned;
    (index as { lastUpdated: Date }).lastUpdated = new Date();

    await this.persistIndex(index);
  }

  /**
   * Build the eviction plan using retention and LRU rules.
   */
  private getEvictionPlan(index: CacheIndex): {
    candidates: CacheEntry[];
    pinnedProtected: CacheEntry[];
  } {
    const candidateMap = new Map<string, CacheEntry>();
    const pinnedProtected: CacheEntry[] = [];

    for (const entries of Object.values(index.entries)) {
      if (!entries || entries.length === 0) {
        continue;
      }

      pinnedProtected.push(...entries.filter((entry) => entry.pinned));
      const retentionCandidates = this.getEntriesExceedingLimit(
        entries,
        CacheService.PER_PLUGIN_RETENTION
      );
      const sizeLimitCandidates = this.getEntriesExceedingLimit(
        entries,
        CacheService.MIN_ROLLBACK_SET
      );

      for (const candidate of [...retentionCandidates, ...sizeLimitCandidates]) {
        const key = `${candidate.pluginId}:${candidate.version}`;
        if (!candidateMap.has(key)) {
          candidateMap.set(key, candidate);
        }
      }
    }

    const candidates = Array.from(candidateMap.values()).sort(
      (a, b) => a.lastAccessTime.getTime() - b.lastAccessTime.getTime()
    );

    return { candidates, pinnedProtected };
  }

  /**
   * Determine entries that exceed a limit for a single plugin.
   */
  private getEntriesExceedingLimit(entries: CacheEntry[], limit: number): CacheEntry[] {
    if (!entries || entries.length === 0) {
      return [];
    }

    const pinnedEntries = entries.filter((entry) => entry.pinned);
    let retentionBudget = limit - pinnedEntries.length;
    const explicitCurrent = entries.find((entry) => entry.isCurrentVersion);

    if (explicitCurrent && !explicitCurrent.pinned) {
      retentionBudget -= 1;
    }

    let availableSlots = Math.max(retentionBudget, 0);
    let syntheticCurrentAssigned = Boolean(explicitCurrent);
    const sorted = [...entries].sort((a, b) => this.compareSemver(b.version, a.version));
    const removalCandidates: CacheEntry[] = [];

    for (const entry of sorted) {
      if (entry.pinned) {
        continue;
      }

      if (explicitCurrent && entry === explicitCurrent) {
        continue;
      }

      if (!syntheticCurrentAssigned) {
        syntheticCurrentAssigned = true;
        if (availableSlots > 0) {
          availableSlots--;
        }
        continue;
      }

      if (availableSlots > 0) {
        availableSlots--;
        continue;
      }

      removalCandidates.push(entry);
    }

    return removalCandidates;
  }

  /**
   * Calculate cache statistics from index state.
   */
  private calculateStats(index: CacheIndex): CacheStats {
    const totalSizeBytes = index.totalSizeBytes;
    const totalSizeMb = Math.round((totalSizeBytes / (1024 * 1024)) * 100) / 100;
    const maxSizeMb = this.config.maxCacheSizeMb;
    const maxSizeBytes = Math.max(maxSizeMb, 0) * 1024 * 1024;
    const usagePercent = maxSizeMb > 0
      ? Math.round((totalSizeMb / maxSizeMb) * 100 * 100) / 100
      : 0;

    let totalEntries = 0;
    let pinnedEntries = 0;
    for (const pluginEntries of Object.values(index.entries)) {
      totalEntries += pluginEntries.length;
      pinnedEntries += pluginEntries.filter((entry) => entry.pinned).length;
    }

    return {
      totalSizeBytes,
      totalSizeMb,
      maxSizeMb,
      usagePercent,
      totalEntries,
      pinnedEntries,
      uniquePlugins: Object.keys(index.entries).length,
      nearLimit: usagePercent >= 90,
      overLimit: totalSizeBytes > maxSizeBytes,
      calculatedAt: new Date(),
    };
  }

  /**
   * Create an empty cache index.
   */
  private createEmptyIndex(): CacheIndex {
    return {
      version: '1.0',
      lastUpdated: new Date(),
      totalSizeBytes: 0,
      entries: {},
      evictionLog: [],
    };
  }

  /**
   * Persist index to disk and update cache.
   */
  private async persistIndex(index: CacheIndex): Promise<void> {
    await this.adapter.writeJsonAtomic(this.indexPath, index);
    this.cacheIndexCache = index;
  }

  /**
   * Normalize index loaded from disk (Dates are serialized as strings).
   */
  private normalizeIndex(raw: CacheIndex): CacheIndex {
    const entries: Record<string, CacheEntry[]> = {};

    for (const [pluginId, pluginEntries] of Object.entries(raw.entries || {})) {
      entries[pluginId] = pluginEntries.map((entry) => ({
        ...entry,
        lastAccessTime: this.parseDate(entry.lastAccessTime),
        pinned: Boolean(entry.pinned),
        isCurrentVersion: Boolean(entry.isCurrentVersion),
      }));
    }

    const evictionLog = (raw.evictionLog || []).map((log) => ({
      ...log,
      evictedAt: this.parseDate(log.evictedAt),
    }));

    return {
      ...raw,
      lastUpdated: this.parseDate(raw.lastUpdated),
      entries,
      evictionLog,
    };
  }

  private parseDate(value: unknown): Date {
    if (value instanceof Date) {
      return value;
    }

    const parsed = new Date(value as string);
    return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
  }

  private appendLogEntry(index: CacheIndex, logEntry: EvictionLogEntry): void {
    index.evictionLog.unshift(logEntry);
    if (index.evictionLog.length > 100) {
      index.evictionLog = index.evictionLog.slice(0, 100);
    }
  }

  private compareSemver(a: string, b: string): number {
    const parse = (version: string): [number, number, number] => {
      const parts = version.split('.').map((part) => parseInt(part, 10) || 0);
      return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
    };

    const [aMaj, aMin, aPatch] = parse(a);
    const [bMaj, bMin, bPatch] = parse(b);

    if (aMaj !== bMaj) {
      return aMaj - bMaj;
    }
    if (aMin !== bMin) {
      return aMin - bMin;
    }
    if (aPatch !== bPatch) {
      return aPatch - bPatch;
    }
    return 0;
  }

  /**
   * Generate a unique transaction ID.
   */
  private generateTransactionId(): string {
    return `tx-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}
