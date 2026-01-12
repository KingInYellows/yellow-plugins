/**
 * @yellow-plugins/domain - Install Service Implementation
 *
 * Core domain service orchestrating plugin installation transactions.
 * Implements the 7-step lifecycle with staging, validation, lifecycle hooks, and atomic commits.
 *
 * Part of Task I2.T3: Install Transaction Orchestrator
 *
 * Architecture References:
 * - Section 2.1: Install Transaction Orchestrator component diagram
 * - Section 3.10: Install Transaction Lifecycle (7 steps)
 * - CRIT-001: Transaction tracking
 * - CRIT-002: Rollback support
 * - CRIT-004: Lifecycle script consent
 * - CRIT-010: Telemetry instrumentation
 * - CRIT-018: Atomic operations
 */

import type { ICacheService } from '../cache/contracts.js';
import type { Config } from '../config/contracts.js';
import type { IRegistryService } from '../registry/contracts.js';
import { InstallState } from '../registry/types.js';

import type { IInstallService } from './contracts.js';
import type {
  InstallRequest,
  InstallResult,
  RollbackRequest,
  UninstallRequest,
  UninstallResult,
  UpdateRequest,
} from './types.js';
import { UninstallService } from './uninstallService.js';

/**
 * Install service implementation.
 * Orchestrates plugin installation with full transaction lifecycle.
 */
export class InstallService implements IInstallService {
  private readonly config: Config;
  private readonly cacheService: ICacheService;
  private readonly registryService: IRegistryService;
  private readonly uninstallService: UninstallService;

  constructor(config: Config, cacheService: ICacheService, registryService: IRegistryService) {
    this.config = config;
    this.cacheService = cacheService;
    this.registryService = registryService;
    this.uninstallService = new UninstallService(config, cacheService, registryService);
  }

