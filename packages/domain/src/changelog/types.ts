/**
 * @yellow-plugins/domain - Changelog Types
 *
 * Type definitions for changelog retrieval and metadata caching.
 * Implements CRIT-008 fallback requirements.
 *
 * Part of Task I3.T2: Changelog-aware update pipeline
 *
 * @specification docs/SPECIFICATION-PART1-v1.1.md (CRIT-008)
 */

/**
 * Changelog fetch result status.
 * Maps to CRIT-008 fallback scenarios.
 */
export enum ChangelogStatus {
  /** Changelog successfully fetched */
  SUCCESS = 'success',
  /** Changelog URL not provided by plugin author */
  NOT_PROVIDED = 'not-provided',
  /** Network timeout (5-second limit exceeded) */
  TIMEOUT = 'timeout',
  /** HTTP 404 - changelog not found */
  NOT_FOUND = 'not-found',
  /** HTTP 403/500/5xx - server error */
  SERVER_ERROR = 'server-error',
  /** Network unreachable or DNS failure */
  NETWORK_ERROR = 'network-error',
  /** Cached from previous successful fetch */
  CACHED = 'cached',
}

/**
 * Changelog fetch result with content or fallback message.
 */
export interface ChangelogFetchResult {
  /** Fetch status */
  status: ChangelogStatus;

  /** Changelog content (up to 1000 chars, only for SUCCESS/CACHED) */
  content?: string;

  /** Full content length in bytes (if available) */
  fullContentLength?: number;

  /** Human-readable message for CLI display */
  displayMessage: string;

  /** Metadata for telemetry */
  metadata: {
    /** URL attempted (if any) */
    url?: string;

    /** Fetch duration in milliseconds */
    durationMs?: number;

    /** HTTP status code (if applicable) */
    httpStatus?: number;

    /** Timestamp of fetch attempt */
    timestamp: Date;
  };
}

/**
 * Changelog metadata cache entry.
 * Persisted to .claude-plugin/audit/changelog-cache.json.
 */
export interface ChangelogCacheEntry {
  /** Plugin identifier */
  pluginId: string;

  /** Plugin version */
  version: string;

  /** Changelog URL */
  url: string;

  /** Last successful fetch status */
  status: ChangelogStatus;

  /** Cached content (up to 1000 chars, only for SUCCESS) */
  content?: string;

  /** Full content length */
  fullContentLength?: number;

  /** Last successful fetch timestamp */
  lastFetchedAt: Date;

  /** Number of consecutive fetch failures */
  consecutiveFailures: number;

  /** HTTP status from last fetch */
  lastHttpStatus?: number;
}

/**
 * Changelog metadata cache index.
 */
export interface ChangelogCache {
  /** Format version */
  version: string;

  /** Last updated timestamp */
  lastUpdated: Date;

  /** Cache entries indexed by pluginId@version */
  entries: Record<string, ChangelogCacheEntry>;
}

/**
 * Changelog fetch options.
 */
export interface ChangelogFetchOptions {
  /** Timeout in milliseconds (default: 5000) */
  timeoutMs?: number;

  /** Force fresh fetch, bypass cache */
  bypassCache?: boolean;

  /** Maximum content length to fetch (default: 1000 chars) */
  maxContentChars?: number;

  /** Transaction ID for correlation */
  transactionId?: string;
}
