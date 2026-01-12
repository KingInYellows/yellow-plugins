/**
 * @yellow-plugins/domain - Registry Service Implementation
 *
 * Core domain service for plugin installation registry management.
 * Implements atomic persistence with transaction tracking and telemetry.
 *
 * Part of Task I2.T2: Cache manager + registry persistence
 *
 * Architecture References:
 * - Section 3.4: Data Persistence & Cache Layout (atomic writes)
 * - data-erd.puml: InstalledPluginRegistry, InstalledPlugin
 * - CRIT-001: Transaction tracking
 * - CRIT-010: Telemetry instrumentation
 */

import { join } from 'node:path';

import type { ICacheAdapter } from '../cache/contracts.js';
import type { Config } from '../config/contracts.js';

import type { IRegistryService } from './contracts.js';
import type {
  InstalledPlugin,
  InstalledPluginRegistry,
  RegistryBackup,
  RegistryOperationResult,
  RegistryQuery,
  RegistryUpdateOptions,
  TelemetrySnapshot,
} from './types.js';
import { InstallState } from './types.js';

/**
 * Registry service implementation.
 * Manages plugin installation tracking with atomic persistence.
 */
export class RegistryService implements IRegistryService {
  private readonly config: Config;
  private readonly adapter: ICacheAdapter;
  private registryCache: InstalledPluginRegistry | null = null;

  /**
   * Registry file path
   */
  private get registryPath(): string {
    return join(this.config.pluginDir, 'registry.json');
  }

  /**
   * Registry backup directory
   */
  private get backupDir(): string {
    return join(this.config.pluginDir, 'backups');
  }

  /**
   * Current CLI version (would come from package.json in real impl)
   */
  private get cliVersion(): string {
    return '0.1.0'; // TODO: Import from package.json
  }

  constructor(config: Config, adapter: ICacheAdapter) {
    this.config = config;
    this.adapter = adapter;
  }

  /**
   * Load the current registry from disk.
   */
  async loadRegistry(): Promise<InstalledPluginRegistry> {
    const registry = await this.adapter.readJson<InstalledPluginRegistry>(this.registryPath);

    if (!registry) {
      // Registry doesn't exist, create empty one
      const emptyRegistry = this.createEmptyRegistry();
      this.registryCache = emptyRegistry;
      return emptyRegistry;
    }

    this.registryCache = registry;
    return registry;
  }

  /**
   * Get a specific installed plugin by ID.
   */
  async getPlugin(pluginId: string): Promise<InstalledPlugin | undefined> {
    const registry = await this.loadRegistry();
    return registry.plugins.find((p) => p.pluginId === pluginId);
  }

  /**
   * Query installed plugins with filters.
   */
  async queryPlugins(query: RegistryQuery): Promise<InstalledPlugin[]> {
    const registry = await this.loadRegistry();
    let results = registry.plugins;

    // Apply filters
    if (query.pluginId) {
      results = results.filter((p) => p.pluginId === query.pluginId);
    }

    if (query.installState) {
      results = results.filter((p) => p.installState === query.installState);
    }

    if (query.version) {
      results = results.filter((p) => p.version === query.version);
    }

    if (query.pinned !== undefined) {
      results = results.filter((p) => p.pinned === query.pinned);
    }

    if (query.installedAfter) {
      results = results.filter((p) => p.installedAt >= query.installedAfter);
    }

    if (query.installedBefore) {
      results = results.filter((p) => p.installedAt <= query.installedBefore);
    }

    return results;
  }

  /**
   * List all installed plugins.
   */
  async listPlugins(): Promise<InstalledPlugin[]> {
    const registry = await this.loadRegistry();
    return registry.plugins;
  }