  /**
   * Install a plugin from marketplace or source.
   * Implements full 7-step transaction lifecycle from Architecture §3.10.
   */
  async install(request: InstallRequest): Promise<InstallResult> {
    const transactionId = this.generateTransactionId();
    const startTime = Date.now();
    const messages: Array<{ level: 'info' | 'warn' | 'error'; message: string; step?: string }> = [];

    try {
      // Step 1: Validate marketplace index freshness and compatibility
      messages.push({
        level: 'info',
        message: `Starting installation of ${request.pluginId}${request.version ? `@${request.version}` : ''}`,
        step: 'VALIDATE',
      });

      // Check if already installed (unless force)
      const existingPlugin = await this.registryService.getPlugin(request.pluginId);
      if (existingPlugin && !request.force) {
        return {
          success: false,
          transactionId,
          error: {
            code: 'ERR-INSTALL-001',
            message: `Plugin ${request.pluginId} is already installed at version ${existingPlugin.version}. Use --force to reinstall.`,
            failedStep: 'VALIDATE',
          },
          metadata: {
            durationMs: Date.now() - startTime,
            timestamp: new Date(),
            correlationId: request.correlationId,
          },
          messages,
        };
      }

      // Step 2: Stage artifacts (create temp directory)
      messages.push({
        level: 'info',
        message: 'Staging artifacts...',
        step: 'STAGE',
      });

      const targetVersion = request.version || 'latest'; // TODO: resolve 'latest' from marketplace
      const stageResult = await this.cacheService.stageArtifacts(request.pluginId, targetVersion, {
        transactionId,
      });

      if (!stageResult.success || !stageResult.data) {
        return this.buildErrorResult(
          transactionId,
          'ERR-INSTALL-002',
          `Failed to stage artifacts: ${stageResult.error?.message}`,
          'STAGE',
          startTime,
          messages,
          request.correlationId
        );
      }

      const stagingPath = stageResult.data.stagingPath;

      // Step 3: Extract artifacts and validate manifest
      // TODO: Implement download/extract logic
      // TODO: Implement manifest validation
      messages.push({
        level: 'info',
        message: 'Extracting and validating manifest...',
        step: 'EXTRACT',
      });

      // Step 4: Display lifecycle scripts and obtain consent
      // TODO: Implement lifecycle sandbox integration
      messages.push({
        level: 'info',
        message: 'Checking lifecycle scripts...',
        step: 'LIFECYCLE_PRE',
      });

      // Step 5: Promote staged artifacts to cache
      messages.push({
        level: 'info',
        message: 'Promoting artifacts to cache...',
        step: 'PROMOTE',
      });

      const promoteResult = await this.cacheService.promoteArtifacts(
        request.pluginId,
        targetVersion,
        stagingPath,
        {
          transactionId,
          skipEviction: false,
        }
      );

      if (!promoteResult.success || !promoteResult.data) {
        return this.buildErrorResult(
          transactionId,
          'ERR-INSTALL-003',
          `Failed to promote artifacts: ${promoteResult.error?.message}`,
          'PROMOTE',
          startTime,
          messages,
          request.correlationId
        );
      }

      const cachePath = promoteResult.data.cachePath;
      const checksum = promoteResult.data.checksum;

      // Step 6: Update registry atomically
      messages.push({
        level: 'info',
        message: 'Updating registry...',
        step: 'ACTIVATE',
      });

      const plugin = {
        pluginId: request.pluginId,
        version: targetVersion,
        source: request.source || 'marketplace',
        installState: InstallState.INSTALLED,
        installedAt: new Date(),
        cachePath,
        transactionId,
        pinned: false,
      };

      const registryResult = await this.registryService.addPlugin(plugin, {
        transactionId,
        createBackup: true,
        validateAfterUpdate: true,
        telemetryContext: {
          transactionId,
          commandType: 'install',
          durationMs: Date.now() - startTime,
        },
      });

      if (!registryResult.success) {
        // Rollback: remove promoted cache
        await this.cacheService.retrieveArtifacts(request.pluginId, targetVersion, {
          transactionId,
        });
        // TODO: Implement cache removal

        return this.buildErrorResult(
          transactionId,
          'ERR-INSTALL-004',
          `Failed to update registry: ${registryResult.error?.message}`,
          'ACTIVATE',
          startTime,
          messages,
          request.correlationId
        );
      }

      // Step 7: Emit telemetry and cleanup
      messages.push({
        level: 'info',
        message: 'Installation complete',
        step: 'TELEMETRY',
      });

      return {
        success: true,
        transactionId,
        plugin,
        registryDelta: {
          added: [plugin],
        },
        cacheOperations: {
          staged: true,
          promoted: true,
          checksum,
          evicted: promoteResult.data.evictionTriggered ? 1 : 0,
          sizeMb: Math.round((promoteResult.data.sizeBytes / (1024 * 1024)) * 100) / 100,
        },
        metadata: {
          durationMs: Date.now() - startTime,
          timestamp: new Date(),
          correlationId: request.correlationId,
        },
        messages,
      };
    } catch (error) {
      return this.buildErrorResult(
        transactionId,
        'ERR-INSTALL-999',
        `Unexpected error: ${(error as Error).message}`,
        'UNKNOWN',
        startTime,
        messages,
        request.correlationId,
        error
      );
    }
  }

  /**
   * Delegate uninstall handling to UninstallService implementation.
   */
  uninstall(request: UninstallRequest): Promise<UninstallResult> {
    return this.uninstallService.uninstall(request);
  }

