/**
 * @yellow-plugins/domain - Changelog Service Implementation
 *
 * Core domain service for changelog fetching with CRIT-008-compliant
 * timeout and fallback logic.
 *
 * Part of Task I3.T2: Changelog-aware update pipeline
 *
 * Architecture References:
 * - CRIT-008: Changelog display with 5-second timeout fallback
 * - Section 3.4: Update Journey with changelog integration
 *
 * @specification docs/SPECIFICATION-PART1-v1.1.md (CRIT-008)
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { Config } from '../config/contracts.js';

import type { IChangelogService, IHttpAdapter } from './contracts.js';
import type {
  ChangelogFetchResult,
  ChangelogFetchOptions,
  ChangelogCache,
  ChangelogCacheEntry,
} from './types.js';
import { ChangelogStatus } from './types.js';

/**
 * Changelog service implementation.
 * Orchestrates changelog fetching with timeout, caching, and graceful degradation.
 */
export class ChangelogService implements IChangelogService {
  private readonly httpAdapter: IHttpAdapter;
  private readonly cacheFilePath: string;
  private cache: ChangelogCache | null = null;

  // CRIT-008 constants
  private readonly DEFAULT_TIMEOUT_MS = 5000;
  private readonly DEFAULT_MAX_CHARS = 1000;
  private readonly CACHE_RETENTION_DAYS = 30;
  private readonly MAX_CACHE_ENTRIES = 100;

  constructor(config: Config, httpAdapter: IHttpAdapter, options?: { cacheFilePath?: string }) {
    this.httpAdapter = httpAdapter;
    this.cacheFilePath = options?.cacheFilePath ?? join(config.pluginDir, 'audit', 'changelog-cache.json');
  }

