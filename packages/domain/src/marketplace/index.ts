/**
 * @yellow-plugins/domain - Marketplace Module
 *
 * Exports marketplace discovery contracts, types, and services.
 * Part of Task I3.T1: Marketplace ingestion & caching implementation.
 *
 * @specification FR-001, FR-002
 */

export type {
  IMarketplaceIndexService,
} from './contracts.js';

export type {
  MarketplaceMetadata,
  PluginEntry,
  PluginCategory,
  MarketplaceIndex,
  MarketplaceQuery,
  MarketplaceSortOrder,
  MarketplaceQueryResult,
  IndexFreshnessStatus,
} from './types.js';

export {
  MarketplaceIndexService,
} from './indexService.js';
