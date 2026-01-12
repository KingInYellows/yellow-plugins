/**
 * @yellow-plugins/domain - Changelog Module
 *
 * Entry point for changelog service exports.
 * Part of Task I3.T2: Changelog-aware update pipeline
 */

export { ChangelogService } from './changelogService.js';
export type { IChangelogService, IHttpAdapter } from './contracts.js';
export type {
  ChangelogFetchResult,
  ChangelogFetchOptions,
  ChangelogCache,
  ChangelogCacheEntry,
} from './types.js';
export { ChangelogStatus } from './types.js';
