/**
 * @yellow-plugins/cli - Update Command
 *
 * Handles plugin update operations with JSON contract support.
 * Updated for Task I2.T4: CLI Contract Catalog implementation.
 *
 * Part of Task I1.T4: CLI command manifest
 * Part of Task I2.T4: CLI contract catalog and I/O helpers
 *
 * @specification docs/contracts/cli-contracts.md#update-contract
 * @schema api/cli-contracts/update.json
 */

import {
  loadRequest,
  writeResponse,
  toCommandResult,
  buildBaseResponse,
  buildCompatibilityIntent,
} from '../lib/io.js';
import type { CommandHandler, CommandMetadata, BaseCommandOptions } from '../types/commands.js';

interface UpdateOptions extends BaseCommandOptions {
  plugin?: string;
  all?: boolean;
  checkOnly?: boolean;
  versionConstraint?: string;
}

/**
 * Update request payload matching api/cli-contracts/update.json schema.
 */
interface UpdateRequest {
  pluginId?: string;
  all?: boolean;
  compatibilityIntent: {
    nodeVersion: string;
    os: string;
    arch: string;
    claudeVersion?: string;
  };
  versionConstraint?: string;
  skipLifecycle?: boolean;
  checkOnly?: boolean;
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
 * Update response payload matching api/cli-contracts/update.json schema.
 */
interface UpdateResponse {
  success: boolean;
  status: 'success' | 'error' | 'dry-run' | 'partial';
  message: string;
  transactionId: string;
  correlationId: string;
  timestamp: string;
  cliVersion: string;
  data?: {
    updated: Array<{
      pluginId: string;
      fromVersion: string;
      toVersion: string;
      installState: 'active' | 'staged' | 'failed';
    }>;
    upToDate: string[];
    skipped: Array<{
      pluginId: string;
      reason: string;
      errorCode?: string;
    }>;
    availableUpdates?: Array<{
      pluginId: string;
      currentVersion: string;
      latestVersion: string;
      changelogUrl?: string;
    }>;
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

const updateHandler: CommandHandler<UpdateOptions> = async (options, context) => {
  const { logger, correlationId, startTime } = context;
  const startTimeMs = startTime.getTime();

  logger.info('Update command invoked', { pluginId: options.plugin, all: options.all });

  try {
    // Load request from JSON input or build from CLI arguments
    const request = await loadRequest<UpdateRequest>(
      options,
      {
        pluginId: options.plugin,
        all: options.all,
        checkOnly: options.checkOnly,
        versionConstraint: options.versionConstraint,
        compatibilityIntent: buildCompatibilityIntent(),
        correlationId,
        dryRun: options.dryRun,
      },
      context
    );

    // Validate request: either pluginId or all must be specified
    if (!request.pluginId && !request.all) {
      const errorResponse: UpdateResponse = {
        ...buildBaseResponse(
          { success: false, message: 'Either pluginId or --all flag is required' },
          context
        ),
        error: {
          code: 'ERR-UPDATE-001',
          message: 'Missing required argument: plugin or --all',
          severity: 'ERROR',
          category: 'VALIDATION',
          specReference: 'FR-002, CRIT-002',
          resolution: 'Provide pluginId in JSON input or use --all flag',
        },
      };

      await writeResponse(errorResponse, options, context);
      return toCommandResult(errorResponse);
    }

    logger.info('Update request prepared', { request });

    // TODO: Call updateService.update(request)
    // For now, return placeholder response demonstrating contract structure
    // const updateResult = await updateService.update(request);

    const endTimeMs = new Date().getTime();
    const durationMs = endTimeMs - startTimeMs;

    // Build response following api/cli-contracts/update.json schema
    const response: UpdateResponse = {
      ...buildBaseResponse(
        {
          success: true,
          status: request.dryRun ? 'dry-run' : 'success',
          message: request.all
            ? 'Update --all handler ready (service wiring pending)'
            : `Update handler ready for ${request.pluginId} (service wiring pending)`,
        },
        context
      ),
      data: {
        updated: [],
        upToDate: request.pluginId ? [request.pluginId] : [],
        skipped: [],
        registryDelta: {
          modified: [],
        },
        flagEvaluations: {
          flags: context.flags as unknown as Record<string, boolean>,
          source: 'config',
          appliedFlags: [],
        },
      },
      telemetry: {
        durationMs,
        cacheStatus: 'hit',
        bytesDownloaded: 0,
        lifecycleScriptsRun: 0,
        registryMutations: request.dryRun ? 0 : 0,
      },
    };

    // Write response to JSON output if requested
    await writeResponse(response, options, context);

    // Return CLI-compatible result
    return toCommandResult(response);
  } catch (error) {
    logger.error('Update command failed', { error });

    const endTimeMs = new Date().getTime();
    const durationMs = endTimeMs - startTimeMs;

    const errorResponse: UpdateResponse = {
      ...buildBaseResponse(
        {
          success: false,
          message: `Update failed: ${(error as Error).message}`,
        },
        context
      ),
      error: {
        code: 'ERR-UPDATE-999',
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

export const updateCommand: CommandMetadata<UpdateOptions> = {
  name: 'update',
  aliases: ['up', 'upgrade'],
  description: 'Update installed plugins to latest versions',
  usage: 'plugin update [plugin-id] [--all]',
  requiredFlags: undefined,
  specAnchors: ['FR-002', 'CRIT-002', '3-3-cli-workflow-control'],
  errorCodes: ['ERR-UPDATE-001', 'ERR-UPDATE-002', 'ERR-COMPAT-001'],
  examples: [
    {
      command: 'plugin update example-plugin',
      description: 'Update a specific plugin to the latest version',
    },
    {
      command: 'plugin update --all',
      description: 'Update all installed plugins',
    },
    {
      command: 'plugin update --all --check-only',
      description: 'Check for updates without applying them',
    },
  ],
  handler: updateHandler,
  builder: (yargs) => {
    return yargs
      .positional('plugin', {
        describe: 'Plugin identifier to update (omit for all)',
        type: 'string',
      })
      .option('all', {
        describe: 'Update all installed plugins',
        type: 'boolean',
        default: false,
      })
      .option('check-only', {
        describe: 'Check for updates without installing',
        type: 'boolean',
        default: false,
      })
      .option('version-constraint', {
        describe: 'Semver range to constrain updates',
        type: 'string',
      });
  },
};
