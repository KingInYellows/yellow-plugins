/**
 * @yellow-plugins/cli - Compatibility Command Bridge
 *
 * Bridge layer that integrates the domain compatibility service with CLI commands.
 * Handles options parsing, context extraction, verdict logging, and result formatting.
 *
 * Part of Task I2.T1: Compatibility & Policy Engine
 */

import type {
  CompatibilityPolicyOverrides,
  CompatibilityVerdict,
  ICompatibilityService,
  IHostFingerprintProvider,
  PluginCompatibility,
  RegistrySnapshot,
} from '@yellow-plugins/domain';

import type { CommandContext, CommandResult } from '../types/commands.js';

/**
 * Options for compatibility checking
 */
export interface CompatibilityCheckOptions {
  /** Plugin identifier */
  pluginId: string;

  /** Plugin version */
  version: string;

  /** Compatibility requirements from manifest */
  compatibility: PluginCompatibility;

  /** Optional registry snapshot */
  registry?: RegistrySnapshot;

  /** Skip Claude Code version check */
  skipClaudeCheck?: boolean;

  /** Skip Node.js version check */
  skipNodeCheck?: boolean;

  /** Skip OS/arch platform checks */
  skipPlatformCheck?: boolean;

  /** Allow plugin conflicts (warn instead of block) */
  allowConflicts?: boolean;
}

/**
 * Compatibility command bridge result
 */
export interface CompatibilityBridgeResult extends CommandResult {
  /** Compatibility verdict (if check succeeded) */
  verdict?: CompatibilityVerdict;
}

/**
 * Compatibility command bridge
 *
 * Provides a unified interface for CLI commands to check compatibility,
 * log evidence, and format results consistently.
 */
export class CompatCommandBridge {
  private readonly compatibilityService: ICompatibilityService;
  private readonly fingerprintProvider: IHostFingerprintProvider;

  constructor(
    compatibilityService: ICompatibilityService,
    fingerprintProvider: IHostFingerprintProvider
  ) {
    this.compatibilityService = compatibilityService;
    this.fingerprintProvider = fingerprintProvider;
  }

  /**
   * Check plugin compatibility and log verdict evidence
   *
   * @param options - Compatibility check options
   * @param context - Command context with logger
   * @returns Command result with verdict
   */
  checkCompatibility(
    options: CompatibilityCheckOptions,
    context: CommandContext
  ): CompatibilityBridgeResult {
    const { logger } = context;
    const startTime = Date.now();

    try {
      // Build policy overrides from options
      const overrides: CompatibilityPolicyOverrides = {
        skipClaudeCheck: options.skipClaudeCheck,
        skipNodeCheck: options.skipNodeCheck,
        skipPlatformCheck: options.skipPlatformCheck,
        allowConflicts: options.allowConflicts,
      };

      // Get system environment
      const environment = this.fingerprintProvider.getEnvironment();

      // Log compatibility check start
      logger.info('Starting compatibility check', {
        pluginId: options.pluginId,
        version: options.version,
        environment: {
          claudeVersion: environment.claudeCodeVersion,
          nodeVersion: environment.nodeVersion,
          platform: environment.platform,
          arch: environment.arch,
        },
        overrides,
      });

      // Evaluate compatibility
      const verdict = this.compatibilityService.evaluateCompatibility(
        options.pluginId,
        options.version,
        options.compatibility,
        environment,
        options.registry,
        overrides
      );

      // Log verdict summary
      const duration = Date.now() - startTime;
      logger.timing('Compatibility check completed', duration, {
        pluginId: options.pluginId,
        status: verdict.status,
        checksTotal: verdict.checks.length,
        checksPassed: verdict.checks.filter((c) => c.passed).length,
        checksFailed: verdict.checks.filter((c) => !c.passed).length,
      });

      // Log each check result with evidence
      for (const check of verdict.checks) {
        const logData: Record<string, unknown> = {
          checkId: check.id,
          checkType: check.type,
          required: check.required,
          actual: check.actual,
          passed: check.passed,
        };

        if (check.error) {
          logData['errorCode'] = check.error.code;
          logData['errorMessage'] = check.error.message;
          logData['specReference'] = check.error.specReference;
        }

        if (check.passed) {
          logger.debug(check.message, logData);
        } else {
          logger.warn(check.message, logData);
        }
      }

      // Log conflicting plugins if any
      if (verdict.conflictingPlugins && verdict.conflictingPlugins.length > 0) {
        logger.warn('Plugin conflicts detected', {
          conflictingPlugins: verdict.conflictingPlugins,
        });
      }

      // Determine success based on verdict status
      const success = verdict.status === 'compatible' || verdict.status === 'warn';

      return {
        success,
        status: success ? 'success' : 'error',
        message: verdict.summary,
        data: {
          verdict: {
            status: verdict.status,
            pluginId: verdict.pluginId,
            version: verdict.version,
            checksTotal: verdict.checks.length,
            checksPassed: verdict.checks.filter((c) => c.passed).length,
            checksFailed: verdict.checks.filter((c) => !c.passed).length,
            conflictingPlugins: verdict.conflictingPlugins,
            evaluatedAt: verdict.evaluatedAt.toISOString(),
          },
          environment: {
            claudeVersion: environment.claudeCodeVersion,
            nodeVersion: environment.nodeVersion,
            platform: environment.platform,
            arch: environment.arch,
            installedPlugins: environment.installedPlugins,
          },
        },
        verdict,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Compatibility check failed', {
        pluginId: options.pluginId,
        error: errorMessage,
        durationMs: duration,
      });

      return {
        success: false,
        status: 'error',
        message: `Compatibility check failed: ${errorMessage}`,
        error: {
          code: 'ERROR-COMPAT-INTERNAL',
          message: errorMessage,
          details: error,
        },
      };
    }
  }

  /**
   * Get compatibility intent snapshot for logging
   *
   * Captures the complete compatibility evaluation context for audit trails.
   *
   * @param options - Compatibility check options
   * @returns Compatibility intent object
   */
  getCompatibilityIntent(options: CompatibilityCheckOptions): Record<string, unknown> {
    const environment = this.fingerprintProvider.getEnvironment();

    return {
      pluginId: options.pluginId,
      version: options.version,
      compatibility: options.compatibility,
      environment: {
        os: environment.platform,
        arch: environment.arch,
        nodeVersion: environment.nodeVersion,
        claudeVersion: environment.claudeCodeVersion,
        installedPlugins: environment.installedPlugins,
      },
      policyOverrides: {
        skipClaudeCheck: options.skipClaudeCheck || false,
        skipNodeCheck: options.skipNodeCheck || false,
        skipPlatformCheck: options.skipPlatformCheck || false,
        allowConflicts: options.allowConflicts || false,
      },
      registry: options.registry,
    };
  }
}

/**
 * Create a compatibility command bridge instance
 *
 * @param compatibilityService - Compatibility service implementation
 * @param fingerprintProvider - Host fingerprint provider
 * @returns Configured command bridge
 */
export function createCompatCommandBridge(
  compatibilityService: ICompatibilityService,
  fingerprintProvider: IHostFingerprintProvider
): CompatCommandBridge {
  return new CompatCommandBridge(compatibilityService, fingerprintProvider);
}