  /**
   * Fetch changelog with CRIT-008-compliant timeout and fallback logic.
   */
  async fetchChangelog(
    pluginId: string,
    version: string,
    changelogUrl: string | null | undefined,
    options?: ChangelogFetchOptions
  ): Promise<ChangelogFetchResult> {
    const startTime = Date.now();
    const timeoutMs = options?.timeoutMs ?? this.DEFAULT_TIMEOUT_MS;
    const maxContentChars = options?.maxContentChars ?? this.DEFAULT_MAX_CHARS;
    // transactionId available for future telemetry/logging integration

    // CRIT-008 Case 1: docs.changelog is null/missing
    if (!changelogUrl) {
      return {
        status: ChangelogStatus.NOT_PROVIDED,
        displayMessage: 'Changelog not provided by plugin author',
        metadata: {
          timestamp: new Date(),
        },
      };
    }

    // CRIT-008 Case 2: Check cache unless bypassed
    if (!options?.bypassCache) {
      const cachedEntry = await this.getCachedChangelog(pluginId, version);
      if (cachedEntry && cachedEntry.status === ChangelogStatus.SUCCESS) {
        const cacheAge = Date.now() - cachedEntry.lastFetchedAt.getTime();
        // Use cache if < 24 hours old
        if (cacheAge < 24 * 60 * 60 * 1000) {
          return {
            status: ChangelogStatus.CACHED,
            content: cachedEntry.content,
            fullContentLength: cachedEntry.fullContentLength,
            displayMessage: this.truncateContent(cachedEntry.content || '', maxContentChars),
            metadata: {
              url: changelogUrl,
              timestamp: new Date(),
            },
          };
        }
      }
    }

    // CRIT-008 Case 3: Attempt fetch with timeout
    try {
      const fetchResult = await this.fetchWithTimeout(
        () =>
          this.httpAdapter.fetch(changelogUrl, {
            timeoutMs,
            maxContentLength: maxContentChars * 10, // Fetch more than display limit
          }),
        timeoutMs
      );

      const durationMs = Date.now() - startTime;

      // Success case
      if (
        fetchResult.success &&
        fetchResult.status === 200 &&
        fetchResult.content !== undefined
      ) {
        const truncatedContent = this.truncateContent(fetchResult.content, maxContentChars);

        await this.updateCache(pluginId, version, changelogUrl, {
          status: ChangelogStatus.SUCCESS,
          content: fetchResult.content,
          fullContentLength: fetchResult.contentLength || fetchResult.content.length,
          lastFetchedAt: new Date(),
          consecutiveFailures: 0,
          lastHttpStatus: 200,
        });

        return {
          status: ChangelogStatus.SUCCESS,
          content: fetchResult.content,
          fullContentLength: fetchResult.contentLength,
          displayMessage: truncatedContent,
          metadata: {
            url: changelogUrl,
            durationMs,
            httpStatus: 200,
            timestamp: new Date(),
          },
        };
      }

      // HTTP 404 - Not Found
      if (fetchResult.status === 404) {
        await this.updateCacheFailure(pluginId, version, changelogUrl, 404);

        return {
          status: ChangelogStatus.NOT_FOUND,
          displayMessage: 'Changelog unavailable (not found)',
          metadata: {
            url: changelogUrl,
            durationMs,
            httpStatus: 404,
            timestamp: new Date(),
          },
        };
      }

      // HTTP 403/500/5xx - Server Error
      if (fetchResult.status >= 400) {
        await this.updateCacheFailure(pluginId, version, changelogUrl, fetchResult.status);

        return {
          status: ChangelogStatus.SERVER_ERROR,
          displayMessage: 'Changelog unavailable (server error)',
          metadata: {
            url: changelogUrl,
            durationMs,
            httpStatus: fetchResult.status,
            timestamp: new Date(),
          },
        };
      }

      // Generic failure
      await this.updateCacheFailure(pluginId, version, changelogUrl, fetchResult.status);

      return {
        status: ChangelogStatus.NETWORK_ERROR,
        displayMessage: 'Changelog unavailable (network error)',
        metadata: {
          url: changelogUrl,
          durationMs,
          httpStatus: fetchResult.status,
          timestamp: new Date(),
        },
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;

      // Timeout case (durationMs >= timeoutMs)
      const timedOut = (error as Error).message === 'FETCH_TIMEOUT';
      if (timedOut || durationMs >= timeoutMs - 100) {
        // 100ms buffer for processing
        await this.updateCacheFailure(pluginId, version, changelogUrl, 0);

        return {
          status: ChangelogStatus.TIMEOUT,
          displayMessage: 'Changelog unavailable (network error)',
          metadata: {
            url: changelogUrl,
            durationMs: timedOut ? timeoutMs : durationMs,
            timestamp: new Date(),
          },
        };
      }

      // Other network errors
      await this.updateCacheFailure(pluginId, version, changelogUrl, 0);

      return {
        status: ChangelogStatus.NETWORK_ERROR,
        displayMessage: 'Changelog unavailable (network error)',
        metadata: {
          url: changelogUrl,
          durationMs,
          timestamp: new Date(),
        },
      };
    }
  }

  /**
   * Get cached changelog entry.
   */
  async getCachedChangelog(pluginId: string, version: string): Promise<ChangelogCacheEntry | undefined> {
    await this.ensureCacheLoaded();
    const key = `${pluginId}@${version}`;
    return this.cache?.entries[key];
  }

  /**
   * Invalidate cache entry.
   */
  async invalidateCache(pluginId: string, version: string): Promise<void> {
    await this.ensureCacheLoaded();
    if (!this.cache) return;

    const key = `${pluginId}@${version}`;
    delete this.cache.entries[key];
    await this.persistCache();
  }

  /**
   * Get entire changelog cache.
   */
  async getCache(): Promise<ChangelogCache> {
    await this.ensureCacheLoaded();
    return (
      this.cache || {
        version: '1.0.0',
        lastUpdated: new Date(),
        entries: {},
      }
    );
  }

  /**
   * Prune old cache entries.
   */
  async pruneCache(): Promise<number> {
    await this.ensureCacheLoaded();
    if (!this.cache) return 0;

    const now = Date.now();
    const retentionMs = this.CACHE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    let prunedCount = 0;

    // Remove entries older than retention period
    for (const [key, entry] of Object.entries(this.cache.entries)) {
      const age = now - entry.lastFetchedAt.getTime();
      if (age > retentionMs) {
        delete this.cache.entries[key];
        prunedCount++;
      }
    }

    // If still over max entries, remove oldest
    const sortedEntries = Object.entries(this.cache.entries).sort(
      ([, a], [, b]) => a.lastFetchedAt.getTime() - b.lastFetchedAt.getTime()
    );

    while (sortedEntries.length > this.MAX_CACHE_ENTRIES) {
      const [key] = sortedEntries.shift()!;
      delete this.cache.entries[key];
      prunedCount++;
    }

    if (prunedCount > 0) {
      this.cache.lastUpdated = new Date();
      await this.persistCache();
    }

    return prunedCount;
  }

  // Private helper methods

  /**
   * Truncate content to max characters with ellipsis.
   */
  private truncateContent(content: string, maxChars: number): string {
    if (content.length <= maxChars) {
      return content;
    }
    return content.substring(0, maxChars) + '...';
  }

  /**
   * Update cache with successful fetch.
   */
  private async updateCache(
    pluginId: string,
    version: string,
    url: string,
    data: {
      status: ChangelogStatus;
      content?: string;
      fullContentLength?: number;
      lastFetchedAt: Date;
      consecutiveFailures: number;
      lastHttpStatus?: number;
    }
  ): Promise<void> {
    await this.ensureCacheLoaded();
    if (!this.cache) {
      this.cache = this.createEmptyCache();
    }

    const key = `${pluginId}@${version}`;
    this.cache.entries[key] = {
      pluginId,
      version,
      url,
      ...data,
    };

    this.cache.lastUpdated = new Date();
    await this.persistCache();
  }

  /**
   * Update cache with fetch failure.
   */
  private async updateCacheFailure(
    pluginId: string,
    version: string,
    url: string,
    httpStatus: number
  ): Promise<void> {
    const existing = await this.getCachedChangelog(pluginId, version);
    const consecutiveFailures = (existing?.consecutiveFailures ?? 0) + 1;

    let status = ChangelogStatus.NETWORK_ERROR;
    if (httpStatus === 404) {
      status = ChangelogStatus.NOT_FOUND;
    } else if (httpStatus >= 400) {
      status = ChangelogStatus.SERVER_ERROR;
    }

    await this.updateCache(pluginId, version, url, {
      status,
      lastFetchedAt: new Date(),
      consecutiveFailures,
      lastHttpStatus: httpStatus || undefined,
    });
  }

  /**
   * Ensure cache is loaded from disk.
   */
  private async ensureCacheLoaded(): Promise<void> {
    if (this.cache !== null) return;

    try {
      const serialized = await readFile(this.cacheFilePath, 'utf-8');
      const parsed = JSON.parse(serialized) as SerializedChangelogCache;
      this.cache = this.deserializeCache(parsed);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        console.warn('Failed to read changelog cache, starting fresh', error);
      }
      this.cache = this.createEmptyCache();
    }
  }

