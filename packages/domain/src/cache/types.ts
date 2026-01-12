/**
 * @yellow-plugins/domain - Cache Management Types
 *
 * Domain types for cache management, eviction policies, and artifact storage.
 * Implements the LRU eviction algorithm with per-plugin version retention and
 * global size limits.
 *
 * Part of Task I2.T2: Cache manager + registry persistence
 *
 * Architecture References:
 * - Section 3.4: Data Persistence & Cache Layout
 * - Section 2: Cache & Storage Manager responsibilities
 * - CRIT-002: Cache eviction policy (500MB, last-3-versions)
 */

/**
 * Cache entry metadata for a specific plugin version.
 */
export interface CacheEntry {
  /**
   * Plugin identifier (matches InstalledPlugin.pluginId)
   */
  readonly pluginId: string;

  /**
   * Semantic version string
   */
  readonly version: string;

  /**
   * Absolute path to cached artifacts directory
   * Format: `<pluginDir>/cache/<pluginId>/<version>/`
   */
  readonly cachePath: string;

  /**
   * Size in bytes of this cache entry
   */
  readonly sizeBytes: number;

  /**
   * Last access timestamp for LRU tracking
   */
  readonly lastAccessTime: Date;

  /**
   * Whether this version is pinned (protected from eviction)
   */
  readonly pinned: boolean;

  /**
   * Whether this is the currently active version
   */
  readonly isCurrentVersion: boolean;

  /**
   * Checksum for integrity validation (SHA-256)
   */
  readonly checksum?: string;
}

/**
 * Result of a cache eviction operation.
 */
export interface EvictionResult {
  /**
   * Whether eviction was necessary
   */
  readonly evictionTriggered: boolean;

  /**
   * Total bytes freed by eviction
   */
  readonly bytesFreed: number;

  /**
   * Number of cache entries evicted
   */
  readonly entriesEvicted: number;

  /**
   * Cache entries that were evicted
   */
  readonly evictedEntries: CacheEntry[];

  /**
   * Cache size before eviction
   */
  readonly sizeBefore: number;

  /**
   * Cache size after eviction
   */
  readonly sizeAfter: number;

  /**
   * Timestamp of eviction operation
   */
  readonly evictedAt: Date;

  /**
   * Reason for eviction (over limit, manual cleanup, etc.)
   */
  readonly reason: EvictionReason;
}

/**
 * Reason for cache eviction.
 */
export enum EvictionReason {
  /**
   * Cache exceeded size limit
   */
  SIZE_LIMIT = 'SIZE_LIMIT',

  /**
   * Exceeded per-plugin version retention limit
   */
  VERSION_LIMIT = 'VERSION_LIMIT',

  /**
   * Entry skipped to honor pin protection
   */
  PIN_PROTECTED = 'PIN_PROTECTED',

  /**
   * Manual cleanup requested
   */
  MANUAL_CLEANUP = 'MANUAL_CLEANUP',

  /**
   * Orphaned temp directories cleanup
   */
  ORPHANED_TEMP = 'ORPHANED_TEMP',

  /**
   * Corrupted cache entry detected
   */
  CORRUPTION = 'CORRUPTION',
}

/**
 * Cache statistics and health information.
 */
export interface CacheStats {
  /**
   * Total cache size in bytes
   */
  readonly totalSizeBytes: number;

  /**
   * Total cache size in MB (rounded to 2 decimals)
   */
  readonly totalSizeMb: number;

  /**
   * Maximum allowed cache size in MB
   */
  readonly maxSizeMb: number;

  /**
   * Percentage of cache limit used (0-100)
   */
  readonly usagePercent: number;

  /**
   * Total number of cached entries
   */
  readonly totalEntries: number;

  /**
   * Number of pinned entries
   */
  readonly pinnedEntries: number;

  /**
   * Number of unique plugins in cache
   */
  readonly uniquePlugins: number;

  /**
   * Whether cache is approaching limit (>90%)
   */
  readonly nearLimit: boolean;

  /**
   * Whether cache is over limit
   */
  readonly overLimit: boolean;

  /**
   * When stats were calculated
   */
  readonly calculatedAt: Date;
}

/**
 * Options for cache operations.
 */
export interface CacheOperationOptions {
  /**
   * Transaction ID for tracing/auditing
   */
  readonly transactionId?: string;

  /**
   * Whether to force operation even if validation fails
   */
  readonly force?: boolean;

  /**
   * Whether to skip eviction after operation
   */
  readonly skipEviction?: boolean;

  /**
   * Telemetry context for logging
   */
  readonly telemetryContext?: Record<string, unknown>;
}

/**
 * Result of a cache operation (stage, promote, retrieve).
 */
export interface CacheOperationResult<T = void> {
  /**
   * Whether operation succeeded
   */
  readonly success: boolean;

  /**
   * Result data (operation-specific)
   */
  readonly data?: T;

  /**
   * Error details if operation failed
   */
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
  };

  /**
   * Operation metadata
   */
  readonly metadata: {
    readonly operationType: string;
    readonly transactionId?: string;
    readonly durationMs: number;
    readonly timestamp: Date;
  };
}

/**
 * Cache staging operation result data.
 */
export interface CacheStagingData {
  /**
   * Path to staging directory
   */
  readonly stagingPath: string;

  /**
   * Transaction ID for this staging operation
   */
  readonly transactionId: string;
}

/**
 * Cache promotion operation result data.
 */
export interface CachePromotionData {
  /**
   * Path to final cache location
   */
  readonly cachePath: string;

  /**
   * Checksum of promoted artifacts
   */
  readonly checksum: string;

  /**
   * Size of promoted artifacts in bytes
   */
  readonly sizeBytes: number;

  /**
   * Whether eviction was triggered after promotion
   */
  readonly evictionTriggered: boolean;
}

/**
 * Cache index metadata structure.
 * Stored in `.claude-plugin/cache/index.json`.
 */
export interface CacheIndex {
  /**
   * Cache index version for migration support
   */
  readonly version: string;

  /**
   * Last updated timestamp
   */
  readonly lastUpdated: Date;

  /**
   * Total cache size in bytes
   */
  readonly totalSizeBytes: number;

  /**
   * Cache entries indexed by pluginId
   */
  readonly entries: Record<string, CacheEntry[]>;

  /**
   * Eviction log (last 100 operations)
   */
  readonly evictionLog: EvictionLogEntry[];
}

/**
 * Single eviction log entry for auditing.
 */
export interface EvictionLogEntry {
  /**
   * When eviction occurred
   */
  readonly evictedAt: Date;

  /**
   * Plugin ID that was evicted
   */
  readonly pluginId: string;

  /**
   * Version that was evicted
   */
  readonly version: string;

  /**
   * Reason for eviction
   */
  readonly reason: EvictionReason;

  /**
   * Size freed in bytes
   */
  readonly bytesFreed: number;

  /**
   * Whether entry was pinned (should log warning if true)
   */
  readonly wasPinned: boolean;

  /**
   * Cache size before/after eviction
   */
  readonly cacheSizeBefore: number;
  readonly cacheSizeAfter: number;
}