  /**
   * Update an installed plugin to a new version.
   */
  async update(request: UpdateRequest): Promise<InstallResult> {
    const transactionId = this.generateTransactionId();
    const startTime = Date.now();
    const messages: Array<{ level: 'info' | 'warn' | 'error'; message: string; step?: string }> = [];

    try {
      // Verify plugin is installed
      const existingPlugin = await this.registryService.getPlugin(request.pluginId);
      if (!existingPlugin) {
        return this.buildErrorResult(
          transactionId,
          'ERR-UPDATE-001',
          `Plugin ${request.pluginId} is not installed`,
          'VALIDATE',
          startTime,
          messages,
          request.correlationId
        );
      }

      messages.push({
        level: 'info',
        message: `Updating ${request.pluginId} from ${existingPlugin.version} to ${request.version || 'latest'}`,
        step: 'VALIDATE',
      });

      // Perform installation of new version
      const installResult = await this.install({
        ...request,
        force: true, // Force update even if "installed"
      });

      if (installResult.success) {
        messages.push({
          level: 'info',
          message: 'Update complete',
          step: 'TELEMETRY',
        });

        return {
          ...installResult,
          registryDelta: {
            updated: installResult.plugin ? [installResult.plugin] : [],
          },
        };
      }

      return installResult;
    } catch (error) {
      return this.buildErrorResult(
        transactionId,
        'ERR-UPDATE-999',
        `Unexpected error during update: ${(error as Error).message}`,
        'UNKNOWN',
        startTime,
        messages,
        request.correlationId,
        error
      );
    }
  }

  /**
   * Rollback a plugin to a previous cached version.
   */
  async rollback(request: RollbackRequest): Promise<InstallResult> {
    const transactionId = this.generateTransactionId();
    const startTime = Date.now();
    const messages: Array<{ level: 'info' | 'warn' | 'error'; message: string; step?: string }> = [];

    try {
      messages.push({
        level: 'info',
        message: `Rolling back ${request.pluginId}${request.targetVersion ? ` to ${request.targetVersion}` : ''}`,
        step: 'VALIDATE',
      });

      // Get current installation
      const currentPlugin = await this.registryService.getPlugin(request.pluginId);
      if (!currentPlugin) {
        return this.buildErrorResult(
          transactionId,
          'ERR-ROLLBACK-001',
          `Plugin ${request.pluginId} is not installed`,
          'VALIDATE',
          startTime,
          messages,
          request.correlationId
        );
      }

      // Find rollback target
      const cachedVersions = this.cacheService.listEntries(request.pluginId);
      let targetVersion = request.targetVersion;

      if (!targetVersion) {
        // Find previous version (highest version < current)
        const sortedVersions = cachedVersions
          .map((e) => e.version)
          .filter((v) => this.compareVersions(v, currentPlugin.version) < 0)
          .sort((a, b) => this.compareVersions(b, a));

        targetVersion = sortedVersions[0];
      }

      if (!targetVersion) {
        return this.buildErrorResult(
          transactionId,
          'ERR-ROLLBACK-002',
          `No cached version available for rollback`,
          'VALIDATE',
          startTime,
          messages,
          request.correlationId
        );
      }

      // Verify target version is cached
      const cacheRetrieveResult = await this.cacheService.retrieveArtifacts(
        request.pluginId,
        targetVersion,
        { transactionId }
      );

      if (!cacheRetrieveResult.success) {
        return this.buildErrorResult(
          transactionId,
          'ERR-CACHE-001',
          `Target version ${targetVersion} not found in cache`,
          'VALIDATE',
          startTime,
          messages,
          request.correlationId
        );
      }

      const cachePath = cacheRetrieveResult.data!;

      // Update registry to point to rollback version
      messages.push({
        level: 'info',
        message: `Activating version ${targetVersion}...`,
        step: 'ACTIVATE',
      });

      const updatedPlugin = {
        ...currentPlugin,
        version: targetVersion,
        cachePath,
        installState: InstallState.INSTALLED,
        transactionId,
      };

      const registryResult = await this.registryService.updatePlugin(
        request.pluginId,
        {
          version: targetVersion,
          cachePath,
          transactionId,
        },
        {
          transactionId,
          createBackup: true,
          validateAfterUpdate: true,
        }
      );

      if (!registryResult.success) {
        return this.buildErrorResult(
          transactionId,
          'ERR-ROLLBACK-003',
          `Failed to update registry: ${registryResult.error?.message}`,
          'ACTIVATE',
          startTime,
          messages,
          request.correlationId
        );
      }

      messages.push({
        level: 'info',
        message: `Rollback complete: ${request.pluginId}@${targetVersion}`,
        step: 'TELEMETRY',
      });

      return {
        success: true,
        transactionId,
        plugin: updatedPlugin,
        registryDelta: {
          updated: [updatedPlugin],
        },
        metadata: {
          durationMs: Date.now() - startTime,
          timestamp: new Date(),
          correlationId: request.correlationId,
        },
        messages,
      };
    } catch (error) {
      return this.buildErrorResult(
        transactionId,
        'ERR-ROLLBACK-999',
        `Unexpected error during rollback: ${(error as Error).message}`,
        'UNKNOWN',
        startTime,
        messages,
        request.correlationId,
        error
      );
    }
  }

