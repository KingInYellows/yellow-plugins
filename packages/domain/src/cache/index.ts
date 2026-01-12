/**
 * @yellow-plugins/domain - Cache Module
 *
 * Public API for cache management functionality.
 * Part of Task I2.T2: Cache manager + registry persistence
 */

export { CacheService } from './cacheService.js';
export type { ICacheService, ICacheAdapter } from './contracts.js';
export type {
  CacheEntry,
  CacheIndex,
  CacheOperationOptions,
  CacheOperationResult,
  CachePromotionData,
  CacheStagingData,
  CacheStats,
  EvictionResult,
  EvictionLogEntry,
} from './types.js';
export { EvictionReason } from './types.js';