  /**
   * Add a new plugin to the registry.
   */
  async addPlugin(
    plugin: InstalledPlugin,
    options?: RegistryUpdateOptions
  ): Promise<RegistryOperationResult<InstalledPlugin>> {
    const startTime = Date.now();
    const transactionId = options?.transactionId || this.generateTransactionId();

    try {
      // Load current registry
      const registry = await this.loadRegistry();

      // Check if plugin already exists
      const existingIndex = registry.plugins.findIndex((p) => p.pluginId === plugin.pluginId);
      if (existingIndex !== -1) {
        return {
          success: false,
          error: {
            code: 'PLUGIN_EXISTS',
            message: `Plugin ${plugin.pluginId} already exists in registry`,
          },
          metadata: {
            operationType: 'add',
            transactionId,
            durationMs: Date.now() - startTime,
            timestamp: new Date(),
          },
        };
      }

      // Create backup if requested
      if (options?.createBackup) {
        await this.createBackup(`Before adding plugin ${plugin.pluginId}`);
      }

      // Add plugin to registry
      const updatedRegistry: InstalledPluginRegistry = {
        ...registry,
        metadata: {
          ...registry.metadata,
          lastUpdated: new Date(),
          modifiedBy: this.cliVersion,
          totalInstallations: registry.metadata.totalInstallations + 1,
        },
        plugins: [...registry.plugins, plugin],
      };

      // Add telemetry if provided
      if (options?.telemetryContext) {
        const telemetry = updatedRegistry.telemetry || {};
        const telemetryId = options.telemetryContext.id || this.generateTelemetryId();
        telemetry[telemetryId] = {
          id: telemetryId,
          transactionId: plugin.transactionId,
          commandType: options.telemetryContext.commandType || 'install',
          durationMs: options.telemetryContext.durationMs || Date.now() - startTime,
          success: true,
          capturedAt: new Date(),
          ...options.telemetryContext,
        };
        updatedRegistry.telemetry = telemetry;
      }

      // Write atomically to disk
      await this.writeRegistryAtomic(updatedRegistry);

      // Validate if requested
      if (options?.validateAfterUpdate) {
        const errors = await this.validateRegistry();
        if (errors.length > 0) {
          return {
            success: false,
            error: {
              code: 'VALIDATION_FAILED',
              message: 'Registry validation failed after update',
              details: errors,
            },
            metadata: {
              operationType: 'add',
              transactionId,
              durationMs: Date.now() - startTime,
              timestamp: new Date(),
            },
          };
        }
      }

      return {
        success: true,
        data: plugin,
        metadata: {
          operationType: 'add',
          transactionId,
          durationMs: Date.now() - startTime,
          timestamp: new Date(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'ADD_FAILED',
          message: `Failed to add plugin ${plugin.pluginId} to registry`,
          details: error,
        },
        metadata: {
          operationType: 'add',
          transactionId,
          durationMs: Date.now() - startTime,
          timestamp: new Date(),
        },
      };
    }
  }

  /**
   * Update an existing plugin in the registry.
   */
  async updatePlugin(
    pluginId: string,
    updates: Partial<InstalledPlugin>,
    options?: RegistryUpdateOptions
  ): Promise<RegistryOperationResult<InstalledPlugin>> {
    const startTime = Date.now();
    const transactionId = options?.transactionId || this.generateTransactionId();

    try {
      // Load current registry
      const registry = await this.loadRegistry();

      // Find plugin
      const pluginIndex = registry.plugins.findIndex((p) => p.pluginId === pluginId);
      if (pluginIndex === -1) {
        return {
          success: false,
          error: {
            code: 'PLUGIN_NOT_FOUND',
            message: `Plugin ${pluginId} not found in registry`,
          },
          metadata: {
            operationType: 'update',
            transactionId,
            durationMs: Date.now() - startTime,
            timestamp: new Date(),
          },
        };
      }

      // Create backup if requested
      if (options?.createBackup) {
        await this.createBackup(`Before updating plugin ${pluginId}`);
      }

      // Update plugin
      const updatedPlugin = {
        ...registry.plugins[pluginIndex],
        ...updates,
      };

      const updatedPlugins = [...registry.plugins];
      updatedPlugins[pluginIndex] = updatedPlugin;

      const updatedRegistry: InstalledPluginRegistry = {
        ...registry,
        metadata: {
          ...registry.metadata,
          lastUpdated: new Date(),
          modifiedBy: this.cliVersion,
        },
        plugins: updatedPlugins,
      };

      // Write atomically to disk
      await this.writeRegistryAtomic(updatedRegistry);

      // Validate if requested
      if (options?.validateAfterUpdate) {
        const errors = await this.validateRegistry();
        if (errors.length > 0) {
          return {
            success: false,
            error: {
              code: 'VALIDATION_FAILED',
              message: 'Registry validation failed after update',
              details: errors,
            },
            metadata: {
              operationType: 'update',
              transactionId,
              durationMs: Date.now() - startTime,
              timestamp: new Date(),
            },
          };
        }
      }

      return {
        success: true,
        data: updatedPlugin,
        metadata: {
          operationType: 'update',
          transactionId,
          durationMs: Date.now() - startTime,
          timestamp: new Date(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'UPDATE_FAILED',
          message: `Failed to update plugin ${pluginId} in registry`,
          details: error,
        },
        metadata: {
          operationType: 'update',
          transactionId,
          durationMs: Date.now() - startTime,
          timestamp: new Date(),
        },
      };
    }
  }

  /**
   * Remove a plugin from the registry.
   */
  async removePlugin(
    pluginId: string,
    options?: RegistryUpdateOptions
  ): Promise<RegistryOperationResult<void>> {
    const startTime = Date.now();
    const transactionId = options?.transactionId || this.generateTransactionId();

    try {
      // Load current registry
      const registry = await this.loadRegistry();

      // Find plugin
      const pluginIndex = registry.plugins.findIndex((p) => p.pluginId === pluginId);
      if (pluginIndex === -1) {
        return {
          success: false,
          error: {
            code: 'PLUGIN_NOT_FOUND',
            message: `Plugin ${pluginId} not found in registry`,
          },
          metadata: {
            operationType: 'remove',
            transactionId,
            durationMs: Date.now() - startTime,
            timestamp: new Date(),
          },
        };
      }

      // Create backup if requested
      if (options?.createBackup) {
        await this.createBackup(`Before removing plugin ${pluginId}`);
      }

      // Remove plugin
      const updatedPlugins = registry.plugins.filter((p) => p.pluginId !== pluginId);

      // Remove from activePins if present
      const updatedPins = registry.activePins.filter((id) => id !== pluginId);

      const updatedRegistry: InstalledPluginRegistry = {
        ...registry,
        metadata: {
          ...registry.metadata,
          lastUpdated: new Date(),
          modifiedBy: this.cliVersion,
          totalInstallations: updatedPlugins.length,
        },
        plugins: updatedPlugins,
        activePins: updatedPins,
      };

      // Write atomically to disk
      await this.writeRegistryAtomic(updatedRegistry);

      return {
        success: true,
        metadata: {
          operationType: 'remove',
          transactionId,
          durationMs: Date.now() - startTime,
          timestamp: new Date(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'REMOVE_FAILED',
          message: `Failed to remove plugin ${pluginId} from registry`,
          details: error,
        },
        metadata: {
          operationType: 'remove',
          transactionId,
          durationMs: Date.now() - startTime,
          timestamp: new Date(),
        },
      };
    }
  }

  /**
   * Pin a plugin.
   */
  async pinPlugin(pluginId: string, options?: RegistryUpdateOptions): Promise<void> {
    void options;

    const registry = await this.loadRegistry();

    // Check if plugin exists
    const plugin = registry.plugins.find((p) => p.pluginId === pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found in registry`);
    }

    // Check if already pinned
    if (registry.activePins.includes(pluginId)) {
      return; // Already pinned
    }

    // Add to activePins
    const updatedRegistry: InstalledPluginRegistry = {
      ...registry,
      metadata: {
        ...registry.metadata,
        lastUpdated: new Date(),
        modifiedBy: this.cliVersion,
      },
      activePins: [...registry.activePins, pluginId],
    };

    // Update plugin pinned status
    const pluginIndex = updatedRegistry.plugins.findIndex((p) => p.pluginId === pluginId);
    if (pluginIndex !== -1) {
      updatedRegistry.plugins[pluginIndex] = {
        ...updatedRegistry.plugins[pluginIndex],
        pinned: true,
      };
    }

    await this.writeRegistryAtomic(updatedRegistry);
  }

  /**
   * Unpin a plugin.
   */
  async unpinPlugin(pluginId: string, options?: RegistryUpdateOptions): Promise<void> {
    void options;

    const registry = await this.loadRegistry();

    // Remove from activePins
    const updatedRegistry: InstalledPluginRegistry = {
      ...registry,
      metadata: {
        ...registry.metadata,
        lastUpdated: new Date(),
        modifiedBy: this.cliVersion,
      },
      activePins: registry.activePins.filter((id) => id !== pluginId),
    };

    // Update plugin pinned status
    const pluginIndex = updatedRegistry.plugins.findIndex((p) => p.pluginId === pluginId);
    if (pluginIndex !== -1) {
      updatedRegistry.plugins[pluginIndex] = {
        ...updatedRegistry.plugins[pluginIndex],
        pinned: false,
      };
    }

    await this.writeRegistryAtomic(updatedRegistry);
  }

  /**
   * Record a telemetry snapshot.
   */
  async recordTelemetry(
    snapshot: TelemetrySnapshot,
    options?: RegistryUpdateOptions
  ): Promise<void> {
    void options;

    const registry = await this.loadRegistry();

    const telemetry = registry.telemetry || {};
    telemetry[snapshot.id] = snapshot;

    const updatedRegistry: InstalledPluginRegistry = {
      ...registry,
      metadata: {
        ...registry.metadata,
        lastUpdated: new Date(),
        modifiedBy: this.cliVersion,
      },
      telemetry,
    };

    await this.writeRegistryAtomic(updatedRegistry);
  }

  /**
   * Validate registry integrity.
   */
  async validateRegistry(): Promise<string[]> {
    const errors: string[] = [];

    try {
      const registry = await this.loadRegistry();

      // Check metadata
      if (!registry.metadata) {
        errors.push('Missing metadata');
      } else {
        if (!registry.metadata.registryVersion) {
          errors.push('Missing registry version');
        }
        if (!registry.metadata.lastUpdated) {
          errors.push('Missing lastUpdated timestamp');
        }
      }

      // Check plugins
      if (!Array.isArray(registry.plugins)) {
        errors.push('Plugins must be an array');
      } else {
        for (let i = 0; i < registry.plugins.length; i++) {
          const plugin = registry.plugins[i];
          const prefix = `Plugin ${i}`;

          if (!plugin.pluginId) {
            errors.push(`${prefix}: Missing pluginId`);
          }
          if (!plugin.version) {
            errors.push(`${prefix}: Missing version`);
          }
          if (!plugin.source) {
            errors.push(`${prefix}: Missing source`);
          }
          if (!plugin.installState) {
            errors.push(`${prefix}: Missing installState`);
          }
          if (!plugin.installedAt) {
            errors.push(`${prefix}: Missing installedAt`);
          }
          if (!plugin.cachePath) {
            errors.push(`${prefix}: Missing cachePath`);
          }
          if (!plugin.transactionId) {
            errors.push(`${prefix}: Missing transactionId`);
          }

          // Check cache path exists
          const cacheExists = await this.adapter.exists(plugin.cachePath);
          if (!cacheExists && plugin.installState === InstallState.INSTALLED) {
            errors.push(`${prefix}: Cache path ${plugin.cachePath} does not exist`);
          }
        }
      }

      // Check activePins
      if (!Array.isArray(registry.activePins)) {
        errors.push('activePins must be an array');
      } else {
        for (const pinnedId of registry.activePins) {
          const plugin = registry.plugins.find((p) => p.pluginId === pinnedId);
          if (!plugin) {
            errors.push(`Pinned plugin ${pinnedId} not found in plugins list`);
          }
        }
      }
    } catch (error) {
      errors.push(`Validation error: ${(error as Error).message}`);
    }

    return errors;
  }

  /**
   * Create a backup of the current registry.
   */
  async createBackup(reason: string): Promise<RegistryBackup> {
    const registry = await this.loadRegistry();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `registry-${timestamp}.json`;
    const backupPath = join(this.backupDir, backupFileName);

    // Ensure backup directory exists
    await this.adapter.ensureDirectory(this.backupDir);

    // Calculate checksum of current registry
    const checksum = await this.adapter.calculateChecksum(this.registryPath);

    // Write backup
    await this.adapter.writeJsonAtomic(backupPath, registry);

    return {
      backupPath,
      createdAt: new Date(),
      registryVersion: registry.metadata.registryVersion,
      reason,
      checksum,
    };
  }

  /**
   * Restore registry from a backup.
   */
  async restoreFromBackup(backupPath: string): Promise<void> {
    const backupRegistry = await this.adapter.readJson<InstalledPluginRegistry>(backupPath);

    if (!backupRegistry) {
      throw new Error(`Backup file not found: ${backupPath}`);
    }

    // Validate backup
    const tempCache = this.registryCache;
    this.registryCache = backupRegistry;
    const errors = await this.validateRegistry();
    this.registryCache = tempCache;

    if (errors.length > 0) {
      throw new Error(`Backup validation failed: ${errors.join(', ')}`);
    }

    // Write backup to registry path
    await this.writeRegistryAtomic(backupRegistry);
  }

  /**
   * Get registry statistics.
   */
  async getStats(): Promise<{
    totalPlugins: number;
    installedCount: number;
    failedCount: number;
    pinnedCount: number;
    oldestInstall?: Date;
    newestInstall?: Date;
  }> {
    const registry = await this.loadRegistry();

    const installedCount = registry.plugins.filter(
      (p) => p.installState === InstallState.INSTALLED
    ).length;
    const failedCount = registry.plugins.filter(
      (p) => p.installState === InstallState.FAILED
    ).length;
    const pinnedCount = registry.activePins.length;

    let oldestInstall: Date | undefined;
    let newestInstall: Date | undefined;

    if (registry.plugins.length > 0) {
      const installDates = registry.plugins.map((p) => p.installedAt);
      oldestInstall = new Date(Math.min(...installDates.map((d) => d.getTime())));
      newestInstall = new Date(Math.max(...installDates.map((d) => d.getTime())));
    }

    return {
      totalPlugins: registry.plugins.length,
      installedCount,
      failedCount,
      pinnedCount,
      oldestInstall,
      newestInstall,
    };
  }

  // Private helper methods

  /**
   * Create an empty registry.
   */
  private createEmptyRegistry(): InstalledPluginRegistry {
    return {
      metadata: {
        registryVersion: '1.0',
        lastUpdated: new Date(),
        modifiedBy: this.cliVersion,
        totalInstallations: 0,
      },
      plugins: [],
      activePins: [],
      telemetry: {},
    };
  }

  /**
   * Write registry atomically to disk.
   */
  private async writeRegistryAtomic(registry: InstalledPluginRegistry): Promise<void> {
    await this.adapter.writeJsonAtomic(this.registryPath, registry);
    this.registryCache = registry;
  }

  /**
   * Generate a unique transaction ID.
   */
  private generateTransactionId(): string {
    return `tx-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Generate a unique telemetry ID.
   */
  private generateTelemetryId(): string {
    return `tel-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}