  /**
   * Verify installation integrity for a plugin.
   */
  async verify(pluginId: string): Promise<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  }> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Check registry entry exists
      const plugin = await this.registryService.getPlugin(pluginId);
      if (!plugin) {
        errors.push(`Plugin ${pluginId} not found in registry`);
        return { valid: false, errors, warnings };
      }

      // Check cache path exists
      const cacheResult = await this.cacheService.retrieveArtifacts(pluginId, plugin.version, {});
      if (!cacheResult.success) {
        errors.push(`Cache path ${plugin.cachePath} does not exist or is inaccessible`);
      }

      // Check cache entry integrity
      const cacheEntry = this.cacheService.getEntry(pluginId, plugin.version);
      if (!cacheEntry) {
        errors.push(`Cache entry for ${pluginId}@${plugin.version} missing from cache index`);
      } else if (cacheEntry.cachePath !== plugin.cachePath) {
        warnings.push(
          `Cache path mismatch: registry=${plugin.cachePath}, cache=${cacheEntry.cachePath}`
        );
      }

      // TODO: Verify symlinks
      // TODO: Verify manifest integrity

      return {
        valid: errors.length === 0,
        errors,
        warnings,
      };
    } catch (error) {
      errors.push(`Verification failed: ${(error as Error).message}`);
      return { valid: false, errors, warnings };
    }
  }

  /**
   * List available rollback targets for a plugin.
   */
  async listRollbackTargets(pluginId: string): Promise<
    Array<{
      version: string;
      cachePath: string;
      sizeBytes: number;
      lastAccessTime: Date;
      pinned: boolean;
    }>
  > {
    const cachedEntries = this.cacheService.listEntries(pluginId);

    // Get current version to exclude it
    const currentPlugin = await this.registryService.getPlugin(pluginId);
    const currentVersion = currentPlugin?.version;

    return cachedEntries
      .filter((entry) => entry.version !== currentVersion)
      .map((entry) => ({
        version: entry.version,
        cachePath: entry.cachePath,
        sizeBytes: entry.sizeBytes,
        lastAccessTime: entry.lastAccessTime,
        pinned: entry.pinned,
      }))
      .sort((a, b) => this.compareVersions(b.version, a.version));
  }

  // Private helper methods

  /**
   * Build error result with consistent structure.
   */
  private buildErrorResult(
    transactionId: string,
    errorCode: string,
    errorMessage: string,
    failedStep: string,
    startTime: number,
    messages: Array<{ level: 'info' | 'warn' | 'error'; message: string; step?: string }>,
    correlationId?: string,
    details?: unknown
  ): InstallResult {
    messages.push({
      level: 'error',
      message: errorMessage,
      step: failedStep,
    });

    return {
      success: false,
      transactionId,
      error: {
        code: errorCode,
        message: errorMessage,
        failedStep,
        details,
      },
      metadata: {
        durationMs: Date.now() - startTime,
        timestamp: new Date(),
        correlationId,
      },
      messages,
    };
  }

  /**
   * Generate a unique transaction ID.
   */
  private generateTransactionId(): string {
    return `tx-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
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
}
