/**
 * @yellow-plugins/domain - Marketplace Contracts
 *
 * Service interfaces for marketplace index operations.
 * Part of Task I3.T1: Marketplace ingestion & caching implementation.
 *
 * @specification Section 2 (Data Models), FR-001, FR-002
 */

import type {
  IndexFreshnessStatus,
  MarketplaceIndex,
  MarketplaceQuery,
  MarketplaceQueryResult,
  PluginEntry,
} from './types.js';

/**
 * Marketplace index service interface
 *
 * Handles loading, validating, and querying the marketplace index.
 * Implements offline-first caching with staleness detection.
 */
export interface IMarketplaceIndexService {
  /**
   * Load and validate marketplace index from cache
   *
   * @param indexPath - Path to marketplace.json file
   * @returns Validated marketplace index
   * @throws Error if index missing or validation fails
   */
  loadIndex(indexPath: string): Promise<MarketplaceIndex>;

  /**
   * Check index freshness and validation status
   *
   * @param indexPath - Path to marketplace.json file
   * @returns Freshness status with validation results
   */
  checkFreshness(indexPath: string): Promise<IndexFreshnessStatus>;

  /**
   * Browse plugins with filters and deterministic sorting
   *
   * @param query - Filter criteria
   * @returns Filtered and sorted plugin list
   */
  browse(query: MarketplaceQuery): Promise<MarketplaceQueryResult>;

  /**
   * Search plugins by text query
   *
   * @param query - Search criteria with text query
   * @returns Matching plugins with deterministic sorting
   */
  search(query: MarketplaceQuery): Promise<MarketplaceQueryResult>;

  /**
   * Get detailed information for a specific plugin
   *
   * @param pluginId - Plugin identifier
   * @returns Plugin entry or null if not found
   */
  getPluginInfo(pluginId: string): Promise<PluginEntry | null>;

  /**
   * Get all plugins matching a category
   *
   * @param category - Plugin category
   * @returns Plugins in category with deterministic sorting
   */
  getByCategory(category: string): Promise<PluginEntry[]>;

  /**
   * Get all plugins matching a tag
   *
   * @param tag - Plugin tag
   * @returns Plugins with tag with deterministic sorting
   */
  getByTag(tag: string): Promise<PluginEntry[]>;
}