  /**
   * Persist cache to disk.
   */
  private async persistCache(): Promise<void> {
    if (!this.cache) return;

    try {
      await mkdir(dirname(this.cacheFilePath), { recursive: true });
      const tempPath = `${this.cacheFilePath}.tmp`;
      const serialized = JSON.stringify(this.serializeCache(this.cache), null, 2);
      await writeFile(tempPath, serialized, 'utf-8');
      await rename(tempPath, this.cacheFilePath);
    } catch (error) {
      console.error('Failed to persist changelog cache:', error);
    }
  }

  private createEmptyCache(): ChangelogCache {
    return {
      version: '1.0.0',
      lastUpdated: new Date(),
      entries: {},
    };
  }

  private serializeCache(cache: ChangelogCache): SerializedChangelogCache {
    const entries = Object.fromEntries(
      Object.entries(cache.entries).map(([key, entry]) => [
        key,
        {
          ...entry,
          lastFetchedAt: entry.lastFetchedAt.toISOString(),
        },
      ])
    );

    return {
      version: cache.version,
      lastUpdated: cache.lastUpdated.toISOString(),
      entries,
    };
  }

  private deserializeCache(cache: SerializedChangelogCache): ChangelogCache {
    const entries = Object.fromEntries(
      Object.entries(cache.entries).map(([key, entry]) => [
        key,
        {
          ...entry,
          lastFetchedAt: new Date(entry.lastFetchedAt),
        },
      ])
    );

    return {
      version: cache.version,
      lastUpdated: new Date(cache.lastUpdated),
      entries,
    };
  }

  private async fetchWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    const effectiveTimeout = Math.max(timeoutMs - 50, 0);
    if (!timeoutMs || effectiveTimeout <= 0) {
      return operation();
    }

    const fetchPromise = operation();
    let timeoutHandle: NodeJS.Timeout | undefined;
    let timedOut = false;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        reject(new Error('FETCH_TIMEOUT'));
      }, effectiveTimeout);
    });

    try {
      return await Promise.race([fetchPromise, timeoutPromise]);
    } catch (error) {
      if (timedOut) {
        void fetchPromise.catch(() => undefined);
      }
      throw error;
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }
}

interface SerializedChangelogCacheEntry {
  pluginId: string;
  version: string;
  url: string;
  status: ChangelogStatus;
  content?: string;
  fullContentLength?: number;
  lastFetchedAt: string;
  consecutiveFailures: number;
  lastHttpStatus?: number;
}

interface SerializedChangelogCache {
  version: string;
  lastUpdated: string;
  entries: Record<string, SerializedChangelogCacheEntry>;
}
