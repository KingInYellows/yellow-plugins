/**
 * @yellow-plugins/domain - Update Service Implementation
 *
 * Core domain service for plugin updates with changelog-aware flow.
 * Implements CRIT-008 requirements with parallelizable fetch and timeout fallback.
 *
 * Part of Task I3.T2: Changelog-aware update pipeline
 *
 * Architecture References:
 * - CRIT-008: Changelog display with 5-second timeout fallback
 * - Section 3.4: Update Journey specification
 * - Section 2.1: Update transaction orchestrator
 *
 * @specification docs/SPECIFICATION-PART1-v1.1.md (CRIT-008)
 */

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { IChangelogService } from '../changelog/contracts.js';
import type { ChangelogFetchResult } from '../changelog/types.js';
import type { Config } from '../config/contracts.js';
import type { IInstallService } from '../install/contracts.js';
import type { IRegistryService } from '../registry/contracts.js';

import type { IUpdateService } from './contracts.js';
import type {
  UpdateCheckRequest,
  UpdateCheckResult,
  UpdateExecutionRequest,
  UpdateExecutionResult,
  BatchUpdateResult,
  PluginUpdateCheck,
} from './types.js';

/**
 * Marketplace plugin metadata (simplified).
 */
interface MarketplacePlugin {
  pluginId: string;
  version: string;
  changelogUrl?: string;
  permissions?: string[];
}

/**
 * Update service implementation.
 * Orchestrates update checks and executions with changelog integration.
 */
export class UpdateService implements IUpdateService {
  private readonly config: Config;
  private readonly registryService: IRegistryService;
  private readonly installService: IInstallService;
  private readonly changelogService: IChangelogService;
  private readonly marketplaceLoader?: () => Promise<MarketplacePlugin[]>;
  private readonly marketplacePath: string;
  private marketplaceWarning?: UpdateCheckResult['marketplaceWarning'];
  private readonly MARKETPLACE_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

  constructor(
    config: Config,
    registryService: IRegistryService,
    installService: IInstallService,
    changelogService: IChangelogService,
    options?: {
      marketplaceLoader?: () => Promise<MarketplacePlugin[]>;
      marketplacePath?: string;
    }
  ) {
    this.config = config;
    this.registryService = registryService;
    this.installService = installService;
    this.changelogService = changelogService;
    this.marketplaceLoader = options?.marketplaceLoader;
    this.marketplacePath = options?.marketplacePath ?? join(config.pluginDir, 'marketplace.json');
  }

