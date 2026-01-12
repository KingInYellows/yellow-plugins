/**
 * @yellow-plugins/domain - Cache Service Contracts
 *
 * Domain interfaces for cache management operations.
 * Defines the contract between domain logic and infrastructure adapters.
 *
 * Part of Task I2.T2: Cache manager + registry persistence
 */

import type {
  CacheEntry,
  CacheIndex,
  CacheOperationOptions,
  CacheOperationResult,
  CachePromotionData,
  CacheStagingData,
  CacheStats,
  EvictionResult,
} from './types.js';

/**
 * Cache service interface for domain operations.
 * Orchestrates cache management, eviction, and artifact storage.
 */
export interface ICacheService {
  /**
   * Get current cache statistics.
   */
  getStats(): CacheStats;

  /**
   * Get cache entry for a specific plugin version.
   * Returns undefined if not cached.
   */
  getEntry(pluginId: string, version: string): CacheEntry | undefined;

  /**
   * List all cached entries for a plugin.
   * Returns empty array if plugin not cached.
   */
  listEntries(pluginId: string): CacheEntry[];

  /**
   * Stage artifacts for caching (download to temp directory).
   * Returns staging path and transaction ID.
   */
  stageArtifacts(
    pluginId: string,
    version: string,
    options?: CacheOperationOptions
  ): Promise<CacheOperationResult<CacheStagingData>>;

  /**
   * Promote staged artifacts to cache (atomic move from staging to cache).
   * Triggers eviction if cache exceeds limits.
   */
  promoteArtifacts(
    pluginId: string,
    version: string,
    stagingPath: string,
    options?: CacheOperationOptions
  ): Promise<CacheOperationResult<CachePromotionData>>;

  /**
   * Retrieve cached artifacts for a plugin version.
   * Updates last access time for LRU tracking.
   */
  retrieveArtifacts(
    pluginId: string,
    version: string,
    options?: CacheOperationOptions
  ): Promise<CacheOperationResult<string>>;

  /**
   * Mark a plugin version as pinned (protected from eviction).
   */
  pinVersion(pluginId: string, version: string): Promise<void>;

  /**
   * Unpin a plugin version.
   */
  unpinVersion(pluginId: string, version: string): Promise<void>;

  /**
   * Run cache eviction based on size and retention policies.
   * Returns eviction result with freed space details.
   */
  evictCache(options?: CacheOperationOptions): Promise<EvictionResult>;

  /**
   * Clean up orphaned temporary directories left by crashes.
   * Returns number of directories cleaned.
   */
  cleanupOrphanedTemp(): Promise<number>;

  /**
   * Rebuild cache index from filesystem state.
   * Useful after corruption or manual filesystem changes.
   */
  rebuildIndex(): Promise<CacheIndex>;

  /**
   * Validate cache integrity (checksums, directory structure).
   * Returns list of corrupted entries.
   */
  validateIntegrity(): Promise<CacheEntry[]>;
}

/**
 * Infrastructure adapter interface for cache filesystem operations.
 * Injected into CacheService to maintain clean architecture.
 */
export interface ICacheAdapter {
  /**
   * Ensure a directory exists, creating it if necessary.
   */
  ensureDirectory(path: string): Promise<void>;

  /**
   * Calculate total size of a directory in bytes.
   */
  calculateDirectorySize(path: string): Promise<number>;

  /**
   * List all entries in a directory.
   * Returns array of { name, path, isDirectory, size, mtime }.
   */
  listDirectory(
    path: string
  ): Promise<Array<{ name: string; path: string; isDirectory: boolean; size: number; mtime: Date }>>;

  /**
   * Check if a path exists.
   */
  exists(path: string): Promise<boolean>;

  /**
   * Remove a directory recursively.
   */
  removeDirectory(path: string): Promise<void>;

  /**
   * Move/rename a directory atomically.
   */
  moveDirectory(source: string, destination: string): Promise<void>;

  /**
   * Write JSON file with atomic temp-rename pattern.
   */
  writeJsonAtomic<T>(path: string, data: T): Promise<void>;

  /**
   * Read and parse JSON file.
   * Returns undefined if file doesn't exist.
   */
  readJson<T>(path: string): Promise<T | undefined>;

  /**
   * Calculate checksum (SHA-256) for a directory.
   */
  calculateChecksum(path: string): Promise<string>;

  /**
   * Touch a file to update its access time.
   */
  touchFile(path: string): Promise<void>;

  /**
   * Create a temporary directory with unique ID.
   * Returns absolute path to temp directory.
   */
  createTempDirectory(prefix: string): Promise<string>;

  /**
   * List all temporary directories matching a pattern.
   */
  listTempDirectories(pattern: string): Promise<string[]>;
}
