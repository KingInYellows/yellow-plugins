/**
 * @yellow-plugins/domain - Marketplace Types
 *
 * Type definitions for marketplace discovery and plugin metadata.
 * Part of Task I3.T1: Marketplace ingestion & caching implementation.
 *
 * @specification Section 2 (Data Models), FR-001, FR-002
 */

/**
 * Marketplace metadata from marketplace.json
 */
export interface MarketplaceMetadata {
  name: string;
  author: string;
  description?: string;
  url?: string;
  updatedAt: string;
}

/**
 * Plugin reference from marketplace index
 *
 * Lightweight entry that references full plugin manifest at source path.
 * Used for discovery, browse, search operations.
 */
export interface PluginEntry {
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  source: string;
  category: PluginCategory;
  tags?: string[];
  featured?: boolean;
  verified?: boolean;
  downloads?: number;
  updatedAt?: string;
}

/**
 * Official plugin categories
 */
export type PluginCategory =
  | 'development'
  | 'productivity'
  | 'security'
  | 'learning'
  | 'testing'
  | 'design'
  | 'database'
  | 'deployment'
  | 'monitoring';

/**
 * Complete marketplace index structure
 */
export interface MarketplaceIndex {
  schemaVersion: string;
  marketplace: MarketplaceMetadata;
  plugins: PluginEntry[];

  /** Optional metadata for cache validation */
  _meta?: {
    /** Hash of plugin array for staleness detection */
    contentHash?: string;
    /** Signature for tamper detection */
    signature?: string;
    /** Generator version that created this index */
    generatorVersion?: string;
  };
}

/**
 * Query filters for browse/search operations
 */
export interface MarketplaceQuery {
  /** Text query for search operations */
  query?: string;
  /** Filter by category */
  category?: PluginCategory;
  /** Filter by tag */
  tag?: string;
  /** Show only featured plugins */
  featured?: boolean;
  /** Show only verified plugins */
  verified?: boolean;
  /** Maximum results to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Exact match only (no fuzzy search) */
  exact?: boolean;
}

/**
 * Sort order for marketplace results
 */
export interface MarketplaceSortOrder {
  /** Primary: category (case-insensitive) */
  category: 'asc' | 'desc';
  /** Secondary: plugin name (case-insensitive) */
  name: 'asc' | 'desc';
  /** Tertiary: semantic version (descending) */
  version: 'asc' | 'desc';
}

/**
 * Result of marketplace query operations
 */
export interface MarketplaceQueryResult {
  /** Matching plugin entries */
  plugins: PluginEntry[];
  /** Total count before limit/offset */
  totalCount: number;
  /** Query that produced these results */
  query: MarketplaceQuery;
  /** Warnings (e.g., stale index, missing data) */
  warnings?: string[];
}

/**
 * Index freshness status
 */
export interface IndexFreshnessStatus {
  /** Whether index exists */
  exists: boolean;
  /** Whether index passed validation */
  valid: boolean;
  /** Whether index is stale (needs refresh) */
  stale: boolean;
  /** Last update timestamp if available */
  lastUpdated?: Date;
  /** Age in milliseconds if available */
  ageMs?: number;
  /** Validation errors if any */
  validationErrors?: string[];
  /** Signature/hash validation status */
  integrityStatus?: 'valid' | 'invalid' | 'missing';
  /** Cryptographic signature validation status */
  signatureStatus?: 'valid' | 'invalid' | 'missing';
}
