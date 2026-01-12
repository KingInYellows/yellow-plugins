/**
 * @yellow-plugins/domain - Changelog Service Contracts
 *
 * Domain interface for changelog fetching with timeout/fallback logic.
 * Implements CRIT-008 requirements.
 *
 * Part of Task I3.T2: Changelog-aware update pipeline
 *
 * @specification docs/SPECIFICATION-PART1-v1.1.md (CRIT-008)
 */

import type {
  ChangelogFetchResult,
  ChangelogFetchOptions,
  ChangelogCache,
  ChangelogCacheEntry,
} from './types.js';

/**
 * Changelog service interface for domain operations.
 * Handles changelog retrieval with CRIT-008-compliant timeouts and fallbacks.
 */
export interface IChangelogService {
  /**
   * Fetch changelog for a plugin version.
   * Implements 5-second timeout with graceful degradation per CRIT-008.
   *
   * @param pluginId - Plugin identifier
   * @param version - Plugin version
   * @param changelogUrl - Changelog URL from plugin.json docs.changelog
   * @param options - Fetch options (timeout, cache bypass, etc.)
   * @returns Changelog fetch result with status and display message
   */
  fetchChangelog(
    pluginId: string,
    version: string,
    changelogUrl: string | null | undefined,
    options?: ChangelogFetchOptions
  ): Promise<ChangelogFetchResult>;

  /**
   * Get cached changelog entry.
   *
   * @param pluginId - Plugin identifier
   * @param version - Plugin version
   * @returns Cached changelog entry or undefined
   */
  getCachedChangelog(pluginId: string, version: string): Promise<ChangelogCacheEntry | undefined>;

  /**
   * Invalidate cache entry for a plugin version.
   *
   * @param pluginId - Plugin identifier
   * @param version - Plugin version
   */
  invalidateCache(pluginId: string, version: string): Promise<void>;

  /**
   * Get entire changelog cache.
   * Useful for debugging and analytics.
   */
  getCache(): Promise<ChangelogCache>;

  /**
   * Prune old cache entries (> 30 days or > 100 entries).
   * Returns number of entries pruned.
   */
  pruneCache(): Promise<number>;
}

/**
 * HTTP adapter interface for changelog fetching.
 * Injected into ChangelogService to maintain clean architecture.
 */
export interface IHttpAdapter {
  /**
   * Fetch content from URL with timeout.
   *
   * @param url - URL to fetch
   * @param options - Fetch options
   * @returns Response with content, status, and headers
   */
  fetch(
    url: string,
    options: {
      timeoutMs: number;
      maxContentLength?: number;
    }
  ): Promise<{
    success: boolean;
    status: number;
    content?: string;
    contentLength?: number;
    error?: string;
  }>;
}