  /**
   * Check for available updates with parallelized changelog fetching.
   */
  async checkUpdates(request: UpdateCheckRequest): Promise<UpdateCheckResult> {
    const transactionId = request.transactionId || this.generateTransactionId();
    const startTime = Date.now();
    const updatesAvailable: PluginUpdateCheck[] = [];
    const upToDate: string[] = [];
    const skipped: Array<{ pluginId: string; reason: string; errorCode?: string }> = [];
    let changelogsFetched = 0;
    let changelogCacheHits = 0;

    try {
      // Step 1: Get installed plugins
      const installedPlugins = request.pluginId
        ? [await this.registryService.getPlugin(request.pluginId)]
        : await this.registryService.listPlugins();

      const validPlugins = installedPlugins.filter((p) => p !== null && p !== undefined);

      if (request.pluginId && validPlugins.length === 0) {
        return {
          success: false,
          transactionId,
          updatesAvailable: [],
          upToDate: [],
          skipped: [
            {
              pluginId: request.pluginId,
              reason: 'Plugin not installed',
              errorCode: 'ERR-CHECK-001',
            },
          ],
          error: {
            code: 'ERR-CHECK-001',
            message: `Plugin ${request.pluginId} is not installed`,
          },
          metadata: {
            durationMs: Date.now() - startTime,
            timestamp: new Date(),
            correlationId: request.correlationId,
          },
        };
      }

      // Step 2: Load marketplace index
      let marketplace: MarketplacePlugin[];
      try {
        marketplace = await this.loadMarketplace();
      } catch (error) {
        return {
          success: false,
          transactionId,
          updatesAvailable: [],
          upToDate: [],
          skipped,
          error: {
            code: 'ERR-CHECK-999',
            message: (error as Error).message,
            details: error,
          },
          metadata: {
            durationMs: Date.now() - startTime,
            timestamp: new Date(),
            correlationId: request.correlationId,
          },
          marketplaceWarning: this.marketplaceWarning,
        };
      }

      // Step 3: Compare versions and check for updates
      const updateChecks = await Promise.all(
        validPlugins.map(async (plugin) => {
          if (!plugin) return null;

          const marketplaceEntry = marketplace.find((m) => m.pluginId === plugin.pluginId);

          if (!marketplaceEntry) {
            skipped.push({
              pluginId: plugin.pluginId,
              reason: 'Not found in marketplace',
              errorCode: 'ERR-CHECK-002',
            });
            return null;
          }

          const updateAvailable = this.compareVersions(marketplaceEntry.version, plugin.version) > 0;

          if (!updateAvailable) {
            upToDate.push(plugin.pluginId);
            return null;
          }

          // Build update check result (mutable for changelog assignment)
          let updateCheck: PluginUpdateCheck = {
            pluginId: plugin.pluginId,
            currentVersion: plugin.version,
            latestVersion: marketplaceEntry.version,
            updateAvailable: true,
            changelogUrl: marketplaceEntry.changelogUrl,
            pinned: plugin.pinned,
          };

          // Step 4: Fetch changelog if requested (parallelizable with timeout)
          if (request.fetchChangelogs) {
            try {
              const changelog = await this.changelogService.fetchChangelog(
                plugin.pluginId,
                marketplaceEntry.version,
                marketplaceEntry.changelogUrl,
                {
                  timeoutMs: 5000,
                  bypassCache: request.bypassChangelogCache,
                  transactionId,
                }
              );

              // Rebuild with changelog included
              updateCheck = { ...updateCheck, changelog };
              changelogsFetched++;

              if (changelog.status === 'cached') {
                changelogCacheHits++;
              }
            } catch (error) {
              // Changelog fetch failure does not block update check
              // Per CRIT-008, we continue with degraded message
            }
          }

          return updateCheck;
        })
      );

      // Filter out null results
      updatesAvailable.push(...updateChecks.filter((c): c is PluginUpdateCheck => c !== null));

      return {
        success: true,
        transactionId,
        updatesAvailable,
        upToDate,
        skipped,
        marketplaceWarning: this.marketplaceWarning,
        metadata: {
          durationMs: Date.now() - startTime,
          timestamp: new Date(),
          correlationId: request.correlationId,
          changelogsFetched,
          changelogCacheHits,
        },
      };
    } catch (error) {
      return {
        success: false,
        transactionId,
        updatesAvailable: [],
        upToDate: [],
        skipped: [],
        error: {
          code: 'ERR-CHECK-999',
          message: `Update check failed: ${(error as Error).message}`,
          details: error,
        },
        metadata: {
          durationMs: Date.now() - startTime,
          timestamp: new Date(),
          correlationId: request.correlationId,
        },
        marketplaceWarning: this.marketplaceWarning,
      };
    }
  }

