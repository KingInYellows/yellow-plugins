/**
 * @yellow-plugins/cli - Info Command
 *
 * Displays detailed information about a specific plugin.
 * Part of Task I3.T1: Marketplace ingestion & caching implementation.
 *
 * @specification FR-002, CRIT-007
 */

import * as path from 'node:path';

import { MarketplaceIndexService } from '@yellow-plugins/domain';
import { createValidator } from '@yellow-plugins/infrastructure';

import {
  loadRequest,
  writeResponse,
  toCommandResult,
  buildBaseResponse,
} from '../lib/io.js';
import type { CommandHandler, CommandMetadata, BaseCommandOptions } from '../types/commands.js';

interface InfoOptions extends BaseCommandOptions {
  plugin: string;
}

/**
 * Info request payload
 */
interface InfoRequest {
  pluginId: string;
  correlationId?: string;
}

/**
 * Info response payload
 */
interface InfoResponse {
  success: boolean;
  status: 'success' | 'error' | 'warning';
  message: string;
  transactionId: string;
  correlationId: string;
  timestamp: string;
  cliVersion: string;
  data?: {
    plugin: {
      id: string;
      name: string;
      version: string;
      author?: string;
      description?: string;
      source: string;
      category: string;
      tags?: string[];
      featured?: boolean;
      verified?: boolean;
      downloads?: number;
      updatedAt?: string;
    };
  };
  warnings?: string[];
  error?: {
    code: string;
    message: string;
    severity: 'ERROR' | 'WARNING';
    category: string;
    specReference?: string;
    resolution?: string;
  };
}

const infoHandler: CommandHandler<InfoOptions> = async (options, context) => {
  const { logger, config, correlationId, startTime } = context;
  const startTimeMs = startTime.getTime();

  logger.info('Info command invoked', { pluginId: options.plugin });

  try {
    // Load request from JSON input or build from CLI arguments
    const request = await loadRequest<InfoRequest>(
      options,
      {
        pluginId: options.plugin,
        correlationId,
      },
      context
    );

    // Validate required pluginId field
    if (!request.pluginId || request.pluginId.trim() === '') {
      const errorResponse: InfoResponse = {
        ...buildBaseResponse({ success: false, message: 'Plugin ID is required' }, context),
        error: {
          code: 'ERR-INFO-001',
          message: 'Missing required argument: plugin',
          severity: 'ERROR',
          category: 'VALIDATION',
          specReference: 'FR-002',
          resolution: 'Provide a plugin ID',
        },
      };

      await writeResponse(errorResponse, options, context);
      return toCommandResult(errorResponse);
    }

    // Initialize validator and marketplace service
    const validator = await createValidator();
    const marketplaceService = new MarketplaceIndexService(validator, logger);

    // Load marketplace index
    const indexPath = path.join(config.pluginDir, 'marketplace.json');
    logger.debug('Loading marketplace index', { indexPath });

    try {
      await marketplaceService.loadIndex(indexPath);
    } catch (error) {
      const errorResponse: InfoResponse = {
        ...buildBaseResponse({ success: false, message: 'Failed to load marketplace index' }, context),
        error: {
          code: 'ERR-DISC-001',
          message: (error as Error).message,
          severity: 'ERROR',
          category: 'DISCOVERY',
          specReference: 'FR-001, FR-002',
          resolution: 'Run marketplace generator to create/update the index, or check that marketplace.json exists in the plugin directory',
        },
      };

      await writeResponse(errorResponse, options, context);
      return toCommandResult(errorResponse);
    }

    // Check index freshness
    const freshness = await marketplaceService.checkFreshness(indexPath);
    const warnings: string[] = [];

    if (freshness.stale) {
      const ageHours = Math.floor(freshness.ageMs! / (1000 * 60 * 60));
      warnings.push(
        `Marketplace index is stale (${ageHours} hours old). Run marketplace generator to refresh.`
      );
      logger.warn('Marketplace index is stale', { ageHours });
    }

    if (freshness.integrityStatus === 'invalid') {
      warnings.push(
        'Marketplace index content hash mismatch detected. Regenerate marketplace.json to restore integrity.'
      );
      logger.warn('Marketplace index integrity check failed');
    }

    if (freshness.signatureStatus === 'invalid') {
      warnings.push(
        'Marketplace index signature mismatch detected. Fetch the latest marketplace repo or rerun the generator to re-sign the index.'
      );
      logger.warn('Marketplace index signature verification failed');
    }

    // Get plugin info
    const plugin = await marketplaceService.getPluginInfo(request.pluginId);

    if (!plugin) {
      const errorResponse: InfoResponse = {
        ...buildBaseResponse(
          { success: false, message: `Plugin '${request.pluginId}' not found` },
          context
        ),
        error: {
          code: 'ERR-INFO-002',
          message: `Plugin '${request.pluginId}' not found in marketplace`,
          severity: 'ERROR',
          category: 'DISCOVERY',
          specReference: 'FR-002',
          resolution: 'Check the plugin ID and try again, or run "plugin browse" to see available plugins',
        },
        warnings: warnings.length > 0 ? warnings : undefined,
      };

      await writeResponse(errorResponse, options, context);
      return toCommandResult(errorResponse);
    }

    logger.info('Plugin info retrieved', {
      pluginId: plugin.id,
      version: plugin.version,
    });

    const endTimeMs = Date.now();
    const durationMs = endTimeMs - startTimeMs;

    // Build response
    const response: InfoResponse = {
      ...buildBaseResponse(
        {
          success: true,
          status: warnings.length > 0 ? 'warning' : 'success',
          message: `Plugin '${plugin.name}' (${plugin.id})${warnings.length > 0 ? ' (with warnings)' : ''}`,
        },
        context
      ),
      data: {
        plugin,
      },
      warnings: warnings.length > 0 ? warnings : undefined,
    };

    logger.info('Info command completed', {
      durationMs,
      warnings: warnings.length,
      pluginId: plugin.id,
    });

    await writeResponse(response, options, context);
    return toCommandResult(response);
  } catch (error) {
    const endTimeMs = Date.now();
    const durationMs = endTimeMs - startTimeMs;

    logger.error('Info command failed', { error, durationMs });

    const errorResponse: InfoResponse = {
      ...buildBaseResponse(
        {
          success: false,
          message: `Info failed: ${(error as Error).message}`,
        },
        context
      ),
      error: {
        code: 'ERR-INFO-999',
        message: (error as Error).message,
        severity: 'ERROR',
        category: 'EXECUTION',
      },
    };

    await writeResponse(errorResponse, options, context);
    return toCommandResult(errorResponse);
  }
};

export const infoCommand: CommandMetadata<InfoOptions> = {
  name: 'info',
  aliases: ['show', 'details'],
  description: 'Display detailed information about a specific plugin',
  usage: 'plugin info <plugin-id>',
  requiredFlags: undefined,
  specAnchors: ['FR-002', 'CRIT-007', '3-3-cli-workflow-control'],
  errorCodes: ['ERR-INFO-001', 'ERR-INFO-002', 'ERR-DISC-001'],
  examples: [
    {
      command: 'plugin info hookify',
      description: 'Show detailed information about the hookify plugin',
    },
    {
      command: 'plugin info pr-review-toolkit --output -',
      description: 'Output plugin information as JSON to stdout',
    },
  ],
  handler: infoHandler,
  builder: (yargs) => {
    return yargs.positional('plugin', {
      describe: 'Plugin identifier',
      type: 'string',
      demandOption: true,
    });
  },
};
