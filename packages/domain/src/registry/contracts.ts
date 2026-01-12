/**
 * @yellow-plugins/domain - Registry Service Contracts
 *
 * Domain interfaces for registry management operations.
 * Defines the contract between domain logic and infrastructure adapters.
 *
 * Part of Task I2.T2: Cache manager + registry persistence
 */

import type {
  InstalledPlugin,
  InstalledPluginRegistry,
  RegistryBackup,
  RegistryOperationResult,
  RegistryQuery,
  RegistryUpdateOptions,
  TelemetrySnapshot,
} from './types.js';

/**
 * Registry service interface for domain operations.
 * Orchestrates plugin installation tracking with atomic persistence.
 */
export interface IRegistryService {
  /**
   * Load the current registry from disk.
   * Returns empty registry if file doesn't exist.
   */
  loadRegistry(): Promise<InstalledPluginRegistry>;

  /**
   * Get a specific installed plugin by ID.
   * Returns undefined if not found.
   */
  getPlugin(pluginId: string): Promise<InstalledPlugin | undefined>;

  /**
   * Query installed plugins with filters.
   * Returns array of matching plugins (empty if none match).
   */
  queryPlugins(query: RegistryQuery): Promise<InstalledPlugin[]>;

  /**
   * List all installed plugins.
   */
  listPlugins(): Promise<InstalledPlugin[]>;

  /**
   * Add a new plugin to the registry.
   * Writes registry atomically with temp-rename pattern.
   */
  addPlugin(
    plugin: InstalledPlugin,
    options?: RegistryUpdateOptions
  ): Promise<RegistryOperationResult<InstalledPlugin>>;

  /**
   * Update an existing plugin in the registry.
   * Creates backup before update if configured.
   */
  updatePlugin(
    pluginId: string,
    updates: Partial<InstalledPlugin>,
    options?: RegistryUpdateOptions
  ): Promise<RegistryOperationResult<InstalledPlugin>>;

  /**
   * Remove a plugin from the registry.
   */
  removePlugin(
    pluginId: string,
    options?: RegistryUpdateOptions
  ): Promise<RegistryOperationResult<void>>;

  /**
   * Pin a plugin (add to activePins).
   */
  pinPlugin(pluginId: string, options?: RegistryUpdateOptions): Promise<void>;

  /**
   * Unpin a plugin (remove from activePins).
   */
  unpinPlugin(pluginId: string, options?: RegistryUpdateOptions): Promise<void>;

  /**
   * Add or update a telemetry snapshot in the registry.
   */
  recordTelemetry(
    snapshot: TelemetrySnapshot,
    options?: RegistryUpdateOptions
  ): Promise<void>;

  /**
   * Validate registry integrity (schema validation, checksum).
   * Returns array of validation errors (empty if valid).
   */
  validateRegistry(): Promise<string[]>;

  /**
   * Create a backup of the current registry.
   * Returns backup metadata.
   */
  createBackup(reason: string): Promise<RegistryBackup>;

  /**
   * Restore registry from a backup.
   */
  restoreFromBackup(backupPath: string): Promise<void>;

  /**
   * Get registry statistics (counts, sizes, health).
   */
  getStats(): Promise<{
    totalPlugins: number;
    installedCount: number;
    failedCount: number;
    pinnedCount: number;
    oldestInstall?: Date;
    newestInstall?: Date;
  }>;
}