  /**
   * Execute update for a single plugin with changelog display.
   */
  async updatePlugin(request: UpdateExecutionRequest): Promise<UpdateExecutionResult> {
    const transactionId = request.transactionId || this.generateTransactionId();
    const startTime = Date.now();

    if (!request.pluginId) {
      return {
        success: false,
        transactionId,
        error: {
          code: 'ERR-UPDATE-001',
          message: 'Plugin ID is required for single plugin update',
        },
        metadata: {
          durationMs: Date.now() - startTime,
          timestamp: new Date(),
          correlationId: request.correlationId,
        },
        messages: [],
      };
    }

    try {
      // Step 1: Get current installation
      const currentPlugin = await this.registryService.getPlugin(request.pluginId);
      if (!currentPlugin) {
        return {
          success: false,
          transactionId,
          error: {
            code: 'ERR-UPDATE-001',
            message: `Plugin ${request.pluginId} is not installed`,
          },
          metadata: {
            durationMs: Date.now() - startTime,
            timestamp: new Date(),
            correlationId: request.correlationId,
          },
          messages: [],
        };
      }

      // Step 2: Check if pinned (unless force)
      if (currentPlugin.pinned && !request.force) {
        return {
          success: false,
          transactionId,
          error: {
            code: 'ERR-UPDATE-002',
            message: `Plugin ${request.pluginId} is pinned to ${currentPlugin.version}. Use --force to override.`,
          },
          metadata: {
            durationMs: Date.now() - startTime,
            timestamp: new Date(),
            correlationId: request.correlationId,
          },
          messages: [
            {
              level: 'warn',
              message: `${request.pluginId} is pinned. Use --force to update.`,
            },
          ],
        };
      }

      // Step 3: Load marketplace and find latest version
      let marketplace: MarketplacePlugin[];
      try {
        marketplace = await this.loadMarketplace();
      } catch (error) {
        return {
          success: false,
          transactionId,
          error: {
            code: 'ERR-UPDATE-003',
            message: (error as Error).message,
            details: error,
          },
          metadata: {
            durationMs: Date.now() - startTime,
            timestamp: new Date(),
            correlationId: request.correlationId,
          },
          messages: [],
        };
      }
      const marketplaceEntry = marketplace.find((m) => m.pluginId === request.pluginId);

      if (!marketplaceEntry) {
        return {
          success: false,
          transactionId,
          error: {
            code: 'ERR-UPDATE-003',
            message: `Plugin ${request.pluginId} not found in marketplace`,
          },
          metadata: {
            durationMs: Date.now() - startTime,
            timestamp: new Date(),
            correlationId: request.correlationId,
          },
          messages: [],
        };
      }

      // Step 4: Check if already latest
      if (this.compareVersions(marketplaceEntry.version, currentPlugin.version) <= 0) {
        return {
          success: true,
          transactionId,
          plugin: currentPlugin,
          metadata: {
            durationMs: Date.now() - startTime,
            timestamp: new Date(),
            correlationId: request.correlationId,
          },
          messages: [
            {
              level: 'info',
              message: `${request.pluginId}@${currentPlugin.version} is already the latest version`,
            },
          ],
        };
      }

      // Step 5: Fetch changelog (CRIT-008)
      const changelog = await this.changelogService.fetchChangelog(
        request.pluginId,
        marketplaceEntry.version,
        marketplaceEntry.changelogUrl,
        {
          timeoutMs: 5000,
          bypassCache: request.bypassChangelogCache,
          transactionId,
        }
      );

      // Step 6: Execute installation via install service
      const installResult = await this.installService.update({
        pluginId: request.pluginId,
        version: request.versionConstraint || marketplaceEntry.version,
        currentVersion: currentPlugin.version,
        force: true,
        correlationId: request.correlationId,
        dryRun: request.dryRun,
      });

      // Step 7: Build update result with changelog
      return {
        ...installResult,
        changelog,
        metadata: {
          durationMs: Date.now() - startTime,
          timestamp: new Date(),
          correlationId: request.correlationId,
        },
      };
    } catch (error) {
      return {
        success: false,
        transactionId,
        error: {
          code: 'ERR-UPDATE-999',
          message: `Update failed: ${(error as Error).message}`,
          details: error,
        },
        metadata: {
          durationMs: Date.now() - startTime,
          timestamp: new Date(),
          correlationId: request.correlationId,
        },
        messages: [],
      };
    }
  }

  /**
   * Execute batch update for all installed plugins.
   */
  async updateAll(request: UpdateExecutionRequest): Promise<BatchUpdateResult> {
    const transactionId = request.transactionId || this.generateTransactionId();
    const startTime = Date.now();
    const updated: Array<{
      pluginId: string;
      fromVersion: string;
      toVersion: string;
      changelog?: ChangelogFetchResult;
    }> = [];
    const upToDate: string[] = [];
    const skipped: Array<{ pluginId: string; reason: string; errorCode?: string }> = [];
    const failed: Array<{ pluginId: string; error: string; errorCode?: string }> = [];

    try {
      // Get all installed plugins
      const installedPlugins = await this.registryService.listPlugins();

      // Execute updates in parallel (with individual timeout handling)
      await Promise.all(
        installedPlugins.map(async (plugin) => {
          if (!plugin) return null;

          try {
            const result = await this.updatePlugin({
              ...request,
              pluginId: plugin.pluginId,
              transactionId,
            });

            if (!result.success) {
              if (result.error?.code === 'ERR-UPDATE-002') {
                // Pinned plugin
                skipped.push({
                  pluginId: plugin.pluginId,
                  reason: 'Plugin is pinned',
                  errorCode: result.error.code,
                });
              } else {
                failed.push({
                  pluginId: plugin.pluginId,
                  error: result.error?.message || 'Unknown error',
                  errorCode: result.error?.code,
                });
              }
              return null;
            }

            // Check if actually updated or already latest
            if (result.plugin && result.registryDelta?.updated) {
              updated.push({
                pluginId: plugin.pluginId,
                fromVersion: plugin.version,
                toVersion: result.plugin.version,
                changelog: result.changelog,
              });
            } else {
              upToDate.push(plugin.pluginId);
            }

            return result;
          } catch (error) {
            failed.push({
              pluginId: plugin.pluginId,
              error: (error as Error).message,
              errorCode: 'ERR-UPDATE-999',
            });
            return null;
          }
        })
      );

      return {
        success: failed.length === 0,
        transactionId,
        updated,
        upToDate,
        skipped,
        failed,
        metadata: {
          durationMs: Date.now() - startTime,
          timestamp: new Date(),
          correlationId: request.correlationId,
        },
      };
    } catch (error) {
      return {
        success: false,
        transactionId,
        updated: [],
        upToDate: [],
        skipped: [],
        failed: [],
        metadata: {
          durationMs: Date.now() - startTime,
          timestamp: new Date(),
          correlationId: request.correlationId,
        },
      };
    }
  }

