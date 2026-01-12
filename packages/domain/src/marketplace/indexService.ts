/**
 * @yellow-plugins/domain - Marketplace Index Service
 *
 * Implements marketplace discovery operations with deterministic ranking,
 * cache validation, and offline-first behavior.
 *
 * Part of Task I3.T1: Marketplace ingestion & caching implementation.
 *
 * @specification FR-001, FR-002, Section 1.4 (Key Assumptions)
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';

import * as semver from 'semver';

import type { IValidator } from '../validation/index.js';
import { ValidationStatus } from '../validation/index.js';

import type { IMarketplaceIndexService } from './contracts.js';
import type {
  IndexFreshnessStatus,
  MarketplaceIndex,
  MarketplaceQuery,
  MarketplaceQueryResult,
  PluginEntry,
} from './types.js';

/**
 * Default staleness threshold (24 hours)
 */
const DEFAULT_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/**
 * Marketplace index service implementation
 *
 * Provides deterministic discovery operations with cache validation:
 * - Loads and validates marketplace.json using AJV schema
 * - Detects stale indexes via timestamp comparison
 * - Applies deterministic sorting: category → name → version (desc)
 * - Filters plugins by category, tag, featured, verified flags
 * - Supports text search with exact and fuzzy matching
 *
 * @example
 * ```typescript
 * const service = new MarketplaceIndexService(validator, logger);
 * await service.loadIndex('.claude-plugin/marketplace.json');
 *
 * const result = await service.browse({ category: 'development', limit: 10 });
 * console.log(result.plugins); // Sorted by category → name → version
 * ```
 */
export class MarketplaceIndexService implements IMarketplaceIndexService {
  private cachedIndex: MarketplaceIndex | null = null;
  private cachedIndexPath: string | null = null;
  private cachedIndexTimestamp: number | null = null;

  constructor(
    private readonly validator: IValidator,
    private readonly logger?: { debug?: (msg: string, ctx?: unknown) => void; warn?: (msg: string, ctx?: unknown) => void },
    private readonly staleThresholdMs: number = DEFAULT_STALE_THRESHOLD_MS
  ) {}

