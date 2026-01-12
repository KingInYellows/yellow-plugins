/**
 * @yellow-plugins/cli - Rollback Command
 *
 * Handles plugin version rollback operations with JSON contract support.
 * Updated for Task I2.T4: CLI Contract Catalog implementation.
 *
 * Part of Task I1.T4: CLI command manifest
 * Part of Task I2.T4: CLI contract catalog and I/O helpers
 *
 * @specification docs/contracts/cli-contracts.md#rollback-contract
 * @schema api/cli-contracts/rollback.json
 */

import {
  loadRequest,
  writeResponse,
  toCommandResult,
  buildBaseResponse,
} from '../lib/io.js';
import type { CommandHandler, CommandMetadata, BaseCommandOptions } from '../types/commands.js';

interface RollbackOptions extends BaseCommandOptions {
  plugin?: string;
  version?: string;
  listTargets?: boolean;
}

/**
 * Rollback request payload matching api/cli-contracts/rollback.json schema.
 */
interface RollbackRequest {
  pluginId: string;
  targetVersion?: string;
  cachePreference: 'cached-only' | 'download-if-missing';
  confirmationToken?: string;
  listTargets?: boolean;
  correlationId?: string;
  dryRun?: boolean;
  flagOverrides?: Record<string, boolean>;
  telemetryContext?: {
    sessionId?: string;
    gitCommit?: string;
    tags?: Record<string, string>;
  };
}

/**
 * Rollback response payload matching api/cli-contracts/rollback.json schema.
 */
interface RollbackResponse {
  success: boolean;
  status: 'success' | 'error' | 'dry-run' | 'partial';
  message: string;
  transactionId: string;
  correlationId: string;
  timestamp: string;
  cliVersion: string;
  data?: {
    pluginId: string;
    fromVersion?: string;
    toVersion?: string;
    installState?: 'active' | 'staged' | 'failed';
    cacheSource?: 'cached' | 'downloaded';
    availableTargets?: Array<{
      version: string;
      cached: boolean;
      installedAt: string;
      cachePath?: string;
    }>;
    checkpointId?: string;
    registryDelta?: {
      modified: string[];
    };
    flagEvaluations?: {
      flags: Record<string, boolean>;
      source: 'config' | 'override' | 'default';
      appliedFlags: string[];
    };
  };
  error?: {
    code: string;
    message: string;
    severity: 'ERROR' | 'WARNING';
    category: string;
    specReference?: string;
    resolution?: string;
    context?: Record<string, unknown>;
  };
  telemetry?: {
    durationMs: number;
    cacheStatus?: 'hit' | 'miss' | 'partial';
    bytesDownloaded?: number;
    lifecycleScriptsRun?: number;
    registryMutations?: number;
  };
}