  // Private helper methods

  /**
   * Generate a unique transaction ID.
   */
  private generateTransactionId(): string {
    return `tx-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Load marketplace index.
   */
  private async loadMarketplace(): Promise<MarketplacePlugin[]> {
    if (this.marketplaceLoader) {
      this.marketplaceWarning = undefined;
      return this.marketplaceLoader();
    }

    let content: string;
    try {
      content = await readFile(this.marketplacePath, 'utf-8');
    } catch (error) {
      throw new Error(
        `Failed to read marketplace index at ${this.marketplacePath}: ${(error as Error).message}. ` +
          'Run the marketplace generator to create the index.'
      );
    }

    await this.updateMarketplaceWarning();

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw new Error(
        `Failed to parse marketplace index at ${this.marketplacePath}: ${(error as Error).message}`
      );
    }

    const plugins = (parsed as { plugins?: unknown[] }).plugins;
    if (!Array.isArray(plugins)) {
      throw new Error('Marketplace index is missing a valid plugins array');
    }

    const normalized = plugins
      .map((entry) => this.normalizeMarketplaceEntry(entry))
      .filter((entry): entry is MarketplacePlugin => entry !== null);

    return normalized;
  }

  /**
   * Simple semver comparison (-1 if a < b, 0 if equal, 1 if a > b).
   */
  private compareVersions(a: string, b: string): number {
    const parseVersion = (v: string): [number, number, number] => {
      const parts = v.split('.').map((p) => parseInt(p, 10) || 0);
      return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
    };

    const [aMaj, aMin, aPatch] = parseVersion(a);
    const [bMaj, bMin, bPatch] = parseVersion(b);

    if (aMaj !== bMaj) return aMaj - bMaj;
    if (aMin !== bMin) return aMin - bMin;
    return aPatch - bPatch;
  }

  private async updateMarketplaceWarning(): Promise<void> {
    try {
      const stats = await stat(this.marketplacePath);
      const ageMs = Date.now() - stats.mtimeMs;
      if (ageMs > this.MARKETPLACE_STALE_THRESHOLD_MS) {
        const hours = Math.floor(ageMs / (1000 * 60 * 60));
        this.marketplaceWarning = {
          stale: true,
          lastUpdated: stats.mtime,
          message: `Marketplace index is stale (${hours}h old). Run marketplace generator to refresh.`,
        };
      } else {
        this.marketplaceWarning = undefined;
      }
    } catch {
      this.marketplaceWarning = {
        stale: true,
        message: 'Marketplace index metadata unavailable. Run marketplace generator to refresh.',
      };
    }
  }

  private normalizeMarketplaceEntry(entry: unknown): MarketplacePlugin | null {
    if (!entry || typeof entry !== 'object') {
      return null;
    }

    const candidate = entry as Record<string, unknown>;
    const pluginId = (candidate.pluginId ?? candidate.id) as string | undefined;
    const version = (candidate.version ?? candidate.latestVersion) as string | undefined;

    if (!pluginId || !version) {
      return null;
    }

    const permissions = Array.isArray(candidate.permissions)
      ? candidate.permissions.filter((perm): perm is string => typeof perm === 'string')
      : undefined;

    const changelogUrlCandidate =
      candidate.changelogUrl ??
      (typeof candidate.docs === 'object' && candidate.docs !== null
        ? (candidate.docs as Record<string, unknown>).changelog
        : undefined);

    const changelogUrl =
      typeof changelogUrlCandidate === 'string' ? changelogUrlCandidate : undefined;

    return {
      pluginId,
      version,
      changelogUrl,
      permissions,
    };
  }
}