  /**
   * Load and validate marketplace index from cache
   */
  async loadIndex(indexPath: string): Promise<MarketplaceIndex> {
    // Return cached index if same path
    if (this.cachedIndex && this.cachedIndexPath === indexPath) {
      this.logger?.debug?.('Using cached marketplace index', { path: indexPath });
      return this.cachedIndex;
    }

    this.logger?.debug?.('Loading marketplace index', { path: indexPath });

    // Read file
    let content: string;
    try {
      content = await fs.readFile(indexPath, 'utf-8');
    } catch (error) {
      throw new Error(
        `Failed to read marketplace index at ${indexPath}: ${(error as Error).message}. ` +
        'Run the marketplace generator to create the index.'
      );
    }

    // Parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw new Error(
        `Failed to parse marketplace index at ${indexPath}: ${(error as Error).message}`
      );
    }

    // Validate schema
    const validationResult = this.validator.validateMarketplace(parsed);
    if (validationResult.status === ValidationStatus.ERROR) {
      const errorMessages = validationResult.errors.map(e => `${e.path}: ${e.message}`).join('; ');
      throw new Error(
        `Marketplace index validation failed: ${errorMessages}. ` +
        'Ensure the index matches schemas/marketplace.schema.json.'
      );
    }

    const index = parsed as MarketplaceIndex;

    // Check freshness
    const stats = await fs.stat(indexPath);
    const ageMs = Date.now() - stats.mtimeMs;
    if (ageMs > this.staleThresholdMs) {
      this.logger?.warn?.('Marketplace index is stale', {
        path: indexPath,
        ageMs,
        thresholdMs: this.staleThresholdMs,
        lastModified: stats.mtime.toISOString(),
      });
    }

    const computedHash = this.computeContentHash(index.plugins);

    // Verify content hash if present
    if (index._meta?.contentHash) {
      if (computedHash !== index._meta.contentHash) {
        this.logger?.warn?.('Marketplace index content hash mismatch', {
          expected: index._meta.contentHash,
          actual: computedHash,
        });
      }
    }

    // Verify signature if present
    if (index._meta?.signature) {
      const expectedSignature = this.computeSignature(index, computedHash);
      if (expectedSignature !== index._meta.signature) {
        this.logger?.warn?.('Marketplace index signature mismatch', {
          expected: index._meta.signature,
          actual: expectedSignature,
        });
      }
    }

    // Cache the loaded index
    this.cachedIndex = index;
    this.cachedIndexPath = indexPath;
    this.cachedIndexTimestamp = stats.mtimeMs;

    this.logger?.debug?.('Marketplace index loaded successfully', {
      pluginCount: index.plugins.length,
      schemaVersion: index.schemaVersion,
    });

    return index;
  }

  /**
   * Check index freshness and validation status
   */
  async checkFreshness(indexPath: string): Promise<IndexFreshnessStatus> {
    const status: IndexFreshnessStatus = {
      exists: false,
      valid: false,
      stale: false,
    };

    try {
      // Check if file exists
      const stats = await fs.stat(indexPath);
      status.exists = true;
      status.lastUpdated = stats.mtime;
      status.ageMs = Date.now() - stats.mtimeMs;
      status.stale = status.ageMs > this.staleThresholdMs;

      // Try to load and validate
      try {
        const content = await fs.readFile(indexPath, 'utf-8');
        const parsed = JSON.parse(content);

        const validationResult = this.validator.validateMarketplace(parsed);
        status.valid = validationResult.status === ValidationStatus.SUCCESS;

        if (!status.valid) {
          status.validationErrors = validationResult.errors.map(e => `${e.path}: ${e.message}`);
        }

        // Check integrity if metadata present
        const index = parsed as MarketplaceIndex;
        const computedHash = this.computeContentHash(index.plugins);
        if (index._meta?.contentHash) {
          status.integrityStatus = computedHash === index._meta.contentHash ? 'valid' : 'invalid';
        } else {
          status.integrityStatus = 'missing';
        }

        if (index._meta?.signature) {
          const expectedSignature = this.computeSignature(index, computedHash);
          status.signatureStatus = expectedSignature === index._meta.signature ? 'valid' : 'invalid';
        } else {
          status.signatureStatus = 'missing';
        }
      } catch (error) {
        status.valid = false;
        status.validationErrors = [(error as Error).message];
      }
    } catch {
      // File does not exist
      status.exists = false;
    }

    return status;
  }

  /**
   * Browse plugins with filters and deterministic sorting
   */
  async browse(query: MarketplaceQuery): Promise<MarketplaceQueryResult> {
    if (!this.cachedIndex) {
      throw new Error('Marketplace index not loaded. Call loadIndex() first.');
    }

    let plugins = [...this.cachedIndex.plugins];

    // Apply filters
    if (query.category) {
      plugins = plugins.filter(p => p.category.toLowerCase() === query.category!.toLowerCase());
    }

    if (query.tag) {
      plugins = plugins.filter(p => p.tags?.some(t => t.toLowerCase() === query.tag!.toLowerCase()));
    }

    if (query.featured !== undefined) {
      plugins = plugins.filter(p => p.featured === query.featured);
    }

    if (query.verified !== undefined) {
      plugins = plugins.filter(p => p.verified === query.verified);
    }

    const totalCount = plugins.length;

    // Apply deterministic sorting
    plugins = this.applyDeterministicSort(plugins);

    // Apply pagination
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 50;
    plugins = plugins.slice(offset, offset + limit);

    this.logger?.debug?.('Browse query executed', {
      query,
      totalCount,
      returnedCount: plugins.length,
    });

    return {
      plugins,
      totalCount,
      query,
    };
  }

  /**
   * Search plugins by text query
   */
  async search(query: MarketplaceQuery): Promise<MarketplaceQueryResult> {
    if (!this.cachedIndex) {
      throw new Error('Marketplace index not loaded. Call loadIndex() first.');
    }

    if (!query.query || query.query.trim() === '') {
      throw new Error('Search query is required');
    }

    const searchTerm = query.query.toLowerCase().trim();
    let plugins = [...this.cachedIndex.plugins];

    // Text search across id, name, description, tags
    plugins = plugins.filter(p => {
      if (query.exact) {
        // Exact match
        return (
          p.id.toLowerCase() === searchTerm ||
          p.name.toLowerCase() === searchTerm ||
          p.description?.toLowerCase() === searchTerm ||
          p.tags?.some(t => t.toLowerCase() === searchTerm)
        );
      } else {
        // Fuzzy match (substring)
        return (
          p.id.toLowerCase().includes(searchTerm) ||
          p.name.toLowerCase().includes(searchTerm) ||
          p.description?.toLowerCase().includes(searchTerm) ||
          p.tags?.some(t => t.toLowerCase().includes(searchTerm))
        );
      }
    });

    // Apply additional filters
    if (query.category) {
      plugins = plugins.filter(p => p.category.toLowerCase() === query.category!.toLowerCase());
    }

    if (query.tag) {
      plugins = plugins.filter(p => p.tags?.some(t => t.toLowerCase() === query.tag!.toLowerCase()));
    }

    if (query.featured !== undefined) {
      plugins = plugins.filter(p => p.featured === query.featured);
    }

    if (query.verified !== undefined) {
      plugins = plugins.filter(p => p.verified === query.verified);
    }

    const totalCount = plugins.length;

    // Apply deterministic sorting
    plugins = this.applyDeterministicSort(plugins);

    // Apply pagination
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 50;
    plugins = plugins.slice(offset, offset + limit);

    this.logger?.debug?.('Search query executed', {
      query,
      totalCount,
      returnedCount: plugins.length,
    });

    return {
      plugins,
      totalCount,
      query,
    };
  }

  /**
   * Get detailed information for a specific plugin
   */
  async getPluginInfo(pluginId: string): Promise<PluginEntry | null> {
    if (!this.cachedIndex) {
      throw new Error('Marketplace index not loaded. Call loadIndex() first.');
    }

    const plugin = this.cachedIndex.plugins.find(p => p.id === pluginId);

    this.logger?.debug?.('Plugin info query', {
      pluginId,
      found: !!plugin,
    });

    return plugin || null;
  }

  /**
   * Get all plugins matching a category
   */
  async getByCategory(category: string): Promise<PluginEntry[]> {
    if (!this.cachedIndex) {
      throw new Error('Marketplace index not loaded. Call loadIndex() first.');
    }

    let plugins = this.cachedIndex.plugins.filter(
      p => p.category.toLowerCase() === category.toLowerCase()
    );

    plugins = this.applyDeterministicSort(plugins);

    this.logger?.debug?.('Category query executed', {
      category,
      count: plugins.length,
    });

    return plugins;
  }

  /**
   * Get all plugins matching a tag
   */
  async getByTag(tag: string): Promise<PluginEntry[]> {
    if (!this.cachedIndex) {
      throw new Error('Marketplace index not loaded. Call loadIndex() first.');
    }

    let plugins = this.cachedIndex.plugins.filter(
      p => p.tags?.some(t => t.toLowerCase() === tag.toLowerCase())
    );

    plugins = this.applyDeterministicSort(plugins);

    this.logger?.debug?.('Tag query executed', {
      tag,
      count: plugins.length,
    });

    return plugins;
  }

  /**
   * Apply deterministic sorting: category → name → version (desc)
   *
   * Per architecture guidance (Section 1.4, Key Assumptions):
   * - Primary: category (case-insensitive ascending)
   * - Secondary: plugin name (case-insensitive ascending)
   * - Tertiary: semantic version (descending, latest first)
   */
  private applyDeterministicSort(plugins: PluginEntry[]): PluginEntry[] {
    return plugins.sort((a, b) => {
      // 1. Category (case-insensitive ascending)
      const categoryCompare = a.category.toLowerCase().localeCompare(b.category.toLowerCase());
      if (categoryCompare !== 0) {
        this.logger?.debug?.('Sorting by category', {
          a: a.category,
          b: b.category,
          result: categoryCompare,
        });
        return categoryCompare;
      }

      // 2. Name (case-insensitive ascending)
      const nameCompare = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      if (nameCompare !== 0) {
        this.logger?.debug?.('Sorting by name', {
          a: a.name,
          b: b.name,
          result: nameCompare,
        });
        return nameCompare;
      }

      // 3. Version (semantic, descending - latest first)
      const versionA = semver.coerce(a.version);
      const versionB = semver.coerce(b.version);

      if (versionA && versionB) {
        const versionCompare = semver.rcompare(versionA, versionB); // rcompare = reverse compare
        this.logger?.debug?.('Sorting by version', {
          a: a.version,
          b: b.version,
          result: versionCompare,
        });
        return versionCompare;
      }

      // Fallback to string comparison if semver parsing fails
      return b.version.localeCompare(a.version);
    });
  }

  /**
   * Compute content hash for integrity verification
   */
  private computeContentHash(plugins: PluginEntry[]): string {
    const normalizedPlugins = this.normalizePluginsForHash(plugins);
    return crypto.createHash('sha256').update(JSON.stringify(normalizedPlugins)).digest('hex');
  }

  /**
   * Compute a deterministic signature for the marketplace index.
   * Uses schema version, marketplace metadata, and plugin content hash.
   */
  private computeSignature(index: MarketplaceIndex, existingHash?: string): string {
    const contentHash = existingHash ?? this.computeContentHash(index.plugins);
    const normalizedMarketplace = this.sortRecord(index.marketplace as unknown as Record<string, unknown>);
    const payload = JSON.stringify({
      schemaVersion: index.schemaVersion,
      marketplace: normalizedMarketplace,
      contentHash,
    });

    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Normalize plugin entries for deterministic hashing.
   */
  private normalizePluginsForHash(plugins: PluginEntry[]): Array<Record<string, unknown>> {
    return [...plugins]
      .map((plugin) => this.sortRecord(plugin as unknown as Record<string, unknown>))
      .sort((a, b) => {
        const idA = typeof a.id === 'string' ? a.id.toLowerCase() : '';
        const idB = typeof b.id === 'string' ? b.id.toLowerCase() : '';
        if (idA !== idB) {
          return idA.localeCompare(idB);
        }

        const versionA = typeof a.version === 'string' ? a.version : '';
        const versionB = typeof b.version === 'string' ? b.version : '';
        return versionB.localeCompare(versionA);
      });
  }

  /**
   * Recursively sort object keys to ensure deterministic serialization.
   */
  private sortRecord(input: Record<string, unknown>): Record<string, unknown> {
    return Object.keys(input)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        const value = input[key];
        if (Array.isArray(value)) {
          acc[key] = value.map((item) =>
            typeof item === 'object' && item !== null
              ? this.sortRecord(item as Record<string, unknown>)
              : item
          );
        } else if (value && typeof value === 'object') {
          acc[key] = this.sortRecord(value as Record<string, unknown>);
        } else {
          acc[key] = value;
        }
        return acc;
      }, {});
  }
}