const rollbackHandler: CommandHandler<RollbackOptions> = async (options, context) => {
  const { logger, flags, correlationId, startTime } = context;
  const startTimeMs = startTime.getTime();

  logger.info('Rollback command invoked', { pluginId: options.plugin, version: options.version });

  // Check if rollback feature is enabled
  if (!flags.enableRollback) {
    logger.error('Rollback feature is not enabled', { requiredFlag: 'enableRollback' });

    const errorResponse: RollbackResponse = {
      ...buildBaseResponse(
        {
          success: false,
          message: 'Rollback feature is not enabled. Enable it in .claude-plugin/flags.json',
        },
        context
      ),
      error: {
        code: 'ERR-ROLLBACK-001',
        message: 'Feature flag "enableRollback" is required but not enabled',
        severity: 'ERROR',
        category: 'FEATURE_FLAG',
        specReference: 'FR-003, CRIT-018',
        resolution: 'Set "enableRollback": true in .claude-plugin/flags.json',
      },
    };

    await writeResponse(errorResponse, options, context);
    return toCommandResult(errorResponse);
  }

  try {
    // Load request from JSON input or build from CLI arguments
    const request = await loadRequest<RollbackRequest>(
      options,
      {
        pluginId: options.plugin,
        targetVersion: options.version,
        cachePreference: 'cached-only',
        listTargets: options.listTargets,
        correlationId,
        dryRun: options.dryRun,
        // TODO: Generate confirmation token from user prompt in interactive mode
        confirmationToken: 'user-confirmed',
      },
      context
    );

    // Validate required fields
    if (!request.pluginId) {
      const errorResponse: RollbackResponse = {
        ...buildBaseResponse({ success: false, message: 'Plugin ID is required' }, context),
        error: {
          code: 'ERR-ROLLBACK-002',
          message: 'Missing required argument: plugin',
          severity: 'ERROR',
          category: 'VALIDATION',
          specReference: 'FR-003, CRIT-018',
          resolution: 'Provide pluginId in JSON input or as CLI argument',
        },
      };

      await writeResponse(errorResponse, options, context);
      return toCommandResult(errorResponse);
    }

    logger.info('Rollback request prepared', { request });

    // TODO: Call installService.rollback(request)
    // For now, return placeholder response demonstrating contract structure
    // const rollbackResult = await installService.rollback(request);

    // TODO: If listTargets mode, return available rollback targets
    // if (request.listTargets) {
    //   const targets = await installService.listRollbackTargets(request.pluginId);
    // }

    const endTimeMs = new Date().getTime();
    const durationMs = endTimeMs - startTimeMs;

    // Build response following api/cli-contracts/rollback.json schema
    const response: RollbackResponse = {
      ...buildBaseResponse(
        {
          success: true,
          status: request.dryRun ? 'dry-run' : 'success',
          message: `Rollback handler ready for ${request.pluginId}${request.targetVersion ? `@${request.targetVersion}` : ''} (service wiring pending)`,
        },
        context
      ),
      data: {
        pluginId: request.pluginId,
        fromVersion: request.listTargets ? undefined : 'current',
        toVersion: request.targetVersion,
        installState: request.dryRun ? 'staged' : 'active',
        cacheSource: 'cached',
        checkpointId: `ckpt-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`,
        registryDelta: {
          modified: request.dryRun ? [] : [request.pluginId],
        },
        flagEvaluations: {
          flags: {
            enableRollback: flags.enableRollback,
            ...(context.flags as unknown as Record<string, boolean>),
          },
          source: 'config',
          appliedFlags: ['enableRollback'],
        },
      },
      telemetry: {
        durationMs,
        cacheStatus: 'hit',
        bytesDownloaded: 0,
        lifecycleScriptsRun: 0,
        registryMutations: request.dryRun ? 0 : 1,
      },
    };

    // Write response to JSON output if requested
    await writeResponse(response, options, context);

    // Return CLI-compatible result
    return toCommandResult(response);
  } catch (error) {
    logger.error('Rollback command failed', { error });

    const endTimeMs = new Date().getTime();
    const durationMs = endTimeMs - startTimeMs;

    const errorResponse: RollbackResponse = {
      ...buildBaseResponse(
        {
          success: false,
          message: `Rollback failed: ${(error as Error).message}`,
        },
        context
      ),
      error: {
        code: 'ERR-ROLLBACK-999',
        message: (error as Error).message,
        severity: 'ERROR',
        category: 'EXECUTION',
        context: {
          error: String(error),
        },
      },
      telemetry: {
        durationMs,
      },
    };

    await writeResponse(errorResponse, options, context);
    return toCommandResult(errorResponse);
  }
};

export const rollbackCommand: CommandMetadata<RollbackOptions> = {
  name: 'rollback',
  aliases: ['rb', 'revert'],
  description: 'Rollback a plugin to a previous version',
  usage: 'plugin rollback <plugin-id> [--version <version>]',
  requiredFlags: ['enableRollback'],
  specAnchors: ['FR-003', 'CRIT-018', '3-3-cli-workflow-control'],
  errorCodes: ['ERR-ROLLBACK-001', 'ERR-ROLLBACK-002', 'ERR-CACHE-001'],
  examples: [
    {
      command: 'plugin rollback example-plugin',
      description: 'Interactive rollback to a previous cached version',
    },
    {
      command: 'plugin rollback example-plugin --version 1.0.0',
      description: 'Rollback to a specific cached version',
    },
    {
      command: 'plugin rollback example-plugin --list-targets',
      description: 'List cached rollback targets without executing a rollback',
    },
  ],
  handler: rollbackHandler,
  builder: (yargs) => {
    return yargs
      .positional('plugin', {
        describe: 'Plugin identifier to rollback',
        type: 'string',
      })
      .option('version', {
        describe: 'Target version to rollback to',
        type: 'string',
        alias: 'v',
      })
      .option('list-targets', {
        describe: 'List available rollback targets without executing',
        type: 'boolean',
        default: false,
      });
  },
};
